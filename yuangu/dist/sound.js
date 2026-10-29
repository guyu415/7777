import {musicTracks} from './music-cues.js?v=22';
// Bundled music crossfades through Web Audio gain (iOS ignores element.volume).
export function installSound({music,nextMusic,effect,optionEffect,collectionEffect,preferences,onChange=()=>{},environment=globalThis}){
  const decks=[music,nextMusic],effects=[effect,optionEffect,collectionEffect].filter(Boolean),gains=[0,0],keys=['opening','light'];
  let wanted='opening',active=0,silent=false,unlocked=false,blocked=false,frame=0,epoch=0,pending=null,context=null,nodes=null,lastStatus='',fxSerial=effects.map(()=>0);
  const raf=fn=>environment.requestAnimationFrame(fn),cancel=()=>{environment.cancelAnimationFrame(frame);frame=0;};
  decks.forEach((a,i)=>{a.loop=true;a.preload='none';a.src=musicTracks[keys[i]].src;});
  function status(){return {track:wanted,name:musicTracks[wanted].name,enabled:preferences.bgm,unlocked,blocked,paused:silent,playing:!!preferences.bgm&&!silent&&!blocked&&unlocked&&decks.some(a=>!a.paused)};}
  function notify(){const s=status(),key=JSON.stringify(s);if(key!==lastStatus){lastStatus=key;onChange(s);}}
  function level(el,index,value){const v=Math.max(0,Math.min(1,value));if(nodes){el.volume=1;nodes[index].gain.value=v;}else el.volume=v;if(el.dataset)el.dataset.gain=String(v);}
  function levels(){const volume=preferences.bgm&&!silent?preferences.master*preferences.music/10000:0;decks.forEach((a,i)=>level(a,i,gains[i]*volume));}
  function stopDecks(){epoch++;pending=null;cancel();gains.fill(0);levels();decks.forEach(a=>a.pause());notify();}
  function makeGraph(){
    if(context)return;const Constructor=environment.AudioContext||environment.webkitAudioContext;if(!Constructor)return;
    try{context=new Constructor();nodes=[...decks,...effects].map(a=>{const source=context.createMediaElementSource(a),gain=context.createGain();gain.gain.value=0;source.connect(gain);gain.connect(context.destination);return gain;});}catch{nodes=null;}
  }
  function startWanted(){
    if(!unlocked||silent||!preferences.bgm||!preferences.master||!preferences.music){notify();return;}
    if(pending?.key===wanted){levels();return;}
    if(keys[active]===wanted&&!decks[active].paused){levels();notify();return;}
    const old=active,index=keys[active]===wanted?active:1-active,a=decks[index],token=++epoch;
    cancel();if(index!==old){a.pause();gains[index]=0;}
    if(keys[index]!==wanted){keys[index]=wanted;a.src=musicTracks[wanted].src;a.currentTime=0;}
    if(a.dataset)a.dataset.track=wanted;
    pending={key:wanted,index};levels();
    let promise;try{promise=a.play();}catch{promise=Promise.reject();}
    Promise.resolve(promise).then(()=>{
      if(token!==epoch)return;pending=null;active=index;blocked=false;const initial=[...gains];let begun;
      function fade(now){if(token!==epoch)return;begun??=now;const t=Math.min(1,(now-begun)/850),smooth=t*t*(3-2*t);gains[index]=initial[index]+(1-initial[index])*smooth;if(index!==old)gains[old]=initial[old]*(1-smooth);levels();if(t<1)frame=raf(fade);else{frame=0;if(index!==old)decks[old].pause();notify();}}
      frame=raf(fade);notify();
    }).catch(()=>{if(token!==epoch)return;pending=null;blocked=true;notify();});
  }
  function apply(){levels();effects.forEach((a,i)=>{level(a,i+2,preferences.sound&&!silent&&fxSerial[i]>0?preferences.master*preferences.effects/10000:0);if(!preferences.sound||silent||!preferences.master||!preferences.effects)a.pause();});if(!preferences.bgm||silent||!preferences.master||!preferences.music)stopDecks();else startWanted();notify();}
  function unlock(){
    makeGraph();if(context?.state==='suspended')context.resume().catch(()=>{});
    if(!unlocked){
      unlocked=true;
      const index=1-active,a=decks[index];level(a,index,0);
      try{Promise.resolve(a.play()).then(()=>{if(index!==active&&pending?.index!==index)a.pause();}).catch(()=>{});}catch{}
      effects.forEach((audio,i)=>{const serial=fxSerial[i];level(audio,i+2,0);try{Promise.resolve(audio.play()).then(()=>{if(fxSerial[i]===serial)audio.pause();}).catch(()=>{});}catch{}});
    }
    blocked=false;apply();
  }
  function select(key){if(!musicTracks[key])key='light';if(key===wanted){apply();return;}wanted=key;apply();}
  function click(kind='option'){
    if(!preferences.sound||silent||!preferences.master||!preferences.effects)return;
    if(!unlocked)unlock();const i=kind==='cover'?0:kind==='collection'?2:1,a=effects[i];if(!a)return;fxSerial[i]++;a.currentTime=0;level(a,i+2,preferences.master*preferences.effects/10000);
    try{Promise.resolve(a.play()).catch(()=>{});}catch{}
  }
  function stopCollection(){const a=effects[2];if(a){fxSerial[2]++;a.pause();a.currentTime=0;}}
  return {apply,select,click,unlock,status,stopCollection,collect(amount){if(Number.isFinite(amount)&&amount>0)click('collection');},silence(value){silent=!!value;if(!silent&&unlocked&&context&&context.state!=='running')context.resume().catch(()=>{blocked=true;notify();});apply();}};
}
