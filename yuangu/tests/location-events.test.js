import test from 'node:test';
import assert from 'node:assert/strict';
import {story} from '../dist/story.js';
import {Game,SaveStore} from '../dist/engine-core.js';
import {locationDefinitions,locationActions,locationProps} from '../dist/location-events.js';
import {wishTreeView} from '../dist/wish-tree.js';
const start=(id,minutes=720)=>{const g=new Game({...story,start:`hub_${id}`,initial:{...story.initial,minutes,flags:['chapter-sahai','court-opening','tutorial-wish-collected'],wish:12,unlockedLocations:story.map.map(p=>p.scene)}});g.start();return g;};
const chooseAction=(g,id)=>{const a=g.node.choices.find(c=>c.id===id);assert.ok(a,id);assert.ok(g.go(a),id);};
for(const d of locationDefinitions){
  const id=d.id,p=`explore-${id}`;
  test(`${id}: permanent observation is repeatable, collection once, unknown wish stays unreadable`,()=>{
    const g=start(id),a=locationActions[id][0];assert.ok(g.go(a));g.markRead();
    let signal=wishTreeView(g.state).signals.find(r=>r.id===`${p}-signal`);assert.equal(signal.wishText,null);
    assert.equal(wishTreeView(g.state).cards.some(r=>r.id===signal.id),false);
    chooseAction(g,`${p}-collect`);g.markRead();g.next();assert.equal(g.state.wish,12+d.amount);
    assert.ok(g.go(a));assert.equal(g.can(g.node.choices[0]),false);g.choose(1);
    assert.equal(g.state.wish,12+d.amount);assert.equal(g.state.ap,6);assert.equal(g.state.minutes,720);
    const view=wishTreeView(g.state);assert.equal(view.cards.find(r=>r.id===signal.id).wishText,null);
    assert.equal(view.roots.amount,g.state.wish);
  });
  test(`${id}: hidden object unlocks spoken wish only after reading; return/keep are exclusive and saved`,()=>{
    const g=start(id),[permanent,condition,follow]=locationActions[id];
    assert.equal(g.can(condition),false);assert.equal(g.can(follow),false);
    assert.ok(g.go(locationProps[id].action));assert.equal(g.state.inventory[d.item],1);g.next();
    assert.equal(g.can(locationProps[id].action),false);assert.ok(g.go(condition));
    assert.equal(wishTreeView(g.state).cards.some(r=>r.id===`${p}-spoken`),false);g.markRead();
    assert.equal(wishTreeView(g.state).cards.find(r=>r.id===`${p}-spoken`).wishText,d.wish);
    const keep=g.node.choices[1];g.choose(0);assert.equal(g.state.inventory[d.item],undefined);assert.equal(g.state.hidden.rushi,1);
    assert.equal(g.can(keep),false);g.next();assert.equal(g.can(condition),false);
    const records=new Map(),saves=new SaveStore(g,{getItem:k=>records.get(k),setItem:(k,v)=>records.set(k,v)});assert.ok(saves.write('1'));
    const h=start(id);assert.ok(h.restore(saves.read('1').state));assert.deepEqual(h.state,g.state);assert.equal(h.can(condition),false);
    const other=start(id);other.go(locationProps[id].action);other.next();other.go(condition);other.markRead();other.choose(1);
    assert.equal(other.state.inventory[d.item],1);assert.equal(other.state.hidden.yuejie,1);assert.equal(other.can(other.story.nodes[`explore_${id}_expression`].choices[0]),false);
    assert.equal(other.state.wish,12);
  });
  test(`${id}: survey condition requires this location's completed survey and its item`,()=>{
    const g=start(id),follow=locationActions[id][2];g.applyEffects({items:{[d.clue]:1}});assert.equal(g.can(follow),false);
    const survey=story.map.find(a=>a.scene===id).investigate;g.go(survey);g.next();assert.ok(g.can(follow));const before=g.state.hidden.xunxu;
    g.go(follow);assert.equal(g.state.hidden.xunxu,before+1);g.next();assert.equal(g.can(follow),false);
    assert.equal(g.state.ap,5);assert.equal(g.state.minutes,750);
  });
  test(`${id}: time event is start-inclusive/end-exclusive, once-only and preempted by storm`,()=>{
    const a=locationActions[id][3];
    assert.equal(start(id,d.start-1).can(a),false);assert.equal(start(id,d.start).can(a),true);
    assert.equal(start(id,d.end-1).can(a),true);assert.equal(start(id,d.end).can(a),false);
    const g=start(id,d.start);g.go(a);g.markRead();g.next();assert.equal(g.can(a),false);assert.equal(g.state.hidden.rushi,1);
    const h=start(id,870);h.go({target:h.state.node,until:900});assert.ok(h.state.activeEvent.id.startsWith(`sahai-storm-${id}-`));
    assert.equal(h.can(locationActions[id][0]),false);assert.equal(h.can(locationProps[id].action),false);
  });
}
test('all five collections are included once in the returning leaf; unexpressed text remains absent',()=>{
  const g=start('battlefield');
  for(const d of locationDefinitions){g.enter(`hub_${d.id}`);g.go(locationActions[d.id][0]);g.markRead();g.choose(0);g.next();}
  g.applyEffects({flags:['tree-leaf-sahai-001']});const view=wishTreeView(g.state);
  assert.equal(view.leaves.length,1);assert.equal(view.leaves[0].amount,22);
  assert.equal(view.leaves[0].cards.filter(r=>r.id.startsWith('explore-')).length,5);
  assert.ok(view.leaves[0].cards.filter(r=>r.id.startsWith('explore-')).every(r=>r.wishText===null));
});
test('the inn passer-by cannot reappear after departure or outside the early exploration window',()=>{
  const a=locationActions.buriedInn[1],g=start('buriedInn',780);g.applyEffects({items:{doorPeg:1}});assert.ok(g.can(a));
  g.go(locationActions.buriedInn[3]);g.next();assert.equal(g.can(a),false);
  const late=start('buriedInn',870);late.applyEffects({items:{doorPeg:1}});assert.equal(late.can(a),false);
});
