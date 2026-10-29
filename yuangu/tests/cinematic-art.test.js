import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cgArt,cgView,atlasPoints,collectionDelta,wishMote} from '../dist/cinematic-art.js';
import {story} from '../dist/story.js';
import {sceneView} from '../dist/scene-art.js';
const read=f=>readFileSync(new URL('../dist/'+f,import.meta.url),'utf8');
test('the atlas and three actual CG paintings are wide PNG assets',()=>{
  const files=['assets/cg/sahai-atlas.png',...new Set(Object.values(cgArt).map(c=>'assets/scenes/'+c.file))];assert.equal(files.length,4);
  for(const f of files){const png=readFileSync(new URL('../dist/'+f,import.meta.url));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.ok(png.readUInt32BE(16)/png.readUInt32BE(20)>1.7);}
});
test('CG appears at exactly the intended story beats and clears at the following normal scene',()=>{
  assert.equal(cgView('prologueCollected').kind,'collection');
  assert.equal(cgView('sahaiSeed').kind,'lily');assert.equal(cgView('sahaiBloom').kind,'lily');assert.equal(cgView('sahaiThread').kind,'thread');
  for(const id of ['sahaiPalm','sahaiOutside','sahaiFinalChoice','previewEnd'])assert.equal(cgView(id),null);
  assert.ok(sceneView('sahaiBloom',story.nodes.sahaiBloom).src.endsWith('cg-lily.png'));
  const before=JSON.stringify(story);Object.keys(story.nodes).forEach(cgView);assert.equal(JSON.stringify(story),before);
});
test('painted atlas keeps the exact five existing travel destinations with separated in-bounds hit positions',()=>{
  assert.deepEqual(Object.keys(atlasPoints).sort(),story.map.map(p=>p.scene).sort());
  for(const p of Object.values(atlasPoints)){assert.ok(p.x>=15&&p.x<=85);assert.ok(p.y>=40&&p.y<=76);}
  const app=read('app.js');assert.ok(app.includes('game.canTravel(place)'));assert.ok(app.includes('game.travel(place)'));assert.ok(app.includes('stage.append(el)'));assert.ok(app.includes("aria-current',current?'location':'false'"));
});
test('collection effect receives only a real positive action delta, never a load/render reward',()=>{
  assert.equal(collectionDelta(0,12),12);assert.equal(collectionDelta(12,15),3);
  for(const pair of [[12,12],[15,12],[NaN,12],[12,Infinity]])assert.equal(collectionDelta(...pair),0);
  const app=read('app.js'),load=app.slice(app.indexOf('function load(record)'),app.indexOf('function showSlots'));
  assert.ok(!load.includes('collect('));assert.ok(app.includes('collectionDelta(beforeWish,game.state.wish)'));
});
test('wish motes end at the bell and have finite bounded trajectories and a fade at each end',()=>{
  assert.equal(wishMote(0,0).alpha,0);assert.equal(wishMote(0,1).alpha,0);
  assert.ok(Math.abs(wishMote(2,1).x-.633)<1e-9);assert.ok(Math.abs(wishMote(2,1).y-.8)<1e-9);
  for(let i=0;i<72;i++)for(let n=0;n<=20;n++){const p=wishMote(i,n/20);for(const x of [p.x,p.y,p.alpha,p.radius])assert.ok(Number.isFinite(x));assert.ok(p.alpha>=0&&p.alpha<=1);}
});
test('effects cannot consume input or alter state and cancel on navigation, resizing and reduced motion',()=>{
  const fx=read('wish-effects.js'),css=read('cinematic-art.css');
  assert.ok(!fx.includes('localStorage'));assert.ok(!fx.includes('game.'));assert.ok(!fx.includes('setTimeout'));
  for(const word of ['cancelAnimationFrame','prefers-reduced-motion','visibilitychange',"window.addEventListener('resize'",'removeEventListener'])assert.ok(fx.includes(word));
  assert.ok(css.includes('pointer-events:none'));assert.ok(css.includes('.map-point{position:absolute'));
  assert.ok(css.includes('min-height:44px'));
});
