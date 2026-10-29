// 愿力树是既有周目状态的只读投影。无第二套存档；收取永不自动生成未知愿文。
import {treeRecords,treeMilestones,firstLeaf} from './tree-data.js?v=10';
export const treeCategories=[
  {id:'leaves',name:'枝叶',caption:'归庭的愿力'},
  {id:'glimmers',name:'微光',caption:'所感知的性质'},
  {id:'roots',name:'根系',caption:'收取与去向'},
  {id:'rings',name:'年轮',caption:'本轮足迹'},
  {id:'archive',name:'归档',caption:'已知的愿望'},
];
const read=(s,ids=[])=>ids.some(id=>s.readEvents.includes(`node:${id}`));
const has=(s,f)=>s.flags.includes(f);
export function wishTreeView(state){
  if(!state)return null;
  const s=state,collected=firstLeaf.collectionFlags.some(f=>has(s,f))||treeRecords.some(r=>(r.collectionFlags||[]).some(f=>has(s,f))); 
  const inherited=!collected&&!has(s,'court-opening')&&s.wish>0;
  const signals=[];
  for(const r of treeRecords){
    const expressed=read(s,r.expressionNodes),taken=(r.collectionFlags||[]).some(f=>has(s,f));
    const known=expressed||taken||(r.knownFlags||[]).some(f=>has(s,f))||
      (r.observedNodes||[]).some(id=>s.visited.includes(id))||s.visited.some(id=>(r.observedPrefixes||[]).some(prefix=>id.startsWith(prefix)));
    const fulfilled=(r.fulfilledFlags||[]).some(f=>has(s,f)),attached=(r.attachedFlags||[]).some(f=>has(s,f));
    if(known)signals.push({fulfilled,attached,id:r.id,title:r.title,source:r.source,nature:r.nature,wishText:expressed?r.wishText:null,expressed,collected:taken});
  }
  const cards=signals.filter(r=>r.expressed||r.collected).map(r=>({...r,status:r.fulfilled?(r.attached?'已回应 · 愿力仍有滞留':'已回应 · 未收取'):r.collected?'已收取 · 未应允':'已表达 · 未收取 · 未应允'}));
  if(inherited)cards.unshift({id:'inherited',title:'旧周目收取记录',source:'沙海 · 原存档',nature:'性质未记',expressed:false,collected:true,wishText:null,status:'已收取 · 应允情况未记'});
  const archived=has(s,firstLeaf.archiveFlag);
  const amount=collected?s.wish:inherited?s.wish:0;
  const leaf=archived?{id:firstLeaf.id,title:firstLeaf.title,source:firstLeaf.source,nature:firstLeaf.nature,amount,cards:cards.filter(r=>r.collected),note:firstLeaf.note}:null;
  const rings=treeMilestones.filter(r=>(r.flags||[]).some(f=>has(s,f))||read(s,r.readNodes)||
    (r.visitedNodes||[]).some(id=>s.visited.includes(id))||(r.collected&&(collected||inherited))).map(r=>({title:r.title,done:true}));
  return {signals,cards,leaves:leaf?[leaf]:[],roots:{amount,collected:collected||inherited,archived,publicTotal:s.wish},rings};
}
