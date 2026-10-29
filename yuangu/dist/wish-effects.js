import {wishMote} from './cinematic-art.js?v=18';
// One transient canvas, no storage, audio, timers that advance the story, or pointer handling.
export function installWishEffects(canvas,screen,image){
  let frame=0,epoch=0,cleanup=()=>{};
  const context=canvas.getContext('2d'),motion=matchMedia('(prefers-reduced-motion: reduce)');
  function stop(){epoch++;cancelAnimationFrame(frame);cleanup();cleanup=()=>{};canvas.hidden=true;canvas.removeAttribute('data-effect');if(context)context.clearRect(0,0,canvas.width,canvas.height);}
  function run(kind,draw,duration){
    stop();if(!context||motion.matches||document.hidden||screen.hidden||screen.classList.contains('ui-hidden'))return;
    const token=epoch;
    function start(){
      if(token!==epoch)return;const rect=screen.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,1.75);
      const width=rect.width,height=rect.height;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);context.setTransform(dpr,0,0,dpr,0,0);
      canvas.dataset.effect=kind;canvas.hidden=false;let begun;
      function tick(now){
        if(token!==epoch)return;if(document.hidden||screen.hidden||screen.classList.contains('ui-hidden')){stop();return;}
        begun??=now;const elapsed=now-begun;context.clearRect(0,0,width,height);
        if(elapsed>=duration){stop();return;}
        draw(context,elapsed/duration,width,height);frame=requestAnimationFrame(tick);
      }
      frame=requestAnimationFrame(tick);
    }
    if(image.complete&&image.naturalWidth)start();else{image.addEventListener('load',start,{once:true});cleanup=()=>image.removeEventListener('load',start);}
  }
  function point(x,y,w,h){
    const ratio=image.naturalWidth/(image.naturalHeight||1)||1672/941;
    const fit=screen.classList.contains('cg-mode')?Math.min:Math.max;
    const scale=fit(w/(image.naturalWidth||1672),h/(image.naturalHeight||941));
    const iw=(image.naturalWidth||1672)*scale,ih=iw/ratio;
    return [x*iw-(iw-w)/2,y*ih-(ih-h)/2];
  }
  function halo(c,x,y,r,alpha){const glow=c.createRadialGradient(x,y,0,x,y,r);glow.addColorStop(0,`rgba(255,248,201,${alpha})`);glow.addColorStop(.2,`rgba(213,234,255,${alpha*.42})`);glow.addColorStop(1,'rgba(214,232,255,0)');c.fillStyle=glow;c.fillRect(x-r,y-r,r*2,r*2);}
  function collect(amount,isCG=false){
    if(!(amount>0))return;
    run('collection',(c,t,w,h)=>{
      const mapping=isCG?{}:{palm:[.51,.43],bell:[.52,.65]};
      c.globalCompositeOperation='lighter';
      for(let i=0;i<72;i++){
        const local=(t-(i%12)*.012)/.87;if(local<0||local>1)continue;
        const p=wishMote(i,local,mapping),[x,y]=isCG?point(p.x,p.y,w,h):[p.x*w,p.y*h];
        halo(c,x,y,7+p.radius*2,p.alpha*.20);c.fillStyle=`rgba(${i%3===0?'207,235,255':'255,233,170'},${p.alpha*.9})`;
        c.beginPath();c.ellipse(x,y,p.radius*1.8,p.radius*.65,-.7,0,Math.PI*2);c.fill();
        const prev=wishMote(i,Math.max(0,local-.025),mapping),[px,py]=isCG?point(prev.x,prev.y,w,h):[prev.x*w,prev.y*h];
        c.strokeStyle=`rgba(249,228,172,${p.alpha*.22})`;c.lineWidth=.6;c.beginPath();c.moveTo(px,py);c.lineTo(x,y);c.stroke();
      }
      const center=t<.68?(isCG?[.355,.465]:[.51,.43]):(isCG?[.633,.8]:[.52,.65]);
      const [hx,hy]=isCG?point(...center,w,h):[center[0]*w,center[1]*h];halo(c,hx,hy,32,Math.sin(t*Math.PI)*.28);
      c.globalCompositeOperation='source-over';
    },2800);
  }
  function enter(kind){
    stop();if(!['lily','thread'].includes(kind))return;
    run(kind,(c,t,w,h)=>{
      const [x,y]=point(kind==='lily'?.46:.50,kind==='lily'?.53:.58,w,h);
      c.globalCompositeOperation='lighter';halo(c,x,y,38,Math.sin(t*Math.PI)*.26);
      for(let i=0;i<18;i++){const phase=t+i/18,angle=i*2.4;const px=x+Math.sin(angle)*phase*31,py=y-phase*34;halo(c,px,py,3,Math.sin(t*Math.PI)*.3);}
      c.globalCompositeOperation='source-over';
    },2200);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  window.addEventListener('resize',stop,{passive:true});motion.addEventListener('change',()=>{if(motion.matches)stop();});
  return {collect,enter,stop};
}
