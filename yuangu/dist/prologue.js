// 正式序章。人物、认知边界与世界规则据《愿骨2.txt》；教学数值仅为游戏机制。
const node = (scene,actor,speaker,text,next) => ({ scene,actor,speaker,text,...(next ? { next } : {}) });
const upper = (speaker,text,next) => node('upperCourt','rong',speaker,text,next);
const field = (speaker,text,next) => node('battlefield','rong',speaker,text,next);
export const prologueScenes = {
  upperCourt: { name: '上庭',subtitle: '临行',kind: 'upper-court',number: '00' },
};
export const prologueNodes = {
  prologueUpper: upper('narrator','上庭的长阶上没有脚步声，连你自己的也没有。你提着裙摆追到阶尽头，容衡早已站在那里，黑金外衣垂得没有一道褶。阶外的云正在散开，底下露出一大片赭黄——是沙海。','prologueWar'),
  prologueWar: upper('narrator','边境的仗已经打完，愿力却没有散，一团一团浮在沙海上，像没烧尽的余烬。这是你头一回随他下凡。你往阶沿挪了半步，想看清那些细小的光。','prologueOrder'),
  prologueOrder: upper('rong','跟上。','prologueDescent'),
  prologueDescent: field('narrator','热风劈面扑上来，裹着铁锈和焦土的气味，沙粒一下下打在裙角。你落在容衡身后，脚边就是一截断箭。再远些，有人拖着木车慢慢走，车上盖着块灰扑扑的布。布底下鼓起的形状，你看了第二眼，便移开了。','prologueBell'),
  prologueBell: field('narrator','腰间的镂空金铃忽然贴着你一震。你伸手托住，指腹压着细密的镂纹——它在颤，颤得很急，却还是一声不响。','prologueBellChoice'),
  prologueBellChoice: { ...field('narrator','愿力就在近处。你把金铃拢在掌心，顺着它震得最急的方向望过去。'),choices: [
    { label: '放缓感知，辨认愿力的性质',detail: '教学 · 不消耗行动',target: 'prologueQuality',effects: { hidden: { xunxu: 1 },flags: ['tutorial-attend'] } },
    { label: '看向拖车的人',detail: '教学 · 不消耗行动',target: 'prologuePerson',effects: { hidden: { rushi: 1 },flags: ['tutorial-curious'] } },
  ] },
  prologueQuality: field('narrator','那股力量乱糟糟的，又沉。有几缕尖得扎手，有几缕已经弱得快熄了。你辨得出里头的害怕，也辨得出牵挂，可翻来覆去，找不到一句完整的话。','prologueLimit'),
  prologuePerson: field('narrator','拖车的人停下来，拿袖子抹了把脸，从头到尾没出声。愿力缠着车辕打转，沉甸甸的。你知道他心里挂着一件很重的事——挂的是谁，想求什么，你一概不知。','prologueLimit'),
  prologueLimit: field('yuan','兄长，这些愿力……他们到底想要什么？','prologueReply'),
  prologueReply: field('rong','不说出口的，你听不见。','prologueHear'),
  prologueHear: field('narrator','你又看了那人一眼。他弓着背，把陷进沙里的车轮一点点撬出来，低声念了一句：“但愿回去的路还在。”——原来他要的，是一条回家的路。','prologueDistinction'),
  prologueDistinction: field('narrator','那句话出口之前，愿力早就在那儿了；可它沉了那么久，一个字也没告诉你。你捻着金铃，想起在上庭背过的话：心里所求叫愿望，愿望生出来的力气，才叫愿力。背得出，和真的明白，原来是两回事。','prologueCollectAsk'),
  prologueCollectAsk: field('yuan','把它收走……他的路，就会还在么？','prologueCollectRule'),
  prologueCollectRule: field('rong','收取不等于应允。','prologueCourtRule'),
  prologueCourtRule: field('narrator','容衡抬起手，散在沙面上的微光便一缕缕向他聚拢，顺从得像退潮。送上庭的祈祷，还要依天序一桩一桩裁断；此刻收走的这些，只拿去维系天地。拖车的人仍在往前走。没有谁许诺过他什么。','prologueCollect'),
  prologueCollect: { ...field('rong','这一片，你来收。'),choices: [
    { label: '循着金铃的震动，收拢愿力',detail: '首次收取 · 已收取愿力 +12 · 不消耗行动',target: 'prologueCollected',once: 'tutorial-collected',requiresItems: { goldBell: 1 },effects: { wish: 12,flags: ['tutorial-wish-collected'] } },
  ] },
  prologueCollected: field('narrator','你学着他方才的样子，把散乱的愿力一点一点引进掌心。微光没入指缝，带着一点温，金铃慢慢静了下来。再抬头时，拖车的人已经走远，沙地上只剩一深一浅两道车辙。','prologueBoundary'),
  prologueBoundary: field('rong','日落之前，巡完外围。凡人命数，不得擅动。','prologueLook'),
  prologueLook: field('narrator','你本来还想顺着车辙走几步，看看那条路通到哪里。容衡的目光扫过来，你脚尖一收，把金铃挂回腰侧，站得端端正正。','prologueAnswer'),
  prologueAnswer: field('yuan','……是，兄长。','prologueRoute'),
  prologueRoute: field('narrator','他腕间的黑色衡环在日头下闪了一下。他朝战场深处走去，一次也没有回头。直到那道背影被热浪吞没，你才轻轻吐出一口气——那人念的归路，还在你心里打转。','prologueMap'),
  prologueMap: { ...node('battlefield',null,'narrator','你在心里排了排要去的地方：战场遗址、王城井边、临时集市、城外马场、半埋驿站。兄长没说先去哪里。那就由你来挑。'),choices: [
    { label: '记下路线，开始巡视',detail: '开放地图 · 6 行动点 · 移动或调查各耗 1 点 / 30 分钟',target: 'sahaiStart',effects: { flags: ['prologue-complete'],removeFlags: ['prologue-active'],unlock: ['battlefield','well','market','paddock','buriedInn'],lock: ['upperCourt'] } },
  ] },
};
