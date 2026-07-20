# StarCloudsAI · 星空云绘

星空云绘是一个 AI 图像创作平台：文生图、插画染色、UI 设计稿、超高清模型图、游戏美术素材与 AI 拼图，配套共享画廊、套餐钱包与个人中心。

本仓库是对旧项目 walleven 的重构版本：

- 移除 Wallhaven 壁纸浏览与 OpenAI 中转站（AI Gateway）能力。
- 图片生成统一对接自部署的 [chatgpt2api](https://github.com/yukkcat/chatgpt2api)（OpenAI 兼容接口）。
- 后端从 Cloudflare Worker 重写为 Go（Gin + Asynq）+ PostgreSQL + Redis，Docker 统一部署。
- 文件存储使用 Cloudflare R2（S3 兼容接口，新建 bucket）。
- 后台重写为轻量管理端。

## 架构

```text
.
├── apps/web/       # 用户端（Vue 3 + Vite）
├── apps/admin/     # 轻量后台（Vue 3 + Vite）
├── apps/server/    # 后端（Go：Gin + pgx + Asynq Worker）
├── deploy/         # nginx 网关配置
├── docs/           # 架构、API 契约、数据库设计
└── docker-compose.yml
```

运行时组件：

| 服务 | 说明 |
| --- | --- |
| `gateway` | nginx：`/` 用户端、`/admin/` 后台、`/api` 反代后端 |
| `server` | Go API 服务（Gin，启动时自动执行数据库迁移） |
| `worker` | Asynq 任务 Worker，调用 chatgpt2api 出图并写入 R2 |
| `postgres` | 主数据库 |
| `redis` | 任务队列 + 缓存 |

## 用户端保留页面

首页、文生图、插画染色、UI 设计稿、超高清模型图、游戏设计、AI 拼图、画廊、价格（重做）、更新说明、应用空间、个人中心（重做）。

## 快速开始

```bash
cp .env.example .env   # 填写 chatgpt2api 地址/Key、R2 凭据、密钥
docker compose up -d --build
```

- 用户端：`http://localhost:8080`
- 后台：`http://localhost:8080/admin/`
- API：`http://localhost:8080/api`

初始化管理员（首次部署后执行一次）：

```bash
docker compose exec server /app/server create-admin --email admin@example.com --password <密码>
```

## 本地开发

```bash
# 后端 API（自动执行迁移）
cd apps/server && go run ./cmd/server serve
# Worker
cd apps/server && go run ./cmd/server worker
# 用户端
cd apps/web && npm install && npm run dev
# 后台
cd apps/admin && npm install && npm run dev
```

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [API 契约](docs/API_CONTRACT.md)
- [数据库设计](docs/DATABASE.md)
