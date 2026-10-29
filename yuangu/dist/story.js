import {chapters} from './chapter-data.js?v=10';
import {finaleNodes,finaleEvents,finaleChoices,statNotes} from './finale.js?v=10';
import {locationItems,locationNodes,locationProps,locationActions} from './location-events.js?v=10';
// 唯一可编辑的剧情数据入口。当前人物与世界观来源：用户附件《愿骨2.txt》。旧文本仅为存档兼容保留。
// 数值、选项消耗、界面时间是原型机制，不是原设定。
import { courtNodes,courtInteractions,courtEvents,returnToCourt } from './court.js?v=10';
import { prologueNodes,prologueScenes } from './prologue.js?v=10';
import { events } from './events.js?v=10';
import { exploration,areas,explorationItems,explorationScenes,explorationMap,explorationNodes,explorationEvents } from './exploration.js?v=10';
export const legacyStory = {
  id: 'yuangu-opening-v1', title: '愿骨', chapter: '序 · 风起沙海', start: 'opening',
  initial: { minutes: 900, ap: 3, wish: 12, inventory: { goldBell: 1 }, unlockedLocations: ['dunes'] },
  hiddenStats: {
    xunxu: { label: '循序',initial: 0,min: 0,max: 100 },
    rushi: { label: '入世',initial: 0,min: 0,max: 100 },
    yuejie: { label: '越界',initial: 0,min: 0,max: 100 },
    rongAwareness: { label: '容衡察觉',initial: 0,min: 0,max: 100 },
    wuImpression: { label: '无谌初印象',initial: 0,min: -100,max: 100 },
  },
  items: { goldBell: { name: '镂空金铃',description: '腰间悬着的金铃，从不发声；附近出现强烈愿力时会自行震动。' } },
  events,
  characters: {
    narrator: { name: '旁白', color: 'sand' },
    yuan: { name: '苑', color: 'blue' },
    rong: { name: '容衡', color: 'gold' },
    wu: { name: '无谌', color: 'red' },
  },
  scenes: {
    dunes: { name: '王城外 · 沙丘', subtitle: '风沙稍歇', kind: 'dunes', number: '01' },
    station: { name: '废弃驿站', subtitle: '半埋于黄沙之中', kind: 'station', number: '02' },
  },
  // 地图只提供当前开场范围；不强行引入其他阵营或角色。
  map: [
    { scene: 'dunes', title: '王城外沙丘', note: '来时的路', x: 25, y: 60 },
    { scene: 'station', title: '废弃驿站', note: '风沙中的避处', x: 68, y: 40, from: ['dunes'], target: 'station', cost: { ap: 1, minutes: 10 } },
  ],
  nodes: {
    opening: { scene: 'dunes', actor: 'rong', speaker: 'narrator', text: '边境战争结束后，你第一次跟随容衡下凡，前往沙海收取积聚的愿力。任务已经结束。', next: 'wind' },
    wind: { scene: 'dunes', actor: 'rong', speaker: 'narrator', text: '经过王城外的沙丘时，一场沙尘暴骤然袭来。半埋在黄沙里的废弃驿站，隐约露出轮廓。', next: 'direction' },
    direction: { scene: 'dunes', actor: 'rong', speaker: 'yuan', text: '你注意到驿站里有人。那人衣袍和脸上全是沙，发带也被风刮歪，却还强装镇定。', choices: [
      { label: '走近驿站', detail: '行动 −1 · 时间 +10 分钟', target: 'station', cost: { ap: 1, minutes: 10 }, effects: { hidden: { rushi: 1 } } },
      { label: '先留意四周的风沙', detail: '行动 −1 · 时间 +5 分钟', target: 'observe', cost: { ap: 1, minutes: 5 }, once: 'observed', effects: { hidden: { xunxu: 1 } } },
      { label: '稍候一刻', detail: '时间 +15 分钟 · 不消耗行动', target: 'direction', cost: { minutes: 15 } },
    ] },
    observe: { scene: 'dunes', actor: null, speaker: 'narrator', text: '风沙稍歇。你能感知愿力，却不能仅凭这股力量，知道凡人心里究竟在想什么。', next: 'direction' },
    station: { scene: 'station', actor: 'wu', speaker: 'narrator', text: '他带着马躲在驿站里。灰头土脸的模样让你觉得有趣，你忍不住笑了一下。', next: 'ask' },
    ask: { scene: 'station', actor: 'wu', speaker: 'yuan', text: '你临时起意，装成能够实现愿望的神祇，走过去问他想要什么。', choices: [
      { label: '听他亲口说出愿望', detail: '继续当前相遇', target: 'lily', effects: { flags: ['approach-listen'],hidden: { rushi: 1 } } },
      { label: '再看一眼他歪掉的发带', detail: '一个短暂的停留', target: 'ribbon', effects: { flags: ['approach-ribbon'],hidden: { yuejie: 1 } } },
    ] },
    ribbon: { scene: 'station', actor: 'wu', speaker: 'narrator', text: '发带被风刮歪了。他仍强装镇定。你收住笑，等他回答。', next: 'lily' },
    lily: { scene: 'station', actor: 'wu', speaker: 'wu', text: '我想亲眼看看铃兰花。', next: 'end' },
    end: { scene: 'station', actor: 'wu', speaker: 'narrator', text: '这次偶然的相遇，停在一个尚未回应的愿望前。', end: true },
    asideWind: { scene: 'dunes',actor: null,speaker: 'narrator',text: '风沙稍歇。你望向王城外的沙丘。',resume: true },
    asideRuin: { scene: 'dunes',actor: null,speaker: 'narrator',text: '废弃驿站半埋在黄沙中，轮廓渐渐清晰。',resume: true },
    timedEncounter: { scene: 'station',actor: 'wu',speaker: 'narrator',text: '风沙稍歇。你走近半埋在黄沙里的驿站，看见那个灰头土脸却仍强装镇定的人。',resume: true },
  },
};

// 继续沿用原节点/事件 ID，使已有周目仍可读取；新游戏进入沙海探索预览章。
export const story = {
  ...legacyStory,chapter: '序章 · 上庭初行',start: 'courtAwake',
  initial: { ...legacyStory.initial,minutes: exploration.startAt,ap: exploration.initialAp,
    wish: 0,flags: [exploration.flag,'prologue-active','court-opening'],unlockedLocations: ['upperCourt','battlefield'] },
  items: { ...legacyStory.items,...explorationItems,...locationItems },scenes: { ...legacyStory.scenes,...explorationScenes,...prologueScenes },
  nodes: { ...legacyStory.nodes,...explorationNodes,...locationNodes,...finaleNodes,...prologueNodes,...courtNodes,
    sahaiEnd: { ...explorationNodes.sahaiEnd,end:false,next:'sahaiPalm' } },map: explorationMap,explorationProps: locationProps,court: { interactions: courtInteractions },
  postludeAction:returnToCourt,finaleChoices,statNotes,chapters,legacyMap: legacyStory.map,legacyChapter: legacyStory.chapter,exploration,
  events: [...legacyStory.events.map(e=>e.id==='noticed-boundary' ? e : ({ ...e,when: { all: [e.when || {},{ notFlags: [exploration.flag] }] } })),...explorationEvents,...courtEvents,...finaleEvents],
};

// 追加正式探索，不改旧节点 ID、地图成本与主线汇合点。
for(const [id,actions] of Object.entries(locationActions)){
  story.nodes[`hub_${id}`]={...story.nodes[`hub_${id}`],text:`你停在${story.scenes[id].name}的外围。金铃贴着腰侧，风从眼前的物件间穿过去。`,choices:[...story.nodes[`hub_${id}`].choices,...actions]};
}
