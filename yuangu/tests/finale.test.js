import test from 'node:test';
import assert from 'node:assert/strict';
import {story} from '../dist/story.js';
import {Game,SaveStore} from '../dist/engine-core.js';
import {wishTreeView} from '../dist/wish-tree.js';
const start=()=>{const g=new Game({...story,start:'sahaiEnd',initial:{...story.initial,minutes:900,wish:12,ap:0,flags:['chapter-sahai','sandstorm-started','tutorial-wish-collected'],unlockedLocations:Object.keys(story.scenes)}},{seed:7});g.start();g.state.readEvents.push('node:sahaiLily');return g;};
const reach=(g,id)=>{for(let i=0;g.state.node!==id&&i<20;i++){g.markRead();assert.ok(g.next());}assert.equal(g.state.node,id);};
test('the old ending checkpoint now proceeds through planting and an unexplained thread without changing collected totals',()=>{
 const g=start();reach(g,'sahaiBloom');assert.ok(g.state.flags.includes('lily-planted'));assert.ok(g.state.flags.includes('lily-fulfilled'));
 let card=wishTreeView(g.state).cards.find(c=>c.id==='lily');assert.ok(card.fulfilled);assert.equal(card.collected,false);assert.equal(card.wishText,'我想亲眼看看铃兰花。');
 reach(g,'sahaiFinalChoice');assert.ok(g.state.flags.includes('lily-thread-attached'));assert.equal(g.state.wish,12);assert.equal(g.state.ap,0);assert.equal(g.state.minutes,900);
 assert.equal(story.nodes.sahaiCall.speaker,'rong');assert.equal(story.nodes.sahaiCall.text,'过来。');assert.equal(g.node.choices.length,4);
 const texts=Object.values(story.nodes).filter(n=>['sahaiPalm','sahaiSeed','sahaiBloom','sahaiThread','sahaiOutside','sahaiCall','sahaiFinalChoice'].includes(Object.keys(story.nodes).find(id=>story.nodes[id]===n))).map(n=>n.text).join('');assert.doesNotMatch(texts,/诅咒|无昼|肋骨|初代|轮回/);
});
for(const [index,flag,stat,value] of [[0,'ending-walk','xunxu',2],[1,'ending-lookback','wuImpression',2],[2,'ending-protect','yuejie',2],[3,'ending-ask','rongAwareness',1]])test(`${flag}: final choice is exclusive, saved immediately, and reaches the black title card`,()=>{
 const g=start();reach(g,'sahaiFinalChoice');const choices=g.node.choices;g.choose(index);assert.ok(g.state.flags.includes(flag));assert.equal(g.state.hidden[stat],value);assert.ok(choices.every(c=>!g.can(c)));
 const state=g.snapshot(),h=start();assert.ok(h.restore(state));assert.deepEqual(h.state,state);g.markRead();g.next();assert.equal(g.state.node,'previewEnd');assert.ok(g.node.endCard);assert.ok(g.state.flags.includes('preview-complete'));assert.equal(g.next(),false);
 if(index===2){assert.equal(g.state.hidden.rongAwareness,1);assert.ok(g.state.flags.includes('lily-protected'));}
 const before=g.state.wish;assert.ok(g.go(story.postludeAction));g.choose(0);g.next();assert.equal(g.state.wish,before);const view=wishTreeView(g.state);assert.equal(view.leaves.length,1);assert.equal(view.leaves[0].cards.some(c=>c.id==='lily'),false);assert.ok(view.cards.find(c=>c.id==='lily').status.startsWith('已回应'));
});
