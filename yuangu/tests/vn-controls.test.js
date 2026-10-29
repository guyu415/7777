import test from 'node:test';
import assert from 'node:assert/strict';
import {Playback,ReadLedger,ChapterStore,chapters,linearNode,readPreferences} from '../dist/vn-controls.js';
import {Game,SaveStore,MANUAL_SLOTS} from '../dist/engine-core.js';
import {story} from '../dist/story.js';
const memory=()=>{const m=new Map();return {m,getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
function clock(){const queue=new Map();let id=0;return {queue,setTimer:f=>{queue.set(++id,f);return id;},clearTimer:i=>queue.delete(i),tick(){const [i,f]=queue.entries().next().value||[];if(f){queue.delete(i);f();}}};}
test('skip halts on first unread entry even after that entry is marked read during rendering',()=>{
 const c=clock(),steps=[];const p=new Playback({...c,step:()=>steps.push('advance')});
 p.enter({id:'a',linear:true,wasRead:true});assert.ok(p.setMode('skip'));p.ready({typed:true});c.tick();assert.equal(steps.length,1);
 p.enter({id:'b',linear:true,wasRead:false});p.ready({typed:true});assert.equal(p.mode,'off');assert.equal(c.queue.size,0);
 assert.equal(p.setMode('skip'),false);assert.equal(steps.length,1);
});
test('stale timers cannot advance a loaded/restarted node; modal, hidden UI and background blockers stop scheduling',()=>{
 const c=clock();let count=0,blocked=false;const p=new Playback({...c,step:()=>count++,blocked:()=>blocked});
 p.enter({id:'a',linear:true,wasRead:true});p.setMode('auto');p.ready({typed:true});const old=[...c.queue.values()][0];p.stop();p.enter({id:'loaded',linear:true,wasRead:true});old();assert.equal(count,0);
 p.setMode('auto');blocked=true;p.ready({typed:true});assert.equal(c.queue.size,0);blocked=false;p.ready({typed:true});blocked=true;c.tick();assert.equal(count,0);
});
test('automatic playback waits for full text and scrolling, stops at interactions and never picks a choice',()=>{
 const c=clock();let count=0;const p=new Playback({...c,step:()=>count++});p.enter({id:'a',linear:true,wasRead:false});p.setMode('auto');p.ready({typed:false});assert.equal(c.queue.size,0);p.ready({typed:true,atBottom:false});assert.equal(c.queue.size,0);
 p.ready({typed:true,atBottom:true});c.tick();assert.equal(count,1);
 for(const id of ['courtHub','hub_battlefield','sahaiFinalChoice','previewEnd']){const g=new Game({...story,start:id,initial:{...story.initial,flags:['chapter-sahai','sandstorm-started'],unlockedLocations:Object.keys(story.scenes)}});g.start();assert.equal(linearNode(g.node,g.state),false);p.enter({id,linear:linearNode(g.node,g.state),wasRead:true});assert.equal(p.mode,'off');}
});
test('read-only skip through a forced storm is state-equivalent to manual advancement and stops at choices',()=>{
 const source={...story,start:'hub_well',initial:{...story.initial,minutes:900,flags:['chapter-sahai'],unlockedLocations:Object.keys(story.scenes)}};
 const manual=new Game(source,{seed:33}),fast=new Game(source,{seed:33});manual.start();fast.start();
 for(let i=0;linearNode(manual.node,manual.state)&&i<20;i++){manual.markRead();manual.next();}
 const c=clock(),p=new Playback({...c,step:()=>{fast.markRead();fast.next();p.enter({id:fast.state.node,linear:linearNode(fast.node,fast.state),wasRead:true});p.ready({typed:true});}});
 p.enter({id:fast.state.node,linear:linearNode(fast.node,fast.state),wasRead:true});p.setMode('skip');p.ready({typed:true});for(let i=0;c.queue.size&&i<20;i++)c.tick();
 assert.equal(fast.state.node,'sahaiAsk');assert.equal(p.mode,'off');assert.deepEqual(fast.state,manual.state);
});
test('read ledger survives chapter rewinds, ignores unknown/corrupt entries and does not alter game-state schema',()=>{
 const store=memory(),g=new Game(story);g.start();const keys=Object.keys(g.state);const l=new ReadLedger(story,store);assert.equal(l.has(g.state.node),false);g.markRead();l.ingest(g.state);g.start();assert.ok(l.has('courtAwake'));assert.deepEqual(Object.keys(g.state),keys);assert.ok(new ReadLedger(story,store).has('courtAwake'));
 store.setItem('yuangu-v1:read',JSON.stringify({storyId:story.id,nodes:['fake','courtHub']}));assert.deepEqual([...new ReadLedger(story,store).nodes],['courtHub']);
});
test('all twelve slots, latest and clearing work while retaining preferences and unrelated storage',()=>{
 const store=memory(),g=new Game(story);g.start();const saves=new SaveStore(g,store);assert.equal(MANUAL_SLOTS.length,12);
 for(const slot of MANUAL_SLOTS){g.state.ap=Number(slot);assert.ok(saves.write(slot));assert.equal(saves.read(slot).state.ap,Number(slot));}
 assert.ok(saves.latest());store.setItem('yuangu-v1:preferences','keep');store.setItem('unrelated','keep');store.setItem('yuangu-v1:read','clear');store.setItem('yuangu-v1:chapter-inn','clear');assert.ok(saves.clear());for(const slot of MANUAL_SLOTS)assert.equal(saves.read(slot),null);assert.equal(store.getItem('yuangu-v1:read'),null);assert.equal(store.getItem('yuangu-v1:chapter-inn'),null);assert.equal(store.getItem('yuangu-v1:preferences'),'keep');assert.equal(store.getItem('unrelated'),'keep');
});
test('chapter restart restores the captured action/wish/inventory/RNG state rather than adding rewards again',()=>{
 const store=memory(),g=new Game(story,{seed:91});g.start();const cs=new ChapterStore(g,store);cs.capture();const first=cs.read('court');assert.ok(first);assert.equal(first.state.node,'courtAwake');
 const h=new Game({...story,start:'sahaiStart',initial:{...story.initial,wish:12,flags:['chapter-sahai'],unlockedLocations:Object.keys(story.scenes)}},{seed:91});h.start();g.restore(h.snapshot());cs.capture();const checkpoint=cs.read('sahai');
 g.applyEffects({wish:9,ap:-2,items:{windNote:1},hidden:{rushi:8}});assert.ok(g.restore(checkpoint.state));assert.deepEqual(g.state,checkpoint.state);assert.equal(g.state.wish,12);assert.equal(g.state.ap,6);assert.equal(g.state.inventory.windNote,undefined);assert.equal(cs.read('inn'),null);assert.equal(chapters.length,3);
});
test('invalid or out-of-range preferences safely clamp and preserve explicit mute',()=>{
 const store=memory();store.setItem('yuangu-v1:preferences',JSON.stringify({master:0,music:999,effects:-4,autoDelay:40,sound:true}));assert.deepEqual(readPreferences(store),{master:0,music:100,effects:0,autoDelay:1000,sound:true,bgm:true});store.setItem('yuangu-v1:preferences','broken');assert.equal(readPreferences(store).sound,true);
});
