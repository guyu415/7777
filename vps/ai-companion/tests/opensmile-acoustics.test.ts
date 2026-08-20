import { describe, expect, test } from 'bun:test'
import { parseOpenSmileCsv } from '../opensmile-acoustics.ts'

describe('openSMILE acoustic parser', () => {
  test('returns bounded, readable voice measurements', () => {
    const csv = [
      'name;F0semitoneFrom27.5Hz_sma3nz_amean;F0semitoneFrom27.5Hz_sma3nz_pctlrange0-2;equivalentSoundLevel_dBp;loudnessPeaksPerSec;HNRdBACF_sma3nz_amean;jitterLocal_sma3nz_amean;shimmerLocaldB_sma3nz_amean',
      "'unknown';26.77998;3.943943;-18.25353;3.254973;5.249439;0.0176144;1.002391",
    ].join('\n')
    expect(parseOpenSmileCsv(csv)).toEqual({
      pitchHz: 129,
      pitchRangeSemitones: 3.9,
      loudnessDb: -18.3,
      rhythmPeaksPerSecond: 3.3,
      hnrDb: 5.2,
      jitterPercent: 1.76,
      shimmerDb: 1,
    })
  })

  test('drops NaN, impossible pitch, and missing columns', () => {
    expect(parseOpenSmileCsv('name;F0semitoneFrom27.5Hz_sma3nz_amean;HNRdBACF_sma3nz_amean\nunknown;0;nan')).toEqual({})
  })
})
