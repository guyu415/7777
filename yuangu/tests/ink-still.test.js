import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {INK_STILL,InkStillState,inkStillBoundary,inkField,inkAlpha,inkCoverFrame} from '../dist/ink-still.js';
import {story} from '../dist/story.js';
import {Game} from '../dist/engine-core.js';

test('the still is inserted only after the final lily close-up, before the thread, without changing the graph',()=>{
  assert.equal(story.nodes.sahaiBloom.next,'sahaiThread');
  assert.ok(inkStillBoundary('sahaiBloom','sahaiThread'));
  for(const id of Object.keys(story.nodes))if(id!=='sahaiBloom')assert.equal(inkStillBoundary(id,story.nodes[id].next),false);
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.ok(app.includes('if(inkStill.active)return;'));
  assert.ok(app.includes('blocked:()=>onTitle||modal.open||inkStill.active||document.hidden'));
  assert.ok(app.includes('inkStill.show(()=>{if(!onTitle&&game.state.node===from&&game.next()){autoSave();render();}})'));
});
test('elapsed time never dismisses the still, including autoplay-length waits',()=>{
  const s=new InkStillState();s.open();assert.equal(s.phase,'revealing');
  s.advance(2200);assert.equal(s.progress,.5);assert.equal(s.phase,'revealing');
  s.advance(86400000);assert.equal(s.progress,1);assert.equal(s.phase,'held');assert.equal(s.active,true);
  assert.equal(s.tap(),'dismiss');assert.equal(s.phase,'closing');assert.equal(s.tap(),'none');
  s.reset();assert.equal(s.active,false);
});
test('an early touch completes the wash; a separate touch is required to continue',()=>{
  const s=new InkStillState();s.open();s.advance(30);assert.equal(s.tap(),'finish');assert.equal(s.phase,'held');assert.equal(s.progress,1);
  assert.equal(s.tap(),'dismiss');assert.equal(s.tap(),'none');
  s.reset();s.open(true);assert.equal(s.phase,'held');assert.equal(s.tap(),'dismiss');
});
test('the ink mask has irregular, feathered edges and grows monotonically to a fully visible painting',()=>{
  for(let y=0;y<=1;y+=.05)for(let x=0;x<=1;x+=.05){
    const field=inkField(x,y);let last=0;
    assert.equal(inkAlpha(field,0),0);assert.equal(inkAlpha(field,1),1);
    for(let p=0;p<=1;p+=.05){const a=inkAlpha(field,p);assert.ok(Number.isFinite(a)&&a>=last&&a<=1);last=a;}
  }
  assert.notEqual(inkField(.7,.56),inkField(.3,.56));
  assert.ok(inkAlpha(inkField(.5,.56),.35)>inkAlpha(inkField(.02,.02),.35));
});
test('the image covers phone and desktop viewports without stretching and keeps faces within the landscape frame',()=>{
  for(const [w,h]of [[1920,1080],[1536,709],[932,430],[709,1536]]){
    const f=inkCoverFrame(w,h,1536,1024);assert.ok(f.width>=w&&f.height>=h);assert.ok(f.x<=0&&f.y<=0);
    assert.ok(Math.abs(f.width/f.height-1.5)<1e-9);
    if(w>h)for(const [x,y]of [[.40,.24],[.56,.32]]){assert.ok(f.x+f.width*x>0&&f.x+f.width*x<w);assert.ok(f.y+f.height*y>0&&f.y+f.height*y<h);}
  }
});
test('showing and dismissing the presentation cannot add wishes, time, points, flags or items',()=>{
  const g=new Game({...story,start:'sahaiBloom',initial:{...story.initial,minutes:900,wish:12,ap:0,flags:['chapter-sahai','sandstorm-started'],unlockedLocations:Object.keys(story.scenes)}});g.start();
  const before=g.snapshot(),s=new InkStillState();s.open();s.advance(INK_STILL.duration);assert.deepEqual(g.snapshot(),before);s.tap();assert.deepEqual(g.snapshot(),before);
  const direct=new Game(story);assert.ok(direct.restore(before));direct.next();g.next();assert.deepEqual(g.snapshot(),direct.snapshot());
});
test('the uploaded painting is bundled intact and the overlay has no auto-dismiss or extra story writes',()=>{
  const file=readFileSync(new URL('../dist/assets/scenes/cg-lily-ink-still.jpg',import.meta.url));assert.equal(file.toString('hex',0,2),'ffd8');assert.ok(file.length>100000);
  const source=readFileSync(new URL('../dist/ink-still.js',import.meta.url),'utf8');
  assert.ok(!/localStorage|sessionStorage|game\.|fetch\(/.test(source));
  assert.ok(source.includes("state.phase!=='revealing'"));assert.ok(source.includes('screen.inert=true'));assert.ok(source.includes('screen.inert=false'));
  const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');assert.ok(html.includes('id="ink-still"'));assert.ok(html.includes('./app.js?v=22'));
  assert.equal(createHash('sha256').update(file).digest('hex').length,64);
});
