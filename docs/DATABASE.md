# 数据库设计

数据库为 PostgreSQL。精确 DDL 位于 `apps/server/migrations/*.sql`，当前迁移版本为 `00063`；迁移工具是 Goose，并内嵌到 Go 二进制中。本文用于解释表职责、关键约束和跨表事务，不替代迁移文件。

## 全局约定

- 业务主键通常为 `uuid DEFAULT gen_random_uuid()`；提示词源主键是 text slug。
- 金额使用 `bigint` 整数分，禁止浮点账务。
- 时间使用 `timestamptz`，订阅每日发放日期单独使用 `date`。
- 可枚举状态由 CHECK 约束保护。
- JSON 数组/对象使用 `jsonb`，默认分别为 `[]`/`{}`。
- `serve` 启动时执行迁移；应用运行时不建表。

## 账号与会话

### `users`

| 列                                                       | 说明                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `id`, `email`, `username`, `password_hash`, `avatar_url` | 账号、头像与 bcrypt 密码哈希；email 使用 citext 唯一约束                                 |
| `bio`, `location`, `website_url`                         | 用户自填简介、所在地和个人网站；默认空字符串                                             |
| `role`                                                   | 当前普通账号固定为 `user`；`admin` 仅保留给 `00007` 迁移前的兼容记录，不能用于用户端登录 |
| `status`                                                 | `active` / `banned`                                                                      |
| `submission_banned_until`                                | 画廊禁投截止时间，NULL 表示未禁投                                                        |
| `last_login_at`, `created_at`                            | 登录与创建时间                                                                           |

### `sessions`

保存 `user_id`、唯一 `token_hash`、`expires_at`、IP、User-Agent 和创建时间。删除用户时级联删除；过期记录由 Worker 每小时清理。

### `user_identities`

保留历史 OAuth identity 数据以兼容旧账号；当前运行时不再提供或创建任何第三方 OAuth identity。删除用户时历史 identity 会级联删除。

### `email_login_codes`

每个规范化邮箱最多一条验证码记录，保存 `authenticate` 用途、HMAC `code_hash`、过期时间、失败次数、请求 IP 和创建时间。验证码 10 分钟有效；验证成功后在同一事务内删除并创建账号或 session，错误次数以行锁和独立提交累积，达到 5 次后锁定。

### `oauth_login_states`

保存一次性 OAuth state 的 SHA-256、provider、过期时间和创建时间。当前运行时只写 GitHub state；回调必须匹配 provider、Cookie 与未过期数据库记录，并以原子删除完成一次性消费。

### `admin_accounts`

独立管理员身份表，保存 UUID、唯一 email、username、password hash、`active|disabled` 状态、最近登录和创建时间。它与 `users` 没有外键关系，因此同一邮箱可以同时是普通用户和独立密码管理员，两侧密码互不共享。

升级到 `00007` 时，旧 `users.role='admin'` 记录会以相同 ID、邮箱和当时的密码哈希复制一次，确保升级后可登录；此后两边密码不会同步，且旧管理员用户记录不能再通过用户端认证。

### `admin_sessions`

管理员会话保存 `admin_id`、唯一 token hash、12 小时过期时间、IP、User-Agent 和创建时间。它与普通 `sessions` 完全分离，旧管理员的普通用户 session 在迁移时删除。

历史迁移 `00008` 曾创建 `admin_access_keys`，迁移 `00011` 已将该表删除。当前管理员认证只依赖 `admin_accounts` 与 `admin_sessions`，不生成、不保存也不校验管理员密钥。

## 钱包与历史支付数据

支付、订单、套餐购买和订阅 API 当前在所有环境中停用。以下 `plans`、`orders`、`subscriptions` 表仍保留，用于已有部署无损迁移和历史数据审计；它们不代表存在可用支付入口。

### `wallets`

每个用户一行，以 `user_id` 为主键。`balance_cents` / `frozen_cents` 是普通可用与冻结积分，`trial_balance_cents` / `trial_frozen_cents` 是体验可用与冻结积分，均有非负 CHECK。任务冻结优先使用当前启用活动中逐功能获批的体验积分，不满足活动与授权条件时只使用普通积分；两类来源会快照到任务积分预留记录，确保失败退回和成功结算不串桶。

### `wallet_ledger`

图片任务使用 `source_type='task'`，AI 助手使用 `source_type='assistant_run'`。助手失败重试时 `source_id` 使用 `run_id/generation`，保证每代预留、释放和结算分别幂等。`balance_after_cents` 始终记录当时可用积分，冻结积分不重复计入。

| 列                         | 说明                                                            |
| -------------------------- | --------------------------------------------------------------- |
| `kind`                     | `grant`、`spend`、`freeze`、`release`、`refund`、`admin_adjust` |
| `delta_cents`              | 本次对可用余额的变化                                            |
| `balance_after_cents`      | 变化后的可用余额快照                                            |
| `source_type`, `source_id` | 订单、任务、订阅、兑换码或人工操作来源                          |
| `reason`, `created_at`     | 原因与发生时间                                                  |

`(kind, source_type, source_id)` 在 `source_id IS NOT NULL` 时唯一，是账务幂等边界。余额更新和账本写入必须处于同一事务。

### `daily_checkins`

每个用户、每个北京时间自然日最多一条签到记录，保存连续签到天数、当前 7 天奖励周期位置和实际发放积分快照。`UNIQUE (user_id, checkin_date)` 是签到事实的数据库级幂等边界；接口还对用户获取事务级 advisory lock，并在同一事务写入签到记录、钱包余额和 `wallet_ledger`。账本来源为 `daily_checkin`，来源 ID 为 `userId:YYYY-MM-DD`，因此重复或并发请求不会重复发放。

### `plans`

套餐包含唯一 `code`、名称、说明、展示角标、`kind`、售价、赠送规则、展示卖点、推荐位、上架状态、排序和更新时间。全站只允许一个套餐占用推荐位：

- `topup`：使用 `grant_cents + bonus_cents` 一次性入账。
- `subscription`：使用 `duration_days` 与 `daily_grant_cents` 创建订阅期。

后台可以物理删除未产生订单或订阅记录的套餐；一旦被 `orders` 或 `subscriptions` 引用，只允许下架，禁止删除，确保历史账务外键与审计信息完整。

### `orders`

订单保存用户、套餐和下单时的 `amount_cents`、`grant_cents`、`bonus_cents` 快照。状态为 `pending|paid|completed|failed|expired`；`(provider, provider_order_id)` 对非空 provider order 唯一。订单完成条件更新与入账/开通订阅位于同一事务。

### `subscriptions`

订阅期关联用户、套餐和订单，保存 `starts_at`、`ends_at`、每日发放快照、`last_granted_date` 与 `active|expired` 状态。索引覆盖 `(status, ends_at)` 和用户最近订阅。每日入账幂等来源为 `subscriptionId/YYYY-MM-DD`，日期按北京时间计算。

### `redemption_codes`

兑换码保存唯一明文 `code`、面值、批次、备注、过期时间、创建管理员和兑换用户/时间。`created_by` 外键指向 `admin_accounts`，`redeemed_by` 指向 `users`。状态为 `active|redeemed|disabled`，面值必须大于 0。兑换时以条件 UPDATE 抢占 active 记录，并在同一事务写钱包和 `wallet_ledger`。

## 图片任务

### `tasks`

| 列                                        | 说明                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `type`                                    | `t2i`、`coloring`、`ui_design`、`ecommerce_design`、`model_sheet`、`game_art`、`puzzle`         |
| `model`                                   | 新任务提交时锁定的上游模型；Worker 执行和 API 展示共用该值。迁移前历史任务按迁移时生效配置补齐 |
| `status`                                  | `queued`、`running`、`succeeded`、`failed`、`canceled`                                         |
| `prompt`, `params`, `count`               | 生成输入；count 限制为 1 至 4                                                                  |
| `input_keys`, `output_keys`               | 输入和原图 R2 object key 数组                                                                  |
| `thumbnail_keys`                          | 与原图按索引对应的最长边 512px JPEG 缩略图 key 数组                                            |
| `cost_cents`                              | 提交时锁定的费用                                                                               |
| `work_units`                              | 图片工作量，当前等于 count，用于用户和全站排队容量核算                                         |
| `idempotency_key`                         | 同一用户内唯一的可选提交键                                                                     |
| `error_code`, `error_message`, `attempt`  | 失败与业务重试信息                                                                             |
| `lease_owner`, `heartbeat_at`, `lease_until` | Worker/轮询器所有权与租约；运行态写入必须匹配所有者                                         |
| `started_at`, `finished_at`, `created_at` | 生命周期时间                                                                                   |

索引支持用户时间线和状态扫描。任务提交、状态迁移和钱包冻结/结算/释放都使用事务与条件更新。

`puzzle` 仅为历史类型兼容；当前拼图在浏览器 Canvas 内执行，服务端拒绝创建新拼图任务并强制价格为 0。

### `assistant_runs`

持久化助手对话运行状态、请求参数和最终路由结果。`reserved_cents` 是本代最大预留，`cost_cents` 是成功后的真实结算额且受 `cost_cents <= reserved_cents` 约束，`billing_generation` 在后台重试时递增。Agent 将对话总价与可能的图片总价同时快照进 `params`，Worker 根据最终 `resolved_mode` 选择真实费用。终态更新和钱包结算/退回必须位于同一事务。

### `object_cleanup_jobs`

任务和助手产物使用 `tasks/` 前缀的 R2 object key。任务删除、失败重试、助手消息/对话裁剪以及部分输出清理时，会在删除数据库所有者或清空产物引用的同一事务中登记待清理 key；`object_key` 唯一，重复登记幂等。`next_attempt_at`、`attempts` 和 `last_error` 保存外部对象存储失败后的持久化重试状态。

Worker 每 5 分钟锁定一批到期作业，在 R2 删除前再次检查任务输入/输出/缩略图、蒙版、助手消息和运行参数、画廊投稿、提示词封面以及画布文档引用。仍被引用的 key 会留在队列中，删除成功后移除作业，失败则延迟 5 分钟重试。迁移文件为 `00063_object_cleanup_jobs.sql`；该队列只处理 `tasks/` 对象，普通 `uploads/` 对象由 `user_upload_objects` / `user_upload_references` 的回收流程负责。

### `user_assets`

用户个人素材库记录。每行保存所属 `user_id`、可选 `group_id`、标题、原图 `file_key`、512px JPEG `thumbnail_key`、内容类型、原图字节数与创建时间；`(user_id, file_key)` 唯一，删除用户时级联删除记录。API 同时校验 object key 必须属于当前用户的 `uploads/{user_id}/` 前缀，并将每账号素材数量限制为 200 项。删除素材时先删除数据库记录，再尽力删除对应原图和缩略图对象。

### `user_upload_objects` / `user_upload_references`

普通 `/api/v1/uploads` 产生的 R2 对象先登记到 `user_upload_objects`，业务事务再通过 `user_upload_references` 建立引用。当前引用类型包括任务输入/蒙版、个人素材、头像、助手消息和助手运行。一个对象可以被多个业务记录共享，只有最后一个引用删除后才进入回收候选；Worker 扫描 R2 中超过 7 天且没有引用的 `uploads/{user_id}/original|thumb/` 对象，在数据库行锁保护下删除 R2 对象并写入 `deleted_at`。迁移 `00062` 会从现有素材、头像、任务和助手 JSONB 数据回填历史引用；进程在 R2 上传成功后、数据库登记前崩溃的对象由后续扫描发现并回收。

### `user_asset_groups`

个人素材分组。每行保存 `user_id`、名称（同用户大小写不敏感唯一）、排序与时间戳；最多 50 组。删除分组时，关联素材的 `group_id` 置空（`ON DELETE SET NULL`）。

### `ecommerce_products`

商品级业务资料和参考图索引。每行归属一个用户，保存 SKU、商品名称、品牌、类目、卖点、目标人群、材质、颜色、规格、默认平台/市场/语言，以及 1-6 个 `user_assets.id` 的 JSON 数组。`protected_elements` 保存必须保持的 Logo、文字、按钮、刻度等商品事实约束；它们会在进入 AI 电商工作台时加入生成提示和任务快照。商品状态为 `active|archived`，同一用户的非空 SKU 大小写不敏感唯一；删除商品不会删除被引用的个人素材。

## 画廊与通知

### `gallery_categories`

画廊分类包含名称、排序、active 和创建时间。删除分类时投稿的 `category_id` 自动置 NULL。

### `gallery_submissions`

每个任务最多一条投稿（`task_id UNIQUE`）。保存用户、标题、封面/媒体 key、`pending|approved|rejected|removed` 状态、拒绝原因、审核人/时间、精选标记、分类、展示排序及 JSON 标签数组；`reviewed_by` 指向 `admin_accounts`。作品标签最多 20 个，单项不超过 32 个字符，由管理接口统一清洗和去重。索引覆盖状态、精选、分类与用户时间线。

### `notifications` 与 `notification_reads`

通知可属于单个用户，也可在 `user_id IS NULL` 时代表全站通知。个人通知直接使用 `read_at`；全站通知通过 `(user_id, notification_id)` 复合主键表记录每个用户的已读状态。

### `trial_campaigns`

体验活动实体保存标题、1-6 个真实功能键、`credit_only|restricted` 准入方式、总名额、展示人数调整值、强制 `expires_at` 截止时间以及 `draft|active|closed` 生命周期。`expires_at` 必须晚于创建时间，活动接口把单期限制为 5 分钟至 365 天。部分唯一索引 `uq_trial_campaigns_one_active` 从数据库层保证全站最多一个 `active` 活动。启用新活动会在同一事务关闭旧活动；启停与配置修改使用排他 advisory transaction lock，申请、审核、领取和体验积分冻结使用相同键的共享锁，因此关闭成功后不会再有旧活动操作越过边界。Worker 每分钟将到期活动更新为 `closed`，同时所有授权和体验积分查询都独立要求 `expires_at > now()`，避免调度延迟导致越权。活动产生申请后功能集合锁定，避免历史申请、授权与当前配置错位。

### `trial_access_applications`

每个活动期次、每个用户最多一条体验资格申请，以 `(campaign_id,user_id)` 唯一；申请序号以 `(campaign_id,application_no)` 唯一并按期次重新计数。记录 1-6 个申请功能、职业、申请理由、`pending|approved|rejected` 状态、审核说明、审核管理员和时间。审核通过后通过唯一的 `redemption_code_id` 关联内部专属兑换码；兑换逻辑同时校验申请归属和活动仍启用。被拒绝的用户重新提交时复用本期记录、清空旧审核结果、刷新提交时间并分配新的申请序号；同一用户可以参加新一期。

### `user_trial_feature_entitlements`

逐用户、逐功能保存体验授权及来源申请。授权读取必须联接来源申请和 `trial_campaigns`，只承认当前 `active` 活动且未撤销的记录。新一期同功能再次获批时更新授权来源；关闭活动不删除钱包里的体验积分，但新的任务不会再冻结这部分积分。

### `user_feedback`

用户反馈记录保存分类、标题、问题描述、可选问题页面和浏览器诊断信息。处理状态为 `open|in_progress|resolved|closed`，管理员可以写入回复、处理账号和处理时间。产品建议还保存 `adopted`、奖励积分快照与发放时间；奖励账本来源为 `feedback_adoption` + feedback ID，重复审核不会重复入账。索引覆盖用户反馈时间线与后台待处理列表。

### `growth_groups` 与 `growth_group_members`

`growth_groups` 保存活动批次、唯一拼团码、发起人、目标人数、每人奖励快照、有效期和 `active|completed|expired` 状态。成员表以 `(group_id,user_id)` 为主键并冗余 `campaign_key` 供参与查询。创建/加入先按活动批次与用户取得事务 advisory lock；加入时再锁定拼团行，最后一名成员到达后在同一事务更新完成状态，并以 `groupId:userId` 为来源向每位成员发放一次 `growth_group` 奖励。

### `announcements`

公告保存标题、正文、active、生效起止时间和创建时间。公开 API 只返回当前生效内容。

### `changelog_entries`

更新说明保存版本、日期、`feature|experience` 标签、标题、摘要、条目数组、highlight 与排序。

## 提示词库

### `prompt_categories`

提示词分类配置保存稳定 `key`、显示名称、排序、active 和内置标记。公开页面只读取 active 分类；内置分类可改名、排序和停用但不可删除。删除自定义分类时，关联提示词会在同一事务中迁移到 `other`。

### `prompt_library`

提示词条保存标题、prompt、任务类型、业务分类、标签、封面 key/远程 URL、排序和 active。同步条目还包含 `source_id`、`source_item_key`；两者非空时组合唯一，手工条目保持空串。`content_fingerprint` 用于跨源精确去重；`new_until` 是滚动 24 小时最新的过期时间，查询时动态判断，不需要定时清理。

`asset_origin`、`asset_verified`、`asset_verified_at` 和 `asset_note` 仅作为旧数据库兼容字段保留，不再参与筛选、审核、发布或公共展示判断。

封面元数据字段为 `cover_width`、`cover_height` 和 `cover_metadata_checked_at`。宽高必须同时为空或同时为正整数。后台上传与画廊图片复制会立即写入尺寸；历史远程 URL 由 Worker 渐进回填，失败后 24 小时才重试。图片 URL 变化时旧尺寸与检查时间会清空。完整数据流见 [提示词瀑布流图片与滚动性能方案](PROMPT_MASONRY_PERFORMANCE.md)。

### `prompt_sources`

| 字段组     | 说明                                                     |
| ---------- | -------------------------------------------------------- | -------- | ---------- |
| 身份       | text `id`、名称、`source_url`、`json                     | markdown | html` 格式 |
| 导入默认值 | `task_type`、`default_tags`                              |
| 调度       | `enabled`、`auto_sync_enabled`、间隔分钟、`next_sync_at` |
| 锁         | `sync_lock_token`、`sync_lock_expires_at`，避免并发同步  |
| 状态       | item 数、最近同步时间/耗时/错误和创建时间                |

迁移内置六个来源。代码把这些固定 slug 视为 built-in，可编辑和停用，但不可删除。

## 配置与审计

### `app_settings`

键值为 `key text PRIMARY KEY` + `value jsonb`。迁移写入的种子值：

```text
task_prices               {"t2i":20,"coloring":30,"ui_design":30,"ecommerce_design":30,"model_sheet":40,"game_art":30,"puzzle":0}
user_max_running_tasks    100
user_max_running_images   400
global_max_active_tasks   12000
global_max_active_images  12000
task_failure_retry_count  2
signup_bonus_cents        100
registration_enabled      true
checkin_enabled           true
checkin_campaign_title    "连续签到领创作积分"
checkin_rewards           [10,15,20,25,30,40,80]
growth_group_enabled                  true
growth_group_campaign_key             "launch-2026"
growth_group_target_members           3
growth_group_reward_cents             30
growth_group_duration_hours           48
growth_failure_bonus_enabled          true
growth_failure_bonus_cents            3
growth_failure_bonus_daily_limit      3
growth_usage_rewards_enabled          true
growth_usage_milestones               [{"units":10,"rewardCents":20},{"units":30,"rewardCents":50},{"units":100,"rewardCents":150}]
suggestion_reward_max_cents           5000
task_models               {"default":"gpt-image-2"}
```

应用层还为未落库配置提供相同默认值。后台保存后通过 upsert 写入本表。增长奖励都使用带稳定来源 ID 的钱包账本：失败补偿为 `task_failure_bonus` + task ID，用量奖励为 `usage_milestone` + `userId:YYYY-MM:units`，因此任务重放或 Worker 重试不会重复入账。非空 C2A 数据库配置覆盖环境变量；API Key 的管理接口只回传掩码。

### `admin_audit_logs`

记录管理员 ID/email 快照、method、path、归一化 action、目标 ID、响应状态、IP、脱敏 detail 与创建时间。`admin_id` 指向 `admin_accounts`；管理员被删除时置 NULL，email 快照保留。索引支持全局倒序和按管理员倒序查询。Worker 定期删除 6 个月以前的记录；管理员登录、改密和业务写操作也写入本表。

## 迁移与运维

```bash
# Compose 启动 server 时自动迁移
docker compose up -d server

# 查看服务端迁移日志/启动失败
docker compose logs server

# 测试会创建临时数据库并执行同一套迁移
cd apps/server && go test ./...
```

`apps/server/scripts/backfill-prompt-categories.sql` 是提示词分类的一次性回填脚本，不属于自动迁移；只应在确认目标数据库已有对应同步条目后执行。

### `prompt_import_batches` / `prompt_import_items`

远程源抓取和 JSON/CSV 文件导入结果先进入批次暂存区，与正式 `prompt_library` 隔离。批次记录抓取源数、唯一项、重复项、审核和发布统计；暂存项记录分类、内容指纹、重复关系、合规结果、人工审核状态以及 `published_prompt_id` / `published_at` 入库结果。每条数据审核通过后立即在事务中幂等写入正式库，不需要等待整批完成；批次在没有待审或待入库项时自动结束。拒绝或决定移除的数据不会写入正式库。
