import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import LiquidGlassCanvas from '../LiquidGlassCanvas'
import { readFileSync } from 'node:fs'

describe('LiquidGlassCanvas', () => {
  it('keeps one fixed 1080x1920 presentation canvas', () => {
    const markup = renderToStaticMarkup(<LiquidGlassCanvas />)
    expect(markup.match(/<canvas/g)).toHaveLength(1)
    expect(markup).toContain('width="1080"')
    expect(markup).toContain('height="1920"')
  })

  it('keeps one glass surface, two refractions and a clipped reading track', () => {
    const shader = readFileSync(new URL('../LiquidGlassCanvas.jsx', import.meta.url), 'utf8')
    const diary = readFileSync(new URL('../DiarySection.jsx', import.meta.url), 'utf8')
    const sdf = shader.split('float glassSdf')[1].split('float heightAt')[0]
    expect(sdf.match(/sdRoundBox\(/g)).toHaveLength(1)
    expect(shader).toContain('vec3 inside = refract(')
    expect(shader).toContain('vec3 outside = refract(')
    expect(shader.match(/new THREE.RawShaderMaterial/g)).toHaveLength(2)
    expect(diary).toContain('grid-template-rows:auto minmax(0,1fr) auto')
    expect(diary).toContain('min-height:0;overflow:auto;overscroll-behavior:contain')
  })
})
