from pathlib import Path

path = Path('src/components/Chat/ChatWindow.jsx')
text = path.read_text()

old = '''  const handleDeleteSelected = useCallback(async () => {
    const ids = messages.filter((message) => selectedMessageIds.has(message.id)).map((message) => message.id)
    if (!ids.length) return
    if (!window.confirm(`确定删除选中的 ${ids.length} 条消息吗？`)) return
    let failed = 0
    for (const id of ids) {
      try { await deleteMsg(id) } catch { failed += 1 }
    }
    setSelectedMessageIds(new Set())
    showToast(failed ? `已删除 ${ids.length - failed} 条，${failed} 条失败` : `已删除 ${ids.length} 条消息`)
  }, [deleteMsg, messages, selectedMessageIds])
'''

new = '''  const handleDeleteSelected = useCallback(async () => {
    const ids = messages.filter((message) => selectedMessageIds.has(message.id)).map((message) => message.id)
    if (!ids.length) {
      setSelectedMessageIds(new Set())
      return
    }
    if (!window.confirm(`确定删除选中的 ${ids.length} 条消息吗？`)) return

    // Treat a confirmed multi-delete as one UI action: leave selection mode
    // immediately, then start every optimistic local delete before waiting on
    // IndexedDB/server cleanup. The old sequential await made bubbles vanish
    // one-by-one while the selection bar stayed on screen, which felt like the
    // user had to press Delete repeatedly.
    setSelectedMessageIds(new Set())
    const results = await Promise.allSettled(ids.map((id) => deleteMsg(id)))
    const failed = results.filter((result) => result.status === 'rejected').length
    showToast(failed ? `已删除 ${ids.length - failed} 条，${failed} 条失败` : `已删除 ${ids.length} 条消息`)
  }, [deleteMsg, messages, selectedMessageIds])
'''

if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('handleDeleteSelected block not found; refusing unsafe patch')

replacements = {
    'selectionMode={selectedMessageIds.size > 0}': 'selectionMode={messages.some((message) => selectedMessageIds.has(message.id))}',
    '{selectedMessageIds.size > 0 && (': '{messages.some((message) => selectedMessageIds.has(message.id)) && (',
    '已选 {selectedMessageIds.size} 条': '已选 {messages.filter((message) => selectedMessageIds.has(message.id)).length} 条',
}
for before, after in replacements.items():
    if before in text:
        text = text.replace(before, after, 1)
    elif after not in text:
        raise SystemExit(f'marker not found; refusing unsafe patch: {before}')

path.write_text(text)
