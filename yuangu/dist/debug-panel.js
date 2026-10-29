// 只有显式访问 ?debug=1 时才安装入口；不保存开关，普通链接始终隐藏。
export function installDebug(api) {
  if (new URLSearchParams(location.search).get('debug') !== '1') return;
  const { game,saves,story,element,button,openModal,closeModal,confirm,toast,showGame,showTitle,autoSave,clock } = api;
  const launch = document.getElementById('debug-open'); launch.hidden = false;
  function apply(changes) {
    const result = game.debugEdit(changes);
    if (!result.ok) { toast(result.reason); return; }
    closeModal(); showGame(); autoSave(); toast('制作状态已应用');
  }
  function field(form,label,id,value,{ min = 0,max = 100,type = 'number' } = {}) {
    const wrapper = element('label','debug-field'); wrapper.htmlFor = id;
    const input = element('input'); input.id = id; input.name = id; input.type = type; input.value = value; input.required = true;
    if (type === 'number') { input.min = min; input.max = max; input.step = 1; }
    wrapper.append(element('span','',label),input); form.append(wrapper); return input;
  }
  function show() {
    openModal('制作调试','DEBUG / LOCAL ONLY',body => {
      body.append(element('p','hint','仅此链接启用调试。修改会写入当前浏览器存档；时辰前进会正常检查强制主线。'));
      if (game.state) {
        const s = game.state, form = element('form','debug-form');
        const grid = element('div','debug-grid'); form.append(grid);
        field(grid,'第几日','debug-day',Math.floor(s.minutes/1440)+1,{ min: 1,max: 6945 });
        field(grid,'时刻','debug-time',clock(s.minutes),{ type: 'time' });
        field(grid,'剩余行动点','debug-ap',s.ap,{ max: 1000 });
        field(grid,'已收取愿力','debug-wish',s.wish,{ max: 1000000 });
        for (const [key,c] of Object.entries(story.hiddenStats)) field(grid,c.label,`debug-${key}`,s.hidden[key],c);
        const inv = element('div','debug-section'); inv.append(element('h3','panel-subtitle','物品数量'));
        for (const [key,item] of Object.entries(story.items)) field(inv,item.name,`debug-item-${key}`,s.inventory[key] || 0,{ max: 999 });
        form.append(inv);
        const unlocks = element('div','debug-section'); unlocks.append(element('h3','panel-subtitle','地点解锁'));
        for (const [key,scene] of Object.entries(story.scenes)) {
          const label = element('label','debug-check'), check = element('input'); check.type = 'checkbox'; check.id = `debug-unlock-${key}`;
          check.checked = s.unlockedLocations.includes(key); check.disabled = key === game.node.scene;
          label.append(check,document.createTextNode(scene.name)); unlocks.append(label);
        }
        form.append(unlocks);
        if (s.activeEvent) form.append(element('p','hint','当前插入事件尚未结束：可调数值与物品；先读完当前事件再调时辰。'));
        const actions = element('div','modal-actions');
        const submit = element('button','action-button','应用修改'); submit.type = 'submit';
        actions.append(submit,button('前进一刻','action-button secondary',() => apply({ minutes: game.state.minutes+15 }),!!s.activeEvent));
        form.append(actions);
        form.addEventListener('submit',event => {
          event.preventDefault(); if (!form.reportValidity()) return;
          const value = id => Number(form.querySelector(`#${id}`).value);
          const time = form.querySelector('#debug-time').value.split(':').map(Number);
          apply({ minutes: (value('debug-day')-1)*1440+time[0]*60+time[1],ap: value('debug-ap'),wish: value('debug-wish'),
            hidden: Object.fromEntries(Object.keys(story.hiddenStats).map(k => [k,value(`debug-${k}`)])),
            inventory: Object.fromEntries(Object.keys(story.items).map(k => [k,value(`debug-item-${k}`)]).filter(([,n]) => n > 0)),
            unlockedLocations: Object.keys(story.scenes).filter(k => form.querySelector(`#debug-unlock-${k}`).checked) });
        });
        body.append(form);
        const inspect = element('div','debug-section'); inspect.append(element('h3','panel-subtitle','事件检查'));
        inspect.append(element('p','hint',`节点 ${s.node} · RNG ${s.rngSeed} · 单次标记 ${s.onceEvents.length} · 已读 ${s.readEvents.length}`));
        for (const event of story.events) {
          const row = element('div','debug-event');
          row.append(element('span','',`${event.title}${event.forcedAt !== undefined ? ` / 第${Math.floor(event.forcedAt/1440)+1}日 ${clock(event.forcedAt)}` : event.pool ? ` / 权重 ${event.weight}` : ''}`),element('b','',game.eventStatus(event))); inspect.append(row);
        }
        inspect.append(button('重新检查当前事件','action-button secondary',() => {
          game.checkEvents(); closeModal(); showGame(); autoSave(); toast('事件条件已检查');
        }));
        const details = element('details','debug-details'), summary = element('summary','','查看完整状态与互斥标记');
        details.append(summary,element('pre','',JSON.stringify(s,null,2))); inspect.append(details); body.append(inspect);
      } else body.append(element('p','','请先开始新游戏或读取存档，再调整角色状态。'));
      const actions = element('div','modal-actions debug-bottom');
      actions.append(button('清空全部存档','action-button danger',() => confirm('清空本机存档？','将清空《愿骨》的自动档与三个手动档，并结束当前进度。文字速度设置会保留。',() => {
        if (!saves.clear()) return;
        game.state = null; showTitle(); toast('全部存档已清空');
      },'清空存档')),
      button('退出制作模式','action-button secondary',() => {
        const url = new URL(location.href); url.searchParams.delete('debug'); location.assign(url.href);
      })); body.append(actions);
    });
  }
  launch.addEventListener('click',show);
}
