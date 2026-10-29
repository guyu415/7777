// 通用状态 / 事件引擎。无 DOM、无网络；规则与文本全部来自剧情数据。
const copy = value => JSON.parse(JSON.stringify(value));
const unique = values => [...new Set(values)];
const own = (obj,key) => Object.hasOwn(obj,key);
const stringList = v => Array.isArray(v) && v.length <= 5000 && v.every(x => typeof x === 'string' && x.length <= 200);
const integer = (v,min = 0,max = 1e7) => Number.isSafeInteger(v) && v >= min && v <= max;

export function inTimeWindow(minutes,window) {
  if (!window) return true;
  const t = minutes % 1440, { start,end } = window;
  return start <= end ? t >= start && t < end : t >= start || t < end;
}
export function meets(state,c = {}) {
  if (!state) return false;
  if (c.all && !c.all.every(x => meets(state,x))) return false;
  if (c.any && !c.any.some(x => meets(state,x))) return false;
  if (c.not && meets(state,c.not)) return false;
  if (c.nodes && !c.nodes.includes(state.node)) return false;
  if (c.scenes && !c.scenes.includes(state.scene)) return false;
  if (!inTimeWindow(state.minutes,c.time)) return false;
  for (const [key,rule] of Object.entries(c.stats || {})) {
    const v = own(state.hidden || {},key) ? state.hidden[key] : state[key];
    if (!Number.isFinite(v)) return false;
    if (typeof rule === 'number') { if (v !== rule) return false; }
    else if ((rule.eq !== undefined && v !== rule.eq) || (rule.gte !== undefined && v < rule.gte) ||
      (rule.lte !== undefined && v > rule.lte) || (rule.gt !== undefined && v <= rule.gt) || (rule.lt !== undefined && v >= rule.lt)) return false;
  }
  for (const [key,count] of Object.entries(c.items || {})) if ((state.inventory[key] || 0) < count) return false;
  for (const key of ['flags','readEvents','onceEvents','unlockedLocations']) {
    if (c[key] && !c[key].every(x => state[key].includes(x))) return false;
    const inverse = `not${key[0].toUpperCase()}${key.slice(1)}`;
    if (c[inverse] && c[inverse].some(x => state[key].includes(x))) return false;
  }
  return true;
}
export class Game {
  constructor(story,{ seed } = {}) { this.story = story; this.state = null; this.seed = seed; }
  start() {
    const i = this.story.initial;
    this.state = { version: 2,storyId: this.story.id,node: this.story.start,minutes: i.minutes,ap: i.ap,wish: i.wish,
      hidden: Object.fromEntries(Object.entries(this.story.hiddenStats || {}).map(([k,c]) => [k,c.initial || 0])),
      inventory: copy(i.inventory || {}),unlockedLocations: [...(i.unlockedLocations || [this.story.nodes[this.story.start].scene])],
      flags: [...(i.flags || [])],visited: [],history: [],readEvents: [],onceEvents: [],eventLocks: {},eventLog: [],
      rngSeed: this.seed ?? ((Date.now() ^ Math.floor(Math.random()*0xFFFFFFFF)) >>> 0),
      entrySerial: 0,activeEvent: null,pendingTransition: null };
    this.enter(this.story.start); this.checkEvents(); return this.state;
  }
  get node() { return this.state && this.story.nodes[this.state.node]; }
  get events() { return this.story.events || []; }
  get isExploration() { return !!this.state?.flags.includes(this.story.exploration?.flag); }
  get map() { return this.story.legacyMap && !this.isExploration ? this.story.legacyMap : this.story.map; }
  resolveAction(action) {
    return action?.until === undefined || !this.state ? action : { ...action,cost: { ...action.cost,minutes: Math.max(0,action.until-this.state.minutes) } };
  }
  context() { return this.state && { ...this.state,scene: this.node.scene }; }
  record() {
    if (!this.state.visited.includes(this.state.node)) this.state.visited.push(this.state.node);
    this.state.history.push({ speaker: this.node.speaker,text: this.node.text,node: this.state.node });
    this.state.history = this.state.history.slice(-100);
  }
  enter(target,{ event = false,record = true } = {}) {
    this.state.node = target; if (!event) this.state.entrySerial++; if (record) this.record();
  }
  markRead() {
    const ids = [`node:${this.state.node}`]; if (this.state.activeEvent) ids.push(this.state.activeEvent.id);
    const before = this.state.readEvents.length; this.state.readEvents = unique([...this.state.readEvents,...ids]);
    return before !== this.state.readEvents.length;
  }
  can(action) {
    action = this.resolveAction(action);
    if (!this.state || this.state.activeEvent || !action || !own(this.story.nodes,action.target)) return false;
    if (action.once && this.state.flags.includes(action.once)) return false;
    if (action.mutex && own(this.state.eventLocks,action.mutex)) return false;
    if (!meets(this.context(),action.when) || !meets(this.context(),{ items: action.requiresItems,time: action.timeWindow })) return false;
    if (!integer(action.cost?.ap || 0,0,1000) || !integer(action.cost?.minutes || 0)) return false;
    if (this.state.ap < (action.cost?.ap || 0) || this.state.minutes + (action.cost?.minutes || 0) > 1e7) return false;
    const destination = this.story.nodes[action.target].scene;
    return destination === this.node.scene || this.state.unlockedLocations.includes(destination);
  }
  applyEffects(e = {}) {
    const s = this.state;
    for (const key of ['ap','wish']) if (e[key] !== undefined) s[key] = Math.min(key === 'ap' ? 1000 : 1e6,Math.max(0,s[key]+e[key]));
    for (const [key,delta] of Object.entries(e.hidden || {})) {
      const c = this.story.hiddenStats?.[key]; if (c) s.hidden[key] = Math.max(c.min,Math.min(c.max,s.hidden[key]+delta));
    }
    for (const [key,delta] of Object.entries(e.items || {})) {
      if (!own(this.story.items || {},key)) continue;
      const count = Math.min(999,Math.max(0,(s.inventory[key] || 0)+delta));
      if (count) s.inventory[key] = count; else delete s.inventory[key];
    }
    s.flags = unique([...s.flags,...(e.flags || [])]).filter(x => !e.removeFlags?.includes(x));
    s.unlockedLocations = unique([...s.unlockedLocations,...(e.unlock || [])]).filter(x => !e.lock?.includes(x));
    s.unlockedLocations = unique([...s.unlockedLocations,this.node.scene]);
  }
  go(action) {
    action = this.resolveAction(action);
    if (!this.can(action)) return false;
    if (this.checkDueNow()) return true;
    this.state.ap -= action.cost?.ap || 0;
    if (action.once) this.state.flags.push(action.once);
    if (action.mutex) this.state.eventLocks[action.mutex] = action.id || `choice:${action.once || action.target}`;
    this.applyEffects(action.effects);
    this.state.pendingTransition = { target: action.target,remainingMinutes: action.cost?.minutes || 0 };
    this.settleTransition(); return true;
  }
  next() {
    if (!this.state) return false;
    if (this.node.resume && this.state.activeEvent) {
      this.markRead(); const { returnNode,id } = this.state.activeEvent;
      const redirect = !!this.events.find(e => e.id === id)?.resumeTo; this.state.activeEvent = null;
      if (this.state.pendingTransition) this.settleTransition();
      else { this.enter(returnNode,{ event: !redirect,record: redirect }); this.checkEvents(); }
      return true;
    }
    if (this.checkDueNow()) return true;
    return this.node.next ? this.go({ target: this.node.next }) : false;
  }
  choose(index) { return this.go(this.node?.choices?.[index]); }
  canTravel(place) { return !!this.state && this.state.unlockedLocations.includes(place.scene) && !!place.from?.includes(this.node?.scene) && this.can(place); }
  travel(place) { return this.canTravel(place) && this.go(place); }
  eligible(event,minutes = this.state?.minutes) {
    if (!this.state || this.state.activeEvent) return false;
    if ((event.once !== false || event.forcedAt !== undefined) && this.state.onceEvents.includes(event.id)) return false;
    if (event.mutex && own(this.state.eventLocks,event.mutex)) return false;
    if (this.state.eventLog.some(x => x.id === event.id && x.entry === this.state.entrySerial)) return false;
    if (event.pool && this.state.eventLog.some(x => x.entry === this.state.entrySerial && this.events.find(e => e.id === x.id)?.pool === event.pool)) return false;
    const context = { ...this.context(),minutes };
    const pending = this.state.pendingTransition;
    // 边界恰好是到达时刻时，按目的地筛选主线，而非按出发地。
    if (pending && minutes >= this.state.minutes+pending.remainingMinutes) {
      context.node = pending.target; context.scene = this.story.nodes[pending.target].scene;
    }
    return meets(context,event.when) && meets(context,{ items: event.requiresItems,time: event.timeWindow });
  }
  dueBefore(deadline) {
    return this.events.filter(e => e.forcedAt !== undefined && e.forcedAt <= deadline && this.eligible(e,Math.max(this.state.minutes,e.forcedAt)))
      .sort((a,b) => a.forcedAt-b.forcedAt || (b.priority || 0)-(a.priority || 0))[0];
  }
  fireEvent(event) {
    if (event.once !== false || event.forcedAt !== undefined) this.state.onceEvents.push(event.id);
    if (event.mutex) this.state.eventLocks[event.mutex] = event.id;
    this.state.eventLog.push({ id: event.id,minutes: this.state.minutes,entry: this.state.entrySerial });
    this.state.eventLog = this.state.eventLog.slice(-200); this.applyEffects(event.effects);
    if (!event.target) { this.state.readEvents = unique([...this.state.readEvents,event.id]); return false; }
    const returnNode = event.resumeTo || this.state.node;
    if (event.resumeTo) this.state.pendingTransition = null;
    this.state.activeEvent = { id: event.id,returnNode }; this.enter(event.target,{ event: true }); return true;
  }
  settleTransition() {
    let iterations = 0;
    while (this.state.pendingTransition && iterations++ < this.events.length+2) {
      const p = this.state.pendingTransition, forced = this.dueBefore(this.state.minutes+p.remainingMinutes);
      if (forced) {
        const step = Math.max(0,forced.forcedAt-this.state.minutes);
        const arrived = step === p.remainingMinutes;
        this.state.minutes += step; p.remainingMinutes -= step;
        if (arrived) this.enter(p.target);
        if (this.fireEvent(forced)) return; continue;
      }
      this.state.minutes += p.remainingMinutes; this.state.pendingTransition = null;
      this.enter(p.target); this.checkEvents(); return;
    }
  }
  checkDueNow() {
    if (!this.state || this.state.activeEvent || !this.dueBefore(this.state.minutes)) return false;
    this.state.pendingTransition ||= { target: this.state.node,remainingMinutes: 0 }; this.settleTransition(); return true;
  }
  random() {
    this.state.rngSeed = (Math.imul(1664525,this.state.rngSeed)+1013904223) >>> 0;
    return this.state.rngSeed/0x100000000;
  }
  checkEvents() {
    if (!this.state || this.state.activeEvent) return false;
    if (this.checkDueNow()) return true;
    let changed = false;
    for (let step = 0; step < this.events.length; step++) {
      const candidates = this.events.filter(e => e.forcedAt === undefined && this.eligible(e) && (!e.pool || (e.weight ?? 1) > 0))
        .sort((a,b) => (b.priority || 0)-(a.priority || 0));
      if (!candidates.length) break;
      let selected = candidates[0];
      if (selected.pool) {
        const pool = candidates.filter(e => e.pool === selected.pool);
        let roll = this.random()*pool.reduce((sum,e) => sum+(e.weight ?? 1),0);
        selected = pool[pool.length-1];
        for (const event of pool) { roll -= event.weight ?? 1; if (roll < 0) { selected = event; break; } }
      }
      changed = true; if (this.fireEvent(selected)) return true;
    }
    return changed;
  }
  eventStatus(event) {
    if (!this.state) return '尚未开始';
    if (this.state.onceEvents.includes(event.id)) return '已触发';
    if (event.mutex && own(this.state.eventLocks,event.mutex)) return '互斥锁定';
    if (this.state.activeEvent) return '等待当前事件结束';
    if (!this.eligible(event)) return '条件不满足 / 本次已检查';
    if (event.forcedAt !== undefined && event.forcedAt > this.state.minutes) return '等待指定时刻';
    return '可触发';
  }
  debugEdit({ minutes = this.state?.minutes,ap = this.state?.ap,wish = this.state?.wish,
    hidden = this.state?.hidden,inventory = this.state?.inventory,unlockedLocations = this.state?.unlockedLocations } = {}) {
    if (!this.state) return { ok: false,reason: '请先开始或读取游戏。' };
    if (this.state.activeEvent && minutes !== this.state.minutes) return { ok: false,reason: '先读完当前插入事件，再调整时辰。' };
    const previous = this.snapshot();
    const candidate = { ...previous,minutes,ap,wish,hidden,inventory,unlockedLocations: unique([...unlockedLocations,this.node.scene]) };
    if (!this.validateV2(candidate)) return { ok: false,reason: '数值或状态无效，请检查输入范围。' };
    this.state = copy(candidate);
    if (!this.state.activeEvent && minutes > previous.minutes) {
      this.state.minutes = previous.minutes;
      this.state.pendingTransition = { target: previous.node,remainingMinutes: minutes-previous.minutes }; this.settleTransition();
    } else if (!this.state.activeEvent) this.checkEvents();
    return { ok: true };
  }
  snapshot() { return copy(this.state); }
  validateBase(s) {
    return !!s && s.storyId === this.story.id && own(this.story.nodes,s.node) && integer(s.minutes) && integer(s.ap,0,1000) && integer(s.wish,0,1e6) &&
      stringList(s.flags) && stringList(s.visited) && s.visited.every(x => own(this.story.nodes,x)) &&
      Array.isArray(s.history) && s.history.length <= 100 && s.history.every(x => x && own(this.story.characters,x.speaker) && typeof x.text === 'string' && x.text.length <= 5000);
  }
  validateV2(s) {
    if (!this.validateBase(s) || s.version !== 2) return false;
    if (!s.hidden || Object.keys(s.hidden).length !== Object.keys(this.story.hiddenStats || {}).length ||
      !Object.entries(this.story.hiddenStats || {}).every(([k,c]) => integer(s.hidden[k],c.min,c.max))) return false;
    if (!s.inventory || typeof s.inventory !== 'object' || Array.isArray(s.inventory) ||
      !Object.entries(s.inventory).every(([k,n]) => own(this.story.items || {},k) && integer(n,1,999))) return false;
    if (!['readEvents','onceEvents','unlockedLocations'].every(k => stringList(s[k]) && unique(s[k]).length === s[k].length)) return false;
    if (!s.unlockedLocations.every(x => own(this.story.scenes,x)) || !s.unlockedLocations.includes(this.story.nodes[s.node].scene)) return false;
    if (!s.eventLocks || typeof s.eventLocks !== 'object' || Array.isArray(s.eventLocks) || !Object.values(s.eventLocks).every(x => typeof x === 'string')) return false;
    if (!integer(s.rngSeed,0,0xFFFFFFFF) || !integer(s.entrySerial)) return false;
    if (!Array.isArray(s.eventLog) || s.eventLog.length > 200 || !s.eventLog.every(x => x && this.events.some(e => e.id === x.id) && integer(x.minutes) && integer(x.entry))) return false;
    if (s.activeEvent !== null && (!s.activeEvent || !this.events.some(e => e.id === s.activeEvent.id && e.target === s.node) || !own(this.story.nodes,s.activeEvent.returnNode))) return false;
    if (s.pendingTransition !== null && (!s.pendingTransition || !own(this.story.nodes,s.pendingTransition.target) || !integer(s.pendingTransition.remainingMinutes) ||
      s.minutes+s.pendingTransition.remainingMinutes > 1e7 || !s.activeEvent)) return false;
    if (this.story.nodes[s.node].resume && !s.activeEvent) return false;
    return true;
  }
  normalise(s) {
    if (s?.version === 2) return this.validateV2(s) ? copy(s) : null;
    if (s?.version !== 1 || !this.validateBase(s)) return null;
    const unlocked = unique([...(this.story.initial.unlockedLocations || []),this.story.nodes[s.node].scene,
      ...(s.visited.some(id => ['wind','direction','observe'].includes(id)) ? ['station'] : [])]);
    const migrated = { ...copy(s),version: 2,
      hidden: Object.fromEntries(Object.entries(this.story.hiddenStats || {}).map(([k,c]) => [k,c.initial || 0])),
      inventory: copy(this.story.initial.inventory || {}),unlockedLocations: unlocked,
      readEvents: unique(s.visited.filter(id => id !== s.node).map(id => `node:${id}`)),onceEvents: [],eventLocks: {},eventLog: [],
      rngSeed: 123456789,entrySerial: s.visited.length,activeEvent: null,pendingTransition: null };
    return this.validateV2(migrated) ? migrated : null;
  }
  validate(s) { return !!this.normalise(s); }
  restore(s) { const state = this.normalise(s); if (!state) return false; this.state = state; this.checkDueNow(); return true; }
}
export const MANUAL_SLOTS=Array.from({length:12},(_,i)=>String(i+1));
export const SAVE_SLOTS=['auto',...MANUAL_SLOTS];
export class SaveStore {
  constructor(game,storage,onError = () => {}) { this.game = game; this.storage = storage; this.onError = onError; }
  key(slot) { return `yuangu-v1:${slot}`; }
  read(slot) {
    try {
      const raw = this.storage.getItem(this.key(slot)); if (!raw) return null;
      const record = JSON.parse(raw),state = this.game.normalise(record.state);
      return state && typeof record.savedAt === 'string' && Number.isFinite(Date.parse(record.savedAt)) ? { ...record,state } : null;
    } catch { return null; }
  }
  write(slot) {
    try {
      if (!this.game.validate(this.game.state)) throw Error('Invalid state');
      this.storage.setItem(this.key(slot),JSON.stringify({ savedAt: new Date().toISOString(),state: this.game.snapshot() })); return true;
    } catch { this.onError('进度保存失败，请检查浏览器网站存储是否可用。'); return false; }
  }
  clear() {
    try { for (const slot of SAVE_SLOTS) this.storage.removeItem(this.key(slot));
      for(const key of ['yuangu-v1:read',...(this.game.story.chapters||[]).map(c=>`yuangu-v1:chapter-${c.id}`)])this.storage.removeItem(key); this.onClear?.();return true; }
    catch { this.onError('存档未能全部清空，请检查网站存储权限。'); return false; }
  }
  latest() {
    return SAVE_SLOTS.map(slot => this.read(slot)).filter(Boolean).sort((a,b) => Date.parse(b.savedAt)-Date.parse(a.savedAt))[0] || null;
  }
}
