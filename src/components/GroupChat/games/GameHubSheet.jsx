import { GROUP_GAMES } from './gameRegistry'

// 「小游戏」入口弹层。列表来自 gameRegistry，以后加扑克只改 registry，
// 这个组件不用动。
export default function GameHubSheet({ theme, onPick, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  return (
    <div className="fixed inset-0 flex items-end" style={{ zIndex: 68, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full"
        style={{
          background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: `0 -8px 32px ${primary}30`,
          paddingTop: 14,
          paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="px-5 pb-2">
          <div className="text-sm font-semibold" style={{ color: '#5a3548' }}>小游戏</div>
          <div className="text-[10.5px] mt-0.5" style={{ color: '#b98a96' }}>和群里的 AI 成员一起玩，进度只存在这个群聊里</div>
        </div>
        {GROUP_GAMES.map((g) => (
          <button
            key={g.id}
            onClick={() => g.available && onPick(g.id)}
            disabled={!g.available}
            className="w-full flex items-center gap-3"
            style={{ padding: '13px 20px', border: 'none', background: 'transparent', borderBottom: '1px solid rgba(0,0,0,0.04)', opacity: g.available ? 1 : 0.4, textAlign: 'left' }}
          >
            <span style={{ fontSize: 20, width: 26, textAlign: 'center' }}>{g.icon}</span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm" style={{ color: '#5a3548' }}>{g.label}</span>
              <span className="block text-[10.5px]" style={{ color: '#b98a96' }}>{g.description}</span>
            </span>
            {!g.available && <span className="text-[10px] flex-shrink-0" style={{ color: '#c9a2ad' }}>敬请期待</span>}
          </button>
        ))}
        <button onClick={onClose} className="w-full text-center text-xs" style={{ padding: '12px 0 4px', color: '#b98a96', border: 'none', background: 'transparent' }}>
          取消
        </button>
      </div>
    </div>
  )
}
