# 公告实时同步与立即推送

后台入口：“内容管理 → 公告”。发布、修改、启用、停用和删除公告后，已打开的用户页面自动同步公告；通知中心的公告页签也同步更新。

需要让用户再次看到某条公告时，在该公告卡片点击“立即推送”并确认。只有当前展示中的公告可以推送；待生效、已结束或已停用的公告需先调整展示状态或时间。推送后卡片显示最近推送时间。

普通编辑同步内容，不强制重新弹出用户在当前页面已关闭的公告。“立即推送”会产生新的推送标识，使旧关闭记录对本次推送失效一次；用户关闭后，重复事件或断线重连不会让同一次推送反复弹出。通知仍按原规则与公告分开，推送不会往个人通知列表中新增公告记录。

## 接口

| 方法 | 地址 | 用途 |
| --- | --- | --- |
| GET | `/api/v1/announcements` | 读取当前生效公告 |
| GET | `/api/v1/announcements/events` | 公开 SSE，接收当前生效公告的完整快照 |
| POST | `/api/v1/admin/announcements/{id}/push` | 管理员立即推送当前生效公告，无请求体 |

公告响应新增 `pushId` 和 `pushedAt`。旧公告为空；每次显式推送由服务端原子生成新的推送 ID 和时间，普通编辑保留这些字段。公开列表按最近创建或推送时间排序，最近推送的公告优先展示。

SSE 事件名为 `announcements`，数据为 `{"items": [...]}`，事件 ID 为快照哈希。连接和重连先返回最新状态，内容变化时发送新快照。每个 API 实例共用状态缓存与 Redis 更新订阅，5 秒状态检查覆盖丢失通知和定时生效/过期，15 秒心跳保持连接。

用户端同一页面中的公告展示和通知中心共用一条连接；网络恢复、页面重新获得焦点或重新可见时补齐最新状态。连接不可用时使用备用刷新；后续刷新失败会保留尚未过期的公告，过期公告按本地时间及时撤下。

## 发布

需同时更新 Go API、管理端、用户端与 `deploy/nginx.conf`，并执行新增公告推送字段迁移。网关为 `/api/v1/announcements/events` 关闭代理缓冲和缓存；外层反向代理也应允许 SSE 及时转发。更新前端版本后，在线页面即可持续接收新公告，后续无需为每次公告刷新页面。

本功能在网站页面内展示公告，不申请浏览器系统通知权限。推送测试使用模拟接口、临时数据库和隔离消息总线，不向真实用户发送测试公告。

## 验证

```bash
cd apps/server
go test -race ./internal/announcementstream
go test ./internal/httpapi -run Announcement -count=1

cd ../web-react
node --test scripts/test-announcement-policy.mjs
ADMIN_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/admin-announcement-push.spec.js tests/e2e/live-announcements.spec.js --project=chromium
```

主要回归包括：不刷新出现新公告、显式重推已关闭公告、重复推送快照去重、通知中心同步、备用刷新与连接恢复、过期撤下，以及旧请求结果不能覆盖更晚的实时快照。
