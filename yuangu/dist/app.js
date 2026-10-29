import {Playback,ReadLedger,ChapterStore,chapters,linearNode,readPreferences} from './vn-controls.js?v=19';
import {installSound} from './sound.js?v=22';
import {musicForScene} from './music-cues.js?v=22';
import { story } from './story.js?v=10';
import { createCourtScenery } from './court-scenery.js?v=10';
import { installTreePanel } from './tree-panel.js?v=16';
import { wishTreeView } from './wish-tree.js?v=10';
import { Game, SaveStore,MANUAL_SLOTS,meets } from './engine-core.js?v=10';
import { installDebug } from './debug-panel.js?v=10';
import { characterView } from './character-art.js?v=15';
import { sceneView } from './scene-art.js?v=18';
import {atlasPoints,collectionDelta} from './cinematic-art.js?v=18';
import {installWishEffects} from './wish-effects.js?v=18';
import {installInkStill,inkStillBoundary} from './ink-still.js?v=21';
import {installTouchEffects} from './touch-effects.js?v=22';

const $ = id => document.getElementById(id);
const game = new Game(story);
const modal = $('modal');
const wishEffects=installWishEffects($('wish-effects'),$('game-screen'),$('scene-background'));
let toastTimer, typeTimer, typed = false, speed = 34, onTitle = true, previousFocus, currentWasRead=false, baseHint='点击继续 ◇';
let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw Error('Storage unavailable'); }, removeItem: () => { throw Error('Storage unavailable'); } }; }
const saves = new SaveStore(game, storage, toast);
try { const s = Number(storage.getItem('yuangu-speed')); if ([60, 34, 16, 0].includes(s) && storage.getItem('yuangu-speed') !== null) speed = s; } catch { /* keep default */ }
const ledger=new ReadLedger(story,storage),chapterStore=new ChapterStore(game,storage),preferences=readPreferences(storage);
const sound=installSound({music:$('ambient-audio'),nextMusic:$('next-music-audio'),effect:$('ui-audio'),optionEffect:$('option-audio'),collectionEffect:$('collection-audio'),preferences,onChange:updateMusicControls});
function updateMusicControls(state){
  const enabled=!!preferences.bgm||!!preferences.sound;
  $('title-audio-toggle').textContent=!enabled?'声音 · 已关闭':!state.unlocked||state.blocked?'点击开启声音':'声音 · 已开启';
  $('title-audio-toggle').setAttribute('aria-pressed',String(enabled&&state.unlocked&&!state.blocked));
  $('music-status').textContent=!preferences.bgm?'背景音乐已关闭':state.paused?'音乐已暂停':!state.unlocked||state.blocked?'点击页面后开启音乐':`背景音乐：${state.name}`;
}
function persistAudio(){try{storage.setItem('yuangu-v1:preferences',JSON.stringify(preferences));}catch{}sound.apply();}
const playback=new Playback({step:()=>advance('playback'),blocked:()=>onTitle||modal.open||inkStill.active||document.hidden||$('game-screen').classList.contains('ui-hidden'),onMode:updatePlaybackControls});
const inkStill=installInkStill({root:$('ink-still'),canvas:$('ink-still-canvas'),image:$('ink-still-painting'),screen:$('game-screen')});
const touchEffects=installTouchEffects({root:$('pointer-fx-layer'),canvas:$('pointer-fx-canvas'),
  canHold:()=>!!game.state&&!onTitle&&!modal.open&&!inkStill.active&&!document.hidden&&!$('game-screen').classList.contains('ui-hidden')&&currentWasRead&&linearNode(game.node,game.state),
  onHoldStart:()=>{playback.stop();if(!playback.setMode('skip'))return false;finishTyping();schedulePlayback();return true;},
  onHoldStop:()=>playback.stop()});
saves.onClear=()=>{ledger.nodes.clear();chapterStore.clear();playback.stop();};
function updatePlaybackControls(){
  if(!$('auto-play'))return;
  $('auto-play').setAttribute('aria-pressed',String(playback.mode==='auto'));
  $('skip-read').setAttribute('aria-pressed',String(playback.mode==='skip'));
  const can=!!game.state&&linearNode(game.node,game.state)&&!onTitle;
  $('auto-play').disabled=!can;$('skip-read').disabled=!can||!currentWasRead;
  if(typed&&game.state&&!onTitle){const t=$('text'),waiting=t.scrollHeight>t.clientHeight+t.scrollTop+2;
    $('advance-hint').textContent=playback.mode==='auto'?(waiting?'自动等待正文末尾 ↓':'自动播放 · 点击停止 ◇'):playback.mode==='skip'?'仅快进已读 · 点击停止 ◇':waiting?'向下滑动查看全文 ↓':baseHint;
  }
}
function schedulePlayback(){
  if(!game.state)return;const text=$('text');
  playback.ready({typed,atBottom:text.scrollHeight<=text.clientHeight+text.scrollTop+2,delay:Math.max(preferences.autoDelay,Math.min(8000,game.node.text.length*38))});updatePlaybackControls();
}
function togglePlayback(mode){
  if(playback.mode===mode){playback.stop();return;}
  if(!playback.setMode(mode)){toast(mode==='skip'?'只可快进已读的连续对话。':'请在连续对话中开启自动播放。');return;}
  if(mode==='skip')finishTyping();schedulePlayback();
}
function hideInterface(){
  if(onTitle||!game.state||game.node.endCard)return;wishEffects.stop();sound.stopCollection();playback.stop();finishTyping();$('game-screen').classList.add('ui-hidden');$('ui-restore').hidden=false;$('ui-restore').focus();
}
function restoreInterface(){ $('game-screen').classList.remove('ui-hidden');$('ui-restore').hidden=true; }
function renderEndCard(){
  wishEffects.stop();sound.stopCollection();
  playback.stop();typed=true;$('game-screen').hidden=true;$('ending-screen').hidden=false;sound.select('quiet');sound.silence(document.hidden);
  ledger.remember(game.state.node);if(game.markRead())autoSave();
}
function element(tag, className, text) {
  const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el;
}
function button(label, className, action, disabled = false) {
  const el = element('button', className, label); el.type = 'button'; el.disabled = disabled; el.addEventListener('click', action); return el;
}
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
}
function clock(minutes) { const m = minutes % 1440; return `${String(Math.floor(m / 60)).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`; }
function shichen(minutes) { return ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'][Math.floor(((minutes % 1440 + 60) % 1440) / 120)] + '时'; }
function updateContinue() {
  const record = saves.latest(); $('continue-game').disabled = !record;
  $('continue-note').textContent = record ? `${story.scenes[story.nodes[record.state.node].scene].name} · ${clock(record.state.minutes)}` : '尚无记录';
}
function autoSave() {
  const ok = saves.write('auto'); $('save-indicator').textContent = ok ? '◇ 进度已自动保存' : '进度未保存'; updateContinue();
}
function showTitle() {
  touchEffects.cancelHold();
  inkStill.cancel();
  wishEffects.stop();sound.stopCollection();
  playback.stop();restoreInterface();$('ending-screen').hidden=true;$('game-screen').hidden=false;sound.select('opening');sound.silence(document.hidden);clearTimeout(typeTimer); onTitle = true; $('title-screen').hidden = false; $('game-screen').hidden = true;
  $('landscape').className = 'landscape'; updateContinue();
}
function showGame() { onTitle = false; $('ending-screen').hidden=true; restoreInterface(); $('title-screen').hidden = true; $('game-screen').hidden = false; render(); }
function render() {
  inkStill.cancel();
  wishEffects.stop();sound.stopCollection();
  clearTimeout(typeTimer); typed = false; restoreInterface();
  ledger.ingest(game.state);chapterStore.capture();currentWasRead=ledger.has(game.state.node);
  playback.enter({id:game.state.node,wasRead:currentWasRead,linear:linearNode(game.node,game.state)});updatePlaybackControls();
  if(game.node.endCard){renderEndCard();return;}
  $('ending-screen').hidden=true;$('game-screen').hidden=false;
  const node = game.node, scene = story.scenes[node.scene], who = story.characters[node.speaker];
  sound.select(musicForScene(game.state.node,node,{returned:game.state.flags.includes('court-returned')}));sound.silence(document.hidden);
  const scenic=sceneView(game.state.node,node);
  $('game-screen').classList.toggle('cg-mode',!!scenic.cg);$('game-screen').dataset.cg=scenic.cg?.kind||'';
  $('cg-painting').hidden=!scenic.cg;if(scenic.cg&&$('cg-painting').getAttribute('src')!==scenic.src)$('cg-painting').src=scenic.src;
  if($('scene-background').getAttribute('src')!==scenic.src)$('scene-background').src=scenic.src;
  $('scene-background').alt=scenic.cg?.alt||scene.name;$('game-screen').dataset.storm=String(scenic.storm);
  wishEffects.enter(scenic.cg?.kind);
  for(const file of game.state.node==='prologueCollect'?['cg-collection.png']:game.state.node==='sahaiPalm'?['cg-lily.png','cg-thread.png']:[]){const preload=new Image();preload.src=`./assets/scenes/${file}`;}
  if(['sahaiPalm','sahaiSeed','sahaiBloom'].includes(game.state.node))inkStill.preload();
  $('game-screen').classList.toggle('court-mode',node.scene==='upperCourt');
  $('game-screen').classList.toggle('free-activity',!!node.courtHub||!!node.exploreHub);
  $('chapter-title').textContent = game.isExploration ? (node.scene==='upperCourt' ? (game.state.flags.includes('court-returned')?'归庭 · 初叶':'上庭初行') : game.state.flags.includes('prologue-active') ? '上庭初行' : '沙海初愿') : '风起沙海';
  $('chapter-kind').textContent = '序章';
  $('chapter-code').textContent = game.isExploration ? 'PROLOGUE / FIRST DESCENT' : 'PROLOGUE / 01';
  $('chapter-hint').textContent = node.scene==='upperCourt' ? (game.state.flags.includes('court-returned')?'愿力归树 · 本轮行迹':'愿力树下 · 自由查看') : game.isExploration ? (game.state.flags.includes('prologue-active') ? '初次下凡 · 战后愿力' : game.state.flags.includes('sandstorm-started') ? '沙海 · 风起' : '日落前 · 完成外围巡视') : '';
  $('landscape').className = `landscape ${scene.kind}`;
  $('location').textContent = scene.name; $('scene-subtitle').textContent = node.scene==='upperCourt'&&game.state.flags.includes('court-returned')?'归庭':scene.subtitle;
  $('time-stat').replaceChildren(document.createTextNode(`第${Math.floor(game.state.minutes / 1440) + 1}日 · ${shichen(game.state.minutes)}`), element('b','',clock(game.state.minutes)));
  $('ap-stat').replaceChildren(document.createTextNode('剩余行动点'), element('b','',String(game.state.ap)));
  $('wish-stat').replaceChildren(document.createTextNode('已收取愿力'), element('b','',String(game.state.wish)));
  if (game.state.activeEvent && story.events.find(e => e.id === game.state.activeEvent.id)?.forcedAt !== undefined) $('scene-subtitle').textContent += ' · 主线';
  $('speaker').textContent = who.name; $('speaker').dataset.color = who.color;
  $('game-screen').dataset.speakerSide = node.speaker === 'yuan' ? 'right' : 'left';
  $('actor').hidden = !node.actor;
  if (node.actor) { $('actor').dataset.actor = node.actor; $('actor-name').textContent = story.characters[node.actor].name; }
  $('choices').hidden = true; $('choices').replaceChildren(); $('end-actions').hidden = true; renderCourt(); renderExploration();renderCharacters();
  $('text').textContent = ''; $('text').scrollTop=0; $('advance-hint').textContent = '点击显示全文 ◇';
  $('dialogue').setAttribute('aria-label', '显示本句全文');
  const chars = Array.from(node.text); let index = 0;
  function tick() {
    if (onTitle) return;
    index++; $('text').textContent = chars.slice(0,index).join('');
    if (index < chars.length) typeTimer = setTimeout(tick,speed); else finishTyping();
  }
  if ((playback.mode==='skip'&&currentWasRead) || speed === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) finishTyping(); else tick();
}
function renderCharacters(){
  const view=characterView(game.state.node,game.node);
  for(const [id,art] of [['main-character',view.main],['player-character',view.player],['court-character',view.ambient]]){
    const image=$(id);image.hidden=!art;if(!art)continue;
    if(image.getAttribute('src')!==art.src)image.src=art.src;
    image.alt=art.alt;image.dataset.actor=art.actor;image.dataset.expression=art.expression;
  }
}
function finishTyping() {
  if (!game.state || onTitle || typed) return;
  clearTimeout(typeTimer); typed = true; const node = game.node;
  ledger.remember(game.state.node);if (game.markRead()) autoSave();
  $('text').textContent = node.text;
  baseHint = node.courtHub ? '点击场景中的物件与人物 ◇' : node.exploreHub ? '调查此处，或打开地图移动 ◇' : node.choices?.length ? '请选择接下来的行动 ◇' : node.end ? '本次演示结束 ◇' : '点击继续 ◇';
  $('dialogue').setAttribute('aria-label', node.courtHub ? '上庭场景，请选择可交互目标' : node.choices?.length ? '对话已完成，请选择行动' : node.end ? '演示片段已结束' : '继续对话');
  $('choices').replaceChildren();
  if (node.choices?.length) {
    const currentNode = game.state.node; let displayIndex=0;
    node.choices.forEach((choice,i) => {
      if(choice.conditional && !game.can(choice))return;
      const el = button('', 'choice', () => {
        if (game.state.node !== currentNode || !typed || modal.open) return;
        playback.stop();const beforeWish=game.state.wish;
        if (game.choose(i)) { autoSave(); render(); const delta=collectionDelta(beforeWish,game.state.wish);if(delta){wishEffects.collect(delta,game.state.node==='prologueCollected');sound.collect(delta);}if(choice.treeTab)treePanel.show(choice.treeTab); }
      }, !game.can(choice));
      el.append(element('span','',String(++displayIndex).padStart(2,'0')));
      const content = element('div'); content.append(element('strong','',choice.label));
      content.append(element('small','',choice.once && game.state.flags.includes(choice.once) ? (node.exploreHub ? '此处已经调查' : '已经留意过了') : !game.can(choice) ? '当前条件不满足' : choice.detail));
      el.append(content); $('choices').append(el);
    });
    $('choices').dataset.count = String($('choices').children.length);
    $('choices').scrollTop = 0;
    $('choices').hidden = false;
  }
  $('end-actions').hidden = !node.end || !!node.choices?.length; renderCourt(); renderExploration();schedulePlayback();
}
function courtAction(id) {
  const candidates=story.court.interactions.filter(a=>a.id===id);
  return candidates.find(a=>meets(game.context(),a.when))||candidates[0];
}
function interactCourt(id) {
  if(onTitle||modal.open||!game.node.courtHub)return;
  finishTyping(); const action=courtAction(id);
  if(!game.go(action))return;
  autoSave();
  if(action.treeTab){render();treePanel.show(action.treeTab);return;}
  render();
}
function renderCourt() {
  const inCourt=game.node?.scene==='upperCourt',hub=!!game.node?.courtHub;
  $('court-scene').hidden=!inCourt;if(!inCourt)return;
  if(!$('court-scene').querySelector('.court-scenery'))$('court-scene').prepend(createCourtScenery());
  const targets=$('court-hotspots');targets.hidden=!hub;if(!hub)return;
  const home=game.state.flags.includes('court-home');
  // 保持触控目标的 DOM 身份；逐字结束、打开面板时不拆掉正在被按住的按钮。
  for(const id of ['tree','bell','rong','platform']){
    let el=targets.querySelector(`[data-court-target="${id}"]`);
    if(!el){
      el=button('',`court-object court-${id}`,()=>interactCourt(id));el.dataset.courtTarget=id;
      const label=element('span','court-object-label');label.append(element('strong'),element('small'));el.append(label);targets.append(el);
    }
    const action=courtAction(id),can=game.can(action);
    el.disabled=!can;el.setAttribute('aria-label',action.label);
    $('court-scene').dataset[`${id}Ready`]=String(can);
    el.querySelector('strong').textContent=action.label;
    el.querySelector('small').textContent=home&&id==='platform'?'本轮已归庭':can?action.hint:action.lockedHint||action.hint;
    el.title=el.querySelector('small').textContent;
  }
  let leaf=targets.querySelector('.court-leaf-hotspot');
  if(!leaf){leaf=button('第一片叶','court-leaf-hotspot',()=>treePanel.leaf());targets.append(leaf);}
  leaf.hidden=!wishTreeView(game.state).leaves.length;
}
// 每个地点只有对应实物的透明点击区；隐藏拾取不列入行动菜单。
function renderExploration(){
  const root=$('explore-scene'),prop=story.explorationProps?.[game.node?.scene];
  root.hidden=!prop||!game.node.exploreHub;if(root.hidden)return;
  const action=prop.action;
  let el=root.querySelector('button');
  if(!el||el.dataset.prop!==prop.item){
    root.replaceChildren();
    el=button('','explore-prop',()=>{
      if(onTitle||modal.open||!game.node.exploreHub)return;
      finishTyping();const current=story.explorationProps[game.node.scene].action;
      if(game.go(current)){autoSave();render();}
    });
    el.dataset.prop=prop.item;el.setAttribute('aria-label',prop.label);el.title=prop.label;
    // 代码绘制的场景占位物，不是功能卡片。
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 48 48');svg.setAttribute('aria-hidden','true');
    const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',prop.path);svg.append(path);
    el.append(svg);root.append(el);
  }
  el.hidden=!game.can(action);el.disabled=!typed;
}
function advance(source='manual') {
  if(inkStill.active)return;
  if (onTitle || modal.open || game.node?.endCard || $('game-screen').classList.contains('ui-hidden')) return;
  if(source!=='playback')playback.stop();
  if (!typed) { finishTyping(); return; }
  if(inkStillBoundary(game.state.node,game.node.next)){
    playback.stop();wishEffects.stop();sound.stopCollection();const from=game.state.node;
    inkStill.show(()=>{if(!onTitle&&game.state.node===from&&game.next()){autoSave();render();}});return;
  }
  if (game.next()) { autoSave(); render(); }
}
function openModal(title,kicker,build) {
  if(inkStill.active)return;
  touchEffects.cancelHold();
  wishEffects.stop();sound.stopCollection();
  playback.stop();
  if (!onTitle) finishTyping();
  previousFocus = document.activeElement;
  modal.dataset.kind = kicker.split('/')[0].trim().toLowerCase();
  $('modal-title').textContent = title; $('modal-kicker').textContent = kicker;
  $('modal-body').replaceChildren(); build($('modal-body'));
  if (!modal.open) modal.showModal(); $('modal-close').focus();
}
function closeModal() { modal.close(); }
modal.addEventListener('close', () => {
  if(!onTitle&&game.node?.courtHub)renderCourt();
  if (previousFocus?.isConnected) previousFocus.focus();
});
$('modal-close').addEventListener('click',closeModal);
modal.addEventListener('click', e => {
  if (e.target !== modal) return;
  const r = modal.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal();
});
function confirm(title, message, proceed, actionText = '确认', alternative = null) {
  openModal(title,'CONFIRM',body => {
    body.append(element('p','confirm-copy',message)); const actions = element('div','modal-actions');
    if (alternative) actions.append(button(alternative.label,'action-button',() => { closeModal(); alternative.run(); }));
    actions.append(button(actionText,`action-button${alternative ? ' secondary' : ''}`,() => { closeModal(); proceed(); }),button('取消','action-button quiet',closeModal)); body.append(actions);
  });
}
function newGame() {
  const start = () => { playback.stop();chapterStore.clear();game.start(); showGame(); autoSave(); };
  const record = saves.latest();
  if (record) confirm('开启新的旅程？','开始新游戏会更新自动存档，手动存档与已读记录保留。也可以直接继续上次进度。',start,'开始新游戏',{label:'继续上次进度',run:()=>load(record)}); else start();
}
function load(record) {
  playback.stop();
  if (!game.restore(record?.state)) { toast('这个存档无法读取，请选择其他记录。'); return; }
  ledger.ingest(game.state);if (modal.open) closeModal(); showGame(); autoSave(); toast('已回到存档中的这一刻');
}
function showSlots(mode,page=0) {
  const saving = mode === 'save';
  openModal(saving ? '留住此刻' : '重返此刻',saving ? 'SAVE / LOCAL' : 'LOAD / LOCAL',body => {
    const slots = element('div','slots');
    const pages=element('nav','slot-pages');pages.setAttribute('aria-label','存档分页');
    for(let i=0;i<3;i++){const b=button(`${i*4+1}–${i*4+4}`,`action-button secondary${i===page?' selected':''}`,()=>showSlots(mode,i));b.setAttribute('aria-label',`存档第${i+1}页`);b.setAttribute('aria-current',i===page?'page':'false');pages.append(b);}body.append(pages);
    ['auto',...MANUAL_SLOTS.slice(page*4,page*4+4)].forEach(slot => {
      const record = saves.read(slot), name = slot === 'auto' ? '自动存档' : `存档 ${slot.padStart(2,'0')}`;
      const el = button('', 'slot', () => {
        if (saving) {
          const commit = () => {
            if (saves.write(slot)) { toast(`${name}已保存`); showSlots('save',page); }
          };
          if (record) confirm('覆盖存档？',`将用当前进度覆盖${name}。`,commit,'覆盖并保存'); else commit();
        } else if (record) load(record);
      }, saving ? slot === 'auto' : !record);
      el.append(element('small','',`${slot === 'auto' ? 'AUTO' : `SLOT ${slot.padStart(2,'0')}`} / ${name}`));
      if (record) {
        const state = record.state, node = story.nodes[state.node];
        el.append(element('strong','',story.scenes[node.scene].name));
        el.append(element('div','save-meta',`${shichen(state.minutes)} ${clock(state.minutes)} · 行动 ${state.ap} · 已收取 ${state.wish}`));
        el.append(element('div','excerpt',node.text));
        el.append(element('small','',new Date(record.savedAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})));
      } else { el.append(element('strong','', saving && slot !== 'auto' ? '点击保存至此处' : '空白记录')); }
      slots.append(el);
    });
    body.append(slots,element('p','hint','进度保存在当前浏览器中。更换设备、使用无痕模式或清除网站数据后，记录不会同步。'));
  });
}
function showMap() {
  const exploring = game.isExploration, storm = game.state.flags.includes('sandstorm-started');
  openModal(exploring ? '沙海初愿 · 探索地图' : '沙海一隅',exploring ? 'SAHAI / EXPLORATION' : 'MAP / PROLOGUE',body => {
    modal.dataset.kind='atlas';
    body.append(element('p','hint atlas-instructions',game.node.scene==='upperCourt' ? '身在上庭。请点击场景里的愿力树、金铃、容衡与落凡台。' : game.state.flags.includes('prologue-active') ? '先跟随容衡完成首次收取，再开始外围巡视。' : game.state.activeEvent ? '正在经历当前事件，读完后才能移动。' : exploring ? (storm ? '沙尘暴已经到来，请沿当前主线继续。' : '点选绘卷上的地点前往 · 移动或调查 −1 行动 / +30 分钟') : '选择已解锁地点前往。'));
    const canvas = element('div','map-canvas painted-map'),stage=element('div','atlas-stage'),painting=element('img','atlas-painting');painting.src='./assets/cg/sahai-atlas.png';painting.alt='沙海王城与外围五处巡视地点绘卷';painting.width=1672;painting.height=941;stage.append(painting);canvas.append(stage);
    game.map.forEach(place => {
      const current = place.scene === game.node.scene, can = game.canTravel(place), unlocked = game.state.unlockedLocations.includes(place.scene);
      const el = button('',`map-point${current ? ' current' : ''}`,() => {
        if (game.travel(place)) { closeModal(); autoSave(); render(); toast(game.state.activeEvent && game.state.flags.includes('sandstorm-started') ? '申时已至 · 沙尘暴主线触发' : `已前往${place.title} · 行动 −1`); }
      }, !can);
      const point=atlasPoints[place.scene]||place;el.style.left = `${point.x}%`; el.style.top = `${point.y}%`;
      el.dataset.locked=String(!unlocked);el.setAttribute('aria-current',current?'location':'false');
      const surveyed = place.investigate?.once && game.state.flags.includes(place.investigate.once);
      const visited = game.state.visited.some(id => story.nodes[id]?.scene === place.scene);
      const content = element('span'); content.append(element('strong','',place.title),element('small','',current ? `当前所在${surveyed ? ' · 已调查' : ''}` : !unlocked ? '尚未解锁' : can ? `移动 −1 / +${place.cost.minutes} 分钟` : game.state.ap===0 && !storm ? '行动点不足' : '当前无法前往'));
      if (exploring) content.append(element('small','map-visit',surveyed ? '◇ 线索已记录' : visited ? '已经来过' : '尚未探访'));
      el.append(content); stage.append(el);
    });
    body.append(canvas); const legend = element('div','map-legend atlas-legend');
    legend.append(element('span','','◆ 所在位置   ◇ 可前往'),element('span','',`当前行动点 ${game.state.ap} / ${story.initial.ap}`)); body.append(legend);
    if (exploring) {
      body.append(element('p','hint atlas-time',game.state.flags.includes('prologue-active') ? '领命与首次收取不消耗探索行动点。' : `当前 ${shichen(game.state.minutes)} ${clock(game.state.minutes)} · 日落前完成巡视`));
      const here = game.map.find(p=>p.scene===game.node.scene), actions = element('div','modal-actions map-actions atlas-actions');
      if (here) actions.append(button('深入调查此处 · 1 行动','action-button',() => {
        if (game.go(here.investigate)) { closeModal(); autoSave(); render(); toast(game.state.flags.includes('sandstorm-started') ? '申时已至 · 主线优先触发' : '调查完成 · 行动 −1'); }
      },!game.can(here.investigate)));
      const wait = { target: game.state.node,until: story.exploration.stormAt,when: { flags: ['chapter-sahai'],notFlags: ['sandstorm-started','prologue-active'],scenes: story.map.map(p=>p.scene) } };
      actions.append(button('收拢心神，静候风息','action-button secondary',() => {
        if (game.go(wait)) { closeModal(); autoSave(); render(); }
      },!game.can(wait))); body.append(actions);
    }
  });
}
function showState() {
  openModal('随身与行迹','INVENTORY / RECORDS',body => {
    const items = element('div','inventory-list');
    for (const [id,count] of Object.entries(game.state.inventory)) {
      const item = story.items[id], row = element('div','inventory-item');
      row.append(element('strong','',`${item.name} × ${count}`),element('p','',item.description)); items.append(row);
    }
    if (!items.childElementCount) items.append(element('p','','暂无随身物品。'));
    body.append(element('h3','panel-subtitle','物品栏'),items,element('h3','panel-subtitle','已解锁地点'));
    body.append(element('p','',game.state.unlockedLocations.map(id => story.scenes[id].name).join(' · ')));
    appendRouteValues(body);
    body.append(element('h3','panel-subtitle','已读行迹'));
    if (game.isExploration) {
      const origin = game.map.find(p=>game.state.flags.includes(`storm-from-${p.scene}`));
      if (origin) body.append(element('p','',`沙尘暴入口：${origin.title} · ${game.state.flags.includes('storm-without-clue') ? '未使用线索' : '使用已得线索'}`));
    }
    const names = story.events.filter(e => !e.private && game.state.readEvents.includes(e.id)).map(e => e.title);
    body.append(element('p','',names.length ? names.join(' · ') : '尚未记录事件。'));
    body.append(element('p','hint',`已读对话 ${game.state.readEvents.filter(id => id.startsWith('node:')).length} 段。行迹与随身物品会一起存入进度。`));
  });
}
function showLog() {
  openModal('来时言语','BACKLOG',body => {
    const list = element('div','log-list');
    game.state.history.forEach(entry => {
      if (entry.node && !game.state.readEvents.includes(`node:${entry.node}`)) return;
      const item = element('div','log-entry'); item.append(element('b','',story.characters[entry.speaker].name),element('p','',entry.text)); list.append(item);
    }); body.append(list); list.scrollTop = list.scrollHeight;
  });
}
function showHelp() {
  openModal('游玩说明','HOW TO PLAY',body => {
    ['横过 iPhone 游玩；竖屏也可操作。', '点击对话框先显示全文，再点击推进。出现选项时可选择行动。', '新游戏先在愿力树下苏醒。点击愿力树查看记录，再用金铃感应、向容衡领命，最后点击落凡台进入沙海。上庭查看与教学不消耗行动。', '首次收取前已收取愿力为 0；教学收取后为 12。教学不消耗探索行动。外围巡视从午时 12:00、6 行动点开始。地图移动或深入调查各耗 1 点、推进 30 分钟，调查会记录线索。', '巡视时可留意场景里的小物。拾取、交谈与倾听不消耗行动；深入调查和地图移动各耗一点。不同时间与已得线索会带来不同见闻。', '首日申时 15:00 必须触发沙尘暴。若移动恰在申时完成，按到达地点分支；此前获得的线索也会影响入口。各条入口最终在半埋驿站汇合。', '“收拢心神，静候风息”会在当前地点停留至申时，不消耗行动。沙尘暴开始后沿对话继续；沙海预览结束可返回上庭，将本轮愿力归档，生成第一片叶。', '“愿力树”记录枝叶、微光、根系、年轮和归档；未表达的愿文不可见。随身可查看物品与全部路线数值。自动存档之外有十二个手动档位。已读记录会跨章节重开保留。', '自动播放会在选项、自由探索及结尾停下；快进只跳过进入时已经读过的段落，遇到未读即停。长正文须滑至末尾后才会自动继续。隐去后点屏幕恢复。设置内可调文字速度、自动停留、音量和重开章节。背景音乐按场景切换，无谌初遇至这一段结束连续播放《忘记时间》。点击有蓝色光晕，长按剧情画面快进已读对白，松手即停；选项、未读段落与水墨定格不可自动跳过。'].forEach(t => body.append(element('p','',t)));
  });
}
function updateSpeed() { $('speed').textContent = `文字速度 · ${{60:'慢速',34:'标准',16:'快速',0:'即时'}[speed]}`; }
function changeSpeed(value){speed=Number(value);try{storage.setItem('yuangu-speed',String(speed));}catch{}updateSpeed();}
$('speed').addEventListener('click',()=>changeSpeed(({60:34,34:16,16:0,0:60})[speed]));
$('new-game').addEventListener('click',newGame);
$('continue-game').addEventListener('click',() => { const record = saves.latest(); if (record) load(record); });
$('title-load').addEventListener('click',() => showSlots('load'));
$('help').addEventListener('click',showHelp);
// 正文可滚动；滑动查看长句时不把手势误当成点击继续。
let dialoguePointer;
$('dialogue').addEventListener('pointerdown',e=>{dialoguePointer={x:e.clientX,y:e.clientY,moved:false};});
$('dialogue').addEventListener('pointermove',e=>{if(dialoguePointer&&Math.hypot(e.clientX-dialoguePointer.x,e.clientY-dialoguePointer.y)>8)dialoguePointer.moved=true;});
$('dialogue').addEventListener('pointercancel',()=>{if(dialoguePointer)dialoguePointer.moved=true;});
$('dialogue').addEventListener('click',()=>{const moved=dialoguePointer?.moved;dialoguePointer=null;if(!moved)advance();});
$('dialogue').addEventListener('keydown',e=>{
  if(![$('dialogue'),$('text')].includes(e.target)||e.repeat||!['Space','Enter'].includes(e.code))return;
  if(e.target===$('text')&&e.code==='Space'&&$('text').scrollHeight>$('text').clientHeight)return;
  e.preventDefault();e.stopPropagation();advance();
});
$('map-open').addEventListener('click',showMap);
$('log-open').addEventListener('click',showLog);
$('state-open').addEventListener('click',showState);
$('tree-open').addEventListener('click',()=>{
  if(game.node.courtHub)interactCourt('tree');else treePanel.show();
});
$('save-open').addEventListener('click',() => showSlots('save'));
$('load-open').addEventListener('click',() => showSlots('load'));
$('home-open').addEventListener('click',showTitle);
$('end-home').addEventListener('click',showTitle);
$('end-save').addEventListener('click',() => showSlots('save'));
document.addEventListener('keydown',e => {
  if (e.target.closest('button,dialog,input,select,textarea,#text,[role=button]') || modal.open || onTitle || e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); advance(); }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){playback.stop();if(game.state&&!onTitle){finishTyping();autoSave();}}sound.silence(document.hidden);});
$('auto-play').addEventListener('click',()=>togglePlayback('auto'));
$('skip-read').addEventListener('click',()=>togglePlayback('skip'));
$('hide-ui').addEventListener('click',hideInterface);$('ui-restore').addEventListener('click',restoreInterface);
$('text').addEventListener('scroll',schedulePlayback,{passive:true});
$('settings-open').addEventListener('click',showSettings);$('title-settings').addEventListener('click',showSettings);
$('chapter-open').addEventListener('click',showChapters);
$('ending-home').addEventListener('click',showTitle);$('ending-save').addEventListener('click',()=>showSlots('save'));
$('ending-load').addEventListener('click',()=>showSlots('load'));$('ending-record').addEventListener('click',showEndingRecord);
$('ending-restart').addEventListener('click',showChapters);
document.addEventListener('keydown',e=>{if(e.code==='Escape'&&$('game-screen').classList.contains('ui-hidden')){e.preventDefault();restoreInterface();}});
document.addEventListener('pointerdown',e=>{if(!e.target.closest('#title-audio-toggle'))sound.unlock();},{capture:true});
document.addEventListener('keydown',e=>{if(['Enter','Space'].includes(e.code)&&!e.target.closest('#title-audio-toggle'))sound.unlock();},{capture:true});
// Capture the old screen before a new-game/return-title handler changes it.
document.addEventListener('click',e=>{const target=e.target.closest('button');if(target&&!target.disabled&&!target.closest('[data-court-target="bell"],#title-audio-toggle,[data-audio-preview]'))sound.click(onTitle?'cover':'option');},{capture:true});
$('title-audio-toggle').addEventListener('click',()=>{const state=sound.status();if(!state.unlocked||state.blocked||(!preferences.bgm&&!preferences.sound)){preferences.bgm=true;preferences.sound=true;sound.unlock();}else{preferences.bgm=false;preferences.sound=false;}persistAudio();});
installDebug({ game,saves,story,element,button,openModal,closeModal,confirm,toast,showGame,showTitle,autoSave,clock });
const treePanel=installTreePanel({game,element,button,openModal});

for(const id of ['new-game','title-load','help','speed','title-settings','chapter-open'])$(id).disabled=false;
updateSpeed(); showTitle();

function appendRouteValues(body,detail=false){
  if(!game.state)return;body.append(element('h3','panel-subtitle','本轮路线数值'));
  const grid=element('div','route-values');
  for(const [key,c]of Object.entries(story.hiddenStats)){const row=element('article','route-value');row.append(element('span','',c.label),element('b','',String(game.state.hidden[key])));if(detail)row.append(element('p','',story.statNotes[key]));grid.append(row);}body.append(grid);
  const choice=story.finaleChoices.find(c=>game.state.flags.includes(c.flag));if(choice)body.append(element('p','route-result',`最后选择：${choice.label} · ${choice.result}`));
}
function showProduction(){openModal('制作面板','VALUES / CURRENT RUN',body=>{
  if(!game.state){body.append(element('p','','开始或读取游戏后可查看本轮数值。'));return;}
  body.append(element('p','hint','数值公开可查。本章以这些数值和选择标记记录路线，不会替玩家自动选择结尾。'));
  appendRouteValues(body,true);body.append(element('p','',`时刻 ${clock(game.state.minutes)} · 行动 ${game.state.ap} · 已收取 ${game.state.wish}`));
  body.append(element('p','hint',`已读 ${game.state.readEvents.filter(x=>x.startsWith('node:')).length} 段 · 一次事件 ${game.state.onceEvents.length} 项 · 物品 ${Object.keys(game.state.inventory).length} 类`));
  if(new URLSearchParams(location.search).get('debug')==='1')body.append(button('编辑制作状态','action-button',()=>{closeModal();$('debug-open').click();}));
});}
function showEndingRecord(){openModal('本轮记录','YUAN GU / PREVIEW',body=>{
  appendRouteValues(body,true);body.append(element('p','','铃兰已经在少年掌心生长。有一缕愿力未曾归来。'));
  body.append(button('查看愿力树','action-button secondary',()=>treePanel.show('archive')));
  body.append(button('归庭整理愿力记录','action-button secondary',()=>{if(game.go(story.postludeAction)){closeModal();autoSave();render();}}));
});}
function showChapters(){openModal('章节重开','CHAPTER / RESTART',body=>{
  body.append(element('p','hint','重开会恢复该章起点的状态，更新自动存档；已读记录与手动存档保留。'));
  for(const c of chapters){const record=chapterStore.read(c.id),available=c.id==='court'||!!record;
    body.append(button(`${c.name}${available?' · 从章首重开':' · 尚无章首记录'}`,'chapter-button',()=>confirm(`重开「${c.name}」？`,'将回到本章开始，后续选择与收取重新按章首状态进行。',()=>{
      playback.stop();if(record)load(record);else{chapterStore.clear();game.start();showGame();autoSave();}
    },'重开本章'),!available));
  }
});}
function showSettings(){openModal('游玩设置','PREFERENCES',body=>{
  const form=element('div','settings-grid');
  const label=element('label','setting-row');label.append(element('span','','文字速度'));
  const select=element('select');select.id='text-speed-setting';select.setAttribute('aria-label','文字速度');
  for(const [value,name]of [[60,'慢速'],[34,'标准'],[16,'快速'],[0,'即时']]){const option=element('option','',name);option.value=value;select.append(option);}select.value=String(speed);select.addEventListener('change',()=>changeSpeed(select.value));label.append(select);form.append(label);
  const persist=persistAudio;
  for(const [key,name,min,max,step]of [['autoDelay','自动停留',1000,8000,100],['master','总音量',0,100,1],['music','背景音量',0,100,1],['effects','界面音量',0,100,1]]){
    const row=element('label','setting-row');row.append(element('span','',name));const value=element('output','',key==='autoDelay'?`${preferences[key]/1000} 秒`:`${preferences[key]}%`);
    const input=element('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=preferences[key];input.setAttribute('aria-label',name);input.addEventListener('input',()=>{preferences[key]=Number(input.value);value.textContent=key==='autoDelay'?`${preferences[key]/1000} 秒`:`${preferences[key]}%`;persist();});row.append(input,value);form.append(row);
  }
  for(const [key,name]of [['bgm','播放背景音乐'],['sound','界面点击音效']]){const label=element('label','setting-row'),check=element('input');check.type='checkbox';check.checked=preferences[key];check.setAttribute('aria-label',name);check.addEventListener('change',()=>{preferences[key]=check.checked;persist();});label.append(check,element('span','',name));form.append(label);}body.append(form);
  body.append(element('p','hint','封面播放开场曲，日常探索播放轻盈场景乐，低落剧情切换氛围乐。无谌初遇至该段结束连续播放《忘记时间》，水墨定格也不打断。音乐循环、淡入淡出，切后台暂停。封面、选项和收取愿力使用不同音效，共用界面音量。长按剧情画面临时快进已读对白，松手即停。'));
  const actions=element('div','modal-actions');for(const [kind,name]of [['cover','试听封面音效'],['option','试听选项音效'],['collection','试听收取愿力']]){const preview=button(name,'action-button secondary',()=>sound.click(kind));preview.dataset.audioPreview=kind;actions.append(preview);}actions.append(button('章节重开','action-button secondary',showChapters),button('制作面板','action-button secondary',showProduction));body.append(actions);
});}
