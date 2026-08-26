# 本地开发启动手册

本文说明如何在 macOS 上以源码模式启动 StarCloudsAI。源码模式包含四个常驻进程：Go API、Go Worker、React 用户端和 Vue 管理端；PostgreSQL 与 Redis 使用 Homebrew 服务。

## 访问地址

| 服务 | 地址 |
| --- | --- |
| 用户端 | `http://127.0.0.1:3105` |
| 管理后台 | `http://127.0.0.1:3200/admin/` |
| API | `http://127.0.0.1:8000` |
| API 健康检查 | `http://127.0.0.1:8000/api/v1/health` |

## 前置条件

- Homebrew
- PostgreSQL 16
- Redis
- Go（版本以 `apps/server/go.mod` 为准）
- Node.js 22 与 npm
- 仓库根目录存在本地 `.env`，且不提交到 Git
- 用户端和管理端已经执行过 `npm ci`

源码模式不需要 Docker Desktop。Docker Compose 模式与本文的源码模式是两套独立运行方式，日常开发时选择其中一种，避免重复启动 API 和 Worker。

## 1. 启动数据服务

PostgreSQL 与 Redis 通常只需启动一次，之后会随 macOS 登录自动运行：

```bash
brew services start postgresql@16
brew services start redis
```

检查连接：

```bash
pg_isready -h 127.0.0.1 -p 5432
redis-cli -h 127.0.0.1 -p 6379 ping
```

正常输出分别包含：

```text
accepting connections
PONG
```

如果 Docker Desktop 已启动并自动拉起了 Compose 应用容器，可以在仓库根目录停止它们以释放内存。该命令不会删除数据卷：

```bash
docker compose stop gateway worker server web admin postgres redis
```

严禁在需要保留本地 Docker 数据时执行 `docker compose down -v`。

## 2. 构建服务端

在仓库根目录执行：

```bash
cd /Users/ycc/Documents/TestCode/startcloudsai
go build -o /tmp/startcloudsai-local-server ./apps/server/cmd/server
```

修改 Go 代码后需要重新执行此命令，并重启 API 与 Worker。只修改前端代码时不需要重新构建 Go 二进制。

## 3. 启动 API

打开第一个终端：

```bash
cd /Users/ycc/Documents/TestCode/startcloudsai

set -a
source .env
set +a

export DATABASE_URL="${DATABASE_URL//@postgres:/@127.0.0.1:}"
export REDIS_URL="${REDIS_URL//@redis:/@127.0.0.1:}"

/tmp/startcloudsai-local-server serve
```

API 启动时会自动执行尚未应用的 Goose 数据库迁移。开发环境出现弱 `APP_SECRET`、非生产 Cookie 或内网访问警告是预期行为。

## 4. 启动 Worker

打开第二个终端：

```bash
cd /Users/ycc/Documents/TestCode/startcloudsai

set -a
source .env
set +a

export DATABASE_URL="${DATABASE_URL//@postgres:/@127.0.0.1:}"
export REDIS_URL="${REDIS_URL//@redis:/@127.0.0.1:}"

/tmp/startcloudsai-local-server worker
```

看到 `worker ready` 和 `Starting processing` 表示 Worker 已经开始消费任务。API 与 Worker 必须使用同一组 PostgreSQL 和 Redis 配置。

## 5. 启动用户端

打开第三个终端：

```bash
cd /Users/ycc/Documents/TestCode/startcloudsai/apps/web-react
npm run dev
```

Vite 会监听 `127.0.0.1:3105`，并把 `/api` 请求代理到 `http://localhost:8000`。React 代码修改后会自动热更新。

## 6. 启动管理后台

打开第四个终端：

```bash
cd /Users/ycc/Documents/TestCode/startcloudsai/apps/admin
npm run dev -- --host 127.0.0.1 --port 3200 --strictPort
```

管理端会监听 `127.0.0.1:3200`，访问路径必须包含 `/admin/`。Vue 代码修改后会自动热更新。

## 7. 启动后验证

在第五个终端或任意空闲终端执行：

```bash
curl -fsS http://127.0.0.1:8000/api/v1/health
curl -fsSI http://127.0.0.1:3105
curl -fsSI http://127.0.0.1:3200/admin/
```

健康接口应返回：

```json
{"data":{"db":"ok","redis":"ok","status":"ok"},"success":true}
```

两个前端请求都应返回 `HTTP/1.1 200 OK`。

## 停止与重启

在 API、Worker、用户端和管理端各自的终端按 `Ctrl+C` 即可停止对应服务。

常见修改对应的重启范围：

| 修改内容 | 需要操作 |
| --- | --- |
| React/Vue/CSS | 无需重启，等待 Vite 热更新 |
| Go API | 重新构建二进制并重启 API |
| Go Worker | 重新构建二进制并重启 Worker |
| 数据库迁移 | 重新构建并重启 API，由 API 自动执行迁移 |
| `.env` | 重启 API 和 Worker；Vite 环境变量变更时也需重启对应前端 |

## 常见问题

### 端口已被占用

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:3105 -sTCP:LISTEN
lsof -nP -iTCP:3200 -sTCP:LISTEN
```

确认进程属于旧的本地服务后，在其原终端按 `Ctrl+C`；不要直接终止不认识的系统进程。

### 数据库或 Redis 无法连接

```bash
brew services list | grep -E 'postgres|redis'
pg_isready -h 127.0.0.1 -p 5432
redis-cli -h 127.0.0.1 -p 6379 ping
```

根 `.env` 为了兼容 Docker Compose，连接地址可能使用主机名 `postgres` 和 `redis`。本文启动命令只在当前 Shell 中将它们替换为 `127.0.0.1`，不会修改 `.env` 文件。

### 前端页面能打开但 API 请求失败

先确认 API 健康检查可访问，再检查 Vite 终端是否显示代理错误：

```bash
curl -fsS http://127.0.0.1:8000/api/v1/health
```

### 缺少前端依赖

```bash
cd /Users/ycc/Documents/TestCode/startcloudsai/apps/web-react
npm ci

cd /Users/ycc/Documents/TestCode/startcloudsai/apps/admin
npm ci
```

### 管理员账号

管理员账号与普通用户账号相互独立。创建或更新本地管理员密码：

```bash
cd /Users/ycc/Documents/TestCode/startcloudsai

set -a
source .env
set +a

export DATABASE_URL="${DATABASE_URL//@postgres:/@127.0.0.1:}"
export REDIS_URL="${REDIS_URL//@redis:/@127.0.0.1:}"

read -rs ADMIN_PASSWORD
printf '%s' "$ADMIN_PASSWORD" | /tmp/startcloudsai-local-server create-admin \
  --email admin@example.com \
  --password-stdin
unset ADMIN_PASSWORD
```

请把 `admin@example.com` 替换为本地使用的管理员邮箱。

## Docker Compose 模式

如果需要测试接近生产环境的容器化运行方式，请改用根 README 中的 Docker 本地启动流程。Compose 模式默认通过统一 Gateway 访问，不要同时启动本文的 API、Worker 和两个 Vite 服务。
