import { useRef } from 'react'
import { X } from 'lucide-react'
import GroupChatBackground from './GroupChatBackground'
import { compressImage } from '../../utils/image'

// Same WeChat-style bottom sheet as GroupMemberDrawer (never a top-popped
// panel). Background images reuse the app's existing compressImage
// pipeline — no new upload/crop/compress component — just with a larger
// maxDim than avatars since this covers the whole screen instead of a small
// circle. Persisted per-group-chat-id only (see store's groupChatBg), never
// touching single-chat or global chatBg.
async function readBgFile(file) {
  try {
    const { dataUrl } = await compressImage(file, { maxDim: 1280, quality: 0.8 })
    return dataUrl
  } catch (err) {
    console.warn('[GROUP-BG] 压缩失败，回退原图:', err.message)
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }
}

export default function GroupBackgroundDrawer({ theme, bg, onUpload, onReset, onClose }) {
  const primary = theme?.primary || '#ff85b3'
  const primaryDark = theme?.primaryDark || '#ff6b9d'
  const fileRef = useRef(null)
  const isCustom = bg?.type === 'image' && !!bg.value

  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    const dataUrl = await readBgFile(file)
    onUpload({ type: 'image', value: dataUrl })
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
          <span className="text-sm font-semibold" style={{ color: '#5a3548' }}>聊天背景</span>
          <button onClick={onClose} aria-label="关闭聊天背景设置" className="flex items-center justify-center flex-shrink-0" style={{ width: 28, height: 28, borderRadius: '50%', background: `${primary}18`, border: 'none', color: primary }}>
            <X size={13} />
          </button>
        </div>

        <div className="px-4" style={{ paddingBottom: 16 }}>
          <div className="relative overflow-hidden mb-4" style={{ width: '100%', height: 140, borderRadius: 18, border: `1px solid ${primary}30` }}>
            <GroupChatBackground bg={bg} />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="flex-1 py-2.5 rounded-full text-sm font-medium"
              style={{ background: `${primary}18`, color: primaryDark, border: `1.5px solid ${primary}44` }}
            >
              📷 从相册上传
            </button>
            {isCustom && (
              <button
                onClick={onReset}
                className="flex-1 py-2.5 rounded-full text-sm font-medium"
                style={{ background: 'rgba(0,0,0,0.05)', color: '#6a3f56', border: 'none' }}
              >
                恢复默认背景
              </button>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
        </div>
      </div>
    </div>
  )
}
