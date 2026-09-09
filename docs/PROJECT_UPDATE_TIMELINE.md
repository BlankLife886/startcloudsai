# 项目完整更新进程与更新说明

本文记录 StarCloudsAI 从项目建立到当前工作区的完整演进。内容以 Git 提交、数据库迁移、现有代码和当前未提交差异为依据，不把讨论过但未落地的方案写成已完成功能。

## 1. 时间与版本边界

| 项目 | 当前数据 |
| --- | --- |
| 首次提交 | `bb7d61ec96162e59a27ae3bed857ec211bbdc850` |
| 首次提交时间 | `2026-07-20T20:23:26+08:00` |
| 当前 HEAD | `e72e36e9d52908c24541b9dd4b9cd38de39e3362` |
| 当前 HEAD 时间 | `2026-08-29T00:22:11+08:00` |
| 已提交版本 | `135` 个提交 |
| 数据库迁移 | `00001` 至 `00117`，共 `117` 个 |
| 当前分支 | `codex/publish-current-project` |
| 当前未提交状态 | `179` 个已跟踪文件修改、`107` 个未跟踪文件，共 `286` 项（包含本文档） |
| 当前已跟踪代码差异 | 约 `+13,687 / -2,193` 行 |
| 当前生产状态 | 最近一批更新尚未提交、尚未部署生产 |

提交类型统计：`feat 56`、`fix 38`、`refactor 14`、`docs 5`、`ops 2`、`ci 2`、`test 2`、`build 4`、`chore 6`、显式回退 `2`，另有 4 条非标准前缀提交。

## 2. 总体演进路线

项目不是一次性开发完成，而是沿着以下路径逐步形成：

1. 建立架构、数据库、Docker 和 Web 骨架。
2. FastAPI 原型验证后，当天改写为 Go + Gin + pgx + Asynq。
3. 建立管理后台、社区、提示词、钱包、套餐、兑换码和审计。
4. 加入多模态 AI 助手、创作工作台和模型路由。
5. 补齐任务并发、上游轮询、失败恢复和实时观测。
6. 建立无限画布；早期版本撤回后，以更完整的 Agent/工作流方案重新建设。
7. 主站从 Vue 完整迁移到 React，并移除旧 Vue 构建链。
8. 扩展 AI 电商、媒体工具、移动端、支付和画布模板。
9. 建立 PostgreSQL 18、OSS、4C8G 集成部署、候选发布和零停机回切。
10. 当前阶段补齐开放 API、成本利润、DAM、Agent 质量、日志、用户画像、安全中心和 CI 安全链。

## 3. 阶段一：项目建立与 Go 后端定型

时间：`2026-07-20`，共 `11` 个提交。

### 做了什么

- 创建项目目录、架构说明、API 契约、数据库设计和 Docker Compose。
- 移植初始 Web 页面，建立前后端和部署边界。
- 先实现 FastAPI + arq Worker 原型，用于快速验证任务、后台和接口形状。
- 同日将后端完整改写为 Go：Gin 提供 HTTP、pgx 访问 PostgreSQL、Asynq + Redis 执行异步任务。
- 管理后台增加用户详情、财务、审计、任务管控和模型配置。
- 恢复首页展厅、沉浸式画廊和后台旧登录视觉。
- 提示词库、画廊分类、精选、投稿分类接入真实服务端。
- 建立社区运营接口：提示词、分类、策展、违规处理和禁投。
- 登录增加防爆破限流。
- 后台统一为 ERP 风格，支持双主题、通知、改密和图表。

### 为什么这样更新

FastAPI 原型适合快速验证，但项目核心是长任务、并发调度、数据库事务和 Worker 稳定性，因此尽早统一到 Go，避免业务扩大后再承担双后端迁移成本。

### 阶段结果

形成了当前项目最早的技术主干：Go API、PostgreSQL、Redis/Asynq、Web、Admin 和 Docker。

## 4. 阶段二：商业基础、运营后台与上线安全

时间：`2026-07-21` 至 `2026-07-22`，共 `14` 个提交。

### 做了什么

- ChatGPT2API 地址、Key、超时改为后台可配置并热生效。
- 密钥只返回末四位掩码，审计日志执行脱敏。
- 修复 `/admin` 子路径反向代理、SPA fallback、容器健康检查和迁移竞态。
- Web 镜像统一使用 `npm ci`，清理旧 E2E 和文档漂移。
- 建立最小 CI：Go vet/test、Web import/lint/build、Admin build。
- 新增兑换码管理及兑换接口。
- 商业模式定稿为订阅、充值包和兑换码三条路径。
- 价格页只展示套餐，订单、钱包和兑换入口移入个人中心。
- 上线前补齐真实单价、费用确认、余额不足引导、参考图校验、提交幂等和全局 401 处理。
- 提示词库支持 JSON、Markdown、HTML 三种来源同步，带并发锁和定时扫描。
- 安全审计修复入队补偿、APP_SECRET、可信代理、错误脱敏、优雅停机和健康检查。
- 建立订阅、套餐和兑换码数据库结构。

### 为什么这样更新

这一阶段的重点是把“能运行”提升到“可收费、可运营、可部署”：任务必须先确认费用，钱包必须可追溯，密钥不能泄露，部署不能因为迁移和代理配置产生线上阻塞。

### 阶段结果

平台具备基础商业闭环和第一版上线安全条件。

## 5. 阶段三：多模态助手、认证与创作体验

时间：`2026-07-24` 至 `2026-07-30`，共 `10` 个提交。

### 做了什么

- 加入多模态 AI 助手。
- 扩展创作工作流、预览、费用确认和后台操作体验。
- 修复公告、公共页面滚动和外部 OAuth 错误追踪。
- 用户认证最终统一为邮箱验证码登录和首次自动建号。
- 创作、预览和历史流程继续打磨。
- 大幅重构 AI 模型路由和产品端模型选择体验。

### 为什么这样更新

用户需要的不只是单次生图，而是能够理解图片、连续追问、修改和复用的工作区。同时认证流程需要从多个入口收敛，避免用户表、会话和密码逻辑持续分叉。

### 阶段结果

AI 助手和多业务创作台成为主要产品入口，模型路由开始从固定配置转为后台控制。

## 6. 阶段四：并发、可观测性与无限画布第一次探索

时间：`2026-08-01`，共 `16` 个提交。

### 做了什么

- 标准化 REST API 契约。
- 增加实时性能观测。
- 加固图片任务并发、运行时 Worker 并发和服务商扩展。
- 聚合服务商轮询、失败切换和容量判断。
- 尝试显式模型执行池，发现复杂度/收益不匹配后立即回退。
- 服务商支持多个 Base URL 线路。
- 调整提示词和历史信息密度。
- 首次加入无限画布并对齐 OpenAI Canvas 交互。
- 早期无限画布实现不成熟，随后主动撤回。
- 增加图片任务完成声明，防止并发重复完成和重复结算。

### 为什么这样更新

任务量增加后，瓶颈从页面功能转移到并发、上游轮询和完成竞争。画布第一次实现暴露出架构和交互不足，回退比继续在错误基础上堆叠更安全。

### 阶段结果

任务执行开始具备容量、路由、轮询和完成幂等；无限画布方向确认，但等待第二次建设。

## 7. 阶段五：产品工作流扩展与 React 迁移准备

时间：`2026-08-04` 至 `2026-08-11`，共 `6` 个提交。

### 做了什么

- 发布阶段性项目状态。
- 移除旧移动响应式配置，避免主站桌面逻辑继续被历史断点规则干扰。
- 扩展产品工作流、设计工具和 AI 电商能力。
- 修复主题快速切换崩溃。
- 在主站 React 迁移前建立完整检查点。

### 为什么这样更新

旧 Vue 项目长期混合历史模块、样式和构建依赖，继续增量修改的维护成本已经高于迁移成本，因此先冻结功能基线，再迁移主站。

## 8. 阶段六：主站完整迁移到 React

时间：`2026-08-12`，共 `34` 个提交，是提交最密集的单日阶段。

### 做了什么

- 建立 React 主站和独立预发布部署。
- React 主站逐步替代 Vue 默认服务。
- 分阶段迁移 Shell、共享控件、页面样式、活动样式、静态资源和业务模块。
- 移除 Vue SFC 解析和迁移工具链。
- 将 Web 校验、CI 和生产镜像全部切换到 React。
- 最终删除旧 Vue 主站应用。
- 修复迁移后的提示词库、体验活动入口、签到、兑换、历史和登录提示。
- 允许匿名浏览，在需要提交或查看私有内容时统一弹登录。
- 继续修复插画染色模型设置、资源工具栏和明暗主题对比度。

### 为什么这样更新

采用渐进替换而不是一次性切换：先让 React 可独立构建，再逐块剥离 Vue，最后删除旧应用。这样每一步都能构建和回退，降低整站迁移风险。

### 阶段结果

React 成为唯一主站；Admin 继续使用 Vue，服务端接口保持不变。

## 9. 阶段七：无限画布重新建设与可重复工作流

时间：`2026-08-16` 至 `2026-08-17`，共 `7` 个提交。

### 做了什么

- 从完整产品检查点重新开始建设无限画布。
- 加入可重复执行的节点工作流。
- 增加电商工作流模板和完整模板示例。
- 修复助手搜索前缀泄漏。
- 隔离画布 Agent、普通聊天和助手工作区。
- 优化画布工作流和创作者操作体验。

### 为什么这样更新

第二次画布建设不再只做一个视觉画布，而是从节点、连接、任务、恢复、模板和 Agent 边界一起设计，解决第一次实现无法稳定扩展的问题。

## 10. 阶段八：Agent、支付、钱包与业务工作流深化

时间：`2026-08-18` 至 `2026-08-22`，共 `11` 个提交。

### 做了什么

- 扩展管理后台画布模板和 AI 电商工作流。
- 扩展创作者流程、运营功能和部署准备。
- 完善支付与 Agent 工作流。
- 统一画布模板、Agent 计费和电商流程。
- 加固助手运行可靠性。
- 增加助手上下文预算和多服务商路由。
- 钱包混合资金桶冻结改为事务串行，防止并发超额预留。
- 助手 Agent 按推理强度计费。
- 继续打磨助手、画布和后台发布体验。

### 为什么这样更新

Agent 开始具备工具调用和生图能力后，计费不再是固定一次调用，需要同时解决上下文长度、推理强度、图片数量、路由切换和钱包冻结一致性。

## 11. 阶段九：媒体、移动端与零停机发布

时间：`2026-08-26` 至 `2026-08-27`，共 `8` 个提交。

### 做了什么

- 扩展媒体工具、无限画布和 Flutter 移动端流程。
- 继续优化画布 Agent 和 App 工作流。
- 建立零停机候选发布、健康验证和回切流程。
- 验证画布模板发布链路。
- 发布过程改为可中断、可恢复。
- 增加独立零停机部署手册。
- 更新说明支持导入和导出。

### 为什么这样更新

业务功能已经足够多，发布本身成为风险源。该阶段把“怎么上线、怎么验证、怎么回退”正式纳入项目能力。

## 12. 阶段十：PostgreSQL 18、OSS 与自适应调度

时间：`2026-08-28`，共 `15` 个提交。

### 做了什么

- 加固任务处理和画布工作流。
- 完善移动端福利体验。
- 修复并发提交多张图片时任务丢失。
- 增加 PostgreSQL 18、OSS 和 ChatGPT2API 集成部署栈。
- 将本地/服务器集成栈限制为 4 CPU 方案。
- 增加自适应图片任务调度。
- OSS 内部 Endpoint 和公共访问地址分离。
- 忽略迁移包中的归档元数据。
- 允许受信任的内部图片上游和模型线路。
- 优雅停机先排空上游图片任务。
- 禁用 OSS 不兼容的 checksum trailer。
- 修复 OSS 对象删除兼容。
- 对象删除改为空闲容量延迟处理。
- 增加运维事件中心。

### 为什么这样更新

线上出现“上游已完成，本站仍延迟数分钟”的问题后，优化重点从简单提高并发转为拆分提交、上游生成、结果拉取、OSS 保存和清理负载。对象删除不再与用户生图抢资源。

### 阶段结果

形成当前 4C8G、PostgreSQL 18、Redis、OSS、ChatGPT2API、Server/Worker 的集成基础。

## 13. 阶段十一：候选部署与自动化发布

时间：`2026-08-29`，共 `3` 个提交。

### 做了什么

- 增加鉴权 CDN 图片交付。
- 增加集成候选环境部署。
- 自动化集成 API 发布。

### 后续方向调整

- CDN 后来按最终决策移除，当前方案以 OSS/站内鉴权文件接口为主。
- 保留候选环境、健康检查和可回切部署思路。
- 当前 HEAD 停留在 `e72e36e`，后续工作仍在未提交工作区。

## 14. 阶段十二：当前未提交的平台化更新

时间：`2026-08-29` 之后至当前，尚未形成 Git 提交。

当前差异覆盖 285 个状态项，主要更新如下。

### 14.1 AI 助手

- 同一对话支持多任务排队、编辑、取消和换序。
- 运行中仍可继续发送后续需求。
- 联网搜索保留来源引用。
- 参考图进入图片方案，支持忠实/增强提示词和逐张多图计划。
- 附件可列出、搜索、分段读取。
- 支持 TXT、Markdown、CSV、JSON、PPTX 输出。
- PPT/PSD 可由后台开关并指定服务商/线路。
- 工具动作增加确认卡、执行状态和失败收口。
- 对话中的具体生成链接可加入资产库。
- 任务状态工具可读取真实阶段、耗时、重试、费用和退款，不暴露内部 ID。

### 14.2 无限画布

- Agent 可读取画布状态、选择、节点、连接和视觉快照。
- 增加检查点、撤销、重做、历史事务恢复和快照导出。
- 改进节点重命名、文本编辑、更多菜单、参考图预览、多图展开和外部截图粘贴。
- 修复复制外部内容时仍粘贴旧画布节点的问题。
- 生成状态区分排队、准备、上游生成、拉取和保存。
- 重试从 0 秒重新计时，不要求刷新页面。
- 大画布降低全量计算、重渲染、抖动和掉帧。
- 工作流版本/发布/服务器执行/批量能力曾实现，但普通用户产品化入口最终撤下；迁移表保留。

### 14.3 任务可靠性

- 文生图、AI 电商、助手和画布统一真实阶段。
- 已提交上游的取消必须明确确认结算后果。
- 单线路也按配置消耗重试预算，有备用线路时优先故障转移。
- 上游返回文本、空结果或失败时及时进入终态。
- 用户历史区分失败与取消，显示生成耗时和安全清洗后的失败原因。
- 结果拉取、图片处理和 OSS 保存分别记录，不再全部算成上游时间。

### 14.4 工具目录

- 新增 `/ai-tools`，汇总所有用户工具。
- 首页增加简洁的“全部工具”入口。
- 后台动态媒体工具自动合并到目录。

### 14.5 开放 API

- API Key 支持 Scope、模型白名单、有效期、任务/积分额度。
- 支持模型列表、上传、创建任务、查询任务和文件读取。
- 支持幂等任务创建。
- Webhook 支持签名、指数退避、死信和手动重投。
- 加入 IP/CIDR 白名单、每分钟请求、每日流量、最近 IP 和自动冻结。
- 用户入口默认关闭，仅用于内部测试。

### 14.6 成本利润

- 记录模型、服务商、线路、用户、工作区、收入、上游成本和毛利。
- 文本统计次数与输入/输出/推理 Token，图片统计任务数与交付张数。
- 模型支持上游成本、允许零积分、允许低于成本开关。
- 后台新增成本利润页和异常账目标记。

### 14.7 资产 DAM

- 标签、分组、搜索、来源、内容哈希和派生关系。
- 批量移动、标签修改、回收站、恢复和永久删除。
- 回收站对象在系统空闲时进入 OSS 清理。

### 14.8 Agent 质量

- 记录 Agent 运行、目标约束、工具步骤、错误、耗时和评分。
- 支持助手和画布两个工作区。
- 固定评测集、评测运行和代表失败样本。
- 后台新增 Agent 质量页。

### 14.9 日志与用户画像

- 可选安全、运维、用户日志，支持总开关、分类开关、保留期、容量和清理。
- 日志总开关关闭时不写平台日志。
- 用户行为事件、每日汇总、画像历史和增量刷新队列。
- 生命周期、风险、价值、重度用户、高价值、亏损和流失标签。
- 后台用户列表和详情增加画像筛选、趋势和规则配置。

### 14.10 管理后台

- 新增成本利润、Agent 质量、运行日志和安全中心导航。
- 首页拆分文本与图片统计。
- 任务成功率排除取消和进行中任务。
- 增加 Agent、计费、Open API 和 OSS 清理质量摘要。
- 运行正常时明确显示状态，不再留下空白。

### 14.11 移动端

- 更新助手、资产、钱包、账本、购买、订单、任务详情、历史、通知、更新记录和投稿。
- 扩展对应 Flutter 测试。

### 14.12 安全与 CI

- 普通响应移除内部服务商、线路、端点和 ID。
- 注册、登录、上传、任务、下载和开放 API 增加限流/额度。
- 上传增加 SHA-256、恶意哈希、ClamAV 和外部审核 Hook。
- 支付回调证据和主动对账进入安全中心。
- CI 增加 race、govulncheck、gosec、npm audit、Gitleaks、Trivy 和 CycloneDX SBOM。

### 14.13 文档

- 完整未提交更新说明。
- 项目 API 文档，覆盖实际 `287/287` 个方法路由。
- 错误码、异步失败和通知字典，覆盖 `166/166` 个同步错误码。
- 用户工具目录、Open API、助手工具路线和部署说明。

当前未提交阶段的逐项说明见 [UNCOMMITTED_UPDATE_2026-09-01.md](UNCOMMITTED_UPDATE_2026-09-01.md)。

## 15. 数据库迁移演进

### `00001-00017`：平台基础

- 用户、会话、钱包、任务、文件、通知和初始设置。
- 管理审计、社区、提示词来源、兑换码、订阅和独立管理员认证。
- 任务模型、用户资料、资产、投稿标签和提示词性能。

### `00018-00027`：助手与统一认证

- 助手工作区、运行并发、提示词来源/互动。
- 用户费用确认偏好。
- 邮箱验证码和统一邮箱认证。
- 公告展示配置和提示词封面尺寸。

### `00028-00044`：并发、服务商与任务可靠性

- 用户突发容量、任务并发索引、服务商分发。
- 异步任务容量、队列容量和服务商轮询。
- 多线路、画布项目、背景移除、提示词导入和资产分组。
- 任务租约、工作单位和上游尝试记录。

### `00045-00059`：体验、反馈、商业和助手计费

- 体验申请、反馈、签到、套餐管理和增长活动。
- 多职业、活动批次、体验积分桶和功能权限。
- 助手计费、免费本地拼图和商业运营表。
- 移除已经淘汰的商业模式。

### `00060-00070`：AI 电商

- AI 电商任务、商品库、上传生命周期和对象清理。
- 试衣目录、手持商品项目/批次/状态同步。
- 共享目录和电商素材审核。

### `00071-00086`：画布、通知与模板

- 画布提示词任务、画布 Agent 工作区和工作流运行。
- 通知清除、画布账本原因、后台清理任务和热路径索引。
- 任务时间线、用户立绘、工作流取消、模板、种子版本和封面。
- 更新说明来源和公告通知来源。

### `00087-00099`：助手可靠性、文件和运维

- 助手运行可靠性、附件解析、项目上下文、搜索和运行尝试。
- 特色积分冻结、CRUN/媒体工具任务。
- 仪表盘索引、对象清理上传引用和运维事件中心。

### `00100-00117`：平台运营化

- 成本利润、开放 API 和 Webhook。
- 工作流产品化/服务器执行/批量表（用户入口最终撤下，表保留）。
- DAM、Agent 质量、平台日志。
- 用户画像、行为、历史和每日汇总。
- 助手质量、对话队列、上传额度和安全控制。

当前本地数据库版本为 `117`。生产升级必须顺序执行迁移，不能只复制最后几张表。

## 16. 关键技术决策与回退

### FastAPI 改为 Go

原型在首日完成验证后即迁移，避免两套后端长期并存。当前生产后端只有 Go。

### 显式执行池回退

`0f366d6` 加入显式模型执行池，`4b30471` 随后回退。最终选择服务商线路容量和动态调度，而不是固定池层级。

### 无限画布先撤回再重建

第一次画布在 `d2511c6/8f98eb0` 加入，`2c9a5c2` 回退。第二次从 `6511293` 起以工作流、Agent、恢复和模板为基础重新建设。

### Vue 迁移 React

采用分阶段剥离，最终移除旧 Vue 主站。管理后台仍保留 Vue，不需要为了“统一框架”承担无收益迁移。

### CDN 最终移除

`2fcb63e` 曾加入鉴权 CDN 图片交付。当前未提交阶段按最终成本/架构决策移除 CDN，保留 OSS 和站内鉴权文件接口。

### 工作流产品化入口撤下

版本、发布、服务器执行和批量运行底层表已经迁移，但普通用户入口过于复杂且价值不明确，因此最终撤下。保留迁移表是为了数据库版本连续和不误删数据。

### 不引入 Kubernetes/Kafka

当前 4C8G 阶段继续使用 Docker Compose、PostgreSQL、Redis/Asynq 和 Go Worker。优先解决任务幂等、租约、结果拉取、OSS、成本和安全，而不是提前增加基础设施复杂度。

## 17. 当前产品能力状态

| 模块 | 状态 |
| --- | --- |
| 用户认证、钱包、套餐、兑换、订单 | 已实现 |
| 文生图、插画、设计、模型图、游戏美术 | 已实现 |
| AI 电商与手持商品图 | 已实现 |
| AI 助手、多轮队列、联网、附件、PPT/PSD | 已实现；PPT/PSD 依赖后台配置 |
| 无限画布、Agent、节点、状态、恢复 | 已实现 |
| 用户工作流产品化 | 已撤下 |
| 资产 DAM | 当前未提交阶段已实现 |
| 开放 API/Webhook | 已实现但默认关闭 |
| 成本利润 | 当前未提交阶段已实现 |
| Agent 质量 | 当前未提交阶段已实现 |
| 平台日志 | 已实现但总开关默认关闭 |
| 用户画像 | 当前未提交阶段已实现 |
| 安全中心 | 当前未提交阶段已实现 |
| OSS | 已接入 |
| CDN | 当前方案移除 |
| 自动备份与恢复演练 | 按决策暂不实现 |

## 18. 当前验证状态

当前未提交阶段已经完成：

- `go test ./...`
- `go vet ./...`
- Web React 生产构建
- Admin 严格 TypeScript 和生产构建
- Web/Admin 生产依赖审计：0
- `govulncheck`：0 个可达漏洞
- `gosec`
- `git diff --check`
- 本地迁移到 `117`
- 本地 `/api/v1/health`：数据库、Redis、服务均为 `ok`
- 安全中心浏览器基本验证

这些结果只代表本地当前代码，不代表生产已经部署或验收。

## 19. 文档索引

- [UNCOMMITTED_UPDATE_2026-09-01.md](UNCOMMITTED_UPDATE_2026-09-01.md)：当前未提交更新逐项说明。
- [API_CONTRACT.md](API_CONTRACT.md)：项目完整接口文档。
- [ERROR_NOTIFICATION_CATALOG.md](ERROR_NOTIFICATION_CATALOG.md)：错误码、错误信息和通知字典。
- [OPEN_API.md](OPEN_API.md)：开放 API 和 Webhook 使用说明。
- [USER_TOOL_CATALOG.md](USER_TOOL_CATALOG.md)：用户端全部工具。
- [ASSISTANT_TOOL_ROADMAP.md](ASSISTANT_TOOL_ROADMAP.md)：AI 助手工具边界与路线。
- [DATABASE.md](DATABASE.md)：数据库和迁移说明。
- [DEPLOYMENT.md](DEPLOYMENT.md)：部署说明。
- [INTEGRATED_4C8G_MIGRATION.md](INTEGRATED_4C8G_MIGRATION.md)：4C8G 集成迁移。
- [ZERO_DOWNTIME_RELEASE_RUNBOOK.md](ZERO_DOWNTIME_RELEASE_RUNBOOK.md)：低影响发布和回切。
- [HIGH_CONCURRENCY_TASK_STABILITY.md](HIGH_CONCURRENCY_TASK_STABILITY.md)：并发与任务稳定性。

## 20. 全部 Git 提交索引

以下按时间从旧到新列出当前 HEAD 之前的全部 `135` 个提交：

```text
2026-07-20 bb7d61e init: 项目骨架 + 架构/API/数据库设计文档 + docker-compose + 移植 web 端源码
2026-07-20 db50579 feat: FastAPI 后端 + arq Worker + 轻量后台，并完成 admin 契约字段对齐
2026-07-20 cf0c95a feat: web 端裁剪至保留页面并接入新任务契约；pricing/profile/首页/画廊重做
2026-07-20 9411b85 refactor: 后端改用 Go（Gin + pgx + Asynq）重写，接口契约与前端/后台保持不变
2026-07-20 53e0853 feat: 后台扩展（图表/用户详情/财务/审计/任务管控/模型配置）+ 对应 Go 接口
2026-07-20 4e1318b feat: 恢复首页六展厅与画廊沉浸式原版设计
2026-07-20 3e55bc6 feat: 恢复旧版后台登录页设计
2026-07-20 c27f8ee feat: 工作台词库接服务端、画廊分类/精选、投稿分类
2026-07-20 7a6302d feat: 后台恢复社区运营三页旧版设计
2026-07-20 66f496d feat: 社区运营后端 + 登录防爆破限流
2026-07-20 1215fa7 feat: 后台整站换肤为 ERP 设计风格
2026-07-21 2f3a6d7 fix: 后台内容区 ERP 化精修
2026-07-21 42817f6 feat: ChatGPT2API 服务后台可配置
2026-07-21 5e94afd fix: 系统设置页重设计
2026-07-21 96a4cf5 fix: 部署审计修复
2026-07-21 a334453 ci: 最小 CI；补充兑换码契约
2026-07-21 f34971d feat: 后台兑换码管理页及相关修复
2026-07-21 2bad7dc docs: 商业模式定稿
2026-07-21 8873a96 fix: Web 上线 blocker 修复
2026-07-21 e19c2e9 feat: 提示词库数据源同步
2026-07-21 8308e99 feat: 安全审计修复 + 兑换码后端 + 订阅系统
2026-07-21 fda92ef feat: 后台套餐支持订阅类型
2026-07-21 82bb661 feat: 价格页只卖套餐，订单/钱包/兑换迁入个人中心
2026-07-22 e801212 feat: consolidate completed project updates
2026-07-22 a6f2d77 fix(admin): remove review card status strip
2026-07-24 c378fce feat: add multimodal assistant and refine creative workflows
2026-07-25 759553c feat: improve creative workflows and admin experience
2026-07-25 0532b9d feat: refine AI workflows and cost confirmation
2026-07-25 4424196 fix: stabilize announcements and public page scrolling
2026-07-25 b610c00 fix: expose GitHub OAuth failure reasons
2026-07-25 139d9ed fix: trace GitHub OAuth callback stages
2026-07-25 001fab2 feat: switch user auth to email verification codes
2026-07-25 d960013 feat: unify email verification onboarding
2026-07-27 e53f57e feat: refine AI creation and preview workflows
2026-07-30 110173e feat: overhaul AI model routing and product experience
2026-08-01 6fba708 feat: checkpoint product experience and task stability
2026-08-01 3195088 refactor: standardize REST API contract
2026-08-01 73018c1 feat: add real-time performance observability
2026-08-01 6307372 feat: harden image task concurrency
2026-08-01 dba01fe feat: add runtime worker concurrency controls
2026-08-01 0c01b58 feat: scale image tasks across providers
2026-08-01 3581e0e feat: aggregate provider polling and failover
2026-08-01 0f366d6 feat: add explicit model execution pools
2026-08-01 4b30471 Revert "feat: add explicit model execution pools"
2026-08-01 8b8bffc feat: add provider base URL routes
2026-08-01 6b345f2 fix: improve provider route dialog layout
2026-08-01 72d0597 fix: widen prompt and history feeds
2026-08-01 d2511c6 feat: add infinite canvas workspace
2026-08-01 8f98eb0 feat: align canvas with open ai canvas
2026-08-01 2c9a5c2 revert: remove infinite canvas workspace
2026-08-01 a9e9522 fix: fence concurrent image completion
2026-08-04 063096c chore: publish current project changes
2026-08-05 65a4bc3 refactor: remove mobile responsive configurations
2026-08-07 cd3b9a9 feat: complete product workflows and design tools
2026-08-09 7596c74 feat: expand commerce and creative workflows
2026-08-09 2944620 fix: prevent rapid theme toggle crashes
2026-08-11 fed05f1 feat: checkpoint product improvements before React migration
2026-08-12 5dce6cf feat: migrate main site to React
2026-08-12 483395b build: add React staging deployment
2026-08-12 b99315f fix: use production site title
2026-08-12 2e59b4e build: trim deployment archive
2026-08-12 6482452 build: make React main site default
2026-08-12 c8f5020 build: keep Vue active during React decoupling
2026-08-12 17049c0 refactor: detach shell styles from Vue
2026-08-12 de39be4 refactor: detach shared control styles from Vue
2026-08-12 02c70b4 refactor: detach page styles from Vue
2026-08-12 c97707e refactor: detach incentive styles from Vue
2026-08-12 62187f6 refactor: remove Vue SFC parsing from React build
2026-08-12 b12fae7 refactor: move shared static assets into React
2026-08-12 3469f5e refactor: move shared modules into React
2026-08-12 fcf9554 refactor: make React web image standalone
2026-08-12 f616afe refactor: remove Vue migration toolchain
2026-08-12 5e4e1f6 chore: switch default web service to React
2026-08-12 d9810f2 test: move web validation to React
2026-08-12 38d6398 ci: retire legacy Vue web validation
2026-08-12 1df85e8 refactor: remove legacy Vue web application
2026-08-12 ea9987d fix: align React prompt library with Vue baseline
2026-08-12 b9680d7 refactor: remove main-site music module
2026-08-12 36631ce fix: restore active trial campaign entry
2026-08-12 edb7775 feat: allow anonymous browsing with shared login prompt
2026-08-12 ea84dd4 fix: avoid login prompt on ecommerce navigation
2026-08-12 44fd1bb fix: restore check-in and redemption auth flows
2026-08-12 b29d07a fix: prompt login from check-in and history nav
2026-08-12 506a0f2 fix: prompt login before trial application
2026-08-12 05f5380 style: reduce shared login card size
2026-08-12 73e4756 fix: align text to image prompt library
2026-08-12 7565ea3 fix: align illustration coloring model settings
2026-08-12 d43f667 fix: remove redundant coloring login card
2026-08-12 a7b982e style: move coloring resources to toolbar
2026-08-12 0df420e style: improve coloring toolbar light mode
2026-08-12 fc5df2f fix: restore coloring light mode text contrast
2026-08-16 15aea6d chore: checkpoint current project state
2026-08-16 6511293 feat(canvas): add repeatable workflow execution
2026-08-16 5b206dc docs(canvas): add ecommerce workflow template
2026-08-16 0de66ec docs(canvas): add full ecommerce workflow template
2026-08-17 a25f7f4 fix(worker): filter leaked assistant search prefixes
2026-08-17 2ca12b9 fix(canvas): isolate chat runs from assistant workspace
2026-08-17 38f1c16 feat: refine canvas workflows and creator experience
2026-08-18 60ca920 feat: expand admin canvas and commerce workflows
2026-08-20 b45ac99 feat: expand creator workflows and operations
2026-08-20 51f0bb8 feat: prepare payments and agent workflows for deployment
2026-08-20 01bf749 feat: refine canvas templates, agent billing, and ecommerce workflows
2026-08-20 c5793c9 fix: harden assistant run reliability
2026-08-21 eb887b4 feat: add assistant context budgeting and provider routing
2026-08-21 ccdf854 feat: prepare assistant and canvas workflows for release
2026-08-21 7d5e281 fix: serialize mixed wallet reservations
2026-08-21 60fd4e3 fix: charge assistant agent turns by reasoning effort
2026-08-22 a3f071e feat: refine assistant, canvas, and admin workflows
2026-08-22 3d7c4a5 feat: prepare assistant canvas and admin release
2026-08-26 31368e3 feat: expand media canvas and mobile workflows
2026-08-27 3e5395f feat: refine canvas agent and app workflows
2026-08-27 d9305a0 chore: add zero-downtime deployment path
2026-08-27 b87825b test: verify canvas template release path
2026-08-27 303cfc7 chore: make production rollout interruption-safe
2026-08-27 1b8644a docs: record verified zero-downtime rollout
2026-08-27 237b147 docs: add standalone zero-downtime release runbook
2026-08-27 364119e feat: add changelog import and export
2026-08-28 3687ef7 fix: harden task processing and canvas workflows
2026-08-28 cdee70a feat: refine mobile benefits experience
2026-08-28 57b75c7 fix: preserve concurrent image task submissions
2026-08-28 4cb310d feat: add PG18 and OSS integration stack
2026-08-28 e77a540 chore: cap integrated stack to four CPUs
2026-08-28 2cc006e feat: add adaptive image task scheduling
2026-08-28 61b1580 fix: split OSS internal and public endpoints
2026-08-28 5ee3dca fix: ignore archive metadata in migrations
2026-08-28 c0b389f fix: allow trusted internal image upstream
2026-08-28 cbca901 fix: allow configured internal model routes
2026-08-28 2954a95 fix: drain image upstream before shutdown
2026-08-28 915ef0b fix: disable unsupported OSS checksum trailers
2026-08-28 3af792b fix: use OSS-compatible object deletion
2026-08-28 c3842f5 fix: defer object cleanup to idle capacity
2026-08-28 f08095a feat: add operational incident center
2026-08-29 2fcb63e feat: add authenticated CDN image delivery
2026-08-29 61d3da3 ops: add integrated candidate deployment
2026-08-29 e72e36e ops: automate integrated API deployment
```

## 21. 当前结论

项目已经从早期“生图页面 + 简单后台”发展为包含多业务创作、AI 助手、无限画布、AI 电商、移动端、钱包商业系统、对象存储、任务调度、运营后台、开放能力和安全治理的平台。

当前最重要的状态不是继续增加页面，而是：

- 把当前 286 项未提交改动整理成一个可验证提交。
- 在候选环境执行迁移到 117 并完成业务回归。
- 保持开放 API、平台日志等试验功能默认关闭。
- 不把本地数据库、MinIO 数据、测试账号或密钥带到生产。
- 部署后重点观察任务排队、上游耗时、结果拉取、OSS 保存、失败率、钱包和成本账目。

本文是“更新过程总览”；每个当前功能的精确实现状态以第 19 节链接的专项文档为准。
