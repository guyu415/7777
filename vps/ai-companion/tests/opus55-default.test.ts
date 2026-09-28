import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repoRoot = join(import.meta.dir, '../../..')

describe('Claude Opus 5.5 resident default', () => {
  test('fresh resident sessions launch on the exact Opus 5.5 model id', () => {
    const source = readFileSync(join(repoRoot, 'vps/ai-companion/scripts/brain-loop.sh'), 'utf8')
    expect(source).toContain('model_args=(--model claude-opus-5-5)')
  })

  test('backend and frontend expose the same exact model id', () => {
    const server = readFileSync(join(repoRoot, 'vps/ai-companion/channel-server.ts'), 'utf8')
    const frontend = readFileSync(join(repoRoot, 'src/components/Chat/RuntimeStatusBall.jsx'), 'utf8')
    expect(server).toContain("'claude-opus-5-5'")
    expect(frontend).toContain("{ id: 'claude-opus-5-5', label: 'Opus 5.5' }")
  })

  test('refresh trusts the resident model instead of replaying a stale browser model', () => {
    const frontend = readFileSync(join(repoRoot, 'src/components/Chat/RuntimeStatusBall.jsx'), 'utf8')
    expect(frontend).not.toContain('switchCompanionModel(savedCcModelId)')
    expect(frontend).toContain('updateSession(currentSessionId, { model: confirmedId })')
    expect(frontend).toContain('const res = await switchCompanionModel(modelId)')
  })

  test('old cached clients cannot switch the resident model without explicit user intent', () => {
    const service = readFileSync(join(repoRoot, 'src/services/companion.js'), 'utf8')
    const server = readFileSync(join(repoRoot, 'vps/ai-companion/channel-server.ts'), 'utf8')
    expect(service).toContain("intent: 'explicit-user-selection'")
    expect(server).toContain("(body as any)?.intent !== 'explicit-user-selection'")
    expect(server).toContain("error: 'explicit_user_intent_required'")
  })

  test('resident permissions use manual mode with a scoped auto-approval hook', () => {
    const loop = readFileSync(join(repoRoot, 'vps/ai-companion/scripts/brain-loop.sh'), 'utf8')
    const settings = JSON.parse(readFileSync(
      join(repoRoot, 'vps/ai-companion/config/resident-manual-settings.json'),
      'utf8',
    ))

    expect(loop).toContain('--permission-mode manual')
    expect(loop).not.toContain('--permission-mode bypassPermissions')
    expect(loop).toContain('--settings "${PROJECT_DIR}/config/resident-manual-settings.json"')
    expect(settings.switchModelsOnFlag).toBe(false)
    expect(settings.hooks.PermissionRequest).toEqual([
      {
        matcher: '*',
        hooks: [
          {
            type: 'command',
            command: '/opt/ai-companion/scripts/approve-resident-permission.sh',
            timeout: 5,
          },
        ],
      },
    ])
  })

  test('resident disables model-refusal fallback and preserves the same session id on failure', () => {
    const source = readFileSync(join(repoRoot, 'vps/ai-companion/scripts/brain-loop.sh'), 'utf8')
    expect(source).toContain('export CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK=1')
    expect(source).not.toContain('rotated to ${session_id}')
    expect(source).toContain('preserving same session ${session_id}')
  })
})
