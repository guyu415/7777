import { useState } from 'react'
import { X, Trash2, RotateCcw } from 'lucide-react'

// Same WeChat-style bottom sheet as the member/background drawers (never a
// top-popped panel). Two destructive-but-scoped actions, both explicitly
// confirmed before acting:
//
// - 清空聊天记录: wipes THIS group's messages/candidates/mention grants/
//   pending client turns and starts a blank new topic with quotas reset.
//   Never touches members, avatars, background, or any member's own
//   single-chat memory.
// - 删除群聊: deletes THIS group entirely (messages/topic/members/pending
//   tasks) and returns to the group list. Never touches a member's own
//   single-chat window/memory/avatar/API config.
export default function GroupSettingsDrawer({ theme, onClose, onClearMessages, onDeleteGroup, busy }) {
  const primary = theme?.primary || '#ff85b3'
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const handleClear = () => {
    if (!window.confirm('清空这个群聊的全部聊天记录？话题、候选发言和审批记录也会一并清空，成员和设置保留。此操作不可恢复。')) return
    setConfirmingClear(true)
    onClearMessages().finally(() => setConfirmingClear(false))
  }
  const handleDelete = () => {
    if (!window.confirm('删除这个群聊？删除后不可恢复，群里的消息、话题、成员关系、群头像和背景都会一并删除（不影响任何成员自己的单聊）。确定删除吗？')) return
    setConfirmingDelete(true)
    onDeleteGroup().finally(() => setConfirmingDelete(false))
  }

  return (
    <div className="fixed inset-0 flex items-end" style={{ zIndex: 65, background: 'rgba(0,0,0,0.32)', backdropFilter: 'blur(4px)' }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full flex flex-col"
        style={{
          background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)',
          borderTopLeftRadius: 24, borderTopRightRadius: 24,
          boxShadow: `0 -8px 32px ${primary}30`,
          paddingBottom: 'max(14px, env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="flex items-center justify-between px-4" style={{ paddingTop: 14, paddingBottom: 10 }}>
          <span className="text-sm font-semibold" style={{ color: '#2e1c26' }}>群聊设置</span>
          <button onClick={onClose} aria-label="关闭群聊设置" className="flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}>
            <X size={13} />
          </button>
        </div>

        <div className="px-4" style={{ paddingBottom: 8 }}>
          <button
            onClick={handleClear}
            disabled={busy || confirmingClear}
            className="w-full flex items-center gap-2 py-3 px-3 rounded-2xl text-sm mb-2"
            style={{ background: `${primary}14`, color: '#2e1c26', border: `1px solid ${primary}30`, opacity: (busy || confirmingClear) ? 0.6 : 1 }}
          >
            <RotateCcw size={15} />
            {confirmingClear ? '清空中…' : '清空聊天记录'}
          </button>
          <button
            onClick={handleDelete}
            disabled={busy || confirmingDelete}
            className="w-full flex items-center gap-2 py-3 px-3 rounded-2xl text-sm"
            style={{ background: 'rgba(224,64,64,0.1)', color: '#c02b2b', border: '1px solid rgba(224,64,64,0.3)', opacity: (busy || confirmingDelete) ? 0.6 : 1 }}
          >
            <Trash2 size={15} />
            {confirmingDelete ? '删除中…' : '删除群聊'}
          </button>
        </div>
      </div>
    </div>
  )
}
