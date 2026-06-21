# pink-chat 部署信息

## Cloudflare 账户
- **account_id**: e364fa0eb012df759b774bfcada11422
- **Zone (xiaoman.xyz) zone_id**: 5fa393fcf94515670dac793ea2469c23

## Workers
| 用途 | Worker 脚本名 | 正式地址（用这个） | 备用/已废弃 |
|------|-------------|----------------|-----------|
| 主 Worker（代理+记忆+主动消息） | scheduled-message-worker | **https://chat.xiaoman.xyz** | ~~https://scheduled-message-worker.xiaoman-ac.workers.dev~~ (*.workers.dev 在国内被屏蔽) |
| 空调控制 | tuya-ac | **https://ac.xiaoman.xyz** | — |

## KV Namespace
- **名称**: PINK_CHAT_KV
- **id**: ee2f737d334c4af7b56a89f83b61092c

## 前端
- **Cloudflare Pages 项目**: pink-chat-blt
- **生产 URL**: https://pink-chat-blt.pages.dev
- **GitHub 仓库**: guyu415/7777
- **main 分支** → 生产环境自动部署

## 前端配置项对应
| 设置项 | 值 |
|--------|-----|
| Worker 代理地址 | https://chat.xiaoman.xyz |
| 空调 Worker 地址 | https://ac.xiaoman.xyz |

## 已完成的迁移
- Store 版本 12（2025-06）：首次加载时自动将旧 `*.workers.dev` 地址替换为 `chat.xiaoman.xyz`
- 前端代码中无任何硬编码 `workers.dev` 地址

## 绑定自定义域名（备忘，已执行）
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/e364fa0eb012df759b774bfcada11422/workers/domains" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <CF_API_TOKEN>" \
  -d '{
    "hostname": "chat.xiaoman.xyz",
    "service": "scheduled-message-worker",
    "environment": "production",
    "zone_id": "5fa393fcf94515670dac793ea2469c23"
  }'
```
