# StarCloudsAI · 星空云绘

星空云绘是一个 AI 图像创作与作品社区平台，提供文生图、插画染色、UI 设计稿、超高清模型图、游戏美术和 AI 拼图工作台，并包含共享画廊、提示词库、价格页、兑换码钱包与独立运营后台。价格页和只读套餐展示已恢复；支付、订单创建和套餐购买当前在所有环境中停用。

项目由两个 Vue 3 单页应用和一个 Go 服务组成，生产环境通过 Docker Compose 统一部署。

## 仓库结构

```text
.
├── apps/web/       # 用户端：Vue 3 + Vite + Pinia
├── apps/admin/     # 管理端：Vue 3 + Vite + TypeScript + Element Plus
├── apps/server/    # API 与 Worker：Go + Gin + pgx + Asynq
├── deploy/         # 统一 nginx 网关配置
├── docs/           # 架构、API、数据库与管理端设计规范
└── docker-compose.yml
```

运行时服务：

| 服务 | 职责 |
| --- | --- |
| `gateway` | 唯一入口；`/` 转发用户端，`/admin/` 转发管理端，`/api/` 转发 API |
| `web` | 用户端静态站 |
| `admin` | 管理端静态站 |
| `server` | Gin API；启动时自动执行 Goose 数据库迁移 |
| `worker` | Asynq Worker；执行图片任务和定时维护任务 |
| `postgres` | 业务数据、钱包账本和运营内容 |
| `redis` | Asynq 队列 |

外部依赖为 `chatgpt2api` 图片任务接口和 Cloudflare R2（S3 兼容对象存储）。Worker 使用幂等异步提交和轮询回收图片，避免长连接中断后图片已在上游生成、用户端却无法取得；图片对用户统一通过站内鉴权文件接口交付，不要求用户浏览器能够直接访问 R2。

## Docker 本地启动

前置条件：Docker Desktop 和 `docker compose` 子命令可用。

```bash
cp .env.development.example .env.development
docker compose --env-file .env.development up -d --build
docker compose ps
curl http://localhost:8080/api/health
```

默认地址：

| 入口 | 地址 |
| --- | --- |
| 用户端 | `http://localhost:8080/` |
| 管理端 | `http://localhost:8080/admin/` |
| API 健康检查 | `http://localhost:8080/api/health` |

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

生产和开发必须使用不同环境文件、数据库、Redis、R2 bucket、OAuth 应用和密钥。复制 `.env.example` 为 `.env`，替换数据库密码、`APP_SECRET`、C2A/R2 凭据、OAuth/SMTP 配置与域名后再启动。生产模式会拒绝弱 `APP_SECRET` 或非 HTTPS Origin；登录与兑换限流使用 Redis 共享状态。

```bash
cp .env.example .env
# 编辑 .env 后：
docker compose --env-file .env up -d --build
```

Compose 默认把网关绑定到 `127.0.0.1`。线上必须由宿主机或独立入口网关提供 HTTPS，再反向代理到 `127.0.0.1:8080`；不要把该 HTTP 端口直接映射到公网。只有确认外层 TLS、访问控制和防火墙均已配置时，才调整 `GATEWAY_BIND`。

用户端提供独立的注册、登录和找回密码流程。用户注册时提交用户名、Gmail/Googlemail/QQ 邮箱、6 位邮箱验证码和密码；日常登录使用邮箱与密码；忘记密码时通过邮箱验证码设置新密码。GitHub 一键登录保留，Google 一键 OAuth 已移除，但 Gmail/Googlemail 邮箱仍可正常注册登录。验证码按 `register|reset` 用途绑定。开发环境未配置 SMTP 时响应会包含仅用于本地调试的 `developmentCode`；生产环境绝不会返回验证码。GitHub OAuth 回调地址由 `PUBLIC_BASE_URL` 生成，因此线上、线下 OAuth 应用不能混用。

## 本地开发

推荐 Node.js 22、npm 10+、Go 1.26.5，并准备 PostgreSQL 16/17 与 Redis 7。前端默认把 `/api` 代理到 `http://localhost:8000`。

```bash
# API（自动迁移；环境变量默认连接 localhost）
cd apps/server
go run ./cmd/server serve

# Worker（另一个终端）
cd apps/server
go run ./cmd/server worker

# 用户端：http://localhost:3102
cd apps/web
npm ci
npm run dev

# 管理端：http://localhost:3200/admin/
cd apps/admin
npm ci
npm run dev
```

根目录 `.env` 由 Docker Compose 读取；直接运行 Go 命令时需要在 shell 中导出相应变量。开发环境至少需要可连接的 `DATABASE_URL`、`REDIS_URL`，图片上传和生成还需要有效的 `R2_*`、`C2A_*`。

## 验证

CI 使用 Node.js 22、Go module 中声明的 Go 版本和 PostgreSQL 17，执行以下检查：

```bash
cd apps/server && go vet ./... && go test ./...
cd apps/web && npm ci && npm run check:imports && npm run lint && npm run build
cd apps/admin && npm ci && npm run build
```

用户端还提供图片处理验证脚本。Playwright 配置目前保留了旧 monorepo 启动命令，尚不能作为本仓库的有效测试入口；详见 [apps/web/README.md](apps/web/README.md)。

## 文档索引

- [架构说明](docs/ARCHITECTURE.md)
- [API 契约](docs/API_CONTRACT.md)
- [数据库设计](docs/DATABASE.md)
- [管理端 UI 规范](docs/ADMIN_UI_STYLE.md)
- [用户端首页设计规范](apps/web/DESIGN.md)
- [用户端开发说明](apps/web/README.md)
- [管理端开发说明](apps/admin/README.md)
- [服务端开发说明](apps/server/README.md)
