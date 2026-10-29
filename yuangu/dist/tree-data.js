import {locationRecords} from './location-events.js?v=10';
// 愿力树的剧情记录数据。修改愿文、来源、性质与解锁节点时，只需编辑此文件。
export const treeRecords=[
  ...locationRecords,
  {id:'distant',title:'阶外的微光',source:'沙海边境 · 战后积聚',nature:'强烈、凌乱，夹着牵挂',knownFlags:['court-opening'],observedNodes:['prologueUpper','prologueWar']},
  {id:'cart',title:'车辙旁的愿力',source:'战场遗址 · 木车旁',nature:'沉重的牵挂',wishText:'但愿回去的路还在。',expressionNodes:['prologueHear'],collectionFlags:['tutorial-wish-collected','tutorial-collected'],observedNodes:['prologueBell','prologueBellChoice','prologueQuality','prologuePerson']},
  {id:'well',title:'井边余波',source:'王城井边',nature:'微弱、未散',observedPrefixes:['detail_well_']},
  {id:'lily',title:'铃兰之愿',source:'半埋驿站 · 少年亲口所述',nature:'牵挂、执着',wishText:'我想亲眼看看铃兰花。',expressionNodes:['sahaiLily','lily'],fulfilledFlags:['lily-fulfilled'],attachedFlags:['lily-thread-attached']},
];
export const firstLeaf={
  id:'sahai-001',title:'战后初叶',source:'沙海 · 首次巡视',nature:'凌乱、沉重，夹着牵挂',amount:12,
  collectionFlags:['tutorial-wish-collected','tutorial-collected'],archiveFlag:'tree-leaf-sahai-001',
  note:'仅归档本轮收取；未被表达的愿文仍不可见。',
};
export const treeMilestones=[
  {title:'树下苏醒',flags:['court-opening']},
  {title:'以金铃感应愿力',flags:['court-bell-learned'],readNodes:['prologueBell']},
  {title:'领命下凡',flags:['court-descended'],visitedNodes:['prologueDescent']},
  {title:'战场首次收取',collected:true},
  {title:'沙海风起',flags:['sandstorm-started']},
  {title:'听见铃兰之愿',readNodes:['sahaiLily','lily']},
  {title:'掌心生出铃兰',flags:['lily-planted']},
  {title:'未归的一缕',flags:['lily-thread-attached']},
  {title:'预览章结束',flags:['preview-complete']},
  {title:'返回上庭',flags:['court-returned']},
  {title:'第一片叶归档',flags:['tree-leaf-sahai-001']},
];
