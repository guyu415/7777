import test from 'node:test';
import assert from 'node:assert/strict';
import {story} from '../dist/story.js';
import {Game,SaveStore,meets} from '../dist/engine-core.js';
import {wishTreeView,treeCategories} from '../dist/wish-tree.js';
const start=()=>{const g=new Game(story,{seed:73});g.start();return g;};
const readNext=g=>{g.markRead();assert.ok(g.next());};
const action=(g,id)=>story.court.interactions.find(a=>a.id===id&&meets(g.context(),a.when));
const click=(g,id)=>{const a=action(g,id);assert.ok(a,id);g.markRead();assert.ok(g.go(a),id);};
function ready(g,choice=0){
 readNext(g);click(g,'tree');click(g,'bell');g.markRead();g.choose(choice);readNext(g);g.markRead();g.choose(0);
 click(g,'rong');for(let i=0;i<3;i++){g.markRead();assert.ok(g.choose(0));}readNext(g);
}
function reach(g,id){
 for(let i=0;g.state.node!==id&&i<40;i++){g.markRead();assert.ok(g.node.choices?.length?g.choose(0):g.next());}
 assert.equal(g.state.node,id);
}
function sahai(g){ready(g);click(g,'platform');reach(g,'sahaiStart');}
function end(g){while(g.state.activeEvent)readNext(g);reach(g,'sahaiFinalChoice');g.markRead();g.choose(0);readNext(g);assert.equal(g.state.node,'previewEnd');}
function returnAndArchive(g){g.markRead();assert.ok(g.go(story.postludeAction));assert.equal(g.state.node,'courtReturn');g.markRead();assert.ok(g.choose(0));readNext(g);assert.equal(g.state.node,'courtHome');}

test('upper court is an operable scene; all four targets obey sequential teaching gates without spending actions',()=>{
 const g=start();assert.equal(g.state.node,'courtAwake');assert.equal(g.node.scene,'upperCourt');readNext(g);
 assert.ok(action(g,'tree'));assert.equal(action(g,'bell'),undefined);assert.equal(action(g,'rong'),undefined);assert.equal(action(g,'platform'),undefined);
 assert.equal(g.next(),false);assert.equal(g.canTravel(g.map[1]),false);
 click(g,'tree');assert.ok(action(g,'bell'));assert.equal(action(g,'rong'),undefined);assert.equal(action(g,'platform'),undefined);
 assert.equal(g.state.ap,6);assert.equal(g.state.minutes,720);assert.equal(g.state.wish,0);
 assert.deepEqual(treeCategories.map(c=>c.name),['枝叶','微光','根系','年轮','归档']);
});
test('both bell experiments expose only qualities and three short rule choices unlock the platform',()=>{
 for(const choice of [0,1]){const g=start();ready(g,choice);const view=wishTreeView(g.state);
  assert.equal(view.signals.length,1);assert.equal(view.signals[0].wishText,null);assert.equal(view.cards.length,0);assert.equal(view.leaves.length,0);
  for(const flag of ['court-tree-seen','court-bell-learned','court-rule-sense','court-rule-collect','court-rules-ready'])assert.ok(g.state.flags.includes(flag));
  click(g,'platform');assert.equal(g.state.node,'courtDepart');readNext(g);assert.equal(g.state.node,'prologueDescent');
  assert.equal(g.state.wish,0);assert.equal(g.state.ap,6);assert.equal(g.state.minutes,720);
 }
});
test('revisiting objects cannot farm power or hidden stats, and the tree projection never mutates the save',()=>{
 const g=start();ready(g);const stats={...g.state.hidden};
 for(let i=0;i<3;i++){click(g,'tree');click(g,'bell');g.choose(0);readNext(g);g.choose(0);click(g,'rong');readNext(g);}
 assert.equal(g.state.wish,0);assert.deepEqual(g.state.hidden,stats);
 const before=g.snapshot();for(let i=0;i<8;i++)wishTreeView(g.state);assert.deepEqual(g.state,before);assert.ok(g.validate(g.state));
});
test('a wish card appears only after expressed words have actually been read, or a collection is complete',()=>{
 const g=start();sahai(g); // includes a completed collection and spoken cart wish
 assert.equal(wishTreeView(g.state).cards.find(r=>r.id==='cart').wishText,'但愿回去的路还在。');
 const record=g.snapshot();record.readEvents=record.readEvents.filter(id=>id!=='node:prologueHear');
 assert.ok(g.restore(record));const view=wishTreeView(g.state),card=view.cards.find(r=>r.id==='cart');
 assert.equal(card.collected,true);assert.equal(card.expressed,false);assert.equal(card.wishText,null);
 assert.equal(JSON.stringify(view).includes('但愿回去的路还在'),false);
 const h=start();ready(h);click(h,'platform');reach(h,'prologueHear');
 assert.equal(wishTreeView(h.state).cards.length,0);h.markRead();assert.equal(wishTreeView(h.state).cards[0].wishText,'但愿回去的路还在。');
});
test('returning with zero actions closes the loop and creates exactly one leaf without charging or collecting again',()=>{
 const g=start();sahai(g);const by=id=>g.map.find(p=>p.scene===id);
 g.go(by('battlefield').investigate);g.next();
 for(const id of ['well','market','paddock','well','buriedInn']){assert.ok(g.travel(by(id)));while(g.state.activeEvent&&!g.state.flags.includes('sandstorm-started'))readNext(g);}
 assert.equal(g.state.ap,0);assert.equal(g.state.minutes,900);end(g);
 const before=wishTreeView(g.state);assert.equal(before.leaves.length,0);assert.ok(before.cards.find(r=>r.id==='lily'));
 const amount=g.state.wish;returnAndArchive(g);const view=wishTreeView(g.state);
 assert.equal(g.state.ap,0);assert.equal(g.state.minutes,900);assert.equal(g.state.wish,amount);assert.equal(view.leaves.length,1);assert.equal(view.leaves[0].amount,12);
 assert.equal(view.cards.find(r=>r.id==='lily').collected,false);assert.equal(view.leaves[0].cards.some(r=>r.id==='lily'),false);
 assert.ok(view.rings.some(r=>r.title==='第一片叶归档'));assert.equal(g.can(story.nodes.courtReturn.choices[0]),false);
 assert.equal(g.canTravel(by('well')),false);assert.ok(g.validate(g.state));
});
test('all ten storm entrances still reach return and first-leaf archival',()=>{
 for(const p of story.map)for(const clue of [false,true]){
  const g=start();sahai(g);if(p.scene!=='battlefield'){assert.ok(g.travel(p));while(g.state.activeEvent)readNext(g);}
  if(clue)g.applyEffects({items:p.investigate.effects.items});
  g.go({target:g.state.node,until:900});end(g);returnAndArchive(g);
  assert.equal(wishTreeView(g.state).leaves.length,1);assert.ok(g.validate(g.state));
 }
});
test('all teaching and return checkpoints use the unchanged v2 schema, survive saves, and never duplicate the first leaf',()=>{
 const g=start(),keys=Object.keys(g.state).sort(),m=new Map(),saves=new SaveStore(g,{getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v)});
 const checkpoint=()=>{const state=g.snapshot();assert.deepEqual(Object.keys(state).sort(),keys);assert.equal(state.version,2);assert.ok(saves.write('1'));assert.ok(g.restore(saves.read('1').state));assert.deepEqual(g.state,state);};
 checkpoint();ready(g);checkpoint();click(g,'platform');reach(g,'prologueCollect');checkpoint();g.choose(0);checkpoint();reach(g,'sahaiStart');
 g.go({target:g.state.node,until:900});end(g);checkpoint();g.go(story.postludeAction);checkpoint();g.choose(0);checkpoint();g.next();checkpoint();
 const before=g.snapshot();for(let i=0;i<4;i++){g.restore(before);assert.equal(wishTreeView(g.state).leaves.length,1);assert.equal(g.state.wish,12);}
});
test('existing v4 opening and v3 exploration/end saves remain readable and can return without replaying court lessons',()=>{
 for(const startId of ['prologueUpper','sahaiStart','sahaiEnd']){
  const oldStory={...story,start:startId,initial:{...story.initial,wish:startId==='prologueUpper'?0:12,flags:startId==='prologueUpper'?['chapter-sahai','prologue-active']:['chapter-sahai','sandstorm-started'],unlockedLocations:startId==='prologueUpper'?['upperCourt','battlefield']:story.map.map(p=>p.scene)}};
  const old=new Game(oldStory);old.start();const snapshot=old.snapshot();const g=start();assert.ok(g.restore(snapshot));assert.equal(g.state.node,startId);assert.deepEqual(g.state,snapshot);
  if(startId==='sahaiEnd'){reach(g,'sahaiFinalChoice');g.choose(0);readNext(g);returnAndArchive(g);assert.equal(wishTreeView(g.state).leaves.length,1);assert.equal(wishTreeView(g.state).cards.some(r=>r.wishText),false);}
 }
});
