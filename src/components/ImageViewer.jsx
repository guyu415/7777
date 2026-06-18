import { X, Download } from 'lucide-react'

export default function ImageViewer({ src, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      <img
        src={src}
        alt=""
        className="max-w-full max-h-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <a
        href={src}
        download
        className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 bg-white/10 rounded-full text-white text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <Download size={14} />
        保存图片
      </a>
    </div>
  )
}
