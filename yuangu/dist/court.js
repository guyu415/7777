// 上庭交互、教学顺序与归庭闭环。只使用既有 flags / readEvents / once 标记存进度。
const n=(speaker,text,next,extra={})=>({scene:'upperCourt',actor:speaker==='rong'?'rong':null,speaker,text,...(next?{next}:{}),...extra});
const hub={courtHub:true,choices:[]};
export const courtNodes={
  courtAwake:n('narrator','你在树下睁开眼。枝间的微光慢慢打转，一点凉意落到指尖——还没握住，又游回枝头去了。容衡立在长阶尽头，等着你。','courtHub'),
  courtHub:n('narrator','你站在树根边，视线从枝间的微光移向阶外。容衡就在那头，袖边的衡环垂着，一下都没动。',null,hub),
  courtBell:n('narrator','你把腰间的镂空金铃托起来，朝阶外转了转。沙海那头积着的愿力传过来，铃身贴着指腹细细震，一声不响。',null,{choices:[
    {label:'放缓感知，辨认性质',detail:'不消耗行动',target:'courtBellNature'},
    {label:'试着找出微光里的愿文',detail:'不消耗行动',target:'courtBellEmpty'},
  ]}),
  courtBellNature:n('narrator','强烈，杂乱，底下压着一股沉甸甸的牵挂。性质能辨，可牵挂的人是谁、所求又是什么，你一概不知。你松开指头，让金铃重新垂回腰侧。','courtBellDone'),
  courtBellEmpty:n('narrator','你凝神等了一会儿。微光终究没有化作一句话，只剩性质与强弱还认得。没有出口的心事，在你这里依旧是一片空白。','courtBellDone'),
  courtBellDone:n('narrator','你记住了：金铃能寻到强烈的愿力，却不会替许愿的人开口。该去容衡身边了。',null,{choices:[
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
  courtReady:n('narrator','你轻声应了“是”。容衡的目光在你脚边顿了一瞬，才转向落凡台。阶下的云层一分，露出战后的沙海。','courtHub'),
  courtReminder:n('rong','去落凡台。','courtHub'),
  courtDepart:n('rong','跟上。','prologueDescent'),
  courtReturn:n('narrator','你跟着容衡重新踏上长阶。沙粒从裙角簌簌落下，枝叶在头顶慢慢舒展。方才收取的那一捧愿力还握在你手里，没有归入枝叶。',null,{choices:[
    {label:'将本轮愿力归入树中',detail:'归档收取记录 · 不代表应允愿望',target:'courtLeafBorn',once:'tree-archived-sahai',effects:{flags:['tree-leaf-sahai-001','court-home']}},
  ]}),
  courtLeafBorn:n('narrator','微光顺着树干往上爬，在枝梢凝成第一片叶。你伸指去碰叶尖——战场上的车辙，还有亲耳听见的那一句，都收进了记录里。至于那些没有出口的心事，依旧没有一个字。','courtHome'),
  courtHome:n('narrator','第一片叶在枝间轻轻转。想看本轮的记录，就点它一下；想翻微光、根系与年轮，就从“愿力树”进去。容衡仍站在阶旁。',null,hub),
  courtHomeBell:n('narrator','你把金铃托起来，铃身已经静了。沙海里那个少年亲口说出的“铃兰”，还留在你的记忆里。','courtHome'),
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
