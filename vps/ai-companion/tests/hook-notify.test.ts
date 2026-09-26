import { afterEach, describe, expect, it } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runHook(assistantText: string | string[]) {
  const root = mkdtempSync(join(tmpdir(), 'hook-notify-'))
  tempDirs.push(root)
  const binDir = join(root, 'bin')
  const transcriptDir = join(root, 'transcripts')
  const capturePath = join(root, 'curl-args')
  const secretPath = join(root, 'secret')
  const transcriptPath = join(transcriptDir, 'session.jsonl')

  spawnSync('mkdir', ['-p', binDir, transcriptDir], { stdio: 'inherit' })
  writeFileSync(secretPath, 'test-secret')
  const assistantTexts = Array.isArray(assistantText) ? assistantText : [assistantText]
  writeFileSync(transcriptPath, assistantTexts.map(content => JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content },
  })).join('\n') + '\n')
  writeFileSync(join(binDir, 'curl'), '#!/usr/bin/env bash\nprintf \'%s\\n\' "$@" > "$HOOK_CAPTURE_FILE"\n')
  writeFileSync(join(binDir, 'tmux'), '#!/usr/bin/env bash\nexit 0\n')
  chmodSync(join(binDir, 'curl'), 0o755)
  chmodSync(join(binDir, 'tmux'), 0o755)

  const script = fileURLToPath(new URL('../scripts/hook-notify.sh', import.meta.url))
  const result = spawnSync('bash', [script], {
    input: JSON.stringify({
      hook_event_name: 'StopFailure',
      error: 'invalid_request',
      transcript_path: transcriptPath,
    }),
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      AI_COMPANION_BRAIN: '1',
      AI_COMPANION_INTERNAL_SECRET_FILE: secretPath,
      AI_COMPANION_TRANSCRIPT_DIR: transcriptDir,
      HOOK_CAPTURE_FILE: capturePath,
    },
  })
  expect(result.status).toBe(0)
  const args = readFileSync(capturePath, 'utf8').trim().split('\n')
  return JSON.parse(args[args.indexOf('-d') + 1])
}

describe('hook-notify StopFailure classification', () => {
  it('promotes a reasoning safeguard refusal to a specific error', () => {
    expect(runHook('API Error\n\nDetails: `[reasoning_extraction]`')).toEqual({
      error: 'reasoning_extraction',
    })
  })

  it('keeps unrelated invalid requests generic', () => {
    expect(runHook('API Error: output_config.effort is not supported')).toEqual({
      error: 'invalid_request',
    })
  })

  it('does not reuse a classifier reason from an earlier failed turn', () => {
    expect(runHook([
      'API Error\n\nDetails: `[reasoning_extraction]`',
      'API Error: output_config.effort is not supported',
    ])).toEqual({ error: 'invalid_request' })
  })
})
