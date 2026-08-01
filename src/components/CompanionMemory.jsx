import { useEffect, useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import { listMemoryFiles, getMemoryFile, putMemoryFile, deleteMemoryFile } from '../services/companion'

const FILENAME_RE = /^[A-Za-z0-9_-]+\.md$/

function formatTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

// VPS 本体记忆管理 — 直接读写生产 Claude Code 会话真实使用的 Auto Memory
// Markdown 文件（不是 Eunoia 自己那套"存入记忆"/G1 记忆，两者互不相关）。
export default function CompanionMemory({ theme, onBack }) {
  const primary = theme?.primary || '#4aacf0'
  const primaryDark = theme?.primaryDark || '#2196d3'

  const [files, setFiles] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [selected, setSelected] = useState(null) // { name, content, mtime, size }
  const [editContent, setEditContent] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [newName, setNewName] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)

  const refreshList = async () => {
    setLoadError(null)
    try {
      const list = await listMemoryFiles()
      setFiles(list)
    } catch (e) {
      setLoadError(e.status === 401 || e.status === 403 ? '未登录 companion，请先在会话设置中登录' : (e.message || '加载失败'))
    }
  }

  useEffect(() => { refreshList() }, [])

  const openFile = async (name) => {
    setSaveError(null)
    try {
      const data = await getMemoryFile(name)
      setSelected(data)
      setEditContent(data.content)
      setDirty(false)
    } catch (e) {
      setSaveError(e.message || '打开失败')
    }
  }

  const closeEditor = () => {
    setSelected(null)
    setEditContent('')
    setDirty(false)
    setSaveError(null)
  }

  const save = async () => {
    if (!selected) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await putMemoryFile(selected.name, editContent)
      setSelected(s => ({ ...s, content: editContent, size: res.size, mtime: res.mtime }))
      setDirty(false)
      await refreshList()
    } catch (e) {
      setSaveError(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (name) => {
    if (!window.confirm(`删除「${name}」？会先保留一份可恢复备份（服务器上单份，不对外提供恢复入口，需要联系管理员手动找回）。`)) return
    try {
      await deleteMemoryFile(name)
      if (selected?.name === name) closeEditor()
      await refreshList()
    } catch (e) {
      setSaveError(e.message || '删除失败')
    }
  }

  const createNew = async () => {
    const name = newName.trim()
    if (!FILENAME_RE.test(name)) {
      setSaveError('文件名只能包含字母/数字/下划线/短横线，并以 .md 结尾')
      return
    }
    try {
      await putMemoryFile(name, '')
      setShowNewForm(false)
      setNewName('')
      await refreshList()
      openFile(name)
    } catch (e) {
      setSaveError(e.message || '创建失败')
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'transparent' }}>
      <div className="flex items-center gap-3 px-4 flex-shrink-0"
        style={{
          paddingTop: 'calc(var(--safe-top) + 14px)', paddingBottom: 12,
          background: 'rgba(255,255,255,0.72)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
          borderBottom: '1px solid rgba(200,220,255,0.25)', boxShadow: '0 2px 12px rgba(74,172,240,0.08)',
        }}>
        <button
          onClick={() => (selected ? closeEditor() : onBack())}
          className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `${primary}18`, color: primary }}
        >
          <ChevronLeft size={18} />
        </button>
        <span className="font-semibold text-sm flex-1" style={{ color: '#2c5282' }}>
          {selected ? selected.name : 'VPS 本体记忆'}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!selected ? (
          <div className="space-y-3">
            <p className="text-[11px]" style={{ color: '#7a9cc0' }}>
              直接管理 VPS 上生产 Claude Code 会话真实使用的 Auto Memory 文件（与 Eunoia 自己的"存入记忆"是两回事）。
            </p>
            {loadError && (
              <div className="text-xs p-3 rounded-xl" style={{ background: 'rgba(255,100,100,0.08)', color: '#e07070' }}>{loadError}</div>
            )}
            {!loadError && files === null && (
              <div className="text-xs text-center py-8" style={{ color: '#a0b8d0' }}>加载中…</div>
            )}
            {!loadError && files?.length === 0 && (
              <div className="text-xs text-center py-8" style={{ color: '#a0b8d0' }}>还没有任何记忆文件</div>
            )}
            {files?.map(f => (
              <div key={f.name}
                onClick={() => openFile(f.name)}
                className="rounded-2xl px-4 py-3 cursor-pointer"
                style={{ background: 'rgba(255,255,255,0.55)', border: '1.5px solid rgba(200,220,255,0.3)' }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold" style={{ color: '#2c5282' }}>{f.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); remove(f.name) }}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ color: '#e07070', background: 'rgba(255,100,100,0.08)' }}
                  >删除</button>
                </div>
                <div className="text-[11px] mt-1" style={{ color: '#a0b8d0' }}>
                  {f.size} 字节 · 更新于 {formatTime(f.mtime)}
                </div>
              </div>
            ))}

            {showNewForm ? (
              <div className="rounded-2xl px-4 py-3 space-y-2" style={{ background: 'rgba(255,255,255,0.55)', border: '1.5px solid rgba(200,220,255,0.3)' }}>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="filename.md"
                  className="w-full text-sm rounded-lg px-3 py-2"
                  style={{ border: '1px solid rgba(200,220,255,0.4)', outline: 'none' }}
                />
                <div className="flex gap-2">
                  <button onClick={createNew} className="flex-1 py-2 rounded-full text-xs font-medium text-white"
                    style={{ background: `linear-gradient(135deg, ${primary}, ${primaryDark})` }}>创建</button>
                  <button onClick={() => { setShowNewForm(false); setNewName('') }} className="flex-1 py-2 rounded-full text-xs"
                    style={{ background: 'rgba(255,255,255,0.6)', color: '#6a90b8' }}>取消</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowNewForm(true)} className="w-full py-2.5 rounded-full text-sm font-medium"
                style={{ background: `${primary}18`, color: primaryDark, border: `1.5px solid ${primary}44` }}>
                + 新建记忆文件
              </button>
            )}
            {saveError && <p className="text-xs" style={{ color: '#e07070' }}>{saveError}</p>}
          </div>
        ) : (
          <div className="space-y-2 h-full flex flex-col">
            <div className="text-[11px]" style={{ color: '#a0b8d0' }}>
              {selected.size} 字节 · 更新于 {formatTime(selected.mtime)}
            </div>
            <textarea
              value={editContent}
              onChange={e => { setEditContent(e.target.value); setDirty(true) }}
              className="flex-1 w-full text-sm rounded-xl p-3"
              style={{ border: '1px solid rgba(200,220,255,0.4)', outline: 'none', resize: 'none', lineHeight: 1.6, minHeight: 300, fontFamily: 'inherit' }}
            />
            {saveError && <p className="text-xs" style={{ color: '#e07070' }}>{saveError}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={!dirty || saving}
                className="flex-1 py-2.5 rounded-full text-sm font-medium text-white"
                style={{ background: (!dirty || saving) ? 'rgba(120,160,220,0.4)' : `linear-gradient(135deg, ${primary}, ${primaryDark})` }}>
                {saving ? '保存中…' : dirty ? '保存修改' : '已保存'}
              </button>
              <button onClick={() => remove(selected.name)} className="px-4 py-2.5 rounded-full text-sm"
                style={{ background: 'rgba(255,100,100,0.08)', color: '#e07070', border: '1px solid rgba(255,100,100,0.2)' }}>
                删除
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
