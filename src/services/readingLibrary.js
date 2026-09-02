import { strFromU8, unzipSync } from 'fflate'

const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const CHAPTER_HEADING_RE = /^(?:#{1,4}\s+.+|第[0-9一二三四五六七八九十百千万零〇两]+[章节卷回部篇].*)$/

function cleanText(value) {
  return String(value || '').replace(/\r\n?/g, '\n').replace(/[\t\u00a0]+/g, ' ').trim()
}

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, '-').replace(/^-|-$/g, '').slice(0, 42) || 'book'
}

function splitLongParagraph(text, max = 900) {
  const value = cleanText(text)
  if (value.length <= max) return value ? [value] : []
  const pieces = value.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) || [value]
  const result = []
  let current = ''
  for (const piece of pieces) {
    if (current && current.length + piece.length > max) {
      result.push(current.trim())
      current = ''
    }
    if (piece.length > max) {
      if (current) result.push(current.trim())
      current = ''
      for (let index = 0; index < piece.length; index += max) result.push(piece.slice(index, index + max).trim())
    } else current += piece
  }
  if (current.trim()) result.push(current.trim())
  return result.filter(Boolean)
}

function normalizeChapters(chapters, idPrefix) {
  return (chapters || []).map((chapter, chapterIndex) => {
    const rawParagraphs = Array.isArray(chapter?.paragraphs) ? chapter.paragraphs : []
    const texts = rawParagraphs.flatMap(item => splitLongParagraph(typeof item === 'string' ? item : item?.text))
    return {
      id: `${idPrefix}-chapter-${chapterIndex + 1}`,
      title: cleanText(chapter?.title) || `第 ${chapterIndex + 1} 章`,
      paragraphs: texts.map((text, paragraphIndex) => ({
        id: `${idPrefix}-${chapterIndex + 1}-${paragraphIndex + 1}`,
        text,
      })),
    }
  }).filter(chapter => chapter.paragraphs.length)
}

export function bookFromPlainText(raw, metadata = {}) {
  const text = cleanText(raw)
  if (!text) throw new Error('文件里没有可读取的正文。')
  const sourceTitle = cleanText(metadata.title) || '导入的图书'
  const idPrefix = `imported-${Date.now().toString(36)}-${slug(sourceTitle)}`
  const sections = []
  let current = { title: '正文', paragraphs: [] }
  const blocks = text.split(/\n\s*\n+/).flatMap(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    return lines.length > 1 ? lines : [block.trim()]
  }).filter(Boolean)
  for (const block of blocks) {
    const heading = block.replace(/^#{1,4}\s*/, '').trim()
    if (CHAPTER_HEADING_RE.test(block.trim())) {
      if (current.paragraphs.length) sections.push(current)
      current = { title: heading, paragraphs: [] }
    } else {
      current.paragraphs.push(block)
      if (current.paragraphs.length >= 120) {
        sections.push(current)
        current = { title: `续篇 ${sections.length + 1}`, paragraphs: [] }
      }
    }
  }
  if (current.paragraphs.length) sections.push(current)
  const chapters = normalizeChapters(sections, idPrefix)
  if (!chapters.length) throw new Error('没有识别到可阅读的段落。')
  return {
    id: idPrefix,
    title: sourceTitle.replace(/\.(txt|md|markdown)$/i, ''),
    author: cleanText(metadata.author) || '本地导入',
    description: `从 ${metadata.fileName || '本地文件'} 导入 · ${chapters.length} 章`,
    importedAt: Date.now(),
    sourceFormat: metadata.format || 'text',
    chapters,
  }
}

export function bookFromJson(raw, metadata = {}) {
  let parsed
  try { parsed = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { throw new Error('JSON 格式无法解析。') }
  if (!parsed || !Array.isArray(parsed.chapters)) throw new Error('JSON 需要包含 chapters 数组。')
  const title = cleanText(parsed.title || metadata.title) || '导入的图书'
  const idPrefix = `imported-${Date.now().toString(36)}-${slug(title)}`
  const chapters = normalizeChapters(parsed.chapters, idPrefix)
  if (!chapters.length) throw new Error('JSON 中没有可阅读的正文。')
  return {
    id: idPrefix,
    title,
    author: cleanText(parsed.author) || '本地导入',
    description: cleanText(parsed.description) || `从 ${metadata.fileName || 'JSON 文件'} 导入 · ${chapters.length} 章`,
    importedAt: Date.now(),
    sourceFormat: 'json',
    chapters,
  }
}

function dirname(path) {
  const index = path.lastIndexOf('/')
  return index < 0 ? '' : path.slice(0, index + 1)
}

function resolveZipPath(basePath, relativePath) {
  const parts = `${dirname(basePath)}${relativePath}`.split('/')
  const output = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') output.pop()
    else output.push(part)
  }
  return output.join('/')
}

function firstByLocalName(document, name) {
  return document.getElementsByTagNameNS('*', name)[0] || document.getElementsByTagName(name)[0]
}

function epubFromBytes(bytes, fileName) {
  const files = unzipSync(new Uint8Array(bytes))
  const containerBytes = files['META-INF/container.xml']
  if (!containerBytes) throw new Error('EPUB 缺少 container.xml。')
  const xml = new DOMParser().parseFromString(strFromU8(containerBytes), 'application/xml')
  const opfPath = firstByLocalName(xml, 'rootfile')?.getAttribute('full-path')
  if (!opfPath || !files[opfPath]) throw new Error('EPUB 目录无法读取。')
  const opf = new DOMParser().parseFromString(strFromU8(files[opfPath]), 'application/xml')
  const title = cleanText(firstByLocalName(opf, 'title')?.textContent) || fileName.replace(/\.epub$/i, '')
  const author = cleanText(firstByLocalName(opf, 'creator')?.textContent) || '本地导入'
  const manifest = new Map(Array.from(opf.getElementsByTagNameNS('*', 'item')).map(item => [
    item.getAttribute('id'), item.getAttribute('href'),
  ]))
  const spineIds = Array.from(opf.getElementsByTagNameNS('*', 'itemref')).map(item => item.getAttribute('idref')).filter(Boolean)
  const chapters = []
  for (const id of spineIds) {
    const href = manifest.get(id)
    const path = href ? resolveZipPath(opfPath, decodeURIComponent(href.split('#')[0])) : ''
    if (!path || !files[path]) continue
    const document = new DOMParser().parseFromString(strFromU8(files[path]), 'text/html')
    document.querySelectorAll('script,style,nav,svg').forEach(node => node.remove())
    const chapterTitle = cleanText(document.querySelector('h1,h2,h3,title')?.textContent) || `第 ${chapters.length + 1} 章`
    const paragraphs = Array.from(document.querySelectorAll('p,blockquote,li'))
      .map(node => cleanText(node.textContent)).filter(text => text.length > 1)
    if (paragraphs.length) chapters.push({ title: chapterTitle, paragraphs })
  }
  return bookFromJson({ title, author, description: `从 ${fileName} 导入 · EPUB`, chapters }, { fileName })
}

function decodeTextBuffer(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) } catch {}
  try { return new TextDecoder('gb18030').decode(buffer) } catch {}
  return new TextDecoder().decode(buffer)
}

export async function parseReadingBookFile(file) {
  if (!file) throw new Error('请选择图书文件。')
  if (file.size > MAX_IMPORT_BYTES) throw new Error('图书文件不能超过 20 MB。')
  const fileName = file.name || '导入的图书.txt'
  const extension = fileName.split('.').pop()?.toLowerCase()
  const buffer = await file.arrayBuffer()
  if (extension === 'epub') return epubFromBytes(buffer, fileName)
  const text = decodeTextBuffer(buffer)
  if (extension === 'json') return bookFromJson(text, { title: fileName, fileName })
  if (!['txt', 'md', 'markdown'].includes(extension)) throw new Error('目前支持 TXT、Markdown、JSON 和 EPUB。')
  return bookFromPlainText(text, { title: fileName, fileName, format: extension })
}
