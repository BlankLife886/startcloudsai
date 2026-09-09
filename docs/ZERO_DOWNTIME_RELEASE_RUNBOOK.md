# StarCloudsAI 零停机发布独立操作手册

本文档是一份可单独使用的生产更新手册，适用于当前 StarCloudsAI 的宝塔 Nginx + Docker
Compose 部署。目标是在不中断在线用户、不替换生产数据、不提前消费线上任务的前提下，完成
API、Worker、用户端、管理端和网关更新。

最近一次完整实操验证：2026-08-27，部署版本 `303cfc7cb521`。后续版本使用时替换
`RELEASE_ID`，不要照搬旧提交号。

适用环境：

- 域名：`starcloudisai.com`
- 正式入口：`127.0.0.1:8080`
- 候选入口：`127.0.0.1:8081`
- 标准目录：`/www/wwwroot/startcloudsai`
- 独立发布目录：`/www/wwwroot/releases/<RELEASE_ID>/startcloudsai`
- Compose 项目名：`startcloudsai`
- 候选 Compose 项目名：`startcloudsai_candidate`

发布流量顺序：

```text
正式 8080 承接流量
  -> 构建并验证候选 8081
  -> 优雅滚动 Worker
  -> 公网切到候选 8081
  -> 更新并验证正式 8080
  -> 公网切回正式 8080
  -> 保留回滚点并关闭候选 8081
```

命令默认在同一个宝塔终端会话中依次执行。打开新终端或重新登录后，必须重新设置
`RELEASE_ID`、`RELEASE_DIR`、`PROXY_CONF` 等变量。

## 1. 发布原则

整个过程遵守以下规则：

1. 发布包只由 `git archive` 生成，不包含开发机 `.env`、数据库、上传目录、依赖和缓存。
2. 新版本只复制服务器现有的生产 `.env`。
3. PostgreSQL、Redis 数据卷和 R2 对象存储始终复用生产数据，不复制、不初始化、不删除。
4. 候选环境默认不启动 Worker，避免两个版本提前同时消费任务。
5. 候选环境验证通过后，先优雅滚动 Worker，再切换网页流量。
6. 宝塔 Nginx 只使用配置检测通过后的 reload，不直接停止 Nginx。
7. 正式 `8080` 更新期间，公网由候选 `8081` 承接。
8. 旧代码、数据库备份、Redis 快照和旧镜像至少保留 7 天。

严禁执行：

```bash
docker compose down -v
docker volume prune
docker system prune -a
```

也不要把开发机 `.env`、本地数据库、上传文件、测试输出或缓存放入发布目录。

## 2. 本地生成发布包

在开发机仓库根目录确认目标提交已经推送且工作区干净：

```bash
git status --short
git rev-parse --short=12 HEAD
git rev-parse --short=12 origin/codex/publish-current-project
```

生成发布包：

```bash
./scripts/package-manual-deploy.sh
```

产物位于：

```text
.artifacts/deploy/startcloudsai-<RELEASE_ID>.tar.gz
.artifacts/deploy/startcloudsai-<RELEASE_ID>.tar.gz.sha256
```

发布包必须同时上传到服务器 `/www/wwwroot`。只上传这两个文件，不上传本地 `.env`。

## 3. 服务器资源预检

上传文件不会影响线上服务。构建前先检查资源：

```bash
nproc
free -h
df -h /
docker stats --no-stream
docker compose -f /www/wwwroot/startcloudsai/docker-compose.yml \
  --env-file /www/wwwroot/startcloudsai/.env ps
curl -fsS http://127.0.0.1:8080/api/v1/health
```

建议最低条件：

- CPU 至少 2 核。
- 可用内存加空闲 Swap 至少约 4 GB。
- 磁盘剩余至少 15 GB。
- PostgreSQL、Redis 和 Server 均健康。
- 当前容器没有持续接近内存上限。

构建时建议另开一个终端持续监控：

```bash
watch -n 3 'free -h; echo; uptime; echo; docker stats --no-stream; echo; curl -fsS http://127.0.0.1:8080/api/v1/health'
```

出现以下任一情况时停止后续步骤：

- 可用内存低于 500 MiB。
- Swap 快速使用超过 1 GiB。
- Load Average 持续高于 CPU 核数的两倍。
- 磁盘剩余低于 10 GB。
- `8080` 健康检查失败。

## 4. 完整生产备份

备份可在线执行，不停止生产服务。以下命令会备份生产 `.env`、当前源码、PostgreSQL、Redis
以及容器镜像状态：

```bash
set -euo pipefail

cd /www/wwwroot/startcloudsai
BACKUP_ROOT="/www/backup/startcloudsai/predeploy-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

install -m 600 .env "$BACKUP_ROOT/production.env"

tar \
  --exclude='.env' \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.artifacts' \
  --exclude='dist' \
  -czf "$BACKUP_ROOT/current-source.tar.gz" \
  -C /www/wwwroot/startcloudsai .

docker compose --env-file .env exec -T postgres \
  pg_dump --clean --if-exists -U starclouds starclouds \
  | gzip -9 > "$BACKUP_ROOT/postgres.sql.gz"

test -s "$BACKUP_ROOT/postgres.sql.gz"
gzip -t "$BACKUP_ROOT/postgres.sql.gz"

docker compose --env-file .env exec -T redis \
  sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning BGSAVE'

until docker compose --env-file .env exec -T redis \
  sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning INFO persistence' \
  | tr -d '\r' | grep -q '^rdb_bgsave_in_progress:0$'; do
  sleep 1
done

REDIS_CONTAINER=$(docker compose --env-file .env ps -q redis)
docker cp "$REDIS_CONTAINER":/data/dump.rdb "$BACKUP_ROOT/redis-dump.rdb"

docker compose --env-file .env ps > "$BACKUP_ROOT/compose-ps.txt"
docker compose --env-file .env ps -q \
  | xargs docker inspect --format '{{.Name}} {{.Image}}' \
  > "$BACKUP_ROOT/container-images.txt"

cd "$BACKUP_ROOT"
sha256sum \
  production.env \
  current-source.tar.gz \
  postgres.sql.gz \
  redis-dump.rdb \
  > SHA256SUMS

sha256sum -c SHA256SUMS
chmod 600 production.env postgres.sql.gz redis-dump.rdb SHA256SUMS

curl -fsS http://127.0.0.1:8080/api/v1/health
du -sh "$BACKUP_ROOT"
echo "BACKUP_ROOT=$BACKUP_ROOT"
```

只有所有校验均为 `OK`，并且线上健康接口正常，才进入下一阶段。

## 5. 校验并解压发布包

在服务器终端设置本次发布变量：

```bash
# 替换为本次发布提交的 12 位短提交号，例如 303cfc7cb521。
export RELEASE_ID=REPLACE_WITH_12_CHAR_COMMIT
export RELEASE_ROOT=/www/wwwroot/releases/$RELEASE_ID
export RELEASE_DIR=$RELEASE_ROOT/startcloudsai
export PRODUCTION_COMPOSE_PROJECT=startcloudsai
```

校验并解压到独立目录：

```bash
set -euo pipefail

cd /www/wwwroot
sha256sum -c startcloudsai-$RELEASE_ID.tar.gz.sha256

mkdir -p "$RELEASE_ROOT"
test ! -e "$RELEASE_DIR"

tar -xzf "startcloudsai-$RELEASE_ID.tar.gz" \
  -C "$RELEASE_ROOT"

test -f "$RELEASE_DIR/docker-compose.yml"
test -f "$RELEASE_DIR/deploy/docker-compose.candidate.yml"

install -m 600 \
  /www/wwwroot/startcloudsai/.env \
  "$RELEASE_DIR/.env"
```

确认生产网络和候选端口：

```bash
docker network inspect \
  startcloudsai_data \
  startcloudsai_outbound >/dev/null

if ss -ltn | grep -q ':8081 '; then
  echo "错误：8081 已被占用"
  exit 1
else
  echo "8081 available: OK"
fi
```

验证候选 Compose：

```bash
cd "$RELEASE_DIR"

docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  config --quiet

docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  config --services

stat -c '%a %n' .env
curl -fsS http://127.0.0.1:8080/api/v1/health
```

默认服务列表必须只有：

```text
admin
server
web
gateway
```

不能出现 `worker`，生产 `.env` 权限必须为 `600`。

## 6. 逐个低优先级构建镜像

禁止并行构建。设置：

```bash
export COMPOSE_PARALLEL_LIMIT=1
cd "$RELEASE_DIR"
```

依次构建 Server、用户端和管理端，每完成一个都检查线上健康：

```bash
nice -n 10 ionice -c2 -n7 \
docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  build server

curl -fsS http://127.0.0.1:8080/api/v1/health
free -h
df -h /
```

```bash
nice -n 10 ionice -c2 -n7 \
docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  build web

curl -fsS http://127.0.0.1:8080/api/v1/health
free -h
df -h /
```

```bash
nice -n 10 ionice -c2 -n7 \
docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  build admin

curl -fsS http://127.0.0.1:8080/api/v1/health
free -h
df -h /
```

检查三个镜像存在：

```bash
docker image inspect startcloudsai-candidate-server:$RELEASE_ID >/dev/null
docker image inspect startcloudsai-candidate-web:$RELEASE_ID >/dev/null
docker image inspect startcloudsai-candidate-admin:$RELEASE_ID >/dev/null
```

## 7. 数据库滚动兼容检查

候选 Server 启动时会检查迁移并执行内置内容种子。启动前先读取当前数据库版本：

```bash
cd /www/wwwroot/startcloudsai

docker compose --env-file .env exec -T postgres \
  psql -U starclouds -d starclouds -Atc \
  "SELECT version_id, is_applied, tstamp
   FROM goose_db_version
   ORDER BY id DESC
   LIMIT 10;"
```

同时检查迁移中涉及的旧任务类型或约束数据。当前媒体任务可检查：

```bash
docker compose --env-file .env exec -T postgres \
  psql -U starclouds -d starclouds -Atc \
  "SELECT type, count(*)
   FROM tasks
   WHERE type IN ('crun_media', 'media_tool')
   GROUP BY type
   ORDER BY type;"
```

发布前必须人工确认所有新增迁移满足滚动兼容：

- 旧 Server 和旧 Worker 在迁移完成后仍能继续读写。
- 不在蓝绿阶段删除旧版本仍使用的列、表、枚举或约束值。
- 破坏性清理拆到所有实例升级完成后的独立版本。
- 存在不兼容迁移时，不得继续零停机流程，应安排维护窗口。

## 8. 启动候选环境

只启动四个无状态候选服务：

```bash
cd "$RELEASE_DIR"

docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  up -d --no-build server web admin gateway
```

检查：

```bash
docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  ps

docker ps \
  --filter name=startcloudsai_candidate-worker \
  --format '{{.Names}} {{.Status}}'

docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  logs --since=5m --tail=100 server gateway

curl -fsS http://127.0.0.1:8081/api/v1/health
curl -fsSI http://127.0.0.1:8081/
curl -fsSI http://127.0.0.1:8081/admin/
curl -fsS http://127.0.0.1:8080/api/v1/health
free -h
```

通过标准：

- 候选 Server 为 `healthy`。
- 四个候选服务均为 `Up`。
- 候选 Worker 查询没有输出。
- `8080` 和 `8081` 都健康。
- 日志没有迁移失败、panic、对象存储初始化失败或持续重启。

## 9. 保留旧版静态资源

已经打开的浏览器可能继续请求旧哈希 chunk。必须同时保留用户端和管理端资源：

```bash
export LEGACY_ASSETS=/www/backup/startcloudsai/web-assets-$RELEASE_ID
mkdir -p "$LEGACY_ASSETS/web" "$LEGACY_ASSETS/admin"

BLUE_WEB=$(cd /www/wwwroot/startcloudsai && \
  docker compose --env-file .env -p startcloudsai ps -q web)

BLUE_ADMIN=$(cd /www/wwwroot/startcloudsai && \
  docker compose --env-file .env -p startcloudsai ps -q admin)

GREEN_WEB=$(cd "$RELEASE_DIR" && \
  docker compose --env-file .env -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml ps -q web)

GREEN_ADMIN=$(cd "$RELEASE_DIR" && \
  docker compose --env-file .env -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml ps -q admin)

test -n "$BLUE_WEB"
test -n "$BLUE_ADMIN"
test -n "$GREEN_WEB"
test -n "$GREEN_ADMIN"

docker cp "$BLUE_WEB":/usr/share/nginx/html/assets/. \
  "$LEGACY_ASSETS/web/"
docker cp "$LEGACY_ASSETS/web/." \
  "$GREEN_WEB":/usr/share/nginx/html/assets/

docker cp "$BLUE_ADMIN":/usr/share/nginx/html/admin/assets/. \
  "$LEGACY_ASSETS/admin/"
docker cp "$LEGACY_ASSETS/admin/." \
  "$GREEN_ADMIN":/usr/share/nginx/html/admin/assets/

docker exec "$GREEN_WEB" nginx -t
docker exec "$GREEN_ADMIN" nginx -t
```

## 10. 等待任务空闲并滚动 Worker

Worker 是第一个会替换的正式容器。先读取所有活动任务：

```bash
cd /www/wwwroot/startcloudsai

docker compose --env-file .env exec -T postgres \
  psql -U starclouds -d starclouds -Atc "
    SELECT json_build_object(
      'tasks_queued', (SELECT count(*) FROM tasks WHERE status='queued'),
      'tasks_running', (SELECT count(*) FROM tasks WHERE status='running'),
      'assistant_queued', (SELECT count(*) FROM assistant_runs WHERE status='queued'),
      'assistant_running', (SELECT count(*) FROM assistant_runs WHERE status='running'),
      'files_queued', (SELECT count(*) FROM assistant_files WHERE status='queued'),
      'files_processing', (SELECT count(*) FROM assistant_files WHERE status='processing')
    );
  "
```

`running` 和 `processing` 应全部为 `0`。`queued` 最好也为 `0`；非零时任务不会丢失，但会在
Worker 滚动期间等待。

保存旧 Worker 镜像并替换：

```bash
set -euo pipefail

OLD_WORKER=$(cd /www/wwwroot/startcloudsai && \
  docker compose --env-file .env -p startcloudsai ps -q worker)
OLD_WORKER_IMAGE=$(docker inspect -f '{{.Image}}' "$OLD_WORKER")

docker tag "$OLD_WORKER_IMAGE" \
  startcloudsai-worker:rollback-$RELEASE_ID
docker tag startcloudsai-candidate-server:$RELEASE_ID \
  startcloudsai-worker:latest

cd "$RELEASE_DIR"
docker compose --env-file .env \
  -p startcloudsai \
  up -d --no-build --no-deps worker
```

`stop_grace_period: 15m` 会让旧 Worker 停止领取新任务，并等待在途任务完成。不要中断命令。

验证：

```bash
docker compose --env-file .env -p startcloudsai ps worker
docker compose --env-file .env -p startcloudsai \
  logs --since=5m --tail=120 worker

NEW_WORKER=$(docker compose --env-file .env -p startcloudsai ps -q worker)
docker inspect -f \
  'worker image={{.Image}} status={{.State.Status}} restart={{.RestartCount}}' \
  "$NEW_WORKER"

curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsS http://127.0.0.1:8081/api/v1/health
```

日志必须出现 `worker ready`，状态为 `running`，重启次数为 `0`。

## 11. 检查宝塔 Nginx

画布模板 ZIP 最大为 128 MiB。宝塔站点 `server {}` 必须包含：

```nginx
client_max_body_size 131m;
```

检查 Nginx 和实际代理文件：

```bash
NGINX=/www/server/nginx/sbin/nginx
SITE_CONF=/www/server/panel/vhost/nginx/starcloudisai.com.conf
BACKUP_ROOT=$(ls -dt /www/backup/startcloudsai/predeploy-* | head -1)

"$NGINX" -t
grep -nE 'server_name|client_max_body_size' "$SITE_CONF"

"$NGINX" -T 2>&1 | awk '
  /^# configuration file / { current=$0 }
  /proxy_pass http:\/\/127\.0\.0\.1:8080/ {
    print current
    print $0
  }
'
```

记录输出的真实代理文件路径并设置：

```bash
# 替换为上一步输出的实际文件路径。
export PROXY_CONF=/www/server/panel/vhost/nginx/proxy/实际目录/实际配置.conf
test -f "$PROXY_CONF"
cp -a "$SITE_CONF" "$BACKUP_ROOT/nginx-site-before-$RELEASE_ID.conf"
cp -a "$PROXY_CONF" "$BACKUP_ROOT/nginx-proxy-before-$RELEASE_ID.conf"
```

若 `client_max_body_size 131m;` 不存在，先在宝塔站点配置的 `server {}` 中添加，执行
`nginx -t` 成功后再 reload。已有该配置时不要重复添加。

## 12. 公网切换到候选 8081

以下脚本只替换活动的 `proxy_pass`，忽略注释行；任一检查失败会恢复 `8080`：

```bash
set -euo pipefail

NGINX=/www/server/nginx/sbin/nginx
BACKUP_ROOT=$(ls -dt /www/backup/startcloudsai/predeploy-* | head -1)
PROXY_BACKUP="$BACKUP_ROOT/nginx-proxy-before-$RELEASE_ID.conf"

rollback_proxy() {
  trap - ERR
  echo "验证失败，自动恢复到 8080"
  cp -a "$PROXY_BACKUP" "$PROXY_CONF"
  "$NGINX" -t
  "$NGINX" -s reload
}

trap rollback_proxy ERR

sed -i -E \
  's#^([[:space:]]*proxy_pass[[:space:]]+)http://127\.0\.0\.1:8080;#\1http://127.0.0.1:8081;#' \
  "$PROXY_CONF"

test "$(grep -Ec '^[[:space:]]*proxy_pass[[:space:]]+http://127\.0\.0\.1:8081;' "$PROXY_CONF")" -eq 1
test "$(grep -Ec '^[[:space:]]*proxy_pass[[:space:]]+http://127\.0\.0\.1:8080;' "$PROXY_CONF")" -eq 0

"$NGINX" -t
"$NGINX" -s reload

curl -fsS --max-time 10 https://starcloudisai.com/api/v1/health
curl -fsSI --max-time 10 https://starcloudisai.com/
curl -fsSI --max-time 10 https://starcloudisai.com/admin/
curl -fsS --max-time 10 http://127.0.0.1:8080/api/v1/health

trap - ERR
echo "PUBLIC TRAFFIC -> 8081: OK"
```

Nginx reload 会让旧 worker 进程继续处理已有连接，新请求进入 `8081`。

## 13. 候选环境业务验收

公网进入 `8081` 后，旧 `8080` 必须保持运行。至少验收：

1. 首页和创作台正常打开。
2. 无限画布项目、节点、连接线和图片正常。
3. AI 助手历史记录、对话和 Agent 页面正常。
4. 文生图和全屏预览页面可正常打开。
5. 管理端可登录。
6. 后台上传带图片的无限画布 ZIP，模板保存成功。
7. 模板封面正常，重新打开模板后节点图片仍存在。
8. 发布实际模板后，用户端可打开并看到模板图片。

观察候选日志：

```bash
cd "$RELEASE_DIR"
docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  logs -f --since=1m server gateway
```

重点检查 `413`、`500`、`502`、panic、数据库错误和对象存储错误。按 `Ctrl+C` 只退出日志
查看，不会停止容器。

## 14. 更新正式 8080

此时公网由 `8081` 承接。先保存旧 Server、用户端和管理端镜像：

```bash
OLD_ROOT=/www/wwwroot/startcloudsai

OLD_SERVER=$(cd "$OLD_ROOT" && docker compose --env-file .env -p startcloudsai ps -q server)
OLD_WEB=$(cd "$OLD_ROOT" && docker compose --env-file .env -p startcloudsai ps -q web)
OLD_ADMIN=$(cd "$OLD_ROOT" && docker compose --env-file .env -p startcloudsai ps -q admin)

docker tag "$(docker inspect -f '{{.Image}}' "$OLD_SERVER")" \
  startcloudsai-server:rollback-$RELEASE_ID
docker tag "$(docker inspect -f '{{.Image}}' "$OLD_WEB")" \
  startcloudsai-web:rollback-$RELEASE_ID
docker tag "$(docker inspect -f '{{.Image}}' "$OLD_ADMIN")" \
  startcloudsai-admin:rollback-$RELEASE_ID

docker tag startcloudsai-candidate-server:$RELEASE_ID startcloudsai-server:latest
docker tag startcloudsai-candidate-web:$RELEASE_ID startcloudsai-web:latest
docker tag startcloudsai-candidate-admin:$RELEASE_ID startcloudsai-admin:latest
```

只更新无状态正式服务，不触碰 PostgreSQL、Redis 和已更新的 Worker：

```bash
cd "$RELEASE_DIR"

docker compose --env-file .env -p startcloudsai \
  up -d --no-build --no-deps server web admin

NEW_SERVER=$(docker compose --env-file .env -p startcloudsai ps -q server)

for i in $(seq 1 90); do
  STATUS=$(docker inspect -f '{{.State.Health.Status}}' "$NEW_SERVER")
  [ "$STATUS" = "healthy" ] && break
  sleep 2
done

test "$(docker inspect -f '{{.State.Health.Status}}' "$NEW_SERVER")" = "healthy"
```

复制旧哈希资源并更新正式网关：

```bash
NEW_WEB=$(docker compose --env-file .env -p startcloudsai ps -q web)
NEW_ADMIN=$(docker compose --env-file .env -p startcloudsai ps -q admin)

docker cp "$LEGACY_ASSETS/web/." \
  "$NEW_WEB":/usr/share/nginx/html/assets/
docker cp "$LEGACY_ASSETS/admin/." \
  "$NEW_ADMIN":/usr/share/nginx/html/admin/assets/

docker compose --env-file .env -p startcloudsai \
  up -d --no-build --no-deps gateway
```

验证正式环境：

```bash
docker compose --env-file .env -p startcloudsai ps
docker compose --env-file .env -p startcloudsai \
  logs --since=5m --tail=120 server gateway

curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsSI http://127.0.0.1:8080/
curl -fsSI http://127.0.0.1:8080/admin/
curl -fsS https://starcloudisai.com/api/v1/health
free -h
```

## 15. 公网切回正式 8080

正式 `8080` 验证通过后保存当前 `8081` 配置。失败时自动恢复候选环境：

```bash
set -euo pipefail

NGINX=/www/server/nginx/sbin/nginx
BACKUP_ROOT=$(ls -dt /www/backup/startcloudsai/predeploy-* | head -1)
CANDIDATE_PROXY_BACKUP="$BACKUP_ROOT/nginx-proxy-8081-$RELEASE_ID.conf"

cp -a "$PROXY_CONF" "$CANDIDATE_PROXY_BACKUP"

rollback_to_8081() {
  trap - ERR
  echo "正式环境验证失败，自动恢复到 8081"
  cp -a "$CANDIDATE_PROXY_BACKUP" "$PROXY_CONF"
  "$NGINX" -t
  "$NGINX" -s reload
}

trap rollback_to_8081 ERR

sed -i -E \
  's#^([[:space:]]*proxy_pass[[:space:]]+)http://127\.0\.0\.1:8081;#\1http://127.0.0.1:8080;#' \
  "$PROXY_CONF"

test "$(grep -Ec '^[[:space:]]*proxy_pass[[:space:]]+http://127\.0\.0\.1:8080;' "$PROXY_CONF")" -eq 1
test "$(grep -Ec '^[[:space:]]*proxy_pass[[:space:]]+http://127\.0\.0\.1:8081;' "$PROXY_CONF")" -eq 0

"$NGINX" -t
"$NGINX" -s reload

curl -fsS --max-time 10 https://starcloudisai.com/api/v1/health
curl -fsSI --max-time 10 https://starcloudisai.com/
curl -fsSI --max-time 10 https://starcloudisai.com/admin/
curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsS http://127.0.0.1:8081/api/v1/health

trap - ERR
echo "PUBLIC TRAFFIC -> 8080: OK"
```

再次用浏览器验收首页、无限画布、AI 助手、后台和模板保存。此时仍不要立即关闭候选环境。

## 16. 标准目录与候选环境收尾

正式环境稳定后，让标准目录指向独立发布目录。不要移动 `$RELEASE_DIR`，因为正式 Gateway
的只读绑定源仍指向该真实路径；移动后容器下次重启可能找不到 `deploy/nginx.conf`。

```bash
set -euo pipefail

export STANDARD_DIR=/www/wwwroot/startcloudsai
export OLD_CODE_BACKUP=/www/wwwroot/startcloudsai-backup-before-$RELEASE_ID

BACKUP_ROOT=$(ls -dt /www/backup/startcloudsai/predeploy-* | head -1)

cd "$RELEASE_DIR"
docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  logs --no-color > "$BACKUP_ROOT/candidate-final.log"

cd /www/wwwroot
test -d "$STANDARD_DIR"
test ! -e "$OLD_CODE_BACKUP"
test -d "$RELEASE_DIR"

mv "$STANDARD_DIR" "$OLD_CODE_BACKUP"

if ! ln -s "$RELEASE_DIR" "$STANDARD_DIR"; then
  mv "$OLD_CODE_BACKUP" "$STANDARD_DIR"
  exit 1
fi

test "$(readlink -f "$STANDARD_DIR")" = "$RELEASE_DIR"
test "$(stat -c '%a' "$STANDARD_DIR/.env")" = "600"
```

关闭候选环境，不使用 `-v`：

```bash
cd /www/wwwroot/startcloudsai

docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  down

if curl -fsS --max-time 3 http://127.0.0.1:8081/api/v1/health; then
  echo "错误：候选 8081 仍在运行"
  exit 1
else
  echo "candidate 8081 stopped: OK"
fi

docker compose --env-file .env -p startcloudsai ps
curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsS https://starcloudisai.com/api/v1/health
free -h
df -h /
```

## 17. 发布完成标准

以下条件全部满足才算完成：

- 公网代理指向 `127.0.0.1:8080`。
- 正式 Server 为 `healthy`，其余正式容器均为 `Up`。
- Worker 日志包含 `worker ready`，没有持续重启。
- PostgreSQL、Redis 和公网健康接口均为 `ok`。
- 候选 `8081` 已停止。
- 标准路径正确指向本次 `$RELEASE_DIR`。
- 首页、无限画布、AI 助手、后台和模板保存均完成浏览器验收。
- 备份、旧代码和 rollback 镜像仍然存在。

## 18. 回滚

### 18.1 候选验证阶段失败

公网仍在 `8080` 时，直接关闭候选环境：

```bash
cd "$RELEASE_DIR"
docker compose --env-file .env \
  -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  down
```

如果 Worker 已滚动，重新标记并启动旧 Worker：

```bash
docker tag startcloudsai-worker:rollback-$RELEASE_ID \
  startcloudsai-worker:latest

cd /www/wwwroot/startcloudsai
docker compose --env-file .env -p startcloudsai \
  up -d --no-build --no-deps worker
```

### 18.2 公网已经切到 8081

正式更新失败时不要关闭候选环境。保持公网 `8081`，排查或用 rollback 镜像恢复正式服务：

```bash
docker tag startcloudsai-server:rollback-$RELEASE_ID startcloudsai-server:latest
docker tag startcloudsai-web:rollback-$RELEASE_ID startcloudsai-web:latest
docker tag startcloudsai-admin:rollback-$RELEASE_ID startcloudsai-admin:latest

OLD_ROOT=/www/wwwroot/startcloudsai
cd "$OLD_ROOT"
docker compose --env-file .env -p startcloudsai \
  up -d --no-build --no-deps server web admin gateway
```

正式 `8080` 恢复并验证后，再把宝塔代理切回 `8080`。

### 18.3 已完成收尾后回滚代码

先恢复或重新启动候选 `8081` 承接流量。确认旧代码兼容当前数据库迁移后：

```bash
STANDARD_DIR=/www/wwwroot/startcloudsai
OLD_CODE_BACKUP=/www/wwwroot/startcloudsai-backup-before-$RELEASE_ID

test -L "$STANDARD_DIR"
test -d "$OLD_CODE_BACKUP"
unlink "$STANDARD_DIR"
mv "$OLD_CODE_BACKUP" "$STANDARD_DIR"
```

再使用 rollback 镜像或旧源码重建正式无状态服务。代码回滚不会自动撤销数据库迁移。

### 18.4 数据库恢复

数据库恢复会覆盖发布后新增的业务数据，只能在明确维护窗口执行。恢复前再次备份当前数据库：

```bash
cd /www/wwwroot/startcloudsai
docker compose --env-file .env stop server worker

BACKUP_ROOT=/www/backup/startcloudsai/实际备份目录
gunzip -c "$BACKUP_ROOT/postgres.sql.gz" \
  | docker compose --env-file .env exec -T postgres \
    psql -U starclouds -d starclouds

docker compose --env-file .env start server worker
```

Redis 快照仅在确认需要恢复队列和会话状态时使用，不能在 Worker 运行期间直接覆盖数据目录。

## 19. 备份保留与清理

至少保留 7 天：

```text
/www/wwwroot/startcloudsai-backup-before-<RELEASE_ID>
/www/backup/startcloudsai/predeploy-*
startcloudsai-server:rollback-<RELEASE_ID>
startcloudsai-worker:rollback-<RELEASE_ID>
startcloudsai-web:rollback-<RELEASE_ID>
startcloudsai-admin:rollback-<RELEASE_ID>
```

确认 7 天内没有回滚需求后，逐项核对再清理。不要使用全局 prune 命令代替定向清理。

## 20. 常见问题

### 模板保存返回 413

同时检查两层限制：

1. 宝塔站点 `server {}` 中存在 `client_max_body_size 131m;`。
2. 正式 Gateway 使用当前版本 `deploy/nginx.conf`。

修改 Gateway 配置后只重建 Gateway：

```bash
docker compose --env-file .env -p startcloudsai \
  up -d --no-build --no-deps gateway
```

### 候选 Gateway 出现只读配置提示

Nginx 入口脚本可能打印无法修改只读 `default.conf`。如果随后出现 `Configuration complete`、
Gateway 为 `Up` 且 `8081` 返回 200，则该提示不是故障。

### Server 不健康

```bash
docker compose --env-file .env -p startcloudsai_candidate \
  -f deploy/docker-compose.candidate.yml \
  logs --since=10m --tail=200 server
```

重点检查数据库迁移、R2 配置、Redis、生产 `.env` 和允许来源配置。

### 页面更新后旧 chunk 404

确认用户端和管理端旧 `assets` 已分别复制到候选和正式容器。不要复制旧 `index.html`，只复制
哈希资源目录。

### 服务器资源不足

停止后续构建，不停止现有生产容器。优先改为在与服务器相同架构的平台构建镜像后上传，或
安排维护窗口；不要在低内存服务器上并行构建。
