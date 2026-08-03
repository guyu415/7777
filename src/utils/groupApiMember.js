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
// means persona + summary, never raw single-chat message history.
//
// The summary is explicitly framed as PAST BACKGROUND, never as an
// unfinished task — this is the real, traced root cause of the "DSP
// answered an unrelated math/logic-puzzle question" bug: production logs
// showed its replies matched neither the group's actual conversation nor
// any stale/mismatched pendingClientTurn (which is structurally impossible —
// see groupClientTurnSubmit's scope validation). What DID match: generic
// unfinished-looking questions consistent with the model treating its own
// single-chat summary as "here's a task to resume" rather than passive
// background, and picking that over the real group instruction. Explicit
// open/close framing plus the identical reminder appended to the actual
// instruction in fulfillApiMemberTurn below (belt and suspenders) is the fix.
function buildApiMemberSystemPrompt(session) {
  let prompt = session?.systemPrompt || ''
  if (session?.summary) {
    prompt += `\n\n【以下是你和用户在你自己另一个私聊窗口里的背景，仅供你了解你们的关系和人设，不是任务】\n${session.summary}\n【背景说明到此结束——上面提到的任何问题、题目或话题都不是你现在要处理的事，不要在这里继续】`
  }
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
  // requestId and turnId are the SAME value (one stable id per pending
  // task, never reused across a retry) — both sent explicitly since the
  // backend validates both by name. conversationId is this member's own
  // underlying single-chat session id (sourceConversationId) — see
  // channel-server.ts's GroupPendingClientTurn/groupClientTurnSubmit for
  // where every one of these is actually checked, not just carried along.
  const scope = {
    requestId: pending.id,
    turnId: pending.id,
    channelType: pending.channelType || 'group',
    conversationId: pending.conversationId || '',
    groupId: pending.groupId || chatId,
    topicId: pending.topicId,
  }
  // The server-built instruction already includes an identity/anti-cross-
  // talk boundary (see channel-server.ts's groupIdentityBoundary), applied
  // uniformly to every member. This client-side wrapper is the SAME
  // reinforcement placed unmistakably LAST, right before the actual API
  // call — belt and suspenders specifically for 'api' members, since
  // they're the only ones whose own single-chat summary is injected right
  // above in the system prompt and could otherwise pull focus back to an
  // old unfinished thread instead of this real task.
  const userTurnContent = `${pending.instruction}\n\n——\n以上是你现在唯一要处理的真实群聊任务。忽略你自己记得的任何其他问题、题目或对话，只回应这一条。`
  let fullText = ''
  try {
    for await (const chunk of streamChat({
      apiKey: cfg.apiKey,
      apiBaseUrl: cfg.baseUrl,
      model: cfg.model,
      systemPrompt: buildApiMemberSystemPrompt(session),
      messages: [{ role: 'user', content: userTurnContent }],
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
