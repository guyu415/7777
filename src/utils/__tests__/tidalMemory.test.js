import { describe, expect, it } from 'vitest'
import { EMPTY_ROLLING_SUMMARY, formatTidalCoverage, tidalStatusPresentation } from '../tidalMemory'

describe('tidal memory settings presentation', () => {
  it('shows no-summary, retry, failed and success states distinctly', () => {
    expect(tidalStatusPresentation({ status: 'idle' }).label).toBe('尚未整理')
    expect(tidalStatusPresentation({ status: 'retry_wait' }).label).toBe('等待重试')
    expect(tidalStatusPresentation({ status: 'failed' }).label).toBe('失败')
    expect(tidalStatusPresentation({ status: 'success' }).label).toBe('成功')
  })

  it('keeps the fixed editable six-section structure when no summary exists', () => {
    expect(EMPTY_ROLLING_SUMMARY.split('\n')).toHaveLength(6)
    expect(EMPTY_ROLLING_SUMMARY).toContain('关系与身份连续性：')
    expect(EMPTY_ROLLING_SUMMARY).toContain('用户偏好：')
  })

  it('formats a message boundary without exposing server paths', () => {
    const value = formatTidalCoverage({ boundaryId: 'message-1234567890', boundaryTs: 1_700_000_000_000 })
    expect(value).toContain('…1234567890')
    expect(value).not.toContain('/opt/')
  })
})
