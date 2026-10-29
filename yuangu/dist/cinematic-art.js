// Pure presentation data. These mappings never create wishes or change a save.
export const cgArt=Object.freeze({
  prologueCollected:Object.freeze({file:'cg-collection.png',kind:'collection',alt:'苑将散落的愿力引入掌中'}),
  sahaiSeed:Object.freeze({file:'cg-lily.png',kind:'lily',alt:'苑在无谌掌心种下铃兰'}),
  sahaiBloom:Object.freeze({file:'cg-lily.png',kind:'lily',alt:'无谌垂眼望着掌心真实盛开的铃兰'}),
  sahaiThread:Object.freeze({file:'cg-thread.png',kind:'thread',alt:'一缕未归的愿力绕过铃兰，缠向无谌真灵'}),
});
export function cgView(id){return cgArt[id]||null;}
export const atlasPoints=Object.freeze({
  battlefield:Object.freeze({x:18,y:43}),well:Object.freeze({x:50,y:44}),
  market:Object.freeze({x:82,y:43}),paddock:Object.freeze({x:32,y:66}),buriedInn:Object.freeze({x:74,y:66}),
});
export function collectionDelta(before,after){return Number.isFinite(before)&&Number.isFinite(after)&&after>before?after-before:0;}
// A smooth two-stage trajectory: sand -> palm -> silent bell. Coordinates use the CG, not screen pixels.
export function wishMote(index,time,{palm=[.355,.465],bell=[.633,.80]}={}){
  const seed=(Math.sin(index*127.1+31.7)*43758.5453)%1;
  const random=Math.abs(seed),t=Math.max(0,Math.min(1,time));
  const start=[.08+random*.78,.49+Math.abs(Math.sin(index*9.3))*.25];
  const ease=x=>x*x*(3-2*x);
  const first=t<.68,local=first?ease(t/.68):ease((t-.68)/.32),from=first?start:palm,to=first?palm:bell;
  const bend=Math.sin(local*Math.PI)*(first?.05+random*.08:-.12);
  return {x:from[0]+(to[0]-from[0])*local,y:from[1]+(to[1]-from[1])*local-bend,
    alpha:Math.min(1,t*12,(1-t)*8),radius:.65+random*1.25};
}
