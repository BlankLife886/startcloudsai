# StarCloudsAI 生产部署与运维手册

本文档适用于当前仓库的生产部署、日常更新、备份恢复和故障排查。示例环境使用：

- 域名：`starcloudisai.com`
- 服务器：`47.82.102.112`
- 管理面板：宝塔面板
- 运行方式：Docker Compose
- 当前部署分支：`codex/product-experience-updates`
- 项目目录：`/www/wwwroot/startcloudsai`
- 本机网关：`127.0.0.1:8080`

更换服务器或域名时，只需替换本文中的域名、IP 和项目目录。

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
     -> /api/      Go server
                     -> PostgreSQL
                     -> Redis / Worker
                     -> ChatGPT2API / Sub2API / Cloudflare R2
```

Compose 服务：

| 服务       | 作用                         | 是否保存数据 |
| ---------- | ---------------------------- | ------------ |
| `gateway`  | 统一 HTTP 入口和站内反向代理 | 否           |
| `web`      | 用户端 Vue 静态文件          | 否           |
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

### 3.1 拉取代码

```bash
cd /www/wwwroot
git clone -b codex/product-experience-updates \
  https://github.com/BlankLife886/startcloudsai.git
cd /www/wwwroot/startcloudsai
cp .env.example .env
chmod 600 .env
```

仓库合并到 `main` 后，生产服务器可改为跟踪 `main`。切换前必须确认目标分支包含当前生产提交。

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

WORKER_CONCURRENCY=2
USER_MAX_RUNNING_TASKS=3

GATEWAY_BIND=127.0.0.1
GATEWAY_PORT=8080
```

配置说明：

- `C2A_BASE_URL` 填 ChatGPT2API 根地址，不加后台路径。
- `SUB2API_BASE_URL` 填 Sub2API 根地址，去掉 `/admin/accounts`。
- R2 未配置时，上传和生成图片无法正常持久化。
- 生产环境未配置 SMTP 时，用户无法获取账号验证码。
- 2 核 2 GB 服务器建议使用 `WORKER_CONCURRENCY=2`。生图任务会长时间等待上游，设置为 `1` 会让后续任务全部串行排队；不要在 2 GB 机器上直接提高到 `4` 以上。
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
curl -s https://starcloudisai.com/api/auth/providers
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
curl http://127.0.0.1:8080/api/health
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

在站点 Nginx 配置的 `server {}` 内添加：

```nginx
client_max_body_size 20m;
```

如果已有更大的 `client_max_body_size`，无需重复添加。

### 4.3 SSL

1. HTTP 能访问后，在宝塔 SSL 页面申请 Let's Encrypt。
2. 同时勾选根域名和 `www`。
3. 开启强制 HTTPS。
4. 添加 301 跳转：`www.starcloudisai.com` -> `https://starcloudisai.com`。

验证：

```bash
curl https://starcloudisai.com/api/health
```

生产入口：

```text
用户端：https://starcloudisai.com/
管理端：https://starcloudisai.com/admin/
健康检查：https://starcloudisai.com/api/health
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
- 后台系统设置能读取上游模型。
- 文生图可以提交、扣积分、完成并显示历史记录。
- AI 助手对话、图片生成、刷新恢复和任务监控正常。
- 插画染色和其他工作台能够提交任务。
- 上传参考图、提示词封面和资产图片没有 `413`。
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

## 9. 更新发布

### 9.1 更新前

```bash
cd /www/wwwroot/startcloudsai
git status --short
git branch --show-current
git rev-parse HEAD
docker compose --env-file .env ps
```

服务器仓库不应有手工代码修改。`.env` 被 Git 忽略，不会影响拉取。

先执行数据库备份，再更新：

```bash
git fetch origin
git pull --ff-only origin codex/product-experience-updates
docker compose --env-file .env up -d --build
docker compose --env-file .env ps
curl http://127.0.0.1:8080/api/health
curl https://starcloudisai.com/api/health
```

`server` 启动时自动执行数据库迁移。更新期间不要同时手动执行迁移。

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

先记录当前提交和目标提交。确认目标版本兼容当前数据库迁移后：

```bash
cd /www/wwwroot/startcloudsai
git checkout <已验证的旧提交>
docker compose --env-file .env up -d --build
```

恢复到部署分支：

```bash
git checkout codex/product-experience-updates
git pull --ff-only origin codex/product-experience-updates
docker compose --env-file .env up -d --build
```

不要使用 `git reset --hard` 覆盖未确认的服务器文件。

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
client_max_body_size 20m;
```

修改后保存并确认 Nginx 配置检测通过。

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
5. `/api/files/*` 是否能通过当前登录会话访问。

### 11.8 更新后页面仍是旧版本

```bash
git rev-parse HEAD
docker compose --env-file .env up -d --build web admin gateway
```

然后清除浏览器站点缓存或强制刷新。不要只重启旧前端容器。

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
curl http://127.0.0.1:8080/api/health

# 日志
docker compose --env-file .env logs --tail=100 server worker gateway

# 修改环境变量后重建
docker compose --env-file .env up -d --force-recreate server worker gateway

# 更新全部服务
git pull --ff-only origin codex/product-experience-updates
docker compose --env-file .env up -d --build

# 安全停止，保留数据
docker compose --env-file .env down

# 重新启动
docker compose --env-file .env up -d
```
