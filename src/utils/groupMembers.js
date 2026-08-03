// Member identity is a generic string id, matching channel-server.ts's own
// GroupMemberId: 'claude-code'/'codex' for the two real VPS-backed runtimes
// (unchanged, real backend processes), or `api:<sessionId>` for ANY other
// regular API-configured single-chat session invited into a group. Either
// way, name/avatar/model/API config are ALWAYS read live from the frontend's
// own session here — never duplicated or cached anywhere, so renaming an AI
// or changing its avatar/model in its own conversation window shows up in
// every group it's part of immediately, with nothing extra to keep in sync.
export const GROUP_RUNTIME_PROVIDER_NAME = {
  'claude-code': 'claude-code-vps',
  'codex': 'codex-vps',
}
export const GROUP_RUNTIME_LABEL = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
}
export const GROUP_VPS_RUNTIMES = ['claude-code', 'codex']

export function isVpsMemberId(memberId) {
  return memberId === 'claude-code' || memberId === 'codex'
}
export function apiMemberSessionId(memberId) {
  return typeof memberId === 'string' && memberId.startsWith('api:') ? memberId.slice(4) : null
}

export function resolveGroupMemberInfo(memberId, sessions) {
  if (isVpsMemberId(memberId)) {
    const providerName = GROUP_RUNTIME_PROVIDER_NAME[memberId]
    const session = sessions?.find((s) => s.providerName === providerName)
    return { name: session?.aiName || GROUP_RUNTIME_LABEL[memberId] || memberId, avatar: session?.aiAvatar || '', sessionId: session?.id || null, session: session || null }
  }
  const sessionId = apiMemberSessionId(memberId)
  const session = sessions?.find((s) => s.id === sessionId)
  return { name: session?.aiName || session?.name || '未知会话', avatar: session?.aiAvatar || '', sessionId: session?.id || null, session: session || null }
}

// Builds the invite spec for a given single-chat session — the ONE piece of
// data sent to the backend (see channel-server.ts's GroupMemberSpec): a
// stable reference (runtime, or sessionId) plus a display-name cache used
// only for the backend's own internal prompt construction. Never the
// session's apiKey/baseUrl/model — those never leave the browser (see
// src/utils/groupApiMember.js, which reads them live at reply time).
export function memberSpecForSession(session) {
  if (session.providerName === 'claude-code-vps') return { kind: 'vps', runtime: 'claude-code' }
  if (session.providerName === 'codex-vps') return { kind: 'vps', runtime: 'codex' }
  return { kind: 'api', sessionId: session.id, name: session.aiName || session.name || '' }
}
export function memberIdForSession(session) {
  const spec = memberSpecForSession(session)
  return spec.kind === 'vps' ? spec.runtime : `api:${spec.sessionId}`
}

// Every real candidate a user could invite: the two VPS runtimes (always
// offered, same as before — a group can include them even if their window
// was never opened) plus every OTHER existing single-chat session, each
// tagged with its own real spec/name/avatar. No hardcoded 2-runtime limit
// (that was the actual bug being fixed — see the group member management
// request this was built for).
export function listInvitableMembers(sessions) {
  const vps = GROUP_VPS_RUNTIMES.map((runtime) => {
    const info = resolveGroupMemberInfo(runtime, sessions)
    return { id: runtime, spec: { kind: 'vps', runtime }, name: info.name, avatar: info.avatar, sessionId: info.sessionId }
  })
  const api = (sessions || [])
    .filter((s) => s.providerName !== 'claude-code-vps' && s.providerName !== 'codex-vps')
    .map((s) => ({ id: `api:${s.id}`, spec: { kind: 'api', sessionId: s.id, name: s.aiName || s.name || '' }, name: s.aiName || s.name || '未命名对话', avatar: s.aiAvatar || '', sessionId: s.id }))
  return [...vps, ...api]
}
