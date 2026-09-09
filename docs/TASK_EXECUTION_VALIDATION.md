# 任务执行独立验证

验证日期：2026-09-09。7 组独立链路全部通过，共 44 个顶层测试；Go 链路启用数据竞争检测。相关后端包、Web、画布及 Flutter 回归也通过。

验证使用本机独立临时 PostgreSQL 数据库、模拟上游 HTTP 和对象存储。执行池检查启动专用 Redis 进程，使用独立 Unix socket，不接入开发 Redis。数据库迁移只在临时测试库执行；没有修改业务库、调用收费供应商或部署线上。

## 发现并修复的问题

并发创建执行快照时，`modelconfig.normalize` 会通过共享的切片修改调用方配置。一个请求读取配置并序列化快照，另一个请求同时整理同一配置，就会发生数据竞争。`TestExecutionSnapshotBindingIsAtomicImmutableAndCleanedOnDelete` 在 `-race` 下复现了该问题。

修复为：整理配置前复制供应商、线路和模型的可写容器；整理推理价格前复制价格对象。配置查询不再改动调用方共享数据，同时保留模型内部的显式配置标记。相同并发测试复验通过，完整模型配置与 Worker 回归通过。

初轮失败中还包含旧测试约定和准备数据问题，分别修正，没有降低实际执行约束：

- 原测试把聊天与图片混算，现改为图片入口共享额度、聊天独立验证，订阅加成仅影响图片。
- 原测试只往 Worker 内存缓存放模型配置，现在按真实执行路径写入测试数据库，再验证不可变绑定。
- 原测试期待显式生图模式在问候语下变成聊天，现在验证执行类型不会在领取名额后改变。

失败原始记录保留在 `.artifacts/execution-validation.QNHPdo/`，包括 `baseline-worker.log`、`snapshot-round1.log` 和 `worker-model-regression.log`；相应成功复验见 `snapshot-round2.log`、`worker-model-round2.log` 及下列独立报告。

## 独立链路结果

| 编号 | 验证目标 | 顶层测试数 | 结果 |
| --- | --- | ---: | --- |
| E-01 | 跨入口图片计数、聊天分池、账户/全局/线路容量、多 Worker 同时领取、订阅加成 | 8 | 通过 |
| E-02 | C2A/CRUN 已知任务恢复、保留名额、降低额度或停用线路后恢复、旧执行权拒绝、超时与手动重试区别 | 4 | 通过 |
| E-03 | 修改模型地址/密钥/价格后实际 HTTP 请求仍使用原配置；并发绑定、禁止覆盖、删除清理 | 2 | 通过 |
| E-04 | 超量请求返回 422 且无冻结残留；幂等重放、排队编辑、取消退款；拒绝伪造恢复标识 | 3 | 通过 |
| E-05 | 助手多图实际模拟提交与保存；CRUN 部分提交、未知受理不重发及差额退款 | 4 | 通过 |
| E-06 | Web 数量限制、模型切换不修改历史数据、任务观察、重试与流式状态合并 | 22 | 通过 |
| E-07 | 图片执行槽位被阻塞时，独立聊天执行池仍能消费并完成请求 | 1 | 通过 |

这里的 44 项按顶层测试计数，不额外累计子用例，也不把后续完整包回归中的重复执行相加。

详细命令、时长和原始输出：

- [E-01 至 E-06 报告](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/task-chain-tests/2026-09-08T20-34-40-544Z/results.md)
- [E-07 执行池报告](/Users/ycc/Documents/TestCode/startcloudsai/.artifacts/task-chain-tests/2026-09-08T20-39-00-112Z/results.md)

## 相关回归

| 检查 | 结果 | 日志（相对仓库根目录） |
| --- | --- | --- |
| Worker、模型配置完整包，`go test -race` | 通过 | `.artifacts/execution-validation.QNHPdo/worker-model-round2.log` |
| taskflow、store、assistantbilling、httpapi 完整包，`go test -race` | 通过 | `.artifacts/execution-validation.QNHPdo/store-api-regression.log` |
| `go vet ./...` | 通过 | `.artifacts/execution-validation.QNHPdo/go-vet.log` |
| Web 助手/任务回归 | 22 项通过 | `.artifacts/execution-validation.QNHPdo/web-task-regression.log` |
| 画布工作流 | 72 项通过 | `.artifacts/execution-validation.QNHPdo/canvas-workflow.log` |
| 画布 Agent 图操作/工具/投递 | 113 项通过 | `.artifacts/execution-validation.QNHPdo/canvas-agent.log` |
| Flutter 助手、草稿、数量限制、任务生命周期及详情 | 76 项通过 | `.artifacts/execution-validation.QNHPdo/flutter-regression.log` |
| 相关补丁空白检查 | 通过 | `git diff --check` |

## 重跑方式

在仓库根目录运行。需要本机 PostgreSQL、Go、Node.js；E-07 另外需要 `redis-server` 可执行文件。运行器拒绝远程 `TEST_DATABASE_URL`，不会读取仓库 `.env`。没有命中实际通过的测试时，运行器会报告失败；缺少 Redis 导致 E-07 跳过，也不会算作通过。

```sh
node scripts/test-task-chains.mjs --list
node scripts/test-task-chains.mjs --only E-01,E-02,E-03,E-04,E-05,E-06,E-07

# 单独重跑恢复链路
node scripts/test-task-chains.mjs --only E-02
```

Flutter 相关回归在 `apps/mobile` 下执行：

```sh
flutter test --concurrency=1 --reporter expanded \
  test/features/assistant_execution_limits_test.dart \
  test/features/assistant_test.dart \
  test/features/assistant_draft_test.dart \
  test/features/task_lifecycle_test.dart \
  test/features/task_detail_test.dart
```

## 尚未覆盖的发布验证

本轮证明本地模拟链路符合已确认的资源与恢复规则，不代表生产供应商、Nginx 或浏览器端到端场景已验收。对上游没有明确回执的远端工作，也不宣称可以精确统计其实际存活状态。

下一步应在预发布核对真实代理超时、供应商协议与版本组合，再安排发布。迁移 `00145_execution_snapshots.sql`、API 与 Worker 需要匹配；发布时应制定旧 Worker 的任务排空与替换顺序，避免新旧调度规则长期混跑。更细的任务诊断信息与逐图执行记录属于后续改进，本轮没有实施这些扩展。

后续已完成仓库侧发布检查和隔离 Nginx 代理验证，结果及实际环境缺项见[发布前检查](./TASK_RELEASE_PREFLIGHT.md)。
