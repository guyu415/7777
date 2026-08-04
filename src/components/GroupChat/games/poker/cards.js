// 斗地主和炸金花共用的最底层牌面工具——只管"一张牌长什么样、怎么洗牌、
// 怎么显示"，完全不知道任何一种游戏自己的规则（大小顺序、牌型判断都在
// 各自的引擎文件里，因为两种游戏对"谁大谁小"的定义完全不同：斗地主是
// 3最小、2和王最大；炸金花是普通扑克序，A可当最小顺子的一部分）。
//
// rank 统一用 2-14 表示 2,3,...,10,J,Q,K,A；斗地主额外多两张 rank 16/17
// 的 joker（suit:'joker'）。炸金花不用大小王，直接用 createDeck52。

// 同 mysteryEngine.js 的 newId 写法（前缀+时间戳+自增序号）——两种扑克
// 游戏共用一份，避免各自再写一遍。
let idSeq = 0
export function newId(prefix) {
  idSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${idSeq.toString(36)}`
}

export const SUITS = ['♠', '♥', '♣', '♦']

export function createDeck52() {
  const deck = []
  let id = 0
  for (const suit of SUITS) {
    for (let rank = 2; rank <= 14; rank++) {
      deck.push({ id: `c${id++}`, suit, rank })
    }
  }
  return deck
}

export function createDeck54() {
  const deck = createDeck52()
  deck.push({ id: 'joker-small', suit: 'joker', rank: 16 })
  deck.push({ id: 'joker-big', suit: 'joker', rank: 17 })
  return deck
}

// Fisher-Yates，rng 可注入方便测试用确定性伪随机源；不传就是真随机。
export function shuffle(deck, rng = Math.random) {
  const arr = deck.slice()
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function rankLabel(rank) {
  if (rank === 17) return '大王'
  if (rank === 16) return '小王'
  if (rank === 14) return 'A'
  if (rank === 13) return 'K'
  if (rank === 12) return 'Q'
  if (rank === 11) return 'J'
  return String(rank)
}

export function cardLabel(card) {
  if (card.suit === 'joker') return rankLabel(card.rank)
  return `${card.suit}${rankLabel(card.rank)}`
}

export function sortByRankAsc(cards) {
  return cards.slice().sort((a, b) => a.rank - b.rank)
}

export function sortByRankDesc(cards) {
  return cards.slice().sort((a, b) => b.rank - a.rank)
}

// 把模型的原始文字回复解析成一个合法选项索引——两个引擎共用同一份规则：
// 解析不出来数字，或者数字超出这一轮实际给出的选项范围，一律返回 null。
// 调用方看到 null 必须走自动托管，绝不能把模型的原文当成牌/当成下注动作，
// 也不能"猜"一个最接近的选项——这是"模型只能从合法操作列表里选"的硬约束
// 在解析这一步的落地。
export function parseChoiceIndex(text, maxIndexInclusive) {
  if (typeof text !== 'string') return null
  const match = text.match(/-?\d+/)
  if (!match) return null
  const n = Number(match[0])
  if (!Number.isInteger(n) || n < 0 || n > maxIndexInclusive) return null
  return n
}
