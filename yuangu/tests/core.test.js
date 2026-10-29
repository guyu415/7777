import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyStory as story } from '../dist/story.js';
import { Game, SaveStore } from '../dist/engine-core.js';
const resume = g => { while (g.state.activeEvent) g.next(); };

test('all story links, speakers, actors, scenes and map links are valid', () => {
  for (const n of Object.values(story.nodes)) {
    assert.ok(story.scenes[n.scene]); assert.ok(story.characters[n.speaker]);
    if (n.actor) assert.ok(story.characters[n.actor]);
    if (n.next) assert.ok(story.nodes[n.next]);
    for (const c of n.choices || []) assert.ok(story.nodes[c.target]);
    assert.ok(n.next || n.choices?.length || n.end || n.resume);
  }
  for (const p of story.map) if (p.target) assert.ok(story.nodes[p.target]);
});
test('main path consumes action/time and terminates at opening sample', () => {
  const g = new Game(story); g.start(); g.next(); g.next();
  assert.ok(g.choose(0)); assert.equal(g.node.scene,'station');
  assert.equal(g.state.ap,2); assert.equal(g.state.minutes,910); assert.equal(g.state.wish,12);
  g.next(); g.choose(0); g.next(); assert.ok(g.node.end); assert.equal(g.next(),false);
});
test('optional branch is once-only, no resource underflow, ribbon branch rejoins', () => {
  const g = new Game(story); g.start(); g.next(); g.next();
  g.choose(1); resume(g); g.next(); assert.equal(g.state.ap,2); assert.equal(g.choose(1),false);
  g.state.ap = 0; assert.equal(g.choose(0),false); assert.equal(g.state.ap,0);
  g.state.ap = 2; g.choose(0); g.next(); g.choose(1); g.next(); assert.equal(g.state.node,'lily');
});
test('map transition obeys location and shares action cost with story transition', () => {
  const g = new Game(story); g.start(); const station = story.map[1];
  assert.equal(g.travel(station),false); g.next();
  assert.equal(g.travel(station),true); assert.equal(g.state.ap,2); assert.equal(g.state.minutes,910);
  assert.equal(g.travel(station),false); assert.equal(g.travel(story.map[0]),false);
});
test('manual saves restore node, counters, history and once flags without aliasing', () => {
  const data = new Map(), store = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) };
  const g = new Game(story); g.start(); g.next(); g.next(); g.choose(1); resume(g); g.next();
  const ss = new SaveStore(g,store); const snapshot = g.snapshot(); assert.ok(ss.write('1'));
  g.choose(0); assert.ok(ss.write('auto')); assert.equal(ss.read('1').state.node,'direction');
  assert.ok(g.restore(ss.read('1').state)); assert.deepEqual(g.state,snapshot);
  const record = ss.read('1'); record.state.ap = 200; assert.equal(g.state.ap,2);
  assert.ok(ss.latest());
});
test('corrupt, incompatible and invalid saves fail safely; storage failure is reported', () => {
  const g = new Game(story); g.start(); const ss = new SaveStore(g,{getItem:()=>'{broken'});
  assert.equal(ss.read('1'),null);
  for (const changes of [{node:'missing'},{storyId:'old'},{ap:-1},{minutes:Infinity},{wish:'12'},{flags:[1]},{history:[{speaker:'hacker',text:'x'}]}]) {
    assert.equal(g.restore({...g.snapshot(),...changes}),false);
  }
  let reported = false;
  const denied = new SaveStore(g,{setItem:()=>{throw Error('quota');}},()=>{reported=true;});
  assert.equal(denied.write('1'),false); assert.ok(reported);
});
