# 生图分档计费与分辨率槽位

核对基线：2026-10-08 当前工作区（未提交）。本文说明生图模型按「分辨率 × 质量」分档计费，以及每个分辨率配置主模型 + 备用模型、故障自动切换与定时检测。模型目录、执行快照与路由的总体规则见 [AI 服务路由](AI_SERVICE_ROUTING.md)。

## 适用范围

| 入口 | 分档计费 | 分辨率槽位 |
|---|---|---|
| 站内生图任务（文生图、无限画布、插画染色、UI 设计稿、AI 电商、模型设计、游戏设计） | ✓ | ✓ |
| AI 助手直接生图（用户确认方案后的出图） | ✓ | ✓ |
| AI 助手 Agent / 问答本身 | 不涉及（按对话模型计费） | 不涉及 |
| 开发者 API `/v1/images/*` | ✗，仍按 API 模型目录价 | ✗，仍按原线路切换 |

开发者 API 不使用这两项是用户决定（2026-10-08）。

## 质量档位

GPT Image 的 `quality` 取值为 `low`、`medium`、`high`、`xhigh`、`max`、`auto`（`xhigh`/`max` 只有较新的模型支持，`auto` 由上游自选）。平台全部支持，但新建模型和旧模型默认只勾 `low`/`medium`/`high`，其余由管理员按模型勾选。`standard`/`hd` 仍分别视为 `medium`/`high`。

- 代码：`modelconfig.ImageQualities`（全部可选值）与 `DefaultImageQualities`（默认三档）；前端 `IMAGE_QUALITIES` / `DEFAULT_IMAGE_QUALITIES`、`T2I_QUALITY_OPTIONS`、无限画布 `CANVAS_IMAGE_QUALITIES` 同步。
- OpenAI 兼容客户端（`internal/c2a`）把 `xhigh`、`max` 原样发给上游，不再改写为 `auto`。
- 站内页面只能选模型勾选过的质量；开发者 API 的 `quality` 也接受 `xhigh`、`max`，仍需模型支持。

## 分档计费

### 配置

模型上新增两项（`model_dispatch_config.models[]`，仅 `kind=image` 生效）：

| 字段 | 含义 |
|---|---|
| `imagePricing` | `分辨率 → 质量 → { priceCents, discountPriceCents, upstreamCostCents }`。为空时沿用模型原有单价 |
| `defaultQuality` | 请求没指定质量（或指定 `auto` 但模型没勾 `auto`）时使用的质量；为空时优先 `medium`，否则取第一个可选质量 |

保存校验（`modelconfig/image_tiers.go`）：

- 开启分档后，模型勾选的每个分辨率 × 每个质量都必须有价格，不能缺格，也不能出现未勾选的分辨率或质量。
- 每格的零价、折扣价高于标准价、售价低于上游成本，按模型的「允许零积分」「允许低于成本」开关拦截。
- 分档模型不能再设页面单价（`workspaces[].modelPricing`）。
- 模型原有的「标准积分」保留为列表兜底展示，分档模型实际按格计费。

### 取档规则（`ImageBillingTier`）

- 分辨率：取请求的 `resolutionScale` / `resolution`。精确尺寸按像素数归档：≤ 1536×1024 为 1K，≤ 2048×2048 为 2K，其余为 4K。都没有时取 1K（模型没开 1K 时取第一个分辨率）。
- 质量：取请求的 `quality`；为空，或为 `auto` 而模型没勾 `auto` 时，取 `defaultQuality`。模型勾选了 `auto` 时，`auto` 是单独一格，价格由管理员填写。

建任务时把实际档位写入参数 `_billingResolution`、`_billingQuality`，并把 `quality` 改成计费档位再发给上游，保证扣费与出图一致。

### 生效位置

- 报价与扣费：`taskflow.resolveSelectionPrice`、`selectionUpstreamCost`（站内任务）；`assistantprice.GuardImageModel`（助手直接生图，按 `assistantImageTierParams` 取档）。
- 订阅锁价：`contractpricing.Capture` 把公开价格矩阵（不含成本）写进价格快照；`Resolve` 按档位取价。旧快照没有矩阵时按快照里的单价（订阅锁价目前线上未使用）。
- 价格区间：`OverlayTaskPrices`、`WorkspacePriceBounds` 用矩阵的最低–最高价。
- 用户端：`/api/v1/runtime-config` 和 `/api/v1/assistant/config` 的生图模型带 `imagePricing`（不含成本）、`defaultQuality`、`minPricePoints`/`maxPricePoints`；分档模型的 `pricePoints` 为最低价。前端用 `resolveModelTierPointPricing`、`modelPointPriceRange`（`modelPointPricing.js`）显示「10–30 积分/张」并按所选档位估价；最终扣费以服务端报价为准，`expectedUnitPriceCents` 不一致时返回 `price_changed`。
- 利润账本：执行时按实际使用的模型和档位重写 `_upstreamUnitCostCents`（助手为 `_imageUpstreamUnitCostCents`）。

## 分辨率槽位

### 配置

公开生图模型上新增 `resolutionSlots`：`分辨率 → { primaryModelId, backupModelIds[], autoFailover }`。

- 每个分辨率只有一个主模型，可以是模型自己，也可以是其他生图模型；备用模型 0 到多个，有顺序。
- 开启自动切换时至少要有一个备用模型；不开启即手动模式，故障时只告警，由管理员手动切换。
- 没配槽位的分辨率仍走模型自己的服务商线路，行为与以前一致。
- 保存校验（`modelconfig/resolution_slots.go`）：成员必须存在、已启用、是生图模型、支持该分辨率和公开模型勾选的全部质量；成员每档上游成本不能高于公开模型该档售价（允许低于成本时除外）；成员自己不能再配槽位（不嵌套）；同一槽位内不能重复。
- 用户始终按公开模型的价格付费，与实际由哪个成员执行无关。
- 配了分档或槽位的模型不参与旧的「同名模型跨服务商泄压」（`cross_provider_same_model_balancing_enabled`）。

### 运行规则

运行状态在 `internal/imageslots`，表结构见迁移 `00199_image_resolution_slots.sql`：

| 表 | 内容 |
|---|---|
| `image_slot_member_health` | 每个模型在每个分辨率上的健康度：状态、连续失败次数、最近失败/成功/检测 |
| `image_slot_states` | 每个公开模型每个分辨率当前在用的成员、是否全部不可用、手动指定的成员、上次切换时间 |
| `image_slot_events` | 切换、判定故障、恢复、检测、手动操作记录，保留 30 天；也用于统计 24 小时检测次数 |

- **新任务用谁**：自动模式用顺序最靠前的健康成员，并把它之后的健康成员作为本任务的备用（`_slotModelIds`）；手动模式只用管理员指定的成员（默认主模型）。主模型检测恢复后，新任务立即回到主模型。
- **任务内切换**：执行快照按成员顺序冻结全部成员的线路；Worker 先用排在前面的成员，它的线路都失败后才换下一个成员（`slotPriorityCandidates`）。备用只在失败时使用，不用于分摊负载；成员满载时任务排队等待。
- **判定故障**：同一成员在同一分辨率上连续失败达到阈值（默认 3 次）判为故障，成功一次即清零。计入失败的是上游错误（网络、超时、5xx、429，以及 401/402/403/404 这类密钥失效、余额不足、无权限、模型不存在），后者也会让槽位任务直接换下一个成员。内容违规（命中内容策略）、参数错误、用户取消和平台自身处理错误不计入。
- **全部不可用**：自动模式下所有成员都故障，或手动模式下指定的成员故障时，该分辨率拒绝新任务（`resolution_unavailable`，503），用户端把该分辨率置灰（网页）或隐藏（手机站）。
- **定时检测**：Worker 任务 `cron:probe_image_slots` 每 10 分钟运行一次，检测间隔到期的故障成员（默认 60 分钟），用最低质量在该分辨率真实出一张图。24 小时内总检测次数有上限（默认 48，为 0 时停止自动检测）。检测通过即恢复；检测失败也计入连续失败。上游以异步任务受理检测时按通过处理（说明密钥和额度可用）。CRUN 协议暂不支持自动检测，恢复后需在后台手动标记正常。
- **告警**：切到备用时写入「注意」级运营告警，全部不可用时写入「严重」级，键为 `image_slot:<模型ID>:<分辨率>`，显示在后台首页的运营告警中；回到主模型或手动切换到健康成员后自动解除。

### 后台

- 模型编辑窗口「计费设置」：开启分档定价、默认质量、分辨率 × 质量价格表（标准 / 折扣 / 成本）。
- 模型编辑窗口「分辨率槽位」：每个分辨率配置主模型、备用顺序和自动切换。
- 模型目录「分辨率槽位状态」：每个槽位当前在用的成员与状态、各成员健康度、最近失败、最近与下次检测、切换记录；可立即检测（计入 24 小时上限）、手动标记正常、手动模式下切换成员，并调整三项设置。

管理接口（均需管理员）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/v1/admin/model-config/image-slots` | 状态总览、设置、24 小时检测次数、最近记录 |
| PUT | `/api/v1/admin/model-config/image-slots/settings` | 更新连续失败次数（1–20）、检测间隔（5–1440 分钟）、24 小时检测上限（0–1000） |
| POST | `/api/v1/admin/model-config/image-slots/switch` | 手动模式下切换槽位成员 |
| POST | `/api/v1/admin/model-config/image-slots/reset` | 把成员标记为正常 |
| POST | `/api/v1/admin/model-config/image-slots/probe` | 立即检测一个成员 |

设置项保存在 `app_settings`：`image_slot_failure_threshold`（默认 3）、`image_slot_probe_interval_minutes`（默认 60）、`image_slot_probe_daily_limit`（默认 48）。保存模型配置后立即按新配置同步槽位状态；已删除的槽位会清掉状态并解除告警。

公开状态页把备用成员执行的任务记在公开模型名下（`_slotModelId`）。

## 测试与验证

- 单元与集成测试：`modelconfig/image_tiers_test.go`（取档、矩阵校验、槽位校验、新质量档位）、`imageslots/imageslots_test.go`（自动切换与切回、全部不可用、检测间隔与上限、手动模式、检测失败计数）、`taskflow/image_tiers_test.go`（报价、扣费、槽位路由与拒单）、`httpapi/assistant_image_tiers_test.go`（助手按格扣费与槽位）、`assistantprice/image_test.go`、`worker/image_slots_test.go`（成员优先级、失败分类）；前端 `npm run test:t2i-request`。
- 2026-10-08 本地验证：在 Image-2.5-4K 上配置分档价格与 4K 备用，确认后台保存、用户端价格区间与 4K·高 报价 30 积分、切到备用并发出注意告警、Worker 每小时自动检测、手动标记正常后切回并解除告警。当时两个上游真实不可用（主模型 5xx，备用「No available compatible accounts」），因此「检测通过后自动切回」只由测试覆盖。验证结束后已恢复原配置并清空槽位记录。
