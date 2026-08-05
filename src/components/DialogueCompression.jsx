import { useEffect, useRef, useState, useCallback } from 'react'
import { ChevronLeft } from 'lucide-react'
import { getCompressionStatus, regenerateCompression, acceptCompression, downloadCompressionDialogue } from '../services/companion'

function formatTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

// VPS 本体对话压缩审核 — 展示 PreCompact 钩子（CC 自己的自动压缩触发前）或手动
// "重新生成" 产出的摘要草稿，原文自己审，确认后由服务端自动写入 Auto Memory
// （MEMORY_DIR + MEMORY.md 索引），中间不需要手动改文件。
export default function DialogueCompression({ theme, onBack }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [status, setStatus] = useState(null) // { generating, pending, summary, dialogueAvailable, dialogueBytes }
  const [loadError, setLoadError] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [busy, setBusy] = useState(false) // regenerate/accept in flight (this tab's own click)
  const [accepted, setAccepted] = useState(null) // filename, shown briefly after accept
  const pollRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const s = await getCompressionStatus()
      setStatus(s)
      setLoadError(null)
      return s
    } catch (e) {
      setLoadError(e.status === 401 || e.status === 403 ? '未登录 companion，请先在会话设置中登录' : (e.message || '加载失败'))
      return null
    }
  }, [])

  useEffect(() => { load() }, [load])

  // While generating (whether started by this tab or the PreCompact hook
  // elsewhere), poll until it's done — someone else's regenerate should
  // still resolve into this view without a manual refresh.
  useEffect(() => {
    if (status?.generating) {
      pollRef.current = setInterval(async () => {
        const s = await load()
        if (s && !s.generating) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }, 3000)
      return () => { if (pollRef.current) clearInterval(pollRef.current) }
    }
  }, [status?.generating, load])

  const handleRegenerate = async () => {
    setActionError(null)
    setAccepted(null)
    setBusy(true)
    try {
      await regenerateCompression()
      await load()
    } catch (e) {
      setActionError(e.message || '触发失败')
    } finally {
      setBusy(false)
    }
  }

  const handleAccept = async () => {
    setActionError(null)
    setBusy(true)
    try {
      const res = await acceptCompression()
      setAccepted(res.filename)
      await load()
    } catch (e) {
      setActionError(e.message || '接入失败')
    } finally {
      setBusy(false)
    }
  }

  const handleDownload = async () => {
    setActionError(null)
    try {
      await downloadCompressionDialogue()
    } catch (e) {
      setActionError(e.message || '下载失败')
    }
  }

  const s = status
  const summary = s?.summary

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      <div className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)', paddingBottom: 12,
          background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(200,220,255,0.25)', boxShadow: '0 2px 12px rgba(74,172,240,0.08)',
        }}>
        <button
          onClick={onBack}
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `${primary}18`, color: primary }}
        >
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-sm flex-1" style={{ color: '#2c5282' }}>对话压缩审核</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        <p className="text-[11px]" style={{ color: '#7a9cc0' }}>
          CC 自己的自动压缩触发前会自动跑一次提取+摘要，存在这里等你审核；也可以随时手动重新生成。确认后自动写入
          VPS 本体的 Auto Memory，不需要手动改文件。
        </p>

        {loadError && (
          <div className="text-xs p-3 rounded-xl" style={{ background: 'rgba(255,100,100,0.08)', color: '#e07070' }}>{loadError}</div>
        )}

        {!loadError && s === null && (
          <div className="text-xs text-center py-8" style={{ color: '#a0b8d0' }}>加载中…</div>
        )}

        {!loadError && s && s.generating && (
          <div className="rounded-2xl px-4 py-6 text-center" style={{ background: 'rgba(255,255,255,0.55)', border: '1.5px solid rgba(200,220,255,0.3)' }}>
            <div className="text-sm" style={{ color: '#2c5282' }}>正在生成摘要…</div>
            <div className="text-[11px] mt-1" style={{ color: '#a0b8d0' }}>SiliconFlow 免费模型分段处理，一般几十秒</div>
          </div>
        )}

        {!loadError && s && !s.generating && !summary && (
          <div className="rounded-2xl px-4 py-6 text-center space-y-3" style={{ background: 'rgba(255,255,255,0.55)', border: '1.5px solid rgba(200,220,255,0.3)' }}>
            <div className="text-xs" style={{ color: '#a0b8d0' }}>还没有待审核的摘要</div>
            <button
              onClick={handleRegenerate}
              disabled={busy}
              className="px-4 py-2 rounded-full text-xs font-medium text-white"
              style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, opacity: busy ? 0.6 : 1 }}
            >
              {busy ? '启动中…' : '立即生成'}
            </button>
          </div>
        )}

        {!loadError && s && !s.generating && summary && (
          <>
            <div className="rounded-2xl px-4 py-3 space-y-1" style={{ background: 'rgba(255,255,255,0.55)', border: '1.5px solid rgba(200,220,255,0.3)' }}>
              <div className="text-[11px]" style={{ color: '#a0b8d0' }}>生成于 {formatTime(summary.generatedAt)}</div>
              {summary.turns != null && (
                <div className="text-[11px]" style={{ color: '#a0b8d0' }}>
                  {summary.turns} 轮对话{summary.rangeStart ? ` · ${formatTime(summary.rangeStart)} ~ ${formatTime(summary.rangeEnd)}` : ''}
                </div>
              )}
              {summary.model && <div className="text-[11px]" style={{ color: '#a0b8d0' }}>{summary.model}</div>}
            </div>

            <div className="rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap" style={{ background: 'rgba(255,255,255,0.7)', border: '1.5px solid rgba(200,220,255,0.3)', color: '#2c5282', lineHeight: 1.7, maxHeight: 420, overflowY: 'auto' }}>
              {summary.body}
            </div>

            {s.dialogueAvailable && (
              <button
                onClick={handleDownload}
                className="w-full py-2 rounded-full text-xs font-medium"
                style={{ background: 'rgba(255,255,255,0.5)', color: '#4a7aaa', border: '1px solid rgba(120,160,220,0.35)' }}
              >
                下载对话原文（{Math.round((s.dialogueBytes || 0) / 1024)} KB）
              </button>
            )}

            {actionError && <p className="text-xs" style={{ color: '#e07070' }}>{actionError}</p>}
            {accepted && (
              <p className="text-xs" style={{ color: '#3fae6a' }}>已写入 {accepted} ✅</p>
            )}

            <div className="flex gap-2">
              <button
                onClick={handleRegenerate}
                disabled={busy}
                className="flex-1 py-2.5 rounded-full text-sm font-medium"
                style={{ background: 'rgba(255,255,255,0.5)', color: '#4a7aaa', border: '1px solid rgba(120,160,220,0.35)', opacity: busy ? 0.6 : 1 }}
              >
                重新生成
              </button>
              <button
                onClick={handleAccept}
                disabled={busy}
                className="flex-1 py-2.5 rounded-full text-sm font-medium text-white"
                style={{ background: busy ? 'rgba(120,160,220,0.4)' : `linear-gradient(135deg, ${primary}, ${primaryDark})` }}
              >
                {busy ? '处理中…' : '确认接入'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
