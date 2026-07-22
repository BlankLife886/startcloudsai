# StarCloudsAI Server

服务端使用 Go、Gin、pgx、Goose 和 Asynq。一个二进制提供 `serve`、`worker`、`create-admin` 三个子命令；HTTP API 和 Worker 共用 store、钱包、任务与外部服务实现。

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
├── storage/             # Cloudflare R2 上传、删除、读取与可选预签名
├── store/               # pgx 数据访问、事务和 Goose 迁移
├── subscription/        # 历史订阅数据兼容（当前无支付入口）
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
| 用户认证 | `PUBLIC_BASE_URL`、`GITHUB_CLIENT_*`、`SMTP_*` |
| 数据 | `DATABASE_URL`、`REDIS_URL` |
| 图片上游 | `C2A_BASE_URL`、`C2A_API_KEY`、`C2A_TIMEOUT_SECS` |
| 对象存储 | `R2_ENDPOINT`、`R2_ACCESS_KEY_ID`、`R2_SECRET_ACCESS_KEY`、`R2_BUCKET`、`R2_PRESIGN_EXPIRE_SECS` |
| Worker | `WORKER_CONCURRENCY`、`USER_MAX_RUNNING_TASKS` |

`serve` 还接受 `PORT`，默认 `8000`。生产环境会拒绝短于 32 位或仍为模板值的 `APP_SECRET`。

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
- 任务提交时冻结费用，成功时结算，失败/取消时释放；失败任务重入队会重新冻结同额费用，并使用代数后缀区分账本幂等键。
- Asynq payload 只包含 `task_id`，队列层 `MaxRetry(0)`；同一个业务 ID 也作为 chatgpt2api 异步图片任务的 `client_task_id`。Worker 通过 `/api/image-tasks` 轮询并回收已生成图片，单次轮询遇到网络错误或 408/425/429/5xx 时会在总超时内继续查询。旧上游缺少异步端点时才回退 OpenAI 同步图片接口。
- Worker 启动时会把上一个进程遗留的 `running` 任务恢复为 `queued`，并使用新的 Asynq 恢复记录接管同一个上游任务；不会重新生成或重复扣费。已归档的旧 Asynq TaskID 不会再造成“看似入队成功、实际没有待执行任务”。每 10 分钟也会接管超时的孤儿任务和补投滞留队列。
- Worker 每小时清理过期 session 和超期审计日志，每 30 分钟扫描到期的提示词数据源。
- 用户注册提交用户名、Gmail/Googlemail/QQ 邮箱、6 位注册验证码和 8-72 字节密码；日常登录使用邮箱和密码，忘记密码通过 `reset` 验证码设置新密码。GitHub OAuth 保留，Google OAuth 已移除。验证码绑定 `register|reset` 用途，不能跨流程复用。用户 Cookie 为 `sc_session`，有效期 30 天。
- 管理员使用独立账号、密码和 `sc_admin_session`；不使用管理员密钥。管理员与用户的账号表、密码、会话和 Cookie 均不能交叉访问。
- `create-admin` 只创建或更新 `admin_accounts`，不会创建普通用户或钱包；更新密码时会撤销该管理员的全部旧会话。
- 浏览器写请求校验 `Origin`，代理地址只信任 `TRUSTED_PROXIES`。
- `GET /api/plans` 只读套餐列表已开放；支付、订单创建、webhook 和后台人工补单路由在开发、测试、生产环境均未注册，历史表和内部结算代码仅用于已有数据兼容。
- 数据库中的 C2A API Key 使用 `APP_SECRET` 派生密钥进行 AES-GCM 加密；启动时会自动迁移旧明文值。
- 生产环境的登录与兑换限流保存在 Redis；开发和测试环境使用进程内限流。
- Worker 对每张上游原图同时保存原图和最长边 512px 的 JPEG 缩略图；列表返回站内缩略图 URL，需要查看时再使用站内原图 URL。`GET /api/files/*` 完成权限校验后由 API 代理读取 R2，浏览器不再直接依赖 R2 网络可达性。

完整接口见 [../../docs/API_CONTRACT.md](../../docs/API_CONTRACT.md)，数据模型见 [../../docs/DATABASE.md](../../docs/DATABASE.md)。
