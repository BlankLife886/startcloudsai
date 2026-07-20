# API 契约

所有接口前缀 `/api`。响应统一：

```json
// 成功
{ "success": true, "data": { ... } }
// 失败
{ "success": false, "code": "task_not_found", "error": "任务不存在" }
```

分页统一 cursor 风格：请求 `?limit=20&cursor=<上页返回>`，响应 `data.items[]` + `data.nextCursor`（无更多为 null）。时间一律 UTC ISO8601 字符串。金额字段一律 `*Cents` 整数（分）。

鉴权：HttpOnly Cookie `sc_session`。需要登录的接口未登录返回 401 `auth_required`；管理员接口非管理员返回 403 `admin_required`。

## 认证 auth

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/auth/register` | POST | `{email, password, username?}` → 注册并登录，返回 `data.user` |
| `/api/auth/login` | POST | `{email, password}` → 登录，返回 `data.user` |
| `/api/auth/logout` | POST | 退出 |
| `/api/auth/me` | GET | 当前用户；未登录返回 200 `data.user = null` |

`user` 对象：`{id, email, username, avatarUrl, role, createdAt}`。

## 个人中心 me

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/me/profile` | PATCH | `{username?, avatarUrl?, password? {old, new}}` |
| `/api/me/overview` | GET | `{wallet: {balanceCents, frozenCents}, taskStats: {total, succeeded, failed, running}, taskStatsByType: {t2i: n, ...}, unreadNotifications, recentTasks: [...]}` |
| `/api/me/wallet` | GET | `{balanceCents, frozenCents}` |
| `/api/me/wallet/ledger` | GET | 分页账本 `{id, kind, deltaCents, balanceAfterCents, sourceType, sourceId, reason, createdAt}` |
| `/api/me/notifications` | GET | 分页 `{id, title, body, kind, readAt, createdAt}`（含全站公告合并） |
| `/api/me/notifications/read` | POST | `{ids?: []}`，缺省为全部已读 |

## 任务 tasks

任务类型 `type`：`t2i` 文生图 | `coloring` 插画染色 | `ui_design` UI设计稿 | `model_sheet` 超高清模型图 | `game_art` 游戏设计 | `puzzle` AI拼图。

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/tasks` | POST | `{type, prompt, params?: {...}, inputKeys?: [r2key], count?: 1-4, idempotencyKey?}` → 校验余额并冻结费用，入队。返回完整 task 对象 |
| `/api/tasks` | GET | `?type=&status=&limit=&cursor=` 当前用户任务列表 |
| `/api/tasks/{id}` | GET | 任务详情（轮询用） |
| `/api/tasks/{id}/cancel` | POST | 仅 `queued` 可取消，解冻费用 |
| `/api/tasks/{id}` | DELETE | 删除记录（终态任务），同时删除 R2 产物 |

`task` 对象：

```json
{
  "id": "uuid", "type": "t2i", "status": "queued|running|succeeded|failed|canceled",
  "prompt": "...", "params": {}, "count": 1,
  "inputKeys": ["uploads/u1/xx.png"], "outputKeys": ["tasks/u1/t1/0.png"],
  "outputUrls": ["https://..."],          // 服务端生成的短期可读 URL，仅详情/列表返回
  "costCents": 20, "errorCode": null, "errorMessage": null,
  "createdAt": "...", "startedAt": null, "finishedAt": null
}
```

任务单价来自 `GET /api/meta/pricing`（见下），提交时按 `count × 单价` 冻结。

## 上传与文件

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/uploads` | POST | multipart `file`（≤15MB，png/jpg/webp）→ `{key, url}` |
| `/api/files/{key:path}` | GET | 302 重定向到 R2 presigned URL（校验属主：uploads/tasks 前缀须为本人；gallery 已过审公开；**role=admin 可读任意 key**） |

## 套餐与订单

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/plans` | GET | 上架套餐 `{id, code, name, priceCents, grantCents, bonusCents, features[], sort}` |
| `/api/orders` | POST | `{planId}` → 创建订单 `{id, status: "pending", amountCents, payUrl?}` |
| `/api/orders/{id}` | GET | 订单状态轮询 `{id, status: pending/paid/completed/failed/expired, ...}` |
| `/api/orders` | GET | 我的订单分页 |
| `/api/payments/webhook/{provider}` | POST | 支付回调（幂等；provider 首期支持 `mock`，生产接入时扩展） |

订单完成 = 状态条件更新为 `completed` + 幂等入账 `grantCents + bonusCents` 到钱包，同一事务。

## 画廊 gallery

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/gallery` | GET | 公开已过审作品分页 `{id, title, coverUrl, mediaUrls[], author: {id, username, avatarUrl}, createdAt}` |
| `/api/gallery/submissions` | POST | `{taskId, title}` 把自己成功任务投稿（校验产物仍在） |
| `/api/me/gallery/submissions` | GET | 我的投稿及审核状态 |
| `/api/me/gallery/submissions/{id}` | DELETE | 撤回/删除投稿 |

## 元信息 meta

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/meta/pricing` | GET | `{taskPrices: {t2i: cents, coloring: cents, ...}, freeDailyCents}` |
| `/api/meta/changelog` | GET | 更新说明条目（后台可维护，`{id, version, date, tag, title, summary, items[]}`） |
| `/api/meta/announcements` | GET | 生效中公告 |
| `/api/health` | GET | 健康检查 `{status: "ok"}` |

## 后台 admin（全部要求 role=admin）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/admin/stats` | GET | 总用户/今日新增/任务量与成功率（近7日）/收入（近30日）/钱包总余额 |
| `/api/admin/users` | GET | 搜索分页（email/username/status） |
| `/api/admin/users/{id}` | PATCH | `{status?: active/banned, role?}` |
| `/api/admin/users/{id}/wallet-adjust` | POST | `{deltaCents, reason}` 人工调整（走账本，kind=admin_adjust） |
| `/api/admin/orders` | GET | 订单分页筛选 |
| `/api/admin/orders/{id}/complete` | POST | 人工补单（幂等入账） |
| `/api/admin/plans` | GET/POST | 套餐列表/新建 |
| `/api/admin/plans/{id}` | PATCH/DELETE | 修改/下架 |
| `/api/admin/tasks` | GET | 全站任务监控（筛 type/status/user） |
| `/api/admin/tasks/{id}/requeue` | POST | 失败任务重新入队（不重复扣费） |
| `/api/admin/gallery/submissions` | GET | 待审/全部投稿 |
| `/api/admin/gallery/submissions/{id}/review` | POST | `{action: approve/reject/remove, reason?}` |
| `/api/admin/announcements` | GET/POST，`/{id}` PATCH/DELETE | 公告管理 |
| `/api/admin/changelog` | GET/POST，`/{id}` PATCH/DELETE | 更新说明管理 |
| `/api/admin/settings` | GET/PUT | 运营配置（任务单价、用户并发上限、注册开关等） |
| `/api/admin/settings/test-c2a` | POST | 测试 chatgpt2api 连通性（调 `/v1/models`） |

### 后台扩展接口（v2 增补）

| 接口 | 方法 | 说明 |
| --- | --- | --- |
| `/api/admin/users/{id}` | GET | 用户详情：`{user, wallet: {balanceCents, frozenCents}, counts: {orders, tasksTotal, tasksSucceeded, tasksFailed, tasksRunning, submissions}}` |
| `/api/admin/users/{id}/ledger` | GET | 该用户账本流水（cursor 分页，条目同 `/api/me/wallet/ledger`） |
| `/api/admin/users/{id}/reset-password` | POST | `{newPassword}`（≥8位），同时使该用户所有 session 失效 |
| `/api/admin/ledger` | GET | 全站账本流水，`?kind=&sourceType=&user=`（user 同任务筛选语义），条目额外带 `userEmail` |
| `/api/admin/finance/summary` | GET | `?days=30`（7-90）→ `{revenueDaily: [{date, amountCents}], spendDaily: [{date, amountCents}], totals: {revenueCents, spendCents, grantCents, refundCents}}`（spend=任务结算，grant=全部入账，refund=解冻退还） |
| `/api/admin/tasks/{id}/cancel` | POST | 取消 queued 任务并解冻（同用户端语义，管理员可操作任何人） |
| `/api/admin/tasks/{id}/force-fail` | POST | 把卡死的 running 任务强制置为 failed 并解冻（errorCode=admin_force_failed） |
| `/api/admin/audit-logs` | GET | 操作审计分页：`{id, adminEmail, method, path, action, targetId, status, ip, createdAt, detail}`，`?admin=&path=` 筛选 |

**stats 增补字段**：`typeDistribution: {t2i: n, ...}`（近30日各类型任务数）。

**审计规则**：所有 `/api/admin/*` 的非 GET 请求成功与否都写 `admin_audit_logs`（记录 method/path/状态码/目标 id/请求体摘要，密码等敏感字段脱敏为 `***`）。

**settings 增补**：`taskModels` 支持按类型覆盖（`{"default": "gpt-image-2", "coloring": "..."}`），后台设置页可编辑。

### 后台接口字段补充定义（联调对齐基准）

- `GET /api/admin/stats` 响应：`{totalUsers, newUsersToday, taskDaily: [{date, total, succeeded}](近7日), revenueCents(近30日), walletBalanceCents(全站可用余额合计), runningTasks}`。
- `GET /api/admin/users` 查询参数：`?search=`（匹配 email/username）`&status=`。
- `GET /api/admin/tasks` 查询参数：`?type=&status=&user=`（user 接受用户 id 或邮箱）。
- 套餐上架字段统一为 **`active: boolean`**（与数据库一致；admin 端如用 enabled 需改为 active）。公告生效字段同样为 `active`。
- `GET/PUT /api/admin/settings` 响应/请求体：`{taskPrices: {type: cents}, userMaxRunningTasks, registrationEnabled, signupBonusCents}`（注意是 `signupBonusCents`）。
- `POST /api/admin/settings/test-c2a` 成功响应：`{ok: true, modelCount, models: [id...]（最多前20个）}`；失败走统一错误格式。
- 订单列表项携带 `userEmail` 与 `planName` 扁平字段；任务列表项携带 `userEmail`。

## 错误码约定

`auth_required` `admin_required` `invalid_credentials` `email_exists` `insufficient_balance`
`task_not_found` `task_not_cancelable` `user_task_limit` `upload_too_large` `unsupported_file`
`plan_not_found` `order_not_found` `order_not_payable` `submission_not_allowed` `not_found`
`validation_error` `rate_limited` `internal_error`
