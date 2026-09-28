import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../..')
const hook = join(repoRoot, 'vps/ai-companion/scripts/approve-resident-permission.sh')

describe('resident permission approval hook', () => {
  test('allows permission requests only for the marked resident process', () => {
    const result = spawnSync('bash', [hook], {
      input: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
      encoding: 'utf8',
      env: { ...process.env, AI_COMPANION_BRAIN: '1' },
    })

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'allow' },
      },
    })
    expect(result.stderr).toBe('')
  })

  test('is inert outside the resident process', () => {
    const env = { ...process.env }
    delete env.AI_COMPANION_BRAIN
    const result = spawnSync('bash', [hook], {
      input: JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash' }),
      encoding: 'utf8',
      env,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})
