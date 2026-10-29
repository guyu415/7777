// 愿力树界面与记录卡；内容由 wish-tree.js 投影提供，不读写独立存储。
import { treeCategories,wishTreeView } from './wish-tree.js?v=10';
export function treeSilhouette(){
  const art=document.createElement('div');art.className='tree-art';art.setAttribute('aria-hidden','true');
  art.innerHTML='<svg viewBox="0 0 300 180" fill="none" xmlns="http://www.w3.org/2000/svg"><path class="tree-halo" d="M225 80a75 75 0 1 1-150 0 75 75 0 0 1 150 0Z"/><g class="tree-limbs"><path d="M150 159V96l-8-31 8-42 9 40-9 33M150 108l-41-29-15-30M149 98l43-35 11-30M140 75l-31-25-20-8M158 66l24-23 4-22M113 81 65 66M188 66l50-17M150 140l-30 28M150 140l28 28M139 153l-46 13M161 153l47 13"/></g><g class="tree-sparks"><circle cx="94" cy="49" r="3"/><circle cx="65" cy="66" r="2"/><circle cx="109" cy="50" r="3"/><circle cx="150" cy="23" r="4"/><circle cx="186" cy="21" r="2"/><circle cx="203" cy="33" r="3"/><circle cx="238" cy="49" r="3"/><circle cx="182" cy="43" r="2"/></g></svg>';
  return art;
}
export function installTreePanel({game,element,button,openModal}){
  const data=()=>wishTreeView(game.state);
  function metadata(body,record){
    body.append(element('p','record-source',`来源 · ${record.source}`),element('p','',`愿力性质 · ${record.nature}`));
  }
  function card(id,back='archive'){
    const record=data().cards.find(r=>r.id===id);if(!record)return;
    openModal(record.title,'WISH TREE / RECORD',body=>{
      metadata(body,record);body.append(element('p','tree-status',record.status));
      body.append(element('h3','panel-subtitle','愿文'),element('p','wish-text',record.wishText||'尚无主动表达，愿文不可见。'));
      body.append(element('p','hint','愿力记录不等于应允凭据。收取不会读取未被表达的心愿。'));
      body.append(button('返回愿力树','action-button secondary',()=>show(back)));
    });
  }
  function cardButton(record,back){
    const el=button('','tree-record',()=>card(record.id,back));
    el.append(element('strong','',record.title),element('small','',record.status),element('span','',`${record.source} →`));return el;
  }
  function leaf(){
    const record=data().leaves[0];if(!record)return;
    openModal('第一片叶 · 战后初叶','WISH TREE / FIRST LEAF',body=>{
      metadata(body,record);body.append(element('p','tree-status',`归入愿力 ${record.amount} · 收取记录已归档`),element('p','',record.note));
      for(const r of record.cards)body.append(cardButton(r,'leaves'));
      if(!record.cards.length)body.append(element('p','','收取明细尚未记录。'));
      body.append(element('p','hint',game.state.flags.includes('lily-fulfilled')?'铃兰之愿已经回应，愿力尚未完整归拢，单独记在“归档”；不计入这片叶的收取量。':'铃兰之愿是亲耳所闻，尚未回应，单独记在“归档”；不计入这片叶的收取量。'));
      body.append(button('返回枝叶','action-button secondary',()=>show('leaves')));
    });
  }
  function show(category='leaves'){
    if(!game.state)return;
    if(!treeCategories.some(c=>c.id===category))category='leaves';
    openModal('愿力树','WISH TREE / UPPER COURT',body=>{
      const view=data();
      const shell=element('div','wish-tree-explorer'),canopy=element('div','wish-tree-canopy');
      const tabs=element('nav','tree-place-nav');tabs.setAttribute('aria-label','愿力树记录分类');
      for(const c of treeCategories){const b=button(c.name,`tree-tab${category===c.id?' selected':''}`,()=>show(c.id));b.dataset.treePlace=c.id;b.title=c.caption;b.setAttribute('aria-pressed',String(category===c.id));tabs.append(b);}
      const panel=element('section','wish-tree-records');panel.setAttribute('aria-label',treeCategories.find(c=>c.id===category).name);
      panel.append(element('h3','',treeCategories.find(c=>c.id===category).name));
      shell.append(canopy,tabs,panel);body.append(shell);
      if(view.leaves.length)canopy.append(button('第一片叶 · 战后初叶','first-leaf',leaf));
      const spots=[[28,19],[57,34],[18,49],[42,65],[65,14]];
      view.signals.slice(0,spots.length).forEach((r,i)=>{
        const point=button('✦','wish-glimmer',()=>view.cards.some(c=>c.id===r.id)?card(r.id,category):show('glimmers'));
        point.setAttribute('aria-label',`查看${r.title}`);point.title=r.title;point.style.left=`${spots[i][0]}%`;point.style.top=`${spots[i][1]}%`;canopy.append(point);
      });
      if(category==='leaves'){
        if(view.leaves.length)panel.append(button('第一片叶 · 战后初叶','tree-record',leaf));
        else panel.append(element('p','tree-empty','枝头尚无新叶 · 返回上庭归档后生长'));
        panel.append(element('p','hint',`本轮枝叶 ${view.leaves.length} 片。点树上的叶片查看收取记录。`));
      }else if(category==='glimmers'){
        panel.append(element('p','hint','只记录可感知的来源与性质。未被表达的心愿，没有可读取的愿文。'));
        for(const r of view.signals){
          const row=element('article','tree-signal');row.append(element('strong','',r.title));metadata(row,r);
          row.append(element('small','',r.expressed?'本人已表达 · 愿文见归档':r.collected?'已收取 · 愿文仍未表达':'愿文不可见 · 尚未表达'));panel.append(row);
        }
        if(!view.signals.length)panel.append(element('p','','尚未记录微光。'));
      }else if(category==='roots'){
        panel.append(element('h3','panel-subtitle','本轮收取的去向'));
        panel.append(element('p','tree-status',`已收取总量 ${view.roots.publicTotal} · 本次有记录的收取 ${view.roots.amount}`));
        panel.append(element('p','',view.roots.collected?(view.roots.archived?'愿力已归入树中。本轮收取记录留在枝叶。':'战后愿力已经收取，待归庭后归入树中。'):'尚未完成首次收取。'));
        panel.append(element('p','','愿力用于维系天地；具体愿望是否回应，另依天序裁定。'),element('p','hint','没有因归档而再次加算愿力。'));
      }else if(category==='rings'){
        const list=element('ol','tree-rings');for(const r of view.rings)list.append(element('li','',r.title));panel.append(list);
        if(!view.rings.length)panel.append(element('p','','本轮尚无可追溯的足迹。'));
      }else{
        panel.append(element('p','hint','主动表达或已完成收取的记录可查看。已收取但未表达的记录，愿文仍然留空。'));
        for(const r of view.cards)panel.append(cardButton(r,'archive'));
        if(!view.cards.length)panel.append(element('p','tree-empty','尚无可阅读的愿望卡片。先去感应与倾听。'));
      }
    });
  }
  return {show,leaf};
}
