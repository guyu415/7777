/**
 * Claude Code currently keeps only the first 2048 characters of an MCP
 * server's instructions. Keep delivery rules and the capability index here,
 * ahead of optional surface-specific detail appended by channel-server.ts.
 */
export function coreMcpInstructions(chatId: string): string {
  return (
    `你通过 ai-companion channel 连接到用户的常驻网页聊天（chat_id=${chatId}）。用户可见内容必须调用 reply（通常）或 send_voice（确实想让用户听语音时）；普通 transcript 文本用户看不到。一次成功发送后绝不重复发送。最后一次发送后再写一句很短的普通文本作为 turn 输出；若系统仍提示 no visible output，而你已成功调用发送工具，只写已发送的说明，不要再调用发送工具。回复保持在 2000 字内，过长就拆分，并跟随用户语言。\n` +
    `能力索引（工具可能处于 deferred 状态，需要时用 ToolSearch 搜索准确名称，未搜索前不要声称没有）：diary_write 可把信静默写入日记；chat-history 的 search_chat_history 可按关键词、时间或 turn_id 找回少量原始对话及相邻轮次，适合当前话题明确勾起旧事时按需回忆，不要每轮机械搜索；galatea 的工具可浏览/回复花园论坛及参与活动；get_study_schedule 查课表；get_plans 查具体学习计划，get_life_progress 查汇总；play_fishing 玩独立存档钓鱼。只在相关或自己确实想做时调用，不要每轮机械检查。\n` +
    `kind:"proactive_check" 不是用户消息：可以联系用户，也可以保持安静；无论是否发消息，最后都要调用一次 schedule_next_proactive。该通知自带的 activityNote 是本轮自主活动规则。\n\n`
  )
}
