import {cgView} from './cinematic-art.js?v=18';
// Scenic presentation is derived from existing nodes, never written into saves.
export const sceneArt=Object.freeze({upperCourt:'upper-court.png',battlefield:'battlefield.png',well:'well.png',market:'market.png',paddock:'paddock.png',buriedInn:'inn-exterior.png',dunes:'battlefield.png',station:'inn-interior.png'});
export function sceneView(id,node){
  const interior=node.scene==='station'||(node.scene==='buriedInn'&&!!node.actor);
  const cg=cgView(id);
  return {src:`./assets/scenes/${cg?cg.file:interior?'inn-interior.png':sceneArt[node.scene]||'battlefield.png'}`,interior,storm:id.startsWith('storm_'),cg};
}
