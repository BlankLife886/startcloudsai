# StarCloudsAI · 星空云绘

星空云绘是一个 AI 图像创作与作品社区平台，提供文生图、插画染色、设计工作台、模型设定图、游戏美术、AI 电商、拼图、AI 助手和无限画布，并包含技能库、个人素材库、共享画廊、提示词库、钱包、充值与订阅，以及独立运营后台。

项目由 React 主站（内置无限画布模块）、Vue 管理端、Go API/Worker 和独立 Flutter App 组成。网站服务通过 Docker Compose 部署，移动端独立构建和发布。支付、模型调用、开发者 API 等能力受后台配置和凭据控制；源码有入口不代表某个环境已开放。

> 文档基准：2026-09-22 当前工作区，包含尚未提交的改动，不代表生产部署状态。完整文档与历史记录见 [文档索引](docs/README.md)。Web 主站和管理端面向桌面浏览器，最低支持视口为 `1280x720`；独立 Flutter App 不受此 Web 适配限制，见 [桌面端 UI 支持策略](docs/DESKTOP_UI_POLICY.md)。

## 仓库结构

```text
.
├── apps/web-react/ # 用户端与内置无限画布：React 19 + Vite + Zustand
├── apps/admin/     # 管理端：Vue 3 + Vite + TypeScript + Element Plus
├── apps/server/    # API 与 Worker：Go + Gin + pgx + Asynq
├── apps/mobile/    # 独立移动端：Flutter + Riverpod + Dio
├── deploy/         # nginx、候选发布、一体化 PG18/C2A 部署与迁移脚本
├── scripts/        # 网站打包、维护发布、隔离支付/任务验证脚本
├── examples/       # 开放 API 调用与画布工作流示例
├── docs/           # 架构、API、数据库与管理端设计规范
└── docker-compose.yml
```

运行时服务：

| 服务 | 职责 |
| --- | --- |
| `gateway` | 唯一入口；`/`（包含 `/canvas`）转发用户端，`/admin/` 转发管理端，`/api/`、`/v1`、`/oauth/` 与 OAuth 发现路径转发 API |
| `web` | 用户端静态站；构建时直接编译无限画布源码，运行时不依赖独立画布服务 |
| `admin` | 管理端静态站 |
| `server` | Gin API；启动时自动执行 Goose 数据库迁移 |
| `worker` | Asynq Worker；执行图片、对话、附件处理、结果回收和定时维护任务 |
| `postgres` | 业务数据、钱包账本和运营内容 |
| `redis` | Asynq 队列 |

外部依赖包括 `chatgpt2api`/OpenAI 兼容模型服务、Sub2API 对话服务、CRUN 图片工具、S3 兼容对象存储（部署示例使用阿里云香港 OSS）、SMTP 邮件和可选蓝鲸支付。站内创作由 Worker 异步执行，私有图片通过站内鉴权文件接口交付。一体化 Compose 额外部署 ChatGPT2API，并使用 PostgreSQL 18；根 Compose 使用 PostgreSQL 17。

开发者接口有两条不同链路：`/api/open/v1/tasks` 复用站内任务、队列与文件持久化；标准 `/v1/images/generations` 和 `/v1/images/edits` 在鉴权计费后直接请求配置的 OpenAI 兼容上游，不创建站内任务，也不保存输入、输出图片。Responses 支持的子集见 [开放 API 文档](docs/OPEN_API.md)。

## Docker 本地启动

前置条件：Docker Desktop 和 `docker compose` 子命令可用。

```bash
cp .env.development.example .env.development
docker compose --env-file .env.development up -d --build
docker compose --env-file .env.development ps
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
docker compose --env-file .env.development logs -f server worker
docker compose --env-file .env.development restart server worker
docker compose --env-file .env.development up -d --build server worker web admin gateway
docker compose --env-file .env.development up -d --force-recreate gateway
docker compose --env-file .env.development down  # 保留 PostgreSQL/Redis 数据卷
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

用户端仅支持 Gmail、Googlemail 和 QQ 邮箱验证码认证。已注册邮箱验证后直接登录，首次验证成功会自动创建账号、钱包与初始积分，并弹出可跳过的资料完善窗口；不提供用户密码或第三方 OAuth 登录。Gmail 点号、加号标签和 Googlemail 地址会规范为同一账号。开发环境必须显式设置 `DEV_LOGIN_CODE_ECHO=true` 才能使用响应中的调试验证码；生产环境强制关闭回显。`/oauth/*` 用于外部图片技能授权，不是用户第三方登录。

升级现有环境前先审阅迁移。当前包含 `00154_drop_user_skill_bindings.sql`，会删除旧技能装载关系；其 Down 只重建空表，不恢复旧记录。旧实例仍使用该表时不能先启动共享生产库的候选 API。按 [维护窗口部署](docs/MAINTENANCE_RELEASE.md) 协调升级，只有确认新旧 Schema/执行协议兼容后才使用蓝绿流程。

## 本地开发

网站开发使用 Node.js 22、npm 10+、Go 1.26.6，并准备 PostgreSQL 与 Redis 7。根 Compose/CI 使用 PostgreSQL 17，一体化 Compose 使用 18。前端默认把 `/api` 代理到 `http://localhost:8000`，主站还代理 `/v1`、`/oauth` 和 `/.well-known`。

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

根目录环境文件由 Docker Compose 按所选参数读取；直接运行 Go 命令时需要在 shell 中导出相应变量，步骤见 [本地开发](docs/LOCAL_DEVELOPMENT.md)。API/Worker 使用相同数据库、Redis 和对象存储。实际生成还需在后台配置可用模型、服务商、价格和上游凭据。移动端运行与验证见 [移动端说明](apps/mobile/README.md)。

## 验证

以下是网站主要检查入口，分别在对应应用目录执行：

```bash
cd apps/server && go vet ./... && go test ./...
cd apps/web-react && npm ci && npm run typecheck:canvas && npm run test:domain && npm run build
cd apps/admin && npm ci && npm run build
```

CI 还执行 Go race/安全扫描、前端依赖审计、画布工作流与 Agent 回归、后台任务展示测试、Flutter 格式/分析/测试/Android debug 构建，以及仓库和镜像安全扫描。准确命令见 [.github/workflows/ci.yml](.github/workflows/ci.yml)，不是本次文档更新的测试通过声明。

用户端另有 Playwright 交互与视觉回归；多数用例拦截 API，后台及真实链路用例有各自前置条件。完整说明见 [apps/web-react/README.md](apps/web-react/README.md)。

## 文档索引

- [完整文档索引与维护基准](docs/README.md)
- [本地开发启动手册](docs/LOCAL_DEVELOPMENT.md)
- [生产部署与运维手册](docs/DEPLOYMENT.md)
- [4C8G 一体化部署与 PG18/OSS 迁移手册](docs/INTEGRATED_4C8G_MIGRATION.md)
- [旧服务器到新服务器的数据迁移](docs/PRODUCTION_DATA_MIGRATION.md)
- [架构说明](docs/ARCHITECTURE.md)
- [API 契约](docs/API_CONTRACT.md)
- [开放 API 与 Webhook 接入](docs/OPEN_API.md)
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
