# 文档索引与维护基准

核对日期：2026-09-22。文档以当前工作区代码为准，包括尚未提交的改动；不是生产部署或业务验收报告。当前 HEAD 为 `3ebe980fa2c87bdef424ac434537090c13097bb6`，迁移文件共 154 份，最高编号 `00155`，缺号 `00131`。实际数据库版本必须查看对应环境的 `goose_db_version`。

## 使用方式

- **当前说明**：描述现有代码、配置、接口和运行方式；功能是否开放仍取决于环境与后台设置。
- **操作/验证手册**：提供待执行步骤，不能把命令存在当作测试通过，也不能把历史授权当作当前发布授权。
- **历史记录**：保留原日期的审计、故障、设计、测试或发布证据；开头补充当前差异，不重写当时事实。
- **规划**：清楚区分已经实现的基础能力和后续方案，不把规划写成上线功能。

代码与文档冲突时，先查具体实现和配置：HTTP 路由在 `apps/server/internal/httpapi/router.go`，配置在 `internal/config`/`internal/settings`，DDL 在 `apps/server/migrations`，前端命令在各应用 `package.json`，CI 在 `.github/workflows/ci.yml`。文档中出现的公开域名、服务器目录和历史临时日志不代表本轮已经连接或验证过这些环境。

## 项目与应用

| 文档 | 用途 |
| --- | --- |
| [项目 README](../README.md) | 产品、应用边界、快速启动与检查入口 |
| [架构](ARCHITECTURE.md) | 网站/App、任务/助手/直通 API、计费、存储和部署边界 |
| [服务端当前基线](SERVER_CURRENT_STATE.md) | 本次核对的服务端行为、并发、取消、轮询与迁移 |
| [React 主站](../apps/web-react/README.md) | 路由、源码组织、Vite、领域与浏览器测试 |
| [管理端](../apps/admin/README.md) | Vue 后台现有页面、权限和开发约定 |
| [服务端](../apps/server/README.md) | Go 子命令、包职责、配置与测试 |
| [Flutter App](../apps/mobile/README.md) | 当前开放页面、环境隔离、运行和发布 |
| [桌面 UI 支持策略](DESKTOP_UI_POLICY.md) | Web 最低视口和验收范围，不限制独立 Flutter App |

## API、数据与商业规则

| 文档 | 用途 |
| --- | --- |
| [API 契约](API_CONTRACT.md) | 站内、管理及开放接口；以实际路由为准 |
| [完整 HTTP 路由清单](API_ROUTES.md) | 当前注册的方法、路径与 handler 包装器快照 |
| [数据库](DATABASE.md) | 表职责、约束、事务和迁移演进 |
| [开放 API](OPEN_API.md) | `/api/open/v1/tasks` 与 `/v1` Images/Responses 兼容子集 |
| [开放 API 示例](../examples/open-api/README.md) | 示例脚本、SDK 参数、权限和幂等调用 |
| [开发者控制台](DEVELOPER_CONSOLE.md) | 真实凭据、配置开关与演示页面的边界 |
| [订阅](SUBSCRIPTIONS.md) | 订阅批次、合同价格、升级和退款 |
| [订单流程](ORDER_WORKFLOW.md) | 下单、支付证据、查单与状态恢复 |
| [后台账务](ADMIN_BILLING.md) | 钱包、订单、订阅与人工核查 |
| [支付沙箱](PAYMENT_SANDBOX.md) | 隔离模拟验证，不能导入生产数据 |
| [邀请返利](REFERRALS.md) | 当前暂停状态、恢复条件和保留的月结实现 |
| [邀请回归清单](REFERRAL_TEST_CHECKLIST.md) | 暂停/恢复、归因、返利与月结待测场景 |
| [错误与通知字典](ERROR_NOTIFICATION_CATALOG.md) | 普通 API、异步任务与 OpenAI 兼容错误结构 |

## 产品与交互

| 文档 | 用途 |
| --- | --- |
| [用户工具目录](USER_TOOL_CATALOG.md) | 当前用户工具及入口状态 |
| [页面控制](PAGE_CONTROLS.md) | 页面开关、直接访问和后台管理 |
| [技能库与后续方案](SKILL_PAGE_PLAN.md) | 真实本地/云端/官方技能与 `@` 调用；另列未实现规划 |
| [助手工具与路线](ASSISTANT_TOOL_ROADMAP.md) | 当前工具、计费/确认边界和候选方向 |
| [PSD 工作区](PSD_WORKSPACE_DESIGN.md) | PSD 实现与真实上游交付质量边界 |
| [闪光卡](HOLO_CARD.md) | 现有闪光卡制作能力 |
| [闪光卡样例](HOLO_CARD_SAMPLE.md) | 样例资产和使用说明 |
| [精确图片尺寸](EXACT_IMAGE_SIZE.md) | 请求尺寸与交付尺寸策略 |
| [首页轮播](HOME_BANNERS.md) | 后台配置、原图上传与用户展示 |
| [公告即时推送](ANNOUNCEMENT_PUSH.md) | 公告快照、推送身份、SSE 和模拟回归 |
| [管理端 UI 规范](ADMIN_UI_STYLE.md) | 现行导航、布局、控件与主题 |
| [图标存储与使用](ICON_STORAGE_AND_USAGE.md) | 图标来源和项目引用规则 |
| [MCP 方案](MCP_PLAN.md) | 未实现的产品 MCP 服务规划；不与 CodeGraph 或图片技能 OAuth 混淆 |

## 执行、存储与性能

| 文档 | 用途 |
| --- | --- |
| [AI 服务路由](AI_SERVICE_ROUTING.md) | 模型、服务商、执行快照、重试与调度 |
| [任务执行设计](TASK_EXECUTION_DESIGN.md) | 状态机、准入、执行和恢复 |
| [高并发稳定性](HIGH_CONCURRENCY_TASK_STABILITY.md) | 业务并发、物理槽位、队列、轮询和回收 |
| [图片存储与交付](IMAGE_STORAGE_AND_DELIVERY.md) | S3/OSS、引用、变体和鉴权读取 |
| [图片列表性能](PROMPT_MASONRY_PERFORMANCE.md) | 当前 React 虚拟瀑布流及保留的历史调参记录 |
| [Go 性能与观测](GO_PERFORMANCE_OBSERVABILITY.md) | 指标、pprof、race、benchmark 和 PGO 验证入口 |
| [任务链路测试](TASK_CHAIN_TESTING.md) | 隔离任务链测试入口 |
| [任务模拟](TASK_SIMULATION.md) | 模拟工具、边界及真实环境验证要求 |
| [任务执行验证记录](TASK_EXECUTION_VALIDATION.md) | 历史验证证据与当前差异 |
| [任务发布预检](TASK_RELEASE_PREFLIGHT.md) | 执行池、迁移与发布前检查 |

## 部署与迁移

| 文档 | 用途 |
| --- | --- |
| [本地开发](LOCAL_DEVELOPMENT.md) | 源码进程、专用开发配置与正确 Go module 目录 |
| [生产部署](DEPLOYMENT.md) | 根 Compose、HTTPS、网关、备份与恢复 |
| [一体化 PG18/C2A 部署](INTEGRATED_4C8G_MIGRATION.md) | PG18、独立 C2A 数据库、OSS 迁移和本地 MinIO |
| [维护窗口发布](MAINTENANCE_RELEASE.md) | 当前一体化维护脚本、数据边界、失败处理与强制关闭 API 行为 |
| [兼容版本蓝绿发布](ZERO_DOWNTIME_RELEASE_RUNBOOK.md) | 仅适用于已验证滚动兼容的根 Compose 版本 |
| [跨服务器数据迁移](PRODUCTION_DATA_MIGRATION.md) | 场景前提、只读盘点、对象清单和受控切换 |
| [可选 Cloudflare 接入](CLOUDFLARE_SETUP.md) | 可选代理、动态接口绕过缓存与回退 |

网站打包脚本只归档已提交的网站文件并排除 App。共享生产库的候选 API 启动会自动迁移；当前 `00154` 删除旧技能装载表，旧代码仍依赖该表时必须安排维护升级，不能承诺零停机。维护脚本目前会强制关闭 `developer_api`，发布前要核对该行为是否符合发布目标。

## 历史、审计与来源

| 文档 | 适用边界 |
| --- | --- |
| [项目演进时间线](PROJECT_UPDATE_TIMELINE.md) | 顶部为本次代码快照，主体保留原历史阶段 |
| [2026-09-01 未提交记录](UNCOMMITTED_UPDATE_2026-09-01.md) | 原工作区 diff 与原测试证据，不代表今天未提交/未部署状态 |
| [2026-09-09 发布核查](RELEASE_REVIEW_2026_09_09.md) | 原接受项、失败项和验证结果 |
| [文生图审计](TEXT_TO_IMAGE_AUDIT.md) | 历史问题与当前行为补充 |
| [文生图队列修复记录](TEXT_TO_IMAGE_QUEUE_FIX.md) | 原修复证据，不替代现行调度说明 |
| [任务取消审计](TASK_CANCELLATION_AUDIT.md) | 原审计与当前按阶段取消策略 |
| [图片保存延迟诊断](IMAGE_RESULT_PERSISTENCE_LATENCY_DIAGNOSIS.md) | 原串行问题与当前独立回收链路的差异 |
| [画布 Agent 审计](CANVAS_AGENT_AUDIT.md) | 历史问题及当前 journal/执行身份保护 |
| [分镜审计与方案](CANVAS_STORYBOARD_AUDIT_AND_PLAN_2026-09-15.md) | 历史方案与当前内联分镜实现 |
| [React 迁移记录](../apps/web-react/REACT_MIGRATION.md) | 迁移期流程与当前原生路由的区别 |
| [首页设计基线](../apps/web-react/DESIGN.md) | 历史首页视觉基线 |
| [画布上游来源](../apps/web-react/CANVAS_UPSTREAM.md) | 来源、许可与本仓库集成范围 |
| [画布上游更新记录](../apps/web-react/CANVAS_CHANGELOG.md) | 上游历史变更，不是本站所有功能开放清单 |

## App 商店与示例资料

- [App 发布清单](../apps/mobile/store/release-checklist.md)、[数据安全说明](../apps/mobile/store/data-safety.md)、[审核说明](../apps/mobile/store/app-store/review-notes.md)：代码能力与实际商店配置仍需分别核验。
- [App Store 文案](../apps/mobile/store/app-store/zh-CN/)、[Google Play 文案](../apps/mobile/store/play/zh-CN/)、[隐私地址](../apps/mobile/store/app-store/privacy-url.txt)、[支持地址](../apps/mobile/store/app-store/support-url.txt)：自有发布资料；正确内容保留，不为制造改动而重写。
- [电商产品工作流示例](../examples/canvas-workflows/ecommerce-product-production/README.txt)、[电商完整制作示例](../examples/canvas-workflows/ecommerce-full-production/README.txt)：已有 JSON 与本地打包说明。

第三方许可证、上游声明、iOS 占位图说明及代码内供运行时使用的 Skill 指令不是当前平台功能规范；保留原文，不能随文档同步改变授权文本或运行行为。

## 本次校验范围

本次核对仓库自有说明、专项规范、操作手册、历史记录、App 发布资料和示例说明；修正存在漂移的内容，保留已经准确的文档。检查相对链接、脚本名称、命令前置条件、迁移编号及 Markdown 差异格式。没有因此执行生产命令、改动业务代码、迁移数据库、发出公告或调用付费模型。

以后变更功能时同步维护对应专项说明和应用 README；精确默认值注明来自 Go、Compose、环境示例还是后台设置。历史测试结果保留日期和版本，新验证追加自己的证据，不直接覆盖旧结果或笼统写“全部通过”。
