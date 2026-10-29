import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {characterArt,spriteFor,characterView} from '../dist/character-art.js';
import {story} from '../dist/story.js';
test('all nine sprite files are full-size RGBA PNGs',()=>{
  const files=Object.values(characterArt).flatMap(Object.values);assert.equal(files.length,9);
  for(const file of files){const png=readFileSync(new URL('../dist/assets/characters/'+file,import.meta.url));
    assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),1024);assert.equal(png.readUInt32BE(20),1536);assert.equal(png[25],6);
  }
});
test('unknown expressions fall back safely and unknown actors produce no portrait',()=>{
  assert.equal(spriteFor('rong','absent').expression,'neutral');assert.equal(spriteFor('absent'),null);
});
test('court ambience uses the real Rongheng and focused dialogue uses only one NPC',()=>{
  const hub=characterView('courtHub',story.nodes.courtHub);assert.equal(hub.ambient.actor,'rong');assert.equal(hub.main,null);
  const rule=characterView('courtRuleBoundary',story.nodes.courtRuleBoundary);assert.equal(rule.main.expression,'stop');assert.equal(rule.ambient,null);
});
test('Yuan appears beside the current NPC only when she speaks',()=>{
  const pair=characterView('sahaiAsk',story.nodes.sahaiAsk);assert.equal(pair.main.actor,'wu');assert.equal(pair.main.expression,'guarded');assert.equal(pair.player.expression,'happy');
  assert.equal(characterView('sahaiRibbon',story.nodes.sahaiRibbon).player,null);
  assert.equal(characterView('endingAsk',story.nodes.endingAsk).player.expression,'hesitant');
});
test('lily gesture follows actual story beats and the end card clears every portrait',()=>{
  assert.equal(characterView('sahaiBloom',story.nodes.sahaiBloom).main.expression,'lily');
  assert.deepEqual(characterView('previewEnd',story.nodes.previewEnd),{main:null,player:null,ambient:null});
});
test('visual selection is deterministic and cannot mutate story data',()=>{
  const before=JSON.stringify(story);for(const [id,node] of Object.entries(story.nodes))characterView(id,node);
  assert.equal(JSON.stringify(story),before);
});
test('portraits are below the existing choice layer and courtyard robes are not cut at the scene seam',()=>{
  const css=readFileSync(new URL('../dist/character-art.css',import.meta.url),'utf8');
  assert.ok(css.includes('#game-screen #character-stage{position:absolute;inset:0;z-index:1;'));
  assert.ok(css.includes('#game-screen .court-scene{overflow:visible}'));
});
