import { ChevronRight } from 'lucide-react'
import { useStore } from '../../../../store'
import PokerShell from './PokerShell'

// 扑克二级大厅——原来"扑克"入口的占位内容，现在换成三个真正的入口。
// 四川版升级先只露出入口，标"规则待确认"，点不进去——不擅自照普通拖拉机
// 或炒地皮规则实现，等规则确认后再补。
const POKER_GAMES = [
  { id: 'doudizhu', label: '斗地主', icon: '🀄', description: '三人局：你和两位群成员，标准54张牌', available: true },
  { id: 'zhajinhua', label: '炸金花', icon: '🎴', description: '三人局：虚拟筹码，看牌/跟注/加注/弃牌/比牌', available: true },
  { id: 'sichuan_shengji', label: '四川版升级', icon: '🁰', description: '规则待确认，暂不可进入', available: false },
]

export default function PokerHub({ theme, chatId, onPick, onBack }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const doudizhuGame = useStore((s) => s.doudizhuGames?.[chatId])
  const zhajinhuaGame = useStore((s) => s.zhajinhuaGames?.[chatId])
  const inProgress = {
    doudizhu: !!doudizhuGame && !doudizhuGame.finished,
    zhajinhua: !!zhajinhuaGame && !zhajinhuaGame.finished,
  }

  return (
    <PokerShell theme={theme} title="扑克" icon="🃏" onBack={onBack}>
      <main className="flex-1 overflow-y-auto px-4 py-4" style={{ minHeight: 0 }}>
        <div className="text-[11px] mb-3" style={{ color: '#a2798a' }}>
          和群里的 AI 成员坐下来玩一局，用的是他们各自本来的模型和身份。进度只存在这个群聊里，退出再回来能接着玩。
        </div>
        {POKER_GAMES.map((g) => (
          <button
            key={g.id}
            onClick={() => g.available && onPick(g.id)}
            disabled={!g.available}
            className="w-full text-left mb-3"
            style={{
              borderRadius: 18, padding: 16, border: `1px solid ${primary}28`,
              background: 'rgba(255,255,255,0.78)', opacity: g.available ? 1 : 0.55,
              boxShadow: g.available ? `0 2px 10px ${primary}14` : 'none',
            }}
          >
            <div className="flex items-center gap-2.5">
              <span style={{ fontSize: 24 }}>{g.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span style={{ fontSize: 15, fontWeight: 700, color: '#5a3548' }}>{g.label}</span>
                  {inProgress[g.id] && (
                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ background: `${primary}20`, color: primaryDark }}>进行中</span>
                  )}
                  {!g.available && (
                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(0,0,0,0.06)', color: '#a2798a' }}>规则待确认</span>
                  )}
                </div>
                <div className="text-[11px] mt-1" style={{ color: '#a2798a' }}>{g.description}</div>
              </div>
              {g.available && <ChevronRight size={16} color={primary} style={{ flexShrink: 0 }} />}
            </div>
          </button>
        ))}
      </main>
    </PokerShell>
  )
}
