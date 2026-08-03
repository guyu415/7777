/*
 * Eunoia 专注计时的核心状态引擎——真实 endAt 倒计时、暂停恢复、localStorage
 * 持久化、每日完成数、Guided Access 引导逻辑，逻辑改编自：
 *
 *   Guided Access Pomodoro
 *   Source by NYRA — https://github.com/NyraSeithhh/guided-access-pomodoro
 *   MIT License
 *
 * 本文件把原作者的核心状态机（defaults/normalize/read/write/remaining/
 * settle/start/pause/reset 等）从原本的原生 DOM 挂载组件改写为无副作用的
 * 纯状态函数，供 usePomodoro.js 这个 React hook 使用；计时/持久化/每日计数
 * 的真实逻辑与原作保持一致，只是换了个宿主形态和视觉皮肤（见 NYRA 原始
 * README："别抹掉署名说成自己的原创"——这里明确保留）。
 */

export const STORAGE_KEY = 'eunoia.focus.pomodoro.v1'
export const CHANGED_EVENT = 'eunoia-focus-pomodoro-changed'
export const APPLE_GUIDE_URL = 'https://support.apple.com/111795'

function clamp(value, min, max) {
  value = Number(value)
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : min
}

export function dayKey(ts) {
  const date = new Date(ts || Date.now())
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function duration(state, mode) {
  return (mode === 'break' ? state.breakMinutes : state.focusMinutes) * 60000
}

export function defaults() {
  return {
    version: 1,
    task: '',
    mode: 'focus',
    status: 'idle',
    focusMinutes: 25,
    breakMinutes: 5,
    remainingMs: 25 * 60000,
    endAt: 0,
    startedAt: 0,
    completedByDay: {},
    // "交给小漫管理" —— 命名沿用原作 singleAppMode 的语义（对应 iOS Guided
    // Access 单页锁定），这里改名更贴合 Eunoia 里"管理"这个说法。
    managed: false,
    guidedAccessReady: false,
    updatedAt: Date.now(),
  }
}

export function normalize(raw) {
  const base = defaults()
  const state = raw && typeof raw === 'object' ? Object.assign(base, raw) : base
  state.version = 1
  state.task = String(state.task || '').slice(0, 120)
  state.mode = state.mode === 'break' ? 'break' : 'focus'
  state.status = ['idle', 'running', 'paused'].indexOf(state.status) >= 0 ? state.status : 'idle'
  state.focusMinutes = Math.round(clamp(state.focusMinutes, 1, 180))
  state.breakMinutes = Math.round(clamp(state.breakMinutes, 1, 90))
  state.remainingMs = Math.max(0, Number(state.remainingMs) || duration(state, state.mode))
  state.endAt = Math.max(0, Number(state.endAt) || 0)
  state.startedAt = Math.max(0, Number(state.startedAt) || 0)
  state.completedByDay = state.completedByDay && typeof state.completedByDay === 'object' ? state.completedByDay : {}
  state.managed = state.managed === true
  state.guidedAccessReady = state.guidedAccessReady === true
  return state
}

export function read() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return normalize(value ? JSON.parse(value) : null)
  } catch {
    return defaults()
  }
}

export function write(state, { silent = false } = {}) {
  state = normalize(Object.assign({}, state, { updatedAt: Date.now() }))
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* storage unavailable — state still returned/rendered from memory */ }
  if (!silent) {
    try { window.dispatchEvent(new CustomEvent(CHANGED_EVENT, { detail: state })) } catch { /* non-browser env */ }
  }
  return state
}

// 真实剩余时间——running 时永远用 endAt-Date.now() 现算，不在本地做递减，
// 切后台/刷新/系统时钟漂移都不会让显示时间和真实到期时间脱节。
export function remaining(state) {
  state = normalize(state)
  if (state.status === 'running' && state.endAt) {
    return Math.max(0, state.endAt - Date.now())
  }
  return Math.max(0, state.remainingMs)
}

// 到期后自动结算：专注完成 -> 计入当天完成数并进入休息(idle)；休息结束 ->
// 回到专注(idle)。返回 { state, finished } ——finished 是这次结算真正完成的
// 阶段（'focus'|'break'|null），只用于让 UI 层决定要不要展示"完成页"，本身
// 不落盘。
export function settle(state) {
  state = normalize(state)
  if (state.status !== 'running' || !state.endAt || state.endAt > Date.now()) {
    return { state, finished: null }
  }
  const finishedMode = state.mode
  let next
  if (finishedMode === 'focus') {
    const counts = Object.assign({}, state.completedByDay)
    const k = dayKey(state.endAt)
    counts[k] = (Number(counts[k]) || 0) + 1
    next = Object.assign({}, state, {
      completedByDay: counts,
      mode: 'break',
      status: 'idle',
      endAt: 0,
      startedAt: 0,
      remainingMs: duration(state, 'break'),
    })
  } else {
    next = Object.assign({}, state, {
      mode: 'focus',
      status: 'idle',
      endAt: 0,
      startedAt: 0,
      remainingMs: duration(state, 'focus'),
    })
  }
  next = write(next)
  return { state: next, finished: finishedMode }
}

// 读取 + 结算——每次真正想要"当前应该显示什么"时调用这个，而不是裸 read()。
export function load() {
  return settle(read()).state
}

// 供 hook 的 tick() 使用：既结算过期状态，又把"这一下刚刚完成了哪个阶段"
// 显式带出来，避免 UI 层用猜的（比如对比前后 mode）去判断要不要弹完成页。
export function tick() {
  return settle(read())
}

export function format(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000))
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0')
}

export function completedToday(state) {
  return Math.max(0, Number(state.completedByDay[dayKey()]) || 0)
}

// 开始一段新的专注——总是用调用方选择的分钟数重新起一段（不是恢复上次剩余），
// 匹配"从面板选好时长再开始"的交互；task/managed 一并写入。
export function startFocusSession({ task, minutes, managed }) {
  const state = load()
  const focusMinutes = Math.round(clamp(minutes, 1, 180))
  const ms = focusMinutes * 60000
  return write(Object.assign({}, state, {
    task: String(task || '').slice(0, 120),
    mode: 'focus',
    status: 'running',
    focusMinutes,
    remainingMs: ms,
    endAt: Date.now() + ms,
    startedAt: Date.now(),
    managed: !!managed,
  }))
}

// 普通模式专用——托管模式下 UI 根本不渲染暂停/继续控件，这里仍做一层防御，
// 避免管理态被意外的编程调用绕过。
export function pauseFocus() {
  const state = load()
  if (state.status !== 'running' || state.managed) return state
  return write(Object.assign({}, state, { status: 'paused', remainingMs: remaining(state), endAt: 0 }))
}

export function resumeFocus() {
  const state = load()
  if (state.status !== 'paused' || state.managed) return state
  const ms = remaining(state) || duration(state, state.mode)
  return write(Object.assign({}, state, { status: 'running', endAt: Date.now() + ms, remainingMs: ms }))
}

// "结束"——普通模式主动终止当前这一段专注，不计入完成数，回到 idle。
export function endFocus() {
  const state = load()
  if (state.managed) return state
  return write(Object.assign({}, state, {
    status: 'idle',
    endAt: 0,
    startedAt: 0,
    remainingMs: duration(state, state.mode),
  }))
}

// 完成页里的"开始休息"入口——真实开始一段休息倒计时（不是占位）。
export function startBreak() {
  const state = load()
  const ms = duration(state, 'break')
  return write(Object.assign({}, state, {
    mode: 'break',
    status: 'running',
    remainingMs: ms,
    endAt: Date.now() + ms,
    startedAt: Date.now(),
  }))
}

// 完成页里"跳过休息，直接结束"——回到专注·待开始，不强制走一遍休息倒计时。
export function skipBreak() {
  const state = load()
  return write(Object.assign({}, state, {
    mode: 'focus',
    status: 'idle',
    endAt: 0,
    startedAt: 0,
    remainingMs: duration(state, 'focus'),
  }))
}

export function markGuidedAccessReady() {
  const state = load()
  return write(Object.assign({}, state, { guidedAccessReady: true }))
}
