const MAJOR_TAROT = [
  ['愚人', '出发、自由、未知'], ['魔术师', '行动、创造、掌控'], ['女祭司', '直觉、沉静、秘密'],
  ['皇后', '滋养、丰盛、感受'], ['皇帝', '秩序、边界、担当'], ['教皇', '传统、指引、信念'],
  ['恋人', '选择、关系、契合'], ['战车', '意志、推进、胜利'], ['力量', '勇气、耐心、温柔'],
  ['隐者', '独处、寻找、智慧'], ['命运之轮', '转折、周期、机缘'], ['正义', '平衡、因果、决定'],
  ['倒吊人', '暂停、换位、放下'], ['死神', '结束、蜕变、重启'], ['节制', '调和、疗愈、节奏'],
  ['恶魔', '欲望、依附、诱惑'], ['高塔', '骤变、真相、释放'], ['星星', '希望、灵感、恢复'],
  ['月亮', '迷雾、潜意识、不安'], ['太阳', '明朗、活力、喜悦'], ['审判', '觉醒、回应、重生'],
  ['世界', '完成、整合、圆满'],
]

const TAROT_SUITS = [
  ['权杖', '行动、热情、创造'],
  ['圣杯', '情感、关系、直觉'],
  ['宝剑', '思考、冲突、决断'],
  ['星币', '现实、资源、稳定'],
]
const TAROT_RANKS = ['王牌', '二', '三', '四', '五', '六', '七', '八', '九', '十', '侍从', '骑士', '王后', '国王']

const LENORMAND = [
  ['骑士', '消息与行动', '🐎'], ['四叶草', '小幸运与机会', '🍀'], ['船', '远方与探索', '⛵'],
  ['房屋', '家庭与安全', '🏠'], ['树', '成长与健康', '🌳'], ['云', '疑惑与变化', '☁️'],
  ['蛇', '复杂与迂回', '🐍'], ['棺材', '结束与停顿', '⚰️'], ['花束', '礼物与喜悦', '💐'],
  ['镰刀', '果断与切割', '🌾'], ['鞭子', '争执与重复', '〰️'], ['鸟', '交谈与焦虑', '🐦'],
  ['孩子', '新生与单纯', '🧸'], ['狐狸', '谨慎与策略', '🦊'], ['熊', '力量与保护', '🐻'],
  ['星星', '愿景与指引', '⭐'], ['鹳', '迁移与改善', '🪽'], ['狗', '忠诚与朋友', '🐕'],
  ['塔', '独立与机构', '🗼'], ['花园', '社交与公开', '🌷'], ['山', '阻碍与坚持', '⛰️'],
  ['十字路口', '选择与分岔', '🛤️'], ['老鼠', '消耗与忧虑', '🐁'], ['心', '爱意与热情', '❤️'],
  ['戒指', '承诺与循环', '💍'], ['书', '知识与秘密', '📖'], ['信', '文字与通知', '✉️'],
  ['男人', '重要男性或主动面', '👤'], ['女人', '重要女性或感受面', '👤'], ['百合', '成熟与平和', '🪷'],
  ['太阳', '成功与能量', '☀️'], ['月亮', '情绪与认可', '🌙'], ['钥匙', '答案与确定', '🔑'],
  ['鱼', '流动与财富', '🐟'], ['锚', '稳定与坚持', '⚓'], ['十字架', '责任与考验', '✝️'],
]

const HEXAGRAM_NAMES = [
  '乾', '坤', '屯', '蒙', '需', '讼', '师', '比', '小畜', '履', '泰', '否', '同人', '大有', '谦', '豫',
  '随', '蛊', '临', '观', '噬嗑', '贲', '剥', '复', '无妄', '大畜', '颐', '大过', '坎', '离', '咸', '恒',
  '遁', '大壮', '晋', '明夷', '家人', '睽', '蹇', '解', '损', '益', '夬', '姤', '萃', '升', '困', '井',
  '革', '鼎', '震', '艮', '渐', '归妹', '丰', '旅', '巽', '兑', '涣', '节', '中孚', '小过', '既济', '未济',
]

const RUNES = [
  ['ᚠ', 'Fehu 财富', '收获与流动'], ['ᚢ', 'Uruz 野牛', '力量与恢复'], ['ᚦ', 'Thurisaz 荆棘', '防御与突破'],
  ['ᚨ', 'Ansuz 神谕', '沟通与启示'], ['ᚱ', 'Raidho 旅程', '方向与进展'], ['ᚲ', 'Kenaz 火炬', '洞察与创造'],
  ['ᚷ', 'Gebo 礼物', '交换与伙伴'], ['ᚹ', 'Wunjo 喜悦', '和谐与满足'], ['ᚺ', 'Hagalaz 冰雹', '突变与清理'],
  ['ᚾ', 'Nauthiz 需求', '限制与耐心'], ['ᛁ', 'Isa 冰', '停顿与凝聚'], ['ᛃ', 'Jera 丰年', '周期与回报'],
  ['ᛇ', 'Eihwaz 紫杉', '韧性与转化'], ['ᛈ', 'Perthro 命运', '未知与机缘'], ['ᛉ', 'Algiz 鹿角', '保护与警觉'],
  ['ᛊ', 'Sowilo 太阳', '成功与生命力'], ['ᛏ', 'Tiwaz 战神', '正义与勇气'], ['ᛒ', 'Berkano 白桦', '孕育与新生'],
  ['ᛖ', 'Ehwaz 骏马', '协作与移动'], ['ᛗ', 'Mannaz 人类', '自我与群体'], ['ᛚ', 'Laguz 水', '直觉与顺流'],
  ['ᛜ', 'Ingwaz 种子', '积蓄与完成'], ['ᛞ', 'Dagaz 黎明', '觉醒与转机'], ['ᛟ', 'Othala 家园', '传承与归属'],
]

const MOOD_SLIPS = [
  ['允许今天慢一点', '慢不是停下，只是在照顾自己的节奏。'], ['把没说完的话留给夜风', '不必急着解释清楚所有感受。'],
  ['今天适合被偏爱', '别把所有温柔都分给别人。'], ['先吃一口喜欢的东西', '身体舒服一点，心也会跟着松开。'],
  ['你的直觉已经知道答案', '先听见自己，再听世界。'], ['把烦恼缩小到今天', '只处理眼前这一小块就够了。'],
  ['去晒一会儿太阳', '让光替你整理那些打结的念头。'], ['今天可以理直气壮地休息', '休息不是奖励，是正常需要。'],
  ['留一点期待给明天', '今晚不用把所有事情做完。'], ['你没有落后', '你只是在走自己的路线。'],
  ['适合说一句真心话', '柔软并不等于失去力量。'], ['别替还没发生的事难过', '未来还没有来，先抱住现在。'],
  ['今天的好运藏在小事里', '留心一条消息、一次偶遇或一个念头。'], ['不必回应所有声音', '安静也是一种明确的选择。'],
  ['把注意力收回自己身上', '你的感受比外界的评判更靠近真相。'], ['允许一次小小的任性', '你不必永远懂事。'],
  ['去完成最小的一步', '一点点进展也会让局面松动。'], ['适合整理一个角落', '外部的清爽会给心留出空位。'],
  ['今天别和自己较劲', '已经很努力了，换一种轻一点的方法。'], ['有人正在认真惦记你', '不必因为暂时没听见就怀疑这件事。'],
  ['把答案交给睡醒后的自己', '疲惫时不适合审判人生。'], ['今天适合重新开始', '不需要盛大的仪式，现在就算数。'],
  ['相信那一点点心动', '它也许在提醒你真正想靠近的方向。'], ['先抱抱自己再出发', '被安稳接住的人，才走得更远。'],
]

const BOOK_ANSWERS = [
  '答案就在你第一次想到的那个选项里。', '可以，但别急着一次做完。', '现在不是最好的时机。', '大胆一点，结果会比想象中轻松。',
  '先睡一觉，明天再决定。', '问问那个你真正信任的人。', '别回头，这次往前走。', '会有一个意外的小转机。',
  '把条件说清楚，答案就会出现。', '值得试一次。', '保持沉默反而更有利。', '先处理最让你不舒服的那一部分。',
  '你已经知道该怎么做了。', '换一种方法，不必换掉目标。', '再等一等，信息还没到齐。', '它没有你想得那么严重。',
  '拒绝也完全可以。', '接受这个邀请。', '不要为了证明什么而行动。', '小范围尝试，然后看反馈。',
  '先把注意力放回自己。', '这一次相信运气。', '答案偏向“是”。', '答案偏向“否”。',
  '有人会给你需要的帮助。', '顺其自然，但别完全不行动。', '把它写下来，你会看得更清楚。', '今天先到这里。',
  '选让你更自由的那个。', '别忽略那个很小的警告。', '结果会慢一点，但方向没错。', '它值得一次坦白的谈话。',
  '先做最简单的版本。', '你需要的不是答案，而是许可。', '再问一次，但换个问题。', '会比预期更快。',
  '放弃控制细节。', '把决定推迟三天。', '跟随让你心里安静的选择。', '现在就开始。',
]

function randomIndex(max) {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1)
    globalThis.crypto.getRandomValues(value)
    return Math.floor((value[0] / 4294967296) * max)
  }
  return Math.floor(Math.random() * max)
}

function pickUnique(items, count) {
  const pool = [...items]
  const picked = []
  while (picked.length < count && pool.length) {
    picked.push(pool.splice(randomIndex(pool.length), 1)[0])
  }
  return picked
}

function tarotCards() {
  const major = MAJOR_TAROT.map(([name, meaning], index) => ({ id: `major-${index}`, title: name, detail: meaning, symbol: index === 0 ? '✦' : String(index) }))
  const minor = TAROT_SUITS.flatMap(([suit, meaning]) => TAROT_RANKS.map((rank, index) => ({ id: `${suit}-${index}`, title: `${suit}${rank}`, detail: meaning, symbol: suit[0] })))
  return [...major, ...minor]
}

function drawTarot(count) {
  return pickUnique(tarotCards(), count).map((card) => {
    const reversed = randomIndex(3) === 0
    return { ...card, subtitle: reversed ? '逆位' : '正位', reversed }
  })
}

function drawLenormand(count) {
  return pickUnique(LENORMAND, count).map(([title, detail, symbol], index) => ({ id: `lenormand-${title}-${index}`, title, detail, symbol }))
}

function drawHexagram() {
  const index = randomIndex(HEXAGRAM_NAMES.length)
  return [{ id: `hexagram-${index + 1}`, title: `第 ${index + 1} 卦 · ${HEXAGRAM_NAMES[index]}`, detail: '看变化的方向，也看当下所处的位置。', symbol: String.fromCodePoint(0x4DC0 + index) }]
}

function drawRunes(count) {
  return pickUnique(RUNES, count).map(([symbol, title, detail], index) => ({ id: `rune-${title}-${index}`, title, detail, symbol }))
}

const PLAYING_SUITS = [['♠', '黑桃'], ['♥', '红心'], ['♣', '梅花'], ['♦', '方片']]
const PLAYING_RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
function playingCards() {
  return PLAYING_SUITS.flatMap(([symbol, suit]) => PLAYING_RANKS.map((rank) => ({ id: `${suit}-${rank}`, title: `${suit} ${rank}`, detail: '把它当作今天落到手里的一个线索。', symbol, red: symbol === '♥' || symbol === '♦' })))
}
function drawPlaying(count) { return pickUnique(playingCards(), count) }

function drawMood() {
  const [title, detail] = MOOD_SLIPS[randomIndex(MOOD_SLIPS.length)]
  return [{ id: `mood-${title}`, title, detail, symbol: '❀' }]
}

function drawAnswer() {
  const answer = BOOK_ANSWERS[randomIndex(BOOK_ANSWERS.length)]
  return [{ id: `answer-${answer}`, title: answer, detail: '答案之书只负责给一个方向，最后的决定仍然属于你。', symbol: '✧' }]
}

export const DIVINATION_DECKS = [
  { id: 'tarot', label: '塔罗', icon: '✦', description: '78 张 · 含正逆位', counts: [1, 3], defaultCount: 3, draw: drawTarot },
  { id: 'lenormand', label: '雷诺曼', icon: '☘', description: '36 张 · 读现实线索', counts: [1, 3], defaultCount: 3, draw: drawLenormand },
  { id: 'iching', label: '六十四卦', icon: '䷀', description: '一卦 · 看变化方向', counts: [1], defaultCount: 1, draw: drawHexagram },
  { id: 'runes', label: '卢恩', icon: 'ᚱ', description: '24 枚 · 古老符文', counts: [1, 3], defaultCount: 1, draw: drawRunes },
  { id: 'playing', label: '扑克牌', icon: '♠', description: '52 张 · 随手占一把', counts: [1, 3, 5], defaultCount: 1, draw: drawPlaying },
  { id: 'mood', label: '心情签', icon: '❀', description: '一句此刻的小纸条', counts: [1], defaultCount: 1, draw: drawMood },
  { id: 'answers', label: '答案之书', icon: '▤', description: '问清问题，再翻一页', counts: [1], defaultCount: 1, draw: drawAnswer },
]

export function getDeck(deckId) {
  return DIVINATION_DECKS.find((deck) => deck.id === deckId) || DIVINATION_DECKS[0]
}

export function formatDivinationPrompt(deck, question, cards) {
  const positions = cards.length === 3 ? ['过去 / 起因', '现在 / 核心', '未来 / 走向'] : []
  const cardText = cards.map((card, index) => {
    const position = positions[index] ? `${positions[index]}：` : ''
    const orientation = card.subtitle ? `（${card.subtitle}）` : ''
    return `${index + 1}. ${position}${card.title}${orientation}${card.detail ? `｜${card.detail}` : ''}`
  }).join('\n')
  return `我刚在抽签屋抽了「${deck.label}」。${question ? `\n我的问题是：${question}` : ''}\n抽到的结果：\n${cardText}\n\n请结合我们现在的对话和你对我的了解，解读这次结果。不要重新抽牌，也不要把它说成确定的命运。`
}
