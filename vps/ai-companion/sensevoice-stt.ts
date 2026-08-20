import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const SENSEVOICE_MAX_AUDIO_BYTES = 1_100_000

const KNOWN_EMOTIONS = new Set([
  'HAPPY', 'SAD', 'ANGRY', 'NEUTRAL', 'FEARFUL', 'DISGUSTED', 'SURPRISED',
])
const LANGUAGE_TAGS = new Set(['ZH', 'EN', 'YUE', 'JA', 'KO', 'NOSPEECH'])
const CONTROL_TAGS = new Set(['WITHITN', 'WOITN'])

export type SenseVoiceResult = {
  text: string
  emotion: string
  event: string
  language: string
}

export function parseSenseVoiceOutput(output: string): SenseVoiceResult {
  const tags = [...String(output || '').matchAll(/<\|([^|>]+)\|>/g)].map(match => match[1].trim().toUpperCase())
  const emotion = tags.find(tag => KNOWN_EMOTIONS.has(tag))?.toLowerCase() || 'unknown'
  const language = tags.find(tag => LANGUAGE_TAGS.has(tag))?.toLowerCase() || ''
  const event = tags.find(tag => !KNOWN_EMOTIONS.has(tag) && !LANGUAGE_TAGS.has(tag) && !CONTROL_TAGS.has(tag)) || ''
  const text = String(output || '')
    .replace(/<\|[^|>]+\|>/g, '')
    .replace(/^\s*\[sensevoice\].*$/gim, '')
    .trim()
  return { text, emotion, event, language }
}

export async function transcribeWithSenseVoice(
  audio: Uint8Array,
  options: { binary: string; model: string; timeoutMs?: number },
): Promise<SenseVoiceResult> {
  if (audio.length < 44 || audio.length > SENSEVOICE_MAX_AUDIO_BYTES) throw new Error('invalid audio size')
  if (!existsSync(options.binary) || !existsSync(options.model)) throw new Error('SenseVoice runtime is not installed')

  const workDir = mkdtempSync(join(tmpdir(), 'eunoia-sensevoice-'))
  const wavPath = join(workDir, 'speech.wav')
  writeFileSync(wavPath, audio, { mode: 0o600 })
  let timedOut = false
  try {
    const proc = Bun.spawn([
      options.binary, '-m', options.model, '-a', wavPath, '--keep-tags',
    ], {
      stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
      env: { ...process.env, OMP_NUM_THREADS: '2' },
    })
    const timeout = setTimeout(() => {
      timedOut = true
      try { proc.kill() } catch {}
    }, options.timeoutMs ?? 15_000)
    const stdoutPromise = new Response(proc.stdout).text()
    const stderrPromise = new Response(proc.stderr).text()
    const exitCode = await proc.exited
    clearTimeout(timeout)
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    if (timedOut) throw new Error('SenseVoice timed out')
    if (exitCode !== 0) throw new Error(`SenseVoice exited ${exitCode}: ${stderr.trim().slice(0, 240)}`)
    const result = parseSenseVoiceOutput(stdout)
    if (!result.text) throw new Error('SenseVoice returned no transcript')
    return result
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
