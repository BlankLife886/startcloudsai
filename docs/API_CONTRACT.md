# 项目完整 API 接口文档

本文是当前项目服务端接口的统一入口，与 `apps/server/internal/httpapi/router.go` 的实际注册结果对齐。统计时间为 `2026-09-01`，当前共注册 `287` 个方法路由：站内 `/api/v1` 路由 `140` 个、管理员分组路由 `141` 个、开放 API 路由 `5` 个、内部回调 `1` 个。其中 `GET 117`、`POST 88`、`PATCH 39`、`DELETE 32`、`PUT 11`。

所有站内业务接口使用 `/api/v1` 前缀，JSON 字段使用 camelCase，时间使用 RFC 3339/ISO 8601，金额使用整数分并以 `Cents` 结尾。当前版本不注册旧 `/api/*` 兼容路由。

## 接口分区

| 分区 | Base Path | 认证 | 用途 |
| --- | --- | --- | --- |
| 公开/用户站内 API | `/api/v1` | 公开或 `sc_session` | 登录、用户资料、任务、助手、画布、电商、资产、支付和公共内容 |
| 管理 API | `/api/v1/admin` | `sc_admin_session` | 运营、任务、模型、内容、财务、质量、日志和安全管理 |
| 开放 API | `/api/open/v1` | `Authorization: Bearer sk-sc-...` | 外部系统上传文件、创建任务、查询结果和接收 Webhook |
| 内部回调 | `/internal/c2a` | 内部回调签名/网络边界 | ChatGPT2API/C2A 向本站推送图片任务事件 |

接口的最终事实来源是服务端路由和 handler；本文提供调用契约。外部开发者使用说明、curl 示例和 Webhook 验签代码另见 [OPEN_API.md](OPEN_API.md)。

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

对外集成使用独立的 `/api/open/v1` 前缀和 Bearer API Key，不使用浏览器 Cookie。开放接口、权限、幂等与 Webhook 签名契约见 [StarClouds Open API](OPEN_API.md)。

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
| GET    | `/api/v1/me/notifications`            | 个人通知与全站通知合并后的 cursor 分页；任务与订单通知可包含 `sourceType`、`sourceId`，用于用户端精确深链                                                                                                         |
| PATCH  | `/api/v1/me/notifications`       | `{ids?:[]}`；省略 ids 表示全部已读；成功返回 204                                                                                                                                                                 |
| GET    | `/api/v1/me/gallery/submissions`      | 我的投稿 cursor 分页                                                                                                                                                                                             |
| DELETE | `/api/v1/me/gallery/submissions/{id}` | 删除自己的投稿                                                                                                                                                                                                   |
| GET    | `/api/v1/me/assets`                   | 个人素材 cursor 分页；支持 `q`、逗号分隔 `tags`、`groupId=all\|ungrouped\|{uuid}` 和 `trash=true`；返回标签、来源、派生关系、哈希与回收站时间 |
| POST   | `/api/v1/me/assets`                   | 保存素材及可选 `groupId,tags,sourceType,sourceId,sourceMetadata,parentAssetId`；按真实文件 SHA-256 在用户范围去重 |
| PATCH  | `/api/v1/me/assets/{id}`              | 更新 `{title?,groupId?,tags?}`；`groupId: null` 表示移出分组 |
| DELETE | `/api/v1/me/assets/{id}`              | 移入回收站，不立即删除 OSS 对象；被商品引用时返回 409 `asset_in_use` |
| POST   | `/api/v1/me/assets/batch`             | 最多 200 项批量 `update\|trash\|restore`；支持移动文件夹和增删标签 |
| POST   | `/api/v1/me/assets/{id}/restore`      | 从回收站恢复 |
| DELETE | `/api/v1/me/assets/{id}/permanent`    | 永久删除并进入低负载 OSS 清理队列 |
| GET    | `/api/v1/me/asset-groups`             | 返回 `{items,ungroupedCount,totalAssetCount}`；分组含 `assetCount`                                                                                                                                               |
| POST   | `/api/v1/me/asset-groups`             | 创建 `{name,sort?}`；名称 1-64 字、同用户唯一，最多 50 组                                                                                                                                                         |
| PATCH  | `/api/v1/me/asset-groups/{id}`        | 更新 `{name?,sort?}`                                                                                                                                                                                             |
| DELETE | `/api/v1/me/asset-groups/{id}`        | 删除分组；组内素材 `group_id` 置空                                                                                                                                                                               |
| GET    | `/api/v1/me/api-models`               | 当前可授权给 API Key 的开放模型                                                                                                                                                                                   |
| GET/POST | `/api/v1/me/api-keys`               | 查询或创建 API Key；明文仅在创建响应返回一次                                                                                                                                                                      |
| DELETE | `/api/v1/me/api-keys/{id}`             | 撤销当前用户的 API Key                                                                                                                                                                                            |
| GET/POST | `/api/v1/me/webhooks`               | 查询或创建 Webhook endpoint                                                                                                                                                                                       |
| PATCH/DELETE | `/api/v1/me/webhooks/{id}`      | 编辑、轮换 Secret 或删除 Webhook                                                                                                                                                                                   |
| GET    | `/api/v1/me/webhook-deliveries`       | 最近 100 条 Webhook 投递记录                                                                                                                                                                                       |
| POST   | `/api/v1/me/webhook-deliveries/{id}/retry` | 将当前用户自己的 dead 投递重新加入队列                                                                                                                                                                         |

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
| PATCH  | `/api/v1/tasks/{id}`                 | `{status:"canceled",acknowledgeUpstream?:true}`；未提交任务取消并退款，已提交的文生图任务需明确确认放弃结果且不退款 |
| DELETE | `/api/v1/tasks/{id}`                 | 删除终态任务记录及对应对象存储产物；成功返回 204                                |
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
| GET    | `/api/v1/canvas-workflow-templates` | 已发布模板元数据列表；不返回完整 `document` |
| GET    | `/api/v1/canvas-workflow-templates/{id}` | 读取一个已发布模板及完整 v3 `document` |

`PATCH` 使用乐观锁。客户端必须提交最后读取到的 `revision`；版本落后时返回 HTTP 409 `revision_conflict`，不得静默覆盖云端版本。document 必须包含 `nodes:[]` 和 `version`；版本 1、2 使用 `edges:[]`，版本 3 使用 `connections:[]`。可选的 `viewport` 必须是对象。省略 document 时服务端创建空的版本 2 文档。

同一画布最多存在一个 `running` 工作流运行。运行租约为 30 秒，执行页面每 10 秒续租；同一 owner 可在刷新后立即重新取得租约，其他页面只能观察或停止。租约过期后其他执行者可以接管，旧执行者的后续心跳返回 HTTP 409 `workflow_run_lock_lost`。

## 上传与文件

| 方法 | 路径                  | 说明                                                                                                                                                |
| ---- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST | `/api/v1/uploads`        | multipart 字段 `file`；最大 15 MB，支持 PNG/JPEG/WebP 图片和 MP4/WebM 视频；图片返回 `{key,url,thumbnailKey,thumbnailUrl,contentType,sizeBytes}` 并同步生成 512px JPEG 缩略图，视频返回 `{key,url,contentType,sizeBytes}`；未被业务引用的上传对象保留 7 天后由 Worker 回收 |
| GET  | `/api/v1/files/*key` | 校验访问权限后由 API 代理读取 OSS/当前对象存储并直接返回文件（`200`，私有缓存 1 小时）；客户端无需持有对象存储密钥                                                   |

用户只能读取属于自己的 `uploads/`、`tasks/` key；已审核画廊资源公开；管理员可读取任意业务 key。网关请求体上限为 20 MB，应用层限制仍是 15 MB。

## 支付

`GET /api/v1/plans` 返回 `{items,paymentEnabled,paymentMethods}`。蓝鲸支付配置完整时，登录用户可通过 `POST /api/v1/orders` 创建支付宝或微信二维码订单；响应包含平台订单号、二维码内容、实际应付金额、是否需要手动输入金额以及失效时间。同一用户对同一套餐只能保留一笔待支付订单，重复创建会同步并复用原订单，不会再次向支付渠道下单。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/orders` | 创建订单；请求为 `{planId,paymentMethod}`，其中渠道为 `alipay` 或 `wechat` |
| `GET` | `/api/v1/orders` | 当前用户订单列表 |
| `GET` | `/api/v1/orders/{id}` | 查询本地订单并同步蓝鲸支付状态 |
| `POST` | `/api/v1/orders/{id}/close` | 关闭仍在等待支付的订单 |
| `GET` | `/api/v1/payments/lanjing/notify` | 蓝鲸支付异步通知；验签并完成幂等入账，成功返回纯文本 `success` |

用户订单列表支持 `status`、`limit`、`cursor`，每项包含套餐名称、套餐类型、标价、实际应付金额、支付渠道与到账时间。管理后台通过 `GET /api/v1/admin/orders` 按状态和用户关键词检索全站订单。

回调签名使用平台原始十进制金额文本校验，并要求商户订单号、自定义参数、本地订单 UUID 和套餐原价一致。新订单的 `reallyPrice` 必须与套餐标价完全一致；支付渠道调整金额时立即关闭上游订单并拒绝向用户展示二维码。订单会保存实付金额、支付方式、二维码、手动输入标记和失效时间快照，后续查单的稀疏响应不得清空这些字段。关闭订单在渠道已关闭、已过期或刚好支付完成时保持幂等；可信回调或主动对账可将取消竞态中的已支付订单恢复为已完成。完成订单复用钱包账本唯一幂等键，同一通知重复投递不会重复发放积分或重复延长订阅。

## 画廊与公开提示词

| 方法 | 路径                       | 认证 | 说明                                                |
| ---- | -------------------------- | ---- | --------------------------------------------------- |
| GET  | `/api/v1/gallery/submissions` | 公开 | 已审核作品；支持 `category`、`featured=1` 和 cursor |
| GET  | `/api/v1/gallery/categories`  | 公开 | active 分类                                         |
| POST | `/api/v1/gallery/submissions` | 用户 | `{taskId,title,categoryId?}` 投稿成功任务           |
| GET  | `/api/v1/prompts`             | 公开 | 仅返回 active 且图片资产已验证（或无封面）的提示词；支持 `type`、`category`、`search`、重复 `tag` 和 cursor；`scope=today` 表示滚动 24 小时最新 |
| GET  | `/api/v1/prompts/categories`  | 公开 | active 提示词分类；支持 `type`，返回名称、排序和实时数量 |
| POST | `/api/v1/prompts/{id}/engagements` | 用户 | 记录允许的提示词互动事件，用于热度和使用统计；事件类型由服务端白名单校验 |

画廊 item 包含封面/媒体 URL、作者、精选状态和可空分类。投稿受 `submissionEnabled`、`dailyLimit`、用户禁投时间和任务归属/状态约束；可能返回 `submission_disabled`、`submission_daily_limit`、`submission_banned`。

提示词列表响应除 `items` / `nextCursor` 外，还统一返回筛选后的 `total`、完整 `categoryCounts` 和可用 `tags`。提示词 item 的封面字段为 `coverUrl`、`coverWidth`、`coverHeight`。宽高已解析时为正整数；历史或暂时无法探测的远程封面返回 `null`，客户端必须允许降级测量。字段仅用于预计算图片比例和布局。

## 元信息

| 方法 | 路径                      | 说明                                                    |
| ---- | ------------------------- | ------------------------------------------------------- |
| GET  | `/api/v1/pricing`       | `{taskPointPrices,taskPointPriceRanges,taskPrices,taskPriceRanges}` |
| GET  | `/api/v1/changelog`     | 公开更新说明                                            |
| GET  | `/api/v1/changelog/latest` | 最近一次后台发版；用户端用来提示刷新                 |
| GET  | `/api/v1/announcements` | 当前生效公告                                            |
| GET  | `/api/v1/health`             | API、PostgreSQL 与 Redis 健康状态；成功 `{status:"ok"}` |

## 管理端：用户、账本和任务

以下接口全部要求管理员权限。

| 方法  | 路径                                  | 说明                                                      |
| ----- | ------------------------------------- | --------------------------------------------------------- |
| GET   | `/api/v1/admin/statistics`                    | 用户、任务、财务、类型分布与当前 `operationalIncidents` 运行告警 |
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

### 画布模板管理

| 方法   | 路径                                                   | 说明 |
| ------ | ------------------------------------------------------ | ---- |
| GET    | `/api/v1/admin/canvas-workflow-templates`              | 全部模板元数据，包含已下架记录，不返回完整 `document` |
| POST   | `/api/v1/admin/canvas-workflow-templates`              | 上传模板正文与展示元数据 |
| PATCH  | `/api/v1/admin/canvas-workflow-templates/order`        | `{ids}` 按数组顺序写入模板展示排序 |
| PATCH  | `/api/v1/admin/canvas-workflow-templates/{id}`         | 修改元数据、排序、发布状态，可选替换模板正文 |
| DELETE | `/api/v1/admin/canvas-workflow-templates/{id}`         | 删除模板，成功返回 204 |

创建请求包含 `{slug,title,category,categoryLabel,industry?,summary?,platforms?,deliverables?,accent?,sort?,enabled?,document}`。`document` 必须是画布 v3 JSON，正文最大 1 MiB，含 1 至 1000 个节点和最多 5000 条连线；所有连线端点必须存在。管理页面也接受完整画布导出的 `projects.json`，并提取第一个项目后提交。

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
| POST   | `/api/v1/admin/ecommerce/catalog/analyze`       | multipart：`kind`、`file`，使用电商分析模型返回 `{title}`             |
| PATCH  | `/api/v1/admin/ecommerce/catalog/order`         | `{kind,ids}` 按当前分类槽位保存拖拽顺序                               |
| PATCH  | `/api/v1/admin/ecommerce/catalog/{id}`          | `{label?,apparel?,sort?,active?}`                                    |
| PUT    | `/api/v1/admin/ecommerce/catalog/{id}/image`    | multipart 替换图片                                                |
| DELETE | `/api/v1/admin/ecommerce/catalog/{id}`          | 删除记录并删除对象存储文件                                           |

`/api/v1/admin/ecommerce/tryon-catalog` 为同组别名。`kind` 为 `model`、`scene`、`garment` 或 `hand`。`apparel` 仅服装可用，取值为 `上装`、`下装`、`全身`。图片仅支持 png / jpg / webp，最大 8MB。多张上传由后台连续调用创建接口完成。管理员点击单张图片旁的 AI 按钮后才调用 `analyze`；服务商、模型与推理强度由系统设置中的“后台图片分析”统一配置，该配置可由其他后台图片理解功能复用，且不回退到用户端模型。

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
| GET    | `/api/v1/admin/prompt-import-batches/{id}/items/{itemId}/cover` | 通过后台鉴权代理读取待审核封面 |
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
| POST         | `/api/v1/admin/providers/{provider}/tests` | provider 为 `c2a`、`sub2api`、`crun` 或 `lanjing-pay`，执行连接测试；蓝鲸支付仅调用 `/getState`，不创建订单 |
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
  "c2aTimeoutSecs": 0,
  "lanjingPayEnabled": false,
  "lanjingPayBaseUrl": "https://2347537.pay.lanjingzf.com",
  "lanjingPaySecret": "****abcd",
  "lanjingPayNotifyUrl": "https://ai.example.com/api/v1/payments/lanjing/notify",
  "lanjingPayTimeoutSecs": 10,
  "lanjingPayAlipayEnabled": true,
  "lanjingPayWechatEnabled": true,
  "platformLoggingEnabled": false,
  "platformLogSecurityEnabled": true,
  "platformLogOperationsEnabled": true,
  "platformLogUserEnabled": false,
  "platformLogRetentionDays": 7,
  "platformLogMaxMb": 256
}
```

`checkinRewards` 必须是 7 个非负整数，单日最高 `1000000` 积分且至少一天大于 0；完成第 7 天后奖励从第 1 天循环，连续签到总天数继续累计，中断一天后从第 1 天重新开始。增长拼团人数为 `2-10`、有效期为 `1-720` 小时；更换 `growthGroupCampaignKey` 会开启新一期活动。失败补偿仅对有费用的真实任务失败生效，任务费用仍先全额退回，管理员强制失败不发额外奖励。用量里程碑最多 12 档，以北京时间自然月的成功交付图片数累计。`taskFailureRetryCount` 为连接、超时、429 或临时上游错误的额外尝试次数，范围 `0-100`。`crossProviderSameModelBalancingEnabled` 默认关闭；开启后，同类型、同显示名称且有效积分价格与任务单价快照完全一致的公开模型可以跨服务商参与容量调度，参数能力不兼容的候选会被排除，任务冻结积分不会变化。`c2aBaseUrl`、`c2aApiKey` 非空以及 `c2aTimeoutSecs > 0` 时覆盖环境变量；空值/0 使用环境变量。蓝鲸支付后台配置同样优先于环境变量并按请求热生效；启用时必须提供网关地址、通讯密钥、HTTPS 异步通知地址，并至少开启一个渠道。API Key 和蓝鲸通讯密钥永不明文返回，已配置时只返回末四位掩码；PUT 省略字段、提交空串或原掩码均不会覆盖现有密钥。`dailyLimit=0` 表示投稿不限次数。

平台日志默认关闭。总开关关闭时不建立内存队列、不写 `platform_logs`；开启时至少启用安全、运维、用户三类中的一类。保留期范围 `1-90` 天，逻辑容量范围 `32-4096` MB。日志只保存脱敏事件，不保存提示词、请求正文、密码、Cookie、API Key 或图片二进制。

### 管理端运行日志

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/platform-logs` | 按时间、分类、等级、服务、路由、任务、用户、请求 ID 或关键字查询；cursor 分页 |
| GET | `/api/v1/admin/platform-logs/stats` | 容量与开关配置，以及周期内错误率、警告、慢事件、平均/P95、趋势、异常事件、慢路由和异常任务 |
| DELETE | `/api/v1/admin/platform-logs` | 按分类/时间删除；清空全部必须显式传 `all=true` |
| POST | `/api/v1/admin/platform-logs/cleanup` | 立即执行保留期和容量上限清理 |

列表会使用 `taskId` 只读关联当前任务或助手运行，自动补充用户、业务类型、状态、模型、服务商名称、线路、尝试次数、当前阶段和最终错误；这些关联字段不会重复写入日志表。HTTP 日志附带请求范围、客户端类型、结果类型、请求/响应大小和脱敏错误码，不保存完整 User-Agent 或请求内容。`stats` 支持 `range=24h|7d|30d|all`，聚合查询仅在管理员打开日志页时执行。

后台首页 `usage` 的 `today`、`last7Days`、`last30Days` 均分别返回 `text` 与 `image`。文本统计包含请求数、实收及输入/输出/推理/总 Token；图片统计包含请求数、成功交付图片数和实收。旧字段 `settledCents`、`imageCount`、`todayToken` 保留兼容。

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
| 工作流    | `workflow_run_active`, `workflow_run_lock_lost`                                                   |
| Agent 评测 | `agent_eval_no_samples`, `agent_eval_no_cases`                                                  |
| 服务端    | `internal_error`                                                                                |

调用方应以 HTTP 状态和 `code` 分支，不应解析中文 `error` 文案。

## 无限画布工作流运行诊断

以下接口要求用户 Cookie `sc_session`，并且只允许访问自己的画布项目。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/canvas-projects/{id}/workflow-run` | 当前活动运行，供跨页面接管 |
| POST | `/api/v1/canvas-projects/{id}/workflow-runs` | 以 `{ownerId,nodeIds}` 创建或重新取得浏览器运行租约 |
| PATCH | `/api/v1/canvas-projects/{id}/workflow-runs/{runId}` | 同步心跳、节点诊断、费用及 `succeeded|failed|canceled` 终态 |

普通工作流由当前画布页面执行，仍支持节点依赖、并行分支、刷新恢复、失败重试和取消。运行记录保存逐节点 `nodeMetrics`、`totalCostCents` 和 `errorNodeId`；节点诊断状态为 `queued|running|succeeded|failed|canceled`，包含开始/完成时间、耗时、实际任务费用和原始失败信息。产品化版本、发布、替换输入、后台执行和批量运行接口不再提供。

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
| GET    | `/api/v1/assistant/runs/{id}/trace`         | 查询本人画布 Agent 的初始快照、视觉摘要、恢复点、工具步骤、耗时、错误与自动评分 |
| PATCH  | `/api/v1/assistant/runs/{id}`               | `{status:"canceled"}` 取消任务                            |
| GET    | `/api/v1/assistant/runs/{id}/events`        | SSE 增量事件流                                              |

助手模型价格来自后台模型配置。对话按每轮模型价计费，生图按模型价乘图片数计费；Agent 创建时预留对话与可能生图费用中的较高值，Worker 按最终 `resolvedMode` 结算并退回差额。运行响应包含 `reservedCents`、`costCents` 与 `billingGeneration`。创建、成功、失败、用户停止、强制删除活动对话、后台取消/强制失败和失败重试的状态变化与钱包账本位于同一事务；失败或取消全额释放当代预留。

明确的“制作 PPT”或“把参考图制作成 PSD”请求仍使用 `POST /api/v1/assistant/runs`。Worker 通过 ChatGPT2API 可编辑文件任务异步执行，并以 `submitting-file`、`generating-file`、`saving-file` 三个阶段推送进度；完成后消息 `artifacts` 包含本站鉴权下载地址。PSD 请求至少需要一张 JPG、PNG 或 WebP 参考图。

## 管理端：Agent 质量

以下接口要求独立管理员会话。评测仅分析已经发生的真实 Agent 追踪，不会调用上游模型，也不会消耗用户积分。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/agent-quality` | 单次返回周期汇总、Prompt/工具版本对比、最近追踪、固定评测集与最近评测运行；支持 `days=7|30`、状态和版本筛选 |
| GET | `/api/v1/admin/agent-quality/traces/{id}` | 返回单次 Agent 的初始画布、视觉参考、恢复点及完整工具步骤 |
| PATCH | `/api/v1/admin/agent-quality/eval-cases/{id}` | `{active}` 启用或停用固定评测项 |
| POST | `/api/v1/admin/agent-quality/eval-runs` | 对近 7/30 日最多 200 条真实追踪运行固定评测；可限定模型、推理强度、Prompt 和工具版本 |
| GET | `/api/v1/admin/agent-quality/eval-runs/{id}` | 返回逐评测项的样本量、通过率、代表失败追踪和无样本原因 |

评测运行请求示例：

```json
{
  "days": 7,
  "sampleLimit": 80,
  "model": "gpt-5",
  "reasoningEffort": "high",
  "promptVersion": "canvas-agent-2026-08-29",
  "toolVersion": "canvas-tools-2026-08-29"
}
```

任一版本字段为空表示不过滤。当前固定规则覆盖选中节点引用、多图处理、参考图工作流、高风险确认、恢复点、失败步骤重试、连接正确性和工具调用收口；无适用真实样本的评测项明确标记为无样本，不猜测通过。

## 补充：用户账户、钱包、通知与行为接口

以下接口均属于 `/api/v1`，除明确说明外要求用户 Cookie `sc_session`。

| 方法 | 路径 | 请求/响应说明 |
| --- | --- | --- |
| GET | `/api/v1/me/wallet/summary` | 返回钱包余额、冻结额、累计收入/支出及账本摘要，供钱包首页低成本加载。 |
| GET | `/api/v1/me/wallet/export` | 导出当前用户账本；响应为下载文件，不返回 JSON 包装。 |
| GET | `/api/v1/me/subscription` | 返回当前有效订阅、套餐权益和到期状态；无订阅时返回空状态。 |
| DELETE | `/api/v1/me/notifications` | 清空当前用户可删除通知；成功返回 `204 No Content`。 |
| POST | `/api/v1/me/behavior-events` | `{events:[...]}`，每批 `1-50` 条脱敏行为事件；返回 `{accepted}`。 |
| POST | `/api/v1/me/api-keys/{id}/rotate` | 轮换本人 API Key；旧 Key 立即失效，新明文 Secret 仅在本次响应显示。受 `developer_api` 页面开关保护。 |

行为事件元素：

```json
{
  "clientEventId": "uuid",
  "eventName": "feature_open",
  "feature": "assistant",
  "metadata": {
    "entryPoint": "home",
    "itemCount": 1,
    "batch": false
  }
}
```

允许的 `eventName` 为 `feature_open`、`reference_upload_started`、`reference_upload_completed`、`reference_upload_failed`、`form_started`、`form_abandoned`、`template_open`、`template_used`。`metadata` 只允许 `entryPoint`、`uploadKind`、`itemCount`、`source`、`errorType`、`batch`，不接受提示词、文件内容、图片数据或任意自由文本。

## 补充：任务报价、输出删除和状态事件

| 方法 | 路径 | 请求/响应说明 |
| --- | --- | --- |
| POST | `/api/v1/tasks/quote` | 使用与创建任务相同的核心字段预检模型、输入、数量和价格，只返回报价/能力，不创建任务、不冻结积分。 |
| DELETE | `/api/v1/tasks/{id}/outputs/{index}` | 删除当前用户终态任务的指定输出及其对象引用；索引必须在输出范围内。 |
| GET | `/api/v1/me/tasks/events` | 用户级 SSE；推送本人全部任务的状态、阶段、重试和终态变化。 |

任务阶段 `generationStage`：

| 值 | 含义 |
| --- | --- |
| `queued` | 已入队，尚未获得执行租约 |
| `preparing` | 正在校验或准备参考图 |
| `upstream_generating` | 已真实提交上游，正在生成 |
| `fetching_result` | 上游已完成，本站正在拉取结果 |
| `saving_result` | 正在写入对象存储和缩略图 |
| `completed` | 成功终态 |
| `failed` | 失败终态，读取 `errorCode/errorMessage` |
| `canceled` | 取消终态 |

SSE 使用 `text/event-stream`。客户端收到终态后应停止重连；断线后通过任务详情接口校准最终状态，不能只依赖内存事件。

## 补充：AI 助手完整接口

| 方法 | 路径 | 请求/响应说明 |
| --- | --- | --- |
| GET | `/api/v1/assistant/conversations/{id}` | 返回本人单个对话、消息、附件、运行状态和队列信息。 |
| PATCH | `/api/v1/assistant/conversations/{id}` | 更新对话标题等可编辑元数据。 |
| POST | `/api/v1/assistant/conversations/{id}/context-boundaries` | 创建“从这里开始新上下文”边界，不删除历史消息。 |
| DELETE | `/api/v1/assistant/messages/{id}/images/{imageId}` | 删除本人助手消息中的单张图片，并把对象加入延迟清理。 |
| GET | `/api/v1/assistant/files` | 返回最近最多 50 个本人助手文档。 |
| POST | `/api/v1/assistant/files` | multipart `file`；上传后异步解析。支持 TXT、Markdown、CSV、JSON、PDF、DOCX、XLSX、PPTX。 |
| GET | `/api/v1/assistant/files/{id}` | 返回文档状态、页数、字符数、分段数、失败信息和时间。 |
| DELETE | `/api/v1/assistant/files/{id}` | 删除本人文档并进入对象清理队列。 |
| POST | `/api/v1/assistant/runs/{id}/tool-claims` | 浏览器画布工具执行器认领一次待执行工具请求；包含幂等/所有权校验。 |
| POST | `/api/v1/assistant/runs/{id}/tool-results` | 回传已认领工具的成功或失败结果；过期或非本人认领会被拒绝。 |

助手文档限制：单文件不超过服务端上传上限（当前提示为 15MB），最多保留 `50` 个，总容量 `300MB`，最多同时处理 `4` 个，24 小时最多上传 `50` 个。PSD 不是可上传解析的助手文档；“生成 PSD”走助手运行的可编辑文件流程。

助手运行队列：每个对话最多排队 `10` 个、每个用户最多排队 `20` 个。同一对话最多一个 `running`，排队项可通过 `PATCH /api/v1/assistant/runs/{id}` 执行 `edit|move_up|move_down` 或设置 `status:"canceled"`；已经开始的项不能再编辑或换序。

## 补充：AI 电商生成与手持商品接口

| 方法 | 路径 | 请求/响应说明 |
| --- | --- | --- |
| POST | `/api/v1/commerce/product-briefs` | 基于商品资料和参考资产生成结构化商品 Brief。 |
| GET | `/api/v1/commerce/aplus-catalog` | 返回当前开放的 A+ 模板、版式和模型能力。 |
| POST | `/api/v1/commerce/aplus-plans` | 根据商品和目标生成 A+ 页面分区计划。 |
| GET | `/api/v1/commerce/reviews` | 查询本人电商任务的素材审阅状态。 |
| PUT | `/api/v1/commerce/reviews/{taskId}` | 新建或更新指定任务的审阅结论。 |
| GET | `/api/v1/commerce/catalog` | 公开电商素材目录。 |
| GET | `/api/v1/commerce/handheld/catalog` | 手持商品姿势/模板目录。 |
| POST | `/api/v1/commerce/handheld/quotes` | 对手持商品批次做价格和能力预检，不开始生成。 |
| GET | `/api/v1/commerce/handheld/projects` | 本人的手持商品项目列表。 |
| POST | `/api/v1/commerce/handheld/projects` | 创建项目和初始规格。 |
| GET | `/api/v1/commerce/handheld/projects/{id}` | 项目、草稿、任务项和输出详情。 |
| PUT | `/api/v1/commerce/handheld/projects/{id}/draft` | 保存项目草稿，使用完整替换语义。 |
| POST | `/api/v1/commerce/handheld/jobs` | 按项目草稿创建生成批次并冻结积分。 |
| GET | `/api/v1/commerce/handheld/jobs/{id}` | 查询批次、逐项状态、失败原因和输出。 |
| POST | `/api/v1/commerce/handheld/jobs/{id}/cancel` | 取消尚未提交项；已提交上游项遵循确认和结算规则。 |
| POST | `/api/v1/commerce/handheld/items/{id}/retry` | 仅重试指定失败项。 |
| POST | `/api/v1/commerce/handheld/items/{id}/save-asset` | `{title?,groupId?,tags?}`，把成功输出保存到本人资产库。 |

`GET /api/v1/commerce/tryon-catalog` 继续作为试衣素材目录别名存在。电商生成任务最终仍落入统一任务系统，状态、重试、费用和取消以任务接口为准。

## 补充：管理员首页、成本、画像和任务诊断

| 方法 | 路径 | 请求/响应说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/files/*key` | 管理员查看受控站内文件；仅用于后台预览，跳过用户 Cookie 但仍要求管理员会话。 |
| GET | `/api/v1/admin/badge-counts` | 返回待审核、待处理等导航角标数量。 |
| GET | `/api/v1/admin/statistics` | 后台首页统计：任务、系统、文本/图片用量、利润、Agent/Open API/OSS 质量摘要。 |
| GET | `/api/v1/admin/system/metrics` | 当前 CPU、内存、Go、数据库、Redis、队列和 Worker 运行指标。 |
| GET | `/api/v1/admin/profitability` | `dimension=model|provider|route|workspace|user&days=7|30`；返回周期汇总和最多 50 个维度项。 |
| GET | `/api/v1/admin/user-analytics` | 返回全站用户生命周期、风险、价值、活跃、留存和业务使用聚合。 |
| POST | `/api/v1/admin/users/{id}/profile/refresh` | 立即重新计算单个用户画像并返回新结果。 |
| GET | `/api/v1/admin/tasks/{id}/timeline` | 返回任务阶段事件、创建/开始/结束时间，用于拆分排队、上游、拉取和保存耗时。 |
| GET | `/api/v1/admin/growth/groups` | 查询当前增长拼团及成员/奖励状态。 |

成本利润响应的核心字段为 `revenueCents`、`upstreamCostCents`、`grossProfitCents`、`succeededUnits`、`failedUnits`。未记录模型、服务商或线路时，接口使用“未记录”标签，不暴露上游密钥或端点。

用户详情 `GET /api/v1/admin/users/{id}` 同时返回画像指标、历史、工作区分布、模型分布、失败原因和每日趋势。画像刷新是后台操作，不应从普通用户请求中同步触发全量统计。

## 补充：管理员安全中心和支付对账

| 方法 | 路径 | 请求/响应说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/security/risks` | `unresolved=false` 可包含已处理项，`limit=1-200`；返回风险事件和有效限制。 |
| POST | `/api/v1/admin/security/risks/{id}/resolve` | `{note}` 标记风险已处理；成功返回 `204`。 |
| POST | `/api/v1/admin/security/blocks/{id}/revoke` | 解除指定安全限制；成功返回 `204`。 |
| POST | `/api/v1/admin/security/api-keys/{id}/unfreeze` | 解冻自动冻结的用户 API Key；成功返回 `204`。 |
| GET | `/api/v1/admin/security/upload-hashes` | 返回恶意/禁止上传 SHA-256 规则，`limit=1-200`。 |
| POST | `/api/v1/admin/security/upload-hashes` | `{sha256,reason}`；哈希必须为 64 位十六进制，原因 1-300 字。 |
| DELETE | `/api/v1/admin/security/upload-hashes/{sha256}` | 停用对应哈希规则；成功返回 `204`。 |
| GET | `/api/v1/admin/payment-reconciliations` | `issues=false` 可包含正常项，返回最近支付对账结果。 |
| POST | `/api/v1/admin/payment-reconciliations/run` | 核对最近 30 日最多 500 个候选订单，必要时补齐已支付未到账订单；返回 `{checked,outcomes}`。 |

支付对账可能返回 `matched`、`repaired`、`identity_or_amount_mismatch`、`paid_amount_mismatch`、`local_terminal_mismatch`、`local_ahead`、`repair_failed`、`provider_error`。异常会同步形成安全风险事件。

## 补充：管理员内容、模板与模型维护

| 方法 | 路径 | 请求/响应说明 |
| --- | --- | --- |
| POST | `/api/v1/admin/announcements/images` | multipart 上传公告图片，返回站内受控 URL。 |
| GET | `/api/v1/admin/changelog/export` | 导出完整更新记录数据。 |
| POST | `/api/v1/admin/changelog/import` | 导入更新记录；按导入格式校验并避免破坏既有记录。 |
| POST | `/api/v1/admin/canvas-workflow-templates/analyze` | 分析模板文档并返回节点/能力摘要，不执行用户工作流。 |
| PUT | `/api/v1/admin/canvas-workflow-templates/{id}/cover` | multipart 替换模板封面。 |
| POST | `/api/v1/admin/gallery/submissions/{id}/prompts` | 从投稿生成提示词库条目。 |
| PATCH | `/api/v1/admin/plans/order` | 套餐排序的规范路径；`/api/v1/admin/plan-order` 作为当前兼容路径仍注册。 |
| POST | `/api/v1/admin/providers/c2a/tests` | 测试 C2A/ChatGPT2API 线路，不创建用户任务。 |
| POST | `/api/v1/admin/providers/sub2api/tests` | 测试 Sub2API 线路。 |
| POST | `/api/v1/admin/providers/crun/tests` | 测试 CRUN 媒体线路。 |
| POST | `/api/v1/admin/providers/lanjing-pay/tests` | 调用支付方状态接口，不创建订单。 |

电商目录管理同时注册 `/api/v1/admin/ecommerce/catalog` 和 `/api/v1/admin/ecommerce/tryon-catalog` 两组路径，当前均指向同一套试衣目录能力：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET/POST | `/api/v1/admin/ecommerce/tryon-catalog` | 列表或创建目录项。 |
| PATCH | `/api/v1/admin/ecommerce/tryon-catalog/order` | 调整目录排序。 |
| PATCH | `/api/v1/admin/ecommerce/tryon-catalog/{id}` | 编辑目录项。 |
| PUT | `/api/v1/admin/ecommerce/tryon-catalog/{id}/image` | multipart 替换展示图。 |
| DELETE | `/api/v1/admin/ecommerce/tryon-catalog/{id}` | 删除目录项。 |

## 开放 API 路由总表

开放 API 是否可用同时受全局 `developer_api` 页面开关、API Key 状态、Scope、模型白名单、IP 白名单、速率和日/月额度控制。

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| GET | `/api/open/v1/models` | `models:read` | 返回该 Key 可用的公开模型 ID、名称、价格和能力。 |
| POST | `/api/open/v1/uploads` | `files:write` | multipart `file` 上传参考文件；返回所属 Key 用户的对象 key 和鉴权 URL。 |
| GET | `/api/open/v1/files/*key` | `tasks:read` | 读取属于该 Key 用户的输入或任务文件。 |
| POST | `/api/open/v1/tasks` | `tasks:write` | 创建图片任务；支持 `Idempotency-Key` Header，复用站内计费、并发和队列。 |
| GET | `/api/open/v1/tasks/{id}` | `tasks:read` | 查询属于该 Key 用户的任务、真实失败信息和输出 URL。 |

Open API 不接受浏览器 Cookie 代替 Bearer Key。Key 明文只在创建/轮换响应出现；数据库只保存哈希。完整请求、错误码、Webhook 事件和验签示例见 [OPEN_API.md](OPEN_API.md)。

## 内部回调

| 方法 | 路径 | 调用方 | 说明 |
| --- | --- | --- | --- |
| POST | `/internal/c2a/image-task-events` | ChatGPT2API/C2A | 推送 `success|error` 图片任务事件，验证通过后触发本站结果轮询；成功返回 `202 Accepted`。 |

该接口不使用 `sc_session`、`sc_admin_session` 或用户 API Key。必须配置 `C2A_CALLBACK_SECRET`，否则接口伪装为 `404`。请求体上限 `16KB`，Header 为 `X-C2A-Timestamp: <unix seconds>` 和 `X-C2A-Signature: sha256=<hex hmac>`；签名原文是 `<timestamp>.<原始请求体字节>`，时间偏差不得超过 5 分钟。生产环境还应通过反向代理或容器网络限制来源，不能作为公网匿名接口开放。

请求体示例：

```json
{
  "id": "task-uuid",
  "status": "success",
  "updated_at": "2026-09-01 12:00:00",
  "duration_ms": 27000,
  "image_count": 2,
  "error_code": "",
  "error": ""
}
```

## HTTP 状态码

| 状态码 | 使用场景 |
| --- | --- |
| `200` | 成功读取、更新并返回响应、幂等成功 |
| `201` | 成功创建资源 |
| `204` | 成功删除或无响应体更新 |
| `400` | 不支持文件、格式或通用错误请求 |
| `401` | 用户、管理员或 API Key 未认证/失效 |
| `403` | Scope、Origin、资源权限、IP 白名单或账号状态拒绝 |
| `404` | 路由或所属资源不存在 |
| `405` | 已知路径但 HTTP 方法错误 |
| `409` | 状态冲突、余额不足、资源占用、幂等冲突或需要取消确认 |
| `413` | 请求体或上传文件过大 |
| `422` | JSON 字段、枚举、数量或业务参数校验失败 |
| `429` | 请求频率、并发、队列、任务、积分、流量或上传额度超限 |
| `500` | 未分类服务端错误，响应不泄露内部堆栈 |
| `503` | 上游/配置不可用，或价格保护阻止调用 |

## 已下线或不注册的接口

- `/api/v1/assistant/chat`、`/api/v1/assistant/images`：遗留免费直连接口已下线，统一使用 `/api/v1/assistant/runs`。
- 旧 `/api/*` 无版本兼容路由：不注册。
- 画布产品化版本发布、替换输入、服务器执行器和批量运行接口：不注册。
- 用户端“使用工作流”入口已撤下；现有画布运行诊断接口只服务当前画布页面执行和恢复。
- CDN 控制接口：当前项目不提供，图片交付使用 OSS/站内文件接口。

## 接口维护规则

1. 新增或删除服务端路由时，必须同步本文和相关客户端类型。
2. 面向外部开发者的变更同时更新 `docs/OPEN_API.md`。
3. 破坏性变更优先增加新版本或迁移期，不静默改变字段语义。
4. 客户端按 HTTP 状态和机器可读 `code` 分支，不解析中文 `error`。
5. 任何用户接口不得返回 API Key、上游密钥、内部端点、服务商内部 ID 或数据库错误。
6. SSE/Webhook/重试接口必须支持幂等，终态后不继续重复执行副作用。
