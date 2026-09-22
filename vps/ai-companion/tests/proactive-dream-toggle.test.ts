import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repoRoot = join(import.meta.dir, '../../..')
const dreamScript = join(repoRoot, 'vps/ai-companion/scripts/dream-announce-check.sh')
const channelServer = join(repoRoot, 'vps/ai-companion/channel-server.ts')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('unified proactive and dream switch', () => {
  test('disabled switch exits before querying xinchao or announcing a dream', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eunoia-dream-toggle-'))
    tempDirs.push(dir)
    const config = join(dir, 'proactive.json')
    const bin = join(dir, 'bin')
    const curlMarker = join(dir, 'curl-called')
    mkdirSync(bin)
    writeFileSync(config, JSON.stringify({ enabled: false }))
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\ntouch '${curlMarker}'\nexit 99\n`)
    chmodSync(join(bin, 'curl'), 0o755)

    const result = spawnSync('bash', [dreamScript], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        AI_COMPANION_PROACTIVE_CONFIG_FILE: config,
      },
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
    expect(existsSync(curlMarker)).toBe(false)
  })

  test('internal announce endpoint rechecks the switch for race safety', () => {
    const source = readFileSync(channelServer, 'utf8')
    const route = source.slice(source.indexOf("url.pathname === '/internal/dream-announce'"))
    expect(route.indexOf('readProactiveConfig().enabled')).toBeGreaterThan(-1)
    expect(route.indexOf('readProactiveConfig().enabled')).toBeLessThan(route.indexOf('startTurn(id)'))
    expect(route).toContain("skipped: 'proactive_disabled'")
  })
})
