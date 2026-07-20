# StarClouds AI Server

Go 后端（Gin + pgx + Asynq），单二进制多子命令，实现 `docs/API_CONTRACT.md` 的全部接口。

## 结构

```text
cmd/server/main.go       # 入口：serve / worker / create-admin 子命令
internal/
├── config/              # 环境变量加载（见根目录 .env.example）
├── apperr/              # 业务错误类型 + 错误码
├── httpapi/             # Gin 路由与 handler（auth, me, tasks, uploads, files,
│                        # plans, orders, gallery, meta, admin）+ 序列化/分页
├── auth/                # 密码哈希（bcrypt）、session token（sha256）
├── store/               # pgx 连接池 + 各表数据访问（手写 SQL）+ goose 迁移
├── wallet/              # 冻结/结算/解冻/入账（账本幂等，事务）
├── taskflow/            # 任务提交/状态机/Asynq 入队
├── worker/              # Asynq handler：run_task + 定时任务
├── c2a/                 # chatgpt2api 客户端
├── storage/             # R2（S3 兼容）上传/删除/presign
├── prompt/              # 六类任务 prompt 模板
├── settings/            # app_settings 读写
└── testdb/              # 测试用临时库（真实 Postgres）
migrations/              # goose SQL 迁移（embed 进二进制，serve 启动自动执行）
```

## 本地开发

```bash
go build ./...                    # 编译
go test ./...                     # 跑测试（需要本机 Postgres，TEST_DATABASE_URL 可覆盖，
                                  # 默认 postgres://localhost:5432/postgres，自动建/删临时库）
go run ./cmd/server serve         # 启动 API（:8000，自动跑迁移）
go run ./cmd/server worker        # 启动 Asynq worker
go run ./cmd/server create-admin --email admin@example.com --password secret
```

## 关键实现说明

- 金额全部整数分（`*_cents` / `*Cents`）；JSON 输出 camelCase，null 字段输出 null。
- 钱包每次变动都伴随 `wallet_ledger` 记录，同一事务；幂等键
  `(kind, source_type, source_id)` partial unique index，冲突（SQLSTATE 23505）即幂等重放。
- 任务状态机 `queued → running → succeeded|failed|canceled`，全部条件
  UPDATE；提交冻结、成功结算（settle）、失败/取消解冻（release）。
- requeue（后台重跑失败任务）不重复扣费：失败时已解冻，重新入队时再次
  冻结同额费用，账本 source_id 用「代数」后缀（`task_id/1`…）避免幂等键冲突。
- Asynq：payload 只放 task_id，`MaxRetry(0)`（业务层自控重试）；Worker 对
  chatgpt2api 连接/超时错误重试一次（attempt+1 落库）；PeriodicTaskManager
  每小时清理过期 session、每 10 分钟回收 running>30min 僵尸任务。
- mock 支付：`POST /api/payments/webhook/mock`，body `{orderId, secret}`，
  secret 为 `APP_SECRET`；或后台 `POST /api/admin/orders/{id}/complete` 补单。
- 鉴权：HttpOnly Cookie `sc_session`（sha256 存库，30 天滑动续期）；写请求
  校验 `Origin` 白名单（`ALLOWED_ORIGINS`）。
