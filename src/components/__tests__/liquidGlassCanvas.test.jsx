import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LiquidGlassCanvas from '../LiquidGlassCanvas'

describe('LiquidGlassCanvas', () => {
  it('keeps one fixed 1080x1920 presentation canvas', () => {
    const markup = renderToStaticMarkup(<LiquidGlassCanvas />)
    expect(markup.match(/<canvas/g)).toHaveLength(1)
    expect(markup).toContain('width="1080"')
    expect(markup).toContain('height="1920"')
  })
})
