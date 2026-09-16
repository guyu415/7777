import { chmodSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'

const ROOT = dirname(new URL(import.meta.url).pathname)
const FISHING_DIR = join(ROOT, 'vendor', 'ai-fishing-game')
const FISHING_SAVE_FILE = process.env.AI_COMPANION_FISHING_SAVE_FILE
  ?? join(ROOT, 'state', 'fishing-save.json')
const FISHING_TIMEOUT_MS = 10_000
const FISHING_RESULT_MAX_CHARS = 8_000

let commandQueue: Promise<unknown> = Promise.resolve()

function clip(value: string, max: number): string {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function compactOversizedResult(value: string): string {
  if (value.length <= FISHING_RESULT_MAX_CHARS) return value
  const state = value.split('\n').reverse().find((line) => line.startsWith('📊 ')) ?? ''
  const head = value.slice(0, 6_500).trimEnd()
  return `${head}\n…[本次钓鱼长文已折叠；完整进度仍在独立存档中]${state ? `\n${state}` : ''}`
}

async function runOnce(command: string): Promise<string> {
  mkdirSync(dirname(FISHING_SAVE_FILE), { recursive: true })
  const python = [
    'import sys',
    'import fishing',
    'fishing._SAVE = sys.argv[2]',
    'print(fishing.cmd(sys.argv[1]))',
  ].join('; ')
  const proc = Bun.spawn(['python3', '-c', python, command, FISHING_SAVE_FILE], {
    cwd: FISHING_DIR,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let timeout: ReturnType<typeof setTimeout> | null = null
  const exitCode = await Promise.race([
    proc.exited,
    new Promise<number>((resolve) => {
      timeout = setTimeout(() => {
        try { proc.kill('SIGKILL') } catch {}
        resolve(124)
      }, FISHING_TIMEOUT_MS)
    }),
  ])
  if (timeout) clearTimeout(timeout)
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout as ReadableStream).text(),
    new Response(proc.stderr as ReadableStream).text(),
  ])
  try {
    chmodSync(FISHING_SAVE_FILE, 0o600)
  } catch {
    // The engine may fail before creating a save; preserve its original error.
  }
  if (exitCode !== 0) {
    throw new Error(exitCode === 124 ? '钓鱼引擎运行超时' : `钓鱼引擎退出码 ${exitCode}：${clip(stderr, 240)}`)
  }
  return compactOversizedResult(stdout.trim())
}

/** Serializes access because the upstream engine owns one JSON save file. */
export function runFishingCommand(rawCommand: unknown): Promise<string> {
  const command = String(rawCommand ?? '').replace(/\r/g, '').trim()
  if (!command) return Promise.reject(new Error('command 不能为空'))
  if (command.length > 300) return Promise.reject(new Error('command 最多 300 个字符'))
  const next = commandQueue.then(() => runOnce(command), () => runOnce(command))
  commandQueue = next.catch(() => undefined)
  return next
}

/** A short, truthful hint for the user's non-chat proactive-activity toast. */
export function summarizeFishingActivity(command: string, output: string): string {
  const lines = output.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('📊 ') && !line.startsWith('▶ '))
  const highlight = lines.find((line) => /🆕|传说|神话|遗迹|漂流瓶|宝箱|宝物|远征|换季|进入[春夏秋冬]季/.test(line))
  if (highlight) return clip(`🎣 自己钓了会儿鱼：${highlight}`, 160)

  const lower = command.toLowerCase()
  const action = lower.includes('dive') ? '下水远征了一趟'
    : lower.includes('cast') ? '抛了几竿'
      : lower.includes('sell') ? '整理并卖了渔获'
        : lower.includes('goto') ? '换了个钓点'
          : lower.includes('buy') ? '补充了钓鱼物资'
            : lower.includes('open') ? '开了钓到的宝箱'
              : '查看并整理了自己的钓鱼进度'
  const tail = [...lines].reverse().find((line) => !/^【.+】/.test(line) && line.length <= 120)
  return clip(`🎣 ${action}${tail ? `：${tail}` : ''}`, 160)
}
