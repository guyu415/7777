// 群聊「小游戏」注册表。
//
// 第一版只有剧本杀。以后要加扑克/桌游，只在这里加一条，再写一个自己的房间
// 组件挂到 GroupChatWindow 的同一个入口上——「小游戏」这个菜单项本身不用再改。
export const GROUP_GAMES = [
  {
    id: 'mystery',
    label: '剧本杀',
    icon: '🕯️',
    description: '沉浸式情感本，群成员各自出演一个角色',
    available: true,
  },
  {
    id: 'poker',
    label: '扑克',
    icon: '🃏',
    description: '斗地主 / 炸金花，四川版升级筹备中',
    available: true,
  },
]
