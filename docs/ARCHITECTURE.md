# 架构说明

## 总览

```mermaid
flowchart LR
  User[用户浏览器] --> GW[nginx gateway]
  Admin[管理员浏览器] --> GW
  GW -->|/| Web[apps/web 静态站]
  GW -->|/admin/| AdminApp[apps/admin 静态站]
  GW -->|/api| Server[FastAPI server]
  Server --> PG[(PostgreSQL)]
  Server --> RD[(Redis)]
  Worker[arq worker] --> RD
  Worker --> PG
  Worker -->|/v1/images/*| C2A[chatgpt2api 已部署实例]
  Worker -->|S3 API| R2[(Cloudflare R2)]
  Server -->|presigned GET| R2
```

## 关键决策

1. **金额一律用整数「分」（cents）存储与计算**，字段后缀 `_cents`。禁止浮点参与账务。
2. **账本先行**：钱包余额的每次变化必须伴随一条 `wallet_ledger` 记录，且入账/扣费在**同一个数据库事务**内完成。幂等靠 `wallet_ledger` 上的唯一约束 `(kind, source_type, source_id)`，冲突时读取已有记录返回，不重复入账。
3. **任务状态机**：`queued → running → succeeded | failed | canceled`。提交时冻结费用（freeze），成功时结算（settle = 释放冻结 + 扣费），失败/取消时全额解冻（release）。所有状态迁移用 `UPDATE ... WHERE status = <旧状态>` 条件更新保证并发安全。
4. **任务执行**：arq（Redis 队列）。Worker 全局并发 `WORKER_CONCURRENCY`（默认 8），单用户同时运行任务数 `USER_MAX_RUNNING_TASKS`（默认 3，提交时校验）。对 chatgpt2api 的调用带超时与一次重试（仅网络类错误重试，生成类错误不重试）。
5. **图片流转**：Worker 从 chatgpt2api 拿 `b64_json` → 直接上传 R2（`tasks/{user_id}/{task_id}/{n}.png`）→ 任务记录仅存 R2 key。前端通过 `GET /api/files/{key}` 获取短期 presigned URL 重定向。输入参考图由前端 `POST /api/uploads` 直传后端、后端写 R2。
6. **鉴权**：HttpOnly Cookie session（随机 token，服务端存 `sessions` 表 hash）。写请求校验 `Origin` 白名单（等效 CSRF 防护）。管理员即 `users.role = 'admin'`，后台与用户端共用登录接口，后台接口额外要求 role。
7. **错误模型**：业务错误抛 `ApiError(code, message, http_status)`，全局 handler 输出 `{"success": false, "code": "...", "error": "..."}`。非 ApiError 才是 500。
8. **配置**：基础设施配置（数据库、Redis、R2、chatgpt2api 地址与 Key、密钥）走环境变量；运营配置（任务单价、每日免费额度、公告等）存 `app_settings` 表，后台可改。

## chatgpt2api 对接

- 文生图：`POST {C2A_BASE_URL}/v1/images/generations`，body `{model, prompt, n, size?, response_format: "b64_json"}`。
- 图生图/编辑（染色、模型图、以图生图等）：`POST {C2A_BASE_URL}/v1/images/edits`，JSON 形式 `{model, prompt, images: [{image_url|b64}], n}`。
- 鉴权：`Authorization: Bearer {C2A_API_KEY}`。
- 模型名默认 `gpt-image-2`，可被 `app_settings.task_types.<type>.model` 覆盖。
- 所有任务类型（t2i / coloring / ui_design / model_sheet / game_art / puzzle）最终都编译为「prompt + 可选参考图」调用上面两个接口；类型差异体现在 prompt 模板与默认参数，集中在 `apps/server/app/services/prompt_compiler.py`。

## 目录约定（apps/server）

```text
app/
├── main.py            # FastAPI 入口
├── config.py          # pydantic-settings 环境变量
├── cli.py             # create-admin 等命令
├── db.py              # engine/session
├── models.py          # SQLAlchemy 模型（单文件，见 DATABASE.md）
├── errors.py          # ApiError + handler
├── deps.py            # 鉴权依赖（current_user / require_admin）
├── routers/           # auth, me, tasks, uploads, files, plans, orders, gallery, notifications, meta, admin/*
├── services/          # wallet, tasks, prompt_compiler, c2a_client, storage(r2), settings
└── worker.py          # arq WorkerSettings + run_task
```

## 部署

单机 Docker Compose；`gateway` 暴露 8080。生产上建议在外层再加一层 HTTPS（Caddy/宝塔/云负载均衡均可）。数据卷：`pg_data`、`redis_data`。R2 为外部服务不落盘。
