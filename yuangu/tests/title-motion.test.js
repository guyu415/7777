import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {coverSize,titleMotionPatches,motionAt,patchWeight,samplePaint} from '../dist/title-motion.js';

test('the original artwork now has separate title bells and nine painted flower clusters',()=>{
  assert.deepEqual(coverSize,{width:1672,height:941});
  assert.equal(titleMotionPatches.filter(p=>p.kind==='bell').length,6);
  assert.equal(titleMotionPatches.filter(p=>p.kind==='flower').length,9);
  assert.ok(titleMotionPatches.find(p=>p.id==='title-left-bell').amplitude>=.12);
  assert.ok(titleMotionPatches.find(p=>p.id==='title-right-bell').amplitude>=.12);
  assert.equal(new Set(titleMotionPatches.map(p=>p.id)).size,titleMotionPatches.length);
});
test('local motion is bounded, smooth and fixed exactly at every patch boundary',()=>{
  for(const p of titleMotionPatches){
    assert.ok(Object.isFrozen(p));
    assert.equal(patchWeight(p,p.cx,p.cy),1);
    for(const [x,y] of [[p.cx-p.rx,p.cy],[p.cx+p.rx,p.cy],[p.cx,p.cy-p.ry],[p.cx,p.cy+p.ry]]){
      assert.equal(patchWeight(p,x,y),0);
      const s=samplePaint(p,x,y,motionAt(p,2));assert.ok(Math.abs(s.x-x)<1e-10);assert.ok(Math.abs(s.y-y)<1e-10);
    }
    for(let t=0;t<24;t+=.1){
      const m=motionAt(p,t),next=motionAt(p,t+.001);
      assert.ok(Math.abs(m.angle)<=p.amplitude+1e-10);
      assert.ok(Math.abs(next.angle-m.angle)<.001);
      for(let x=-.6;x<=.6;x+=.3)for(let y=-.6;y<=.6;y+=.3){
        const px=p.cx+x*p.rx,py=p.cy+y*p.ry,s=samplePaint(p,px,py,m);
        assert.ok(Number.isFinite(s.x)&&Number.isFinite(s.y));
        assert.ok(Math.hypot(s.x-px,s.y-py)<26,p.id);
      }
    }
  }
});
test('flower clusters really sway and bells do not all move in lockstep',()=>{
  for(const p of titleMotionPatches){
    const a=samplePaint(p,p.cx,p.cy,motionAt(p,0)),b=samplePaint(p,p.cx,p.cy,motionAt(p,2));
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)>1,p.id);
  }
  const bells=titleMotionPatches.filter(p=>p.kind==='bell');
  assert.ok(new Set(bells.map(p=>p.phase)).size>4);
});
test('cover effect stays decorative, retains native hitboxes and has a 2D fallback',()=>{
  const source=readFileSync(new URL('../dist/title-motion.js',import.meta.url),'utf8');
  assert.ok(source.includes("getContext('webgl'"));assert.ok(source.includes("getContext('2d'"));
  assert.ok(source.includes('webglcontextrestored'));assert.ok(!/localStorage|sessionStorage|fetch\(/.test(source));
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
  assert.ok(html.includes('./title-effects.js?v=20'));
  assert.equal((html.match(/class="cover-hotspot /g)||[]).length,4);
});
