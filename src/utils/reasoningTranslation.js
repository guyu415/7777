// Display-only Claude thinking translation. Nothing in this module writes to
// the chat store, IndexedDB, the companion history, or a model context.

export const REASONING_TRANSLATION_IDLE_MS = 600
export const REASONING_TRANSLATION_CHARS_PER_SECOND = 220
export const REASONING_TRANSLATION_MAX_CONCURRENT = 3

const CACHE_TTL_MS = 10 * 60 * 1000
const CACHE_MAX_ENTRIES = 160
const CONTROLLER_TTL_MS = 20 * 60 * 1000
const CONTROLLER_MAX_ENTRIES = 80
const SOFT_SEGMENT_TARGET = 520
const SOFT_SEGMENT_MIN = 260
const HARD_SEGMENT_MAX = 720

const HAN_RE = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g
const LATIN_RE = /[A-Za-z]/g
const COMMAND_LINE_RE = /^\s*(?:(?:[$>#]\s*)|(?:PS\s+>\s*))?(?:cd|npm|pnpm|yarn|bun|node|python(?:3)?|pip|git|rg|grep|find|ls|cat|curl|wget|ssh|sudo|wrangler|docker|rm|cp|mv|mkdir|chmod|systemctl|journalctl|export|set|which|open|make)\b/i
const COMMAND_INLINE_RE = /\b(?:cd|npm|pnpm|yarn|bun|node|python(?:3)?|pip|git|rg|grep|find|ls|cat|curl|wget|ssh|sudo|wrangler|docker|rm|cp|mv|mkdir|chmod|systemctl|journalctl)\b[^\n]*/gi
const ERROR_LINE_RE = /^\s*(?:\[[^\]]+\]\s*)?(?:error|fatal|failed?|failure|exception|traceback|stack trace|typeerror|referenceerror|syntaxerror)\b/i
const ERROR_CONTENT_RE = /\b(?:error|failed?|failure|exception|traceback|stack trace|HTTP\s+\d{3}|status\s+\d{3})\b/i
const STACK_LINE_RE = /^\s*at\s+\S+/i

const translationCache = new Map()
const controllerRegistry = new Map()

function addRange(ranges, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return
  ranges.push({ start, end })
}

function addRegexRanges(text, regex, ranges) {
  regex.lastIndex = 0
  for (const match of text.matchAll(regex)) addRange(ranges, match.index, match.index + match[0].length)
}

function addLineRanges(text, ranges) {
  let start = 0
  while (start <= text.length) {
    const newline = text.indexOf('\n', start)
    const end = newline === -1 ? text.length : newline
    const line = text.slice(start, end)
    if (COMMAND_LINE_RE.test(line) || ERROR_LINE_RE.test(line) || ERROR_CONTENT_RE.test(line) || STACK_LINE_RE.test(line)) addRange(ranges, start, end)
    if (newline === -1) break
    start = newline + 1
  }
}

function mergeRanges(ranges) {
  return ranges
    .sort((a, b) => a.start - b.start || a.end - b.end)
    .reduce((merged, range) => {
      const previous = merged[merged.length - 1]
      if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end)
      else merged.push({ ...range })
      return merged
    }, [])
}

/**
 * Returns spans that a translation must reproduce byte-for-byte. In addition
 * to explicit code, this protects the technical material most likely to be
 * damaged by a natural-language translation: commands, paths, identifiers,
 * numbers, and standalone error/stack lines.
 */
export function getProtectedReasoningSpans(text) {
  const value = String(text || '')
  const ranges = []
  addRegexRanges(value, /```[\s\S]*?(?:```|$)/g, ranges)
  addRegexRanges(value, /`[^`\n]*`/g, ranges)
  addLineRanges(value, ranges)
  addRegexRanges(value, COMMAND_INLINE_RE, ranges)
  addRegexRanges(value, /\bhttps?:\/\/[^\s<>"'`，。！？；)\]}]+/gi, ranges)
  addRegexRanges(value, /(?:~\/|\.\.?\/|\/)[^\s<>"'`，。！？；：:()\[\]{}]+/g, ranges)
  addRegexRanges(value, /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+(?:\.[A-Za-z0-9_-]+)(?::\d+(?::\d+)?)?\b/g, ranges)
  addRegexRanges(value, /\b[A-Za-z0-9_.-]+\.(?:js|jsx|ts|tsx|json|md|css|html|sh|py|log|yaml|yml)(?::\d+(?::\d+)?)?\b/gi, ranges)
  addRegexRanges(value, /\$[A-Za-z_][A-Za-z0-9_]*/g, ranges)
  addRegexRanges(value, /\b[a-z][A-Za-z0-9]*[A-Z][A-Za-z0-9]*\b/g, ranges)
  addRegexRanges(value, /\b[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+\b/g, ranges)
  addRegexRanges(value, /\b[A-Z][A-Z0-9_]{2,}\b/g, ranges)
  addRegexRanges(value, /\b\d[\dA-Za-z]*(?:[._:-]\d[\dA-Za-z]*)*\b/g, ranges)
  return mergeRanges(ranges).map(({ start, end }) => ({ start, end, text: value.slice(start, end) }))
}

export function isMostlyChinese(text) {
  const value = String(text || '')
  const han = (value.match(HAN_RE) || []).length
  const latin = (value.match(LATIN_RE) || []).length
  return han >= 2 && (latin === 0 || han >= Math.ceil(latin * 0.5))
}

function hasTranslatableEnglish(text) {
  return /[A-Za-z]/.test(text) && !/^(?:\s|[`\d\W])+$/.test(text)
}

export function shouldTranslateReasoningSegment(text) {
  const value = String(text || '')
  if (!value.trim() || isMostlyChinese(value) || !hasTranslatableEnglish(value)) return false
  const protectedLength = getProtectedReasoningSpans(value).reduce((sum, range) => sum + range.end - range.start, 0)
  return protectedLength < value.length
}

// Thinking wire events are intended to be deltas, but a reconnect or a
// duplicated transport delivery can occasionally resend the last complete
// block (or send the cumulative value). Merge only substantial overlaps so
// natural short repetitions such as “好，好” remain untouched.
export function appendReasoningDelta(currentValue, deltaValue) {
  const current = String(currentValue || '')
  const delta = String(deltaValue || '')
  if (!delta) return current
  if (!current) return delta
  if (current.endsWith(delta)) return current
  if (delta.startsWith(current)) return delta

  const minimumOverlap = 8
  const maximumOverlap = Math.min(current.length, delta.length)
  for (let size = maximumOverlap; size >= minimumOverlap; size -= 1) {
    if (current.slice(-size) === delta.slice(0, size)) return current + delta.slice(size)
  }
  return current + delta
}

function rangeAt(ranges, index, from = 0) {
  for (let i = from; i < ranges.length; i += 1) {
    if (index < ranges[i].start) return { range: null, index: i }
    if (index < ranges[i].end) return { range: ranges[i], index: i }
  }
  return { range: null, index: ranges.length }
}

function boundaryAfterPunctuation(text, index) {
  const char = text[index]
  const next = text[index + 1]
  if (char === '.' && next && /[A-Za-z0-9]/.test(next)) return null
  let end = index + 1
  while (end < text.length && /[)\]}>'"”’»」』】〕]/.test(text[end])) end += 1
  if (text[end] === '\n') end += 1
  return end
}

/** Finds a safe end offset for the next display segment. */
export function findReasoningBoundary(text, start = 0, providedRanges = null) {
  const value = String(text || '')
  if (start >= value.length) return null
  const ranges = providedRanges || getProtectedReasoningSpans(value)
  let rangeIndex = 0
  let lastNaturalBoundary = null
  const hardLimit = Math.min(value.length, start + HARD_SEGMENT_MAX)
  for (let index = start; index < hardLimit; index += 1) {
    const located = rangeAt(ranges, index, rangeIndex)
    rangeIndex = located.index
    if (located.range) {
      index = located.range.end - 1
      continue
    }
    const char = value[index]
    let boundary = null
    if (char === '\n') boundary = index + 1
    else if (/[.!?。！？；;]/.test(char)) boundary = boundaryAfterPunctuation(value, index)
    if (boundary && boundary - start >= SOFT_SEGMENT_MIN) {
      lastNaturalBoundary = boundary
      if (boundary - start >= SOFT_SEGMENT_TARGET) return boundary
    }
  }

  const length = value.length - start
  if (length < HARD_SEGMENT_MAX) return null
  if (lastNaturalBoundary) return lastNaturalBoundary
  const limit = hardLimit
  const preferred = Math.min(limit, start + SOFT_SEGMENT_TARGET)
  const safeWhitespace = (index) => {
    if (!/\s/.test(value[index])) return false
    const located = rangeAt(ranges, index)
    return !located.range
  }
  for (let index = limit - 1; index >= preferred && index > start + SOFT_SEGMENT_MIN; index -= 1) {
    if (safeWhitespace(index)) return index + 1
  }
  for (let index = limit; index < value.length; index += 1) {
    if (safeWhitespace(index)) return index + 1
    const located = rangeAt(ranges, index)
    if (located.range) return located.range.end
  }
  return limit
}

/** Stateless segmentation helper used by tests and for non-streaming text. */
export function splitReasoning(text) {
  const value = String(text || '')
  const ranges = getProtectedReasoningSpans(value)
  const parts = []
  let start = 0
  while (start < value.length) {
    const end = findReasoningBoundary(value, start, ranges)
    if (!end || end <= start) break
    parts.push({ start, end, text: value.slice(start, end) })
    start = end
  }
  if (start < value.length) parts.push({ start, end: value.length, text: value.slice(start) })
  return parts
}

export function hashReasoningText(value) {
  const text = String(value || '')
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function preservesProtectedReasoningContent(original, translated) {
  const output = String(translated || '')
  return getProtectedReasoningSpans(original).every((range) => output.includes(range.text))
}

function restoreEdgeWhitespace(original, translated) {
  const value = String(translated || '').trim()
  if (!value) return ''
  const leading = String(original || '').match(/^\s*/)?.[0] || ''
  const trailing = String(original || '').match(/\s*$/)?.[0] || ''
  return `${leading}${value}${trailing}`
}

function pruneTranslationCache(now = Date.now()) {
  for (const [key, entry] of translationCache) {
    if (entry.expiresAt <= now) translationCache.delete(key)
  }
  while (translationCache.size > CACHE_MAX_ENTRIES) translationCache.delete(translationCache.keys().next().value)
}

function cachedTranslation(key) {
  const entry = translationCache.get(key)
  if (!entry || entry.expiresAt <= Date.now()) {
    if (entry) translationCache.delete(key)
    return null
  }
  entry.expiresAt = Date.now() + CACHE_TTL_MS
  return entry.text
}

function cacheTranslation(key, text) {
  pruneTranslationCache()
  translationCache.delete(key)
  translationCache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS })
  pruneTranslationCache()
}

function prefersReducedMotion() {
  try { return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true } catch { return false }
}

function terminalStatus(status) {
  return status === 'done' || status === 'fallback' || status === 'skip'
}

function snapshotSegment(segment) {
  const { abort, ...snapshot } = segment
  return { ...snapshot }
}

/**
 * Stateful display queue. It is deliberately not a React/store object: a
 * reconnect or virtualized remount can reuse it without ever touching the
 * authoritative Claude message.
 */
export class ReasoningTranslationController {
  constructor(key, translate) {
    this.key = key
    this.translate = translate
    this.raw = ''
    this.streaming = false
    this.segments = []
    this.listeners = new Set()
    this.idleTimer = null
    this.animationTimer = null
    this.playing = null
    this.activeRequests = 0
    this.version = 0
    this.doneKeys = new Set()
    this.lastTouchedAt = Date.now()
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  snapshot() {
    return {
      raw: this.raw,
      streaming: this.streaming,
      segments: this.segments.map(snapshotSegment),
    }
  }

  notify() {
    this.lastTouchedAt = Date.now()
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      try { listener(snapshot) } catch { /* isolate display subscribers */ }
    }
  }

  abortOutstanding() {
    for (const segment of this.segments) segment.abort?.abort()
    if (this.animationTimer) clearInterval(this.animationTimer)
    this.animationTimer = null
    this.playing = null
  }

  resetSegments() {
    this.abortOutstanding()
    this.segments = []
    this.version += 1
  }

  makeSegment(start, end = null) {
    const raw = this.raw.slice(start, end == null ? undefined : end)
    const translatable = shouldTranslateReasoningSegment(raw)
    const status = translatable ? 'open' : 'skip'
    return {
      id: `${start}-${hashReasoningText(raw)}`,
      start,
      end,
      raw,
      status,
      translation: translatable ? '' : raw,
      revealedChars: translatable ? 0 : Array.from(raw).length,
      abort: null,
    }
  }

  refreshOpenSegment(segment) {
    if (segment.end != null) return
    const raw = this.raw.slice(segment.start)
    if (raw === segment.raw) return
    segment.abort?.abort()
    const next = this.makeSegment(segment.start)
    Object.assign(segment, next)
  }

  sealSegment(segment) {
    if (segment.status === 'open') {
      if (shouldTranslateReasoningSegment(segment.raw)) {
        segment.status = 'pending'
        segment.translation = ''
        segment.revealedChars = 0
      } else {
        segment.status = 'skip'
        segment.translation = segment.raw
        segment.revealedChars = Array.from(segment.raw).length
      }
    }
  }

  reconcileSegments() {
    if (!this.raw) {
      this.segments = []
      return
    }
    if (!this.segments.length) this.segments.push(this.makeSegment(0))
    const last = this.segments[this.segments.length - 1]
    if (last.end != null && last.end < this.raw.length) this.segments.push(this.makeSegment(last.end))
    this.refreshOpenSegment(this.segments[this.segments.length - 1])

    const ranges = getProtectedReasoningSpans(this.raw)
    while (this.segments.length) {
      const current = this.segments[this.segments.length - 1]
      if (current.end != null) break
      const boundary = findReasoningBoundary(this.raw, current.start, ranges)
      if (!boundary || boundary > this.raw.length) break
      current.end = boundary
      current.raw = this.raw.slice(current.start, boundary)
      current.id = `${current.start}-${hashReasoningText(current.raw)}`
      this.sealSegment(current)
      if (boundary >= this.raw.length) break
      this.segments.push(this.makeSegment(boundary))
    }
  }

  sealOpenSegment() {
    const segment = this.segments[this.segments.length - 1]
    if (!segment || segment.end != null || !segment.raw) return false
    segment.end = this.raw.length
    segment.raw = this.raw.slice(segment.start)
    segment.id = `${segment.start}-${hashReasoningText(segment.raw)}`
    this.sealSegment(segment)
    return true
  }

  scheduleIdleSeal() {
    clearTimeout(this.idleTimer)
    if (!this.streaming || !this.raw) return
    const expectedRaw = this.raw
    this.idleTimer = setTimeout(() => {
      if (this.raw !== expectedRaw || !this.streaming) return
      if (this.sealOpenSegment()) {
        this.notify()
        this.pumpRequests()
      }
    }, REASONING_TRANSLATION_IDLE_MS)
  }

  update(rawValue, streaming = false) {
    const raw = String(rawValue || '')
    const wasRaw = this.raw
    const wasStreaming = this.streaming
    this.lastTouchedAt = Date.now()
    if (raw !== wasRaw && !raw.startsWith(wasRaw)) this.resetSegments()
    this.raw = raw
    this.streaming = Boolean(streaming)
    this.reconcileSegments()
    if (this.streaming) this.scheduleIdleSeal()
    else {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
      if (this.sealOpenSegment()) this.notify()
    }
    if (raw !== wasRaw || this.streaming !== wasStreaming) this.notify()
    this.pumpRequests()
  }

  contextFor(segment) {
    const index = this.segments.indexOf(segment)
    if (index <= 0) return ''
    return this.segments
      .slice(0, index)
      .filter((item) => item.end != null && item.raw.trim())
      .slice(-2)
      .map((item) => item.raw)
      .join('\n')
  }

  fallback(segment) {
    segment.status = 'fallback'
    segment.translation = segment.raw
    segment.revealedChars = 0
    segment.abort = null
  }

  pumpRequests() {
    for (const segment of this.segments) {
      if (this.activeRequests >= REASONING_TRANSLATION_MAX_CONCURRENT) break
      if (segment.end == null || segment.status !== 'pending') continue
      const raw = segment.raw
      const textKey = hashReasoningText(raw)
      const segmentKey = `${segment.start}:${textKey}`
      if (!shouldTranslateReasoningSegment(raw)) {
        segment.status = 'skip'
        segment.translation = raw
        segment.revealedChars = Array.from(raw).length
        continue
      }
      const cached = cachedTranslation(textKey)
      if (cached) {
        segment.translation = cached
        segment.revealedChars = 0
        segment.status = this.doneKeys.has(segmentKey) ? 'done' : 'ready'
        continue
      }

      segment.status = 'loading'
      const requestVersion = this.version
      const controller = new AbortController()
      segment.abort = controller
      this.activeRequests += 1
      Promise.resolve(this.translate({ text: raw, context: this.contextFor(segment), signal: controller.signal }))
        .then((result) => {
          if (requestVersion !== this.version || !this.segments.includes(segment) || segment.raw !== raw) return
          const resultText = typeof result === 'string' ? result : result?.text
          const translated = restoreEdgeWhitespace(raw, resultText)
          if (!translated || !preservesProtectedReasoningContent(raw, translated)) {
            this.fallback(segment)
            return
          }
          cacheTranslation(textKey, translated)
          segment.translation = translated
          segment.revealedChars = 0
          segment.status = this.doneKeys.has(segmentKey) ? 'done' : 'ready'
        })
        .catch(() => {
          if (requestVersion === this.version && this.segments.includes(segment) && segment.raw === raw) this.fallback(segment)
        })
        .finally(() => {
          this.activeRequests = Math.max(0, this.activeRequests - 1)
          segment.abort = null
          if (requestVersion === this.version) {
            this.notify()
            this.pumpRequests()
            this.pumpPlayback()
          }
        })
    }
    this.notify()
    this.pumpPlayback()
  }

  pumpPlayback() {
    if (this.playing) return
    const next = this.segments.find((segment) => segment.end != null && !terminalStatus(segment.status))
    if (!next || next.status !== 'ready') return
    this.playSegment(next)
  }

  playSegment(segment) {
    const chars = Array.from(segment.translation || '')
    const segmentKey = `${segment.start}:${hashReasoningText(segment.raw)}`
    if (!chars.length || prefersReducedMotion()) {
      segment.revealedChars = chars.length
      segment.status = 'done'
      this.doneKeys.add(segmentKey)
      this.notify()
      this.pumpPlayback()
      return
    }
    this.playing = segment
    segment.status = 'animating'
    segment.revealedChars = 0
    this.notify()
    const interval = Math.max(24, Math.round(1000 / REASONING_TRANSLATION_CHARS_PER_SECOND))
    this.animationTimer = setInterval(() => {
      if (!this.segments.includes(segment) || segment.status !== 'animating') {
        clearInterval(this.animationTimer)
        this.animationTimer = null
        this.playing = null
        return
      }
      segment.revealedChars = Math.min(chars.length, segment.revealedChars + 1)
      if (segment.revealedChars >= chars.length) {
        clearInterval(this.animationTimer)
        this.animationTimer = null
        segment.status = 'done'
        this.doneKeys.add(segmentKey)
        this.playing = null
      }
      this.notify()
      if (!this.playing) this.pumpPlayback()
    }, interval)
  }

  destroy() {
    clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.abortOutstanding()
    this.listeners.clear()
    this.segments = []
  }
}

function pruneControllers() {
  const now = Date.now()
  for (const [key, controller] of controllerRegistry) {
    if (!controller.listeners.size && now - controller.lastTouchedAt > CONTROLLER_TTL_MS) {
      controller.destroy()
      controllerRegistry.delete(key)
    }
  }
  while (controllerRegistry.size > CONTROLLER_MAX_ENTRIES) {
    const first = controllerRegistry.keys().next().value
    const controller = controllerRegistry.get(first)
    controller?.destroy()
    controllerRegistry.delete(first)
  }
}

export function getReasoningTranslationController(key, translate) {
  const id = String(key || '')
  if (!id) return null
  pruneControllers()
  let controller = controllerRegistry.get(id)
  if (!controller) {
    controller = new ReasoningTranslationController(id, translate)
    controllerRegistry.set(id, controller)
  }
  controller.lastTouchedAt = Date.now()
  return controller
}

/** Test/reset hook; it only clears ephemeral display memory. */
export function resetReasoningTranslationState() {
  for (const controller of controllerRegistry.values()) controller.destroy()
  controllerRegistry.clear()
  translationCache.clear()
}
