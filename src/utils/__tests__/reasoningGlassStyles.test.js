import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles/globals.css', import.meta.url), 'utf8')
const bubbleSource = readFileSync(new URL('../../components/Chat/MessageBubble.jsx', import.meta.url), 'utf8')
const listSource = readFileSync(new URL('../../components/Chat/MessageList.jsx', import.meta.url), 'utf8')

describe('reasoning liquid-glass styling', () => {
  it('keeps the sky-blue transparent sheet in dark device mode too', () => {
    expect(css).toContain('rgba(190, 239, 250, 0.24)')
    expect(css).toContain('background: transparent;')
    expect(css).not.toContain('.reasoning-sheet-backdrop { background: rgba(0, 0, 0')
    expect(css).not.toContain('linear-gradient(145deg, rgba(31, 36, 40')
  })

  it('mounts the open sheet outside virtualized message rows', () => {
    expect(bubbleSource).not.toContain('<ReasoningSheet')
    expect(listSource).toContain('<ReasoningSheet')
    expect(listSource).toContain('const [reasoningTarget')
  })
})
