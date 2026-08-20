import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type VoiceAcoustics = {
  pitchHz?: number
  pitchRangeSemitones?: number
  loudnessDb?: number
  rhythmPeaksPerSecond?: number
  hnrDb?: number
  jitterPercent?: number
  shimmerDb?: number
}

function finiteInRange(value: unknown, min: number, max: number): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) && number >= min && number <= max ? number : undefined
}

function rounded(value: number | undefined, digits = 1): number | undefined {
  if (value === undefined) return undefined
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

export function parseOpenSmileCsv(csv: string): VoiceAcoustics {
  const lines = String(csv || '').trim().split(/\r?\n/)
  if (lines.length < 2) return {}
  const headers = lines[0].split(';')
  const values = lines.at(-1)?.split(';') || []
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index]]))

  const pitchSemitones = finiteInRange(row['F0semitoneFrom27.5Hz_sma3nz_amean'], 10, 60)
  const pitchHz = pitchSemitones === undefined ? undefined : 27.5 * (2 ** (pitchSemitones / 12))
  const jitter = finiteInRange(row.jitterLocal_sma3nz_amean, 0, 0.2)

  return Object.fromEntries(Object.entries({
    pitchHz: rounded(finiteInRange(pitchHz, 50, 900), 0),
    pitchRangeSemitones: rounded(finiteInRange(row['F0semitoneFrom27.5Hz_sma3nz_pctlrange0-2'], 0, 36)),
    loudnessDb: rounded(finiteInRange(row.equivalentSoundLevel_dBp, -100, 20)),
    rhythmPeaksPerSecond: rounded(finiteInRange(row.loudnessPeaksPerSec, 0, 20)),
    hnrDb: rounded(finiteInRange(row.HNRdBACF_sma3nz_amean, -30, 60)),
    jitterPercent: rounded(jitter === undefined ? undefined : jitter * 100, 2),
    shimmerDb: rounded(finiteInRange(row.shimmerLocaldB_sma3nz_amean, 0, 10), 2),
  }).filter(([, value]) => value !== undefined))
}

export async function analyzeVoiceAcoustics(
  audio: Uint8Array,
  options: { binary: string; config: string; timeoutMs?: number },
): Promise<VoiceAcoustics> {
  if (audio.length < 44) throw new Error('invalid audio size')
  if (!existsSync(options.binary) || !existsSync(options.config)) throw new Error('openSMILE is not installed')

  const workDir = mkdtempSync(join(tmpdir(), 'eunoia-opensmile-'))
  const wavPath = join(workDir, 'speech.wav')
  const csvPath = join(workDir, 'features.csv')
  writeFileSync(wavPath, audio, { mode: 0o600 })
  let timedOut = false
  try {
    const proc = Bun.spawn([
      options.binary,
      '-C', options.config,
      '-I', wavPath,
      '-csvoutput', csvPath,
      '-appendcsv', '0',
      '-l', '1',
    ], { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe' })
    const timeout = setTimeout(() => {
      timedOut = true
      try { proc.kill() } catch {}
    }, options.timeoutMs ?? 5_000)
    const stderrPromise = new Response(proc.stderr).text()
    const exitCode = await proc.exited
    clearTimeout(timeout)
    const stderr = await stderrPromise
    if (timedOut) throw new Error('openSMILE timed out')
    if (exitCode !== 0) throw new Error(`openSMILE exited ${exitCode}: ${stderr.trim().slice(0, 240)}`)
    return parseOpenSmileCsv(readFileSync(csvPath, 'utf8'))
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
