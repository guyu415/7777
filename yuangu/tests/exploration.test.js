import test from 'node:test';
import assert from 'node:assert/strict';
import { story as currentStory,legacyStory } from '../dist/story.js';
const story={...currentStory,start:'prologueUpper',initial:{...currentStory.initial,flags:['chapter-sahai','prologue-active']}};
import { areas } from '../dist/exploration.js';
import { Game,SaveStore } from '../dist/engine-core.js';
const start=(source=story,seed=17)=>{const g=new Game(source,{seed});g.start();for(let i=0;g.state.flags.includes('prologue-active')&&i<40;i++){if(g.node.choices)g.choose(0);else g.next();}return g;};
const place=id=>story.map.find(p=>p.scene===id);
const resume=g=>{for(let i=0;g.state.activeEvent&&i<10;i++)g.next();assert.equal(g.state.activeEvent,null);};
const arrive=(g,id)=>{assert.ok(g.travel(place(id)));resume(g);};
const hub=g=>{for(let i=0;!g.node.exploreHub&&i<10;i++){if(g.state.activeEvent)resume(g);else g.next();}assert.ok(g.node.exploreHub);};
const position=(g,id)=>{if(id!=='battlefield')arrive(g,id);hub(g);};

test('after prologue, exploration starts at noon with six points and precisely five open map locations',()=>{
  const g=start();assert.equal(g.state.minutes,720);assert.equal(g.state.ap,6);assert.equal(g.isExploration,true);
  assert.deepEqual(g.map.map(p=>p.title),['战场遗址','王城井边','临时集市','城外马场','半埋驿站']);
  assert.equal(g.state.unlockedLocations.length,5);assert.ok(g.validate(g.state));
});
test('new story graph and event references are complete and storm routes share a single merge node',()=>{
  const ids=new Set();
  for(const [id,n] of Object.entries(story.nodes)){
    assert.ok(story.scenes[n.scene],id);assert.ok(story.characters[n.speaker],id);
    if(n.next)assert.ok(story.nodes[n.next],id);
    for(const c of n.choices||[])assert.ok(story.nodes[c.target],id);
    assert.ok(n.next||n.choices||n.end||n.resume,id);
  }
  for(const e of story.events){assert.equal(ids.has(e.id),false,e.id);ids.add(e.id);if(e.target)assert.ok(story.nodes[e.target]?.resume,e.id);}
  const storm=story.events.filter(e=>e.id.startsWith('sahai-storm-'));
  assert.equal(storm.length,10);assert.ok(storm.every(e=>e.forcedAt===900&&e.resumeTo==='sahaiConverge'));
});
test('all twenty directed map movements cost exactly one point and thirty minutes; current location is free to inspect only',()=>{
  for(const from of areas)for(const to of areas){
    const g=start();position(g,from.id);const before=g.snapshot();
    if(from===to){assert.equal(g.travel(place(to.id)),false);assert.deepEqual(g.state,before);continue;}
    arrive(g,to.id);assert.equal(g.node.scene,to.id);assert.equal(g.state.ap,before.ap-1);assert.equal(g.state.minutes,before.minutes+30);
  }
});
test('investigation at every location costs one, records its clue, and cannot be farmed',()=>{
  for(const area of areas){
    const g=start();position(g,area.id);const before=g.snapshot(),action=place(area.id).investigate;
    assert.ok(g.go(action));assert.equal(g.state.ap,before.ap-1);assert.equal(g.state.minutes,before.minutes+30);
    assert.equal(g.state.inventory[area.clue],1);assert.ok(g.state.flags.includes(`surveyed-${area.id}`));
    g.next();const after=g.snapshot();assert.equal(g.go(action),false);assert.deepEqual(g.state,after);
  }
});
test('same location receives different noon and afternoon events through actual revisits',()=>{
  const g=start();arrive(g,'well');assert.ok(g.state.onceEvents.includes('sahai-visit-well-noon'));
  arrive(g,'battlefield');arrive(g,'well');assert.equal(g.state.minutes,810);
  assert.ok(g.state.onceEvents.includes('sahai-visit-well-afternoon'));
  assert.equal(g.state.eventLog.filter(e=>e.id.startsWith('sahai-visit-well')).length,2);
});
test('six normal actions spend all points and the sixth action triggers the storm at 15:00',()=>{
  const g=start();hub(g);
  g.choose(0);g.next(); // 调查遗址：12:30
  arrive(g,'well'); // 13:00
  assert.ok(g.go(place('well').investigate));g.next(); // 13:30
  arrive(g,'market'); // 14:00
  arrive(g,'paddock'); // 14:30
  assert.ok(g.travel(place('buriedInn'))); // 15:00
  assert.equal(g.state.minutes,900);assert.equal(g.state.ap,0);assert.ok(g.state.flags.includes('sandstorm-started'));
  assert.equal(g.state.activeEvent.id,'sahai-storm-buriedInn-bare');
  assert.equal(g.state.eventLog.filter(e=>e.id.startsWith('sahai-storm-')).length,1);
});
test('all five locations with and without their corresponding clue select distinct entrances and converge',()=>{
  for(const area of areas)for(const withClue of [false,true]){
    const g=start();position(g,area.id);
    if(withClue)g.applyEffects({items:{[area.clue]:1}});
    assert.ok(g.go({target:g.state.node,until:900}));
    assert.equal(g.state.activeEvent.id,`sahai-storm-${area.id}-${withClue?'clue':'bare'}`);
    assert.ok(g.state.flags.includes(`storm-from-${area.id}`));assert.equal(g.state.minutes,900);
    assert.equal(g.canTravel(place('well')),false);resume(g);
    assert.equal(g.state.node,'sahaiConverge');assert.equal(g.node.scene,'buriedInn');
    g.next();g.choose(0);g.markRead();g.next();assert.equal(g.state.node,'sahaiEnd');assert.equal(g.state.activeEvent,null);
    assert.equal(g.state.eventLog.filter(e=>e.id.startsWith('sahai-storm-')).length,1);
    assert.ok(g.debugEdit({minutes:960}).ok);assert.equal(g.state.activeEvent,null);assert.ok(g.validate(g.state));
  }
});
test('movement finishing exactly at 15:00 uses its destination for all twenty origin/destination pairs',()=>{
  for(const from of areas)for(const to of areas){if(from===to)continue;
    const g=start();position(g,from.id);assert.ok(g.debugEdit({minutes:870,ap:1}).ok);
    g.applyEffects({items:{[to.clue]:1}});assert.ok(g.travel(place(to.id)));
    assert.equal(g.state.activeEvent.id,`sahai-storm-${to.id}-clue`,`${from.id} -> ${to.id}`);
    assert.equal(g.node.scene,to.id);assert.equal(g.state.ap,0);assert.equal(g.state.minutes,900);
    assert.equal(g.state.eventLog.some(e=>e.minutes===900&&e.id.startsWith('sahai-visit-')),false);
  }
});
test('storm interrupting a longer movement uses the still-current origin and cancels the remaining journey',()=>{
  const g=start();hub(g);g.debugEdit({minutes:885});assert.ok(g.travel(place('market')));
  assert.equal(g.state.activeEvent.id,'sahai-storm-battlefield-bare');assert.equal(g.state.minutes,900);
  assert.equal(g.state.pendingTransition,null);assert.equal(g.state.visited.includes('arrive_market'),false);
  resume(g);assert.equal(g.node.scene,'buriedInn');assert.equal(g.state.minutes,900);
});
test('investigation ending at storm time can use the clue it has just found without double payment',()=>{
  const g=start();hub(g);g.debugEdit({minutes:870,ap:1});assert.ok(g.go(place('battlefield').investigate));
  assert.equal(g.state.activeEvent.id,'sahai-storm-battlefield-clue');assert.equal(g.state.ap,0);
  assert.equal(g.state.inventory.windNote,1);resume(g);assert.equal(g.state.ap,0);
});
test('zero points blocks movement/investigation but waiting still reaches the mandatory mainline',()=>{
  assert.equal(new Game(story).can({target:'sahaiStart',until:900}),false);
  const g=start();hub(g);g.debugEdit({ap:0});const before=g.snapshot();
  assert.equal(g.travel(place('well')),false);assert.equal(g.choose(0),false);assert.deepEqual(g.state,before);
  assert.ok(g.choose(1));assert.equal(g.state.minutes,900);assert.equal(g.state.ap,0);assert.ok(g.state.activeEvent);
  resume(g);assert.equal(g.state.node,'sahaiConverge');
});
test('exploration state and a pending storm entrance survive saves without rerolling or repeating',()=>{
  const g=start();arrive(g,'market');const before=g.snapshot();
  const records=new Map(),ss=new SaveStore(g,{getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v)});
  assert.ok(ss.write('1'));g.go({target:g.state.node,until:900});const during=g.snapshot();assert.ok(ss.write('2'));
  assert.ok(g.restore(ss.read('1').state));assert.deepEqual(g.state,before);
  g.go({target:g.state.node,until:900});assert.equal(g.state.activeEvent.id,during.activeEvent.id);
  assert.ok(g.restore(ss.read('2').state));assert.deepEqual(g.state,during);resume(g);assert.equal(g.state.node,'sahaiConverge');
});
test('market weighted arrival events are filtered by time and reproduce from the same saved seed',()=>{
  const g=start(),before=g.snapshot();assert.ok(g.travel(place('market')));const id=g.state.activeEvent.id;
  assert.ok(id.startsWith('sahai-visit-market-noon'));const seed=g.state.rngSeed;
  const loaded=start();loaded.restore(before);loaded.travel(place('market'));
  assert.equal(loaded.state.activeEvent.id,id);assert.equal(loaded.state.rngSeed,seed);
  resume(g);arrive(g,'well');assert.ok(g.travel(place('market')));
  assert.ok(g.state.activeEvent.id.startsWith('sahai-visit-market-afternoon'));
});
test('old v2 saves keep their chapter and map, while a new game switches to exploration',()=>{
  const old=start(legacyStory);old.next();old.next();old.choose(1);resume(old);old.next();const record=old.snapshot();
  const g=start();assert.ok(g.restore(record));assert.equal(g.isExploration,false);assert.equal(g.map.length,2);
  assert.equal(g.state.ap,record.ap);assert.equal(g.state.wish,record.wish);assert.deepEqual(g.state.onceEvents,record.onceEvents);
  g.start();assert.equal(g.isExploration,true);assert.equal(g.map.length,5);assert.equal(g.state.ap,6);
});
test('overdue exploration loads force the right storm entrance without rewinding or softlocking',()=>{
  const g=start();position(g,'well');const record=g.snapshot();record.minutes=930;
  assert.ok(g.restore(record));assert.equal(g.state.activeEvent.id,'sahai-storm-well-bare');assert.equal(g.state.minutes,930);
  resume(g);assert.equal(g.state.node,'sahaiConverge');assert.equal(g.canTravel(place('paddock')),false);
});
