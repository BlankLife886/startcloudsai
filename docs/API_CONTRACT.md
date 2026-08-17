# API 契约

本文与 `apps/server/internal/httpapi/router.go` 的当前路由对齐。所有业务接口使用 `/api/v1` 前缀，JSON 字段使用 camelCase，时间使用 RFC 3339/ISO 8601，金额使用整数分并以 `Cents` 结尾。当前版本不注册旧 `/api/*` 兼容路由。

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
- 创建资源成功返回 `201 Created`；读取和带响应表示的更新返回 `200 OK`；无响应体的删除或更新返回 `204 No Content`。

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

| 方法 | 路径                     | 认证   | 请求/说明                                                                                          |
| ---- | ------------------------ | ------ | -------------------------------------------------------------------------------------------------- |
| GET  | `/api/v1/auth/providers`    | 公开   | 返回邮箱验证码可用状态和允许的邮箱域名                                                             |
| POST | `/api/v1/auth/email-verification-codes`   | 公开   | `{email}`；仅 Gmail、Googlemail、QQ 邮箱，60 秒内不可重复发送                                      |
| POST | `/api/v1/auth/session` | 公开   | `{email,code}`；已有用户直接登录，首次邮箱原子创建用户、钱包、初始积分和 session；返回 `isNewUser` |
| DELETE | `/api/v1/auth/session`       | 可匿名 | 删除当前 session 并清 Cookie                                                                       |
| GET  | `/api/v1/auth/session`           | 可匿名 | 返回 `{user}`；未登录时 `user:null`                                                                |

用户状态为 banned 时不能登录或调用受保护能力。邮箱验证码只保存规范化 email 与 code 的 HMAC，不保存明文。首次自动建号受 `registrationEnabled` 控制，已有用户登录不受该开关影响。验证码 10 分钟有效、最多错误 5 次且成功后一次性消费。开发环境未配置 SMTP 时 `/auth/email-verification-codes` 会额外返回 `developmentCode`，生产环境不会返回。

## 管理员认证

| 方法  | 路径                       | 认证   | 请求/说明                                                       |
| ----- | -------------------------- | ------ | --------------------------------------------------------------- |
| POST  | `/api/v1/admin/auth/session`    | 公开   | `{email,password}`；验证独立管理员账号后设置 `sc_admin_session` |
| DELETE | `/api/v1/admin/auth/session`   | 可匿名 | 删除当前管理员 session 并清除管理员 Cookie                      |
| GET   | `/api/v1/admin/auth/session`       | 可匿名 | 返回 `{admin}`；未登录时 `admin:null`                           |
| PATCH | `/api/v1/admin/auth/password` | 管理员 | `{old,new}`；成功后清除该管理员全部 session，要求重新登录       |

管理员账号由 `server create-admin --email ... --password-stdin` 创建或更新，不通过用户登录流程产生。管理员密码为 12-72 字节且只从标准输入读取。系统不生成或校验管理员密钥。管理员会话有效期 12 小时并滑动续期；用户 Cookie 不能访问管理接口，管理员 Cookie 也不会建立用户身份。

## 个人中心

| 方法   | 路径                               | 说明                                                                                                                                                                                                             |
| ------ | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH  | `/api/v1/me/profile`                  | 更新 `{username?,avatarUrl?,bio?,location?,websiteUrl?,password?:{old,new}}`；简介上限 280 字、所在地 80 字、网站仅允许完整 http/https 地址；改密后撤销旧 session 并签发当前新 session，头像只能引用本人站内上传 |
| GET    | `/api/v1/me/overview`                 | 钱包、任务汇总/分类型统计、未读数和最近任务                                                                                                                                                                      |
| GET    | `/api/v1/me/wallet`                   | `{availableCents,balanceCents,frozenCents,totalCents,...}`；`balanceCents` 是 `availableCents` 的兼容别名，禁止再次减去冻结额                                                                                   |
| GET    | `/api/v1/me/wallet/entries`            | 当前用户账本 cursor 分页                                                                                                                                                                                         |
| POST   | `/api/v1/me/wallet/redemptions`            | `{code}`，兑换成功返回 `{grantCents,balanceCents}`                                                                                                                                                               |
| GET    | `/api/v1/trial-access-campaign`             | 当前唯一且未过期的体验活动，包含 `expiresAt` 与 `remainingSeconds`；无可用活动时 `campaign:null`                                                                                                                   |
| GET    | `/api/v1/me/trial-access-application`       | 当前用户在当前启用活动中的申请；无启用活动或未申请时 `application:null`                                                                                                                                           |
| POST   | `/api/v1/me/trial-access-applications`      | `{occupation,reason}`；最多 4 个职业、理由 10-1000 字；按活动期次提交，被拒绝后重新提交会取得新序号                                                                                                               |
| POST   | `/api/v1/me/trial-access-application/reward` | 领取当前启用活动审核通过后发放的体验积分礼包；重复请求幂等                                                                                                                                                       |
| GET    | `/api/v1/me/feedback`                       | 当前用户反馈记录的 cursor 分页                                                                                                                                                                                     |
| POST   | `/api/v1/me/feedback`                       | `{category,title,content,pageUrl?}`；每天最多提交 20 条                                                                                                                                                            |
| GET    | `/api/v1/me/checkin`                        | 当前签到活动、今日状态、7 天奖励、本月记录、连续天数与钱包余额                                                                                                                                                    |
| POST   | `/api/v1/me/checkin`                        | 领取当日签到积分；北京时间自然日内幂等，重复或并发请求不会重复入账                                                                                                                                                |
| GET    | `/api/v1/me/growth`                         | 好友拼团、会员、失败补偿、用量里程碑和建议采纳；同时返回当前拼团及奖励进度                                                                                                                                          |
| POST   | `/api/v1/me/growth/groups`                  | 创建当期好友拼团；同一用户同一活动批次只能参加一个有效拼团                                                                                                                                                        |
| POST   | `/api/v1/me/growth/groups/join`             | `{code}` 加入拼团；满员后同一事务向全部成员各发放一次积分                                                                                                                                                         |
| GET    | `/api/v1/me/notifications`            | 个人通知与全站通知合并后的 cursor 分页                                                                                                                                                                           |
| PATCH  | `/api/v1/me/notifications`       | `{ids?:[]}`；省略 ids 表示全部已读；成功返回 204                                                                                                                                                                 |
| GET    | `/api/v1/me/gallery/submissions`      | 我的投稿 cursor 分页                                                                                                                                                                                             |
| DELETE | `/api/v1/me/gallery/submissions/{id}` | 删除自己的投稿                                                                                                                                                                                                   |
| GET    | `/api/v1/me/assets`                   | 个人素材 cursor 分页；可选 `groupId=all\|ungrouped\|{uuid}`；列表返回 `thumbnailUrl`、`groupId`，原图地址为 `url`                                                                                                  |
| POST   | `/api/v1/me/assets`                   | 保存 `{title,fileKey,thumbnailKey,contentType,groupId?}`；仅允许本人上传、原图不超过 10MB、每账号最多 200 项                                                                                                      |
| PATCH  | `/api/v1/me/assets/{id}`              | 更新 `{title?,groupId?}`；`groupId: null` 表示移出分组                                                                                                                                                           |
| DELETE | `/api/v1/me/assets/{id}`              | 删除自己的素材记录、原图与缩略图；被任意状态的商品引用时返回 409 `asset_in_use`                                                                                                                                        |
| GET    | `/api/v1/me/asset-groups`             | 返回 `{items,ungroupedCount,totalAssetCount}`；分组含 `assetCount`                                                                                                                                               |
| POST   | `/api/v1/me/asset-groups`             | 创建 `{name,sort?}`；名称 1-64 字、同用户唯一，最多 50 组                                                                                                                                                         |
| PATCH  | `/api/v1/me/asset-groups/{id}`        | 更新 `{name?,sort?}`                                                                                                                                                                                             |
| DELETE | `/api/v1/me/asset-groups/{id}`        | 删除分组；组内素材 `group_id` 置空                                                                                                                                                                               |

账本条目包含 `{id,kind,deltaCents,balanceAfterCents,sourceType,sourceId,reason,createdAt}`。

兑换码错误包括 `code_invalid`、`code_redeemed`、`code_expired`、`code_disabled`、`rate_limited`。连续失败会触发按用户的小时级限流。

## 图片任务

历史任务类型包含 `t2i|coloring|ui_design|ecommerce_design|model_sheet|game_art|puzzle|background_remove`。状态：`queued|running|succeeded|failed|canceled`。`ecommerce_design` 使用独立的模型工作区、计费和体验资格配置；`puzzle` 是永久免费浏览器本地工具，`POST /tasks` 不接受新建 `puzzle` 云端任务，公开价格固定为 0。

`background_remove` 是专用图片工具任务：必须提交恰好一个 `inputKeys`、`count=1` 和后台公开的 `image_tool/background_remove` 模型 ID。它不接受普通生图模型，输出一张透明背景图片，按所选工具模型的有效积分价格独立冻结和结算。

| 方法   | 路径                              | 说明                                                                            |
| ------ | --------------------------------- | ------------------------------------------------------------------------------- |
| POST   | `/api/v1/tasks`                      | `{type,prompt,params?,inputKeys?,count?,idempotencyKey?}`；校验并冻结余额后入队 |
| GET    | `/api/v1/tasks`                      | 当前用户列表；筛选 `type`、`status`，支持 cursor                                |
| GET    | `/api/v1/tasks?ids=<uuid>,...`       | 批量读取最多 100 个当前用户任务快照；按输入顺序返回                             |
| GET    | `/api/v1/tasks/{id}`                 | 当前用户任务详情                                                                |
| GET    | `/api/v1/tasks/{id}/events`          | 单任务 SSE 状态事件流                                                           |
| PATCH  | `/api/v1/tasks/{id}`                 | `{status:"canceled"}`；仅 queued 可取消并释放冻结额                           |
| DELETE | `/api/v1/tasks/{id}`                 | 删除终态任务记录及对应 R2 产物；成功返回 204                                    |
| GET    | `/api/v1/me/tasks/events`            | 当前用户全部任务的 SSE 事件流                                                   |

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

`GET /api/v1/runtime-config` 通过 `features["ai.imageTools"].config.backgroundRemovalModels` 单独公开背景移除工具的公开 ID、名称和积分价格。图片工具不会出现在 `aiModelCatalog.publicModels` 或各工作台的生图 `publicModels` 中，也不会返回服务商、Base URL、API Key 或上游模型 ID。

新任务的 `model` 在提交时锁定，并由 Worker 实际调用；迁移前的历史任务因过去没有保存该字段，只能在迁移时按当时生效的 `task_models` 配置补齐，补齐后也不会再随后台配置改变。

费用按 `count * taskPrices[type]` 计算。`idempotencyKey` 在同一用户内唯一，客户端重试提交时应复用。成功任务的 `outputKeys`/`originalUrls` 指向原图，`thumbnailKeys`/`thumbnailUrls` 指向最长边 512px 的 JPEG 缩略图；`outputUrls` 为兼容字段，优先返回缩略图。

## AI 电商商品库

商品库用于保存可重复使用的 SKU 资料和真实商品参考图，不涉及套餐、订单或支付。接口均要求当前用户登录；商品、素材和生成任务按用户隔离。

| 方法   | 路径                              | 说明                                                                 |
| ------ | --------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/v1/commerce/products`       | 商品 cursor 列表；支持 `q` 搜索商品名、SKU、品牌和类目，`status=active\|archived` |
| POST   | `/api/v1/commerce/products`       | 创建商品；至少需要 `title` 和 1-6 个本人 `assetIds`                   |
| GET    | `/api/v1/commerce/products/{id}`  | 读取商品资料及关联素材 URL                                            |
| PATCH  | `/api/v1/commerce/products/{id}`  | 更新商品字段；未提交的字段保留原值                                    |
| DELETE | `/api/v1/commerce/products/{id}`  | 删除商品记录；不会删除个人素材                                        |

商品字段包括 `sku`、`title`、`brand`、`category`、`sellingPoints`、`targetAudience`、`material`、`color`、`dimensions`、`platform`、`market`、`language`、`protectedElements` 和 `assetIds`。同一用户的非空 SKU 不区分大小写重复。商品被带入 `/ecommerce-design` 后，生成任务会在 `params.commerceProductId` 与 `params.commerceProductSnapshot` 中保存商品关联和生成时快照，避免后续修改商品资料影响历史任务解释。

公开试衣目录与用户商品库相互独立。后台上传的默认模特、场景、服装图通过 `GET /api/v1/commerce/tryon-catalog` 下发；图片对象存储在 `ecommerce-tryon/` 前缀下，匿名可读。每种 `kind` 最多 40 张。

| 方法   | 路径                              | 说明                                                                 |
| ------ | --------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/v1/commerce/tryon-catalog`  | 返回已上架的 `{models,scenes,garments}`，每项含 `id`、`label`、`imageUrl`、`apparel` |

## 智能画布

画布项目完全归属当前用户，服务端保存与具体图编辑器无关的 JSON 文档。服务端兼容版本 1（旧通用节点）、版本 2（TapCanvas 业务节点）和版本 3（React 画布节点），最多包含 5000 个节点和 10000 条连线，单次请求体上限为 5 MB。

| 方法   | 路径                           | 说明                                                                 |
| ------ | ------------------------------ | -------------------------------------------------------------------- |
| GET    | `/api/v1/canvas-projects`      | 最近更新的项目摘要，返回 `{items}`，当前最多 100 项                   |
| POST   | `/api/v1/canvas-projects`      | 创建 `{title,document?}`；未提供 document 时创建空的版本 2 文档       |
| GET    | `/api/v1/canvas-projects/{id}` | 读取项目及完整 document                                               |
| PATCH  | `/api/v1/canvas-projects/{id}` | 更新 `{title?,document?,revision}`；成功后 revision 加 1              |
| DELETE | `/api/v1/canvas-projects/{id}` | 删除项目，成功返回 204                                                |
| GET    | `/api/v1/canvas-projects/{id}/workflow-run` | 读取当前活动工作流运行；无活动运行时返回 `{run:null}` |
| POST   | `/api/v1/canvas-projects/{id}/workflow-runs` | 以 `{ownerId,nodeIds}` 创建或取得运行租约，返回 `{run,acquired}` |
| PATCH  | `/api/v1/canvas-projects/{id}/workflow-runs/{runId}` | 心跳并更新进度，或将运行标记为 `succeeded`、`failed`、`canceled` |

`PATCH` 使用乐观锁。客户端必须提交最后读取到的 `revision`；版本落后时返回 HTTP 409 `revision_conflict`，不得静默覆盖云端版本。document 必须包含 `nodes:[]` 和 `version`；版本 1、2 使用 `edges:[]`，版本 3 使用 `connections:[]`。可选的 `viewport` 必须是对象。省略 document 时服务端创建空的版本 2 文档。

同一画布最多存在一个 `running` 工作流运行。运行租约为 30 秒，执行页面每 10 秒续租；同一 owner 可在刷新后立即重新取得租约，其他页面只能观察或停止。租约过期后其他执行者可以接管，旧执行者的后续心跳返回 HTTP 409 `workflow_run_lock_lost`。

## 上传与文件

| 方法 | 路径                  | 说明                                                                                                                                                |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/v1/uploads`        | multipart 字段 `file`；最大 15 MB，支持 PNG/JPEG/WebP 图片和 MP4/WebM 视频；图片返回 `{key,url,thumbnailKey,thumbnailUrl,contentType,sizeBytes}` 并同步生成 512px JPEG 缩略图，视频返回 `{key,url,contentType,sizeBytes}`；未被业务引用的上传对象保留 7 天后由 Worker 回收 |
| GET  | `/api/v1/files/{key...}` | 校验访问权限后由 API 代理读取 R2 并直接返回文件（`200`，私有缓存 1 小时）；客户端无需直连对象存储                                                   |

用户只能读取属于自己的 `uploads/`、`tasks/` key；已审核画廊资源公开；管理员可读取任意业务 key。网关请求体上限为 20 MB，应用层限制仍是 15 MB。

## 支付状态

价格页和只读套餐列表已经恢复：`GET /api/v1/plans` 返回 `{items,paymentEnabled:false}`。套餐条目包含 `code`、`name`、`description`、`badge`、`kind`、销售价格、积分发放规则、权益、推荐状态与排序。支付、订单创建、订阅查询和 webhook 路由在开发、测试、生产环境仍不注册；价格页套餐按钮进入体验申请，积分获取区提供兑换码、签到和体验申请入口，不会创建订单、跳转收银台或扣款。钱包目前可通过管理员调整、兑换码、签到奖励或现有业务赠送入账。数据库保留历史订单/订阅数据用于兼容升级。

## 画廊与公开提示词

| 方法 | 路径                       | 认证 | 说明                                                |
| ---- | -------------------------- | ---- | --------------------------------------------------- |
| GET  | `/api/v1/gallery/submissions` | 公开 | 已审核作品；支持 `category`、`featured=1` 和 cursor |
| GET  | `/api/v1/gallery/categories`  | 公开 | active 分类                                         |
| POST | `/api/v1/gallery/submissions` | 用户 | `{taskId,title,categoryId?}` 投稿成功任务           |
| GET  | `/api/v1/prompts`             | 公开 | 仅返回 active 且图片资产已验证（或无封面）的提示词；支持 `type`、`category`、`search`、重复 `tag` 和 cursor；`scope=today` 表示滚动 24 小时最新 |
| GET  | `/api/v1/prompts/categories`  | 公开 | active 提示词分类；支持 `type`，返回名称、排序和实时数量 |

画廊 item 包含封面/媒体 URL、作者、精选状态和可空分类。投稿受 `submissionEnabled`、`dailyLimit`、用户禁投时间和任务归属/状态约束；可能返回 `submission_disabled`、`submission_daily_limit`、`submission_banned`。

提示词列表响应除 `items` / `nextCursor` 外，还统一返回筛选后的 `total`、完整 `categoryCounts` 和可用 `tags`。提示词 item 的封面字段为 `coverUrl`、`coverWidth`、`coverHeight`。宽高已解析时为正整数；历史或暂时无法探测的远程封面返回 `null`，客户端必须允许降级测量。字段仅用于预计算图片比例和布局。

## 元信息

| 方法 | 路径                      | 说明                                                    |
| ---- | ------------------------- | ------------------------------------------------------- |
| GET  | `/api/v1/pricing`       | `{taskPointPrices,taskPointPriceRanges,taskPrices,taskPriceRanges}` |
| GET  | `/api/v1/changelog`     | 公开更新说明                                            |
| GET  | `/api/v1/announcements` | 当前生效公告                                            |
| GET  | `/api/v1/health`             | API、PostgreSQL 与 Redis 健康状态；成功 `{status:"ok"}` |

## 管理端：用户、账本和任务

以下接口全部要求管理员权限。

| 方法  | 路径                                  | 说明                                                      |
| ----- | ------------------------------------- | --------------------------------------------------------- |
| GET   | `/api/v1/admin/statistics`                    | 用户、任务、全站余额、运行中任务和类型分布                |
| GET   | `/api/v1/admin/system/metrics`                | API、Go Runtime、数据库池、Asynq 队列和 Worker 实时快照   |
| GET   | `/api/v1/admin/users`                    | `search`、`status` 筛选的 cursor 列表；每项附带 `usage` 使用摘要 |
| GET   | `/api/v1/admin/users/{id}`               | 用户完整资料、钱包拆分、当前套餐、体验申请、签到/拼团、任务/投稿/素材/订单/反馈计数及最近会话摘要 |
| PATCH | `/api/v1/admin/users/{id}`               | 更新 `{status?,role?}`                                    |
| GET   | `/api/v1/admin/users/{id}/wallet/entries` | 指定用户账本                                              |
| POST  | `/api/v1/admin/users/{id}/wallet/entries` | `{deltaCents,reason}`，创建 admin_adjust 账本条目         |
| GET   | `/api/v1/admin/wallet/entries`                   | 全站账本；筛选 `kind`、`sourceType`、`user`               |
| GET    | `/api/v1/admin/tasks`                    | 按 `type`、`status`、`user` 筛选全站任务                  |
| DELETE | `/api/v1/admin/tasks`                    | 按当前筛选从管理端隐藏已结束记录（`succeeded`/`failed`/`canceled`）；用户历史、产物、账本、画廊/审核保留 |
| PATCH  | `/api/v1/admin/tasks/{id}`                | `{status:"queued"}` 重新入队；`canceled` 取消；`failed` 强制失败             |
| GET   | `/api/v1/admin/audit-logs`               | 按 `admin`、`path` 筛选审计日志                           |

`stats` 包含 `{totalUsers,newUsersToday,taskDaily,walletBalanceCents,runningTasks,typeDistribution}` 等字段。管理任务列表提供扁平 `userEmail`。

`system/metrics` 只允许管理员读取。HTTP 指标为近 60 秒滚动窗口，不包含健康检查和指标请求自身；队列或 Worker 心跳不可用时返回 `available:false` 与稳定错误码，不泄露 Redis 错误详情。pprof 不属于 REST API，永远不通过公开网关提供。

## 管理端：兑换码

| 方法 | 路径                                       | 说明                                                      |
| ---- | ------------------------------------------ | --------------------------------------------------------- |
| POST | `/api/v1/admin/redemption-code-batches`     | `{count,grantCents,expiresAt?,note?}`；count 为 1 至 1000 |
| GET  | `/api/v1/admin/redemption-codes`              | `status`、`batchId`、`search` 筛选的 cursor 列表          |
| PATCH | `/api/v1/admin/redemption-codes/{id}` | `{active:false}`；仅 active 可停用                        |
| GET  | `/api/v1/admin/redemption-code-batches`      | 最近批次汇总                                              |

明文码格式为 `SC-XXXX-XXXX-XXXX`，批量生成响应是导出的权威来源。已兑换或停用的码不能再次操作。

## 管理端：体验活动与资格申请

| 方法   | 路径                                                               | 说明                                                                                                    |
| ------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/admin/trial-campaigns`                                 | 活动列表与可选真实功能                                                                                  |
| POST   | `/api/v1/admin/trial-campaigns`                                | 新建草稿：`{title,featureKeys,accessMode,capacity,displayOffset,expiresAt}`；截止时间须在 5 分钟至 365 天内 |
| PATCH  | `/api/v1/admin/trial-campaigns/{id}`                           | 修改活动配置和截止时间；已有申请后功能集合锁定，其他字段仍可修改                                       |
| DELETE | `/api/v1/admin/trial-campaigns/{id}`                           | 删除无申请记录且未启用的活动                                                                            |
| POST   | `/api/v1/admin/trial-campaigns/{id}/activation`                | 启用活动；事务内自动关闭此前活动，数据库保证全站最多一个 `active`                                       |
| POST   | `/api/v1/admin/trial-campaigns/{id}/closure`                   | 关闭活动                                                                                                |
| GET    | `/api/v1/admin/trial-access-applications`                      | 按 `campaignId`、`pending|approved|rejected` 和用户关键字筛选，返回 cursor 分页与 `total`                 |
| PATCH  | `/api/v1/admin/trial-access-applications/{id}`                 | 通过：`{status:"approved",grantCents,expiresAt?,reviewNote?}`；拒绝必须填写 `reviewNote`                |
| POST   | `/api/v1/admin/trial-access-applications/{id}/reward-reissues` | 对已通过且原礼包失效的申请补发：`{grantCents,expiresAt?,reviewNote?}`                                    |

同一时间只允许一个启用活动。每期必须设置有限截止时间；Worker 每分钟自动归档到期活动，所有公开读取、权限和钱包 SQL 也直接校验 `expires_at > now()`，因此不依赖定时任务是否准时执行。启用、关闭与申请、审核、补发、领取共享数据库事务生命周期锁；手动关闭或到期后，用户入口消失，新的申请、审核、补发、领取和体验积分任务冻结均停止。过期活动须先修改为新的未来截止时间才能重新启用。通过申请会在同一事务中生成内部专属兑换码并发送站内通知，明文码不返回管理端或用户端；领取进入独立体验积分桶，只有当前启用活动中逐功能获批的任务可使用。旧活动积分关闭后保留但暂停使用，用户在新一期再次获批后可继续累积和使用。申请提交邮件发送到 `TRIAL_APPLICATION_EMAIL`，未配置时回退到 `SMTP_FROM`。

## 管理端：用户反馈

| 方法  | 路径                            | 说明                                                                                              |
| ----- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| GET   | `/api/v1/admin/feedback`        | 按状态、分类和用户/标题/内容关键字筛选，返回 cursor 分页与 `total`                                |
| PATCH | `/api/v1/admin/feedback/{id}`   | `{status,adminReply?,adopted?,rewardCents?}`；采纳产品建议时须解决/关闭并发放一次奖励              |

反馈分类为 `bug|generation|account|billing|suggestion|other`，状态为 `open|in_progress|resolved|closed`。只有 `suggestion` 可标记为采纳，奖励上限由 `suggestionRewardMaxCents` 控制，重复处理不重复入账。

## 管理端：电商试衣素材

后台「电商素材」页维护虚拟试衣默认模特、场景和服装图。每种 `kind` 最多 40 张；图片写入 `ecommerce-tryon/` 前缀，用户端匿名可读。未配置时用户端继续使用内置兜底图；服装目录为空时用户只能自行上传。

| 方法   | 路径                                            | 说明                                                                 |
| ------ | ----------------------------------------------- | -------------------------------------------------------------------- |
| GET    | `/api/v1/admin/ecommerce/catalog`               | `?kind=model\|scene\|garment\|hand` 列表，含未上架项                   |
| POST   | `/api/v1/admin/ecommerce/catalog`               | multipart：`kind`、`label`、`file`，可选 `apparel`、`sort`、`active` |
| PATCH  | `/api/v1/admin/ecommerce/catalog/order`         | `{kind,ids}` 按当前分类槽位保存拖拽顺序                               |
| PATCH  | `/api/v1/admin/ecommerce/catalog/{id}`          | `{label?,apparel?,sort?,active?}`                                    |
| PUT    | `/api/v1/admin/ecommerce/catalog/{id}/image`    | multipart 替换图片                                                |
| DELETE | `/api/v1/admin/ecommerce/catalog/{id}`          | 删除记录并删除对象存储文件                                           |

`/api/v1/admin/ecommerce/tryon-catalog` 为同组别名。`kind` 为 `model`、`scene`、`garment` 或 `hand`。`apparel` 仅服装可用，取值为 `上装`、`下装`、`全身`。图片仅支持 png / jpg / webp，最大 8MB。多张上传由后台连续调用创建接口完成。

## 管理端：画廊与社区

| 方法   | 路径                                            | 说明                                                                         |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/api/v1/admin/gallery/submissions`                | 按状态查看投稿                                                               |
| POST   | `/api/v1/admin/gallery/submissions/{id}/reviews`   | `{action:approve|reject|remove,reason?}` 创建审核记录                         |
| PUT    | `/api/v1/admin/gallery/submissions/{id}/curation`  | `{featured?,categoryId?,sort?,tags?}` 更新策展状态                           |
| PATCH  | `/api/v1/admin/gallery/submissions`                | `{ids,featured?,categoryId?,tags?,tagMode?}` 批量更新                         |
| PATCH  | `/api/v1/admin/gallery/submissions/order`          | `{ids}` 按数组顺序写入作品展示排序                                           |
| POST   | `/api/v1/admin/gallery/submissions/{id}/violations`| `{reason,banDays,deleteMedia?}` 创建违规处理记录                              |
| DELETE | `/api/v1/admin/gallery/users/{id}/ban`             | 删除用户禁投状态；成功返回 204                                               |
| GET    | `/api/v1/admin/gallery/categories`                 | 全部分类                                                                     |
| POST   | `/api/v1/admin/gallery/categories`                 | 新建分类                                                                     |
| PATCH  | `/api/v1/admin/gallery/categories/{id}`            | 修改分类                                                                     |
| DELETE | `/api/v1/admin/gallery/categories/{id}`            | 删除分类，投稿关联置空                                                       |
| GET    | `/api/v1/admin/gallery/settings`                   | `{submissionEnabled,autoApprove,dailyLimit}`                                 |
| PUT    | `/api/v1/admin/gallery/settings`                   | 保存投稿规则                                                                 |
| GET    | `/api/v1/admin/gallery/authors`                    | 按 `search` 聚合创作者与投稿/禁投信息                                        |

`banDays` 范围为 0 至 365；0 表示只下架不新增禁投期限。`deleteMedia` 会删除对应任务产物，属于不可恢复操作。

## 管理端：提示词库与数据源

| 方法   | 路径                                   | 说明                                                         |
| ------ | -------------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/v1/admin/prompts`            | 按 `type`、`category`、`search`、启用状态等筛选词条         |
| POST   | `/api/v1/admin/prompts`            | 新建手工词条                                                 |
| PATCH  | `/api/v1/admin/prompts/order`      | `{ids}` 更新当前列表顺序                                      |
| GET    | `/api/v1/admin/prompts/{id}/position` | 查询词条在筛选范围内的位置                                |
| PATCH  | `/api/v1/admin/prompts/{id}/position` | `{position,taskType?,category?,status?}` 移动词条         |
| PATCH  | `/api/v1/admin/prompts/{id}`       | 修改词条、排序或 active                                      |
| DELETE | `/api/v1/admin/prompts/{id}`       | 删除词条                                                     |
| PUT    | `/api/v1/admin/prompts/{id}/cover` | multipart 封面上传；返回 `{coverUrl,coverWidth,coverHeight}` |
| GET    | `/api/v1/admin/prompts/export`      | `format=json|csv` 全量导出提示词、来源、排序和资产归属       |
| GET    | `/api/v1/admin/prompt-categories` | 返回全部提示词分类及数量                                  |
| POST   | `/api/v1/admin/prompt-categories` | `{key,label,sort?,active?}` 新增分类                       |
| PATCH  | `/api/v1/admin/prompt-categories/{id}` | 修改 `label`、`sort` 或 `active`                       |
| DELETE | `/api/v1/admin/prompt-categories/{id}` | 删除自定义分类；所属提示词自动迁移到 `other`            |
| GET    | `/api/v1/admin/prompt-sources`            | `{items:[...]}`，不分页                                      |
| POST   | `/api/v1/admin/prompt-sources`            | 新建 JSON/Markdown/HTML 数据源                               |
| PATCH  | `/api/v1/admin/prompt-sources/{id}`       | 修改数据源与同步配置                                         |
| DELETE | `/api/v1/admin/prompt-sources/{id}`       | 可带 `purgeItems=1`；内置源不可删除                          |
| POST   | `/api/v1/admin/prompt-sources/{id}/synchronizations`  | 获取单个源并创建待审核批次，不直接写正式库                   |
| GET    | `/api/v1/admin/prompt-import-batches`                 | 最近 20 个抓取、审核与发布批次                               |
| POST   | `/api/v1/admin/prompt-import-batches`                 | `{mode,sourceIds}`；空 `sourceIds` 获取全部启用源             |
| POST   | `/api/v1/admin/prompt-import-batches/upload`          | multipart `file` + `mode`；导入 JSON/CSV，最多 10MB/5000 条   |
| GET    | `/api/v1/admin/prompt-import-batches/{id}/items`      | 按 `view=all|duplicates|assets|pending|approved|rejected` 分页审核 |
| PUT    | `/api/v1/admin/prompt-import-batches/{id}/items/{itemId}/cover` | 上传 PNG/JPG/WebP 替换待审核封面                          |
| PATCH  | `/api/v1/admin/prompt-import-batches/{id}/items/{itemId}` | 修改分类、重复决定、合规和审核状态；通过后立即幂等入库     |
| POST   | `/api/v1/admin/prompt-import-batches/{id}/analyze`    | 使用已配置对话模型批量分类、语义去重与文本合规检测           |
| POST   | `/api/v1/admin/prompt-import-batches/{id}/bulk-review` | 支持 `itemIds` 多选通过/移除与整批规则操作；通过项立即幂等入库 |
| POST   | `/api/v1/admin/prompt-import-batches/{id}/publish`    | 手动重试入库当前批次尚未发布的已通过项；新增项获得 24 小时最新状态 |

提示词分类的 `key` 创建后不可修改。内置分类参与同步源自动归类，可以改名、排序或停用，但不能删除；管理员新增的自定义分类可以删除。

源对象使用 camelCase。抓取或文件导入数据先进入 `prompt_import_items`，精确重复会同时对比当前批次和正式库；重复项必须明确保留或移除。AI 结果可人工覆盖，图片通过同源安全代理展示供最终人工审核。审核通过、合规且决定保留的数据会立即发布。

JSON 导出格式为 `{schemaVersion,exportedAt,items}`；CSV 使用 UTF-8 BOM，标签用 `|` 分隔。两种格式都包含提示词内容、分类、封面、来源、排序和启用状态。

## 管理端：内容与设置

| 方法         | 路径                            | 说明                                               |
| ------------ | ------------------------------- | -------------------------------------------------- |
| GET/POST     | `/api/v1/admin/announcements`      | 列表/新建公告                                      |
| PATCH/DELETE | `/api/v1/admin/announcements/{id}` | 修改/删除公告                                      |
| GET/POST     | `/api/v1/admin/changelog`          | 列表/新建更新说明                                  |
| PATCH/DELETE | `/api/v1/admin/changelog/{id}`     | 修改/删除更新说明                                  |
| GET          | `/api/v1/admin/settings`           | 获取运营配置                                       |
| PUT          | `/api/v1/admin/settings`           | 保存运营配置                                       |
| GET          | `/api/v1/admin/plans`              | 获取全部套餐及订单/订阅引用计数                    |
| POST         | `/api/v1/admin/plans`              | 新增积分包或订阅套餐                               |
| PATCH        | `/api/v1/admin/plan-order`         | 按类型拖动排序；`{ kind, ids }`                    |
| PATCH        | `/api/v1/admin/plans/{id}`         | 编辑价格、积分、权益、推荐位、排序和上下架状态     |
| DELETE       | `/api/v1/admin/plans/{id}`         | 删除未使用套餐；有历史记录时返回 `plan_in_use`     |
| POST         | `/api/v1/admin/providers/{provider}/tests` | provider 为 `c2a`、`sub2api` 或 `crun`，执行连接测试 |
| GET/PUT      | `/api/v1/admin/model-config`              | 获取或保存模型路由配置                                 |
| POST         | `/api/v1/admin/model-config/discoveries`  | 创建一次上游模型发现请求                               |

settings 请求/响应：

```json
{
  "taskPrices": { "t2i": 20 },
  "taskModels": { "default": "gpt-image-2" },
  "userMaxRunningTasks": 3,
  "taskFailureRetryCount": 0,
  "crossProviderSameModelBalancingEnabled": false,
  "registrationEnabled": true,
  "signupBonusCents": 100,
  "checkinEnabled": true,
  "checkinCampaignTitle": "连续签到领创作积分",
  "checkinRewards": [10, 15, 20, 25, 30, 40, 80],
  "growthGroupEnabled": true,
  "growthGroupCampaignKey": "launch-2026",
  "growthGroupTargetMembers": 3,
  "growthGroupRewardCents": 30,
  "growthGroupDurationHours": 48,
  "growthFailureBonusEnabled": true,
  "growthFailureBonusCents": 3,
  "growthFailureBonusDailyLimit": 3,
  "growthUsageRewardsEnabled": true,
  "growthUsageMilestones": [{ "units": 10, "rewardCents": 20 }],
  "suggestionRewardMaxCents": 5000,
  "submissionEnabled": true,
  "autoApprove": false,
  "dailyLimit": 0,
  "c2aBaseUrl": "",
  "c2aApiKey": "****abcd",
  "c2aTimeoutSecs": 0
}
```

`checkinRewards` 必须是 7 个非负整数，单日最高 `1000000` 积分且至少一天大于 0；完成第 7 天后奖励从第 1 天循环，连续签到总天数继续累计，中断一天后从第 1 天重新开始。增长拼团人数为 `2-10`、有效期为 `1-720` 小时；更换 `growthGroupCampaignKey` 会开启新一期活动。失败补偿仅对有费用的真实任务失败生效，任务费用仍先全额退回，管理员强制失败不发额外奖励。用量里程碑最多 12 档，以北京时间自然月的成功交付图片数累计。`taskFailureRetryCount` 为连接、超时、429 或临时上游错误的额外尝试次数，范围 `0-100`。`crossProviderSameModelBalancingEnabled` 默认关闭；开启后，同类型、同显示名称且有效积分价格与任务单价快照完全一致的公开模型可以跨服务商参与容量调度，参数能力不兼容的候选会被排除，任务冻结积分不会变化。`c2aBaseUrl`、`c2aApiKey` 非空以及 `c2aTimeoutSecs > 0` 时覆盖环境变量；空值/0 使用环境变量。API Key 永不明文返回，已配置时只返回末四位掩码；PUT 省略该字段、提交空串或原掩码均不会覆盖现有 key。`dailyLimit=0` 表示投稿不限次数。

## 常见错误码

| 类别      | 错误码                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| 鉴权      | `auth_required`, `admin_required`, `invalid_credentials`, `rate_limited`                        |
| 参数/资源 | `validation_error`, `not_found`, `email_exists`, `registration_required`, `registration_closed` |
| 任务      | `insufficient_balance`, `user_task_limit`, `task_not_found`, `task_not_cancelable`, `task_in_use` |
| 文件      | `upload_too_large`, `unsupported_file`                                                          |
| 投稿      | `submission_not_allowed`, `submission_disabled`, `submission_daily_limit`, `submission_banned`  |
| 反馈      | `feedback_daily_limit`                                                                        |
| 签到      | `checkin_campaign_inactive`                                                                  |
| 增长活动  | `growth_group_disabled`, `growth_group_exists`, `growth_group_not_found`, `growth_group_expired`, `growth_group_full` |
| 套餐      | `plan_not_found`, `plan_in_use`, `payment_unavailable`                                      |
| 体验活动  | `trial_campaign_closed`, `trial_campaign_expired`, `trial_campaign_full`, `trial_campaign_not_active`, `trial_campaign_active`, `trial_campaign_in_use`, `trial_campaign_features_locked`, `trial_application_pending`, `trial_application_approved`, `trial_reward_not_ready`, `trial_reward_not_reissuable`, `trial_feature_access_required` |
| 兑换码    | `code_invalid`, `code_redeemed`, `code_expired`, `code_disabled`, `code_not_active`             |
| 数据源    | `builtin_source_protected`                                                                      |
| 服务端    | `internal_error`                                                                                |

调用方应以 HTTP 状态和 `code` 分支，不应解析中文 `error` 文案。

## AI助手

以下接口要求用户 Cookie `sc_session`，由服务端使用配置的上游密钥执行。密钥不返回浏览器。

| 方法 | 路径                    | 说明                                                                                                                                                                                                                                                                                |
| ---- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/v1/assistant/config`                  | 返回可用模型与运行配置                                      |
| GET/POST | `/api/v1/assistant/conversations`         | 列表或创建对话                                              |
| DELETE | `/api/v1/assistant/conversations/{id}`      | 删除对话；有活动任务时需 `cancelActive=true`                |
| DELETE | `/api/v1/assistant/messages/{id}`           | 删除消息                                                    |
| POST   | `/api/v1/assistant/conversation-imports`    | 导入旧对话                                                  |
| GET/POST | `/api/v1/assistant/runs`                  | 查询活动任务或创建任务                                      |
| GET    | `/api/v1/assistant/runs/{id}`               | 查询单个任务                                                |
| PATCH  | `/api/v1/assistant/runs/{id}`               | `{status:"canceled"}` 取消任务                            |
| GET    | `/api/v1/assistant/runs/{id}/events`        | SSE 增量事件流                                              |

助手模型价格来自后台模型配置。对话按每轮模型价计费，生图按模型价乘图片数计费；Agent 创建时预留对话与可能生图费用中的较高值，Worker 按最终 `resolvedMode` 结算并退回差额。运行响应包含 `reservedCents`、`costCents` 与 `billingGeneration`。创建、成功、失败、用户停止、强制删除活动对话、后台取消/强制失败和失败重试的状态变化与钱包账本位于同一事务；失败或取消全额释放当代预留。
