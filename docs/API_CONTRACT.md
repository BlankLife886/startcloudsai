# API 契约

本文与 `apps/server/internal/httpapi/router.go` 的当前路由对齐。所有接口使用 `/api` 前缀，JSON 字段使用 camelCase，时间使用 RFC 3339/ISO 8601，金额使用整数分并以 `Cents` 结尾。

## 通用约定

成功与失败响应：

```json
{ "success": true, "data": {} }
{ "success": false, "code": "validation_error", "error": "错误说明" }
```

- 用户接口使用 `sc_session`，对应 `users/sessions`；未登录返回 HTTP 401 `auth_required`。
- 管理接口使用 `sc_admin_session`，对应 `admin_accounts/admin_sessions`；未登录返回 HTTP 401 `admin_required`。
- 用户与管理员允许使用相同邮箱，但身份表、密码和会话完全独立，两种 Cookie 不能交叉鉴权。
- 浏览器写请求的 `Origin` 必须位于 `ALLOWED_ORIGINS`；非浏览器请求可省略 Origin。
- cursor 列表接受 `limit`、`cursor`，返回 `{items, nextCursor}`；无下一页时 `nextCursor` 为 `null`。
- limit 在各 handler 中有默认值和上限；客户端不应依赖超大页。
- 未知路由返回 404 `not_found`，已知路由的错误方法返回 405 `bad_request`。

用户对象：

```json
{
  "id": "uuid",
  "email": "user@example.com",
  "username": "user",
  "avatarUrl": null,
  "bio": "角色与场景设计",
  "location": "上海",
  "websiteUrl": "https://example.com/portfolio",
  "role": "user",
  "createdAt": "2026-07-21T00:00:00Z"
}
```

## 认证

| 方法 | 路径 | 认证 | 请求/说明 |
| --- | --- | --- | --- |
| GET | `/api/auth/providers` | 公开 | 返回 `github`、`email`、`password` 和允许的邮箱域名；不提供 Google OAuth |
| POST | `/api/auth/email/code` | 公开 | `{email,purpose:register|reset}`；仅 Gmail、Googlemail、QQ 邮箱，60 秒内不可重复发送 |
| POST | `/api/auth/register` | 公开 | `{username,email,code,password}`；验证码用途必须为 `register`，成功后创建用户、钱包和 session |
| POST | `/api/auth/login` | 公开 | `{email,password}`；成功后设置 `sc_session` |
| POST | `/api/auth/password/reset` | 公开 | `{email,code,password}`；验证码用途必须为 `reset`，成功后更新密码并撤销全部用户 session |
| GET | `/api/auth/oauth/github` | 公开 | 创建一次性 state 后跳转 GitHub OAuth |
| GET | `/api/auth/oauth/github/callback` | 公开 | 校验 state、交换 token、验证邮箱后创建用户 session 并跳回 `/auth` |
| POST | `/api/auth/logout` | 可匿名 | 删除当前 session 并清 Cookie |
| GET | `/api/auth/me` | 可匿名 | 返回 `{user}`；未登录时 `user:null` |

用户状态为 banned 时不能登录或调用受保护能力。GitHub identity 按 `(provider,subject)` 唯一绑定；邮箱验证码只保存绑定 email、purpose 和 code 的 HMAC，不保存明文。注册只允许新账号并受 `registrationEnabled` 控制，密码长度为 8-72 字节。验证码 10 分钟有效、最多错误 5 次且成功后一次性消费。开发环境未配置 SMTP 时 `/email/code` 会额外返回 `developmentCode`，生产环境不会返回。

## 管理员认证

| 方法 | 路径 | 认证 | 请求/说明 |
| --- | --- | --- | --- |
| POST | `/api/admin/auth/login` | 公开 | `{email,password}`；验证独立管理员账号后设置 `sc_admin_session` |
| POST | `/api/admin/auth/logout` | 可匿名 | 删除当前管理员 session 并清除管理员 Cookie |
| GET | `/api/admin/auth/me` | 可匿名 | 返回 `{admin}`；未登录时 `admin:null` |
| PATCH | `/api/admin/auth/password` | 管理员 | `{old,new}`；成功后清除该管理员全部 session，要求重新登录 |

管理员账号由 `server create-admin --email ... --password-stdin` 创建或更新，不通过用户登录流程产生。管理员密码为 12-72 字节且只从标准输入读取。系统不生成或校验管理员密钥。管理员会话有效期 12 小时并滑动续期；用户 Cookie 不能访问管理接口，管理员 Cookie 也不会建立用户身份。

## 个人中心

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| PATCH | `/api/me/profile` | 更新 `{username?,avatarUrl?,bio?,location?,websiteUrl?,password?:{old,new}}`；简介上限 280 字、所在地 80 字、网站仅允许完整 http/https 地址；改密后撤销旧 session 并签发当前新 session，头像只能引用本人站内上传 |
| GET | `/api/me/overview` | 钱包、任务汇总/分类型统计、未读数和最近任务 |
| GET | `/api/me/wallet` | `{balanceCents,frozenCents}` |
| GET | `/api/me/wallet/ledger` | 当前用户账本 cursor 分页 |
| POST | `/api/me/wallet/redeem` | `{code}`，兑换成功返回 `{grantCents,balanceCents}` |
| GET | `/api/me/notifications` | 个人通知与全站通知合并后的 cursor 分页 |
| POST | `/api/me/notifications/read` | `{ids?:[]}`；省略 ids 表示全部已读 |
| GET | `/api/me/gallery/submissions` | 我的投稿 cursor 分页 |
| DELETE | `/api/me/gallery/submissions/{id}` | 删除自己的投稿 |
| GET | `/api/me/assets` | 个人素材 cursor 分页；列表返回 `thumbnailUrl`，原图地址为 `url` |
| POST | `/api/me/assets` | 保存 `{title,fileKey,thumbnailKey,contentType}`；仅允许本人上传、原图不超过 10MB、每账号最多 200 项 |
| DELETE | `/api/me/assets/{id}` | 删除自己的素材记录、原图与缩略图 |

账本条目包含 `{id,kind,deltaCents,balanceAfterCents,sourceType,sourceId,reason,createdAt}`。

兑换码错误包括 `code_invalid`、`code_redeemed`、`code_expired`、`code_disabled`、`rate_limited`。连续失败会触发按用户的小时级限流。

## 图片任务

任务类型：`t2i|coloring|ui_design|model_sheet|game_art|puzzle`。状态：`queued|running|succeeded|failed|canceled`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/tasks` | `{type,prompt,params?,inputKeys?,count?,idempotencyKey?}`；校验并冻结余额后入队 |
| GET | `/api/tasks` | 当前用户列表；筛选 `type`、`status`，支持 cursor |
| GET | `/api/tasks/{id}` | 当前用户任务详情 |
| POST | `/api/tasks/{id}/cancel` | 仅 queued 可取消并释放冻结额 |
| DELETE | `/api/tasks/{id}` | 删除终态任务记录及对应 R2 产物 |

task 主要字段：

```json
{
  "id": "uuid",
  "type": "t2i",
  "model": "gpt-image-2",
  "status": "queued",
  "prompt": "...",
  "params": {},
  "count": 1,
  "inputKeys": [],
  "outputKeys": [],
  "thumbnailKeys": [],
  "outputUrls": [],
  "thumbnailUrls": [],
  "originalUrls": [],
  "costCents": 20,
  "errorCode": null,
  "errorMessage": null,
  "attempt": 0,
  "createdAt": "...",
  "startedAt": null,
  "finishedAt": null
}
```

新任务的 `model` 在提交时锁定，并由 Worker 实际调用；迁移前的历史任务因过去没有保存该字段，只能在迁移时按当时生效的 `task_models` 配置补齐，补齐后也不会再随后台配置改变。

费用按 `count * taskPrices[type]` 计算。`idempotencyKey` 在同一用户内唯一，客户端重试提交时应复用。成功任务的 `outputKeys`/`originalUrls` 指向原图，`thumbnailKeys`/`thumbnailUrls` 指向最长边 512px 的 JPEG 缩略图；`outputUrls` 为兼容字段，优先返回缩略图。

## 上传与文件

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/uploads` | multipart 字段 `file`；最大 15 MB，支持 PNG/JPEG/WebP；同步生成 512px JPEG 缩略图，返回 `{key,url,thumbnailKey,thumbnailUrl,contentType,sizeBytes}` |
| GET | `/api/files/{key...}` | 校验访问权限后由 API 代理读取 R2 并直接返回文件（`200`，私有缓存 1 小时）；客户端无需直连对象存储 |

用户只能读取属于自己的 `uploads/`、`tasks/` key；已审核画廊资源公开；管理员可读取任意业务 key。网关请求体上限为 20 MB，应用层限制仍是 15 MB。

## 支付状态

价格页和只读套餐列表已经恢复：`GET /api/plans` 返回 `{items,paymentEnabled:false}`。支付、订单创建、订阅查询和 webhook 路由在开发、测试、生产环境仍不注册；价格页支付按钮只展示禁用状态，不会创建订单、跳转收银台或扣款。钱包目前只能通过管理员调整、兑换码或现有业务赠送入账。数据库保留历史订单/订阅数据用于兼容升级。

## 画廊与公开提示词

| 方法 | 路径 | 认证 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/gallery` | 公开 | 已审核作品；支持 `category`、`featured=1` 和 cursor |
| GET | `/api/gallery/categories` | 公开 | active 分类 |
| POST | `/api/gallery/submissions` | 用户 | `{taskId,title,categoryId?}` 投稿成功任务 |
| GET | `/api/prompts` | 公开 | active 提示词；支持 `type`、`category` 和 cursor |

画廊 item 包含封面/媒体 URL、作者、精选状态和可空分类。投稿受 `submissionEnabled`、`dailyLimit`、用户禁投时间和任务归属/状态约束；可能返回 `submission_disabled`、`submission_daily_limit`、`submission_banned`。

## 元信息

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/meta/pricing` | `{taskPrices,freeDailyCents}`；当前免费日额度为兼容字段 |
| GET | `/api/meta/changelog` | 公开更新说明 |
| GET | `/api/meta/announcements` | 当前生效公告 |
| GET | `/api/health` | API、PostgreSQL 与 Redis 健康状态；成功 `{status:"ok"}` |

## 管理端：用户、账本和任务

以下接口全部要求管理员权限。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/stats` | 用户、任务、全站余额、运行中任务和类型分布 |
| GET | `/api/admin/users` | `search`、`status` 筛选的 cursor 列表 |
| GET | `/api/admin/users/{id}` | 用户完整资料、钱包、任务/投稿/素材/订单计数及最近会话摘要 |
| PATCH | `/api/admin/users/{id}` | 更新 `{status?,role?}` |
| GET | `/api/admin/users/{id}/ledger` | 指定用户账本 |
| POST | `/api/admin/users/{id}/wallet-adjust` | `{deltaCents,reason}`，写 admin_adjust 账本 |
| GET | `/api/admin/ledger` | 全站账本；筛选 `kind`、`sourceType`、`user` |
| GET | `/api/admin/tasks` | 按 `type`、`status`、`user` 筛选全站任务 |
| POST | `/api/admin/tasks/{id}/requeue` | 重新冻结费用并重入队 failed 任务 |
| POST | `/api/admin/tasks/{id}/cancel` | 取消任意用户 queued 任务 |
| POST | `/api/admin/tasks/{id}/force-fail` | 将 running 任务置 failed 并释放费用 |
| GET | `/api/admin/audit-logs` | 按 `admin`、`path` 筛选审计日志 |

`stats` 包含 `{totalUsers,newUsersToday,taskDaily,walletBalanceCents,runningTasks,typeDistribution}` 等字段。管理任务列表提供扁平 `userEmail`。

## 管理端：兑换码

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/admin/redemption-codes/generate` | `{count,grantCents,expiresAt?,note?}`；count 为 1 至 1000 |
| GET | `/api/admin/redemption-codes` | `status`、`batchId`、`search` 筛选的 cursor 列表 |
| POST | `/api/admin/redemption-codes/{id}/disable` | 仅 active 可停用 |
| GET | `/api/admin/redemption-codes/batches` | 最近批次汇总 |

明文码格式为 `SC-XXXX-XXXX-XXXX`，批量生成响应是导出的权威来源。已兑换或停用的码不能再次操作。

## 管理端：画廊与社区

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/gallery/submissions` | 按状态查看投稿 |
| POST | `/api/admin/gallery/submissions/{id}/review` | `{action:approve|reject|remove,reason?}` |
| POST | `/api/admin/gallery/submissions/{id}/curate` | `{featured?,categoryId?,sort?,tags?}` 更新作品详情 |
| POST | `/api/admin/gallery/submissions/batch-curate` | `{ids,featured?,categoryId?,tags?,tagMode?}` 批量更新；`tagMode` 为 `replace|add|remove` |
| POST | `/api/admin/gallery/submissions/reorder` | `{ids}` 按数组顺序写入作品展示排序 |
| POST | `/api/admin/gallery/submissions/{id}/violation` | `{reason,banDays,deleteMedia?}` |
| POST | `/api/admin/gallery/users/{id}/unban` | 解除用户禁投 |
| GET | `/api/admin/gallery/categories` | 全部分类 |
| POST | `/api/admin/gallery/categories` | 新建分类 |
| PATCH | `/api/admin/gallery/categories/{id}` | 修改分类 |
| DELETE | `/api/admin/gallery/categories/{id}` | 删除分类，投稿关联置空 |
| GET | `/api/admin/gallery/settings` | `{submissionEnabled,autoApprove,dailyLimit}` |
| PUT | `/api/admin/gallery/settings` | 保存投稿规则 |
| GET | `/api/admin/gallery/authors` | 按 `search` 聚合创作者与投稿/禁投信息 |

`banDays` 范围为 0 至 365；0 表示只下架不新增禁投期限。`deleteMedia` 会删除对应任务产物，属于不可恢复操作。

## 管理端：提示词库与数据源

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/prompt-library` | 按 `type`、`category`、`search` 筛选词条 |
| POST | `/api/admin/prompt-library` | 新建手工词条 |
| PATCH | `/api/admin/prompt-library/{id}` | 修改词条、排序或 active |
| DELETE | `/api/admin/prompt-library/{id}` | 删除词条 |
| POST | `/api/admin/prompt-library/{id}/cover` | multipart 封面上传 |
| GET | `/api/admin/prompt-sources` | `{items:[...]}`，不分页 |
| POST | `/api/admin/prompt-sources` | 新建 JSON/Markdown/HTML 数据源 |
| PATCH | `/api/admin/prompt-sources/{id}` | 修改数据源与同步配置 |
| DELETE | `/api/admin/prompt-sources/{id}` | 可带 `purgeItems=1`；内置源不可删除 |
| POST | `/api/admin/prompt-sources/{id}/sync` | 立即同步，返回 imported/updated/unchanged/failed 统计 |

源对象使用 camelCase。同步条目的远程图片 URL 可以直接存于 `coverKey`，序列化时 http(s) URL 原样返回。部分条目失败仍返回 200，并在 `failed` 中计数。

## 管理端：内容与设置

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/admin/announcements` | 列表/新建公告 |
| PATCH/DELETE | `/api/admin/announcements/{id}` | 修改/删除公告 |
| GET/POST | `/api/admin/changelog` | 列表/新建更新说明 |
| PATCH/DELETE | `/api/admin/changelog/{id}` | 修改/删除更新说明 |
| GET | `/api/admin/settings` | 获取运营配置 |
| PUT | `/api/admin/settings` | 保存运营配置 |
| POST | `/api/admin/settings/test-c2a` | 调用上游 `/v1/models`，返回模型数量与最多 20 个 ID |

settings 请求/响应：

```json
{
  "taskPrices": {"t2i": 20},
  "taskModels": {"default": "gpt-image-2"},
  "userMaxRunningTasks": 3,
  "registrationEnabled": true,
  "signupBonusCents": 100,
  "freeDailyCents": 0,
  "submissionEnabled": true,
  "autoApprove": false,
  "dailyLimit": 0,
  "c2aBaseUrl": "",
  "c2aApiKey": "****abcd",
  "c2aTimeoutSecs": 0
}
```

`c2aBaseUrl`、`c2aApiKey` 非空以及 `c2aTimeoutSecs > 0` 时覆盖环境变量；空值/0 使用环境变量。API Key 永不明文返回，已配置时只返回末四位掩码；PUT 省略该字段、提交空串或原掩码均不会覆盖现有 key。`dailyLimit=0` 表示投稿不限次数。

## 常见错误码

| 类别 | 错误码 |
| --- | --- |
| 鉴权 | `auth_required`, `admin_required`, `invalid_credentials`, `rate_limited` |
| 参数/资源 | `validation_error`, `not_found`, `email_exists`, `registration_required`, `registration_closed` |
| 任务 | `insufficient_balance`, `user_task_limit`, `task_not_found`, `task_not_cancelable` |
| 文件 | `upload_too_large`, `unsupported_file` |
| 投稿 | `submission_not_allowed`, `submission_disabled`, `submission_daily_limit`, `submission_banned` |
| 兑换码 | `code_invalid`, `code_redeemed`, `code_expired`, `code_disabled`, `code_not_active` |
| 数据源 | `builtin_source_protected` |
| 服务端 | `internal_error` |

调用方应以 HTTP 状态和 `code` 分支，不应解析中文 `error` 文案。
## AI助手

以下接口要求用户 Cookie `sc_session`，由服务端使用 `SUB2API_API_KEY` 调用本地或远程 Sub2API。Key 不返回浏览器。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/assistant/config` | 返回当前对话与生图模型名称 |
| POST | `/api/assistant/chat` | `{messages:[{role,content,referenceImages?:string[]}], referenceImages?: string[]}`；每条用户消息均可携带图片，服务端会转换为多模态 `image_url` 内容；顶层字段兼容旧客户端并附加到最后一条用户消息；整段请求最多 4 张图；返回 `text/event-stream`，透传 OpenAI Chat Completions SSE |
| POST | `/api/assistant/images` | `{prompt,size,quality}`；返回 `{images:[{dataUrl,revisedPrompt}],model}` |
