// Notification links are deliberate deep links, not ordinary app launches.
// Keeping this small parser shared by the bootstrap and app shell makes sure
// a push tap can bypass the decorative startup sequence without skipping it
// for normal launches.
export const PUSH_NAVIGATION_EVENT = 'eunoia:push-navigation'

const PUSH_SOURCES = new Set(['api-proactive', 'cc-proactive', 'care-hub'])

export function isPushNavigationUrl(value, baseUrl) {
  try {
    const url = new URL(value, baseUrl)
    return PUSH_SOURCES.has(url.searchParams.get('source'))
  } catch {
    return false
  }
}
