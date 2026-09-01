export function shouldShowPendingReply(messages, isLoading) {
  if (!isLoading) return false
  return !(Array.isArray(messages) ? messages : []).some(message => (
    message?.role === 'assistant'
    && (message.streaming || message.reasoningStreaming || message.voiceLoading)
  ))
}

export function messageListItemCount(messages, showPendingReply) {
  return (Array.isArray(messages) ? messages.length : 0) + (showPendingReply ? 1 : 0)
}
