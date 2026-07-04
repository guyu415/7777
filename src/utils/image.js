// Canvas 图片压缩：缩放到 maxDim 内并重编码为 JPEG。
// 聊天图片和头像在进入 store / 云同步之前都必须过这里——
// Cloudflare KV 免费版单 value 上限 25 MiB、每天 1000 次写入，
// 原图 base64 直接入库会把配额和体积双双打爆。

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片解码失败'))
    img.src = src
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
    reader.readAsDataURL(blob)
  })
}

function dataUrlMime(dataUrl) {
  return dataUrl.slice(5).split(/[;,]/)[0] || 'image/jpeg'
}

/**
 * 压缩一张图片。
 * @param {File|Blob|string} source 文件、Blob 或 data URL
 * @param {{maxDim?: number, quality?: number, keepGif?: boolean}} opts
 *   keepGif=false 时 GIF 也会被重编码成静态 JPEG（用于必须压小的场景，如头像瘦身）
 * @returns {Promise<{dataUrl: string, base64: string, mimeType: string}>}
 */
export async function compressImage(source, { maxDim = 1280, quality = 0.8, keepGif = true } = {}) {
  const srcDataUrl = typeof source === 'string' ? source : await blobToDataUrl(source)

  // GIF 重编码会丢动画，默认原样保留
  if (keepGif && srcDataUrl.startsWith('data:image/gif')) {
    return { dataUrl: srcDataUrl, base64: srcDataUrl.split(',')[1], mimeType: 'image/gif' }
  }

  const img = await loadImage(srcDataUrl)
  const srcW = img.naturalWidth || img.width
  const srcH = img.naturalHeight || img.height
  const scale = Math.min(1, maxDim / Math.max(srcW, srcH, 1))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  // JPEG 没有透明通道，透明 PNG 直接画会变黑底
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)

  const dataUrl = canvas.toDataURL('image/jpeg', quality)

  // 没缩尺寸且重编码反而更大时（小图/已压缩过的图），保留原图
  if (scale === 1 && dataUrl.length >= srcDataUrl.length) {
    return { dataUrl: srcDataUrl, base64: srcDataUrl.split(',')[1], mimeType: dataUrlMime(srcDataUrl) }
  }
  return { dataUrl, base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' }
}

// ── 云端 settings 就地瘦身 ──────────────────────────────────────────
// 云端可能还留着旧版上传的"胖配置"（原图头像/内联背景）。恢复进 store 之前
// 必须先压小：zustand persist 会把整个 settings 写进 localStorage，Safari
// 上限约 5MB，胖配置直接触发 QuotaExceededError（"The quota has been
// exceeded."），登录流程当场中断——这正是换新手机登不上去的最后一环。

const AVATAR_LIMIT = 60_000   // data URL 字符数 ≈ 45KB 二进制
const BG_LIMIT = 400_000      // ≈ 300KB 二进制

async function slimDataUrl(v, limit, opts) {
  if (typeof v !== 'string' || !v.startsWith('data:image/') || v.length <= limit) return v
  try {
    const { dataUrl } = await compressImage(v, opts)
    return dataUrl.length < v.length ? dataUrl : v
  } catch {
    return v
  }
}

/**
 * 压缩 settings 对象里所有内联的超大图片（全局/会话头像、内联聊天背景）。
 * @returns {Promise<{settings: object, changed: boolean}>}
 */
export async function slimSettings(settings) {
  const avatarOpts = { maxDim: 384, quality: 0.82, keepGif: false }
  const bgOpts = { maxDim: 1920, quality: 0.85 }
  let changed = false
  const track = async (v, limit, opts) => {
    const out = await slimDataUrl(v, limit, opts)
    if (out !== v) changed = true
    return out
  }
  const slimBg = async (bg) => {
    if (!bg || bg.type !== 'image' || !bg.value) return bg
    const value = await track(bg.value, BG_LIMIT, bgOpts)
    return value === bg.value ? bg : { ...bg, value }
  }

  const out = { ...settings }
  out.userAvatar = await track(settings.userAvatar, AVATAR_LIMIT, avatarOpts)
  out.aiAvatar = await track(settings.aiAvatar, AVATAR_LIMIT, avatarOpts)
  out.chatBg = await slimBg(settings.chatBg)

  const sessions = []
  for (const s of (settings.sessions || [])) {
    sessions.push({
      ...s,
      aiAvatar: await track(s.aiAvatar, AVATAR_LIMIT, avatarOpts),
      userAvatar: await track(s.userAvatar, AVATAR_LIMIT, avatarOpts),
      chatBg: await slimBg(s.chatBg),
    })
  }
  out.sessions = sessions

  return { settings: out, changed }
}
