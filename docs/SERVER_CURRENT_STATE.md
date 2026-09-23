# 当前服务端行为基线

核对日期：2026-09-22。依据当前工作区源码及迁移文件，包含尚未提交的修改；本次仅更新文档，未启动服务、执行迁移、调用付费模型或验证生产状态。历史审计的测试数量、日志和本地端口只描述原记录时点。

## 三种执行入口

| 入口 | 执行和持久化 | 账务与恢复 |
| --- | --- | --- |
| `/api/v1/tasks`、`/api/open/v1/tasks` | PostgreSQL `tasks`、Asynq、Worker、私有对象存储 | 提交预留，按实际交付结算；任务 ID 查询、租约/上游尝试恢复。Open API 任务可投递 Webhook。 |
| `/api/v1/assistant/runs` | `assistant_runs`、对话/图片执行池、持久消息、SSE | `assistantbilling` 把状态变化与钱包操作放在同一事务；重试按 billing generation 区分。 |
| `/v1/images/generations`、`/v1/images/edits` | HTTP 直接调用 OpenAI 协议上游；不建站内任务、不存输入输出图片 | 按 Key 和幂等键关联 `openai_image_request` 账务；没有站内任务查询、后台回收或任务 Webhook。 |

`/v1/responses` 另提供对话、SSE、WebSocket 及图片工具的兼容子集。公开模型名、权限和受支持字段见 [开放 API](OPEN_API.md)。不能把 `/v1` 图片请求的超时解释成“稍后到站内历史取图”：上游结果重放依赖上游幂等能力。网络超时、断开和其他不确定失败会保留预留；确定失败可以释放。客户端须保存原幂等键和请求参数，避免以新键盲目重发。

## 支付与计费

- 支付路由已经注册：套餐查询、订单创建/列表/详情/关闭以及蓝鲸 `GET /api/v1/payments/lanjing/notify`。实际可售渠道取决于后台启用状态与有效配置。
- 订阅支持 24 小时独立批次、合同锁价、整期升级及人工核查退款，旧自然日周期兼容保留。已存在路由不等于真实渠道已配置或已完成验收。
- 助手不再是免费代理。对话、图片、Agent 使用模型/工作区价格与服务端最终执行信息结算；不要仅按原始 `mode` 推断实际扣费。
- 取消不是统一全退：准备期未提交上游可释放；图片/PPT/PSD 已提交后停止接收会保留相应费用，画布 Agent 可根据实际完成操作结算并退回未用部分。界面必须使用服务端 `cancelPolicy`，不能把本地停止监听冒充服务端取消。
- 成本利润账本覆盖 `task`、`assistant_run`、`developer_api`。失败或不确定调用的零收入/零成本记录不证明上游没有真实成本；历史数据不补造成本。

## 执行容量与资源

站内图片任务按 `max(work_units,count,1)` 计数；助手图片按张数，对话按 Run 数。图片和对话分别准入，用户基础图片/对话默认各 4；图片可叠加有效套餐及管理员并发加成。全局图片默认 2000，全局对话默认 128。Agent 还受独立闸门限制（全局默认 16、单用户默认 3），显式 `agent` 和 Worker 解析后的 `resolved_mode=agent` 都计入。

图片池由 `WORKER_CONCURRENCY` 控制，对话池由 `WORKER_CHAT_CONCURRENCY` 控制：Go 未配置变量时默认 32，但根目录/一体化 Compose 和 `.env.example` 当前提供默认 8。Agent 使用对话池并另受全局/个人限额限制；当有效对话池只有 8 而 Agent 全局上限为 16 时，不能声称一定给普通聊天保留半池，应联合核对实际配置。`WORKER_POLL_CONCURRENCY=0` 时依据图片内存预算和图片池推导轮询并发，也可显式设置。

开放任务 API 不使用网页交互的个人并发名额，仍受全局/线路任务容量及 Key 配额约束。标准 `/v1/images/*` 不占站内任务执行池；其上游排队与并发由上游处理，Key 限流和钱包校验仍然存在。

`execution_snapshots` 为已接受的站内任务保存模型、候选线路、加密凭据、能力和价格。恢复使用原连接快照；后台实时容量控制新准入，不能把已经持有的上游任务换成新地址重新创建。OpenAI/C2A 聚合查询按每批 20 个任务分批，并以信号量控制批次并发；已完成图片转交独立 5 分钟上下文，取得拉取槽后下载与持久化（`image_fetch_concurrency` 默认 8），仍受图片内存预算约束，不能假定生成完成即可立刻展示。

Worker 周期任务包括每 2 分钟恢复过期任务，每分钟补齐图片轮询、发放订阅、关闭过期体验活动、尝试低负载对象清理并评估告警，以及每 15 秒派发助手 outbox、文档解析和 API Webhook。另有小时级会话/审计/普通上传清理、提示词同步、素材回收及用户画像/返利任务；具体周期以 `worker.go` 的 `GetConfigs` 为准。

## 数据与文档入口

当前仓库最高迁移为 `00155_developer_api_profitability.sql`，不是部署数据库版本。`00152` 增加助手图片方案自动授权和单轮预算，`00153` 增加技能 slug，`00154` 删除旧 `user_skill_bindings`，`00155` 扩展利润账本来源。自动授权默认关闭，预算默认 60 积分；技能通过输入框按需引用，不再按页面/全局装载。

- 接口：[API_CONTRACT.md](API_CONTRACT.md)
- 数据：[DATABASE.md](DATABASE.md)
- 订阅/支付：[SUBSCRIPTIONS.md](SUBSCRIPTIONS.md)、[ORDER_WORKFLOW.md](ORDER_WORKFLOW.md)
- 模型与执行：[AI_SERVICE_ROUTING.md](AI_SERVICE_ROUTING.md)、[TASK_EXECUTION_DESIGN.md](TASK_EXECUTION_DESIGN.md)
- 存储/运维：[IMAGE_STORAGE_AND_DELIVERY.md](IMAGE_STORAGE_AND_DELIVERY.md)、[GO_PERFORMANCE_OBSERVABILITY.md](GO_PERFORMANCE_OBSERVABILITY.md)

代码依据：`apps/server/internal/httpapi/router.go`、`handlers_openai_direct_images.go`、`internal/assistantbilling/billing.go`、`internal/store/user_concurrency.go`、`internal/worker/worker.go`、`internal/config/config.go` 及 `apps/server/migrations/`。运行时配置、真实支付/上游可用性和本轮完整回归结果仍需在对应环境单独核验。
