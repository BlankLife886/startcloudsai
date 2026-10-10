# 动态调价

核对基线：2026-10-08 当前工作区（未提交）。本文说明站内模型按北京时间的时段规则自动上调或下调价格，以及订阅用户的额外优惠。模型自身的标准价、折扣价和分档价格表见 [AI 服务路由](AI_SERVICE_ROUTING.md) 与 [生图分档计费与分辨率槽位](IMAGE_TIER_PRICING_AND_SLOTS.md)。

## 适用范围

| 入口 | 时段调价 | 订阅优惠 |
|---|---|---|
| 站内生图任务（文生图、无限画布、插画染色、UI 设计稿、AI 电商、模型设计、游戏设计、手持图） | ✓ | ✓ |
| AI 助手（对话、Agent、直接出图）、AI 电商套图 | ✓ | ✓ |
| 开发者 API `/v1/*` | ✗ | ✗ |

开发者 API 不参与是用户决定（2026-10-08）。

## 规则

配置保存在 `app_settings.model_price_schedule`，后台入口为「模型配置 → 动态调价」。

| 类型 | 生效时间（北京时间，左闭右开） |
|---|---|
| 工作日 | 周一到周五，每天 `startTime`–`endTime`（如 09:00–17:00；不跨天，全天填 00:00–24:00） |
| 周末 | 周六、周日，每天 `startTime`–`endTime` |
| 指定日期 | `startAt` 到 `endAt` 的一段连续时间（`YYYY-MM-DDTHH:MM`） |

- 每条规则只对列出的模型生效，每个模型各自设置调价方式：百分比（-95% 到 +500%）或固定积分（正数涨价、负数降价）。后台可以勾选多个模型批量设置。
- 不内置节假日日历；法定节假日、调休用「指定日期」规则覆盖。
- **优先级**：同一时刻同一模型命中多条规则时只取一条：指定日期 > 周末 > 工作日，同类型取列表中靠前的。优先级按模型判断：高优先级规则没列出的模型，仍可命中低优先级规则；要让某个模型在某段时间保持原价，把它加入高优先级规则并把幅度设为 0。
- 总开关「启用动态调价」关闭时所有时段规则暂停；订阅优惠不受总开关影响，有自己的开关。

## 怎么算

1. **基准是用户原本要付的价格**：开了折扣价就以折扣价为准，分档模型以所选那一格为准，页面单价（`workspaces[].modelPricing`）同样调整；推理档位价格也一起调整。
2. 百分比结果四舍五入取整。
3. **底线**：降价时，不允许零积分的模型至少 1 积分；不允许低于成本的模型不低于该格的上游成本。原价本身已低于底线（管理员允许过）时不会被抬高。
4. 用户端展示：降价时保留标准价、把新价作为折扣价（显示划线原价）；涨价时标准价改为新价、去掉折扣，不显示划线价（即使模型原本有后台折扣）。有限时调价的模型不再显示「折扣」字样，只显示现价、划线原价和限时标签。
5. **订阅优惠**：有生效中订阅（`ActiveBillingSubscription`）的用户，在上一步的站内价格上再减 n 积分或 n%，同样守住底线。只对订阅优惠里勾选的模型生效。订阅锁价合同的锁定价高于当前价时按当前价收费。

实现：`internal/pricerules`。`LoadSite` 读出模型配置后套用此刻生效的规则，站内报价和扣费代码（`taskflow`、AI 助手、`assistantbilling` 重试、电商套图、手持图报价、`/runtime-config`、`/pricing`、`/assistant/config`）都改用它；后台编辑、执行快照和开发者 API 仍读原始配置。订阅优惠在 `contractpricing.Resolve` 的末尾，只在 `Request.Site` 为真时生效，扣掉的单价记在 `BillingDecision.subscriberDiscountPoints`。

## 以提交时间为准

- 价格按用户**提交任务那一刻**的北京时间计算（测试可用 `store.WithBillingTime` 固定时间）。
- 用户看到的报价与提交时价格不同：提交时**更低**直接按低价扣费；**更高**返回 `price_changed`（409），提示用户确认新价格。电商套图的整套确认同理。
- 已提交的任务不受之后规则变化影响。

## 用户端

`/api/v1/runtime-config` 和 `/api/v1/assistant/config` 返回的价格已经是此刻的站内价，另外：

- 每个模型带 `priceAdjustment`（`ruleName`、`kind`、`mode`、`value`、`endsAt`，没有命中时为 `null`）和 `subscriberDiscount`（`mode`、`value`，没有时为 `null`）。
- 顶层 `priceSchedule.nextChangeAt`：下一次有规则开始或结束的时刻（7 天内）。
- 只有价格确实变了的模型才算命中：被底线截住、价格没变的模型不带 `priceAdjustment`。

网页与手机站：

- **限时调价标签**：`PriceAdjustmentTag`（`components/common/`）在价格旁显示「限时降 20%」「限时涨 5 积分」，悬停显示规则名称和结束时间（北京时间）。用在文生图、创作台、AI 助手模型菜单、AI 电商模型选择、无限画布模型选择、手机站底部参数条。
- **到点刷新**：`runtimeConfig.js` 读到 `nextChangeAt` 后安排一个定时器（错开 1–4 秒），到点清缓存并广播 `sc:site-prices-changed`。各页面用 `useSitePriceRefresh` 只更新模型列表和价格，已选模型、参数和草稿不动；AI 助手接在原有的配置刷新上（页面在后台时回到前台再刷新）；无限画布用 `refreshSiteCatalog` 换目录但保留所选模型。

公开模型状态页（`/api/v1/model-status`）：

- `price.currentCents` 是站内用户此刻支付的价格（含动态调价），`standardCents` / `discountCents` 是后台设置的标准价和折扣价，`baseCents` 是不含动态调价的实付价，`adjustment` 是生效中的规则。
- 卡片显示当前价、划线标准价（当前价低于标准价时）和限时调价标签。
- 响应缓存 1 小时，但会在 `priceNextChangeAt` 提前失效，后台保存调价规则或模型配置时立即失效；页面也在 `priceNextChangeAt` 那一刻重新读取。

## 后台接口

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/v1/admin/model-config/price-schedule` | 规则、订阅优惠、对用户开放的模型及原价、北京时间、此刻生效的规则、下次变化时间 |
| PUT | `/api/v1/admin/model-config/price-schedule` | 校验并保存整份规则（规则最多 50 条） |

## 测试

- `internal/pricerules/pricerules_test.go`：北京时间与边界、优先级、下次变化、取整与底线、套用到分档和页面单价、订阅优惠、校验。
- `internal/taskflow/dynamic_pricing_test.go`：按提交时间计价、低价直接通过、涨价需重新确认、成本底线。
- `internal/subscription/dynamic_pricing_test.go`：订阅优惠叠加在时段调价之后；开发者 API 报价两者都不生效。
- `internal/subscription/dynamic_pricing_lock_test.go`：订阅锁价下，锁定价更低按锁定价、限时降价后当前价更低按当前价，两种都再减订阅优惠；提交任务按报价扣费并从订阅额度扣。
