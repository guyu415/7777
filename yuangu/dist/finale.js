// 预览章终幕。仅承接本次相遇；不说明真灵异常的来历。
const n=(speaker,text,next,extra={})=>({scene:'buriedInn',actor:'wu',speaker,text,...(next?{next}:{}),...extra});
export const finaleNodes={
  sahaiPalm:n('narrator','你朝他摊开手。他盯着你的掌心，脸上明明白白写着“我才不信”，手却先一步递了过来。掌心糊着一层细沙，指节上还勒着缰绳留下的红印。','sahaiSeed'),
  sahaiSeed:n('narrator','你替他拂开那层沙，指尖在他掌心正中轻轻一点。皮肤底下先渗出一点凉意，接着，一枝细茎顶着你的指腹探出来，银白的小花一串垂下，花瓣碰了碰他的手指。','sahaiBloom'),
  sahaiBloom:n('narrator','他整个人都定住了。另一只手抬到半空，想碰，又怕碰坏，就那么悬着。是真的——有颜色，有一缕清冽的香。发带从他肩头滑下去，他也顾不上。','sahaiThread'),
  sahaiThread:n('narrator','愿望应验了，愿力跟着涌上来。你照兄长教的样子收拢，指间却漏了一缕。它绕着花茎打了个转，没有回到你手里，而是缠上了他的真灵。你的指尖僵在半空。那一缕，再没有回来。','sahaiOutside'),
  sahaiOutside:n('narrator','门洞里的光忽然暗了一截。容衡站在门外，黑金衣摆垂着，一粒沙也没沾。你的手还托着少年的手——他的目光，正落在你的腕上。','sahaiCall',{actor:'rong'}),
  sahaiCall:n('rong','过来。','sahaiFinalChoice',{actor:'rong'}),
  sahaiFinalChoice:n('narrator','少年下意识把花拢进掌心，护着。你松开手，袖口从他指缝间擦过去。门外的人没有再开口，只是等。可那一缕愿力还系在少年身上，一下一下，扯着你的感知。',null,{actor:'rong',choices:[
    {id:'ending-walk',label:'走向容衡',detail:'应下他的召唤',target:'endingWalk',mutex:'preview-final-choice',effects:{hidden:{xunxu:2},flags:['ending-walk','preview-choice-made']}},
    {id:'ending-lookback',label:'回头看无谌',detail:'再记住他此刻的模样',target:'endingLookback',mutex:'preview-final-choice',effects:{hidden:{rushi:2,wuImpression:2},flags:['ending-lookback','preview-choice-made']}},
    {id:'ending-protect',label:'暗中保护铃兰',detail:'将一点力量藏进花茎',target:'endingProtect',mutex:'preview-final-choice',effects:{hidden:{yuejie:2},flags:['ending-protect','lily-protected','preview-choice-made']}},
    {id:'ending-ask',label:'询问回应愿望是否有错',detail:'把疑问说出口',target:'endingAsk',mutex:'preview-final-choice',effects:{hidden:{rushi:1,rongAwareness:1},flags:['ending-ask','preview-choice-made']}},
  ]}),
  endingWalk:n('narrator','你收回手，朝门外走去。跨过门槛时，容衡的袖影落下来，把身后的光整个挡住了。掌心里，还留着那朵花的一点凉。','previewEnd',{actor:'rong'}),
  endingLookback:n('narrator','你还是回了头。无谌两手捧着那枝铃兰，见你看过来，便把手往上抬了抬，像要给你看，又像怕你反悔收回去。他一个字也没说，眼里的亮却怎么也藏不住。','previewEnd'),
  endingProtect:n('narrator','你借着拂袖的动作，把一丝神力悄悄送进花茎。铃兰轻轻一颤。门外，容衡的视线垂下来，落在你刚刚收拢的那只手上。','previewEnd',{actor:'rong'}),
  endingAsk:n('yuan','兄长……应了一个愿，也算错么？','previewEnd',{actor:'rong'}),
  previewEnd:n('narrator','预览章结束',null,{actor:null,end:true,endCard:true}),
};
export const finaleEvents=[
  {id:'lily-born',title:'掌心铃兰',once:true,when:{nodes:['sahaiBloom']},effects:{flags:['lily-planted','lily-fulfilled']}},
  {id:'lily-thread',title:'未归的一缕',once:true,when:{nodes:['sahaiThread']},effects:{flags:['lily-thread-attached']}},
  {id:'preview-complete',title:'预览章结束',once:true,when:{nodes:['previewEnd']},effects:{flags:['preview-complete']}},
];
export const finaleChoices=[
  {flag:'ending-walk',label:'走向容衡',result:'循序 +2'},
  {flag:'ending-lookback',label:'回头看无谌',result:'入世 +2 · 无谌初印象 +2'},
  {flag:'ending-protect',label:'暗中保护铃兰',result:'越界 +2 · 铃兰保护标记保留；达到察觉阈值会另行记录'},
  {flag:'ending-ask',label:'询问回应愿望是否有错',result:'入世 +1 · 容衡察觉 +1'},
];

export const statNotes={
  xunxu:'记录遵循巡视与收取规则的倾向；走向容衡时 +2。',
  rushi:'记录主动靠近、倾听凡人的选择；回头看无谌时 +2，提出最后的疑问时 +1。',
  yuejie:'记录越过约束的选择；累计达到 2 时触发一次容衡察觉 +1。暗护铃兰时 +2。',
  rongAwareness:'记录容衡已经留意的程度；由越界阈值或最后的询问实际增加。',
  wuImpression:'记录这次相遇留下的印象；初次搭话与最后回望会改变它。',
};
