# AI 助手 v2 交接文档

> 更新时间：2026-10-02
> 分支：`codex/ai-assistant-v2`（本地，**未推送**）
> 工作树：`/Users/ycc/Documents/TestCode/startcloudsai-ai-assistant-v2`
> 基线：`1608691`（`codex/publish-current-project` 当时的最新提交）

状态标记：✅ 已完成并有测试　🟡 部分完成　⬜ 未开始

---

## 1. 一句话现状

AI 助手**沿用原有界面**（`AssistantWorkspaceLayout` 等，不做新 UI），底层换成了 **v2 引擎**：问答和 Agent 模式的消息由 v2 先判断“这一轮要做什么”，查用户自己的数据、排查任务、普通问答由 v2 直接处理；生图方案、联网搜索、站内工具（抠图、导出等）在**同一轮内交回原引擎**处理。图片模式不变。

整体路线是 P0–P5 六个阶段，目前 **P0 大部分 + P1 核心完成**，P2–P5 未开始。

---

## 2. 已定决策（接手前必读，不要推翻）

| 决策 | 内容 |
|---|---|
| 界面 | **必须沿用原界面**。用户打磨了很久，曾做过一版独立新界面被否决并已删除。新能力只能按原界面风格（`--assistant-*` 变量）嵌入原组件。 |
| 模式选择 | 保留“问答 / 图片 / Agent”三个模式。问答和 Agent 走 v2；图片模式保持原生图流程，P2 再升级。 |
| 定位 | 平台统一入口，“说出目标，交付结果”；能力覆盖全平台，包括用户**自己的**数据统计。 |
| 数据范围 | 统计只给普通用户看**自己的**数据。用户身份由服务端从登录态取；模型只能从白名单指标里选，不能写 SQL。 |
| 统计口径 | 必须与个人中心、钱包完全一致（有对账测试守着）。 |
| 决策模型 | **不绑定任何一家**（用户暂时没有 JEV）。默认用后台“页面分配”给 AI 助手页的默认对话模型；可选覆盖设置 `assistant_decision_model`；都不可用时退回规则。 |
| 付费确认 | 两种都要，用户自己选：**逐步确认**（默认）/ **按任务预算**（服务端累计把关）。复用 `requireCostConfirm`、`assistantAutoApprove`、`assistantAutoApproveBudgetCents`。属于 P2。 |
| 旗舰场景 | P2 先做**电商套图**。 |
| 其它助手 | 画布 Agent、电商简报助手等**不在范围内**，不用管。 |

---

## 3. 工作环境与注意事项

- **不要从 `main` 开分支**：`main` 比基线分支落后 191 个提交，现有助手、支付等代码都不在 `main` 上。
- 主工作目录 `startcloudsai`（分支 `codex/publish-current-project`）有 30 多个**未提交**改动（含电商），本分支没有动它们。合并前需要和那批电商改动对齐。
- 本分支**没有新增数据库迁移**。
- **真实生成要先问用户**：本地服务连接的是真实上游模型，任何可能提交生成的操作（包括在本地页面里发消息）都会真实扣费。
- **本地服务不要随意重启**：接口和 worker 由启动器以 `go run` 方式运行，环境变量来自启动器而不是 `.env`。只在用户要求时重启。
- 本地正在运行的接口（`localhost:8000`）跑的是**主工作目录的旧代码**，不认识 `engine=v2`。要真实试用 v2，需要用本工作树的代码另起接口和 worker（还没做，需用户同意）。
- 前端开发服务器：`.claude/launch.json` 里的 `assistant-v2-web`，端口 **3104**。本地接口的 `ALLOWED_ORIGINS` 只放行 3102–3105、3200、8081，其他端口登录会被拒。
- 本地测试账号：`sc.local.assistant.test@gmail.com`。本地开了 `DEV_LOGIN_CODE_ECHO`，验证码在 `POST /api/v1/auth/email-verification-codes` 的响应里（`developmentCode`），不会真的发邮件。
- 工作树里的 `apps/web-react/node_modules` 是用 `npm ci` 装的真实目录（不要用软链接，否则 Vite 会拒绝加载图标字体）。

### 测试命令

```bash
# 服务端（需要本机 Postgres，默认 postgres://localhost:5432/postgres，可用 TEST_DATABASE_URL 覆盖）
cd apps/server
go test ./internal/usermetrics/ ./internal/decision/ ./internal/assistanttools/
go test ./internal/worker/ -run AssistantV2
go test ./internal/httpapi/ -run 'AssistantRunAcceptsV2|Usage|Wallet'
go test ./...        # 全量，约 5 分钟

# 前端单元测试
cd apps/web-react
npm run test:assistant-conversation-refresh
npm run test:assistant-stream-merge
npm run test:assistant-tool-steps

# 前端端到端（全部模拟接口，不调用真实模型）
WEB_BASE_URL=http://127.0.0.1:3125 npx playwright test tests/e2e/assistant-engine-v2.spec.js --project chromium
```

---

## 4. 当前架构

```
原界面（问答 / 图片 / Agent，未改样式）
   │  问答、Agent 且无附件 / 参考图 / 引用 → createAssistantRun 带 engine:"v2" + timezone
   │  其它情况 → 原流程（不带 engine）
   ▼
POST /api/v1/assistant/runs（handlers_assistant_workspace.go）
   │  engine=v2 → params._engine="v2"、params.timezone
   ▼
worker.executeAssistantRun（assistant.go）
   ├─ 非 v2 → executeAssistantRunLegacy（原引擎，未改）
   └─ v2 → executeAssistantV2 → runAssistantV2（assistant_v2.go）
        1. 决策层判断 intent：answer / my_data / create / web / workspace / account，以及是否需要追问
        2. create / web / workspace → 同一 run 内交回 executeAssistantRunLegacy
        3. 其余 → 工具循环（最多 6 步，只执行 read 级工具）
             工具：my_stats_query、my_records_list、task_status
        4. 写消息元数据（dataViews、toolSteps、_decision）→ CompleteAgentAttempt 结算 → 推送 Done
   ▼
原界面渲染：正文 + AssistantDataViews（统计卡片 / 图表 / 表格 / 明细）
```

### 关键文件

| 文件 | 作用 |
|---|---|
| `apps/server/internal/store/metric_facts.go` | **统计口径的唯一来源**：创作事实和账本事实两段 SQL |
| `apps/server/internal/usermetrics/` | 指标目录、时间范围、白名单查询 `Query`、明细 `ListRecords` |
| `apps/server/internal/decision/` | 可插拔决策层：`Decider` 接口、LLM（JSON 输出）、规则、`Chain`、模型解析 `ResolveModel` |
| `apps/server/internal/assistanttools/registry.go` | 工具注册表，新增 `Level`（read / spend / change） |
| `apps/server/internal/assistanttools/my_data.go` | “我的数据”能力清单（两个工具） |
| `apps/server/internal/worker/assistant_v2.go` | v2 编排：决策、交回原引擎、工具循环、结算 |
| `apps/web-react/src/features/assistant/useAssistantWorkspaceController.js` | 原 controller：v2 路由与几处状态修复 |
| `apps/web-react/src/features/assistant/AssistantDataViews.jsx` + `assistant-data-views.css` | 原界面里的统计卡片 |
| `apps/web-react/src/features/assistant/domain/assistantConversationRefresh.js` | 切回对话时的服务端合并逻辑 |

---

## 5. 进度清单

### P0 底座

| 状态 | 项 | 说明 / 位置 |
|---|---|---|
| ✅ | 复用现有任务引擎 | 排队、租约、线路切换、计费、SSE、取消全部沿用，v2 只替换编排 |
| ✅ | v2 编排（判断 → 工具循环 → 结算） | `worker/assistant_v2.go`，测试 `assistant_v2_test.go` |
| ✅ | 交回原引擎 | 生图方案、联网、站内工具在同一 run 内交给 `executeAssistantRunLegacy` |
| ✅ | 可插拔决策层 + 规则兜底 | `internal/decision/`；默认取助手页默认对话模型 |
| ✅ | 工具权限分级 | `Level`：read / spend / change；v2 目前只执行 read |
| ✅ | API 接收 `engine=v2`、`timezone` | 只接受问答 / Agent；带附件、参考图、蒙版、画布快照会被拒（422） |
| ✅ | 原界面接入 v2 | 问答、Agent 无附件时走 v2；删除了前端“问答模式误拦” |
| ✅ | 原界面状态修复 | 空活动任务清除“运行中”；长任务不再 15 分钟放弃；发送失败恢复草稿和附件；切回或聚焦时刷新对话 |
| ⬜ | 后台“决策模型覆盖”设置界面 | 服务端已读取设置键 `assistant_decision_model`（`{"modelId": "..."}`），但管理后台（`apps/admin`）**没有界面**，也没有对应的 admin API |
| ⬜ | 影子对比与评测集 | 每轮的判断结果已写入消息元数据 `_decision`（来源、置信度、耗时、哪些问题用了兜底）。还缺：评测集（真实提问 + 期望意图）、离线评测脚本、按模型分别设置的置信度阈值 |
| 🟡 | 附件 / 参考图 / 引用进 v2 | 目前这些仍走原引擎；要让 v2 读文档和看图，需在 v2 里接入文件工具和视觉上下文 |
| ⬜ | 统一意图判断（服务端唯一） | 前端已不再拦截；但服务端仍有多处关键词规则（`assistanttools/intent.go`、`worker` 里的 `fastAssistantIntent`、画布兜底）。v2 的判断稳定后，应让这些规则只作兜底 |

### P1 懂我的数据

| 状态 | 项 | 说明 / 位置 |
|---|---|---|
| ✅ | 共享统计口径 | `store/metric_facts.go`；个人中心已改用它 |
| ✅ | 与钱包对账 | `usermetrics/query_test.go` 中 `TestQueryMatchesWalletSummaryExactly` |
| ✅ | `my_stats_query` | 11 个指标 × 9 个维度、预设和自定义时间、环比、只读事务、5 秒超时、最多 500 行 |
| ✅ | `my_records_list` | 创作 / 消耗 / 入账明细，最多 50 条，带站内链接 |
| ✅ | 任务排查 `task_status` | 接入 v2 注册表 |
| ✅ | 原界面统计卡片 | 数字卡片 + 环比、趋势折线、排名条形图、表格；亮色和暗色配色都经过校验 |
| ✅ | 回答里的站内链接在站内跳转 | `assistantWorkspaceCore.jsx` 的 `renderAssistantMarkdownHtml` |
| ⬜ | 订单 / 订阅查询工具 | 如“我的会员什么时候到期”“这笔订单状态”。只读，按“我的数据”的模式新增一个能力清单，接 `/me/subscription`、`/orders` 对应的 store 函数 |
| ⬜ | 扣费解释的专门工具 | 目前靠 `my_records_list` + `task_status` 组合回答；可以做一个“解释这笔扣费”的工具，把账本、任务、退款串起来 |
| ⬜ | API 用量指标 | 指标目录里还没有开发者 API 的调用次数和失败率（数据在 `/me/api-usage-summary`） |
| ⬜ | 统计评测集 | 50–100 个真实问法，检查选的指标、数字、解读；规则是“回答里的数字必须来自工具结果” |

### P2 电商套图（旗舰）⬜

- 链路：上传商品图 + 需求 → 计划（几张、各是什么、预估积分）→ 确认预算 → 逐张生成 → 视觉模型检查 → 不合格的重做 → 成套交付（导出 / 发到电商工作台）。
- 两种付费确认方式都要做，用户自选；预算由服务端累计核对。
- 生成必须在服务端直接调用电商工作台的能力，不能“暂存提示词 + 跳转页面”。
- 需要新增 spend 级工具，并实现确认 / 预算审批流程（`assistant_v2.go` 里 `assistantV2InvokeTool` 目前直接拒绝非 read 工具）。
- **开始真实生成测试前必须先征得用户同意。**
- 开工前要和主工作目录里未提交的电商改动对齐。

### P3 全平台创作与资产 ⬜

- 其他工作台（文生图、模特图、游戏美术、UI 设计、填色、壁纸、全息卡、PSD 拆分）和小工具（抠图、压缩、放大、拼图）按能力清单接入，复用 P2 链路。
- 资产：按描述找图、整理分组、复用历史提示词；删除和移动属于 change 级，需要确认并可撤销。

### P4 记忆 ⬜

品牌资料、商品库、风格偏好、满意方案；用户可以查看、修改、删除。

### P5 主动能力 ⬜

定时报告（复用 P1 指标层）、长任务完成通知、异常提醒（消费突增、失败率高、积分将尽）、主动建议。

---

## 6. 已知问题与遗留

### 6.1 原助手的端到端测试有 9 条在改动前就失败

`tests/e2e/react-assistant.spec.js` 设置了串行模式，第一条失败后其余全部跳过，所以这些问题长期没人看到。改成同时运行后对比：基线失败 10 条，本分支失败 9 条（修好了“新对话第一次发送”）。剩余 9 条**都是基线就有的**，没有新引入的：

1. image preferences balance dynamic model capability options
2. keeps keyboard send guards aligned with the send button
3. stops an active run and settles the pending message
4. assistant preview favorites, publishes, and deletes the current image
5. replays a failed local Agent request with the identical idempotent payload
6. keeps long-thread scrolling, collapsed sidebar preview, assets, and context clearing usable
7. restores and persists the scoped composer workspace state
8. infers the recent visual context and image count from the prompt
9. migrates legacy local conversations into cloud history once

建议优先看第 3、5、8 条，它们和助手行为直接相关，可能是真实问题。要看到全部结果，可以临时去掉串行模式运行。

### 6.2 行为变化（需要告知产品和运营）

- **个人中心的创作数、图片数会变小**：以前把助手出图时写的“历史镜像任务”也算了一次，现在已排除，这是更正后的值。
- **个人中心的消耗口径与钱包统一**：早期一些金额记为 0 的账本记录，现在会按关联任务的实际扣费计入。
- **问答模式不再在前端拦截**：服务端决定是否升级为 Agent。
- **联网搜索的关键词判断**：不再把“物联网 / 互联网 / 车联网 / 上网本”当成联网请求。
- **任务状态的关键词判断**：必须是用户自己的任务（如“我的任务”“刚才那个任务”），写代码、问系统设计类的提问不再触发。

### 6.3 上一轮排查中发现、仍未处理的问题

- 历史对话列表固定只返回最近 40 个，没有分页（`handlers_assistant_workspace.go` 中 `assistantConversationLimit`）。
- 加载对话列表时，每个对话都要单独查一次消息，40 个对话就是 40 次查询；原界面每个对话还会带回 24 条消息。
- Redis 不可用时，SSE 连接返回 200 后立即断开，浏览器每 3 秒左右重连一次。
- 发送失败时，原界面在对话里保留“生成失败”的消息，同时把草稿放回输入框。这是有意保留原界面行为，产品上可以再确认一次。

### 6.4 v2 当前的限制

- 只执行 read 级工具；遇到 spend 或 change 工具会返回“需要用户确认后才能执行”。
- LLM 自报的置信度没有校准；当前“需要追问”的阈值是 0.75（`assistantV2ClarifyThreshold`）。以后接入 JEV 这类有校准概率的模型时，要按模型分别设置阈值。
- 规则兜底（`assistantV2Rules`）只在决策模型不可用或超时（3 秒）时使用，置信度刻意设得低。
- 对话上下文沿用原有的 `prepareAssistantContext`（包含压缩）。
- 交给原引擎处理的那一轮，决策模型那次调用**没有**计入利润表的上游调用次数（v2 自己处理的轮次已计入）。

---

## 7. 建议的接手顺序

1. 用本工作树的代码起一套本地接口和 worker（先问用户），用测试账号做一次真实试用，确认 v2 判断和统计回答的质量。
2. 修复 6.1 中和助手行为相关的第 3、5、8 条测试问题。
3. 补完 P1：订单 / 订阅查询、API 用量指标、统计评测集。
4. P0 收尾：后台“决策模型覆盖”设置界面、判断评测集与影子对比。
5. 进入 P2 电商套图：先设计付费确认 / 预算审批流程和 spend 级工具，开始真实生成前先征得用户同意。

---

## 8. 本分支提交记录

| 提交 | 内容 |
|---|---|
| `09222b2` | v2 服务端底座：决策层、工具分级、个人统计、v2 编排 |
| `0faffb3` | 独立 v2 网页（**已在 `c4dabf5` 中删除**，保留在历史里仅供参考） |
| `34015fa` | v2 接入 `task_status` |
| `accf762` | 问答 / Agent 走 v2，缺的能力交回原引擎；修正联网和任务状态的误判 |
| `c4dabf5` | 原界面接入 v2 引擎；统计卡片；状态修复 |
