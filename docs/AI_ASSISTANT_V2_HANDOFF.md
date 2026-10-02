# AI 助手 v2 交接文档

> 更新时间：2026-10-02（P0–P5 完成；专业工作台按用户决定暂不做）
> 分支：`codex/ai-assistant-v2`（本地，**未推送**）
> 工作树：`/Users/ycc/Documents/TestCode/startcloudsai-ai-assistant-v2`
> 基线：`1608691`（`codex/publish-current-project` 当时的最新提交）

状态标记：✅ 已完成并有测试　🟡 部分完成　⬜ 未开始

---

## 1. 一句话现状

AI 助手**沿用原有界面**（`AssistantWorkspaceLayout` 等，不做新 UI），底层换成了 **v2 引擎**：问答和 Agent 模式的消息由 v2 先判断“这一轮要做什么”，查用户自己的数据、排查任务、普通问答由 v2 直接处理；生图方案（包括抠图 / 去背景：gpt-image-2 编辑原图，输出透明 PNG）、联网搜索、站内工具（放大、导出等）在**同一轮内交回原引擎**处理。图片模式不变。

整体路线是 P0–P5 六个阶段，目前 **P0–P5 已完成**（P3 的专业工作台按用户决定暂不做）。剩下替换旧版（替换前先问用户）。

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
- 本分支新增了 **5 个数据库迁移**：`00177_assistant_decision_logs.sql`（判断记录表）、`00178_assistant_commerce_sets.sql`（电商套图）、`00179_assistant_memories.sql`（助手记忆与开关）、`00180_assistant_proactive.sql`（主动提醒设置、“助手提醒”对话、套图已通知批次）、`00181_assistant_suggestions.sql`（主动建议开关）。合并前确认其他分支没有占用这些编号。**本地开发库在 181**（之前短暂应用过一个已删除的 `00179_assistant_job_kinds`，2026-10-02 已手动回滚：删列并删掉 goose 版本记录，然后才应用现在的 179）。
- **真实生成要先问用户**：本地服务连接的是真实上游模型，任何可能提交生成的操作（包括在本地页面里发消息）都会真实扣费。
- **本地服务不要随意重启**：接口和 worker 由启动器以 `go run` 方式运行，环境变量来自启动器而不是 `.env`。只在用户要求时重启。
- 本地正在运行的接口（`localhost:8000`）跑的是**主工作目录的旧代码**，不认识 `engine=v2`。要真实试用 v2，需要用本工作树的代码另起接口和 worker（还没做，需用户同意）。
- **本分支的一套本地服务**（2026-10-02 起）：接口 `localhost:8001`、worker，用本地同一个数据库，但 Redis 用 **7 号库**（和 8000 那套的任务队列分开，互不抢任务）。二进制和环境在当次会话的临时目录里，会话结束后可能不在；需要时按同样方式重建：编译本分支 → 沿用 8000 那套的环境，改 `PORT=8001` 和 `REDIS_URL` 的库号 → 分别起 `serve` 和 `worker`。**改了 worker 里的代码要两个进程都重启**：助手回合是 worker 进程跑的，只重启 `serve` 不生效（2026-10-02 踩过：旧 worker 跑了几个小时的旧代码）。前端用主工作目录 `.claude/launch.json` 里的 `assistant-v2-web-8001`（端口 3104，代理到 8001）。
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
   │  问答、Agent → createAssistantRun 带 engine:"v2" + timezone（附件、参考图、引用都走 v2）
   │  图片模式、局部编辑、已确认的出图方案 → 原流程（不带 engine）
   ▼
POST /api/v1/assistant/runs（handlers_assistant_workspace.go）
   │  engine=v2：保持用户选的模式（不再按关键词升级），但按 Agent 预备图片能力（模型目录）
   ▼
worker.executeAssistantRun（assistant.go）
   ├─ 非 v2 → executeAssistantRunLegacy（原引擎）
   └─ v2 → runAssistantV2（assistant_v2.go）
        1. assistantdecision.Resolve：判断模型 = 后台单独指定的模型，否则 AI 助手页默认对话模型；
           读取该模型的阈值；模型不可用时只用规则
        2. assistantdecision.Decide：模型判断 intent / 是否追问；同时算出规则的判断（影子对比）；
           置信度低于阈值时改用规则的判断；写一行 assistant_decision_logs
        3. create / web / workspace → assistantV2HandOver：以 Agent 身份交给原引擎，
           并带上 _v2Intent，原引擎直接用这个判断，不再自己跑关键词和模型判断
        4. 其余 → 工具循环（最多 6 步，只执行 read 级工具）：
           my_stats_query、my_records_list、my_account_overview、my_orders_list、explain_charge、
           task_status，附带文档时加 files_list/search/read（系统提示词与工具集在 internal/assistantv2，
           worker 和后台统计评测共用）；
           参考图随本轮消息一起发给模型；引用由上下文构建自动带上
        5. 写消息元数据（dataViews、toolSteps、_decision）→ CompleteAgentAttempt 结算 → 推送 Done
   ▼
原界面渲染：正文 + AssistantDataViews（统计卡片 / 图表 / 表格 / 明细 / 账户概况 / 订单 / 扣费说明）

后台 /admin/assistant-decision（AssistantDecisionView.vue）
   设置判断模型和每个模型的阈值 · 看近 7/30 日判断记录 · 跑内置评测集（规则免费 / 模型真实调用）
   · 跑统计问答评测（64 题，真实调用模型，工具查管理员自己的数据）
```

### 关键文件

| 文件 | 作用 |
|---|---|
| `apps/server/internal/store/metric_facts.go` | **统计口径的唯一来源**：创作事实和账本事实两段 SQL |
| `apps/server/internal/usermetrics/` | 指标目录、时间范围、白名单查询 `Query`、明细 `ListRecords` |
| `apps/server/internal/decision/` | 可插拔决策层：`Decider` 接口、LLM（JSON 输出）、规则、`Chain`；设置（判断模型覆盖 + 每个模型的阈值）；`SelectModel` / `ResolveModel` / `NewChatClient` |
| `apps/server/internal/assistantdecision/` | AI 助手的判断本身：意图、问题、规则、`Resolve`、`Decide`（阈值 + 影子对比）；内置评测集 `BuiltinCases` 与 `Evaluate`。worker 和后台评测共用这一份代码 |
| `apps/server/internal/store/assistant_decision_logs.go` | 判断记录写入与统计 |
| `apps/server/internal/httpapi/handlers_admin_assistant_decision.go` | 后台接口：`GET/PUT /admin/assistant/decision`、`GET /admin/assistant/decision/stats`、`POST /admin/assistant/decision/evals` |
| `apps/admin/src/views/AssistantDecisionView.vue` | 后台页面“AI 助手判断” |
| `apps/server/internal/assistanttools/registry.go` | 工具注册表，新增 `Level`（read / spend / change） |
| `apps/server/internal/assistanttools/my_data.go` | “我的数据”能力清单（统计、明细，含 API 调用） |
| `apps/server/internal/assistanttools/my_account.go` | “我的账户”能力清单：`my_account_overview`、`my_orders_list`、`explain_charge` |
| `apps/server/internal/useraccount/` | 余额、订阅、订单、单笔扣费解释；只复用钱包 / 订阅 / 订单页的 store 函数（`Wallet.AvailablePoints`、`GetSubscriptionProgress`、`SearchUserOrders`、账本事实） |
| `apps/server/internal/assistantv2/` | v2 的系统提示词、工具集和权限，worker 与统计评测共用 |
| `apps/server/internal/statseval/` | 统计问答评测：64 个问法（`BuiltinCases`）、评分（工具 / 参数 / 时间范围 / 是否对比 / 数字出处）、`NewAgent` 与 `Evaluate` |
| `apps/server/internal/worker/assistant_v2.go` | v2 编排：决策、交回原引擎、工具循环、结算 |
| `apps/server/internal/assistantmemory/` | 助手记忆：增删改查、同类同名覆盖、上限 200 条、开关、提示词块（预算 2400 字）、按名字找记住的商品、把套图存成满意方案 |
| `apps/server/internal/assistanttools/my_memory.go` | 记忆工具：`memory_search`、`memory_save`、`memory_update`、`memory_forget`（新级别 `LevelMemory`） |
| `apps/web-react/src/features/assistant/AssistantMemoryViews.jsx` + `assistant-memory.css` | 回复里的记忆卡片（可撤销）、左侧“记忆与提醒”面板（记忆 / 提醒两个标签）、主动消息底部的“提醒设置” |
| `apps/server/internal/assistantproactive/` | 主动能力：设置、`Post`（对话消息 + 铃铛通知同一事务、按来源去重）、套图完成通知、异常提醒、定时报告、主动建议与使用习惯（`suggestions.go`） |
| `apps/server/internal/worker/assistant_proactive.go` | 三个定时任务：套图完成（每 30 秒）、异常提醒（每 10 分钟）、定时报告（每 15 分钟） |
| `apps/web-react/src/features/assistant/useAssistantWorkspaceController.js` | 原 controller：v2 路由与几处状态修复 |
| `apps/web-react/src/features/assistant/AssistantDataViews.jsx` + `assistant-data-views.css` | 原界面里的统计卡片 |
| `apps/web-react/src/features/assistant/domain/assistantConversationRefresh.js` | 切回对话时的服务端合并逻辑 |

---

## 5. 进度清单

### P0 底座 ✅ 全部完成

| 状态 | 项 | 说明 / 位置 |
|---|---|---|
| ✅ | 复用现有任务引擎 | 排队、租约、线路切换、计费、SSE、取消全部沿用，v2 只替换编排 |
| ✅ | v2 编排（判断 → 工具循环 → 结算） | `worker/assistant_v2.go`，测试 `assistant_v2_test.go` |
| ✅ | 交回原引擎 | 生图方案、联网、站内工具在同一 run 内以 Agent 身份交给原引擎，并带上 v2 的判断 |
| ✅ | 可插拔决策层 + 规则兜底 | `internal/decision/`、`internal/assistantdecision/` |
| ✅ | 后台“判断模型”设置界面与接口 | 后台菜单“业务 → AI 助手判断”。可单独指定判断模型（只能选 AI 助手页面已分配的对话模型），指定的模型失效时页面会提示并自动回退 |
| ✅ | 按模型分别设置阈值 | 意图置信度下限（默认 0.6，低于则改用规则）、追问阈值（默认 0.75）；按模型 ID 存，另有 `default` 兜底 |
| ✅ | 影子对比 | 每轮同时算规则的判断，写入 `assistant_decision_logs`（模型、意图、置信度、规则意图、是否低置信度、是否兜底、是否交回原引擎、耗时）；后台按 7/30 日汇总，含“与规则一致率” |
| ✅ | 评测集与评测 | `assistantdecision.BuiltinCases`：43 个标注问题，覆盖 6 个意图，包含历史误判（物联网、上网本、写代码问任务等）。后台可跑“只评测规则”（免费）和“评测模型”（真实调用，需确认）；报告给出准确率、各意图对错、错例、规则对照准确率，以及**建议的意图置信度下限**（可一键填入设置）。当前规则基线准确率 62.8%（27/43） |
| ✅ | 工具权限分级 | `Level`：read / spend / change；v2 目前只执行 read |
| ✅ | 服务端统一判断 | v2 的 run 不再在创建时按关键词升级模式；交回原引擎时带上 `_v2Intent`，原引擎跳过自己的关键词判断和模型判断，关键词的强制工具只在对应意图下生效。关键词规则只作为决策模型不可用或低置信度时的兜底 |
| ✅ | 附件 / 参考图 / 引用进 v2 | 参考图随本轮消息发给模型；文档开放只读文件工具并附带文档分析规则；引用由上下文构建带上；判断模型会被告知本轮附带了什么 |
| ✅ | 原界面接入 v2 与状态修复 | 见下方“原界面”相关提交 |

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
| ✅ | 余额 / 订阅 / 订单查询 | `my_account_overview`：可用和冻结积分（与钱包页同一公式）、最近 90 天的订阅（到期、剩余天数、每日发放、下次发放、订阅积分）、订单数量；`my_orders_list`：按状态 / 订单号 / 套餐名查订单，状态措辞与订单页一致。订阅页的统计 SQL 已抽成 `store.GetSubscriptionProgress`，订阅页和助手共用 |
| ✅ | 扣费解释 | `explain_charge`：接受任务 ID、助手运行 ID、账本记录 ID 或 API 调用 ID（不填 = 最近一笔），按时间列出预留、结算、退回、退款、失败补偿，算出实际花费并生成可直接引用的说明；金额全部取自共享账本事实（`metric_facts.go` 新增 `source_id`、`freeze_points` 两列） |
| ✅ | API 用量指标 | 新增 `api_calls`、`api_succeeded`、`api_failed`、`api_failure_rate`、`api_spend_points`，维度 `api_key`，状态筛选加 `pending` / `expired`；明细类型 `api_calls`。口径来自 `developer_api_billing_requests`，与开发者控制台和 `/me/api-usage-summary` 一致（有对账测试） |
| ✅ | 统计评测集 | 64 个问法，8 类（总量、时间、对比、分组、明细、API、账户、扣费）。检查工具、指标、分组、时间范围（按解析后的日期比较）、是否对比上一周期、是否说明变化，以及“回答里的每个数字都能在工具结果里找到，或由两个结果相减 / 相加 / 相除得到”。后台“AI 助手判断”页底部可运行，可按分类只跑一部分 |

### P2 电商套图（旗舰）✅

| 状态 | 项 | 说明 / 位置 |
|---|---|---|
| ✅ | 套图服务 `internal/commerceset` | 出图类型目录（`catalog.json`，从主工作目录新版 `listingCatalog.js` 用 node 导出的快照，46 种类型，工作台目录更新后重新导出）、文案策划提示词与逐张提示词（照搬工作台“商品套图”的拼法：任务行、商品身份锁、参考图角色、本张职责、第 i/n 张、系列连续性锁）、报价、生成、检查、重做、视图 |
| ✅ | 套图记录 | 迁移 `00178_assistant_commerce_sets`：方案、每张图的生成记录（每次重做一条）与检查结果、`approved_cents`（累计批准积分） |
| ✅ | 出图走工作台的任务 | `taskflow.CreateTaskInTx` 建普通 `ecommerce_design` 任务，参数与工作台一致（`kindVariant=listing`、`viewId`、`batchId`=套图 id 等），`_assistantCommerceSetId` 作为可信参数指回套图；计费、退款、历史记录、电商工作台里都能看到 |
| ✅ | 两种付费确认 | 逐步确认：卡片上“确认生成（N 积分）”，带上用户看到的价格，价格变了就拒绝（409）。自动授权：`commerce_set_generate` / `commerce_set_redo` 是第一批 spend 级工具，在锁住套图记录的同一事务里核对“已批准 + 本次 ≤ 用户的自动授权预算”，不够就返回“需要用户确认” |
| ✅ | 检查与重做 | 一轮图全部出完后卡片调用检查接口，视觉模型（AI 助手页默认对话模型）对照商品原图逐张检查（最多 4 张并发）；生成失败也算不合格。开了自动授权且预算够时，每张自动重做 1 次并带上问题；否则卡片上显示问题和“重做”按钮。每张最多 3 次 |
| ✅ | 交付 | 打包下载（`/archive`，按“序号-类型名”命名）、在电商工作台继续调整 |
| ✅ | v2 接入 | 带商品图且说要电商图（主图 / 套图 / 详情页 / 淘宝 / 天猫 / 亚马逊等）时，v2 不再交回原引擎，开放 `commerce_set_plan` / `generate` / `redo` / `status`；本对话有未完成的套图时，“开始生成 / 第 3 张重做”这类后续也由 v2 处理。规则兜底加了“做 / 生成 + 主图 / 套图 / 详情页”判为生成图片 |
| ✅ | 原界面卡片 | `AssistantCommerceSet.jsx`：方案（张数、文案、预计积分）→ 确认 → 逐张进度 → 自动检查 → 问题与重做 → 下载全部 |

接口：`GET /assistant/commerce-sets/:id`、`POST …/generate`、`POST …/redo`、`POST …/review`、`GET …/archive`。

**真实测试（2026-10-02，本地，测试账号）**：蓝色精华瓶 + “做一套天猫主图，1 张白底图和 1 张卖点图”。模型 23.5 秒出方案（2 张，预计 2 积分）→ 卡片确认 → 两张约 40 秒出完、各扣 1 积分 → 视觉模型检查都通过 → 下载包含两张图。卖点图文字（“轻薄补水精华液 / 按压式不浪费”）正确，商品外形保持一致。自动授权路径只做了自动化测试，没做真实测试（测试账号余额不够再开一轮对话）。

未做 / 后续：
- 整套锚定（第 1 张定调、其余参考第 1 张）只在主工作目录未提交的改动里，本分支没有；合并后可以在 `commerceset.taskInputs` 里接上。
- 智能组图（由模型挑类型）和品类模板没有接入，目前由助手按用户要求选类型，不确定时用工作台默认组合。
- 检查由卡片触发：用户关掉页面时不会检查，再次打开卡片时会补上。

### P3 全平台创作与资产 ✅（专业工作台按用户决定暂不做）

| 状态 | 项 | 说明 / 位置 |
|---|---|---|
| ✅ | 抠图 / 去背景 | 第一批曾做成专用背景移除任务（调用单独的抠图模型），**已按用户要求撤掉**：抠图就是一次 gpt-image-2 图片编辑，交回原引擎的出图方案。方案多了 `transparentBackground`（抠图、去背景、透明底、免抠素材时为 true），方案卡上有“背景：透明 PNG / 不透明”可改；执行时 run 参数带 `transparentBackground`，worker 向上游传 `background: "transparent"`。服务端只在模型开了“透明背景”能力时才保留这个参数；模型开了格式选择且含 png 时同时指定 `outputFormat=png`，没开格式选择的用模型内置格式（gpt-image-2 默认 PNG，指定了反而会被校验拒绝）。用户明确要白底等颜色时不设透明。`WorkspaceToolForPrompt` 不再把抠图路由到 `media_action`，判断层把抠图归为“生成或修改图片” |
| ✅ | 按描述找图 | `assets_search`：资产库（标题、标签、分组名）+ 生成记录（提示词），多个关键词同时匹配，带缩略图和原提示词（卡片上可一键复制） |
| ✅ | 资产库整理 | `assets_organize` 只出方案（移到分组 / 新建分组、加标签、移到回收站）；用户在卡片上确认后才执行（`POST /assistant/asset-actions/execute`），执行后可撤销（`/undo`：移回原分组并删除为此新建、已变空的分组；去掉本次新加的标签；从回收站恢复） |
| ✅ | 修了一个隐藏问题 | `store.BatchUpdateUserAssets` 收到 nil 标签列表时会清空素材的全部标签；资产页本身传的是空列表所以没触发，store 里已兜底 |
| ⏸ | 专业工作台 | **用户 2026-10-02 决定暂不做**。文生图、游戏设计、模型设计、UI 设计、填色的提示词都在各自前端拼装（游戏设计的常量在 `src/generated/gameArtConstants.js`，模型设计的写在页面文件里，UI 设计带区域编辑），完整照搬每个约等于一次 P2。当时提过两种做法：轻量（把工作台的类型说明、风格、画质约束带进原引擎的出图方案）或完整（逐个照搬成工作台任务）。通用出图仍走原引擎的出图方案 |
| ➖ | 其它小工具 | 高清放大、去水印属于站内工具，本来就交回原引擎（`media_tool`，参数按工具定义）；本地配置没启用所以没有实测，后台启用后即可用，不需要单独接入 |
| ✅ | 存入资产库 | `assets_save`（只出方案）+ `userassets.ProposeSave / ExecuteSave`：图片三选一——`imageIds`（assets_search 的 task: id）、`commerceSetId`（每张图最新一次的成图）、`recentImages`（本对话最近生成的 N 张）；可带分组（不存在则新建）、标签和素材名 `title`。用户在卡片（沿用资产整理卡片，显示缩略图）上确认后，服务端把原图复制到 `uploads/<user>/original/` 并生成缩略图和展示图，按内容哈希跳过已在资产库的图，遵守 200 项上限；只接受 `tasks/<本人>/` 下的文件，卡片回传的标题和来源只当展示文本。撤销 = 移到回收站，并删除为此新建、已变空的分组。判断规则加“存 / 保存 / 收藏 + 资产库”（评测集 +2 题，共 51 题） |

**真实测试（2026-10-02，本地，测试账号补了 100 测试积分）**：
- 找图：“找一下我之前生成的精华瓶图片”——判断模型判为查我的数据（0.99），找到 2 张电商图并附链接。修正：工作台图片的标题改用图名（如“商品套图 · 产品白底图”），不再显示长提示词开头。
- 整理：“把资产库里的精华瓶素材移到一个叫‘护肤新品’的分组”——先找到素材，再出方案（会新建分组），确认后移入新分组、原标签保留；撤销后回到未分组，新建的空分组被删除。
- 抠图（专用任务版，已撤掉）：方案、确认、建任务都正常，但上游抠图服务商从本机 TLS 握手失败，任务失败并自动退款。这次测试暴露并修正了套图卡片上的三个问题（保留）：已花积分按成功的图计算（原来显示批准积分）、没有成功的图时不显示下载、未开自动授权时不尝试自动重做（原来会冒出一句多余的确认提示）。
- 抠图（gpt-image-2 透明底，2026-10-02）：在原对话里说“把上面这张精华瓶的图抠出来，要透明底”，方案卡显示 gpt-image-2、编辑、背景“透明 PNG”，确认后 5 积分出图。结果是 1024×1536 的 PNG：71.7% 像素完全透明（四角都是），主体 alpha 250–254，边缘有过渡。第一次提交失败（503 没有可用线路），原因是给没开格式选择的模型也指定了 `outputFormat=png`，已修正并加了测试。
- 撤掉专用抠图后，本地库里两条旧的抠图记录会被当成电商套图显示并提供“重做”，已把它们标为 canceled（没有删除）。
- 也修正了判断规则：第一次找图时判断模型超时，规则把“找我之前生成的…图片”判成了生成图片，交给了原引擎。现在“找 / 搜 / 翻 + 我以前的图”和“资产库 + 整理 / 移动 / 删除”判为查我的数据，判断评测集加了这两题；撤掉专用抠图后，原“抠图 → 站内工具”一题改为“高清放大 → 站内工具”，另加“抠图 → 生成或修改图片”（共 46 题）。

**存入资产库真实测试（2026-10-02，本地 8001）**：
- 在精华液套图对话里说“把这套图都存进资产库，放到护肤新品分组”：判为查我的数据，卡片显示 2 张缩略图和“新建这个分组”，确认后两张以“精华液 · 产品白底图 / 卖点主图”存进新分组；撤销后两张进回收站，分组被删除。
- 在抠图对话里紧跟出图后说“把上面这张存进资产库”：判为查我的数据（0.99，没有当成继续改图），选中的是最新那张透明底图，原 PNG 原样复制。素材名用了用户原话，之后加了可选的 `title`，让模型起短名字。

### P4 记忆 ✅

| 状态 | 项 | 说明 / 位置 |
|---|---|---|
| ✅ | 存储 | 迁移 `00179_assistant_memories`：`assistant_memories`（类型 brand 品牌资料 / product 商品 / style 风格偏好 / habit 习惯 / favorite 满意方案；标题 ≤60 字、内容 ≤1000 字、最多 6 张图；来源 user / assistant；可关联对话和套图）+ `assistant_memory_settings`（开关，没有记录即开启）。每人最多 200 条；同类型同名（不分大小写）覆盖而不是重复 |
| ✅ | 对话里记、改、忘 | `memory_save` / `memory_update` / `memory_forget` 直接执行（新级别 `LevelMemory`：只写助手对用户的笔记），每次改动在回复里出一张卡片，可撤销、可打开管理面板。`attachImages` 把本轮上传的图存进商品记忆；`commerceSetId` 把套图的方案和成图存成满意方案 |
| ✅ | 用上记忆 | 每个 v2 回合把记忆写进系统提示词（品牌、风格、习惯给全文，商品和满意方案只给名字，细节用 `memory_search` 取；总长 2400 字封顶）。交回原引擎的出图回合通过 `_v2Memory` 把同一段记忆带进出图方案的规则里。说“用我的保温杯做一套主图”且没上传图时，用记住的商品图直接走电商套图 |
| ✅ | 用户管理 | 左侧“记忆”面板（沿用资产库抽屉外框）：按类型筛选、添加、编辑、删除（二次确认）、整体开关。关闭后不读取、不新增，已有记忆保留，助手会提示可以在“记忆”里开启。电商套图卡片完成后有“记住这套方案” |
| ✅ | 判断 | “记住 / 忘掉 / 你记得我…”判为查我的数据（v2 自己处理，不交回原引擎）；判断评测集加 3 题（共 49 题） |
| ✅ | 接口 | `GET/POST /assistant/memories`、`PATCH/DELETE /assistant/memories/:id`、`PUT /assistant/memories/settings`；图片只接受本人的 `uploads/<uid>/`、`tasks/<uid>/` 文件 |

**真实测试（2026-10-02，本地 8001，测试账号又补了 100 测试积分）**：
- “请记住：我的品牌色是雾霾蓝，以后做图都用这个色”——判断模型判为查我的数据（0.99），调用 `memory_save` 存成品牌资料，回复下出现“已记住”卡片。
- 新对话问“给新品保温杯拍主图，配色和背景怎么定”（没提品牌色）——回答以雾霾蓝为核心色给方案，说明记忆被用上。之后把提示词改成“用上哪条就点明一次”。
- 面板里添加、编辑、删除、关闭再开启都正常，暗色模式正常；卡片上撤销后记忆被删除。
- 第一次测试没生效，原因是 8001 的 worker 还是几小时前的旧进程（只重启了接口）；模型当时回答“记住了”却没有调用工具。重启 worker 后正常。

未做 / 后续：
- 没有自动从对话里“悄悄”提取记忆；只在用户明确要求或说出明显长期的信息时存，并且每次都出卡片。
- 交回原引擎的回合（生图方案、联网、站内工具）里不能新增记忆，只能用记忆；“记住我喜欢暖色调，然后画一张海报”这类混合请求只会出图，不会存。
- 记忆只用于 AI 助手，没有接到电商工作台等其它页面。

### P5 主动能力 ✅

已定（2026-10-02）：通知**同时发到对话和右上角铃铛**；默认开启（完成通知、异常提醒），定时报告由用户自己开；不收费、不调用模型（文字全部由数字拼出来）。

| 状态 | 项 | 说明 / 位置 |
|---|---|---|
| ✅ | 长任务完成通知 | worker 每 30 秒扫一次“生成中”的电商套图，最新一批全部结束（成功或失败）就在原对话里发一条消息（带实时套图卡片）并发铃铛通知，点开回到该对话。每批（首次生成、每次重做）只通知一次（`announced_attempts`）；用户在卡片上看着它完成（卡片已检查、状态变成已完成）就不再通知；关闭通知期间结束的批次，重新打开后也不补发 |
| ✅ | 异常提醒 | 每 10 分钟检查最近 24 小时有消耗或任务的用户：可用积分 < 50；当天消耗 ≥ 100 且超过前 7 天日均 3 倍；当天失败率 > 30% 且至少 5 次。每类每天最多一次。数字来自钱包和 P1 指标层，与钱包、个人中心一致。发到每人一个“助手提醒”对话（删掉后下次重建） |
| ✅ | 定时报告 | 每天 9:00 之后 / 每周一 9:00 之后发上一天 / 上一周的用量（每周报告只在周一发；那天错过就等下周一）：消耗（与上一期对比）、创作次数、出图、成功率、消耗最多的功能，附统计卡片。每期只发一次 |
| ✅ | 设置 | `GET/PUT /assistant/proactive/settings`；左侧入口改名“记忆与提醒”，面板有“提醒”标签：三个开关（完成通知、异常提醒、主动建议）+ 报告频率；主动消息底部有“助手主动发送 · 提醒设置” |
| ✅ | 主动建议：新对话卡片 | `GET /assistant/proactive/suggestions`，按用户自己的数据算，不调用模型、不收费。最多 3 张，排在原空白页建议卡片前面（同一网格、原样式，多一行灰色理由），问答和 Agent 模式都显示，图片模式不显示。来源：① 3 天内出了方案还没生成的套图 →“继续「保温杯 · 天猫」套图方案”，点开回到那个对话；② 最近的满意方案（近 60 天同一平台 ≥2 套时带上“你最近常做天猫套图（N 套）”）→ 把“按我记住的满意方案「…」再做一套天猫电商套图，商品换成：”填进输入框；③ 记住了商品图但还没做过套图的商品 →“用我的保温杯做一套天猫电商套图”（能直接用记住的商品图）；没有满意方案但有常用平台时给“再做一套天猫电商套图”。点了以后只是填输入框或打开对话，不会自动发送；在问答模式点会切到 Agent 模式。记忆关闭时只剩①，主动建议关闭时全部不出 |
| ✅ | 主动建议：对话里用上习惯 | 记忆和主动建议都开着时，电商套图回合（v2 套图流程，以及交回原引擎的生图方案）的提示词带上“使用习惯”：常用平台和次数、最近的满意方案。用户没说平台或风格时**直接按习惯来并点明一次**，不先问（先问要多花一轮 Agent 费用，方案卡片上本来就能改）；用户说清楚时以用户为准 |

**真实测试（2026-10-02，本地 8001）**：
- 完成通知：把测试账号 P2 那套已完成的精华液套图改回“生成中”，worker 25 秒内发出通知：铃铛“电商套图已完成 · 精华液 · 天猫：2 张全部出图”，点开回到原对话，消息下是实时套图卡片（打开后自动检查，又变回已完成）和“助手主动发送 · 任务完成通知 · 提醒设置”。
- 异常提醒：worker 第一次运行就给本地库里另一个真实账号发了“今天的积分消耗明显偏高：今天已消耗 410 积分，约为日均的 4.2 倍”——本地库是共用的，这是真实触发。
- 定时报告：在“提醒”标签开每周报告后，下一次任务就发了上周报告（那一周没有创作）。这暴露了周五也会发周报的问题，已改为只在周一发，并补了测试。

限制：
- 时区固定按 Asia/Shanghai（服务端还不知道用户时区）。
- 只覆盖助手里发起的电商套图；普通工作台任务、助手里的单次出图没有完成通知（单次出图用户通常就在页面上等）。
- 主动消息插在对话里，打开的页面不会实时出现，刷新或切回对话时出现。

**主动建议真实测试（2026-10-02，本地 8001，测试账号又补 100 测试积分）**：
- 测试账号有 1 套天猫精华液套图；把它存成满意方案，记一个带图的商品“保温杯”，再临时插一条“口红 · 天猫”的未生成方案（测完已删）。新对话 Agent 模式出现三张卡片：继续「口红 · 天猫」套图方案 / 按满意方案「精华液 · 天猫」再做一套（你最近常做天猫套图（2 套））/ 用记住的「保温杯」做一套天猫主图。点第二张填入输入框，点第一张回到那个对话；问答模式点卡片会切到 Agent。暗色模式正常。关掉“主动建议”后接口返回空。
- 满意方案标题是“电商套图 · 精华液 · 天猫”，卡片上去掉了“电商套图 · ”前缀，名字里已有平台时不再重复。
- “用我的保温杯做一套电商套图”（没说平台）：v2 套图流程直接按天猫出方案（目录默认平台是“大陆电商”，说明习惯被用上了），回复写“按你常用的天猫规格与高级质感风制作”。第一版提示词让模型“先问一次”，模型没问而是直接用；考虑到多问一轮要多扣一次 Agent 费用，改成直接用并点明。
- “帮我给新品面霜做一套电商套图”（没有商品图）按原有规则交回原引擎出生图方案，原引擎没有用上习惯，出了一张通用图的方案。原引擎的方案默认忠实执行用户原话，习惯在那里只是弱提示。

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
- **API 调用的消耗归到“API 调用”**：账本里开发者 API 的扣费以前在个人中心和统计里按功能分组时归为“其他”，现在归为“API 调用”。总数不变。
- **任务状态的关键词判断**：必须是用户自己的任务（如“我的任务”“刚才那个任务”），写代码、问系统设计类的提问不再触发。

### 6.3 上一轮排查中发现、仍未处理的问题

- 历史对话列表固定只返回最近 40 个，没有分页（`handlers_assistant_workspace.go` 中 `assistantConversationLimit`）。
- 加载对话列表时，每个对话都要单独查一次消息，40 个对话就是 40 次查询；原界面每个对话还会带回 24 条消息。
- Redis 不可用时，SSE 连接返回 200 后立即断开，浏览器每 3 秒左右重连一次。
- 发送失败时，原界面在对话里保留“生成失败”的消息，同时把草稿放回输入框。这是有意保留原界面行为，产品上可以再确认一次。

### 6.4 v2 当前的限制

- spend 级工具（目前只有电商套图的生成和重做）由工具自己在事务里核对预算；change 级工具仍直接拒绝。
- LLM 自报的置信度没有校准，所以阈值按模型分别设置（后台可改，默认意图 0.6、追问 0.75）。**建议先在后台跑一次“评测模型”，用报告里的建议值设置阈值。**以后接入 JEV 这类有校准概率的模型时，同样按模型单独设阈值。
- 规则兜底（`assistantdecision.Rules`）在决策模型不可用、超时（3 秒）或置信度低于阈值时使用。
- 内置评测集是代码里的固定列表（`BuiltinCases`），要扩充就改代码并提交；还没有在后台增删评测问题的功能。统计评测集同理（`statseval.BuiltinCases`）。
- 统计评测用的是管理员自己账号的真实数据，数据很少时“数字有出处”这一项更容易通过；需要更严格时可以用一个数据较多的测试账号登录后台再跑。“解读”只检查是否说明了变化，不评判解读质量。
- `my_account_overview` 读取余额时和打开钱包页一样，会先结算已过期的订阅积分（`GetWallet` 的既有行为），除此之外不写任何数据。
- 对话上下文沿用原有的 `prepareAssistantContext`（包含压缩）。
- 交给原引擎处理的那一轮，决策模型那次调用**没有**计入利润表的上游调用次数（v2 自己处理的轮次已计入）。

### 6.5 第一次真实评测（2026-10-02，本地库，模型 gpt-5.6-luna）

- **判断模型**：不限等待时准确率 40/43（93%），规则 27/43（63%）。但模型慢：中位 2.8 秒，90% 在 6.3 秒内，最慢 10.7 秒。按原来 3 秒的等待上限，近一半回合会超时改用规则，实际准确率只有约 81%。等待上限 5 秒时约 93%（19% 改用规则），6 秒时约 95%。等待上限现在可以在后台按模型设置（`timeoutMs`，默认仍为 3 秒），模型评测会给出建议值。评测建议的意图置信度下限为 0.75。
  仍判错的：“哪个模型最费钱”被判成联网搜索；“我刚才那个任务为什么失败了”被判成直接回答；“失败的那次生图退款了吗”被判成账户与支付（后两条交给 v2 时都能查到数据，影响小）。
- **统计问答**：64 题最终 62 题通过，工具和参数 100% 正确。第一次运行抓出一个真实 bug：查询的时间段里没有数据、又不分组时，求和结果是 NULL，查询直接报错；新用户问“上个月”、或者环比的上一期没有数据都会碰到，已修复。另外按评测结果改了 `my_records_list` 的说明（“最贵的几次”要用消耗明细）。剩下 2 道是出处检查只认两个数之间的运算，模型其实算对了，检查已经放宽为同一组结果里任意几项的合计也算有出处。
- 有一处与预期不同的行为：含糊的“我花了多少积分”，模型有时按全部时间统计，而不是系统提示词要求的最近 30 天。

---

## 7. 建议的接手顺序

1. 用本工作树的代码起一套本地接口和 worker（先问用户），用测试账号做一次真实试用；在后台“AI 助手判断”跑一次“评测模型”，按建议值设置阈值。
2. 修复 6.1 中和助手行为相关的第 3、5、8 条测试问题。
3. 在后台把判断等待上限设好（见 6.5），并在 6.5 的判断模型评测里看看“哪个模型最费钱”这类判错能不能靠调整判断提示词修正。
4. 灰度替换旧版 `/assistant`：**替换前先停下来问用户**。

---

## 8. 本分支提交记录

| 提交 | 内容 |
|---|---|
| `09222b2` | v2 服务端底座：决策层、工具分级、个人统计、v2 编排 |
| `0faffb3` | 独立 v2 网页（**已在 `c4dabf5` 中删除**，保留在历史里仅供参考） |
| `34015fa` | v2 接入 `task_status` |
| `accf762` | 问答 / Agent 走 v2，缺的能力交回原引擎；修正联网和任务状态的误判 |
| `c4dabf5` | 原界面接入 v2 引擎；统计卡片；状态修复 |
| `01e39a4` | 交接文档 |
| `75b3e7d` | 判断模型设置与阈值、影子对比与判断记录、内置评测集与后台页面、服务端统一判断、附件 / 参考图 / 引用进 v2 |
| `3c93cec` | 撤掉专用抠图任务：抠图改为 gpt-image-2 编辑原图（走原引擎的出图方案），删除迁移 `00179_assistant_job_kinds` |
| `04b5bc3` | P4 记忆：存储与开关、记忆工具、提示词与出图方案里用上记忆、记住的商品直接做套图、记忆面板与可撤销卡片、“记住这套方案” |
| `1881330` | 抠图输出透明 PNG：方案带 `transparentBackground`，服务端按模型能力保留 |
| `2600bae` | P5 前三项：完成通知、异常提醒、定时报告，“记忆与提醒”面板 |
| `7065222` | 周报只在周一发；P5 真实测试记录 |
| `ff00222` | P5 主动建议：新对话卡片、对话里用上使用习惯、“主动建议”开关，迁移 `00181` |
| `5ce41c5` | P3 存入资产库：`assets_save`（对话最近的图 / 套图 / 搜到的图），确认后复制进资产库，可撤销 |
