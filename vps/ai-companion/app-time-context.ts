export const APP_TIME_ZONE = 'Asia/Taipei'

export type AppTimeContext = {
  formatted: string
  timeZone: string
  utcOffsetMinutes: number
}

// Background turns do not originate in the browser, so they cannot reuse the
// device-clock payload attached to ordinary chat messages. Keep the app's
// authoritative timezone explicit instead of exposing the VPS's UTC clock.
export function appTimeContext(now = new Date()): AppTimeContext {
  return {
    formatted: new Intl.DateTimeFormat('zh-CN', {
      timeZone: APP_TIME_ZONE,
      dateStyle: 'full',
      timeStyle: 'medium',
      hour12: false,
    }).format(now),
    timeZone: APP_TIME_ZONE,
    utcOffsetMinutes: 8 * 60,
  }
}
