import test from 'node:test';
import assert from 'node:assert/strict';
import { legacyStory as story } from '../dist/story.js';
import { Game,SaveStore,inTimeWindow,meets } from '../dist/engine-core.js';
const clone = x => JSON.parse(JSON.stringify(x));
const start = (source = story,seed = 12) => { const g = new Game(source,{ seed }); g.start(); return g; };
const direction = g => { g.markRead(); g.next(); g.markRead(); g.next(); g.markRead(); };
const resume = g => { for(let n=0;g.state.activeEvent && n<20;n++) { g.markRead(); g.next(); } assert.equal(g.state.activeEvent,null); };
const memory = () => { const m = new Map(); return { getItem:k=>m.get(k),setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k),m }; };

test('all new state starts neutral and inventory/location state uses canon data',() => {
  const g = start(); assert.equal(g.state.version,2);
  assert.deepEqual(Object.values(g.state.hidden),[0,0,0,0,0]);
  assert.deepEqual(g.state.inventory,{ goldBell:1 }); assert.deepEqual(g.state.unlockedLocations,['dunes']);
  assert.ok(g.validate(g.state)); assert.equal(g.canTravel(story.map[1]),false);
  g.next(); assert.equal(g.canTravel(story.map[1]),true);
});
test('read markers are only added after full text; trigger and read are distinct',() => {
  const g = start(); assert.equal(g.state.readEvents.includes('node:opening'),false);
  assert.equal(g.markRead(),true); assert.equal(g.markRead(),false);
  direction(g); g.choose(1);
  const id = g.state.activeEvent.id; assert.ok(g.state.onceEvents.includes(id));
  assert.equal(g.state.readEvents.includes(id),false); g.markRead(); assert.ok(g.state.readEvents.includes(id));
});
test('item prerequisite, time window, stats, all/any/not conditions',() => {
  const g = start(); direction(g); g.choose(1);
  assert.ok(g.state.flags.includes('bell-checked')); assert.equal(g.state.hidden.xunxu,1);
  const absent = start(); absent.state.inventory = {}; direction(absent); absent.choose(1);
  assert.equal(absent.state.onceEvents.includes('bell-present'),false);
  const lateStory = clone(story); lateStory.events = lateStory.events.filter(e=>e.forcedAt===undefined);
  const late = start(lateStory); late.state.minutes=1020; direction(late); late.choose(1);
  assert.equal(late.state.onceEvents.includes('bell-present'),false);
  assert.ok(meets(g.context(),{all:[{stats:{xunxu:{gte:1}}},{items:{goldBell:1}}],any:[{flags:['bell-checked']},{stats:{ap:0}}],not:{stats:{wish:{lt:0}}}}));
  assert.equal(meets(g.context(),{readEvents:['missing']}),false);
  assert.equal(meets(g.context(),{unlockedLocations:['station'],notFlags:['bell-checked']}),false);
});
test('daily windows include start, exclude end, and support crossing midnight',() => {
  assert.ok(inTimeWindow(900,{start:900,end:1020})); assert.equal(inTimeWindow(1020,{start:900,end:1020}),false);
  assert.ok(inTimeWindow(1440+20,{start:1380,end:60})); assert.equal(inTimeWindow(120,{start:1380,end:60}),false);
});
test('conditional private threshold fires once and hidden values clamp at boundaries',() => {
  const g = start(); assert.ok(g.debugEdit({hidden:{...g.state.hidden,yuejie:2}}).ok);
  assert.equal(g.state.hidden.rongAwareness,1); g.checkEvents(); assert.equal(g.state.hidden.rongAwareness,1);
  g.applyEffects({hidden:{wuImpression:-1000,xunxu:1000},items:{goldBell:-1},wish:3});
  assert.equal(g.state.hidden.wuImpression,-100); assert.equal(g.state.hidden.xunxu,100);
  assert.deepEqual(g.state.inventory,{}); assert.equal(g.state.wish,15);
});
test('mutually exclusive first impressions cannot both apply',() => {
  for(const [choice,expected] of [[0,1],[1,-1]]) {
    const g=start(); direction(g); g.choose(0); g.next(); g.choose(choice);
    assert.equal(g.state.hidden.wuImpression,expected);
    g.state.flags.push(choice===0?'approach-ribbon':'approach-listen');
    g.checkEvents(); assert.equal(g.state.hidden.wuImpression,expected);
    assert.equal(g.state.onceEvents.filter(x=>x.startsWith('first-')).length,1);
  }
});
test('weighted random samples only eligible positive weights and is persistent after restore',() => {
  const g=start(); direction(g); const before=g.snapshot(); g.choose(1);
  const result=g.state.activeEvent.id, seed=g.state.rngSeed;
  assert.ok(['wind-detail-a','wind-detail-b'].includes(result));
  const other=start(); assert.ok(other.restore(before)); other.choose(1);
  assert.equal(other.state.activeEvent.id,result); assert.equal(other.state.rngSeed,seed);
  const saved=g.snapshot(); const loaded=start(); assert.ok(loaded.restore(saved)); resume(loaded);
  loaded.checkEvents(); assert.equal(loaded.state.eventLog.filter(x=>x.id.startsWith('wind-detail')).length,1);
  assert.equal(loaded.state.rngSeed,seed);
  const source=clone(story); source.events.find(e=>e.id==='wind-detail-a').weight=0;
  const z=start(source); direction(z); z.choose(1); assert.equal(z.state.activeEvent.id,'wind-detail-b');
});
test('weighted random distribution includes both declared branches',() => {
  const source=clone(story), seen=new Set();
  for(let seed=0;seed<30;seed++) {
    const g=start(source,seed*1234567); direction(g); g.choose(1); seen.add(g.state.activeEvent.id);
  }
  assert.equal(seen.size,2);
});
test('a weighted pool selects only one result per entry even without an explicit mutex',() => {
  const source=clone(story); source.events=source.events.filter(e=>e.pool).map(e=>({...e,mutex:undefined,target:undefined}));
  const g=start(source); direction(g); g.choose(1);
  assert.equal(g.state.eventLog.length,1); const rng=g.state.rngSeed;
  g.checkEvents(); assert.equal(g.state.eventLog.length,1); assert.equal(g.state.rngSeed,rng);
});
test('fixed mainline preempts an action at the exact boundary, cannot be bypassed by map',() => {
  const g=start(); direction(g); g.choose(2); assert.equal(g.state.minutes,915);
  g.choose(2); assert.equal(g.state.minutes,930); assert.equal(g.state.node,'timedEncounter');
  assert.equal(g.canTravel(story.map[1]),false); assert.equal(g.choose(0),false);
  assert.equal(g.state.ap,3); resume(g); assert.equal(g.state.node,'ask');
  assert.ok(g.state.history.some(x=>x.node==='ask'));
  assert.equal(g.state.onceEvents.filter(x=>x==='fixed-encounter').length,1);
  assert.ok(g.validate(g.state));
});
test('forward clock jump stops at forced redirect; already read mainline suppresses repeat',() => {
  const g=start(); assert.ok(g.debugEdit({minutes:1000}).ok);
  assert.equal(g.state.minutes,930); assert.equal(g.state.node,'timedEncounter'); resume(g);
  g.choose(0); g.markRead();
  assert.ok(g.debugEdit({minutes:1000}).ok); assert.equal(g.state.minutes,1000); assert.equal(g.state.activeEvent,null);
});
test('multiple scheduled inserts preserve remaining time, chronology and saved interruption',() => {
  const source=clone(story);
  source.events=[{id:'second',title:'second',forcedAt:920,target:'asideWind',once:true},
    {id:'first',title:'first',forcedAt:910,target:'asideRuin',once:true}];
  const g=start(source); assert.ok(g.go({target:'opening',cost:{minutes:40,ap:1}}));
  assert.equal(g.state.minutes,910); assert.equal(g.state.activeEvent.id,'first'); assert.equal(g.state.pendingTransition.remainingMinutes,30);
  const record=g.snapshot(),other=start(source); assert.ok(other.restore(record));
  other.next(); assert.equal(other.state.minutes,920); assert.equal(other.state.activeEvent.id,'second');
  other.next(); assert.equal(other.state.minutes,940); assert.equal(other.state.node,'opening');
  assert.equal(other.state.ap,2); assert.deepEqual(other.state.eventLog.map(x=>x.id),['first','second']);
});
test('scheduled condition uses the trigger time, not the beginning of a long action',() => {
  const source=clone(story); source.events=[{id:'timed-window',title:'test',forcedAt:930,timeWindow:{start:925,end:935},target:'asideWind'}];
  const g=start(source); g.go({target:'opening',cost:{minutes:40}});
  assert.equal(g.state.minutes,930); assert.equal(g.state.activeEvent.id,'timed-window');
});
test('restoring overdue old saves enforces mainline once, and v1 migration is nondestructive',() => {
  const old={version:1,storyId:story.id,node:'direction',minutes:940,ap:1,wish:33,flags:['observed'],visited:['opening','wind','direction'],history:[{speaker:'narrator',text:'旧记录'}]};
  const store=memory(); store.setItem('yuangu-v1:1',JSON.stringify({savedAt:'2026-10-23T00:00:00Z',state:old}));
  const g=start(),ss=new SaveStore(g,store),record=ss.read('1'); assert.equal(record.state.version,2);
  assert.equal(record.state.wish,33); assert.equal(record.state.ap,1); assert.deepEqual(record.state.flags,['observed']);
  assert.equal(JSON.parse(store.getItem('yuangu-v1:1')).state.version,1);
  g.restore(record.state); assert.equal(g.state.activeEvent.id,'fixed-encounter'); assert.equal(g.state.minutes,940);
  assert.equal(g.state.history[0].text,'旧记录'); assert.ok(ss.write('1')); assert.equal(JSON.parse(store.getItem('yuangu-v1:1')).state.version,2);
  const end={...old,node:'end',visited:['opening','wind','station','ask','lily','end']};
  assert.ok(g.restore(end)); assert.equal(g.state.activeEvent,null);
});
test('all new state survives save/load, including inventory, unlocks, hidden, once, locks, RNG and unread event',() => {
  const g=start(); direction(g); g.choose(1); const before=g.snapshot();
  const store=memory(),ss=new SaveStore(g,store); assert.ok(ss.write('2')); resume(g);
  assert.ok(g.restore(ss.read('2').state)); assert.deepEqual(g.state,before); assert.ok(g.validate(g.state));
});
test('debug invalid input is transactional, backward time retains once flags, active insert rejects time edit',() => {
  const g=start(),before=g.snapshot(); assert.equal(g.debugEdit({ap:-1}).ok,false); assert.deepEqual(g.state,before);
  direction(g); g.choose(1); assert.equal(g.debugEdit({minutes:960}).ok,false); assert.equal(g.state.minutes,905);
  resume(g); const flags=[...g.state.onceEvents]; assert.ok(g.debugEdit({minutes:900}).ok);
  assert.deepEqual(g.state.onceEvents,flags);
});
test('clear deletes only this game saves and leaves text speed and other applications untouched',() => {
  const store=memory(),g=start(),ss=new SaveStore(g,store);
  for(const slot of ['auto','1','2','3']) ss.write(slot);
  store.setItem('yuangu-speed','16'); store.setItem('other-app','keep');
  assert.ok(ss.clear()); assert.equal(ss.latest(),null); assert.equal(store.getItem('yuangu-speed'),'16'); assert.equal(store.getItem('other-app'),'keep');
});
