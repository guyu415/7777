import { afterEach, describe, expect, test } from 'bun:test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const created: string[] = []

afterEach(() => {
  for (const path of created.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('transcript pruning', () => {
  test('folds old fishing output and preserves its final state row', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'eunoia-prune-test-'))
    created.push(temp)
    const root = join(temp, 'root')
    const transcripts = join(temp, 'transcripts')
    mkdirSync(join(root, 'state'), { recursive: true })
    mkdirSync(transcripts, { recursive: true })
    copyFileSync(join(import.meta.dir, 'fixtures', 'prune-state', 'brain-session-id'), join(root, 'state', 'brain-session-id'))
    copyFileSync(join(import.meta.dir, 'fixtures', 'prune-fishing.jsonl'), join(transcripts, 'test-session.jsonl'))

    const proc = Bun.spawn(['bun', join(import.meta.dir, '..', 'scripts', 'prune-transcript.ts'), '--apply'], {
      env: {
        ...process.env,
        AI_COMPANION_ROOT: root,
        AI_COMPANION_TRANSCRIPT_DIR: transcripts,
        AI_COMPANION_PRUNE_KEEP_RECENT: '0',
        AI_COMPANION_PRUNE_FISHING_RESULT_CHARS: '200',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await proc.exited).toBe(0)
    const result = readFileSync(join(transcripts, 'test-session.jsonl'), 'utf8')
    expect(result).toContain('旧钓鱼过程已剪枝；持久化存档为准')
    expect(result).toContain('📊 {\\"pts\\":270,\\"loc\\":\\"芦苇河\\",\\"turn\\":20}')
    expect(result).not.toContain('重复渔获')
    expect(result).not.toContain('同步保存的旧钓鱼工具原始结果副本')
  })

  test('folds old Galatea output while retaining its tool input and locating head', async () => {
    const temp = mkdtempSync(join(tmpdir(), 'eunoia-prune-galatea-test-'))
    created.push(temp)
    const root = join(temp, 'root')
    const transcripts = join(temp, 'transcripts')
    mkdirSync(join(root, 'state'), { recursive: true })
    mkdirSync(transcripts, { recursive: true })
    copyFileSync(join(import.meta.dir, 'fixtures', 'prune-state', 'brain-session-id'), join(root, 'state', 'brain-session-id'))
    copyFileSync(join(import.meta.dir, 'fixtures', 'prune-galatea.jsonl'), join(transcripts, 'test-session.jsonl'))

    const proc = Bun.spawn(['bun', join(import.meta.dir, '..', 'scripts', 'prune-transcript.ts'), '--apply'], {
      env: {
        ...process.env,
        AI_COMPANION_ROOT: root,
        AI_COMPANION_TRANSCRIPT_DIR: transcripts,
        AI_COMPANION_PRUNE_KEEP_RECENT: '0',
        AI_COMPANION_PRUNE_GALATEA_RESULT_CHARS: '700',
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    expect(await proc.exited).toBe(0)
    const result = readFileSync(join(transcripts, 'test-session.jsonl'), 'utf8')
    expect(result).toContain('旧花园论坛结果已剪枝')
    expect(result).toContain('read_thread')
    expect(result).toContain('garden-thread-42')
    expect(result).toContain('月光温室里的新花')
    expect(result).not.toContain('帖子正文结束')
    const resultEntry = JSON.parse(result.trim().split('\n')[1])
    expect(resultEntry.toolUseResult.pruned).toBe(true)
    expect(resultEntry.toolUseResult.head.length).toBeLessThanOrEqual(500)
  })
})
