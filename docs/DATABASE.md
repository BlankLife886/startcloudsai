# 数据库设计（PostgreSQL）

原则：金额整数分；每张表 `created_at timestamptz default now()`；主键 uuid（`gen_random_uuid()`）；所有状态列建 CHECK 约束；迁移用 Alembic，禁止运行时建表。

## users

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| email | citext UNIQUE NOT NULL | |
| username | text NOT NULL | 默认取邮箱前缀 |
| password_hash | text NOT NULL | bcrypt |
| avatar_url | text | |
| role | text CHECK in ('user','admin') DEFAULT 'user' | |
| status | text CHECK in ('active','banned') DEFAULT 'active' | |
| last_login_at | timestamptz | |

## sessions

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK users ON DELETE CASCADE | |
| token_hash | text UNIQUE NOT NULL | sha256(token) |
| expires_at | timestamptz NOT NULL | 30 天滑动 |
| ip / user_agent | text | |

索引：`(user_id)`，过期清理由 worker 定时任务执行。

## wallets

| 列 | 类型 | 说明 |
| --- | --- | --- |
| user_id | uuid PK FK users | 注册时同事务创建 |
| balance_cents | bigint NOT NULL DEFAULT 0 CHECK (balance_cents >= 0) | 可用余额 |
| frozen_cents | bigint NOT NULL DEFAULT 0 CHECK (frozen_cents >= 0) | 冻结中 |
| updated_at | timestamptz | |

冻结：`UPDATE wallets SET balance_cents = balance_cents - :x, frozen_cents = frozen_cents + :x WHERE user_id=:u AND balance_cents >= :x`，rowcount=0 即余额不足。

## wallet_ledger

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK | |
| kind | text CHECK in ('grant','spend','freeze','release','refund','admin_adjust') | |
| delta_cents | bigint NOT NULL | 对可用余额的变化量（冻结为负、解冻为正等） |
| balance_after_cents | bigint NOT NULL | 变更后可用余额 |
| source_type | text NOT NULL | 'order' / 'task' / 'admin' / 'signup_bonus'... |
| source_id | text | 关联单据 id |
| reason | text | |

约束：`UNIQUE (kind, source_type, source_id)`（source_id 非空时，用 partial unique index）。**入账/扣费与余额更新必须同一事务**；唯一约束冲突 = 幂等重放，读取已有记录返回成功。

## plans

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| code | text UNIQUE | |
| name | text | |
| kind | text CHECK in ('topup','subscription') DEFAULT 'topup' | 充值包 / 订阅 |
| price_cents | bigint | 售价 |
| grant_cents | bigint | topup：立即入账金额；subscription：0 |
| bonus_cents | bigint DEFAULT 0 | topup 赠送 |
| duration_days | int DEFAULT 0 | subscription：订阅时长（天） |
| daily_grant_cents | bigint DEFAULT 0 | subscription：每日发放额度 |
| features | jsonb DEFAULT '[]' | 展示用卖点 |
| active | boolean DEFAULT true | |
| sort | int DEFAULT 0 | |

## subscriptions（订阅期）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK | |
| plan_id | uuid FK plans | |
| order_id | uuid FK orders | 开通/续期订单 |
| starts_at / ends_at | timestamptz | 续购同套餐 = ends_at 顺延 |
| daily_grant_cents | bigint | 开通时快照 |
| last_granted_date | date | 上次发放日（北京时间日界） |
| status | text CHECK in ('active','expired') DEFAULT 'active' | |

索引：`(status, ends_at)`、`(user_id, ends_at desc)`。每日发放 ledger 幂等键 `('grant','subscription_daily', subscriptionId/YYYY-MM-DD)`。Worker @every 10m 扫描发放并回收过期。

## orders

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK | |
| plan_id | uuid FK plans | |
| amount_cents | bigint | 下单时快照 |
| grant_cents / bonus_cents | bigint | 下单时快照 |
| status | text CHECK in ('pending','paid','completed','failed','expired') DEFAULT 'pending' | |
| provider | text | 'mock' / 'stripe' ... |
| provider_order_id | text | |
| paid_at / completed_at | timestamptz | |

索引：`(user_id, created_at desc)`、`(status)`、`UNIQUE (provider, provider_order_id)`（非空时）。完成流程：`UPDATE orders SET status='completed' WHERE id=:id AND status IN ('pending','paid')` → rowcount=1 才入账（ledger 幂等键 `('grant','order',order_id)` 双保险）。

## tasks

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK | |
| type | text CHECK in ('t2i','coloring','ui_design','model_sheet','game_art','puzzle') | |
| status | text CHECK in ('queued','running','succeeded','failed','canceled') DEFAULT 'queued' | |
| prompt | text | |
| params | jsonb DEFAULT '{}' | 类型专属参数（尺寸、风格等） |
| count | int DEFAULT 1 CHECK (1<=count AND count<=4) | |
| input_keys | jsonb DEFAULT '[]' | R2 keys |
| output_keys | jsonb DEFAULT '[]' | |
| cost_cents | bigint NOT NULL | 冻结金额 |
| idempotency_key | text | `UNIQUE (user_id, idempotency_key)`（非空时） |
| error_code / error_message | text | |
| attempt | int DEFAULT 0 | |
| started_at / finished_at | timestamptz | |

索引：`(user_id, created_at desc)`、`(status, created_at)`。
状态迁移全部条件更新：领取 `queued→running`、完成 `running→succeeded/failed`、取消 `queued→canceled`。
计费：提交时 freeze；成功 settle（`frozen -= cost`，ledger kind=spend）；失败/取消 release（`frozen -= cost, balance += cost`，ledger kind=release）。ledger 幂等键 `(kind,'task',task_id)`。

## gallery_submissions

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK | |
| task_id | uuid FK tasks | `UNIQUE (task_id)` |
| title | text | |
| status | text CHECK in ('pending','approved','rejected','removed') DEFAULT 'pending' | |
| cover_key | text | 取任务第一张产物 |
| media_keys | jsonb | 投稿时快照 |
| reject_reason | text | |
| reviewed_by | uuid FK users | |
| reviewed_at | timestamptz | |

索引：`(status, created_at desc)`。

## notifications

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| user_id | uuid FK，NULL = 全站公告 | |
| kind | text DEFAULT 'system' | 'system' / 'task' / 'order' / 'announcement' |
| title / body | text | |
| read_at | timestamptz | 公告的已读用 notification_reads 表 |

## notification_reads

`(user_id, notification_id)` 复合主键，记录用户对全站公告的已读。

## announcements

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| title / body | text | |
| active | boolean DEFAULT true | |
| starts_at / ends_at | timestamptz | |

## changelog_entries

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| version | text | |
| date | date | |
| tag | text CHECK in ('feature','experience') | |
| title / summary | text | |
| items | jsonb DEFAULT '[]' | |
| highlight | boolean DEFAULT false | |
| sort | int | |

## redemption_codes（兑换码）

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| code | text UNIQUE NOT NULL | `SC-XXXX-XXXX-XXXX`，字符集去易混 0O1IL |
| grant_cents | bigint CHECK (> 0) | 面值 |
| batch_id | text NOT NULL | 生成批次 |
| note | text | |
| status | text CHECK in ('active','redeemed','disabled') DEFAULT 'active' | 过期在兑换时判定 |
| expires_at | timestamptz | NULL = 永久有效 |
| redeemed_by | uuid FK users | |
| redeemed_at | timestamptz | |
| created_by | uuid FK users | 生成的管理员 |

索引：`(batch_id)`、`(status, created_at desc)`。兑换 = 条件更新 + 钱包入账同事务，ledger 幂等键 `('grant','redeem_code',code_id)`。

## admin_audit_logs

| 列 | 类型 | 说明 |
| --- | --- | --- |
| id | uuid PK | |
| admin_id | uuid FK users | |
| admin_email | text | 快照 |
| method / path | text | |
| action | text | 从 method+path 归纳，如 `plans.create` |
| target_id | text | 路径中的资源 id（如有） |
| status | int | 响应状态码 |
| ip | text | |
| detail | jsonb | 请求体摘要（敏感字段脱敏） |

索引：`(created_at desc)`、`(admin_id, created_at desc)`。

## app_settings

| 列 | 类型 | 说明 |
| --- | --- | --- |
| key | text PK | 如 'task_prices'、'user_max_running_tasks'、'signup_bonus_cents'、'registration_enabled' |
| value | jsonb | |
| updated_at | timestamptz | |

默认值由 Alembic seed 迁移写入：

```json
task_prices = {"t2i": 20, "coloring": 30, "ui_design": 30, "model_sheet": 40, "game_art": 30, "puzzle": 10}
user_max_running_tasks = 3
signup_bonus_cents = 100
registration_enabled = true
task_models = {"default": "gpt-image-2"}
```
