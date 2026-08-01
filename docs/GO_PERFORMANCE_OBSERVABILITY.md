# Go 性能与实时可观测性

本文说明 API/Worker 的实时指标、资源预算、pprof、Race Detector、Benchmark 与 PGO 工作流。所有业务接口仍使用 `/api/v1`，性能设施不改变任务、钱包或图片数据。

## 后台实时指标

管理员仪表盘每 5 秒读取 `GET /api/v1/admin/system/metrics`，页面不可见时停止轮询，并在浏览器内保留最近 5 分钟趋势。接口要求独立管理员 Cookie，用户 Cookie 无权访问。

指标包括：

- API：近 60 秒请求速率、在途请求、2xx/4xx/5xx、平均/P95/最大延迟。健康检查、指标接口自身和 SSE 长连接不计入窗口；进程启动不足 60 秒时使用实际窗口。
- Runtime：Go 版本、进程运行时间、CPU 使用率、GOMAXPROCS、Goroutine、Heap/Stack、GC 次数与 GC CPU。
- PostgreSQL：最大、总计、占用、空闲、构建中连接数，连接池利用率、等待和取消次数。
- Asynq：队列积压、活跃/计划/重试/归档任务、队列延迟、当日处理与失败数。
- Worker：Redis 心跳可见的实例、PID、状态、并发槽和活跃槽。
- 任务压力：数据库 queued/running、全站在途上限、Worker 短操作槽和单用户执行配额。
- 服务商容量：每条启用线路的 running、`maxConcurrency` 和实时利用率。

请求指标使用固定 60 槽滚动窗口和延迟直方图，内存占用恒定，不保存 URL、用户信息或请求体。

## 资源预算

Compose 为 API 配置 `1 CPU / 1 GiB`，为 Worker 配置 `2 CPU / 2 GiB`。对应默认软预算：

```env
SERVER_GOMEMLIMIT=900MiB
WORKER_GOMEMLIMIT=1700MiB
SERVER_DB_MAX_CONNS=10
SERVER_DB_MIN_CONNS=1
WORKER_DB_MAX_CONNS=5
WORKER_DB_MIN_CONNS=1
WORKER_IMAGE_MEMORY_MIB=1024
WORKER_CONCURRENCY=32
DB_MAX_CONN_LIFETIME=30m
DB_MAX_CONN_IDLE_TIME=5m
DB_HEALTH_CHECK_PERIOD=1m
```

`WORKER_CONCURRENCY` 是提交、聚合轮询和图片持久化的短操作工作池；`global_max_concurrent_tasks` 是上游在途任务上限，默认 2000，不再受 Worker 槽位数限制。OpenAI/C2A 每个服务商每次最多批量查询 100 个任务，CRUN 服务商执行集中式单轮查询。服务商自己的 `maxConcurrency` 决定分流容量。`GOMEMLIMIT` 低于容器硬上限，为 Go Runtime、线程栈、网络缓冲和非 Go 内存保留空间。

## 私有 pprof

Docker 内 API 与 Worker 各自在自己的容器回环地址 `127.0.0.1:6060` 提供 pprof。代码拒绝 `0.0.0.0`、容器网卡 IP 或其他非回环地址，nginx 也没有代理 `/debug/pprof`。

采集 API CPU Profile：

```bash
docker compose --env-file .env exec -T server \
  wget -qO /tmp/api-cpu.pprof 'http://127.0.0.1:6060/debug/pprof/profile?seconds=30'
docker cp "$(docker compose --env-file .env ps -q server):/tmp/api-cpu.pprof" ./api-cpu.pprof
go tool pprof -http=127.0.0.1:0 ./api-cpu.pprof
```

将 `server` 换成 `worker` 可采集 Worker。Heap、Goroutine、Mutex 与 Block Profile 分别使用 `/debug/pprof/heap`、`goroutine`、`mutex`、`block`。Profile 可能包含函数名和运行特征，只能作为内部运维文件处理。

直接运行二进制时，分别设置不同端口，避免 API 与 Worker 冲突：

```env
API_PPROF_ADDR=127.0.0.1:6060
WORKER_PPROF_ADDR=127.0.0.1:6061
```

## Benchmark 与 Race Detector

运行全部测试和数据竞争检测：

```bash
cd apps/server
go test ./...
go test -race ./...
go test -run '^$' -bench=. -benchmem ./...
```

CI 会执行 `go test -race ./...`。Race 二进制有明显开销，只用于测试，不部署到生产。

比较优化前后的 Benchmark 时至少各运行 10 次，并使用 `benchstat`，不要根据单次结果调参。

## PGO

PGO 必须使用代表真实负载的 CPU Profile。API 与 Worker 使用同一主包但负载不同，应在业务高峰分别采样，然后按实际资源占比合并：

```bash
go tool pprof -proto api-cpu.pprof worker-cpu.pprof > apps/server/cmd/server/default.pgo
cd apps/server
go build -o server ./cmd/server
go version -m server | grep pgo
```

`go build` 会自动发现主包目录中的 `default.pgo`。启用前必须用相同压测比较吞吐、P95/P99、RSS 和 GC CPU；Profile 明显过期或业务发生大规模重构后重新采集。仓库当前不提交人工生成的 Profile，因此不会在缺少真实负载证据时宣称 PGO 已优化。

## 告警参考线

- API 5xx：连续两个采样窗口大于 0 时检查日志和上游。
- API P95：相对同时间段基线持续上升 50% 时排查数据库、Redis 和外部请求。
- 内存：持续超过 `GOMEMLIMIT` 的 85% 时采集 Heap Profile。
- 数据库：连接池利用率持续超过 80%，且等待次数持续增长时才考虑调大。
- 队列：Pending 持续增长时检查提交/轮询/持久化耗时；服务商 running 接近容量时增加等价线路。
- Worker：在线实例为 0 或队列 Paused 时立即处理。

这些阈值是起始参考，不替代基于真实业务流量建立的基线。
