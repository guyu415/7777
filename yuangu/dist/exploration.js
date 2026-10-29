// 「沙海初愿」外围巡视数据。正式开场见 prologue.js；止于初次表达铃兰之愿。
const phase = { flags: ['chapter-sahai'],notFlags: ['sandstorm-started','prologue-active'] };
export const exploration = {
  flag: 'chapter-sahai',stormFlag: 'sandstorm-started',stormAt: 900,startAt: 720,actionMinutes: 30,initialAp: 6,
};
export const areas = [
  { id: 'battlefield',name: '战场遗址',subtitle: '沙海 · 战后',kind: 'battlefield',x: 18,y: 25,clue: 'windNote',
    clueName: '风向记录',clueText: '你蹲下身，看断箭边的沙纹——一层压一层，风都是从同一头刮来的。记下来，起身时把指尖的沙拍掉。',
    noon: '断箭和车辙交错着一直伸到远处。日头砸在破碎的甲片上，刺得你眯起眼侧过脸去。金铃在腰际贴了你一下。',afternoon: '再回头看，几道车辙已经浅了。细沙把人的脚印一点点填平，断箭还露在外头。你循着铃震辨认留下的愿力，把它们在哪儿一一记住。',
    stormBare: '外围的愿力收得差不多，你正沿着王城外缘往回走——风沙"哗"一下从战场边立起来。你愣了半步才认出旧驿道，顺着残墙的影子穿过去。',
    stormClue: '巡视将尽，战场一头忽然卷起一堵沙墙。幸好你记得断箭旁的风向，赶在迎风面之前绕开，踩进王城外的旧驿道。' },
  { id: 'well',name: '王城井边',subtitle: '王城 · 井栏',kind: 'well',x: 50,y: 25,clue: 'innRoute',
    clueName: '驿站方位',clueText: '你靠近井栏，顺着城外那条浅浅的旧路望出去。黄沙里露着一截残墙，门洞矮，刚够人钻过。你把它和城门的方向一起记住。',
    noon: '绳索擦着井栏，"吱呀"一声。打水的人见你走近，忙把水桶往旁边挪。你也让了一步，他反而把头垂得更低了。',afternoon: '井边只剩一只空桶，桶沿薄薄一层沙。你听了一会儿，远处有人唤同伴回去；愿力的震动还在，那人却没说出想要什么。',
    stormBare: '井边的愿力刚核过，你正要绕城回去，细沙"啪"地扑上脸。井绳猛地绷直。你绕过翻倒的空桶，在沙幕里找见了旧驿道。',
    stormClue: '巡视将尽，井边的视线被细沙一下挡死。你还记得残墙和城门的方向，离开井栏，顺着城外那条旧路寻过去。' },
  { id: 'market',name: '临时集市',subtitle: '王城 · 布幔',kind: 'market',x: 82,y: 25,clue: 'innRoute',
    clueName: '驿站方位',clueText: '你从两幅布幔中间望出去，认出了旧驿道旁的残墙。有人正把那座废驿站当路标，指给同伴看——你顺便把方位也记了。',
    noon: '布幔把日头剪成一条条亮线。有人捧着只缺口的陶碗翻来覆去地看，半晌才搁下。你站在旁边，想知道这样的东西在人间能换几文。',afternoon: '摊主用绳子把零散的家什拢住，布幔在头顶绷得紧紧的。金铃一震，你放缓脚步辨认愿力，没去碰那只摔裂又粘回来的陶碗。',
    stormBare: '巡到最后，一幅布幔"嘭"地挣脱了绳结。你侧身让过，再抬头，眼前全是黄沙。等那截残墙从沙里透出一点轮廓，你就循着它走进旧驿道。',
    stormClue: '集市外围的愿力刚查完，布幔就被狂风掀开。那座废驿站的方位你还记得清，顺着城外旧路往沙尘更密处走。' },
  { id: 'paddock',name: '城外马场',subtitle: '城外 · 蹄印',kind: 'paddock',x: 32,y: 76,clue: 'horseSigns',
    clueName: '城外蹄印',clueText: '新蹄印压过了旧的，弧线一路绕向城外。你顺着看过去，旧驿道旁露出一点残墙。——马比人更识路？方向先记下。',
    noon: '栏边的马甩了一下尾巴，伸长脖子来嗅你的衣袖。你没躲，站着让它嗅，直到鼻息落在手背上，才发觉自己已经看了它好一会儿。',afternoon: '马忽然偏过一只耳朵。你顺它的视线望出去，城外一道骑影已经越过沙丘，只来得及看见一截束发的红。那人骑得极快。',
    stormBare: '外围刚走完一轮。你路过马场外侧，风沙猛地扑来，栏里的马不安地踏着蹄。你从沙幕里辨出旧驿道，朝残墙那头走。',
    stormClue: '归途上，马场转眼就被沙尘吞了。方才那串新蹄印还在记忆里，你循着它转向的那一点，拐上王城外的旧驿道。' },
  { id: 'buriedInn',name: '半埋驿站',subtitle: '旧驿道 · 黄沙',kind: 'station',x: 68,y: 76,clue: 'shelterSpot',
    clueName: '避风位置',clueText: '你弯腰钻过低矮的门洞。墙里比外头凉一些，堆沙也浅。记下这个位置，又探头望了望门外。',
    noon: '黄沙埋了半扇门，门楣还勉强撑着。你伸手比了比沙面和旧门槛的距离——想象这里从前有人来往时，是个什么样子。',afternoon: '残墙的影子已经偏开。你扫一眼门前积沙，腰间的金铃渐渐静了，来时那些杂乱愿力都退下去了。',
    stormBare: '最后一段外围刚走完，风沙就压过来。你经过门外的沙丘，正见一个人牵着马抢先钻进低矮的门洞——你随之穿过沙幕。',
    stormClue: '外围巡完，沙丘上的风忽然换了向。你记得门洞里那块浅沙，正要过去，已经有一个人牵着马抢在风前钻了进去。' },
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
    text: '容衡的身影已经没入远处的热浪里。你摸了摸安静下来的金铃，把心里排好的路线一一摊开。右上角点开「地图」就能挑一处去；想在遗址多留一会儿，调查也行。',next: 'arrive_battlefield' },
  sahaiConverge: { scene: 'buriedInn',actor: 'wu',speaker: 'narrator',
    text: '风势稍歇，容衡还没从沙幕里走出来。驿站里，一个少年扯着马缰，正拍脸上的沙，红色发带歪在额边。他听见动静，猛地站直，仿佛方才钻门洞时并没有踉跄过。你看着好笑，没忍住笑了一声。',next: 'sahaiAsk' },
  sahaiAsk: { scene: 'buriedInn',actor: 'wu',speaker: 'yuan',text: '我是来应愿的神祇。你要不要许一个？',choices: [
    { label: '收住笑，等他开口',detail: '继续主线 · 不消耗行动',target: 'sahaiLily',effects: { flags: ['approach-listen'],hidden: { rushi: 1 } } },
    { label: '忍不住又瞧了一眼他的发带',detail: '短暂停留 · 不消耗行动',target: 'sahaiRibbon',effects: { flags: ['approach-ribbon'],hidden: { yuejie: 1 } } },
  ] },
  sahaiRibbon: { scene: 'buriedInn',actor: 'wu',speaker: 'narrator',text: '他顺着你的目光摸到额边，胡乱把发带扯回去。"看什么。"耳侧的红坠还挂着沙。你抿住嘴，等他下一句。',next: 'sahaiLily' },
  sahaiLily: { scene: 'buriedInn',actor: 'wu',speaker: 'wu',text: '我想亲眼看看铃兰花。',next: 'sahaiEnd' },
  sahaiEnd: { scene: 'buriedInn',actor: 'wu',speaker: 'narrator',text: '"母妃说，江南有这种花。"他看着你，握缰的手却收紧了一分。腰间的金铃无声地一震。铃兰——这个由他亲口说出的名字，你记住了。',end: true },
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
for (const [period,start,end,text] of [['noon',660,780,'几块写着价钱的木片在风里相碰。有个小孩踮脚去够一只陶碗，被大人一把抱开；你也跟着抬头，想看看他究竟看中了哪一只。'],['afternoon',780,900,'集市一角已经撤了布幔。有人把压幔的石头搬开，又弯腰捡起落在底下的细绳，仔细缠在腕上。你看着看着，又低头确认了一次金铃的震动。']]) {
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
