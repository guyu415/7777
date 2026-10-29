import test from 'node:test';
import assert from 'node:assert/strict';
import { story as currentStory } from '../dist/story.js';
const story={...currentStory,start:'prologueUpper',initial:{...currentStory.initial,flags:['chapter-sahai','prologue-active']}};
import { Game,SaveStore } from '../dist/engine-core.js';
const start=()=>{const g=new Game(story,{seed:42});g.start();return g;};
const reach=(g,id,choice=0)=>{for(let i=0;g.state.node!==id&&i<60;i++){assert.ok(g.node.choices?g.choose(choice):g.next());}assert.equal(g.state.node,id);};

test('prologue begins in upper court with silent bell, zero collected power and six unspent actions',()=>{
  const g=start();assert.equal(g.state.node,'prologueUpper');assert.equal(g.node.scene,'upperCourt');
  assert.equal(g.state.wish,0);assert.equal(g.state.ap,6);assert.equal(g.state.minutes,720);
  assert.equal(g.state.inventory.goldBell,1);assert.ok(g.validate(g.state));
  for(const p of g.map)assert.equal(g.canTravel(p),false);
  reach(g,'prologueCollect');for(const p of g.map)assert.equal(g.canTravel(p),false);
  assert.equal(g.can(g.map[0].investigate),false);
  assert.equal(g.can({target:g.state.node,until:900,when:{notFlags:['prologue-active']}}),false);
});
test('both teaching choices differ in attention and rejoin before the spoken wish',()=>{
  for(const c of [0,1]){
    const g=start();reach(g,'prologueBellChoice');assert.ok(g.choose(c));
    assert.equal(g.state.hidden[c===0?'xunxu':'rushi'],1);
    reach(g,'prologueHear');assert.match(g.node.text,/低声念了一句/);
    assert.ok(g.state.visited.includes('prologueLimit'));assert.ok(g.state.visited.includes('prologueReply'));
    assert.equal(g.state.wish,0);assert.equal(g.state.ap,6);
  }
});
test('collecting is an actual one-time state change with item prerequisite and safe save reload',()=>{
  const g=start();reach(g,'prologueCollect');const action=g.node.choices[0];
  g.applyEffects({items:{goldBell:-1}});assert.equal(g.choose(0),false);assert.equal(g.state.wish,0);
  g.applyEffects({items:{goldBell:1}});
  const data=new Map(),saves=new SaveStore(g,{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)});
  assert.ok(saves.write('1'));assert.ok(g.choose(0));assert.equal(g.state.wish,12);assert.equal(g.state.ap,6);
  assert.ok(saves.write('2'));assert.ok(g.restore(saves.read('1').state));assert.equal(g.state.wish,0);
  assert.ok(g.choose(0));assert.equal(g.state.wish,12);assert.ok(g.restore(saves.read('2').state));
  assert.equal(g.can(action),false);assert.equal(g.state.wish,12);
});
test('every prologue checkpoint validates and resumes with identical counters and flags',()=>{
  const g=start();for(let i=0;g.state.flags.includes('prologue-active')&&i<40;i++){
    const record=g.snapshot(),copy=start();assert.ok(copy.restore(record),g.state.node);assert.deepEqual(copy.state,record);
    assert.ok(g.node.choices?g.choose(0):g.next());
  }
  assert.equal(g.state.node,'sahaiStart');assert.equal(g.state.minutes,720);assert.equal(g.state.ap,6);assert.equal(g.state.wish,12);
  assert.deepEqual(g.state.unlockedLocations,['battlefield','well','market','paddock','buriedInn']);
  assert.ok(g.canTravel(g.map[1]));assert.ok(g.travel(g.map[1]));
  assert.equal(g.state.ap,5);assert.equal(g.state.minutes,750);assert.equal(g.node.scene,'well');
});
test('an existing task-three save enters exploration directly without replaying or collecting twice',()=>{
  const before=new Game({...story,start:'sahaiStart',initial:{...story.initial,wish:12,flags:['chapter-sahai'],unlockedLocations:story.map.map(p=>p.scene)}});
  before.start();before.travel(before.map[1]);const saved=before.snapshot();
  const g=start();assert.ok(g.restore(saved));assert.deepEqual(g.state,saved);
  assert.equal(g.state.flags.includes('prologue-active'),false);assert.equal(g.state.wish,12);
  g.next();assert.equal(g.canTravel(g.map[2]),true);
});
