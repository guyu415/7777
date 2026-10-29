import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../dist/title-effects.css',import.meta.url),'utf8');
const js=readFileSync(new URL('../dist/title-effects.js',import.meta.url),'utf8');

test('cover has exactly four native menu targets, no duplicated visible lettering or pendants',()=>{
  for(const id of ['new-game','continue-game','title-load','title-settings','continue-note','help','speed','chapter-open']){
    assert.equal(html.split(`id="${id}"`).length-1,1,id);
  }
  assert.equal((html.match(/class="cover-hotspot /g)||[]).length,4);
  assert.ok(!html.includes('jade-pendant'));
  assert.ok(!html.includes('class="title-copy"'));
  assert.ok(existsSync(new URL('../dist/assets/ui/title-cover-baked.png',import.meta.url)));
});
test('effects are cover-scoped, pause offscreen, support reduced motion and preserve existing handlers',()=>{
  assert.ok(css.includes('aspect-ratio:1672/941'));
  assert.ok(css.includes('prefers-reduced-motion:reduce'));
  assert.ok(css.includes('pointer-events:none'));
  assert.ok(js.includes('if(screen.hidden||!visible)return'));
  assert.ok(js.includes("attributeFilter:['hidden']"));
  assert.ok(js.includes('button.click()'));
  assert.ok(!js.includes('localStorage'));
  assert.ok(js.includes('if(coverModal?.open)return'));
});
test('tree teaching refreshes newly unlocked scene targets before opening the overlay',()=>{
  const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
  assert.ok(app.includes('if(action.treeTab){render();treePanel.show(action.treeTab);return;}'));
});
