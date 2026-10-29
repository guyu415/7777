// A presentation-only interlude. Story nodes, rewards and save schema are unchanged.
export const INK_STILL=Object.freeze({after:'sahaiBloom',before:'sahaiThread',src:'./assets/scenes/cg-lily-ink-still.jpg',duration:4400});
export const inkStillBoundary=(from,to)=>from===INK_STILL.after&&to===INK_STILL.before;

export class InkStillState{
  constructor(){this.reset();}
  reset(){this.phase='closed';this.elapsed=0;}
  open(reduced=false){this.elapsed=reduced?INK_STILL.duration:0;this.phase=reduced?'held':'revealing';}
  advance(ms){if(this.phase==='revealing'){this.elapsed=Math.min(INK_STILL.duration,this.elapsed+Math.max(0,ms));if(this.elapsed>=INK_STILL.duration)this.phase='held';}return this.progress;}
  get progress(){return Math.min(1,this.elapsed/INK_STILL.duration);}
  get active(){return this.phase!=='closed';}
  tap(){if(this.phase==='revealing'){this.elapsed=INK_STILL.duration;this.phase='held';return 'finish';}if(this.phase==='held'){this.phase='closing';return 'dismiss';}return 'none';}
}

function noise(x,y){const a=Math.sin(x*127.1+y*311.7+17.13)*43758.5453;return a-Math.floor(a);}
function valueNoise(x,y){
  const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy);
  return (noise(ix,iy)*(1-u)+noise(ix+1,iy)*u)*(1-v)+(noise(ix,iy+1)*(1-u)+noise(ix+1,iy+1)*u)*v;
}
export function inkField(x,y,cx=.5,cy=.56){
  const dx=x-cx,dy=y-cy,angle=Math.atan2(dy,dx);
  const grain=valueNoise(x*4,y*4)*.55+valueNoise(x*11,y*11)*.3+valueNoise(x*27,y*27)*.15;
  return Math.hypot(dx,dy)*1.36+(grain-.5)*.18+Math.sin(angle*7+grain*3)*.022;
}
export function inkAlpha(field,progress){
  if(progress<=0)return 0;if(progress>=1)return 1;
  const a=Math.max(0,Math.min(1,(-.13+progress*1.55-field)/.085));
  return a*a*(3-2*a);
}
export function inkCoverFrame(width,height,imageWidth,imageHeight){
  const scale=Math.max(width/imageWidth,height/imageHeight),w=imageWidth*scale,h=imageHeight*scale;
  // Keep both faces and the shared flower visible on very wide iPhone screens.
  const x=(width-w)*.46,y=(height-h)*.15;
  return {x,y,width:w,height:h,cx:(x+w*.5)/width,cy:(y+h*.5)/height};
}

export function installInkStill({root,canvas,image,screen}){
  const state=new InkStillState(),context=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)');
  const mask=document.createElement('canvas'),paint=document.createElement('canvas');mask.width=192;mask.height=128;
  const brush=mask.getContext('2d'),art=paint.getContext('2d'),pixels=brush.createImageData(mask.width,mask.height),field=new Float32Array(mask.width*mask.height);
  let frame=0,last=0,epoch=0,timer=0,done=null,loading=null,ready=false,previousFocus=null;
  function preload(){
    if(loading)return loading;
    loading=new Promise(resolve=>{
      const finish=()=>{ready=!!image.naturalWidth;resolve(ready);};
      image.addEventListener('load',finish,{once:true});image.addEventListener('error',finish,{once:true});image.src=INK_STILL.src;
      if(image.complete&&image.naturalWidth)finish();
    });return loading;
  }
  function resize(){
    if(!state.active||!ready||!context)return;
    const bounds=root.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.5);
    canvas.width=Math.max(1,Math.round(bounds.width*dpr));canvas.height=Math.max(1,Math.round(bounds.height*dpr));paint.width=canvas.width;paint.height=canvas.height;
    const fitted=inkCoverFrame(canvas.width,canvas.height,image.naturalWidth,image.naturalHeight);
    art.drawImage(image,fitted.x,fitted.y,fitted.width,fitted.height);
    for(let y=0;y<mask.height;y++)for(let x=0;x<mask.width;x++)field[y*mask.width+x]=inkField(x/(mask.width-1),y/(mask.height-1),fitted.cx,fitted.cy);
    draw(state.progress);
  }
  function draw(progress){
    root.dataset.phase=state.phase;root.setAttribute('aria-busy',String(state.phase==='revealing'));
    if(!ready||!context)return;
    context.clearRect(0,0,canvas.width,canvas.height);context.globalCompositeOperation='source-over';context.drawImage(paint,0,0);
    if(progress<1){
      for(let i=0;i<field.length;i++){const out=i*4;pixels.data[out]=pixels.data[out+1]=pixels.data[out+2]=255;pixels.data[out+3]=Math.round(inkAlpha(field[i],progress)*255);}
      brush.putImageData(pixels,0,0);context.globalCompositeOperation='destination-in';context.drawImage(mask,0,0,canvas.width,canvas.height);context.globalCompositeOperation='source-over';
    }
  }
  function tick(now){
    frame=0;if(!state.active||document.hidden||state.phase!=='revealing')return;
    if(last&&now-last<32){frame=requestAnimationFrame(tick);return;}
    state.advance(last?now-last:0);last=now;draw(state.progress);
    if(state.phase==='revealing')frame=requestAnimationFrame(tick);
  }
  function resume(){cancelAnimationFrame(frame);frame=0;last=0;if(ready&&state.phase==='revealing'&&!document.hidden)frame=requestAnimationFrame(tick);}
  function close(){
    epoch++;cancelAnimationFrame(frame);clearTimeout(timer);frame=0;timer=0;done=null;state.reset();root.hidden=true;root.disabled=false;root.classList.remove('is-exiting');root.dataset.phase='closed';root.setAttribute('aria-busy','false');screen.inert=false;screen.removeAttribute('aria-hidden');
  }
  function show(callback){
    close();const token=epoch;done=callback;previousFocus=document.activeElement;state.open(motion.matches);root.hidden=false;root.dataset.phase='loading';screen.inert=true;screen.setAttribute('aria-hidden','true');root.focus({preventScroll:true});
    preload().then(ok=>{
      if(token!==epoch||!state.active)return;
      if(!ok||!context){state.advance(INK_STILL.duration);root.dataset.phase='held';root.dataset.imageError='true';return;}
      delete root.dataset.imageError;resize();resume();
    });
  }
  root.addEventListener('click',event=>{
    event.preventDefault();event.stopPropagation();const action=state.tap();
    if(action==='finish'){cancelAnimationFrame(frame);draw(1);return;}
    if(action!=='dismiss')return;
    cancelAnimationFrame(frame);root.disabled=true;root.classList.add('is-exiting');root.dataset.phase='closing';const token=epoch,callback=done;
    timer=setTimeout(()=>{if(token!==epoch)return;close();if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});callback?.();},motion.matches?0:280);
  });
  document.addEventListener('visibilitychange',resume);window.addEventListener('resize',resize,{passive:true});
  motion.addEventListener('change',()=>{if(motion.matches&&state.phase==='revealing'){state.advance(INK_STILL.duration);cancelAnimationFrame(frame);draw(1);}});
  return {preload,show,cancel:close,get active(){return state.active;}};
}
