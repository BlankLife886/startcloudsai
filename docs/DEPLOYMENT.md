# StarCloudsAI 生产部署与运维手册

本文档适用于当前仓库的生产部署、日常更新、备份恢复和故障排查。示例环境使用：

需要单独执行生产蓝绿更新时，使用独立手册
[ZERO_DOWNTIME_RELEASE_RUNBOOK.md](./ZERO_DOWNTIME_RELEASE_RUNBOOK.md)。

- 域名：`starcloudisai.com`
- 服务器：`47.82.102.112`
- 管理面板：宝塔面板
- 运行方式：Docker Compose
- 当前发布分支：`codex/publish-current-project`
- 项目目录：`/www/wwwroot/startcloudsai`
- 本机网关：`127.0.0.1:8080`
- 发布方式：本地生成源码包，通过宝塔网页面板手动上传；不使用 SSH 或服务器端 Git 拉取

更换服务器或域名时，只需替换本文中的域名、IP 和项目目录。

### React 主站

默认 `docker-compose.yml` 直接构建 React 主站：

```bash
docker compose --env-file .env up -d --build
```

`web` 使用 `apps/web-react/Dockerfile`，API、Worker、数据库、管理端和网关仍使用原有服务契约。

## 1. 部署架构

生产流量路径：

```text
浏览器
  -> HTTPS 443
  -> 宝塔 Nginx
  -> http://127.0.0.1:8080
  -> Docker gateway
     -> /          用户端 web
     -> /admin/    管理端 admin
     -> /api/v1/      Go server
                     -> PostgreSQL
                     -> Redis / Worker
                     -> ChatGPT2API / Sub2API / Cloudflare R2
```

Compose 服务：

| 服务       | 作用                         | 是否保存数据 |
| ---------- | ---------------------------- | ------------ |
| `gateway`  | 统一 HTTP 入口和站内反向代理 | 否           |
| `web`      | 用户端 React 静态文件        | 否           |
| `admin`    | 管理端 Vue 静态文件          | 否           |
| `server`   | API、认证、迁移和业务逻辑    | 否           |
| `worker`   | 图片生成、队列和后台任务     | 否           |
| `postgres` | 用户、钱包、任务和运营数据   | `pg_data`    |
| `redis`    | 队列和限流状态               | `redis_data` |

生成图片和上传文件保存在 Cloudflare R2，不在服务器本地磁盘。

## 2. 上线前准备

### 2.1 DNS

在域名服务商添加：

| 主机记录 | 类型 | 记录值          |
| -------- | ---- | --------------- |
| `@`      | `A`  | `47.82.102.112` |
| `www`    | `A`  | `47.82.102.112` |

已有的企业邮箱 `MX`、`TXT`、`mail`、`smtp` 等记录必须保留。

验证：

```bash
nslookup starcloudisai.com
```

必须解析到服务器 IP 后再申请 SSL。

### 2.2 防火墙

阿里云安全组和宝塔防火墙只需开放：

```text
TCP 80
TCP 443
宝塔面板管理端口
```

不要向公网开放 `8080`、`5432` 或 `6379`。Compose 默认只把网关绑定到 `127.0.0.1:8080`，PostgreSQL 和 Redis 只存在于 Docker 内网。

### 2.3 服务器资源

检查：

```bash
docker --version
docker compose version
git --version
free -h
df -h
```

2 核 2 GB 服务器建议配置 4 GB Swap。如果 `free -h` 显示 Swap 为 0，首次执行：

```bash
fallocate -l 4G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

不要重复向 `/etc/fstab` 添加同一行。

## 3. 首次部署

### 3.1 生成并上传发布包

在开发机确认目标提交已经推送后，从仓库根目录生成发布包：

```bash
./scripts/package-manual-deploy.sh
```

脚本会在 `.artifacts/deploy/` 生成：

```text
startcloudsai-<commit>.tar.gz
startcloudsai-<commit>.tar.gz.sha256
```

发布包由 `git archive` 从当前提交生成，只包含已提交文件，不包含 `.env`、`.git`、依赖目录、构建目录或本地 QA 产物。提交号写在文件名中，用于上线记录和回滚定位。

首次部署时，在宝塔“文件”页面完成以下操作：

1. 进入 `/www/wwwroot`，上传发布包和对应的 `.sha256` 文件。
2. 使用宝塔文件管理器解压发布包，确认目录名为 `startcloudsai`。
3. 在 `startcloudsai` 中复制 `.env.example` 为 `.env`，按下文配置生产密钥。
4. 将 `.env` 权限设置为 `600`。

需要校验上传完整性时，在宝塔“终端”中执行：

```bash
cd /www/wwwroot
sha256sum -c startcloudsai-<commit>.tar.gz.sha256
```

宝塔终端是网页面板内的本地终端，不需要开放 SSH 端口。

### 3.2 生成密钥

分别生成三个不同的随机值：

```bash
openssl rand -hex 32
```

用于：

- `APP_SECRET`
- `POSTGRES_PASSWORD`
- `REDIS_PASSWORD`

`APP_SECRET` 必须至少 32 位且不能使用模板值。它还用于加密数据库中的上游密钥，正式上线后必须稳定保存，不能随意更换。

数据库密码建议只使用十六进制字符，避免 URL 转义问题。`POSTGRES_PASSWORD` 必须与 `DATABASE_URL` 中的密码完全一致。

### 3.3 配置 `.env`

编辑 `/www/wwwroot/startcloudsai/.env`：

```env
APP_ENV_FILE=.env
APP_ENV=production
APP_SECRET=<64位随机字符串>

ALLOWED_ORIGINS=https://starcloudisai.com
TRUSTED_PROXIES=172.30.10.254/32

POSTGRES_PASSWORD=<数据库密码>
DATABASE_URL=postgres://starclouds:<同一个数据库密码>@postgres:5432/starclouds?sslmode=disable

REDIS_PASSWORD=<Redis密码>
REDIS_URL=redis://:<同一个Redis密码>@redis:6379/0

C2A_BASE_URL=https://<ChatGPT2API根域名>
C2A_API_KEY=<ChatGPT2API密钥>
C2A_TIMEOUT_SECS=600

SUB2API_BASE_URL=https://<Sub2API根域名>
SUB2API_API_KEY=<Sub2API密钥>
SUB2API_CHAT_MODEL=gpt-5.4
SUB2API_IMAGE_MODEL=gpt-image-2
SUB2API_TIMEOUT_SECS=300

R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=<R2访问密钥ID>
R2_SECRET_ACCESS_KEY=<R2访问密钥>
R2_BUCKET=starcloudsai
R2_PRESIGN_EXPIRE_SECS=3600

SMTP_ADDR=<SMTP服务器:端口>
SMTP_USER=<完整邮箱地址>
SMTP_PASSWORD=<邮箱客户端专用密码>
SMTP_FROM=<完整发件邮箱>
TRIAL_APPLICATION_EMAIL=<体验资格申请接收邮箱；可留空回退到 SMTP_FROM>

WORKER_CONCURRENCY=32
USER_MAX_RUNNING_TASKS=100
SERVER_GOMEMLIMIT=900MiB
WORKER_GOMEMLIMIT=1700MiB
SERVER_DB_MAX_CONNS=10
SERVER_DB_MIN_CONNS=1
WORKER_DB_MAX_CONNS=5
WORKER_DB_MIN_CONNS=1

GATEWAY_BIND=127.0.0.1
GATEWAY_PORT=8080
```

配置说明：

- `C2A_BASE_URL` 填 ChatGPT2API 根地址，不加后台路径。
- `SUB2API_BASE_URL` 填 Sub2API 根地址，去掉 `/admin/accounts`。
- R2 未配置时，上传和生成图片无法正常持久化。
- 生产环境未配置 SMTP 时，用户无法获取账号验证码。
- `WORKER_CONCURRENCY=32` 是 Worker 启动时的物理槽位，不代表同时执行 32 个图片任务。图片实际并发在后台“全站同时执行”中调整，2 核 2 GB 服务器建议从 4 开始逐级压测。
- `GOMEMLIMIT` 必须低于容器硬上限，数据库连接池只有在后台等待指标持续增长后才应调大。指标说明和 pprof/PGO 操作见 [Go 性能与实时可观测性](GO_PERFORMANCE_OBSERVABILITY.md)。
- 不要把 `.env`、密钥或完整日志发布到 GitHub、聊天截图或工单。

### 3.4 配置邮箱验证码

用户端仅支持 Gmail、Googlemail、QQ 邮箱验证码认证，首次验证会自动创建账号。生产环境必须在 `.env` 配置可用的 SMTP 发件账号：

```env
SMTP_ADDR=<SMTP服务器:587>
SMTP_USER=<完整发件邮箱>
SMTP_PASSWORD=<客户端授权码或应用专用密码>
SMTP_FROM=<完整发件邮箱>
```

QQ 邮箱可使用 `smtp.qq.com:587` 和邮箱设置中生成的授权码；Gmail 可使用 `smtp.gmail.com:587` 和应用专用密码。配置后重新创建后端容器：

```bash
docker compose --env-file .env up -d --force-recreate server
```

验证：

```bash
curl -s https://starcloudisai.com/api/v1/auth/providers
```

响应中的 `email` 必须为 `true`。不要把 SMTP 授权码发送到聊天、截图或提交到 Git。

检查关键配置但不输出密钥：

```bash
awk -F= '/^APP_SECRET=/{gsub(/\r/,"",$2); print "APP_SECRET长度=" length($2)}' .env
```

正常应输出 `APP_SECRET长度=64`。

### 3.5 启动

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file .env up -d --build
```

查看状态：

```bash
docker compose --env-file .env ps
```

预期：

- `postgres`、`redis`、`server` 为 `Healthy`。
- `web`、`admin`、`worker`、`gateway` 为 `Up`。
- 网关显示 `127.0.0.1:8080->80/tcp`。

验证：

```bash
curl http://127.0.0.1:8080/api/v1/health
curl -I http://127.0.0.1:8080/
```

### 3.6 首次数据库密码错误

如果日志出现：

```text
password authentication failed for user "starclouds"
```

说明数据卷初始化密码和 `.env` 中的 `DATABASE_URL` 不一致。

仅在首次部署、确认没有业务数据时，可以统一密码后重建空数据卷：

```bash
DB_PASSWORD=$(openssl rand -hex 24)
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${DB_PASSWORD}|" .env
sed -i "s|^DATABASE_URL=.*|DATABASE_URL=postgres://starclouds:${DB_PASSWORD}@postgres:5432/starclouds?sslmode=disable|" .env
unset DB_PASSWORD

docker compose --env-file .env down -v
docker compose --env-file .env up -d
```

正式产生数据后禁止使用 `down -v`。

## 4. 宝塔网站和 HTTPS

### 4.1 创建网站

使用宝塔左侧普通的“网站”，不是“Docker -> 网站”。

1. 添加站点。
2. 域名填写 `starcloudisai.com` 和 `www.starcloudisai.com`。
3. 选择纯静态。
4. 不创建 FTP 和数据库。

### 4.2 反向代理

进入“网站 -> starcloudisai.com -> 设置 -> 反向代理”，添加：

```text
代理名称：startcloudsai
目标 URL：http://127.0.0.1:8080
发送域名：$host
缓存：关闭
```

反向代理配置：

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_connect_timeout 60s;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    proxy_buffering off;
}
```

在站点 Nginx 配置的 `server {}` 内添加。画布模板 ZIP 最大为 128 MiB，
这里需要覆盖 ZIP、模板元数据和 multipart 边界：

```nginx
client_max_body_size 131m;
```

如果已有更大的 `client_max_body_size`，无需重复添加。

### 4.3 SSL

1. HTTP 能访问后，在宝塔 SSL 页面申请 Let's Encrypt。
2. 同时勾选根域名和 `www`。
3. 开启强制 HTTPS。
4. 添加 301 跳转：`www.starcloudisai.com` -> `https://starcloudisai.com`。

验证：

```bash
curl https://starcloudisai.com/api/v1/health
```

生产入口：

```text
用户端：https://starcloudisai.com/
管理端：https://starcloudisai.com/admin/
健康检查：https://starcloudisai.com/api/v1/health
```

## 5. 创建和重置管理员

分步执行，不要把三行一次性粘贴。输入密码时终端不会显示字符。

```bash
cd /www/wwwroot/startcloudsai
read -rsp "请输入后台密码（至少12位）: " ADMIN_PASSWORD; echo
printf '%s' "$ADMIN_PASSWORD" | docker compose --env-file .env exec -T server \
  /app/server create-admin --email <管理员邮箱> --password-stdin
unset ADMIN_PASSWORD
```

同一邮箱再次执行会更新密码并撤销旧会话，不会创建普通用户账号。

## 6. 上线验收

依次验证：

- 用户端首页、更新页和画廊可以打开和滚动。
- 用户邮箱验证码认证、首次自动建号和退出正常。
- 管理员可以登录 `/admin/`。
- 后台仪表盘能每 5 秒更新 API、内存、数据库、队列和 Worker 指标。
- 后台系统设置能读取上游模型。
- 文生图可以提交、扣积分、完成并显示历史记录。
- AI 助手对话、图片生成、刷新恢复和任务监控正常。
- 插画染色和其他工作台能够提交任务。
- 上传参考图、提示词封面、资产图片和 128 MiB 以内的画布模板 ZIP 没有 `413`。
- 原图、缩略图和全屏预览可以通过站内文件接口加载。
- 任务失败时积分可以正确释放。

## 7. 日常运维

### 7.1 状态和日志

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file .env ps
docker compose --env-file .env logs --tail=100 server worker gateway
```

持续查看：

```bash
docker compose --env-file .env logs -f server worker
```

资源检查：

```bash
free -h
df -h
docker system df
docker stats --no-stream
```

### 7.2 安全清理磁盘

删除未被容器使用的旧镜像：

```bash
docker image prune -f
```

不要执行 `docker volume prune`，也不要手动删除 `startcloudsai_pg_data` 和 `startcloudsai_redis_data`。

### 7.3 重启

普通重启：

```bash
docker compose --env-file .env restart server worker gateway
```

修改 `.env` 后，`restart` 不会加载新环境变量，必须重建容器：

```bash
docker compose --env-file .env up -d --force-recreate server worker gateway
```

修改代码或 Dockerfile 后：

```bash
docker compose --env-file .env up -d --build
```

## 8. 备份

### 8.1 PostgreSQL

建议每次更新前备份，并由宝塔计划任务每天执行一次：

```bash
cd /www/wwwroot/startcloudsai
mkdir -p /www/backup/startcloudsai
docker compose --env-file .env exec -T postgres \
  pg_dump --clean --if-exists -U starclouds starclouds \
  | gzip > "/www/backup/startcloudsai/starclouds-$(date +%F-%H%M).sql.gz"
```

确认备份不是空文件：

```bash
ls -lh /www/backup/startcloudsai
gzip -t /www/backup/startcloudsai/<备份文件>.sql.gz
```

建议保留 7 份每日备份和 4 份每周备份，并把至少一份同步到服务器之外。

### 8.2 其他必须备份的内容

- `/www/wwwroot/startcloudsai/.env`
- Cloudflare R2 bucket 及访问密钥信息
- 宝塔站点 Nginx 和 SSL 配置
- 当前生产 Git 提交：`git rev-parse HEAD`

备份 `.env` 时必须加密或放在受限位置，权限设为 `600`。

## 9. 手动更新发布

### 9.1 零停机更新（生产推荐）

生产环境不要直接在承接流量的 `8080` 实例上执行 `up -d --build`。本仓库提供
`deploy/docker-compose.candidate.yml`，用于在 `127.0.0.1:8081` 启动候选 API、用户端、
管理端和网关。候选环境只连接生产现有的 PostgreSQL/Redis Docker 网络，不创建、不复制
也不覆盖任何数据卷。候选 Worker 默认不启动，避免在验收阶段提前消费线上任务；正式
Worker 继续承接任务，切换正式版本时通过 15 分钟优雅停机窗口完成替换。

先在开发机生成发布包并上传发布包与校验文件。服务器上把新版本解压到独立目录，
不要覆盖当前 `/www/wwwroot/startcloudsai`：

```bash
RELEASE_ID=<新commit的12位短提交号>
RELEASE_ROOT=/www/wwwroot/releases/$RELEASE_ID
RELEASE_DIR=$RELEASE_ROOT/startcloudsai

mkdir -p "$RELEASE_ROOT"
cd /www/wwwroot
sha256sum -c /www/wwwroot/startcloudsai-$RELEASE_ID.tar.gz.sha256
tar -xzf /www/wwwroot/startcloudsai-$RELEASE_ID.tar.gz -C "$RELEASE_ROOT"

# 只复制线上配置；禁止上传或复制开发机 .env、数据库和上传目录。
install -m 600 /www/wwwroot/startcloudsai/.env "$RELEASE_DIR/.env"
```

更新前备份生产数据库并验证备份可读：

```bash
mkdir -p /www/backup/startcloudsai
BACKUP=/www/backup/startcloudsai/predeploy-$RELEASE_ID.sql.gz
cd /www/wwwroot/startcloudsai
docker compose --env-file .env exec -T postgres \
  pg_dump --clean --if-exists -U starclouds starclouds | gzip > "$BACKUP"
test -s "$BACKUP"
gzip -t "$BACKUP"
```

候选镜像应逐个构建，避免并行构建争抢线上 CPU/内存。随后启动候选环境：

```bash
export RELEASE_ID RELEASE_DIR
export PRODUCTION_COMPOSE_PROJECT=startcloudsai

docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" build server
docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" build web
docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" build admin
docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" up -d --no-build server web admin gateway
```

保留用户端和管理端旧哈希资源，避免已经打开的页面在发布期间懒加载旧 chunk 时出现 404：

```bash
LEGACY_ASSETS=/www/backup/startcloudsai/web-assets-$RELEASE_ID
mkdir -p "$LEGACY_ASSETS/web" "$LEGACY_ASSETS/admin"
BLUE_WEB=$(cd /www/wwwroot/startcloudsai && docker compose --env-file .env ps -q web)
BLUE_ADMIN=$(cd /www/wwwroot/startcloudsai && docker compose --env-file .env ps -q admin)
GREEN_WEB=$(docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" ps -q web)
GREEN_ADMIN=$(docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" ps -q admin)
docker cp "$BLUE_WEB":/usr/share/nginx/html/assets/. "$LEGACY_ASSETS/web"/
docker cp "$LEGACY_ASSETS/web"/. "$GREEN_WEB":/usr/share/nginx/html/assets/
docker cp "$BLUE_ADMIN":/usr/share/nginx/html/admin/assets/. "$LEGACY_ASSETS/admin"/
docker cp "$LEGACY_ASSETS/admin"/. "$GREEN_ADMIN":/usr/share/nginx/html/admin/assets/
```

候选环境必须全部通过后才能切流量：

```bash
docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" ps
curl -fsS http://127.0.0.1:8081/api/v1/health
curl -fsSI http://127.0.0.1:8081/
curl -fsSI http://127.0.0.1:8081/admin/
```

同时确认宝塔站点 Nginx 的 `server {}` 已设置 `client_max_body_size 131m;`。否则带图片的
画布模板 ZIP 会先被宝塔外层代理拒绝，候选容器内的接口限制即使正确也无法生效。

在切换网页流量前先滚动 Worker。先保留当前 Worker 镜像作为回滚点，再使用候选 Server
镜像启动新 Worker；`--no-deps` 可避免此时改动仍在承接流量的正式 API 和数据库容器：

```bash
OLD_WORKER=$(cd /www/wwwroot/startcloudsai && docker compose --env-file .env -p startcloudsai ps -q worker)
OLD_WORKER_IMAGE=$(docker inspect -f '{{.Image}}' "$OLD_WORKER")
docker tag "$OLD_WORKER_IMAGE" startcloudsai-worker:rollback-$RELEASE_ID
docker tag startcloudsai-candidate-server:$RELEASE_ID startcloudsai-worker:latest

cd "$RELEASE_DIR"
docker compose --env-file .env -p startcloudsai \
  up -d --no-build --no-deps worker
docker compose --env-file .env -p startcloudsai ps worker
docker compose --env-file .env -p startcloudsai logs --since=5m --tail=100 worker
```

Worker 收到 SIGTERM 后会停止领取新任务，并最多等待 15 分钟让在途任务完成；命令等待期间
不要中断。日志必须出现 `worker ready`，否则将 `startcloudsai-worker:rollback-$RELEASE_ID`
重新标记为 `startcloudsai-worker:latest` 并用旧目录的 Compose 重建 Worker，然后停止发布。

在宝塔站点反向代理中把目标从 `http://127.0.0.1:8080` 改为
`http://127.0.0.1:8081`，先执行 Nginx 配置检测，成功后 reload。再次验证公网健康接口、
首页和后台。登录后台上传一个带图片的无限画布 ZIP 模板，确认保存成功，并在用户端打开
该模板确认节点图片可见。失败时立即把目标改回 `8080`，旧环境此时仍完整运行。

候选环境稳定后，把已构建镜像标记为正式 Compose 使用的镜像名，正式容器无需再次构建：

```bash
docker tag startcloudsai-candidate-server:$RELEASE_ID startcloudsai-server:latest
docker tag startcloudsai-candidate-web:$RELEASE_ID startcloudsai-web:latest
docker tag startcloudsai-candidate-admin:$RELEASE_ID startcloudsai-admin:latest

cd "$RELEASE_DIR"
docker compose --env-file .env -p startcloudsai up -d --no-build server web admin gateway

NEW_WEB=$(docker compose --env-file .env -p startcloudsai ps -q web)
NEW_ADMIN=$(docker compose --env-file .env -p startcloudsai ps -q admin)
docker cp "$LEGACY_ASSETS/web"/. "$NEW_WEB":/usr/share/nginx/html/assets/
docker cp "$LEGACY_ASSETS/admin"/. "$NEW_ADMIN":/usr/share/nginx/html/admin/assets/

docker compose --env-file .env -p startcloudsai ps
curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsSI http://127.0.0.1:8080/
curl -fsSI http://127.0.0.1:8080/admin/
```

`8080` 新版本验证通过后，将宝塔反向代理目标切回 `http://127.0.0.1:8080` 并 reload。
确认公网正常后再关闭候选环境：

```bash
docker compose --env-file "$RELEASE_DIR/.env" -p startcloudsai_candidate \
  -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml" down
```

最后保留旧源码目录作为回滚入口，并让标准路径指向独立发布目录。不要移动
`$RELEASE_DIR`：正式 Gateway 的只读绑定源仍指向该真实路径，移动后容器下次重启会找不到
`deploy/nginx.conf`。

```bash
OLD_CODE_BACKUP=/www/wwwroot/startcloudsai-backup-before-$RELEASE_ID
mv /www/wwwroot/startcloudsai "$OLD_CODE_BACKUP"
ln -s "$RELEASE_DIR" /www/wwwroot/startcloudsai
test "$(readlink -f /www/wwwroot/startcloudsai)" = "$RELEASE_DIR"
```

不要执行 `down -v`、`docker volume prune`，也不要把开发机 `.env`、数据库导出、上传文件或
任何本地缓存放入发布目录。

### 9.2 原地更新（仅维护窗口）

下面的原地更新会重建单实例容器，只能在明确安排维护窗口时使用。

#### 更新前

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file .env ps
```

先按第 8 节完成数据库备份。然后在开发机执行打包脚本，并通过宝塔“文件”页面把新的发布包上传到 `/www/wwwroot`。

在宝塔文件管理器中完成以下替换：

1. 将现有 `startcloudsai` 重命名为 `startcloudsai-backup-<旧commit>`，不要删除。
2. 解压新发布包，确认新目录名称仍为 `startcloudsai`。
3. 将旧目录中的 `.env` 复制到新目录，并保持权限为 `600`。
4. 不要复制旧目录的源代码、`dist`、`node_modules` 或任何 `.git` 目录。

随后在宝塔“终端”中执行：

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
curl http://127.0.0.1:8080/api/v1/health
curl https://starcloudisai.com/api/v1/health
```

Compose 项目目录仍是 `startcloudsai`，所以会复用现有 PostgreSQL 和 Redis 数据卷。`server` 启动时自动执行数据库迁移；更新期间不要同时手动执行迁移，也不要执行 `docker compose down -v`。

### 9.2 只更新部分服务

仅前端：

```bash
docker compose --env-file .env up -d --build web admin gateway
```

仅后端和 Worker：

```bash
docker compose --env-file .env up -d --build server worker gateway
```

修改 `deploy/nginx.conf`：

```bash
docker compose --env-file .env up -d --force-recreate gateway
```

## 10. 回滚和恢复

### 10.1 代码回滚

确认旧版本兼容当前数据库迁移后，先把宝塔代理指向仍健康的候选 `8081`。若标准路径是
零停机发布创建的软链接，在宝塔终端执行：

```bash
STANDARD_DIR=/www/wwwroot/startcloudsai
OLD_CODE_BACKUP=/www/wwwroot/startcloudsai-backup-before-<新commit>
test -L "$STANDARD_DIR"
test -d "$OLD_CODE_BACKUP"
unlink "$STANDARD_DIR"
mv "$OLD_CODE_BACKUP" "$STANDARD_DIR"
```

独立发布目录保留在 `/www/wwwroot/releases/<新commit>/startcloudsai` 供排障，不要直接删除。
确认旧目录的生产 `.env` 仍存在且权限为 `600`，然后重建旧版本容器：

在宝塔终端执行：

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
curl http://127.0.0.1:8080/api/v1/health
```

代码目录回滚不会撤销已经执行的数据库迁移。发生不兼容迁移时，必须结合更新前的数据库备份恢复。

### 10.2 数据库恢复

数据库恢复会覆盖现有业务数据。先额外备份当前数据库，再进入维护窗口：

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file .env stop server worker
gunzip -c /www/backup/startcloudsai/<备份文件>.sql.gz \
  | docker compose --env-file .env exec -T postgres psql -U starclouds -d starclouds
docker compose --env-file .env start server worker
```

恢复后检查迁移日志、用户数据、钱包账本和任务状态。若恢复文件与当前代码版本不匹配，应先切换到生成该备份时的代码提交。

## 11. 常见故障

### 11.1 `APP_SECRET 未设置或过弱`

生成并写入至少 32 位随机密钥，然后重建 `server` 和 `worker`：

```bash
openssl rand -hex 32
docker compose --env-file .env up -d --force-recreate server worker gateway
```

不要在已经保存加密上游密钥的生产环境中随意更换现有 `APP_SECRET`。

### 11.2 `password authentication failed for user "starclouds"`

检查 `POSTGRES_PASSWORD` 与 `DATABASE_URL` 密码是否一致。正式环境不要删除卷，应使用 PostgreSQL `ALTER ROLE` 按变更流程修改数据库密码。

### 11.3 `server is unhealthy`

Compose 输出只是汇总，真实原因看日志：

```bash
docker compose --env-file .env logs --since=10m --no-color --tail=200 server
```

### 11.4 `curl 127.0.0.1:8080 connection refused`

通常是 `server` 不健康导致 `gateway` 未启动。先修复 `server`，不要先检查域名。

### 11.5 `413 Request Entity Too Large`

检查宝塔站点 `server {}` 中是否存在：

```nginx
client_max_body_size 131m;
```

画布模板 ZIP 最大为 128 MiB，不能继续沿用早期的 `20m` 配置。修改后保存并确认
Nginx 配置检测通过；同时重建 `gateway`，让 `deploy/nginx.conf` 的接口级限制生效：

```bash
docker compose up -d --force-recreate gateway
```

### 11.6 登录或写请求提示 Origin 错误

确认：

```env
APP_ENV=production
ALLOWED_ORIGINS=https://starcloudisai.com
```

域名、协议和端口必须完全一致。修改后强制重建 `server`。

### 11.7 图片生成成功但页面没有图片

依次检查：

1. `worker` 是否为 `Up`。
2. 后台任务详情是否有结果 URL 或错误。
3. R2 四项配置是否完整。
4. `server` 和 `worker` 日志是否出现 R2、C2A 或 Sub2API 错误。
5. `/api/v1/files/*` 是否能通过当前登录会话访问。

### 11.8 更新后页面仍是旧版本

```bash
docker compose --env-file .env up -d --build web admin gateway
```

确认服务器上的发布包文件名对应预期提交，然后清除浏览器站点缓存或强制刷新。不要只重启旧前端容器。

## 12. 禁止操作

生产环境禁止在未备份和未确认影响时执行：

```bash
docker compose down -v
docker volume prune
rm -rf /var/lib/docker
git reset --hard
```

同时禁止：

- 把 `.env` 提交到 Git。
- 在截图中公开 API Key、Cookie、数据库密码或 `APP_SECRET`。
- 直接向公网暴露 PostgreSQL、Redis 和 `8080`。
- 在没有数据库备份时执行版本升级或迁移回滚。
- 在生产环境中使用模板密码和默认密钥。

## 13. 快速命令清单

```bash
cd /www/wwwroot/startcloudsai

# 状态
docker compose --env-file .env ps

# 健康检查
curl http://127.0.0.1:8080/api/v1/health

# 日志
docker compose --env-file .env logs --tail=100 server worker gateway

# 修改环境变量后重建
docker compose --env-file .env up -d --force-recreate server worker gateway

# 上传并解压新发布包、复制旧 .env 后更新全部服务
docker compose --env-file .env up -d --build

# 安全停止，保留数据
docker compose --env-file .env down

# 重新启动
docker compose --env-file .env up -d
```
