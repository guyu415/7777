// 制作规则演示，不新增世界观真相或远期剧情。
// forcedAt 为从第 1 日 00:00 起的绝对分钟；timeWindow 为每天的 [start,end)。
export const events = [
  { id: 'station-unlocked',title: '看见驿站',once: true,priority: 100,
    when: { nodes: ['wind','direction','observe'] },effects: { unlock: ['station'] } },
  { id: 'bell-present',title: '随身金铃',once: true,priority: 50,
    when: { nodes: ['observe'] },requiresItems: { goldBell: 1 },timeWindow: { start: 900,end: 1020 },effects: { flags: ['bell-checked'] } },
  { id: 'wind-detail-a',title: '沙丘风声',once: true,pool: 'wind-detail',mutex: 'wind-detail',weight: 3,
    when: { nodes: ['observe'] },target: 'asideWind' },
  { id: 'wind-detail-b',title: '驿站轮廓',once: true,pool: 'wind-detail',mutex: 'wind-detail',weight: 1,
    when: { nodes: ['observe'] },target: 'asideRuin' },
  { id: 'first-listen',title: '初次倾听',once: true,mutex: 'first-impression',private: true,
    when: { nodes: ['lily'],flags: ['approach-listen'] },effects: { hidden: { wuImpression: 1 } } },
  { id: 'first-ribbon',title: '初次逗弄',once: true,mutex: 'first-impression',private: true,
    when: { nodes: ['ribbon','lily'],flags: ['approach-ribbon'] },effects: { hidden: { wuImpression: -1 } } },
  { id: 'noticed-boundary',title: '容衡察觉条件',once: true,private: true,priority: 80,
    when: { stats: { yuejie: { gte: 2 } } },effects: { hidden: { rongAwareness: 1 } } },
  // 到点后优先于其他事件，resumeTo 截断余下行程，读完插入节点后接回主线。
  { id: 'fixed-encounter',title: '申时 · 驿站相遇',once: true,forcedAt: 930,priority: 1000,
    when: { notReadEvents: ['node:lily','node:end'] },target: 'timedEncounter',resumeTo: 'ask',effects: { unlock: ['station'] } },
];
