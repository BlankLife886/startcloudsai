# 数据库设计

数据库为 PostgreSQL。精确 DDL 位于 `apps/server/migrations/*.sql`，当前迁移版本为 `00014`；迁移工具是 Goose，并内嵌到 Go 二进制中。本文用于解释表职责、关键约束和跨表事务，不替代迁移文件。

## 全局约定

- 业务主键通常为 `uuid DEFAULT gen_random_uuid()`；提示词源主键是 text slug。
- 金额使用 `bigint` 整数分，禁止浮点账务。
- 时间使用 `timestamptz`，订阅每日发放日期单独使用 `date`。
- 可枚举状态由 CHECK 约束保护。
- JSON 数组/对象使用 `jsonb`，默认分别为 `[]`/`{}`。
- `serve` 启动时执行迁移；应用运行时不建表。

## 账号与会话

### `users`

| 列 | 说明 |
| --- | --- |
| `id`, `email`, `username`, `password_hash`, `avatar_url` | 账号、头像与 bcrypt 密码哈希；email 使用 citext 唯一约束 |
| `bio`, `location`, `website_url` | 用户自填简介、所在地和个人网站；默认空字符串 |
| `role` | 当前普通账号固定为 `user`；`admin` 仅保留给 `00007` 迁移前的兼容记录，不能用于用户端登录 |
| `status` | `active` / `banned` |
| `submission_banned_until` | 画廊禁投截止时间，NULL 表示未禁投 |
| `last_login_at`, `created_at` | 登录与创建时间 |

### `sessions`

保存 `user_id`、唯一 `token_hash`、`expires_at`、IP、User-Agent 和创建时间。删除用户时级联删除；过期记录由 Worker 每小时清理。

### `user_identities`

保存 OAuth identity：`provider`、provider 侧唯一 `subject`、已验证邮箱和绑定用户。当前只创建 GitHub identity；迁移约束仍允许历史 Google identity 留存，但运行时不再提供 Google OAuth。`(provider, subject)` 唯一；删除用户时级联删除。邮箱密码认证不创建 identity，而是直接关联 `users.email`。

### `email_login_codes`

每个邮箱最多一条验证码记录，保存 `register|reset` 用途、HMAC `code_hash`、过期时间、失败次数、请求 IP 和创建时间。HMAC 同时绑定邮箱、用途和验证码，不能跨流程使用。验证码 10 分钟有效，成功后删除；错误次数以行锁和独立提交累积，达到 5 次后锁定。

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

每个用户一行，以 `user_id` 为主键。`balance_cents` 是可用余额，`frozen_cents` 是任务冻结额，两者均有非负 CHECK。

### `wallet_ledger`

| 列 | 说明 |
| --- | --- |
| `kind` | `grant`、`spend`、`freeze`、`release`、`refund`、`admin_adjust` |
| `delta_cents` | 本次对可用余额的变化 |
| `balance_after_cents` | 变化后的可用余额快照 |
| `source_type`, `source_id` | 订单、任务、订阅、兑换码或人工操作来源 |
| `reason`, `created_at` | 原因与发生时间 |

`(kind, source_type, source_id)` 在 `source_id IS NOT NULL` 时唯一，是账务幂等边界。余额更新和账本写入必须处于同一事务。

### `plans`

套餐包含唯一 `code`、名称、`kind`、售价、赠送规则、展示卖点、上架状态与排序：

- `topup`：使用 `grant_cents + bonus_cents` 一次性入账。
- `subscription`：使用 `duration_days` 与 `daily_grant_cents` 创建订阅期。

### `orders`

订单保存用户、套餐和下单时的 `amount_cents`、`grant_cents`、`bonus_cents` 快照。状态为 `pending|paid|completed|failed|expired`；`(provider, provider_order_id)` 对非空 provider order 唯一。订单完成条件更新与入账/开通订阅位于同一事务。

### `subscriptions`

订阅期关联用户、套餐和订单，保存 `starts_at`、`ends_at`、每日发放快照、`last_granted_date` 与 `active|expired` 状态。索引覆盖 `(status, ends_at)` 和用户最近订阅。每日入账幂等来源为 `subscriptionId/YYYY-MM-DD`，日期按北京时间计算。

### `redemption_codes`

兑换码保存唯一明文 `code`、面值、批次、备注、过期时间、创建管理员和兑换用户/时间。`created_by` 外键指向 `admin_accounts`，`redeemed_by` 指向 `users`。状态为 `active|redeemed|disabled`，面值必须大于 0。兑换时以条件 UPDATE 抢占 active 记录，并在同一事务写钱包和 `wallet_ledger`。

## 图片任务

### `tasks`

| 列 | 说明 |
| --- | --- |
| `type` | `t2i`、`coloring`、`ui_design`、`model_sheet`、`game_art`、`puzzle` |
| `model` | 新任务提交时锁定的上游模型；Worker 执行和 API 展示共用该值。迁移前历史任务按迁移时生效配置补齐 |
| `status` | `queued`、`running`、`succeeded`、`failed`、`canceled` |
| `prompt`, `params`, `count` | 生成输入；count 限制为 1 至 4 |
| `input_keys`, `output_keys` | 输入和原图 R2 object key 数组 |
| `thumbnail_keys` | 与原图按索引对应的最长边 512px JPEG 缩略图 key 数组 |
| `cost_cents` | 提交时锁定的费用 |
| `idempotency_key` | 同一用户内唯一的可选提交键 |
| `error_code`, `error_message`, `attempt` | 失败与业务重试信息 |
| `started_at`, `finished_at`, `created_at` | 生命周期时间 |

索引支持用户时间线和状态扫描。任务提交、状态迁移和钱包冻结/结算/释放都使用事务与条件更新。

### `user_assets`

用户个人素材库记录。每行保存所属 `user_id`、标题、原图 `file_key`、512px JPEG `thumbnail_key`、内容类型、原图字节数与创建时间；`(user_id, file_key)` 唯一，删除用户时级联删除记录。API 同时校验 object key 必须属于当前用户的 `uploads/{user_id}/` 前缀，并将每账号素材数量限制为 200 项。删除素材时先删除数据库记录，再尽力删除对应原图和缩略图对象。

## 画廊与通知

### `gallery_categories`

画廊分类包含名称、排序、active 和创建时间。删除分类时投稿的 `category_id` 自动置 NULL。

### `gallery_submissions`

每个任务最多一条投稿（`task_id UNIQUE`）。保存用户、标题、封面/媒体 key、`pending|approved|rejected|removed` 状态、拒绝原因、审核人/时间、精选标记、分类、展示排序及 JSON 标签数组；`reviewed_by` 指向 `admin_accounts`。作品标签最多 20 个，单项不超过 32 个字符，由管理接口统一清洗和去重。索引覆盖状态、精选、分类与用户时间线。

### `notifications` 与 `notification_reads`

通知可属于单个用户，也可在 `user_id IS NULL` 时代表全站通知。个人通知直接使用 `read_at`；全站通知通过 `(user_id, notification_id)` 复合主键表记录每个用户的已读状态。

### `announcements`

公告保存标题、正文、active、生效起止时间和创建时间。公开 API 只返回当前生效内容。

### `changelog_entries`

更新说明保存版本、日期、`feature|experience` 标签、标题、摘要、条目数组、highlight 与排序。

## 提示词库

### `prompt_library`

提示词条保存标题、prompt、任务类型、业务分类、标签、封面 key/远程 URL、排序和 active。同步条目还包含 `source_id`、`source_item_key`；两者非空时组合唯一，手工条目保持空串。

### `prompt_sources`

| 字段组 | 说明 |
| --- | --- |
| 身份 | text `id`、名称、`source_url`、`json|markdown|html` 格式 |
| 导入默认值 | `task_type`、`default_tags` |
| 调度 | `enabled`、`auto_sync_enabled`、间隔分钟、`next_sync_at` |
| 锁 | `sync_lock_token`、`sync_lock_expires_at`，避免并发同步 |
| 状态 | item 数、最近同步时间/耗时/错误和创建时间 |

迁移内置六个来源。代码把这些固定 slug 视为 built-in，可编辑和停用，但不可删除。

## 配置与审计

### `app_settings`

键值为 `key text PRIMARY KEY` + `value jsonb`。迁移写入的种子值：

```text
task_prices               {"t2i":20,"coloring":30,"ui_design":30,"model_sheet":40,"game_art":30,"puzzle":10}
user_max_running_tasks    3
signup_bonus_cents        100
registration_enabled      true
task_models               {"default":"gpt-image-2"}
```

应用层还为未落库配置提供默认值：`free_daily_cents=0`、`submission_enabled=true`、`auto_approve=false`、`daily_limit=0`、`c2a_base_url=""`、`c2a_api_key=""`、`c2a_timeout_secs=0`。后台保存后这些值通过 upsert 写入本表。非空 C2A 数据库配置覆盖环境变量；API Key 的管理接口只回传掩码。

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
