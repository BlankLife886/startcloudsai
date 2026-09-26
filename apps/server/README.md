# StarCloudsAI Server

服务端使用 Go、Gin、pgx、Goose 和 Asynq。一个二进制提供 `serve`、`worker`、`create-admin`、`check-worker`、`seed` 五个子命令；HTTP API 和 Worker 共用 store、钱包、任务与外部服务实现。`check-worker` 用于 Worker 健康检查，`seed` 会先执行迁移再补齐内置内容，不能作为无副作用的检查命令。

文档基线：2026-09-22 当前工作区（包含未提交实现），不表示已部署或完成本轮运行测试。服务端关键边界见 [当前服务端行为](../../docs/SERVER_CURRENT_STATE.md)。

## 目录

```text
cmd/server/main.go       # 子命令入口与优雅停机
internal/
├── apperr/              # HTTP 业务错误与错误码
├── auth/                # 管理员 bcrypt、session、登录/兑换限流
├── c2a/                 # chatgpt2api 图片客户端
├── config/              # 环境变量加载与生产密钥校验
├── httpapi/             # Gin 路由、handler、鉴权、审计、序列化、分页
├── prompt/              # 六类图片任务 prompt 编译
├── promptsync/          # JSON/Markdown/HTML 提示词源同步
├── redemption/          # 兑换码生成与兑换
├── settings/            # app_settings 读写
├── storage/             # S3 兼容对象存储上传、列举、删除、读取与预签名
├── store/               # pgx 数据访问、事务和 Goose 迁移
├── subscription/        # 订阅发放、升级、退款与历史周期兼容
├── assistantbilling/    # 助手运行冻结、结算、取消与重试
├── assistantprice/      # 助手对话/Agent 价格计算
├── modelconfig/         # 服务商、路由、模型能力与价格目录
├── contractpricing/     # 订阅合同锁价与批次资格
├── taskflow/            # 提交、状态机、计费与 Asynq 入队
├── testdb/              # 基于真实 PostgreSQL 的临时测试库
├── wallet/              # 冻结、结算、释放与入账
└── worker/              # 图片任务和周期任务
migrations/              # 内嵌 Goose SQL 迁移
scripts/                 # 运维/回填 SQL
```

## 配置

配置项定义在 `internal/config/config.go`，示例见仓库根目录 `.env.example`。

| 类别 | 变量 |
| --- | --- |
| 应用 | `APP_ENV`、`APP_SECRET`、`ALLOWED_ORIGINS`、`TRUSTED_PROXIES` |
| 用户认证 | `SMTP_*`、`DEV_LOGIN_CODE_ECHO`（默认 false，仅开发环境且未配置 SMTP 时允许回显） |
| 蓝鲸支付 | `LANJING_PAY_BASE_URL`、`LANJING_PAY_SECRET`、`LANJING_PAY_NOTIFY_URL`、`LANJING_PAY_TIMEOUT_SECS` |
| 数据 | `DATABASE_URL`、`REDIS_URL`、`DB_MAX_CONNS`、`DB_MIN_CONNS`、`DB_MAX_CONN_LIFETIME`、`DB_MAX_CONN_IDLE_TIME`、`DB_HEALTH_CHECK_PERIOD` |
| 图片上游 | `C2A_BASE_URL`、`C2A_API_KEY`、`C2A_TIMEOUT_SECS` |
| 对话与生图工作区 | `SUB2API_BASE_URL`、`SUB2API_API_KEY`、`SUB2API_CHAT_MODEL`、`SUB2API_IMAGE_MODEL` |
| CRUN 异步生图 | `CRUN_BASE_URL`、`CRUN_API_KEY`、`CRUN_TIMEOUT_SECS` |
| 对象存储 | `OBJECT_STORAGE_ENDPOINT`、`OBJECT_STORAGE_PUBLIC_ENDPOINT`、`OBJECT_STORAGE_REGION`、`OBJECT_STORAGE_ACCESS_KEY_ID`、`OBJECT_STORAGE_SECRET_ACCESS_KEY`、`OBJECT_STORAGE_BUCKET`、`OBJECT_STORAGE_USE_PATH_STYLE`、`OBJECT_STORAGE_PRESIGN_EXPIRE_SECS` |
| 上传安全（可选） | `UPLOAD_CLAMAV_ADDR`、`UPLOAD_REVIEW_URL`、`UPLOAD_REVIEW_KEY`、`UPLOAD_SCAN_TIMEOUT` |
| Worker | `WORKER_CONCURRENCY`（图片侧物理槽位）、`WORKER_CHAT_CONCURRENCY`（对话池，默认 32）、`WORKER_POLL_CONCURRENCY`（0 表示自动推导）、`WORKER_IMAGE_MEMORY_MIB`；业务并发在后台实时配置 |
| 诊断 | `API_PPROF_ADDR`、`WORKER_PPROF_ADDR`（仅允许回环地址） |

`serve` 还接受 `PORT`，默认 `8000`。生产环境会拒绝短于 32 位或仍为模板值的 `APP_SECRET`。

上表的对话池 32 是 Go 直接启动时未配置变量的默认值；根目录和一体化 Compose 以及 `.env.example` 当前默认设为 8。实际并发应以启动环境为准，并同时核对全局对话和 Agent 限额，不能仅按 Go 缺省值估算可用槽位。

蓝鲸支付可在管理后台的系统设置中配置启用状态、网关地址、通讯密钥、异步通知地址、超时及支付宝/微信渠道。后台值优先于环境变量并按请求热生效；环境变量仅作为未配置后台值时的兜底。通讯密钥使用 `APP_SECRET` 派生密钥进行 AES-GCM 加密，读取时只返回末四位掩码。通知地址必须是支付平台可访问的 HTTPS 地址，并指向 `GET /api/v1/payments/lanjing/notify`。后台“测试连接”调用蓝鲸 `/getState`，不会创建支付订单。

管理端通过 `GET /api/v1/admin/system/metrics` 查看 API、Runtime、连接池、队列和 Worker 实时指标。完整采集、pprof、Race Detector、Benchmark 与 PGO 流程见 [Go 性能与实时可观测性](../../docs/GO_PERFORMANCE_OBSERVABILITY.md)。

## 本地运行

需要 PostgreSQL 和 Redis。直接运行时不会自动读取仓库根 `.env`，请先导出变量。

```bash
go build ./...
go vet ./...
go test ./...
go run ./cmd/server serve
go run ./cmd/server worker
printf '%s' "$ADMIN_PASSWORD" | go run ./cmd/server create-admin --email admin@example.com --password-stdin
```

`create-admin` 会创建或更新独立管理员账号并撤销该管理员的旧会话。命令只输出操作结果，不生成任何管理员密钥；管理员通过邮箱和密码登录后台。

测试默认连接 `postgres://localhost:5432/postgres`，自动创建并删除临时数据库；用 `TEST_DATABASE_URL` 覆盖。运行测试的数据库用户必须具有 `CREATE DATABASE` 权限。

## 核心行为

- `serve` 先执行内嵌 Goose 迁移，再启动 Gin，并在 SIGINT/SIGTERM 时最多等待 30 秒完成在途请求。
- 钱包和 `wallet_ledger` 在同一事务中更新；`(kind, source_type, source_id)` 唯一索引提供幂等保护。
- 任务提交时冻结费用，成功按交付结算，最终失败释放未使用预留；尚未提交上游的取消可退款，已提交后的停止须确认费用后果，以响应 `cancelPolicy` 和实际结算为准。失败重试重新检查价格与资金资格，并用代数后缀区分账本幂等键。
- Asynq payload 只包含 `task_id`，队列层 `MaxRetry(0)`；同一个业务 ID 也作为 chatgpt2api 异步图片任务的 `client_task_id`。Worker 通过 `/api/image-tasks` 轮询并回收已生成图片，单次轮询遇到网络错误或 408/425/429/5xx 时会在总超时内继续查询。旧上游缺少异步端点时才回退 OpenAI 同步图片接口。
- Worker 启动时恢复租约已过期的 `running` 任务和滞留队列，并使用恢复记录接管原上游任务；活租约仍受保护。每 2 分钟回收超时孤儿任务并补投滞留队列，每分钟补齐上游轮询。已知任务优先按原身份回收，未知受理结果遵守保护策略，不能保证任意上游都支持安全重发。
- Worker 每小时清理过期 session、超期审计日志和无引用普通上传对象，每 30 分钟扫描提示词源；每分钟尝试低负载对象清理、订阅发放、活动到期与告警评估，每 15 秒派发助手 outbox、文档解析及 API Webhook。周期触发不等于每次必然清理或发送，仍受租约、引用与负载条件约束。
- 用户端仅支持 Gmail、Googlemail、QQ 邮箱验证码认证。`POST /api/v1/auth/session` 会在同一事务内验证验证码，并为首次邮箱自动创建用户、钱包、初始积分和 session；已有用户直接创建 session。Gmail 点号、加号标签和 Googlemail 地址统一规范化。不提供用户密码或第三方 OAuth 登录。用户 Cookie 为 `sc_session`，有效期 30 天。
- `GET /api/v1/me/sessions` 只返回当前用户的有效登录设备摘要，不返回 Cookie 或令牌；可通过 `DELETE /api/v1/me/sessions/{id}` 撤销指定本人会话，或通过 `DELETE /api/v1/me/sessions?scope=others` 保留当前会话并撤销其他设备。
- `GET /api/v1/me/data-export` 返回当前用户可携带的 JSON 数据副本，覆盖账号资料、交易、创作、AI 对话、素材元数据、投稿、反馈和社区安全记录；密码、会话凭证、内部风控信息及图片二进制不会进入导出文件。
- 社区作品支持登录用户通过 `POST /api/v1/gallery/submissions/{id}/reports` 幂等举报，并通过 `POST /api/v1/gallery/users/{id}/block` 屏蔽作者；公开画廊会为登录用户自动过滤其已屏蔽作者，匿名画廊保持公开数据不变。用户可通过 `GET /api/v1/me/blocked-users` 分页管理屏蔽列表，并以 `DELETE /api/v1/gallery/users/{id}/block` 幂等解除。
- `DELETE /api/v1/me/account` 必须在已登录会话中再次验证当前邮箱验证码；成功后匿名化账号身份、清理所有会话和 API 凭证、隐藏公开投稿并释放原邮箱。进行中的创作或助手任务会阻止注销，订单与必要安全记录仅保留匿名关联。
- 管理员使用独立账号、密码和 `sc_admin_session`；不使用管理员密钥。管理员与用户的账号表、密码、会话和 Cookie 均不能交叉访问。
- `create-admin` 只创建或更新 `admin_accounts`，不会创建普通用户或钱包；更新密码时会撤销该管理员的全部旧会话。
- 浏览器写请求校验 `Origin`，代理地址只信任 `TRUSTED_PROXIES`。
- `GET /api/v1/plans` 返回可售套餐与当前可用支付渠道；蓝鲸支付配置完整并启用后，订单创建、状态查询、关闭及异步通知路由可用。创建订单时保存上游实际应付金额和支付渠道快照，查单、回调与后台对账必须与该快照一致；支付完成复用钱包账本幂等约束，重复通知不会重复入账。
- `/api/v1/assistant/runs` 使用后台模型与服务商配置执行对话、生图、Agent 和可编辑文件任务，浏览器不会取得上游 Key。助手运行已有独立钱包冻结、结算、释放与成本记录；旧免费直连 `/assistant/chat` 和 `/assistant/images` 不再注册。
- `/api/open/v1/tasks` 复用持久任务、队列、存储及 Webhook；`/v1/images/*` 是标准图片直通接口，只保存鉴权、用量和账务，不创建站内图片任务或保存图片对象。`/v1/responses` 提供有限的对话、流式与图片工具兼容，不能当作完整 OpenAI 协议。
- AI 助手识别明确的 PPT/PSD 制作请求后，会通过 ChatGPT2API 的 `/v1/editable-file-tasks` 异步生成主文件和素材 ZIP；结果完成格式校验后写入本站对象存储并绑定用户消息。PSD 必须先上传 JPG、PNG 或 WebP 参考图，PSD 文件本身不作为输入附件。
- 数据库中的 C2A API Key 使用 `APP_SECRET` 派生密钥进行 AES-GCM 加密；启动时会自动迁移旧明文值。
- 生产环境的登录与兑换限流保存在 Redis；开发和测试环境使用进程内限流。
- 站内生成图片保存原图与配置驱动的小图/展示图，当前变体默认 WebP、缩略图最长边 512、展示图最长边 2048；特殊透明或工具输出按实现处理。普通上传登记业务引用，超过 7 天仍无引用的对象可由 Worker 回收。`GET /api/v1/files/*` 完成权限校验后代理读取配置的对象存储。标准 `/v1/images/*` 不经过本站图片持久化链路。

完整接口见 [../../docs/API_CONTRACT.md](../../docs/API_CONTRACT.md)，数据模型见 [../../docs/DATABASE.md](../../docs/DATABASE.md)。
