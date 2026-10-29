// One transient blue glow layer; long press only requests the existing read-only skip.
export const HOLD_DELAY=430;
export class HoldPress{
  start(id,x,y,now){Object.assign(this,{id,x,y,began:now,moved:false,long:false,active:true});}
  move(id,x,y){if(this.active&&this.id===id&&Math.hypot(x-this.x,y-this.y)>12)this.moved=true;return this.moved;}
  trigger(now){if(!this.active||this.moved||this.long||now-this.began<HOLD_DELAY)return false;this.long=true;return true;}
  finish(id){if(!this.active||this.id!==id)return false;const consume=this.long&&!this.moved;this.active=false;return consume;}
  reset(){this.active=false;this.long=false;}
}
export function glowRadius(ms,releasedMs=null,reduced=false){
  const held=Math.max(0,ms),r=reduced?25:Math.min(210,12+held*.075);
  return r+(releasedMs===null?0:Math.min(1,Math.max(0,releasedMs)/760)*(reduced?0:86));
}
export function installTouchEffects({root,canvas,canHold,onHoldStart,onHoldStop}){
  const context=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)'),press=new HoldPress(),pulses=[];
  let frame=0,timer=0,skipping=false,suppress=null;
  const now=()=>performance.now();
  function top(){
    root.hidden=false;
    if(typeof root.showPopover==='function'){
      try{if(root.matches(':popover-open'))root.hidePopover();root.showPopover();}catch{root.removeAttribute('popover');}
    }else root.removeAttribute('popover');
  }
  function resize(){const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(innerWidth*dpr);canvas.height=Math.round(innerHeight*dpr);}
  function animate(time){
    frame=0;if(!context)return;
    const sx=canvas.width/innerWidth,sy=canvas.height/innerHeight;context.setTransform(sx,0,0,sy,0,0);context.clearRect(0,0,innerWidth,innerHeight);
    for(let i=pulses.length-1;i>=0;i--){
      const p=pulses[i],released=p.release===null?null:time-p.release,duration=motion.matches?350:850;
      if(released!==null&&released>=duration){pulses.splice(i,1);continue;}
      const age=(p.release??time)-p.began,r=glowRadius(age,released,motion.matches),life=released===null?Math.min(1,.5+age/200):Math.pow(1-released/duration,1.5);
      const glow=context.createRadialGradient(p.x,p.y,0,p.x,p.y,r);
      glow.addColorStop(0,`rgba(194,235,255,${life*.53})`);glow.addColorStop(.18,`rgba(106,202,255,${life*.39})`);glow.addColorStop(.48,`rgba(65,156,247,${life*.24})`);glow.addColorStop(1,'rgba(57,139,242,0)');
      context.fillStyle=glow;context.fillRect(p.x-r,p.y-r,r*2,r*2);
    }
    root.dataset.pulses=String(pulses.length);
    if(pulses.length)frame=requestAnimationFrame(animate);else{try{if(root.matches(':popover-open'))root.hidePopover();}catch{}root.hidden=true;}
  }
  function schedule(){if(!frame&&context)frame=requestAnimationFrame(animate);}
  function add(id,x,y,released=false){const t=now();if(pulses.length>=10)pulses.shift();pulses.push({id,x,y,began:t,release:released?t:null});top();schedule();}
  function stopSkip(){if(skipping){skipping=false;onHoldStop();}root.dataset.holding='false';}
  function release(id){const t=now();for(const p of pulses)if(p.id===id&&p.release===null)p.release=t;}
  function cancel(){clearTimeout(timer);press.reset();stopSkip();for(const p of pulses)if(p.release===null)p.release=now();}
  function storySurface(target){return !!target.closest('#game-screen')&&!target.closest('button,a,input,select,textarea,dialog,.choices,.system-tools,.game-toolbar,#system-menu,#court-hotspots,#explore-scene');}
  document.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    if(event.isPrimary)cancel();
    add(event.pointerId,event.clientX,event.clientY);
    if(!event.isPrimary){cancel();return;}
    press.start(event.pointerId,event.clientX,event.clientY,now());
    const eligible=storySurface(event.target);
    timer=setTimeout(()=>{
      if(!press.trigger(now()))return;root.dataset.holding='true';
      if(eligible&&canHold())skipping=!!onHoldStart();
    },HOLD_DELAY+5);
  },{capture:true,passive:true});
  document.addEventListener('pointermove',event=>{if(press.move(event.pointerId,event.clientX,event.clientY)){clearTimeout(timer);stopSkip();release(event.pointerId);}},{capture:true,passive:true});
  document.addEventListener('pointerup',event=>{
    clearTimeout(timer);release(event.pointerId);
    if(press.finish(event.pointerId))suppress={x:event.clientX,y:event.clientY,until:now()+700};
    stopSkip();
  },{capture:true,passive:true});
  document.addEventListener('pointercancel',cancel,{capture:true,passive:true});
  document.addEventListener('contextmenu',event=>{if(press.active&&press.long&&event.target.closest('#game-screen,#ink-still'))event.preventDefault();},{capture:true});
  document.addEventListener('click',event=>{
    if(suppress&&now()<suppress.until&&Math.hypot(event.clientX-suppress.x,event.clientY-suppress.y)<30){suppress=null;event.preventDefault();event.stopImmediatePropagation();return;}
    suppress=null;
    // Keyboard clicks have no pointerdown; ignore scripted cover-menu replay clicks.
    if(event.isTrusted&&event.detail===0){const b=event.target.getBoundingClientRect();add('keyboard',b.x+b.width/2,b.y+b.height/2,true);}
  },{capture:true});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel();pulses.length=0;cancelAnimationFrame(frame);frame=0;try{root.hidePopover?.();}catch{}root.hidden=true;}});
  window.addEventListener('blur',cancel);window.addEventListener('resize',()=>{cancel();resize();},{passive:true});resize();
  return {cancelHold:cancel};
}
