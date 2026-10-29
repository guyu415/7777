import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../dist/production-ui.css',import.meta.url),'utf8');
const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const panels=readFileSync(new URL('../dist/system-panels.css',import.meta.url),'utf8');
test('bottom toolbar contains exactly save, load, auto and history; secondary controls are only in upper menu',()=>{
  const toolbar=html.match(/<footer class="game-toolbar">([\s\S]*?)<\/footer>/)[1];
  assert.deepEqual([...toolbar.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]),['save-open','load-open','auto-play','log-open']);
  const menu=html.match(/<aside id="system-menu"[^>]*>([\s\S]*?)<\/aside>/)[1];
  assert.deepEqual([...menu.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]),['tree-open','state-open','map-open','skip-read','hide-ui','settings-open','home-open']);
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size);
});
test('stats only show for actual free-activity nodes and chapter branding is hidden',()=>{
  assert.ok(app.includes("classList.toggle('free-activity',!!node.courtHub||!!node.exploreHub)"));
  assert.ok(css.includes('#game-screen.free-activity .stats{display:flex}'));
  assert.ok(css.includes('#game-screen .brand{display:none!important}'));
});
test('old competing art stylesheet is not loaded; menu and full-line text have dedicated positioning',()=>{
  assert.ok(!html.includes('href="./ui-art.css'));
  assert.ok(css.includes('height:calc(var(--dialogue-line)*2)'));
  assert.ok(app.includes('向下滑动查看全文'));
  assert.ok(html.includes('aria-controls="system-menu"'));
  assert.ok(css.includes('transform:translateX(-50%)'));
  assert.ok(css.includes('align-content:center'));
  assert.ok(html.includes('id="quick-tree"'));
  assert.ok(html.includes('id="quick-bag"'));
});
test('mobile canvas reaches viewport edges and browser chrome has no inherited pale theme',()=>{
  assert.ok(css.includes('#app{position:fixed;inset:0;width:100%;min-height:0;height:100%'));
  assert.ok(html.includes('name="theme-color" content="#101b29"'));
  assert.ok(html.includes('name="apple-mobile-web-app-status-bar-style" content="black-translucent"'));
});
test('player dialogue moves the original plaque and speaker together to the right',()=>{
  assert.ok(app.includes("dataset.speakerSide = node.speaker === 'yuan' ? 'right' : 'left'"));
  assert.ok(css.includes('[data-speaker-side="right"] .production-dialogue-art{transform:scaleX(-1)}'));
  assert.ok(css.includes('[data-speaker-side="right"] .dialogue-top{left:auto;right:13%}'));
});
test('phone choices avoid the floating stats, fit three rows or four in two columns, and reset old scroll',()=>{
  assert.ok(css.includes('inset:max(36px,calc(env(safe-area-inset-top,0px) + 8px)) auto 6px 50%'));
  assert.ok(css.includes('#choices[data-count="4"]'));
  assert.ok(css.includes('#choices[data-count="3"]'));
  assert.ok(app.includes("dataset.count = String($('choices').children.length)"));
  assert.ok(app.includes("$('choices').scrollTop = 0"));
});
test('reference icons are smaller without shrinking their touch targets',()=>{
  assert.ok(css.includes('width:44px;height:44px;min-width:44px;min-height:44px'));
  assert.ok(css.includes('inset:6px;display:block;width:32px;height:32px'));
  assert.ok(css.includes('reference-controls.jpeg'));
});
test('dialogue and choice art are byte-for-byte unchanged',()=>{
  for(const [file,sha] of [['dialogue-overlay.png','8ac8b20fd3e094ed5fd16bc54771a13aa4fafc774a8e4da96b08073f87df4abf'],['choice-ribbon.png','3d77bd74eaa28b40eaddab305eab92ae473bee365b0a3889580b7a63dd2a29c8']]){
    assert.equal(createHash('sha256').update(readFileSync(new URL('../dist/assets/ui/'+file,import.meta.url))).digest('hex'),sha);
  }
});
test('system windows have a separate responsive frame, not a stretched choice ribbon',()=>{
  assert.ok(html.includes('href="./system-panels.css'));
  assert.ok(!panels.includes('choice-ribbon.png'));
  assert.ok(panels.includes('#modal #modal-body'));
  assert.ok(panels.includes('overflow-y:auto'));
  assert.ok(panels.includes('#modal #modal-close'));
  assert.ok(app.includes("modal.dataset.kind = kicker.split('/')[0].trim().toLowerCase()"));
});
test('new game confirmation offers a real saved-progress continuation before restart',()=>{
  assert.ok(app.includes("const record = saves.latest();"));
  assert.ok(app.includes("{label:'继续上次进度',run:()=>load(record)}"));
  assert.ok(app.includes("button(alternative.label,'action-button',() => { closeModal(); alternative.run(); })"));
});
