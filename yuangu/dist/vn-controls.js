import {chapters} from './chapter-data.js?v=10';
export {chapters};
// 视觉小说控制层：与剧情数据无关。所有自动推进仍调用 Game.next()。
export const linearNode=(node,state)=>!!node&&!node.endCard&&!node.end&&!node.courtHub&&!node.exploreHub&&!node.choices?.length&&!!(node.next||(node.resume&&state?.activeEvent));
export class Playback{
  constructor({step,blocked=()=>false,onMode=()=>{},setTimer=(f,delay)=>setTimeout(f,delay),clearTimer=id=>clearTimeout(id)}){Object.assign(this,{step,blocked,onMode,setTimer,clearTimer});this.mode='off';this.token=0;this.view=null;}
  cancel(){this.token++;if(this.timer!==undefined)this.clearTimer(this.timer);this.timer=undefined;}
  stop(){this.cancel();this.mode='off';this.onMode(this.mode);}
  enter(view){this.cancel();this.view=view;if(!view.linear||(this.mode==='skip'&&!view.wasRead))this.stop();}
  setMode(mode){this.cancel();if(!['auto','skip'].includes(mode)||!this.view?.linear||(mode==='skip'&&!this.view.wasRead)){this.stop();return false;}this.mode=mode;this.onMode(mode);return true;}
  ready({typed,atBottom=true,delay=2200}){
    this.cancel();if(this.mode==='off'||!typed||!this.view?.linear||!atBottom||this.blocked())return;
    if(this.mode==='skip'&&!this.view.wasRead){this.stop();return;}
    const token=this.token,view=this.view,mode=this.mode;
    this.timer=this.setTimer(()=>{if(token!==this.token||view!==this.view||this.mode!==mode||this.blocked())return;this.timer=undefined;this.step();},mode==='skip'?140:delay);
  }
}
export class ReadLedger{
  constructor(story,storage){this.story=story;this.storage=storage;this.nodes=new Set();try{const r=JSON.parse(storage.getItem('yuangu-v1:read'));if(r?.storyId===story.id&&Array.isArray(r.nodes))for(const id of r.nodes)if(Object.hasOwn(story.nodes,id))this.nodes.add(id);}catch{}}
  has(id){return this.nodes.has(id);}
  remember(id){if(!Object.hasOwn(this.story.nodes,id)||this.nodes.has(id))return;this.nodes.add(id);this.flush();}
  ingest(state){for(const id of state?.readEvents||[])if(id.startsWith('node:')&&Object.hasOwn(this.story.nodes,id.slice(5)))this.nodes.add(id.slice(5));this.flush();}
  flush(){try{this.storage.setItem('yuangu-v1:read',JSON.stringify({version:1,storyId:this.story.id,nodes:[...this.nodes]}));}catch{}}
}
export class ChapterStore{
  constructor(game,storage){Object.assign(this,{game,storage});}
  key(id){return `yuangu-v1:chapter-${id}`;}
  capture(){const c=chapters.find(c=>c.node===this.game.state?.node);if(!c||this.game.state.activeEvent)return;try{this.storage.setItem(this.key(c.id),JSON.stringify({savedAt:new Date().toISOString(),state:this.game.snapshot()}));}catch{}}
  read(id){try{const r=JSON.parse(this.storage.getItem(this.key(id)));return r?.state?.node===chapters.find(c=>c.id===id)?.node&&this.game.validate(r.state)?r:null;}catch{return null;}}
  clear(){for(const c of chapters)try{this.storage.removeItem(this.key(c.id));}catch{}}
}
export const defaultPreferences={autoDelay:2200,master:70,music:35,effects:55,sound:true,bgm:true};
export function readPreferences(storage){let r={};try{r=JSON.parse(storage.getItem('yuangu-v1:preferences'))||{};}catch{}
  const result={...defaultPreferences};for(const k of ['autoDelay','master','music','effects']){const min=k==='autoDelay'?1000:0,max=k==='autoDelay'?8000:100;if(Number.isFinite(r[k]))result[k]=Math.min(max,Math.max(min,r[k]));}result.sound=typeof r.sound==='boolean'?r.sound:defaultPreferences.sound;result.bgm=typeof r.bgm==='boolean'?r.bgm:typeof r.sound==='boolean'?r.sound:defaultPreferences.bgm;return result;
}
