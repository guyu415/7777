const toggle=document.getElementById('system-menu-toggle'),menu=document.getElementById('system-menu'),screen=document.getElementById('game-screen');
document.getElementById('quick-tree').addEventListener('click',()=>{closeMenu();document.getElementById('tree-open').click();});
document.getElementById('quick-bag').addEventListener('click',()=>{closeMenu();document.getElementById('state-open').click();});
function closeMenu(){menu.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','展开功能菜单');}
toggle.addEventListener('click',()=>{const open=menu.hidden;menu.hidden=!open;toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'收起功能菜单':'展开功能菜单');});
menu.addEventListener('click',event=>{if(event.target.closest('button'))closeMenu();});
document.addEventListener('pointerdown',event=>{if(!menu.hidden&&!menu.contains(event.target)&&!toggle.contains(event.target))closeMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!menu.hidden){closeMenu();toggle.focus();}});
new MutationObserver(()=>{if(screen.hidden||screen.classList.contains('ui-hidden'))closeMenu();}).observe(screen,{attributes:true,attributeFilter:['hidden','class']});
