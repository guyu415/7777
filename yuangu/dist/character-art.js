// Presentation-only: no game-state, save-schema, dialogue or choice mutations.
export const characterArt = Object.freeze({
  rong: Object.freeze({neutral:'rong-neutral.png',displeased:'rong-displeased.png',stop:'rong-stop.png'}),
  wu: Object.freeze({neutral:'wu-neutral.png',guarded:'wu-guarded.png',lily:'wu-lily.png'}),
  yuan: Object.freeze({neutral:'yuan-neutral.png',happy:'yuan-happy.png',hesitant:'yuan-hesitant.png'}),
});
const expressions = Object.freeze({
  courtRuleBoundary:{rong:'stop'},courtHomeRong:{rong:'displeased'},
  prologueLimit:{yuan:'hesitant'},prologueCollectAsk:{yuan:'hesitant'},
  prologueCourtRule:{rong:'stop'},prologueBoundary:{rong:'stop'},
  prologueLook:{rong:'displeased'},prologueAnswer:{yuan:'hesitant'},
  sahaiConverge:{wu:'guarded'},sahaiAsk:{wu:'guarded',yuan:'happy'},
  sahaiRibbon:{wu:'guarded'},sahaiPalm:{wu:'guarded'},
  sahaiBloom:{wu:'lily'},sahaiThread:{wu:'lily'},endingLookback:{wu:'lily'},
  sahaiOutside:{rong:'displeased'},sahaiCall:{rong:'displeased'},
  sahaiFinalChoice:{rong:'displeased'},endingProtect:{rong:'displeased'},
  endingAsk:{rong:'displeased',yuan:'hesitant'},
});
const names={rong:'容衡',wu:'无谌',yuan:'苑'};
const moods={neutral:'常态',displeased:'不悦',stop:'抬手制止',guarded:'戒备',lily:'垂眼抬掌',happy:'笑意',hesitant:'迟疑'};
export function spriteFor(actor,expression='neutral'){
  const set=characterArt[actor];if(!set)return null;
  const mood=set[expression]?expression:'neutral';
  return {actor,expression:mood,src:`./assets/characters/${set[mood]}`,alt:`${names[actor]} · ${moods[mood]}`};
}
export function characterView(id,node){
  if(!node||node.endCard)return {main:null,player:null,ambient:null};
  const moods=expressions[id]||{};
  return {
    main:node.actor&&node.actor!=='yuan'?spriteFor(node.actor,moods[node.actor]):null,
    player:node.speaker==='yuan'?spriteFor('yuan',moods.yuan):null,
    ambient:node.scene==='upperCourt'&&!node.actor?spriteFor('rong'):null,
  };
}
