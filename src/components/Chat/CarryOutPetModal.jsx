import { useRef, useState } from 'react'
import { X, Upload } from 'lucide-react'
import { useStore } from '../../store'
import { compressImage } from '../../utils/image'

const DEFAULT_PET_IMAGE = '/pets/black-haired-pet.png'

// "抱走"入口的确认弹层：选桌宠形象，确认后把当前这条会话本体挂成全局
// 桌宠（见 store 里的 desktopPet 和 components/DesktopPet.jsx）。不是复制
// 出一个失忆分身——sessionId 绑定的就是这条会话，之后所有互动都会写回它
// 自己的消息记录。
export default function CarryOutPetModal({ theme, session, onClose }) {
  const updateDesktopPet = useStore((s) => s.updateDesktopPet)
  const [petImage, setPetImage] = useState(DEFAULT_PET_IMAGE)
  const fileInputRef = useRef(null)

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const { dataUrl } = await compressImage(file, { maxDim: 420, quality: 0.85, keepGif: false })
      setPetImage(dataUrl)
    } catch {
      // 压缩/解码失败就静默放弃，保留当前选择
    }
  }

  const confirm = () => {
    // 每次新的"抱走"都是新的一趟出门，心情计数器从零开始——不带着上一次
    // 出门攒的烦躁/黏人值。
    updateDesktopPet({
      active: true,
      sessionId: session.id,
      petImage,
      x: window.innerWidth - 102,
      y: window.innerHeight - 300,
      allowSceneAwareness: false,
      moodAffection: 0,
      moodAnnoyance: 0,
      moodUpdatedAt: 0,
    })
    onClose()
  }

  const identity = session?.aiName || session?.name || '它'

  return (
    <div
      className="fixed inset-0 flex items-center justify-center px-6"
      style={{ zIndex: 200, background: 'rgba(20,14,18,.45)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xs rounded-3xl p-5"
        style={{ background: 'rgba(255,255,255,.98)', color: theme.text, boxShadow: '0 20px 60px rgba(0,0,0,.3)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-base">把「{identity}」抱走</div>
          <button onClick={onClose} className="w-8 h-8 grid place-items-center rounded-full" style={{ background: theme.primary + '12' }}><X size={16} /></button>
        </div>
        <p className="text-xs opacity-60 leading-5 mb-3">
          抱走后它会以桌宠的样子跟着你逛遍所有页面，还是这条会话本体——摸它、跟它说话都会真实记进这段聊天记录，回来正式聊天时它还记得。
        </p>

        <div className="flex items-center gap-3 mb-2">
          <div className="w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0" style={{ background: theme.primary + '12' }}>
            <img src={petImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setPetImage(DEFAULT_PET_IMAGE)}
              className="px-3 py-1.5 rounded-lg text-xs"
              style={{ background: petImage === DEFAULT_PET_IMAGE ? theme.primary : theme.primary + '12', color: petImage === DEFAULT_PET_IMAGE ? 'white' : theme.text }}
            >默认形象</button>
            {session?.aiAvatar && (
              <button
                onClick={() => setPetImage(session.aiAvatar)}
                className="px-3 py-1.5 rounded-lg text-xs"
                style={{ background: petImage === session.aiAvatar ? theme.primary : theme.primary + '12', color: petImage === session.aiAvatar ? 'white' : theme.text }}
              >用它头像</button>
            )}
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 rounded-lg text-xs flex items-center gap-1" style={{ background: theme.primary + '12', color: theme.text }}>
              <Upload size={12} />上传
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleUpload} />
          </div>
        </div>

        <button onClick={confirm} className="mt-3 w-full py-2.5 rounded-xl text-sm font-semibold" style={{ background: theme.primary, color: 'white' }}>
          抱走
        </button>
      </div>
    </div>
  )
}
