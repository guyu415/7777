export const musicTracks=Object.freeze({
  opening:Object.freeze({src:'./audio/opening.mp3',name:'开场曲'}),
  light:Object.freeze({src:'./audio/light-scene.mp3',name:'轻盈场景乐'}),
  quiet:Object.freeze({src:'./audio/quiet-sad.mp3',name:'安静、悲伤氛围乐'}),
  encounter:Object.freeze({src:'./audio/wu-encounter.mp3',name:'忘记时间 · 无谌初遇'}),
});
export const encounterMusicNodes=Object.freeze(['sahaiConverge','sahaiAsk','sahaiRibbon','sahaiLily','sahaiEnd','sahaiPalm','sahaiSeed','sahaiBloom','sahaiThread','sahaiOutside','sahaiCall','sahaiFinalChoice','endingWalk','endingLookback','endingProtect','endingAsk']);
// Presentation cues only; never stored in the story/save or used as a condition.
export function musicForScene(id,node,{title=false,returned=false}={}){
  if(title)return 'opening';
  if(!returned&&encounterMusicNodes.includes(id))return 'encounter';
  if(node?.endCard||returned||id?.startsWith('storm_')||id?.startsWith('ending'))return 'quiet';
  if(id?.startsWith('prologue')&&node?.scene!=='upperCourt')return 'quiet';
  if(id?.startsWith('sahai')&&id!=='sahaiStart')return 'quiet';
  return 'light';
}
