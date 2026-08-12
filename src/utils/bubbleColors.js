export const USER_BUBBLE_TEXT_PALETTE = [
  { value: '#FFFFFF', label: '纯白' },
  { value: '#FFF7E6', label: '暖白' },
  { value: '#2F3340', label: '墨灰' },
  { value: '#173B5E', label: '深蓝' },
  { value: '#5A3548', label: '莓棕' },
  { value: '#F0C040', label: '奶黄' },
]

export function normalizeBubbleTextColor(value) {
  if (typeof value !== 'string') return null
  const color = value.trim()
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : null
}

export function themeWithUserBubbleText(theme, override) {
  const color = normalizeBubbleTextColor(override)
  return color ? { ...theme, userBubbleText: color } : theme
}
