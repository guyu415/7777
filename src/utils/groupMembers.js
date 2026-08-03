// Maps a group-chat member runtime to the SAME session config the existing
// single-chat fixed windows already use (providerName 'claude-code-vps'/
// 'codex-vps') — never a separate/new naming or avatar system. Adding a
// future real member (DSP/GLM/...) means adding one entry here once that
// runtime has a real providerName convention, never a fake preset name.
export const GROUP_RUNTIME_PROVIDER_NAME = {
  'claude-code': 'claude-code-vps',
  'codex': 'codex-vps',
}
export const GROUP_RUNTIME_LABEL = {
  'claude-code': 'Claude Code',
  'codex': 'Codex',
}
export const GROUP_SUPPORTED_RUNTIMES = ['claude-code', 'codex']

export function resolveGroupMemberInfo(runtime, sessions, globalAiName, globalAiAvatar) {
  const providerName = GROUP_RUNTIME_PROVIDER_NAME[runtime]
  const session = sessions?.find((s) => s.providerName === providerName)
  return {
    name: session?.aiName || GROUP_RUNTIME_LABEL[runtime] || runtime,
    avatar: session?.aiAvatar || '',
    sessionId: session?.id || null,
  }
}
