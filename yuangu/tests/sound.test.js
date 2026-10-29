import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {installSound} from '../dist/sound.js';
import {musicForScene,musicTracks} from '../dist/music-cues.js';
import {readPreferences} from '../dist/vn-controls.js';
const flush=()=>new Promise(resolve=>queueMicrotask(resolve));
function setup({graph=false}={}){
 const tracks=Array.from({length:5},()=>({paused:true,currentTime:0,volume:1,dataset:{},plays:0,fail:false,play(){this.plays++;if(this.fail)return Promise.reject(new Error('NotAllowedError'));this.paused=false;return Promise.resolve();},pause(){this.paused=true;}}));
 const frames=new Map();let next=0;const gains=[];
 const environment={requestAnimationFrame:f=>{frames.set(++next,f);return next;},cancelAnimationFrame:id=>frames.delete(id)};
 if(graph)environment.AudioContext=class{state='running';destination={};createMediaElementSource(){return {connect(){}};}createGain(){const n={gain:{value:0},connect(){}};gains.push(n);return n;}};
 const preferences={master:70,music:35,effects:55,bgm:true,sound:true};
 const sound=installSound({music:tracks[0],nextMusic:tracks[1],effect:tracks[2],optionEffect:tracks[3],collectionEffect:tracks[4],preferences,environment});
 const advance=ms=>{const jobs=[...frames.values()];frames.clear();jobs.forEach(f=>f(ms));};return {tracks,gains,preferences,sound,advance,frames};
}
test('music cues choose cover, ordinary exploration and quiet story beats without touching data',()=>{
 assert.equal(musicForScene(null,null,{title:true}),'opening');
 for(const id of ['courtAwake','courtBell','hub_market','sahaiStart'])assert.equal(musicForScene(id,{scene:'upperCourt'}),'light');
 for(const id of ['prologueDescent','storm_well_bare'])assert.equal(musicForScene(id,{scene:'battlefield'}),'quiet');
 for(const id of ['sahaiConverge','sahaiLily','sahaiSeed','sahaiThread','endingWalk'])assert.equal(musicForScene(id,{scene:'buriedInn'}),'encounter');
 assert.equal(musicForScene('courtHome',{scene:'upperCourt'},{returned:true}),'quiet');assert.equal(musicForScene('previewEnd',{endCard:true}),'quiet');
 const node={scene:'buriedInn'},before=JSON.stringify(node);musicForScene('sahaiBloom',node);assert.equal(JSON.stringify(node),before);
});
test('all music files exist and two locally designed click WAVs are genuinely different short files',()=>{
 for(const track of Object.values(musicTracks))assert.ok(readFileSync(new URL('../dist/'+track.src.slice(2),import.meta.url)).length>800000);
 const files=['ui-cover.wav','ui-option.wav'].map(f=>readFileSync(new URL('../dist/audio/'+f,import.meta.url)));
 files.forEach(p=>{assert.equal(p.toString('ascii',0,4),'RIFF');assert.equal(p.toString('ascii',8,12),'WAVE');assert.equal(p.readUInt32LE(24),44100);assert.ok(p.length<44100);});
 assert.notEqual(createHash('sha256').update(files[0]).digest('hex'),createHash('sha256').update(files[1]).digest('hex'));
});
test('the four supplied music files are unmodified',()=>{
 const hashes={opening:'52214178937f4d519a35cc84ddc805ffce50b9af129937da013348167859acef',light:'67095372f3617f2736123e0cbd0ee0433f6d305f10b2e9ffc1f82cf00a7529d0',quiet:'77397015c63771c11e4945cbdace7b8ed6e4c3e6e0360532d67698ace5c34890',encounter:'5a2be1d6f274e6f5002806ee6b14af1ddbb174f210e8928b2fba2394dae67595'};
 for(const [id,track]of Object.entries(musicTracks))assert.equal(createHash('sha256').update(readFileSync(new URL('../dist/'+track.src.slice(2),import.meta.url))).digest('hex'),hashes[id]);
});
test('nothing autoplays before a gesture; starting and same-cue renders never restart the song',async()=>{
 const {sound,tracks,advance}=setup();sound.select('opening');assert.ok(tracks.every(t=>t.plays===0));
 sound.unlock();await flush();advance(0);advance(850);assert.equal(tracks[0].paused,false);assert.equal(tracks[1].paused,true);
 const plays=tracks[0].plays;tracks[0].currentTime=37;sound.select('opening');sound.apply();assert.equal(tracks[0].plays,plays);assert.equal(tracks[0].currentTime,37);
 assert.ok(tracks[0].loop&&tracks[1].loop);assert.ok(Math.abs(tracks[0].volume-.245)<1e-8);
});
test('switching songs crossfades two decks and pauses the old deck only when faded out',async()=>{
 const {sound,tracks,advance}=setup();sound.unlock();await flush();advance(0);advance(850);
 sound.select('light');await flush();advance(1000);advance(1425);assert.ok(tracks[0].volume>0&&tracks[1].volume>0);assert.equal(tracks[0].paused,false);
 advance(1850);assert.equal(tracks[0].paused,true);assert.equal(tracks[1].paused,false);assert.equal(sound.status().track,'light');
});
test('the encounter track does not restart across dialogue, lily art and the held ink frame',async()=>{
 const {sound,tracks,advance}=setup();sound.unlock();await flush();advance(0);advance(850);sound.select('encounter');await flush();advance(1000);advance(1850);
 const deck=tracks.find(a=>a.dataset.track==='encounter');deck.currentTime=42;const plays=deck.plays;
 for(const id of ['sahaiAsk','sahaiSeed','sahaiBloom','sahaiThread','sahaiCall','endingLookback'])sound.select(musicForScene(id,{}));
 assert.equal(deck.plays,plays);assert.equal(deck.currentTime,42);assert.equal(deck.paused,false);
});
test('iOS Web Audio gain controls volumes while media element volumes stay at one',async()=>{
 const {sound,tracks,gains,advance}=setup({graph:true});sound.unlock();await flush();advance(0);advance(850);
 assert.equal(tracks[0].volume,1);assert.ok(Math.abs(gains[0].gain.value-.245)<1e-8);
 sound.click('cover');assert.ok(Math.abs(gains[2].gain.value-.385)<1e-8);assert.equal(tracks[2].volume,1);
});
test('cover and in-game clicks use separate media; master mute and background pause work for both',async()=>{
 const {sound,tracks,preferences,advance}=setup();sound.unlock();await flush();advance(0);advance(850);
 let cover=tracks[2].plays,option=tracks[3].plays;sound.click('cover');assert.equal(tracks[2].plays,cover+1);assert.equal(tracks[3].plays,option);
 sound.click('option');assert.equal(tracks[3].plays,option+1);
 sound.silence(true);assert.ok(tracks.every(t=>t.paused));cover=tracks[2].plays;sound.click('cover');assert.equal(tracks[2].plays,cover);
 sound.silence(false);await flush();advance(2000);advance(2850);preferences.master=0;sound.apply();assert.ok(tracks.every(t=>t.paused));assert.equal(tracks[2].volume,0);
});
test('autoplay rejection is reported and can be retried by a fresh gesture',async()=>{
 const {sound,tracks}=setup();tracks[0].fail=true;sound.unlock();await flush();await flush();assert.equal(sound.status().blocked,true);
 tracks[0].fail=false;sound.unlock();await flush();assert.equal(sound.status().blocked,false);assert.equal(tracks[0].paused,false);
});
test('a rapid scene change and muting cancel stale fade callbacks',async()=>{
 const {sound,tracks,advance,preferences,frames}=setup();sound.unlock();await flush();advance(0);advance(850);
 sound.select('light');sound.select('quiet');await flush();advance(1000);advance(1850);assert.equal(sound.status().track,'quiet');assert.ok(tracks.filter(a=>!a.paused&&a.loop).length<=1);
 preferences.bgm=false;sound.apply();advance(3000);assert.equal(frames.size,0);assert.ok(tracks.slice(0,2).every(a=>a.paused&&Number(a.dataset.gain)===0));
});
test('existing explicit mute is preserved, new users get gesture-enabled music and clicks',()=>{
 const read=value=>readPreferences({getItem:()=>value});assert.equal(read(null).bgm,true);assert.equal(read(null).sound,true);
 assert.deepEqual([read('{"sound":false}').bgm,read('{"sound":false}').sound],[false,false]);assert.equal(read('{"sound":true,"bgm":false}').bgm,false);assert.equal(read('{"master":0}').master,0);
});
test('new-game click is captured before screen changes and audio-only previews do not double-click',()=>{
 const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');assert.ok(app.includes("sound.click(onTitle?'cover':'option')"));assert.ok(app.includes('[data-audio-preview]'));assert.ok(app.includes('[data-court-target="bell"]'));assert.ok(!app.includes('启用占位声音'));
});
test('wish sound is 2.8 seconds, stereo, bounded and silent at its endpoints',()=>{
 const file=readFileSync(new URL('../dist/audio/wish-collect.wav',import.meta.url));
 assert.equal(file.toString('ascii',0,4),'RIFF');assert.equal(file.readUInt16LE(22),2);
 assert.equal(file.readUInt32LE(24),44100);assert.equal((file.length-44)/4/44100,2.8);
 assert.equal(file.readInt16LE(44),0);assert.equal(file.readInt16LE(file.length-2),0);
 let max=0;for(let i=44;i<file.length;i+=2)max=Math.max(max,Math.abs(file.readInt16LE(i)));assert.ok(max>10000&&max<22000);
});
test('only positive actual wish collection triggers swooshes; stops and mute also apply',async()=>{
 const {sound,tracks,preferences,gains}=setup({graph:true});sound.unlock();await flush();const initial=tracks[4].plays;
 for(const amount of [0,-1,NaN,Infinity,undefined])sound.collect(amount);assert.equal(tracks[4].plays,initial);
 sound.collect(12);assert.equal(tracks[4].plays,initial+1);assert.equal(tracks[4].paused,false);assert.ok(Math.abs(gains[4].gain.value-.385)<1e-8);
 sound.stopCollection();assert.equal(tracks[4].paused,true);assert.equal(tracks[4].currentTime,0);
 preferences.sound=false;sound.apply();sound.collect(3);assert.equal(tracks[4].plays,initial+1);
 preferences.sound=true;sound.silence(true);sound.collect(3);assert.equal(tracks[4].plays,initial+1);
 const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
 assert.ok(app.includes("if(delta){wishEffects.collect(delta,game.state.node==='prologueCollected');sound.collect(delta);}"));
 assert.equal((app.match(/sound\.collect\(/g)||[]).length,1);
 assert.ok(app.includes('wishEffects.stop();sound.stopCollection();'));
});
