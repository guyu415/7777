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
 * @param {{maxDim?: number, quality?: number}} opts
 * @returns {Promise<{dataUrl: string, base64: string, mimeType: string}>}
 */
export async function compressImage(source, { maxDim = 1280, quality = 0.8 } = {}) {
  const srcDataUrl = typeof source === 'string' ? source : await blobToDataUrl(source)

  // GIF 重编码会丢动画，原样保留
  if (srcDataUrl.startsWith('data:image/gif')) {
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
