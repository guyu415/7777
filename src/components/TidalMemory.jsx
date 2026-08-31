import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronUp, Eraser, RefreshCw, RotateCcw, Save } from 'lucide-react'
import { getTidalMemoryStatus, saveTidalMemorySummary } from '../services/companion'
import {
  EMPTY_LONG_TERM_TEXT,
  EMPTY_RECENT_TEXT,
  EMPTY_ROLLING_SUMMARY,
  formatTidalCoverage,
  formatTidalTime,
  mergeTidalLayers,
  parseTidalSummary,
  renderTidalLongTerm,
  renderTidalRecent,
  tidalStatusPresentation,
} from '../utils/tidalMemory'

function splitSummaryText(text) {
  const fields = parseTidalSummary(text)
  return [renderTidalLongTerm(fields), renderTidalRecent(fields)]
}

function Card({ children, style }) {
  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(255,255,255,0.64)', border: '1.5px solid rgba(200,220,255,0.3)', ...style }}>
      {children}
    </div>
  )
}

export default function TidalMemory({ theme, onBack }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'
  const [status, setStatus] = useState(null)
  const [longTermDraft, setLongTermDraft] = useState('')
  const [recentDraft, setRecentDraft] = useState('')
  const [savedLongTerm, setSavedLongTerm] = useState('')
  const [savedRecent, setSavedRecent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(null)
  const [coreOpen, setCoreOpen] = useState(false)
  const [checkpointOpen, setCheckpointOpen] = useState(false)

  const dirty = longTermDraft !== savedLongTerm || recentDraft !== savedRecent
  const tideView = tidalStatusPresentation(status?.tide)
  const saveBlocked = status?.tide?.status === 'running' || status?.tide?.status === 'retry_wait'

  const load = useCallback(async ({ discardDraft = false } = {}) => {
    setLoading(true)
    setFeedback(null)
    try {
      const next = await getTidalMemoryStatus()
      const nextText = next.rollingSummary?.text || EMPTY_ROLLING_SUMMARY
      const [nextLongTerm, nextRecent] = splitSummaryText(nextText)
      setStatus(next)
      if (discardDraft || !dirty) {
        setLongTermDraft(nextLongTerm)
        setRecentDraft(nextRecent)
        setSavedLongTerm(nextLongTerm)
        setSavedRecent(nextRecent)
      } else if (next.revision !== status?.revision) {
        setFeedback({ type: 'error', text: '摘要已在别处更新。当前修改未丢失，请复制留存或取消修改后刷新。' })
      }
    } catch (error) {
      setFeedback({ type: 'error', text: error.status === 401 || error.status === 403 ? '未登录 companion，请先返回会话设置登录。' : (error.message || '读取失败') })
    } finally {
      setLoading(false)
    }
  }, [dirty, status?.revision])

  useEffect(() => {
    let live = true
    getTidalMemoryStatus()
      .then((next) => {
        if (!live) return
        const text = next.rollingSummary?.text || EMPTY_ROLLING_SUMMARY
        const [nextLongTerm, nextRecent] = splitSummaryText(text)
        setStatus(next)
        setLongTermDraft(nextLongTerm)
        setRecentDraft(nextRecent)
        setSavedLongTerm(nextLongTerm)
        setSavedRecent(nextRecent)
      })
      .catch((error) => {
        if (!live) return
        setFeedback({ type: 'error', text: error.status === 401 || error.status === 403 ? '未登录 companion，请先返回会话设置登录。' : (error.message || '读取失败') })
      })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const handleRefresh = () => {
    if (dirty && !window.confirm('刷新会放弃尚未保存的修改，继续吗？')) return
    void load({ discardDraft: true })
  }

  const handleCancel = () => {
    setLongTermDraft(savedLongTerm)
    setRecentDraft(savedRecent)
    setFeedback(null)
  }

  const handleClear = () => {
    setLongTermDraft(EMPTY_LONG_TERM_TEXT)
    setRecentDraft(EMPTY_RECENT_TEXT)
    setFeedback(null)
  }

  const handleSave = async () => {
    if (!status || !dirty || saving || saveBlocked) return
    const merged = mergeTidalLayers(longTermDraft, recentDraft)
    if (!merged) {
      setFeedback({ type: 'error', text: '请保留两个框各自的三个固定标题和冒号（标题下的内容可以留空）。' })
      return
    }
    setSaving(true)
    setFeedback(null)
    try {
      const next = await saveTidalMemorySummary({
        sessionId: status.sessionId,
        expectedRevision: status.revision,
        summaryText: merged,
      })
      const nextText = next.rollingSummary?.text || merged
      const [nextLongTerm, nextRecent] = splitSummaryText(nextText)
      setStatus(next)
      setLongTermDraft(nextLongTerm)
      setRecentDraft(nextRecent)
      setSavedLongTerm(nextLongTerm)
      setSavedRecent(nextRecent)
      setFeedback({ type: 'success', text: '摘要已保存，并写入 CC 的权威潮汐记忆。' })
    } catch (error) {
      const conflict = error.status === 409 || error.code === 'version_conflict' || error.code === 'tidal_active'
      setFeedback({ type: 'error', text: conflict ? '摘要或潮汐状态已变化，请刷新后重试；你的输入仍保留在文本框中。' : (error.message || '保存失败，旧摘要保持不变。') })
    } finally {
      setSaving(false)
    }
  }

  const metadata = useMemo(() => [
    ['最后更新', formatTidalTime(status?.rollingSummary?.updatedAt)],
    ['摘要模型', status?.rollingSummary?.model || (status?.rollingSummary?.source === 'manual' ? '人工创建' : '—')],
    ['覆盖到', formatTidalCoverage(status?.coverage)],
  ], [status])

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      <div className="flex items-center gap-3 px-4 flex-shrink-0" style={{ paddingTop: 'calc(var(--safe-top) + 14px)', paddingBottom: 12, background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', borderBottom: '1px solid rgba(200,220,255,0.25)', boxShadow: '0 2px 12px rgba(74,172,240,0.08)' }}>
        <button onClick={onBack} className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: `${primary}18`, color: primary }} aria-label="返回">
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-sm flex-1" style={{ color: '#2c5282' }}>潮汐记忆</span>
        <button onClick={handleRefresh} disabled={loading || saving} className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: `${primary}12`, color: primary, opacity: loading || saving ? 0.5 : 1 }} aria-label="刷新状态">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ paddingBottom: 'calc(var(--safe-bottom) + 20px)' }}>
        <p className="text-[11px] leading-relaxed" style={{ color: '#7798bb' }}>
          这里显示 CC 固定聊天窗口正在使用的分层记忆：长期基线保留稳定关系与事实，最老的闭合事件才会逐渐模糊；边界之后的原文会尽可能完整保留。每次整理前由 CC 自己确认闭合边界并留下主观检查点。
        </p>

        {status && (
          <Card>
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-medium" style={{ color: '#2c5282' }}>最近一次潮汐整理</span>
              <span className="px-2.5 py-1 rounded-full text-[11px] font-medium" style={{ color: tideView.color, background: tideView.background }}>{tideView.label}</span>
            </div>
            {status.tide?.status === 'retry_wait' && <div className="text-[11px]" style={{ color: '#9a7a48' }}>预计重试：{formatTidalTime(status.tide.retryAt)}</div>}
            {status.tide?.status === 'failed' && <div className="text-[11px]" style={{ color: '#b36b72' }}>本次未更新摘要，原有内容保持不变。</div>}
            <div className="grid grid-cols-1 gap-1.5 mt-2">
              {metadata.map(([label, value]) => <div key={label} className="text-[11px] flex gap-2"><span className="w-14 flex-shrink-0" style={{ color: '#9ab0c7' }}>{label}</span><span className="break-all" style={{ color: '#59799a' }}>{value}</span></div>)}
            </div>
          </Card>
        )}

        <Card>
          <button type="button" onClick={() => setCoreOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
            <div>
              <div className="text-xs font-medium" style={{ color: '#2c5282' }}>核心记忆摘要</div>
              <div className="text-[10px] mt-0.5" style={{ color: '#9ab0c7' }}>{status?.coreMemory ? `更新于 ${formatTidalTime(status.coreMemory.updatedAt)}` : '当前没有核心记忆摘要'}</div>
            </div>
            {coreOpen ? <ChevronUp size={16} color="#7394b6" /> : <ChevronDown size={16} color="#7394b6" />}
          </button>
          {coreOpen && <div className="mt-3 p-3 rounded-xl text-xs whitespace-pre-wrap overflow-y-auto" style={{ color: '#4f7092', background: 'rgba(235,244,255,0.65)', maxHeight: '45vh', lineHeight: 1.7 }}>{status?.coreMemory?.text || '（无）'}</div>}
        </Card>

        <Card>
          <button type="button" onClick={() => setCheckpointOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
            <div>
              <div className="text-xs font-medium" style={{ color: '#2c5282' }}>CC 的主观连续性检查点</div>
              <div className="text-[10px] mt-0.5" style={{ color: '#9ab0c7' }}>{status?.subjectiveCheckpoint ? `由 CC 写于 ${formatTidalTime(status.subjectiveCheckpoint.updatedAt)}` : '尚未形成检查点'}</div>
            </div>
            {checkpointOpen ? <ChevronUp size={16} color="#7394b6" /> : <ChevronDown size={16} color="#7394b6" />}
          </button>
          {checkpointOpen && (
            <div className="mt-3 p-3 rounded-xl text-xs whitespace-pre-wrap overflow-y-auto" style={{ color: '#4f7092', background: 'rgba(235,244,255,0.65)', maxHeight: '45vh', lineHeight: 1.7 }}>
              {status?.subjectiveCheckpoint?.value ? [
                ['对自己的当前理解', status.subjectiveCheckpoint.value.selfUnderstanding],
                ['对用户与关系的当前理解', status.subjectiveCheckpoint.value.relationshipUnderstanding],
                ['最近改变或加深的看法', status.subjectiveCheckpoint.value.changedViews],
                ['仍未闭合的部分', status.subjectiveCheckpoint.value.unresolved],
                ['自然继续的位置', status.subjectiveCheckpoint.value.continuation],
              ].map(([label, value]) => `${label}：${value}`).join('\n') : '（无）'}
            </div>
          )}
        </Card>

        <Card style={{ border: `1.5px solid ${primary}44` }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-xs font-medium" style={{ color: '#2c5282' }}>长期记忆摘要</div>
              <div className="text-[10px] mt-0.5" style={{ color: '#9ab0c7' }}>{status?.rollingSummary ? `版本 ${status.revision}${status.rollingSummary.source === 'manual' ? ' · 已人工修订' : ''}` : '尚无摘要，可按固定六段格式创建'}</div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[10px]" style={{ color: primaryDark, background: `${primary}14` }}>固定上限</span>
          </div>
          <textarea
            value={longTermDraft}
            onChange={(event) => setLongTermDraft(event.target.value)}
            maxLength={2600}
            spellCheck={false}
            className="w-full rounded-xl px-3 py-3 text-sm outline-none"
            style={{ minHeight: 260, resize: 'vertical', color: '#315778', background: 'rgba(248,252,255,0.9)', border: `1px solid ${dirty ? `${primary}88` : 'rgba(150,185,220,0.38)'}`, lineHeight: 1.7 }}
            aria-label="长期记忆摘要"
          />
          <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#9ab0c7' }}><span>保留身份、关系里程碑、明确约定和稳定偏好</span><span>{longTermDraft.length}/2600</span></div>
        </Card>

        <Card>
          <div className="flex items-center justify-between gap-2 mb-2">
            <div>
              <div className="text-xs font-medium" style={{ color: '#2c5282' }}>已模糊的早期事件概括</div>
              <div className="text-[10px] mt-0.5" style={{ color: '#9ab0c7' }}>只覆盖 CC 已确认闭合的旧前缀；当前状态以检查点和边界后原文为准</div>
            </div>
          </div>
          <textarea
            value={recentDraft}
            onChange={(event) => setRecentDraft(event.target.value)}
            maxLength={2400}
            spellCheck={false}
            className="w-full rounded-xl px-3 py-3 text-sm outline-none"
            style={{ minHeight: 220, resize: 'vertical', color: '#315778', background: 'rgba(248,252,255,0.9)', border: `1px solid ${dirty ? `${primary}88` : 'rgba(150,185,220,0.38)'}`, lineHeight: 1.7 }}
            aria-label="已模糊的早期事件概括"
          />
          <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#9ab0c7' }}><span>{dirty ? '有未保存修改' : '已与服务端一致'}</span><span>{recentDraft.length}/2400</span></div>
          <p className="text-[10px] mt-2 leading-relaxed" style={{ color: '#8a7aa0' }}>
            两层会作为同一版潮汐记忆一起保存；不会触发 /compact，原始聊天记录不会被修改。
          </p>
          {saveBlocked && <p className="text-[10px] mt-2" style={{ color: '#b87920' }}>潮汐任务正在处理或等待重试，暂不能保存；完成后刷新再试。</p>}
          {feedback && <div className="mt-2 p-2.5 rounded-xl text-xs" style={{ color: feedback.type === 'success' ? '#2f8f5c' : '#c45d65', background: feedback.type === 'success' ? 'rgba(59,159,104,0.08)' : 'rgba(208,95,103,0.08)' }}>{feedback.text}</div>}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button onClick={handleCancel} disabled={!dirty || saving} className="py-2.5 rounded-full text-xs font-medium flex items-center justify-center gap-1" style={{ color: '#6889aa', background: 'rgba(235,243,251,0.9)', opacity: !dirty || saving ? 0.5 : 1 }}><RotateCcw size={13} />取消修改</button>
            <button onClick={handleClear} disabled={saving || loading} className="py-2.5 rounded-full text-xs font-medium flex items-center justify-center gap-1" style={{ color: '#6889aa', background: 'rgba(235,243,251,0.9)', opacity: saving || loading ? 0.5 : 1 }}><Eraser size={13} />清空重写</button>
            <button onClick={handleRefresh} disabled={loading || saving} className="py-2.5 rounded-full text-xs font-medium flex items-center justify-center gap-1" style={{ color: '#6889aa', background: 'rgba(235,243,251,0.9)', opacity: loading || saving ? 0.5 : 1 }}><RefreshCw size={13} />刷新状态</button>
            <button onClick={handleSave} disabled={!dirty || saving || saveBlocked || loading} className="py-2.5 rounded-full text-xs font-medium text-white flex items-center justify-center gap-1" style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})`, opacity: !dirty || saving || saveBlocked || loading ? 0.5 : 1 }}><Save size={13} />{saving ? '保存中…' : '保存摘要'}</button>
          </div>
        </Card>
      </div>
    </div>
  )
}
