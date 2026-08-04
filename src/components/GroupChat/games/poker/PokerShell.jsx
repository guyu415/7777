import { ArrowLeft } from 'lucide-react'

// 斗地主/炸金花/扑克大厅共用的全屏外壳——延续 Eunoia 其它页面的浅色暖色
// 调子（不是剧本杀那种沉浸式暗色主题，扑克没有那个叙事氛围的需要）。
export default function PokerShell({ theme, title, icon, onBack, actions, children }) {
  const primary = theme?.primary || '#ff85b3'
  return (
    <div className="fixed inset-0 flex justify-center" style={{ zIndex: 92, background: 'rgba(0,0,0,0.15)' }}>
      <div
        className="h-full w-full max-w-md flex flex-col overflow-hidden"
        style={{ background: 'linear-gradient(170deg, #fff7f8 0%, #fdeef1 45%, #fbe4ea 100%)' }}
      >
        <header
          className="flex items-center justify-between flex-shrink-0"
          style={{ padding: 'max(12px, env(safe-area-inset-top, 0px)) 14px 10px', borderBottom: `1px solid ${primary}22` }}
        >
          <button onClick={onBack} aria-label="返回" className="flex items-center justify-center" style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', background: `${primary}18`, color: primary }}>
            <ArrowLeft size={17} />
          </button>
          <span style={{ fontSize: 15.5, fontWeight: 700, color: '#5a3548' }}>{icon} {title}</span>
          <div className="flex items-center gap-1.5" style={{ minWidth: 36, justifyContent: 'flex-end' }}>{actions}</div>
        </header>
        {children}
      </div>
    </div>
  )
}
