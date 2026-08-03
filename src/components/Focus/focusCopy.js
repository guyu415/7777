// 引导式访问的四步说明——内容改编自 NYRA guided-access-pomodoro 原作里的同一份
// 四步说明（见 THIRD_PARTY_NOTICES/guided-access-pomodoro/），措辞按 Eunoia 的
// 语气重写，但事实描述必须保持准确：
//   · 网页本身无法直接开启 iOS 系统锁，这一步必须用户自己动手
//   · 真正生效靠的是用户连按三下侧边键
//   · 配置过一次之后，之后可以很快再次进入
//   · 小漫不会、也不能掌握或代为设置系统退出密码
export const APPLE_GUIDE_URL = 'https://support.apple.com/111795'

export const GA_STEPS = [
  { title: '打开"设置"', body: '进入"辅助功能 → 引导式访问"，把它打开。' },
  { title: '设置退出密码', body: '如果担心自己中途手痒关掉，可以不用 Face ID，请信任的人帮忙代设密码——这个密码小漫和网页都不会知道，也没有办法帮你设置。' },
  { title: '把 Eunoia 加到主屏幕', body: '用主屏幕上的 App 图标打开，而不是普通 Safari 标签页；在标签页里开启会锁住整个 Safari，不是单独这一页。' },
  { title: '开始专注后，连按三下侧边键', body: '选择"引导式访问"，点"开始"。这一步必须由你自己在系统里完成——网页没有权限替你打开系统锁。结束时再连按三下并验证退出。' },
]

export const GA_DISCLAIMER = '这不是网页遮罩或熄屏锁机，小漫也不会在后台帮你操作手机系统。真正的单 App 限制来自 iPhone 自带的"引导式访问"，需要你自己完成上面几步；配置过一次之后，之后每次都能很快再进入。'

export const GA_SHORT_REMINDER = '想让这次专注真正锁在这一页？现在连按三下 iPhone 侧边键，选择"引导式访问"并点"开始"——这一步只能由你自己动手。'
