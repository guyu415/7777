// 正式序章。人物、认知边界与世界规则据《愿骨2.txt》；教学数值仅为游戏机制。
const node = (scene,actor,speaker,text,next) => ({ scene,actor,speaker,text,...(next ? { next } : {}) });
const upper = (speaker,text,next) => node('upperCourt','rong',speaker,text,next);
const field = (speaker,text,next) => node('battlefield','rong',speaker,text,next);
export const prologueScenes = {
  upperCourt: { name: '上庭',subtitle: '临行',kind: 'upper-court',number: '00' },
};
export const prologueNodes = {
  prologueUpper: upper('narrator','上庭的长阶没有脚步声。你追上容衡时，他已经停在阶尽头，黑金外衣垂得笔直。阶外云层散开，露出一片赭黄的沙海。','prologueWar'),
  prologueWar: upper('narrator','边境的战事已经结束。积聚在那里的愿力仍未散去。这是你第一次随他下凡；你往前挪了半步，想看清云下那些细小的光。','prologueOrder'),
  prologueOrder: upper('rong','跟上。','prologueDescent'),
  prologueDescent: field('narrator','热风迎面扑来，沙粒擦过裙角。你落在容衡身后，低头看见一截折断的箭。更远处有人拖着木车走过，车上覆着一块沾灰的布。','prologueBell'),
  prologueBell: field('narrator','腰间的镂空金铃忽然贴着你轻轻一震。你托住它，指腹抵着细密的镂纹。铃身还在颤，却没有一点声音。','prologueBellChoice'),
  prologueBellChoice: { ...field('narrator','愿力就在附近。你把金铃拢在掌心，循着震动最明显的方向看去。'),choices: [
    { label: '放缓感知，辨认愿力的性质',detail: '教学 · 不消耗行动',target: 'prologueQuality',effects: { hidden: { xunxu: 1 },flags: ['tutorial-attend'] } },
    { label: '看向拖车的人',detail: '教学 · 不消耗行动',target: 'prologuePerson',effects: { hidden: { rushi: 1 },flags: ['tutorial-curious'] } },
  ] },
  prologueQuality: field('narrator','那股力量凌乱而沉重，有的尖锐，有的已很微弱。你能分辨其中的恐惧与牵挂，却找不到一句完整的话。','prologueLimit'),
  prologuePerson: field('narrator','拖车的人停下来，抹了一把脸。他始终没有开口。愿力缠在车边，你感觉到沉重的牵挂，却不知道他挂念的是谁，又想求什么。','prologueLimit'),
  prologueLimit: field('yuan','兄长，这些愿力……他们究竟想要什么？','prologueReply'),
  prologueReply: field('rong','未曾表达，你便无从得知。','prologueHear'),
  prologueHear: field('narrator','你又看了那人一眼。他把车轮从沙里拔出来，低声念了一句：“但愿回去的路还在。”你这才知道，他此刻求的是一条归路。','prologueDistinction'),
  prologueDistinction: field('narrator','他开口之前，愿力就已存在。你先前觉出的沉重，并没有告诉你这句话。你捻了一下金铃，想起上庭教过你的分别：心中所求是愿望，随之生出的力量才是愿力。','prologueCollectAsk'),
  prologueCollectAsk: field('yuan','收了它，就会替他留住那条路么？','prologueCollectRule'),
  prologueCollectRule: field('rong','收取不等于应允。','prologueCourtRule'),
  prologueCourtRule: field('narrator','容衡抬手，散在沙面上的微光便向他收拢。送达上庭的祈祷尚须依天序裁定；此刻收取的愿力，将用于维系天地。那人的车仍在往前走，没人向他许诺。','prologueCollect'),
  prologueCollect: { ...field('rong','收取此处。'),choices: [
    { label: '循着金铃的震动，收拢愿力',detail: '首次收取 · 已收取愿力 +12 · 不消耗行动',target: 'prologueCollected',once: 'tutorial-collected',requiresItems: { goldBell: 1 },effects: { wish: 12,flags: ['tutorial-wish-collected'] } },
  ] },
  prologueCollected: field('narrator','你依着他方才的动作，将散乱的愿力一点点引入掌中。微光没入指间，金铃随之安静下来。拖车的人已经走远，只有沙里一深一浅的车辙留着。','prologueBoundary'),
  prologueBoundary: field('rong','日落前，完成外围巡视。不得擅自介入凡人命数。','prologueLook'),
  prologueLook: field('narrator','你原本还想沿着车辙看看。容衡的目光落过来，你便收回迈出去的脚，把金铃放回腰侧。','prologueAnswer'),
  prologueAnswer: field('yuan','……是，兄长。','prologueRoute'),
  prologueRoute: field('narrator','容衡腕间的黑色衡环在日光下一闪。他向战场深处走去，未再回头。你留在外围，心里还记着那人说的归路。','prologueMap'),
  prologueMap: { ...node('battlefield',null,'narrator','你记下五处巡视地点：战场遗址、王城井边、临时集市、城外马场、半埋驿站。先去哪里，由你决定。'),choices: [
    { label: '记下路线，开始巡视',detail: '开放地图 · 6 行动点 · 移动或调查各耗 1 点 / 30 分钟',target: 'sahaiStart',effects: { flags: ['prologue-complete'],removeFlags: ['prologue-active'],unlock: ['battlefield','well','market','paddock','buriedInn'],lock: ['upperCourt'] } },
  ] },
};
