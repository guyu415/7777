// Decorative only: the existing story, saves and four menu handlers remain intact.
import {createTitleMotion} from './title-motion.js?v=20';
const screen=document.getElementById('title-screen');
const stage=document.getElementById('title-art-stage');
const image=document.getElementById('title-cover');
let bellCanvas=document.getElementById('title-bells');
const particleCanvas=document.getElementById('title-petals');
const coverModal=document.getElementById('modal');
const ctx=particleCanvas.getContext('2d');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const W=1672,H=941;
let drawBells=null,frame=0,last=0,clock=0,visible=!document.hidden,pending=false;
const pulses=[];
let seed=923;
const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const petals=Array.from({length:18},()=>({x:rand()*W,y:rand()*H,size:5+rand()*8,speed:16+rand()*22,phase:rand()*Math.PI*2,spin:rand()*Math.PI,depth:.5+rand()*.5}));

function setupBells(){
  try{
    const motion=createTitleMotion(bellCanvas,image);bellCanvas=motion.canvas;drawBells=motion.draw;
    if(!drawBells)throw new Error('Cover motion unavailable');
    drawBells(0);bellCanvas.classList.add('ready');stage.dataset.bells='ready';stage.dataset.flowers='ready';
  }catch{bellCanvas.classList.remove('ready');stage.dataset.bells='fallback';}
}
function resize(){
  const bounds=stage.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.75);
  for(const canvas of [bellCanvas,particleCanvas]){canvas.width=Math.max(1,Math.round(bounds.width*dpr));canvas.height=Math.max(1,Math.round(bounds.height*dpr));}
  drawBells?.(clock);
}
function paintPetal(p,t){
  const x=p.x+Math.sin(t*.6+p.phase)*25;
  const flutter=Math.cos(t*1.9+p.phase);
  ctx.save();ctx.translate(x,p.y);ctx.rotate(p.spin+t*.32);ctx.scale(Math.max(.22,Math.abs(flutter)),1);
  ctx.globalAlpha=.42+p.depth*.42;
  const fill=ctx.createLinearGradient(-p.size,-p.size,p.size,p.size);fill.addColorStop(0,'#fffef5');fill.addColorStop(.62,'#f1efe2');fill.addColorStop(1,'#b9c9dc');
  ctx.fillStyle=fill;ctx.strokeStyle='#e6d2a17d';ctx.lineWidth=.6;
  ctx.beginPath();ctx.moveTo(0,-p.size);ctx.bezierCurveTo(p.size*1.05,-p.size*.3,p.size*.65,p.size*.65,0,p.size);ctx.bezierCurveTo(-p.size*.6,p.size*.45,-p.size*.8,-p.size*.55,0,-p.size);ctx.fill();ctx.stroke();ctx.restore();
}
function paintPulses(dt){
  for(let n=pulses.length-1;n>=0;n--){
    const p=pulses[n];p.age+=dt;if(p.age>1.05){pulses.splice(n,1);continue;}
    const life=1-p.age/1.05,r=12+p.age*100;
    const glow=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,r);glow.addColorStop(0,`rgba(255,241,189,${life*.52})`);glow.addColorStop(.4,`rgba(172,222,255,${life*.3})`);glow.addColorStop(1,'rgba(190,230,255,0)');
    ctx.fillStyle=glow;ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle=`rgba(255,235,175,${life*.62})`;ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(p.x,p.y,r*.65,r,0,0,Math.PI*2);ctx.stroke();
    for(let k=0;k<9;k++){const a=k*Math.PI*2/9+p.age*.5,d=p.age*70;ctx.fillStyle=`rgba(255,248,210,${life})`;ctx.beginPath();ctx.arc(p.x+Math.cos(a)*d,p.y+Math.sin(a)*d,1.6*life,0,Math.PI*2);ctx.fill();}
  }
}
function tick(now){
  frame=0;if(screen.hidden||!visible)return;
  if(coverModal?.open)return;
  if(now-last<32){frame=requestAnimationFrame(tick);return;}
  const elapsed=last?(now-last)/1000:0,dt=Math.min(elapsed,.06);last=now;clock+=elapsed;
  stage.dataset.effectFrame=String(Math.round(clock*30));
  if(ctx){ctx.setTransform(particleCanvas.width/W,0,0,particleCanvas.height/H,0,0);ctx.clearRect(0,0,W,H);
    if(!reduced.matches){for(const p of petals){p.y+=p.speed*dt;p.x-=dt*(9+p.depth*12);if(p.y>H+20){p.y=-20;p.x=rand()*W;}if(p.x<-40)p.x=W+30;paintPetal(p,clock);}}
    paintPulses(dt);
  }
  if(!reduced.matches)drawBells?.(clock);
  if(!reduced.matches||pulses.length)frame=requestAnimationFrame(tick);
}
function resume(){cancelAnimationFrame(frame);frame=0;last=0;if(!screen.hidden&&visible)frame=requestAnimationFrame(tick);}
stage.addEventListener('pointerdown',event=>{
  if(event.target.closest('button:disabled'))return;
  const button=event.target.closest('.cover-hotspot');button?.classList.add('is-lit');setTimeout(()=>button?.classList.remove('is-lit'),650);if(!frame)resume();
});
// A short reveal lets the touch glow be seen before the existing handler navigates.
const replay=new WeakSet();
for(const button of stage.querySelectorAll('.cover-hotspot'))button.addEventListener('click',event=>{
  if(replay.has(button)){replay.delete(button);return;}
  event.stopImmediatePropagation();if(pending||button.disabled)return;pending=true;button.classList.add('is-lit');
  setTimeout(()=>{pending=false;button.classList.remove('is-lit');if(button.disabled||screen.hidden)return;replay.add(button);button.click();},reduced.matches?0:240);
},true);
new ResizeObserver(resize).observe(stage);
new MutationObserver(resume).observe(screen,{attributes:true,attributeFilter:['hidden']});
if(coverModal)new MutationObserver(resume).observe(coverModal,{attributes:true,attributeFilter:['open']});
document.addEventListener('visibilitychange',()=>{visible=!document.hidden;resume();});
reduced.addEventListener('change',()=>{ctx?.clearRect(0,0,particleCanvas.width,particleCanvas.height);resume();});
image.addEventListener('load',()=>{if(!drawBells)setupBells();resize();resume();},{once:true});
if(image.complete&&image.naturalWidth){setupBells();resize();resume();}
else resume();
