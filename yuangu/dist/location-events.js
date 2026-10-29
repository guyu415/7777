// 沙海前期探索正文。只使用现有状态字段；条件、奖励和记录均留在数据层。
const phase={flags:['chapter-sahai'],notFlags:['prologue-active','sandstorm-started']};
const definitions=[
  {
    id:'battlefield',clue:'windNote',item:'copperClasp',itemName:'沙中的铜扣',
    itemDesc:'半埋在断旗边的旧铜扣，背面没有文字。',path:'M13 20L34 17 37 29 16 32Z M19 23L29 22 30 26 20 27Z',
    found:'断旗下有一点不随沙面移动的暗光。你拨开浮沙，捡起一枚铜扣。扣背空空的，边缘却磨得很亮，像是被人用拇指反复摩挲过。',
    permanentLabel:'走近断旗',
    permanent:'断旗只剩下贴着旗杆的一角。你蹲在它投出的窄影里，手掌贴近沙面。这里仍有一缕急切、紧绷的愿力；没有声音，也没有人告诉你，它曾系在什么念头上。',
    collected:'你将这缕散落的愿力收拢。旗布照旧被风扯动，远处的人照旧低头找着什么。你抬头望了一会儿，把未能知道的那一部分也记在心里。',
    nature:'急切、紧绷，正在消散',amount:2,
    conditionLabel:'问一问整理衣物的人',
    condition:'一个人正把破损的衣物叠成一摞。他看见你掌中的铜扣，伸手比了比其中一处缺口，又很快缩回去。“那件的。还好找着了。”他重新数过布上的记号，低低道：“但愿这些名字，一个也别漏。”',
    wish:'但愿这些名字，一个也别漏。',
    returned:'你把铜扣放进那只摊开的手里。他连着扣回原处，又从头数了一遍。你也跟着默数，到一半便乱了；这回你没再出声，等他自己数完。',
    kept:'你合起手掌，说还想再看看。他没有再伸手，只把那件衣物搁在最上头。铜扣硌着指腹，你站了一会儿，才转开目光。',
    followLabel:'循着记下的沙纹回望',
    follow:'顺着方才记下的风向，断旗的影子果然落在背风一侧。一个人正把叠好的衣物挪过去。你记的是一条风路；他用它护住的，却是一摞你叫不出名字的东西。',
    timeLabel:'听搬运人点数',start:780,end:840,
    timed:'未时，搬运的人回到断旗边点数。数到最后，他把空出来的位置又摸了一遍。“今天先到这里。”没有祈求的话。你能觉出那股不肯松开的牵挂，却不能替他补上没说出口的一句。',
  },
  {
    id:'well',clue:'innRoute',item:'wellWedge',itemName:'井脚的木楔',
    itemDesc:'滚进井脚阴影的木楔，一端留着旧绳磨痕。',path:'M12 31L33 16 36 30 17 34Z M18 30L30 22',
    found:'井脚的阴影里压着一块木楔。你拨了拨，它便从沙里滚出来，掌心留下一点潮意。木头的一端磨得发白，另一端还嵌着细小的绳屑。',
    permanentLabel:'扶着井栏听一会儿',
    permanent:'绳索一下一下擦过石栏。提水的人没有交谈，只在桶升上来时同时探了探头。金铃轻震，你辨出微弱而绵长的牵挂；水面映着几张脸，谁也没有把心事说出来。',
    collected:'你避开桶沿，把井栏附近散落的愿力引向掌中。水位没有变化，排队的人仍等着下一桶。收取完，你把手放回身侧，没有伸向井里。',
    nature:'微弱、绵长，带着牵挂',amount:2,
    conditionLabel:'把木楔拿给扶桶的人看',
    condition:'扶桶的人瞧见木楔，急忙把绳索压在掌下。“正找它呢。”他抬头看了一眼队尾，嘴里念着：“但愿今晚人人都有水喝。”说完，又低头去接旁人递来的空桶。',
    wish:'但愿今晚人人都有水喝。',
    returned:'你将木楔递过去。他抵好松动的绳座，慢慢试了一次，才松开紧咬的牙。你看着那只桶稳稳落下，想问的话也暂时停在了嘴边。',
    kept:'你握着木楔没有递出。他看了看你，改用另一截碎木垫住绳座。井绳再次动起来，擦过石栏的声音比方才更涩。',
    followLabel:'向歇脚的人核对旧驿道',
    follow:'你指着城外的残墙问路。歇脚的人把湿手在衣摆上擦了擦：“那地方早不住人了，门里倒能避风。”你记下他说的用途。井边的愿力没有替你说出这些，是他自己告诉你的。',
    timeLabel:'听见未时的低声祈祷',start:780,end:840,
    timed:'未时，井栏空出半尺阴影。一个老妇人坐下来，捧着还没装满的水罐，低声道：“愿我家那口子能自己走到这口井。”你没有看见她所说的人，只记住了这句确实落进耳里的话。',
    timedWish:'愿我家那口子能自己走到这口井。',
  },
  {
    id:'market',clue:'innRoute',item:'linenThread',itemName:'幔脚的线团',
    itemDesc:'压在布幔石块旁的麻线，线头刚被扯断。',path:'M15 22C9 10 38 10 34 27C30 37 12 34 15 22Z M16 18L33 28 M14 24L29 33 M31 16L20 32 M34 28L41 35',
    found:'压幔的石头旁蜷着一小团麻线。你用两根手指把它捻起来，断开的线头在风里翘着。它只是凡间的麻线，金铃没有因为它多震一下。',
    permanentLabel:'看看粘过的陶碗',
    permanent:'摊主把一只粘过的陶碗转向日光，裂纹亮了一线。他嘴上报着价，手却始终托着碗底。摊前的愿力细碎、急促，你分不清其中有多少种所求，只能把它们的性质记下来。',
    collected:'你收拢摊前无处归附的微光。摊主把碗放回原处，买东西的人还在犹豫。你又瞧了一眼裂纹；金铃安静下来，并没有替任何一桩买卖作主。',
    nature:'细碎、急促，夹着焦虑',amount:3,
    conditionLabel:'问摊主是不是丢了麻线',
    condition:'摊主伸出两根沾着陶灰的手指：“线团？方才明明搁这儿了。”他朝身后的破布包努了努嘴，“把包扎好就能收摊。但愿今天换来的粮够吃几日。”',
    wish:'但愿今天换来的粮够吃几日。',
    returned:'你把麻线放到碗旁。他试着扯了扯，嫌短，却仍仔细绕好布包。“够用了。”你凑近看他最后打的那个结，等他松手，才发现自己也跟着屏住了气。',
    kept:'你把线团绕在指间，迟了一会儿才说想留着。摊主收回手，撕了一条幔角去扎布包。那道新裂口在头顶轻响，你下意识把线攥得更紧。',
    followLabel:'询问旧驿道边的布结',
    follow:'你已经辨过旧驿道，便向卖布的人问起沿路的布结。“认路用的，不是给神看的。”他怕你没听清，又指了一次残墙。你抬手碰了碰金铃，忽然觉得这只安静的铃也未必样样都懂。',
    timeLabel:'看收幔前的最后一桩买卖',start:840,end:900,
    timed:'未时将尽，摊主正要撤幔，一个人举着破陶勺赶来。他们争了半天，最后各退半步。你听见那人离开时说：“但愿回去还能赶上饭。”愿力里那点急意，直到此时才有了你听得懂的去处。',
    timedWish:'但愿回去还能赶上饭。',
  },
  {
    id:'paddock',clue:'horseSigns',item:'leatherLoop',itemName:'栏影里的皮环',
    itemDesc:'落在栏影中的旧皮环，扣眼拉得细长。',path:'M14 17C8 27 20 40 31 31C43 20 30 8 20 13Z M19 20C15 26 23 31 28 25C32 20 25 16 19 20Z',
    found:'栏影里有一只旧皮环。马蹄踩出来的沙坑把它藏住了大半，你用鞋尖拨开沙，再俯身捡起。扣眼被拉得很长，像是有人舍不得换，一直用到了现在。',
    permanentLabel:'在栏边停一停',
    permanent:'马把鼻尖伸出栏缝，嗅过你的袖子，又不感兴趣地缩回去。看马的人攥着一把草站在一旁。愿力从他身侧浮起，绷得很紧；你看了看马，没把自己的猜测当成他的愿望。',
    collected:'你收取栏边散落的愿力，指尖避开了马凑来的鼻息。看马的人还在轻轻拍它的颈侧。马没有忽然驯服，也没有因为你抬手便改变要去的方向。',
    nature:'紧绷、警惕，夹着挂念',amount:2,
    conditionLabel:'向看马的人递出皮环',
    condition:'看马的人用空着的手接了一下，又停住，等你松手。“还能补上。”他低头看着断开的系带，声音压得很低：“但愿今夜不再惊马。”',
    wish:'但愿今夜不再惊马。',
    returned:'你松开手。他把旧皮环穿回系带，试了好几次，最后才把草递到马嘴边。你数着他重复的动作，心想凡人修一件小东西，原来会这样慢。',
    kept:'你说想再留一会儿，把皮环收回掌心。他没有追问，转去找新的系带。马偏头来嗅，你把手藏到身后，没让它碰到。',
    followLabel:'核对新蹄印转弯的位置',
    follow:'新蹄印在沙丘前折向旧驿道，往后便浅了。你只沿外围看了几步，没有追过沙丘。栏边的人喊了一声，像在叫谁；风把后半截吹散，你没有听清，也就没有替那人安上名字。',
    timeLabel:'看远处一闪而过的骑影',start:840,end:900,
    timed:'未时将尽，沙丘后掠过一道骑影，束发的红色只闪了一下。看马的人抬头，手里的草掉了几根。你顺着望去时，人已经远了；你没有叫住他，也不知道他为何出城。',
  },
  {
    id:'buriedInn',clue:'shelterSpot',item:'doorPeg',itemName:'门沙中的木销',
    itemDesc:'残门下半埋的一根木销，沾着旧门轴的灰。',path:'M12 29L34 16 37 21 15 34Z M10 27L15 35 M32 14L39 23',
    found:'残门下露着一截木销。你用指尖把周围的沙推开，木销便松松地落进手里。门板仍然歪着；它不能替这座驿站撑回从前的样子。',
    permanentLabel:'在门洞前辨认余波',
    permanent:'门洞里面凉一些，旧墙上留着挨过火的颜色。一缕疲倦而迟缓的愿力散在门槛附近。这里没有人在祈祷，你便只记下来源与性质，没有把墙上的痕迹读成某个人的心事。',
    collected:'你收拢门槛附近的愿力，微光离开墙根，积沙没有跟着散去。抬脚时，裙角仍被低矮的门板刮了一下。你弯腰解开，记住了这处门洞的高度。',
    nature:'迟缓、疲倦，仍未完全散去',amount:1,
    conditionLabel:'询问檐下歇脚的过路人',
    condition:'檐下的人正用短棍拨残门。他瞥见木销，指了指缺口：“旧的那个，原来埋在这儿。”他说完仰头看门楣，又低声添了一句：“但愿这扇门还能挡一夜风。”',
    wish:'但愿这扇门还能挡一夜风。',
    returned:'你将木销递给他。他试着插回去，门板总算少晃了一点；再推，仍旧推不严。他叹口气，把短棍支好。你看着那道剩下的缝，没有抬手去填。',
    kept:'你把木销留在掌心，说想看看旧门怎么拼起来。那人只好将短棍往深处抵。他让你站远些，你便挪开半步，仍忍不住回头看。',
    followLabel:'复核墙内的避风位置',
    follow:'你从记下的浅沙处向外望，正好能看见旧驿道。旧驿道上没有马经过。你绕过松动的砖，把进出的路径又看了一遍，随后退回外围。',
    timeLabel:'听歇脚的人催同伴上路',start:780,end:870,
    timed:'未时，檐下的人拍着衣摆催同伴离开。“再歇下去，日落都到不了城门。”他没向你许愿，你也没有替他们算出归期。等脚步远了，门里只剩风擦过积沙的声音。',
  },
];
export const locationItems={},locationNodes={},locationProps={},locationActions={},locationRecords=[];
const node=(scene,text,next)=>({scene,actor:null,speaker:'narrator',text,next});
for(const d of definitions){
  const id=d.id,hub=`hub_${id}`,prefix=`explore_${id}`,flag=`explore-${id}`;
  const collected=`${flag}-collected`,resolved=`${flag}-object-resolved`;
  const observation=`${prefix}_observe`,expression=`${prefix}_expression`;
  locationItems[d.item]={name:d.itemName,description:d.itemDesc};
  locationProps[id]={item:d.item,label:`拾起${d.itemName}`,path:d.path,action:{id:`${flag}-hidden`,label:`拾起${d.itemName}`,target:`${prefix}_found`,once:`${flag}-found`,when:phase,effects:{items:{[d.item]:1},flags:[`${flag}-hidden-seen`]}}};
  locationNodes[`${prefix}_found`]=node(id,d.found,hub);
  locationNodes[observation]={...node(id,d.permanent),choices:[
    {id:`${flag}-collect`,label:'只收取散落的愿力',detail:`已收取愿力 +${d.amount} · 不代表应允`,target:`${prefix}_collected`,once:collected,requiresItems:{goldBell:1},effects:{wish:d.amount,hidden:{xunxu:1},flags:[collected]}},
    {label:'记下性质，继续巡视',detail:'不消耗行动',target:hub,effects:{flags:[`${flag}-observed`]}}
  ]};
  locationNodes[`${prefix}_collected`]=node(id,d.collected,hub);
  locationNodes[expression]={...node(id,d.condition),choices:[
    {id:`${flag}-return`,label:`把${d.itemName.replace(/.*的/,'')}交给他`,detail:'归还物品 · 不动用神力',target:`${prefix}_returned`,requiresItems:{[d.item]:1},mutex:resolved,effects:{items:{[d.item]:-1},hidden:{rushi:1},flags:[resolved,`${flag}-returned`]}},
    {id:`${flag}-keep`,label:'暂时留在手里',detail:'保留物品',target:`${prefix}_kept`,mutex:resolved,effects:{hidden:{yuejie:1},flags:[resolved,`${flag}-kept`]}}
  ]};
  locationNodes[`${prefix}_returned`]=node(id,d.returned,hub);
  locationNodes[`${prefix}_kept`]=node(id,d.kept,hub);
  locationNodes[`${prefix}_follow`]=node(id,d.follow,hub);
  locationNodes[`${prefix}_timed`]=node(id,d.timed,hub);
  locationActions[id]=[
    {id:`${flag}-permanent`,label:d.permanentLabel,detail:'留意眼前 · 不消耗行动',target:observation,when:phase,effects:{flags:[`${flag}-observed`]}},
    {id:`${flag}-condition-object`,label:d.conditionLabel,detail:'物件牵出的交谈 · 不消耗行动',target:expression,once:`${flag}-expression`,conditional:true,when:phase,requiresItems:{[d.item]:1},...(id==='buriedInn'?{timeWindow:{start:660,end:870},when:{...phase,notFlags:[...phase.notFlags,`${flag}-hour-seen`]}}:{})},
    {id:`${flag}-condition-survey`,label:d.followLabel,detail:'核对已得线索 · 不消耗行动',target:`${prefix}_follow`,once:`${flag}-follow`,conditional:true,when:{...phase,flags:[...phase.flags,`surveyed-${id}`]},requiresItems:{[d.clue]:1},effects:{hidden:{xunxu:1},flags:[`${flag}-clue-confirmed`]}},
    {id:`${flag}-time`,label:d.timeLabel,detail:`此刻的见闻 · 不消耗行动`,target:`${prefix}_timed`,once:`${flag}-timed`,conditional:true,when:phase,timeWindow:{start:d.start,end:d.end},effects:{hidden:{rushi:1},flags:[`${flag}-hour-seen`]}}
  ];
  locationRecords.push(
    {id:`${flag}-signal`,title:`${({battlefield:'断旗',well:'井栏',market:'陶碗',paddock:'马栏',buriedInn:'门槛'})[id]}旁的余波`,source:({battlefield:'战场遗址',well:'王城井边',market:'临时集市',paddock:'城外马场',buriedInn:'半埋驿站'})[id],nature:d.nature,observedNodes:[observation],collectionFlags:[collected]},
    {id:`${flag}-spoken`,title:'物件牵出的愿望',source:({battlefield:'整理衣物的人',well:'扶桶的人',market:'扎包的摊主',paddock:'看马的人',buriedInn:'檐下过路人'})[id],nature:'由对方亲口表达；未单独收取',wishText:d.wish,expressionNodes:[expression]},
  );
  if(d.timedWish)locationRecords.push({id:`${flag}-hour-wish`,title:'时辰中的一句愿望',source:`${({well:'王城井边 · 老妇人',market:'临时集市 · 买勺的人'})[id]}`,nature:'牵挂、急切；未单独收取',wishText:d.timedWish,expressionNodes:[`${prefix}_timed`]});
}
export const locationDefinitions=definitions;
