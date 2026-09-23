# 架构说明

核对日期：2026-09-22。本文描述当前工作区的代码和配置，包含未提交改动，不推断本地进程或生产服务版本。详细接口、数据表和执行规则分别见 [API 契约](API_CONTRACT.md)、[数据库](DATABASE.md) 和 [服务端当前基线](SERVER_CURRENT_STATE.md)。

## 应用与部署边界

| 组件 | 技术 | 职责 |
| --- | --- | --- |
| `apps/web-react` | React 19、Vite、Zustand、React Router | 桌面 Web 创作、社区、技能、素材、账户和开发者控制台；`src/canvas` 内置无限画布 |
| `apps/admin` | Vue 3、TypeScript、Pinia、Element Plus | 任务、用户、内容、模型、账务、成本利润、Agent 质量、日志和安全运营 |
| `apps/mobile` | Flutter、Riverpod、Dio、GoRouter | 独立移动客户端；复用站内 API，独立构建和商店发布 |
| Go API | Gin、pgx | 鉴权、业务事务、模型路由、文件交付、实时事件和队列投递 |
| Go Worker | Asynq | 图片、聊天/Agent、附件、异步轮询与后台维护 |
| PostgreSQL | 根 Compose/CI 为 17；一体化 Compose 为 18 | 业务数据、钱包账本、任务状态、执行快照与配置 |
| Redis | Redis 7、Asynq | 队列、消费者心跳、共享限流和消息通知 |
| 对象存储 | AWS SDK v2、S3 API | 上传文件、任务结果、助手产物、缩略图和运营素材 |

网站入口为外层 HTTPS Nginx → 回环地址上的 Docker `gateway`。网关将 `/`（包括 `/canvas`）交给 React，`/admin/` 交给 Vue；`/api/`、`/v1`、`/oauth/` 和 OAuth 发现路径交给 Go。`/internal/` 在公网网关直接返回 404，C2A 回调走内部网络。

根 `docker-compose.yml` 包含七个服务。一体化 `deploy/integrated/docker-compose.yml` 额外运行 ChatGPT2API，PostgreSQL 中的 `starclouds` 与 `chatgpt2api` 使用不同数据库及凭据。开发环境可叠加本地 MinIO；生产示例使用私有 OSS，存储实现仍兼容 R2 等 S3 服务。

API 与 Worker 使用同一份 Go 源码，可分别构建镜像。`cmd/server/main.go` 提供 `serve`、`worker`、`create-admin`、`check-worker` 和 `seed`。`serve` 启动前执行 Goose 迁移、内置模板/更新记录种子及已有配置密钥加密；`worker` 不负责启动迁移。

## 业务模块

主站提供文生图、插画染色、设计工作台、模型设定图、游戏美术、AI 电商、拼图、闪光卡、图片工具、AI 助手、无限画布、技能库、素材库和作品社区。页面是否开放由页面控制、功能开关及相应后台配置共同决定。

画布原生编译到主站，不存在独立画布生产容器。项目以 v3 JSON 文档保存至 `canvas_projects`，`revision` 实现乐观并发控制；IndexedDB 作为离线缓存。节点生成复用站内图片任务，托管 Agent 复用助手执行链，并支持客户端工具领取、执行和结果回传。模板与工作流运行接口已注册；不能把历史服务器工作流版本/批量表等同于每项功能都已对用户开放。

当前技能库包含官方技能、用户云端技能及本地技能，通过输入框 `@` 按需组合调用。旧“全局/页面装载”模型已移除；迁移 `00154` 删除 `user_skill_bindings`，技能内容本身仍保留。功能边界见 [技能库说明](SKILL_PAGE_PLAN.md)。

## 身份、权限与实时通信

- 普通用户使用 Gmail、Googlemail、QQ 邮箱验证码；邮箱规范化、验证码消费、首次建号、钱包与 session 创建在服务端完成。用户 Cookie 为 `sc_session`，不提供用户密码登录。
- 管理员通过独立 `admin_accounts`、`admin_sessions` 和 `sc_admin_session` 登录。管理员文件使用 `/api/v1/admin/files/*`，不复用用户 Cookie。
- App 将现有 `sc_session` 保存于系统安全存储，通过统一网络层访问 REST、私有图片和事件流；网站桌面视口策略不限制独立 App。
- 开发者 API 使用限定 scope、模型、额度等权限的 API Key。图片技能 OAuth 2.0 + PKCE 是外部工具授权，不是第三方账号登录，也不代表已经实现 MCP Server。
- 携带 Origin 的浏览器写请求校验允许来源；代理地址仅信任配置的入口，生产使用 Redis 共享限流。`DEV_LOGIN_CODE_ECHO` 只允许开发环境显式启用，生产禁止验证码回显。
- 普通图片任务优先使用账户级 SSE，批量轮询兜底；助手 run 使用自己的事件流与状态恢复接口。公告使用独立共享快照和 Redis 通知，见 [公告推送](ANNOUNCEMENT_PUSH.md)。

## 三条模型调用链路

| 入口 | 执行方式 | 结果与计费 |
| --- | --- | --- |
| `/api/v1/tasks`、`/api/open/v1/tasks` | 创建站内任务，经 Asynq、Worker 和模型线路调度 | 保存产物与缩略图；钱包冻结、结算或释放 |
| `/api/v1/assistant/runs` | 保存对话/run，经聊天、Agent 或图片执行链；支持工具与附件 | 消息和产物持久化；独立助手计费及取消规则 |
| `/v1/images/generations`、`/v1/images/edits` | API 校验后直连配置的 OpenAI 兼容上游 | 不创建站内任务、不进站内队列、不保存图片；仍受鉴权、计费、限流及幂等记录约束 |

`/v1/responses` 提供对话流式及图片工具子集，另有 WebSocket 入口。不能把它理解为完整 OpenAI 协议，也不能将 Images 直通的“不存图”推广到所有 Responses 路径；详见 [开放 API](OPEN_API.md)。

旧 `/api/v1/assistant/chat`、`/api/v1/assistant/images` 免费直连入口已停止注册。站内助手不再是“登录即可无限免费代理”。

## 站内任务与可靠性

提交时校验模型能力、输入文件归属、价格、额度和幂等键，在事务中创建任务并冻结积分，再按业务任务 ID 投递队列。Worker 使用执行快照与线路配置调用 C2A、Sub2API、CRUN 或 OpenAI 兼容上游。C2A 支持幂等异步提交、内部签名回调和轮询回收，提交响应丢失时优先恢复同一上游任务。

任务包括排队、运行、成功、失败和取消等状态；重试、接管和取消还有独立阶段与代数。状态变更与账本处理由条件更新及事务约束保证。已完成的图片可分批回收保存，部分成功如何结算不能仅根据最后一次上游状态推断。

图片、对话、Agent 的业务配额与 Worker 物理槽位分别管理。账户图片并发还受订阅合同和人工加成影响；开放任务 API 与网页个人并发政策有区别。轮询批次、拉取和存储另有限流，不能用 `WORKER_CONCURRENCY` 一个值推断全站吞吐，见 [并发稳定性](HIGH_CONCURRENCY_TASK_STABILITY.md)。

取消是否允许、是否需要确认、退款数额，以任务/run 返回的取消策略为准。尚未提交上游与已提交图片/可编辑文件的处理不同，不能承诺所有失败或取消都全额退款。画布 Agent 还需要按已经执行的计费动作结算。

## 钱包、支付与订阅

账务使用整数单位和事务账本，不能把积分与人民币实付金额直接等同；API 中保留 `*Cents` 字段，具体换算见 [数据库](DATABASE.md)、[订阅](SUBSCRIPTIONS.md) 与 [后台账务](ADMIN_BILLING.md)。钱包支持普通、体验、冻结及订阅权益，账本唯一键防止重复入账。

套餐、订单创建/查询/关闭、蓝鲸支付通知及订阅查询/升级/退款路由已注册。实际购买要求后台启用支付并配齐渠道、凭据和可售套餐。订单保存购买与支付快照，回调和主动对账必须验证支付证据。充值退款与订阅退款、邀请返利冲正不是同一流程。

邀请功能默认关闭、月结暂停，历史记录保留；前端还有独立构建开关，见 [邀请返利](REFERRALS.md)。开发者 API 默认开放状态及发布脚本强制关闭行为见 [维护发布](MAINTENANCE_RELEASE.md)，不能由接口存在推断线上可调用。

## 文件与社区数据

站内上传和任务结果存入 S3 兼容存储，普通读取通过稳定的 `/api/v1/files/*` 鉴权后代理返回。列表优先缩略图，预览与下载按需读取原图。上游需要参考图时可使用公网 endpoint 的短期签名 URL；生产 OSS 内网上传/回读地址与公网签名地址分开配置。

文件权限覆盖任务、助手、素材库、画布和公开内容引用。远程下载执行 SSRF、格式、大小与重定向检查，不向任意媒体地址发送上游 Key。对象清理需要检查引用，并通过持久化清理作业重试。具体限制见 [图片存储与交付](IMAGE_STORAGE_AND_DELIVERY.md)。

画廊支持投稿、分类、审核、举报和作者屏蔽。提示词库支持人工维护与 JSON/Markdown/HTML 数据源同步。运营图片、公告、首页轮播及页面控制由独立后台维护。

## 迁移、验证与部署

Goose SQL 在 `apps/server/migrations` 中并嵌入二进制；当前工作区最高版本为 `00155`，编号不连续，不能通过最大编号推断文件数量或实际已应用版本。实际数据库状态必须查询 `goose_db_version`。

`00154` 删除旧技能装载表，其 Down 仅重建空表，不恢复旧装载记录。涉及该表、钱包约束或执行协议变更的升级必须检查旧 API/Worker 兼容性；共享生产库的候选 API 启动会真实执行迁移，不是隔离预演。维护部署先停止旧写入，再备份与启动匹配新版本。

根 Compose 与一体化 Compose 使用不同项目、网络和配置文件，不混用候选栈。主站与管理端开发端口分别为 3105、3200，Go API 默认为 8000，生产网关默认为回环 8080。网关按接口设定请求体上限及流式策略，不能概括为统一 20 MB/300 秒；外层代理必须同时支持 `/v1` WebSocket、SSE 和模板上传。

自动检查入口在 `.github/workflows/ci.yml`：Go vet/test/race、安全扫描，主站领域/画布测试和构建，后台构建及展示测试，Flutter 分析/测试/Android debug 构建。Go 集成测试创建真实 PostgreSQL 临时库；Playwright 大部分通过模拟 API 验证交互。文档校验不替代业务测试、历史数据库升级演练或真实供应商验收。
