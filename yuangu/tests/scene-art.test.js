import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sceneView,sceneArt} from '../dist/scene-art.js';
import {story} from '../dist/story.js';
test('every painted scene and wish-tree image is a real wide PNG',()=>{
  const files=new Set([...Object.values(sceneArt),'inn-interior.png','wish-tree.png']);assert.equal(files.size,8);
  for(const f of files){const png=readFileSync(new URL('../dist/assets/scenes/'+f,import.meta.url));
    assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');const ratio=png.readUInt32BE(16)/png.readUInt32BE(20);assert.ok(ratio>1.7&&ratio<1.9);
  }
});
test('the inn switches between exploration exterior and story interior without changing nodes',()=>{
  assert.equal(sceneView('hub_buriedInn',story.nodes.hub_buriedInn).interior,false);
  assert.equal(sceneView('sahaiAsk',story.nodes.sahaiAsk).interior,true);
  assert.equal(sceneView('storm_battlefield_bare',story.nodes.storm_battlefield_bare).storm,true);
  assert.equal(sceneView('sahaiConverge',story.nodes.sahaiConverge).storm,false);
});
test('all existing nodes have a background and visual lookup cannot mutate story data',()=>{
  const before=JSON.stringify(story);for(const [id,node]of Object.entries(story.nodes))assert.ok(sceneView(id,node).src.startsWith('./assets/scenes/'));
  assert.equal(JSON.stringify(story),before);
});
test('tree uses illustrated click targets while keeping wishes gated by the existing view model',()=>{
  const panel=readFileSync(new URL('../dist/tree-panel.js',import.meta.url),'utf8');
  assert.ok(panel.includes('wish-tree-explorer'));assert.ok(panel.includes('b.dataset.treePlace=c.id'));
  assert.ok(panel.includes('view.cards.some(c=>c.id===r.id)?card(r.id,category):show(\'glimmers\')'));
  assert.ok(!panel.includes('branch.append(treeSilhouette())'));
  assert.ok(!panel.includes('localStorage'));
});
