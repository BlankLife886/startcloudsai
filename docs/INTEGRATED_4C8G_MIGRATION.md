# 4C8G 一体化部署与迁移手册

本文用于把 StartCloudsAI、ChatGPT2API 3.0、PostgreSQL 18 和 Redis 部署到同一台
4 核 8 GB 服务器，并把对象存储从 Cloudflare R2 迁移到阿里云香港 OSS。它不包含
任何生产密钥或本地业务数据。

## 1. 目标架构

```text
Browser -> CDN / HTTPS Nginx -> StartCloud gateway
                                  |-> Web / Admin / Go API
                                  |-> Worker -> chatgpt2api:80 (Docker internal network)
                                  |             -> ChatGPT upstream
                                  |-> PostgreSQL 18 / starclouds
                                  |-> Redis

ChatGPT2API -> PostgreSQL 18 / chatgpt2api
API + Worker -> Alibaba Cloud OSS Hong Kong internal endpoint
```

PostgreSQL 只有一个实例，但两个应用使用不同数据库、不同 owner 和不同密码。
ChatGPT2API 不通过公网域名给 Worker 回调，避免公网 DNS、TLS、Nginx 和回环带来的
额外排队。PostgreSQL、Redis 和应用数据库端口均不对公网开放。

## 2. 资源边界

| 服务 | 内存硬上限 | CPU 配额 |
| --- | ---: | ---: |
| PostgreSQL 18 | 1280 MB | 1.25 |
| Redis | 384 MB | 0.40 |
| ChatGPT2API | 1536 MB | 1.25 |
| StartCloud API | 768 MB | 0.75 |
| StartCloud Worker | 2304 MB | 1.75 |
| Web、Admin、Gateway | 512 MB 合计 | 0.65 合计 |

CPU 配额允许不同服务在不同阶段使用 CPU，并不要求它们的峰值同时发生。容器上限
合计约 6.7 GB，给系统、Docker、页缓存和网络缓冲保留约 1.3 GB。先以
`CHATGPT2API_THREAD_TOKENS=120` 压测；`500` 只作为单独的高负载实验值，不能在
没有 RSS、线程池排队和上游失败率证据时直接用于生产。

一体化 Compose 还将所有容器限制在 CPU `0-3`。在 CPU 数量多于 4 的开发机上，这能
模拟 4 核服务器的全局 CPU 竞争；部署到实际 4 核服务器时保持相同配置即可。

## 3. 本地一体化验证

前置条件：Docker Desktop 已启动，ChatGPT2API 干净工作树位于独立目录。

```bash
cd /path/to/startcloudsai
cp deploy/integrated/.env.integrated.example deploy/integrated/.env.integrated
openssl rand -hex 32
```

把不同随机值分别填入环境文件。`CHATGPT2API_SOURCE_DIR` 必须是绝对路径；OSS 必须
使用单独开发 bucket，严禁填写生产数据库、生产 Redis 或生产 OSS bucket。

```bash
docker compose \
  --env-file deploy/integrated/.env.integrated \
  -f deploy/integrated/docker-compose.yml config --quiet

docker compose \
  --env-file deploy/integrated/.env.integrated \
  -f deploy/integrated/docker-compose.yml up -d --build

docker compose \
  --env-file deploy/integrated/.env.integrated \
  -f deploy/integrated/docker-compose.yml ps

curl -fsS http://127.0.0.1:8080/api/v1/health
curl -fsS http://127.0.0.1:3000/version
```

确认数据库隔离：

```bash
docker compose --env-file deploy/integrated/.env.integrated \
  -f deploy/integrated/docker-compose.yml exec -T postgres \
  psql -U postgres -d postgres -c '\l'
```

必须同时看到 `starclouds` 和 `chatgpt2api`，owner 不同。

## 4. PostgreSQL 17 到 18

PG17 的 `/var/lib/postgresql/data` 不能直接挂载到 PG18。迁移只能使用逻辑备份或
`pg_upgrade`；本项目采用更容易校验和回滚的 `pg_dump` / `pg_restore`。

先从当前 PG17 Compose 导出：

```bash
sh deploy/integrated/scripts/export-startcloud-pg17.sh
sha256sum -c .artifacts/database-migration/startcloud-pg17-*.dump.sha256
```

仅在隔离的一体化 PG18 目标库中恢复：

```bash
ALLOW_DESTRUCTIVE_PG18_RESTORE=yes \
INTEGRATED_ENV_FILE=deploy/integrated/.env.integrated \
sh deploy/integrated/scripts/restore-startcloud-pg18.sh \
  .artifacts/database-migration/startcloud-pg17-YYYYMMDDTHHMMSSZ.dump
```

恢复脚本会停止一体化栈中的 API/Worker、重建 `starclouds` 数据库、恢复后再启动；它
不会操作旧 PG17 数据卷。迁移演练必须核对用户数、任务数、账本行数、模板数和最新
任务时间，不能只看健康检查。

## 5. ChatGPT2API SQLite 到 PostgreSQL

目标 `chatgpt2api` 数据库必须为空，且迁移时 ChatGPT2API 旧实例不能继续写 SQLite。
先使用 SQLite 在线备份命令生成一致副本，不能在写入期间直接复制数据库文件：

```bash
sqlite3 /path/to/chatgpt2api.db ".backup '/safe/path/chatgpt2api-migration.db'"
```

然后执行一次性迁移：

```bash
ALLOW_CHATGPT2API_SQLITE_MIGRATION=yes \
INTEGRATED_ENV_FILE=deploy/integrated/.env.integrated \
sh deploy/integrated/scripts/migrate-chatgpt2api-sqlite.sh \
  /safe/path/chatgpt2api-migration.db
```

迁移工具通过容器内的 `uv` 虚拟环境逐表批量写入、同步 PostgreSQL 自增序列，并在目标任意业务表已有数据时拒绝
执行。完成后核对账号、Auth Key、系统设置、线路、日志和图片任务数量。

## 6. R2 到阿里云 OSS

生产建议创建香港地域私有 bucket，使用专用 RAM 子账号和最小读写权限。生产 ECS：

```env
OBJECT_STORAGE_ENDPOINT=https://s3.oss-cn-hongkong-internal.aliyuncs.com
OBJECT_STORAGE_PUBLIC_ENDPOINT=https://s3.oss-cn-hongkong.aliyuncs.com
OBJECT_STORAGE_REGION=cn-hongkong
OBJECT_STORAGE_USE_PATH_STYLE=false
OBJECT_STORAGE_CDN_BASE_URL=https://<CDN 域名>
OBJECT_STORAGE_CDN_AUTH_KEY=<CDN Type A 主密钥>
OBJECT_STORAGE_CDN_AUTH_TTL_SECS=900
```

本地或非香港 ECS 不能使用 internal endpoint，应使用：

```env
OBJECT_STORAGE_ENDPOINT=https://s3.oss-cn-hongkong.aliyuncs.com
OBJECT_STORAGE_PUBLIC_ENDPOINT=
```

迁移对象采用“两次同步”：在线期间先全量复制，切换前暂停新任务和删除操作后再同步
增量。必须保持 object key、Content-Type 和对象内容不变，并核对总对象数、总字节数及
随机抽样 SHA-256。旧 R2 bucket 至少保留到 OSS 稳定运行和回滚窗口结束，期间只读，
不能立即删除。

CDN 回源应指向私有 OSS bucket 并开启“阿里云 OSS 私有 Bucket 回源”。普通图片请求
始终先访问稳定的 `/api/v1/files/{key}`，由 Go 服务完成属主/公开权限校验；鉴权通过后
才返回阿里云 CDN Type A 短期签名 URL。CDN Type A 主密钥和有效时长必须分别与
`OBJECT_STORAGE_CDN_AUTH_KEY`、`OBJECT_STORAGE_CDN_AUTH_TTL_SECS` 一致，密钥只放
服务器环境变量。缓存参数规则应忽略 `auth_key` 形成的差异并按对象路径命中，同时保留
CDN URL 鉴权。版本化对象 key 使用长期缓存，旧固定 key 使用短缓存；更新图片依靠新 key，
不调用 CDN 刷新 API。`?download=1` 和 `?origin=1` 继续由 Go 服务代理。

未配置 CDN 鉴权密钥时自动保持原有对象代理，可先部署代码再单独启用 CDN。启用后必须
验证无权限用户仍为 `401/404`、属主查看为 `302`、下载不重定向，并检查 CDN `X-Cache`
从首次 `MISS` 转为后续 `HIT`，再扩大流量。

## 7. 生产切换

1. 升级到 4C8G 后先确认 4 GB Swap、磁盘空间、Docker 和 200M 带宽。
2. 对 PG17、Redis、ChatGPT2API SQLite/config 和 R2 清单分别备份并校验。
3. 用旧数据的脱敏副本完成一次 PG18、SQLite 和 OSS 全流程演练。
4. 候选栈使用不同的网关端口启动，旧栈继续服务。
5. 切换窗口暂停创建任务，停止旧 Worker/API，做最终 PG17 dump、SQLite backup 和 OSS 增量同步。
6. 恢复到全新 PG18 卷，启动候选 API、ChatGPT2API 和 Worker，执行健康与业务冒烟。
7. 只修改宿主机 Nginx upstream 指向候选网关并 reload，不重启宿主机 Nginx。
8. 观察错误率、队列延迟、上游完成到平台完成差值、RSS、数据库等待和 OSS 首字节时间。

数据库大版本切换存在短暂写入窗口，不能宣称完全零停机。若需要秒级切换，应另行设计
PG17 到 PG18 逻辑复制；在当前数据量未知前，不把它作为默认方案。

### 7.1 一体化环境后端零停机更新

一体化部署不能使用仓库根目录的旧版候选 Compose。后端更新应使用
`deploy/integrated/docker-compose.candidate.yml`：候选 API 在 `8081` 提供服务，复用
正式 PostgreSQL、Redis、Web 和 Admin，但不启动第二个 Worker。

把正式 `deploy/integrated/.env.integrated` 以权限 `600` 复制到独立发布目录的相同位置，
并先启动候选 API/网关：

```bash
export RELEASE_ID=<新提交短哈希>
export RELEASE_DIR=/www/wwwroot/releases/$RELEASE_ID/startcloudsai
export INTEGRATED_APP_ENV_FILE=$RELEASE_DIR/deploy/integrated/.env.integrated

docker compose --env-file "$INTEGRATED_APP_ENV_FILE" \
  -f "$RELEASE_DIR/deploy/integrated/docker-compose.candidate.yml" build server
docker compose --env-file "$INTEGRATED_APP_ENV_FILE" \
  -f "$RELEASE_DIR/deploy/integrated/docker-compose.candidate.yml" up -d --no-build server gateway
curl -fsS http://127.0.0.1:8081/api/v1/health
curl -fsSI http://127.0.0.1:8081/
curl -fsSI http://127.0.0.1:8081/admin/
```

候选通过后，把宝塔外层反向代理从 `8080` 切到 `8081` 并 reload。再把候选 Server 镜像
标记为正式 Server/Worker 镜像，并从发布目录仅重建后端：

```bash
docker tag startcloudsai-integrated-candidate-server:$RELEASE_ID startcloudsai-integrated-server:latest
docker tag startcloudsai-integrated-candidate-server:$RELEASE_ID startcloudsai-integrated-worker:latest

cd "$RELEASE_DIR"
docker compose --env-file deploy/integrated/.env.integrated \
  -f deploy/integrated/docker-compose.yml up -d --no-build --no-deps server
docker compose --env-file deploy/integrated/.env.integrated \
  -f deploy/integrated/docker-compose.yml up -d --no-build --no-deps worker
```

Worker 会停止领取新任务并等待在途任务结束，最多等待 15 分钟；不要中断该命令。正式
`8080` 健康后把宝塔代理切回 `8080`，再关闭候选环境。禁止执行 `down -v`：

```bash
curl -fsS http://127.0.0.1:8080/api/v1/health
docker compose --env-file "$INTEGRATED_APP_ENV_FILE" \
  -f "$RELEASE_DIR/deploy/integrated/docker-compose.candidate.yml" down
```

## 8. 验收与回滚

用同一组 20 个真实任务记录四个时间点：提交成功、上游开始、上游完成、平台完成。
验收标准：无重复扣费、无假失败、无卡住任务、无重复图片，且“平台完成减上游完成”
P95 不超过 20 秒。结果回收慢时分别检查 ChatGPT2API SSE 尾部、Worker 轮询、OSS 上传
和数据库提交，不用总生成耗时掩盖阶段问题。

切换后旧 PG17 卷、旧 SQLite 和旧 R2 都保持只读。若候选栈异常，先停止候选写入，再
把 Nginx 切回旧栈。注意：切换后已经写入 PG18 的新数据不会自动回到 PG17；因此回滚
决定必须在受控验收窗口内做出，或准备反向数据补偿方案。
