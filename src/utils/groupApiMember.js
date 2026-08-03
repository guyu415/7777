import { streamChat } from '../services/claude'
import { submitGroupClientTurn } from '../services/companion'

// The plain-text protocol channel-server.ts's groupBuild*Instruction uses
// for 'api'-kind members (no tool-calling harness, just one streamChat
// completion) — must match GROUP_PASS_TOKEN there exactly.
const GROUP_PASS_TOKEN = '##PASS##'

// Runs ONE real streamChat completion for an 'api'-kind group member's
// pending turn, using that session's own live apiKey/baseUrl/model/persona
// (read fresh here, never cached) and submits the real result back to the
// backend. This is the ONLY place an 'api' member's group turn actually
// gets fulfilled — the backend itself has no credentials for it (see
// groupInvokeApiPending server-side), so if no open tab with this session
// calls this, the member just stays "waiting for client" indefinitely
// (no auto-pass, no timeout) until the user skips it, removes the member,
// or ends the topic.
export async function fulfillApiMemberTurn(chatId, memberId, pending, session, { workerUrl, useWorkerProxy } = {}) {
  let fullText = ''
  try {
    for await (const chunk of streamChat({
      apiKey: session.apiKey,
      apiBaseUrl: session.baseUrl || 'https://api.anthropic.com',
      model: session.model,
      systemPrompt: session.systemPrompt || '',
      messages: [{ role: 'user', content: pending.instruction }],
      workerUrl,
      useWorkerProxy,
      providerName: session.providerName,
      disableThinking: session.disableThinking,
    })) {
      if (chunk.text) fullText += chunk.text
    }
  } catch (err) {
    // A real failed attempt is NOT the same as "chose to stay quiet" — pass
    // here so the member doesn't get stuck silently waiting forever on a
    // request that already failed; the next round gives it a fresh try.
    console.warn('[GROUP-API-MEMBER] streamChat 失败:', err?.message || err)
    return submitGroupClientTurn(chatId, memberId, 'pass')
  }

  const trimmed = fullText.trim()
  if (!trimmed || trimmed === GROUP_PASS_TOKEN) {
    return submitGroupClientTurn(chatId, memberId, 'pass')
  }
  if (pending.phase === 'candidate') {
    return submitGroupClientTurn(chatId, memberId, 'request', { direction: trimmed })
  }
  return submitGroupClientTurn(chatId, memberId, 'speak', { text: trimmed })
}
