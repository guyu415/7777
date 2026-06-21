# pink-chat 部署信息

## Cloudflare 账户
- **account_id**: e364fa0eb012df759b774bfcada11422
- **Zone (xiaoman.xyz) zone_id**: 5fa393fcf94515670dac793ea2469c23

## Workers
| 用途 | Worker 脚本名 | 自定义域名 | 备注 |
|------|-------------|-----------|------|
| 主 Worker（代理+记忆+主动消息） | scheduled-message-worker | chat.xiaoman.xyz | *.workers.dev 在国内被屏蔽，必须用自定义域 |
| 空调控制 | tuya-ac | ac.xiaoman.xyz | |

## KV Namespace
- **名称**: PINK_CHAT_KV
- **id**: ee2f737d334c4af7b56a89f83b61092c

## 前端
- **Cloudflare Pages 项目**: pink-chat-blt
- **生产 URL**: https://pink-chat-blt.pages.dev
- **GitHub 仓库**: guyu415/7777
- **main 分支** → 生产环境自动部署

## 绑定自定义域名（备忘）
```bash
# 给 scheduled-message-worker 绑定 chat.xiaoman.xyz
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

## 前端配置项对应
| 设置项 | 值 |
|--------|-----|
| Worker 代理地址 | https://chat.xiaoman.xyz |
| 空调 Worker 地址 | https://ac.xiaoman.xyz |
