// 「沙海初愿」外围巡视数据。正式开场见 prologue.js；止于初次表达铃兰之愿。
const phase = { flags: ['chapter-sahai'],notFlags: ['sandstorm-started','prologue-active'] };
export const exploration = {
  flag: 'chapter-sahai',stormFlag: 'sandstorm-started',stormAt: 900,startAt: 720,actionMinutes: 30,initialAp: 6,
};
export const areas = [
  { id: 'battlefield',name: '战场遗址',subtitle: '沙海 · 战后',kind: 'battlefield',x: 18,y: 25,clue: 'windNote',
    clueName: '风向记录',clueText: '你蹲下身，看见断箭旁的沙纹一层压着一层。风从同一个方向吹来。你将它记住，起身时拍去了指尖的沙。',
    noon: '断箭与车辙交错着伸向远处。日头照在破损的甲片上，有一点刺眼；你侧过脸，金铃在腰际轻轻贴了一下。',afternoon: '再看过来时，几道车辙已浅了许多。细沙填着人的脚印，折断的箭还露在外面。你循铃震辨认残留的愿力，记下它们的位置。',
    stormBare: '外围的愿力已收拢，你正沿王城外缘往回走，沙墙忽然从战场边缘立起。你停了半步才辨出旧驿道，顺着残墙的轮廓穿过风沙。',
    stormClue: '外围巡视将尽，战场边缘忽然卷起一片沙墙。你想起断箭旁的沙纹，及时避开迎风处，绕到王城外的旧驿道。' },
  { id: 'well',name: '王城井边',subtitle: '王城 · 井栏',kind: 'well',x: 50,y: 25,clue: 'innRoute',
    clueName: '驿站方位',clueText: '你靠近井栏，顺着城外那条浅浅的旧路望去。黄沙里露着一截残墙，门洞低矮，仍能容人通过。你记下它与城门的方向。',
    noon: '绳索磨着井栏，吱呀一声。提水的人见你走近，忙把水桶往旁边挪。你也跟着让了一步，他却把头垂得更低了。',afternoon: '井边只剩一只空桶，桶沿落着薄沙。你听了片刻，远处有人唤同伴回去；愿力的震动仍在，那人却没有说出所求。',
    stormBare: '你确认过井边残留的愿力，正要沿城外归返，风便把细沙劈面推来。井绳猛地绷直。你绕过翻倒的空桶，在沙幕间寻到旧驿道。',
    stormClue: '外围巡视将尽，细沙忽然遮断了井边的视野。你还记得残墙与城门的方向，离开井栏，沿城外的旧路寻去。' },
  { id: 'market',name: '临时集市',subtitle: '王城 · 布幔',kind: 'market',x: 82,y: 25,clue: 'innRoute',
    clueName: '驿站方位',clueText: '你从两幅布幔之间望出去，辨出了旧驿道旁的残墙。有人把废驿站当成路标指给同行的人，你便也记下了方位。',
    noon: '布幔把日头剪成一条条亮线。有人将缺口的陶碗翻来覆去地看，半晌才放下。你停在旁边，想知道这样的东西在人间能换来什么。',afternoon: '摊主用绳子拢住零散的家什，布幔在头顶绷紧。金铃轻震，你放缓脚步辨认愿力，没有伸手去碰那只被摔裂又粘好的陶碗。',
    stormBare: '巡视的末尾，一幅布幔猛然挣脱绳结。你侧身避过，眼前已全是黄沙。待看清城外的一截残墙，你便循着那点轮廓走向旧驿道。',
    stormClue: '你刚查过集市外围的愿力，布幔便被狂风掀起。那处废驿站的位置还记得清楚，你沿城外旧路穿过骤密的沙尘。' },
  { id: 'paddock',name: '城外马场',subtitle: '城外 · 蹄印',kind: 'paddock',x: 32,y: 76,clue: 'horseSigns',
    clueName: '城外蹄印',clueText: '新蹄印压过了旧的，弧线一直绕向城外。你沿着它看去，远处的旧驿道旁露出一点残墙。马比人更容易认得路么？你把方向记下来。',
    noon: '栏边的马甩了一下尾巴，伸长脖颈嗅你的衣袖。你站着让它嗅，直到鼻息落在手背上，才发现自己已经看了它很久。',afternoon: '马忽然偏过耳朵。你循着它看的方向望去，城外一道骑影已越过沙丘，只来得及瞧见束发的红色。那人骑得很快。',
    stormBare: '外围巡视已毕。你经过马场外侧时，风沙骤然扑来，栏边的马不安地踏着地。你从沙幕间辨出旧驿道，向残墙的方向走去。',
    stormClue: '归返时，马场转眼被沙尘吞没。方才那串新蹄印还在你记忆里，你循着它转向的地方，走上王城外的旧驿道。' },
  { id: 'buriedInn',name: '半埋驿站',subtitle: '旧驿道 · 黄沙',kind: 'station',x: 68,y: 76,clue: 'shelterSpot',
    clueName: '避风位置',clueText: '你弯腰穿过低矮的门洞。墙里侧比外面凉一些，堆沙也浅。你将它记住，又探头看了看门外。',
    noon: '黄沙埋住了半扇门，门楣还勉强支着。你伸手比了比沙面与旧门槛的距离，想象它从前有人往来时的模样。',afternoon: '残墙的影子已经偏开。你扫过门前积沙，腰间金铃渐渐安静，来时那些杂乱的愿力已经平复。',
    stormBare: '最后一段外围巡视刚结束，风沙便骤然压来。你经过门外的沙丘，见一人牵着马抢先进了低矮的门洞，便随之穿过沙幕。',
    stormClue: '外围巡视已毕，沙丘上的风忽然变了。你记得门洞里那处浅沙，正要过去，已有一人牵马抢先钻入。他竟比狂风来得更早一步。' },
];
export const explorationItems = {
  windNote: { name: '风向记录',description: '断箭旁沙纹显出的风向。' },
  innRoute: { name: '驿站方位',description: '城外旧路旁，半埋残墙与门洞的大致方位。' },
  horseSigns: { name: '城外蹄印',description: '记下了新蹄印绕向旧驿道的去向。' },
  shelterSpot: { name: '避风位置',description: '门洞内侧的一处浅沙地，残墙可以挡风。' },
};
export const explorationScenes = Object.fromEntries(areas.map((a,i) => [a.id,{
  name: a.name,subtitle: a.subtitle,kind: a.kind,number: String(i+1).padStart(2,'0'),exploration: true,
}]));
const survey = a => ({ id: `survey-${a.id}`,label: '深入调查',detail: '行动 −1 · 时间 +30 分钟',
  target: `survey_${a.id}`,cost: { ap: 1,minutes: 30 },once: `surveyed-${a.id}`,when: phase,
  effects: { items: { [a.clue]: 1 },hidden: { xunxu: 1 },flags: [`clue-${a.clue}`] } });
export const explorationMap = areas.map(a => ({ scene: a.id,title: a.name,note: a.subtitle,x: a.x,y: a.y,
  from: areas.filter(b=>b.id!==a.id).map(b=>b.id),target: `arrive_${a.id}`,cost: { ap: 1,minutes: 30 },when: phase,
  investigate: survey(a),
}));
export const explorationNodes = {
  sahaiStart: { scene: 'battlefield',actor: null,speaker: 'narrator',
    text: '容衡的身影已经没进远处的热浪里。你摸了摸安静下来的金铃——总算只剩你一个了。打开右上角「地图」，挑一处地方去；也可以先留下，把遗址看仔细。',next: 'arrive_battlefield' },
  sahaiConverge: { scene: 'buriedInn',actor: 'wu',speaker: 'narrator',
    text: '风沙刚歇，容衡还没从沙幕里现身。门洞深处先传来一声马的响鼻。一个少年一手拽着缰绳，一手胡乱拍着脸上的沙，越拍越花；红发带斜挂在额角，耳侧的红坠里也灌满了沙。听见你的脚步，他立刻挺直了背，把缰绳在掌心绕了两圈，好像方才钻门洞时那一下踉跄根本没发生过。你没忍住，笑了一下。',next: 'sahaiAsk' },
  sahaiAsk: { scene: 'buriedInn',actor: 'wu',speaker: 'yuan',text: '你脸上的沙还没拍干净呢。……我是来应愿的神明。你要不要许个愿？',choices: [
    { label: '收住笑，等他开口',detail: '继续主线 · 不消耗行动',target: 'sahaiDoubt',effects: { flags: ['approach-listen'],hidden: { rushi: 1 } } },
    { label: '忍不住又瞧了一眼他的发带',detail: '短暂停留 · 不消耗行动',target: 'sahaiRibbon',effects: { flags: ['approach-ribbon'],hidden: { yuejie: 1 } } },
  ] },
  sahaiRibbon: { scene: 'buriedInn',actor: 'wu',speaker: 'narrator',text: '他顺着你的目光往额角一摸，摸到那截歪掉的发带，耳根腾地红了，三两下扯正。“看什么看。”红坠上的沙簌簌往下掉。你赶紧抿住嘴，嘴角却怎么也压不下去。',next: 'sahaiDoubt' },
  sahaiDoubt: { scene: 'buriedInn',actor: 'wu',speaker: 'wu',text: '神明？神明会跟我一起躲在破驿站里吃沙？要骗人，也编个像样些的。',next: 'sahaiWeigh' },
  sahaiWeigh: { scene: 'buriedInn',actor: 'wu',speaker: 'narrator',text: '话是这么说，他却没走。他盯着你看了好一会儿：你发间没沾几粒沙，腰上那只金铃一路走来，一声也没响。他把缰绳又绕了一圈，声音压低了些，像是怕被谁听去笑话。',next: 'sahaiLily' },
  sahaiLily: { scene: 'buriedInn',actor: 'wu',speaker: 'wu',text: '我想亲眼看看铃兰花。',next: 'sahaiEnd' },
  sahaiEnd: { scene: 'buriedInn',actor: 'wu',speaker: 'narrator',text: '“母妃说，江南遍地都是，一到春天，就低着头开。”话一出口，他又像后悔了，别开脸，“……沙海里种不活的。你要是做不到，就当我没说。”握缰的手却攥紧了。腰间的金铃贴着你，无声地震了一下。铃兰——你把这个他亲口说出的名字记住了。',end: true },
};
export const explorationEvents = [];
for (const a of areas) {
  explorationNodes[`arrive_${a.id}`] = { scene: a.id,actor: null,speaker: 'narrator',text: `你来到${a.name}。`,next: `hub_${a.id}` };
  explorationNodes[`hub_${a.id}`] = { scene: a.id,actor: null,speaker: 'narrator',exploreHub: true,
    text: `${a.name}的愿力渐渐平复。你可以再走近些看看，或打开地图继续巡视。`,choices: [survey(a),
      { label: '收拢心神，静候风息',detail: '在此停留至申时 · 不消耗行动',target: `hub_${a.id}`,until: 900,when: phase },
    ] };
  explorationNodes[`survey_${a.id}`] = { scene: a.id,actor: null,speaker: 'narrator',text: a.clueText,next: `hub_${a.id}` };
  for (const [period,start,end,text] of [['noon',660,780,a.noon],['afternoon',780,900,a.afternoon]]) {
    const id = `sahai-visit-${a.id}-${period}`,target = `detail_${a.id}_${period}`;
    explorationNodes[target] = { scene: a.id,actor: null,speaker: 'narrator',text,resume: true };
    explorationEvents.push({ id,title: `${a.name} · ${period==='noon'?'午时':'未时'}`,once: true,
      when: { ...phase,nodes: [`arrive_${a.id}`] },timeWindow: { start,end },target,
      ...(a.id==='market' ? { pool: `market-${period}`,mutex: `market-${period}`,weight: 3 } : {}),
    });
  }
  for (const [suffix,hasClue] of [['clue',true],['bare',false]]) {
    const id = `sahai-storm-${a.id}-${suffix}`,target = `storm_${a.id}_${suffix}`;
    explorationNodes[target] = { scene: a.id,actor: null,speaker: 'narrator',text: hasClue ? a.stormClue : a.stormBare,resume: true };
    explorationEvents.push({ id,title: `沙尘暴 · ${a.name}${hasClue?' · 有线索':' · 无线索'}`,once: true,
      forcedAt: 900,priority: hasClue ? 1100 : 1000,mutex: 'sahai-storm',target,resumeTo: 'sahaiConverge',
      when: { ...phase,scenes: [a.id],...(hasClue ? { items: { [a.clue]: 1 } } : { not: { items: { [a.clue]: 1 } } }) },
      effects: { flags: ['sandstorm-started',`storm-from-${a.id}`,hasClue ? `storm-used-${a.clue}` : 'storm-without-clue'] },
    });
  }
}
// 集市同一时窗内的两种见闻，权重 3:1；不会覆盖另一时窗。
for (const [period,start,end,text] of [['noon',660,780,'几块写着价钱的木片在风里相碰。小孩踮脚去够一只陶碗，被大人一把抱开；你下意识也跟着抬头，想看看他究竟看中了哪一只。'],['afternoon',780,900,'集市一角已经撤下布幔。一个人把压幔的石头搬开，又弯腰捡起落在底下的细绳，仔细绕在腕上。你看着，又低头确认了一次金铃的震动。']]) {
  const target = `detail_market_${period}_alt`;
  explorationNodes[target] = { scene: 'market',actor: null,speaker: 'narrator',text,resume: true };
  explorationEvents.push({ id: `sahai-visit-market-${period}-alt`,title: `临时集市 · ${period==='noon'?'午时':'未时'}另一景`,
    once: true,pool: `market-${period}`,mutex: `market-${period}`,weight: 1,
    when: { ...phase,nodes: ['arrive_market'] },timeWindow: { start,end },target });
}
explorationEvents.push(
  { id: 'sahai-first-listen',title: '初次倾听',private: true,once: true,mutex: 'first-impression',
    when: { flags: ['chapter-sahai','approach-listen'],nodes: ['sahaiLily'] },effects: { hidden: { wuImpression: 1 } } },
  { id: 'sahai-first-ribbon',title: '初次逗弄',private: true,once: true,mutex: 'first-impression',
    when: { flags: ['chapter-sahai','approach-ribbon'],nodes: ['sahaiRibbon','sahaiLily'] },effects: { hidden: { wuImpression: -1 } } },
);
