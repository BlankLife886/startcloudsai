# StarClouds AI Server

FastAPI 后端 + arq Worker，实现 `docs/API_CONTRACT.md` 的全部接口。

## 结构

```text
app/
├── main.py            # FastAPI 入口（统一响应、Origin 校验、路由注册）
├── config.py          # pydantic-settings 环境变量（见根目录 .env.example）
├── cli.py             # python -m app.cli create-admin --email x --password y
├── db.py              # async engine / session
├── models.py          # SQLAlchemy 2.0 模型（PostgreSQL / SQLite 兼容）
├── schemas.py         # 请求模型（camelCase alias）
├── serializers.py     # 响应序列化（camelCase）
├── errors.py          # ApiError + 全局 exception handler
├── deps.py            # get_current_user / require_user / require_admin
├── pagination.py      # cursor 分页
├── routers/           # auth, me, tasks, uploads, files, plans, orders, gallery, meta, admin
├── services/          # wallet(账本核心), task_service, order_service, storage(R2),
│                      # c2a_client, prompt_compiler, settings_service, queue, task_runner
└── worker.py          # arq WorkerSettings（run_task + cron）
alembic/               # 迁移（0001 schema，0002 seed app_settings）
tests/                 # pytest（SQLite in-memory，账务核心覆盖）
```

## 本地开发

```bash
uv sync                 # 安装依赖（含 dev）
uv run pytest           # 跑测试
uv run alembic upgrade head   # 需要 DATABASE_URL 指向 PostgreSQL
uv run uvicorn app.main:app --reload
uv run arq app.worker.WorkerSettings
uv run python -m app.cli create-admin --email admin@example.com --password secret
```

## 关键实现说明

- 金额全部整数分（`*_cents` / `*Cents`）。
- 钱包每次变动都伴随 `wallet_ledger` 记录，同一事务；幂等键
  `(kind, source_type, source_id)` partial unique index，冲突即幂等重放。
- 任务状态机 `queued → running → succeeded|failed|canceled`，全部条件
  UPDATE；提交冻结、成功结算（settle）、失败/取消解冻（release）。
- requeue（后台重跑失败任务）不重复扣费：失败时已解冻，重新入队时再次
  冻结同额费用，账本 source_id 用「代数」后缀（`task_id/1`…）避免幂等键冲突。
- Worker 对 chatgpt2api 超时 `C2A_TIMEOUT_SECS`，连接/超时错误重试一次；
  cron 每小时清理过期 session、每 10 分钟回收 running>30min 僵尸任务。
- mock 支付：`POST /api/payments/webhook/mock`，body `{orderId, secret}`，
  secret 为 `APP_SECRET`；或后台 `POST /api/admin/orders/{id}/complete` 补单。
