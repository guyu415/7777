// 上庭交互、教学顺序与归庭闭环。只使用既有 flags / readEvents / once 标记存进度。
const n=(speaker,text,next,extra={})=>({scene:'upperCourt',actor:speaker==='rong'?'rong':null,speaker,text,...(next?{next}:{}),...extra});
const hub={courtHub:true,choices:[]};
export const courtNodes={
  courtAwake:n('narrator','你在树下睁开眼。枝叶间浮着一层缓缓流转的微光，一点凉意落上指尖，你还没握住，它便又游回了枝头。长阶尽头，容衡已经在等了。','courtHub'),
  courtHub:n('narrator','你站在树根旁，目光从枝间的微光挪到阶外。容衡就站在那头，袖边垂着的衡环一动不动——跟他这个人一样。',null,hub),
  courtBell:n('narrator','你托起腰间的镂空金铃，朝阶外转了转。远处沙海里积着的愿力一下涌过来，铃身抵着指腹嗡嗡地颤，照旧一点声音也没有。',null,{choices:[
    {label:'放缓感知，辨认性质',detail:'不消耗行动',target:'courtBellNature'},
    {label:'试着找出微光里的愿文',detail:'不消耗行动',target:'courtBellEmpty'},
  ]}),
  courtBellNature:n('narrator','强烈，凌乱，底下压着很沉的牵挂。这些你都摸得出来——可牵挂的是谁，求的是什么，一概不知。你松开手，金铃落回腰侧。','courtBellDone'),
  courtBellEmpty:n('narrator','你屏着气等了好一会儿。微光始终没有变成一句话，只肯告诉你它有多强、是什么性子。没人说出口的心愿，到你这里，就是一页白纸。','courtBellDone'),
  courtBellDone:n('narrator','这下你算记住了：金铃会替你找到愿力，却不会替许愿的人开口。好了，该去容衡那儿了。',null,{choices:[
    {label:'放下金铃，回到树下',detail:'已学会感应',target:'courtHub',effects:{flags:['court-bell-learned']}},
  ]}),
  courtRuleSense:n('rong','只辨性质。愿文，须本人亲口说。',null,{choices:[
    {label:'再看一眼无字的微光',detail:'查看愿力树 · 微光',target:'courtRuleCollect',treeTab:'glimmers',effects:{flags:['court-rule-sense']}},
  ]}),
  courtRuleCollect:n('rong','收取，不等于应允。',null,{choices:[
    {label:'记下“收取”与“应允”的分别',detail:'已收取的力量，也不保证愿望实现',target:'courtRuleBoundary',effects:{flags:['court-rule-collect']}},
  ]}),
  courtRuleBoundary:n('rong','日落前巡完外围。不得擅改凡人命数。',null,{choices:[
    {label:'收回探向阶外的脚，应下任务',detail:'记下巡视范围',target:'courtReady',effects:{flags:['court-rules-ready']}},
  ]}),
  courtReady:n('narrator','你轻轻应了声“是”。容衡的目光在你脚边停了一瞬——那只脚方才还探在阶外——才转向落凡台。阶下的云层缓缓分开，露出战后的沙海。','courtHub'),
  courtReminder:n('rong','去落凡台。','courtHub'),
  courtDepart:n('rong','跟上。','prologueDescent'),
  courtReturn:n('narrator','你跟着容衡重新踏上长阶。每走一步，裙角都抖落几粒沙，头顶的枝叶慢慢舒展开。方才收来的愿力还暖在掌心，没有归进树里。',null,{choices:[
    {label:'将本轮愿力归入树中',detail:'归档收取记录 · 不代表应允愿望',target:'courtLeafBorn',once:'tree-archived-sahai',effects:{flags:['tree-leaf-sahai-001','court-home']}},
  ]}),
  courtLeafBorn:n('narrator','微光顺着树干往上爬，在枝梢凝成了第一片叶。你碰了碰叶尖：战场上的车辙、亲耳听见的那几句话，都在里头了。那些没被说出口的心愿，依旧一个字也没有。','courtHome'),
  courtHome:n('narrator','第一片叶在枝间慢慢打着转。点它能看这一趟的记录，也可以从“愿力树”翻看微光、根系与年轮。容衡还站在阶旁。',null,hub),
  courtHomeBell:n('narrator','你托起金铃，它已经安静了。可沙海里那个少年亲口说出的“铃兰”两个字，还在你耳边。','courtHome'),
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
