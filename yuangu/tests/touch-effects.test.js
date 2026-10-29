import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {HoldPress,HOLD_DELAY,glowRadius} from '../dist/touch-effects.js';
import {musicForScene,encounterMusicNodes} from '../dist/music-cues.js';
test('long press has a deliberate threshold, activates once, and consumes only its own release',()=>{
 const p=new HoldPress();p.start(3,100,150,1000);assert.equal(p.trigger(1000+HOLD_DELAY-1),false);assert.equal(p.trigger(1000+HOLD_DELAY),true);assert.equal(p.trigger(2000),false);assert.equal(p.finish(7),false);assert.equal(p.finish(3),true);assert.equal(p.finish(3),false);
});
test('scroll, drag, cancellation and normal taps cannot begin long-press skip',()=>{
 const p=new HoldPress();p.start(1,0,0,0);p.move(1,0,13);assert.equal(p.trigger(3000),false);assert.equal(p.finish(1),false);p.start(2,1,1,0);assert.equal(p.finish(2),false);p.start(3,1,1,0);p.reset();assert.equal(p.trigger(3000),false);
});
test('the blue glow grows during a hold and expands on release, with bounded reduced motion',()=>{
 assert.ok(glowRadius(0)<glowRadius(500));assert.ok(glowRadius(500)<glowRadius(1500));assert.equal(glowRadius(100000),210);assert.ok(glowRadius(500,400)>glowRadius(500));assert.equal(glowRadius(10000,null,true),25);
});
test('hold uses the existing read-only skip and cannot activate on choices, menus or the ink still',()=>{
 const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8'),js=readFileSync(new URL('../dist/touch-effects.js',import.meta.url),'utf8'),css=readFileSync(new URL('../dist/touch-effects.css',import.meta.url),'utf8');
 assert.ok(app.includes("currentWasRead&&linearNode(game.node,game.state)"));assert.ok(app.includes("playback.setMode('skip')"));assert.ok(app.includes('onHoldStop:()=>playback.stop()'));assert.ok(js.includes('event.stopImmediatePropagation()'));assert.ok(js.includes('pointercancel'));assert.ok(js.includes('visibilitychange'));assert.ok(css.includes('pointer-events:none!important'));assert.ok(js.includes('event.isTrusted&&event.detail===0'));assert.ok(!js.includes('localStorage'));assert.ok(!js.includes('game.next'));
});
test('the encounter song covers the whole first encounter and stops at the black end card or return',()=>{
 for(const id of encounterMusicNodes)assert.equal(musicForScene(id,{scene:'buriedInn'}),'encounter',id);
 assert.equal(musicForScene('previewEnd',{endCard:true}),'quiet');assert.equal(musicForScene('sahaiConverge',{}, {title:true}),'opening');assert.equal(musicForScene('courtHome',{}, {returned:true}),'quiet');assert.equal(musicForScene('hub_buriedInn',{}),'light');
});
