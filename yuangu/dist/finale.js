// 预览章终幕。仅承接本次相遇；不说明真灵异常的来历。
const n=(speaker,text,next,extra={})=>({scene:'buriedInn',actor:'wu',speaker,text,...(next?{next}:{}),...extra});
export const finaleNodes={
  sahaiPalm:n('narrator','你朝他摊开手。他看了看你，像是不肯先信，手却已经伸过来。掌心沾着细沙，指节还攥着缰绳留下的红痕。','sahaiSeed'),
  sahaiSeed:n('narrator','你拂开那点沙，指尖在他掌心轻轻一点。细小的花茎从皮肤上舒展开，银白的花垂着头，凉凉地碰了碰他的手指。','sahaiBloom'),
  sahaiBloom:n('narrator','他猛地屏住呼吸，另一只手抬到一半，又不敢碰。铃兰有真实的颜色与气息。他低下头，连发带滑到肩前都没顾上。','sahaiThread'),
  sahaiThread:n('narrator','愿望已经实现。你正要收拢随之而来的愿力，却有一缕从指间滑走，绕过花茎，缠在了他的真灵上。你指尖顿住。那一缕没有归来。','sahaiOutside'),
  sahaiOutside:n('narrator','门外忽然暗了一线。容衡站在驿站外，黑金衣摆没有沾沙。你还托着少年的手，腕侧已经落进他的视线。','sahaiCall',{actor:'rong'}),
  sahaiCall:n('rong','过来。','sahaiFinalChoice',{actor:'rong'}),
  sahaiFinalChoice:n('narrator','少年下意识拢住掌中的花。你松开手，袖口从他指边擦过去。容衡仍在门外等着；那一缕愿力，却还牵着你的感知。',null,{actor:'rong',choices:[
    {id:'ending-walk',label:'走向容衡',detail:'应下他的召唤',target:'endingWalk',mutex:'preview-final-choice',effects:{hidden:{xunxu:2},flags:['ending-walk','preview-choice-made']}},
    {id:'ending-lookback',label:'回头看无谌',detail:'再记住他此刻的模样',target:'endingLookback',mutex:'preview-final-choice',effects:{hidden:{rushi:2,wuImpression:2},flags:['ending-lookback','preview-choice-made']}},
    {id:'ending-protect',label:'暗中保护铃兰',detail:'将一点力量藏进花茎',target:'endingProtect',mutex:'preview-final-choice',effects:{hidden:{yuejie:2},flags:['ending-protect','lily-protected','preview-choice-made']}},
    {id:'ending-ask',label:'询问回应愿望是否有错',detail:'把疑问说出口',target:'endingAsk',mutex:'preview-final-choice',effects:{hidden:{rushi:1,rongAwareness:1},flags:['ending-ask','preview-choice-made']}},
  ]}),
  endingWalk:n('narrator','你收回指尖，向门外走去。容衡的袖影覆下来，隔开了身后的光。掌心还留着那朵花的凉意。','previewEnd',{actor:'rong'}),
  endingLookback:n('narrator','你回过头。无谌还捧着铃兰，见你看他，便把手稍稍抬高了一点。他没有开口，你却看清了他眼里尚未收住的亮。','previewEnd'),
  endingProtect:n('narrator','你借拂过袖口的动作，将一点力量悄悄藏进花茎。铃兰轻轻一颤。门外，容衡的目光落在你收拢的手上。','previewEnd',{actor:'rong'}),
  endingAsk:n('yuan','回应一个愿望……也有错么？','previewEnd',{actor:'rong'}),
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
