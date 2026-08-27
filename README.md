# StarCloudsAI · 星空云绘

星空云绘是一个 AI 图像创作与作品社区平台，提供文生图、插画染色、UI 设计稿、超高清模型图、游戏美术和 AI 拼图工作台，并包含共享画廊、提示词库、价格页、兑换码钱包与独立运营后台。价格页和只读套餐展示已恢复；支付、订单创建和套餐购买当前在所有环境中停用。

项目由 React 主站（内置无限画布模块）、Vue 管理端和 Go 服务组成，生产环境通过 Docker Compose 统一部署。

> UI 产品边界：本项目只面向桌面浏览器，最低支持视口为 `1280x720`，不开发或验收手机/平板适配。具体约束见 [桌面端 UI 支持策略](docs/DESKTOP_UI_POLICY.md)。

## 仓库结构

```text
.
├── apps/web-react/ # 用户端与内置无限画布：React 19 + Vite + Zustand
├── apps/admin/     # 管理端：Vue 3 + Vite + TypeScript + Element Plus
├── apps/server/    # API 与 Worker：Go + Gin + pgx + Asynq
├── deploy/         # 统一 nginx 网关配置
├── docs/           # 架构、API、数据库与管理端设计规范
└── docker-compose.yml
```

运行时服务：

| 服务 | 职责 |
| --- | --- |
| `gateway` | 唯一入口；`/`（包含 `/canvas`）转发用户端，`/admin/` 转发管理端，`/api/v1/` 转发 API |
| `web` | 用户端静态站；构建时直接编译无限画布源码，运行时不依赖独立画布服务 |
| `admin` | 管理端静态站 |
| `server` | Gin API；启动时自动执行 Goose 数据库迁移 |
| `worker` | Asynq Worker；执行图片任务和定时维护任务 |
| `postgres` | 业务数据、钱包账本和运营内容 |
| `redis` | Asynq 队列 |

外部依赖包括 `chatgpt2api`/OpenAI 兼容图片服务、Sub2API 对话服务、CRUN 异步图片工具、S3 兼容对象存储（生产推荐阿里云香港 OSS）和 SMTP 邮件服务。Worker 使用幂等异步提交和轮询回收图片，避免长连接中断后图片已在上游生成、用户端却无法取得；私有图片对用户统一通过站内鉴权文件接口交付，不要求用户浏览器能够直接访问对象存储。

## Docker 本地启动

前置条件：Docker Desktop 和 `docker compose` 子命令可用。

```bash
cp .env.development.example .env.development
docker compose --env-file .env.development up -d --build
docker compose ps
curl http://localhost:8080/api/v1/health
```

默认地址：

| 入口 | 地址 |
| --- | --- |
| 用户端 | `http://localhost:8080/` |
| 管理端 | `http://localhost:8080/admin/` |
| API 健康检查 | `http://localhost:8080/api/v1/health` |

创建或更新独立管理员账号。密码只经标准输入传入，不进入 shell 历史或进程参数。后台使用独立的管理员邮箱和密码登录：

```bash
read -rs ADMIN_PASSWORD
printf '%s' "$ADMIN_PASSWORD" | docker compose --env-file .env.development exec -T server \
  /app/server create-admin --email admin@example.com --password-stdin
unset ADMIN_PASSWORD
```

命令会创建或更新管理员密码，并撤销该管理员已有会话。管理员账号只存在于 `admin_accounts`，不会创建普通用户账号或钱包；用户端与后台即使使用相同邮箱，密码和会话也完全独立。

常用运维命令：

```bash
docker compose logs -f server worker
docker compose restart server worker
docker compose up -d --build server worker web admin gateway
docker compose up -d --force-recreate gateway  # 修改 deploy/nginx.conf 后重新加载网关配置
docker compose down             # 保留 PostgreSQL/Redis 数据卷
docker compose down -v          # 删除数据卷；会清空本地业务数据
```

`gateway` 通过 Docker 内置 DNS 动态解析 `server`、`web` 和 `admin`。重建任一应用容器后，网关会自动跟随新容器地址；如果修改的是网关自身配置，则需使用上面的 `--force-recreate gateway` 重新加载配置。局部构建前端时不要遗漏 `admin`，否则后台仍会运行旧静态资源。

## 生产部署

生产和开发必须使用不同环境文件、数据库、Redis、对象存储 bucket 和密钥。复制 `.env.example` 为 `.env`，替换数据库密码、`APP_SECRET`、C2A/对象存储凭据、SMTP 配置与域名后再启动。生产模式会拒绝弱 `APP_SECRET` 或非 HTTPS Origin；登录与兑换限流使用 Redis 共享状态。

```bash
cp .env.example .env
# 编辑 .env 后：
docker compose --env-file .env up -d --build
```

Compose 默认把网关绑定到 `127.0.0.1`。线上必须由宿主机或独立入口网关提供 HTTPS，再反向代理到 `127.0.0.1:8080`；不要把该 HTTP 端口直接映射到公网。只有确认外层 TLS、访问控制和防火墙均已配置时，才调整 `GATEWAY_BIND`。

用户端仅支持 Gmail、Googlemail 和 QQ 邮箱验证码认证。已注册邮箱验证后直接登录，首次验证成功会自动创建账号、钱包与初始积分，并弹出可跳过的资料完善窗口；不提供用户密码或第三方 OAuth 登录。Gmail 点号、加号标签和 Googlemail 地址会规范为同一账号，防止重复注册。开发环境未配置 SMTP 时响应会包含仅用于本地调试的 `developmentCode`；生产环境绝不会返回验证码。

## 本地开发

推荐 Node.js 22、npm 10+、Go 1.26.6，并准备 PostgreSQL 16/17 与 Redis 7。前端默认把 `/api` 代理到 `http://localhost:8000`。

```bash
# API（自动迁移；环境变量默认连接 localhost）
cd apps/server
go run ./cmd/server serve

# Worker（另一个终端）
cd apps/server
go run ./cmd/server worker

# 用户端：http://localhost:3105
cd apps/web-react
npm ci
npm run dev

# 管理端：http://localhost:3200/admin/
cd apps/admin
npm ci
npm run dev
```

根目录 `.env` 由 Docker Compose 读取；直接运行 Go 命令时需要在 shell 中导出相应变量。开发环境至少需要可连接的 `DATABASE_URL`、`REDIS_URL`，图片上传和生成还需要有效的 `OBJECT_STORAGE_*`、`C2A_*`。

## 验证

CI 使用 Node.js 22、Go module 中声明的 Go 版本和 PostgreSQL 17，执行以下检查：

```bash
cd apps/server && go vet ./... && go test ./...
cd apps/web-react && npm ci && npm run typecheck:canvas && npm run test:domain && npm run build
cd apps/admin && npm ci && npm run build
```

用户端还提供 Playwright 交互与视觉回归。`cd apps/web-react && npm run test:e2e` 会启动 React Vite 服务并通过路由拦截提供确定性的登录、模型、历史和商品库数据，不依赖真实图片上游。完整说明见 [apps/web-react/README.md](apps/web-react/README.md)。

## 文档索引

- [本地开发启动手册](docs/LOCAL_DEVELOPMENT.md)
- [生产部署与运维手册](docs/DEPLOYMENT.md)
- [4C8G 一体化部署与 PG18/OSS 迁移手册](docs/INTEGRATED_4C8G_MIGRATION.md)
- [架构说明](docs/ARCHITECTURE.md)
- [API 契约](docs/API_CONTRACT.md)
- [数据库设计](docs/DATABASE.md)
- [全站图片加载与瀑布流滚动性能方案](docs/PROMPT_MASONRY_PERFORMANCE.md)
- [高并发任务稳定性方案](docs/HIGH_CONCURRENCY_TASK_STABILITY.md)
- [Go 性能与实时可观测性](docs/GO_PERFORMANCE_OBSERVABILITY.md)
- [管理端 UI 规范](docs/ADMIN_UI_STYLE.md)
- [桌面端 UI 支持策略](docs/DESKTOP_UI_POLICY.md)
- [用户端迁移与视觉基线记录](apps/web-react/REACT_MIGRATION.md)
- [用户端首页历史设计基线](apps/web-react/DESIGN.md)
- [用户端开发说明](apps/web-react/README.md)
- [管理端开发说明](apps/admin/README.md)
- [服务端开发说明](apps/server/README.md)
