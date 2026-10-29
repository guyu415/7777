// 上庭交互、教学顺序与归庭闭环。只使用既有 flags / readEvents / once 标记存进度。
const n=(speaker,text,next,extra={})=>({scene:'upperCourt',actor:speaker==='rong'?'rong':null,speaker,text,...(next?{next}:{}),...extra});
const hub={courtHub:true,choices:[]};
export const courtNodes={
  courtAwake:n('narrator','你在树下睁开眼。枝间微光缓慢流转，一点凉意落在指尖，还未握住，便又游回枝头。容衡站在长阶尽头，正等着你。','courtHub'),
  courtHub:n('narrator','你站在树根旁，视线从枝间微光移向阶外。容衡就在那头，垂在袖边的衡环一动不动。',null,hub),
  courtBell:n('narrator','你托起腰间的镂空金铃，朝阶外转了转。远处沙海积聚的愿力传来，铃身抵着指腹轻震，始终没有声音。',null,{choices:[
    {label:'放缓感知，辨认性质',detail:'不消耗行动',target:'courtBellNature'},
    {label:'试着找出微光里的愿文',detail:'不消耗行动',target:'courtBellEmpty'},
  ]}),
  courtBellNature:n('narrator','强烈、凌乱，夹着沉重的牵挂。你辨得出这些，却不知道牵挂着谁、所求为何。你松开指尖，让金铃重新垂在腰侧。','courtBellDone'),
  courtBellEmpty:n('narrator','你凝神等了一会儿。微光没有化作一句话，只有性质与强弱仍可分辨。未被表达的心愿，在你这里仍是一片空白。','courtBellDone'),
  courtBellDone:n('narrator','你记住了：金铃指向强烈的愿力；它不会替许愿的人开口。现在可以去容衡身边了。',null,{choices:[
    {label:'放下金铃，回到树下',detail:'已学会感应',target:'courtHub',effects:{flags:['court-bell-learned']}},
  ]}),
  courtRuleSense:n('rong','只辨愿力性质。愿文，须本人表达。',null,{choices:[
    {label:'再看一眼无字的微光',detail:'查看愿力树 · 微光',target:'courtRuleCollect',treeTab:'glimmers',effects:{flags:['court-rule-sense']}},
  ]}),
  courtRuleCollect:n('rong','收取，不等于应允。',null,{choices:[
    {label:'记下“收取”与“应允”的分别',detail:'已收取的力量，也不保证愿望实现',target:'courtRuleBoundary',effects:{flags:['court-rule-collect']}},
  ]}),
  courtRuleBoundary:n('rong','日落前巡完外围。不得擅改凡人命数。',null,{choices:[
    {label:'收回探向阶外的脚，应下任务',detail:'记下巡视范围',target:'courtReady',effects:{flags:['court-rules-ready']}},
  ]}),
  courtReady:n('narrator','你轻轻应了声“是”。容衡的目光在你脚边停了一瞬，才转向落凡台。云层自阶下分开，露出战后的沙海。','courtHub'),
  courtReminder:n('rong','去落凡台。','courtHub'),
  courtDepart:n('rong','跟上。','prologueDescent'),
  courtReturn:n('narrator','你随容衡重新踏上长阶。沙粒从裙角落下，树枝在头顶舒展开来。方才收取的愿力仍在你掌中，尚未归入枝叶。',null,{choices:[
    {label:'将本轮愿力归入树中',detail:'归档收取记录 · 不代表应允愿望',target:'courtLeafBorn',once:'tree-archived-sahai',effects:{flags:['tree-leaf-sahai-001','court-home']}},
  ]}),
  courtLeafBorn:n('narrator','微光沿树干攀上去，在枝梢凝成第一片叶。你碰了碰叶尖，战场上的车辙与亲耳听过的话都留在记录里；那些未被说出的心愿，依旧没有文字。','courtHome'),
  courtHome:n('narrator','第一片叶在枝间轻轻转动。你可以点它查看本轮记录，也可以从“愿力树”翻看微光、根系与年轮。容衡仍在阶旁。',null,hub),
  courtHomeBell:n('narrator','你托起金铃，铃身已经平静。沙海里那个少年亲口说过的“铃兰”，仍留在你的记忆里。','courtHome'),
  courtHomeRong:n('rong','收取已记。命数不可擅动。','courtHome'),
};
// 主界面与系统入口共用这些行动，不能绕过教学顺序，也不重复结算奖励。
export const courtInteractions=[
  {id:'tree',label:'愿力树',hint:'查看枝间微光',target:'courtHub',treeTab:'glimmers',when:{nodes:['courtHub']},effects:{flags:['court-tree-seen']}},
  {id:'bell',label:'镂空金铃',hint:'感应愿力',lockedHint:'先查看愿力树',target:'courtBell',when:{nodes:['courtHub'],flags:['court-tree-seen']},requiresItems:{goldBell:1}},
  {id:'rong',label:'容衡',hint:'领受三条规则',lockedHint:'先完成金铃感应',target:'courtRuleSense',when:{nodes:['courtHub'],flags:['court-bell-learned'],notFlags:['court-rules-ready']}},
  {id:'rong',label:'容衡',hint:'规则已记',target:'courtReminder',when:{nodes:['courtHub'],flags:['court-rules-ready']}},
  {id:'platform',label:'落凡台',hint:'随容衡下凡',lockedHint:'先听容衡交代规则',target:'courtDepart',once:'court-descended',when:{nodes:['courtHub'],flags:['court-rules-ready']},effects:{flags:['court-descended']}},
  {id:'tree',label:'愿力树',hint:'第一片叶 · 可查看',target:'courtHome',treeTab:'leaves',when:{nodes:['courtHome']}},
  {id:'bell',label:'镂空金铃',hint:'查看金铃',target:'courtHomeBell',when:{nodes:['courtHome']}},
  {id:'rong',label:'容衡',hint:'回禀',target:'courtHomeRong',when:{nodes:['courtHome']}},
];
export const courtEvents=[
  {id:'court-return-path',title:'归庭之路',private:true,once:true,when:{nodes:['sahaiEnd'],flags:['chapter-sahai']},effects:{unlock:['upperCourt']}},
];
export const returnToCourt={label:'随容衡返回上庭',detail:'结束本轮巡视 · 将愿力带回树下',target:'courtReturn',when:{flags:['chapter-sahai']},effects:{flags:['court-returned'],unlock:['upperCourt']}};
