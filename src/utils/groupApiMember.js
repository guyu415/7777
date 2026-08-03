import { streamChat } from '../services/claude'
import { submitGroupClientTurn } from '../services/companion'

// The plain-text protocol channel-server.ts's groupBuild*Instruction uses
// for 'api'-kind members (no tool-calling harness, just one streamChat
// completion) — must match GROUP_PASS_TOKEN there exactly.
const GROUP_PASS_TOKEN = '##PASS##'

// SAME 3-tier fallback useChat.js's real single-chat send path uses
// (session override → currently-selected global provider → global default)
// — reused here so a member whose API key/baseUrl/model was configured at
// the provider or global level (not per-session) still resolves correctly,
// instead of this group-chat path wrongly reporting "no config" for a
// session that actually works fine in its own single-chat window.
export function resolveApiMemberConfig(session, globals) {
  const { providers, selectedProviderId, apiKey, apiBaseUrl, model } = globals || {}
  const selectedProvider = providers?.find((p) => p.id === selectedProviderId)
  return {
    apiKey: session?.apiKey || selectedProvider?.apiKey || apiKey || '',
    baseUrl: session?.baseUrl || selectedProvider?.baseUrl || apiBaseUrl || 'https://api.anthropic.com',
    model: session?.model || model || '',
    providerName: session?.providerName || '',
    disableThinking: session?.disableThinking ?? false,
  }
}

// Persona + memory summary only — the SAME mechanism single-chat sends
// already use for these two pieces (see useChat.js's own builtSystemPrompt),
// reused rather than reinvented. Deliberately NOT the rest of useChat.js's
// single-chat system prompt (BEHAVIOR_RULES, AC/music/voice/focus/letter tag
// instructions) — those are single-chat-surface features that would just
// leak confusing tag syntax into a group message bubble. "原对话记忆" here
// means persona + summary, never raw single-chat message history (which
// would risk exactly the kind of stray unrelated content — e.g. an old
// single-chat question — leaking into the group that this fix exists to
// prevent).
function buildApiMemberSystemPrompt(session) {
  let prompt = session?.systemPrompt || ''
  if (session?.summary) prompt += `\n\n【早期对话摘要】\n${session.summary}`
  return prompt
}

// Runs ONE real streamChat completion for an 'api'-kind group member's
// pending turn and submits the real result back to the backend, scoped by
// the exact requestId/topicId/groupId/channelType/conversationId this
// pending task was created with (see groupClientTurnSubmit server-side) —
// so a response that arrives after this task has already been superseded
// (topic changed, member removed, retried elsewhere) is rejected server-side
// rather than silently misapplied.
//
// Throws (never auto-submits 'pass') on a genuine failure to get an answer
// — missing API config, or the streamChat call itself erroring — so the
// caller can show a real "配置缺失/调用失败，点击重试" state instead of the
// member looking like it silently chose to stay quiet, and so the pending
// task is NOT consumed (no quota spent, stays in "等待客户端" until a real
// answer, a manual retry succeeds, or the user explicitly skips/removes/
// ends the topic). A real ##PASS## reply from the model IS a genuine choice
// to stay quiet, and is submitted as such.
export async function fulfillApiMemberTurn(chatId, memberId, pending, session, globals) {
  const cfg = resolveApiMemberConfig(session, globals)
  if (!cfg.apiKey) {
    const err = new Error('该会话没有配置 API Key（本会话、当前供应商、全局默认都没有设置）')
    err.code = 'missing_config'
    throw err
  }
  const scope = {
    requestId: pending.id,
    channelType: pending.channelType || 'group',
    conversationId: pending.conversationId || '',
    groupId: pending.groupId || chatId,
    topicId: pending.topicId,
  }
  let fullText = ''
  try {
    for await (const chunk of streamChat({
      apiKey: cfg.apiKey,
      apiBaseUrl: cfg.baseUrl,
      model: cfg.model,
      systemPrompt: buildApiMemberSystemPrompt(session),
      messages: [{ role: 'user', content: pending.instruction }],
      workerUrl: globals?.workerUrl,
      useWorkerProxy: globals?.useWorkerProxy,
      providerName: cfg.providerName,
      disableThinking: cfg.disableThinking,
    })) {
      if (chunk.text) fullText += chunk.text
    }
  } catch (err) {
    err.code = err.code || 'call_failed'
    throw err
  }

  const trimmed = fullText.trim()
  if (!trimmed || trimmed === GROUP_PASS_TOKEN) {
    return submitGroupClientTurn(chatId, memberId, scope, 'pass')
  }
  if (pending.phase === 'candidate') {
    return submitGroupClientTurn(chatId, memberId, scope, 'request', { direction: trimmed })
  }
  return submitGroupClientTurn(chatId, memberId, scope, 'speak', { text: trimmed })
}
