# API 调用模型目录设计

状态：**第一、二、三期均已实现**（2026-09-30）。第一期：目录表与回填、/v1 按目录解析与计价、Key 引用目录 ID、调用记录名称快照、后台「API 模型」管理与影响预览、体验积分不再用于 API、订阅 API 范围按目录判断、钱包/订阅页 API 消耗汇总、后台站内/API 消耗拆分、订阅锁价 7 天宽限与站内通知。第二期：维护（503）、弃用（响应头 + 到期自动下线）、下线（410）、紧急下线、弃用预告期设置、控制台状态展示、Key 列表与详情提醒、`/v1/models` 扩展字段、下线 90 天后从控制台隐藏、站内模型配置保存前的影响确认。第三期：涨价 7 天预告（固定价与跟随价，含站内折扣结束）、降价立即生效、控制台调价预告、站内通知。实现说明与前提见第 13 节。决定汇总见第 12 节；充值与订阅见第 8 节。相关文档：[开放 API](OPEN_API.md)、[API 调用控制台](DEVELOPER_CONSOLE.md)、[AI 服务线路](AI_SERVICE_ROUTING.md)。

## 1. 背景

API 调用（`/v1`）直接复用站内模型配置。运营在后台做的每一个模型操作——改名、调价、上下架、换线路——都会立刻、无提示地作用到 API 调用方身上。站内用户看到的是界面变化，API 调用方看到的是代码突然报错或账单突然变贵。

### 1.1 现状耦合

| 后台操作 | 对 `/v1` 的影响 | 代码位置 |
| --- | --- | --- |
| 修改模型显示名称 | `/v1` 的 `model` 值就是显示名称，改名后调用方代码里的旧名直接 404 | `openAIPublicModelID` 返回 `model.Name`（`internal/httpapi/handlers_openai_images.go`） |
| 调价、设折扣价 | 立即按新价格扣费，没有预告 | 图片按 `quote.TotalPriceCents`，对话按模型价；`modelconfig.EffectivePrice` 优先取折扣价 |
| 从「文生图」或「AI 助手」解绑 | 模型从 `/v1` 消失 | 图片模型要求绑定 `WorkspaceT2I`，对话模型要求绑定 `WorkspaceAssistant`（`openAIFilterPublicModels`） |
| 设为维护 | 立即不可用，调用方只能看到 404 | `Model.Available()` 只判断 `status != maintenance` |
| 换服务商、用新条目替换模型 | 新条目 ID 不同，Key「指定模型」里存的旧 ID 全部失效 | `user_api_keys.allowed_model_ids` 存内部模型 ID |
| 两个模型同名 | 按名字去重，只有一个可调用；另一个的 ID 留在 Key 里变成“未开放” | `openAIDeveloperModels` 按公开名去重 |
| 线路切到 CRUN 等非 OpenAI 协议 | 模型从 `/v1` 消失 | `developerAPIOffers` 要求 `Adapter == openai` |

另外两处副作用：

- **调用记录的模型名不是快照**：`usage_profit_ledger` 存内部 `model_id`，调用记录页按当前配置换算名字。模型改名后历史记录也跟着变；模型删除后名字为空。
- **旧配置默认对 API 开放**：`Model.DeveloperAPI` 在 JSON 缺省时视为 `true`，开关上线前存在的模型全部默认开放；后台新建模型才默认关闭。

### 1.2 实际发生的例子（本地库，2026-09-30）

5 把有效 Key 的「指定模型」里，共有 5 个对话模型（gpt-5-5、gpt-5-6、gpt-5.6-terra、gpt-5.6-sol 和一个旧 gpt-5.6-luna）未绑定「AI 助手」，因此不在 `/v1` 中。唯一可调用的对话模型是另一个同名、不同 ID 的 gpt-5.6-luna。其中 1 把 Key 的指定模型全部失效，调用任何模型都返回 404，用户没有收到任何提示。

## 2. 目标与非目标

**目标**

1. 对外承诺的模型名一经发布保持稳定：运营改站内名称、换内部模型、换线路，调用方代码不用改。
2. API 是否开放由 API 自己决定，不再被站内工作台的上下架连带。
3. 下线和调价有预告期，调用方能从响应头、控制台和通知里提前知道。
4. 运营每次改动前能看到影响范围（多少 Key、多少调用、多少用户）。
5. 账单和调用记录保留调用当时的模型名与价格。

**非目标**

- 不改站内创作、助手、画布的计费和选模型逻辑。
- 不引入按 token 计费；对话仍按次。
- 不做 API 专属的上游线路池，API 模型仍指向一个站内模型，由它的线路执行。

## 3. 核心概念：API 模型

新增一层「API 模型」（下称“目录条目”）。它是对外承诺的单位，站内模型是它背后的执行者。

```text
调用方  --model="gpt-image-2"-->  API 模型（稳定名、状态、价格）  --target-->  站内模型（名称、线路、上游）
Key 指定模型  -------------------->  API 模型 ID
```

### 3.1 字段

| 字段 | 说明 |
| --- | --- |
| `id` | 稳定标识，形如 `apim_` + 随机串。Key 的指定模型和账单都引用它 |
| `api_name` | 对外 `model` 值，全局唯一（大小写不敏感）。**发布（首次上线）后锁定，不能修改** |
| `aliases` | 别名列表，也可用于调用。用于改名过渡：新名作为 `api_name`（需新建条目，见 6.3）或把旧名放进别名 |
| `kind` | `image` 或 `chat`，决定挂在哪个接口下；创建后不可改 |
| `target_model_id` | 指向的站内模型。可以更换，更换需通过兼容性检查（见 6.2） |
| `status` | `draft` / `live` / `maintenance` / `deprecated` / `retired`，见第 5 节 |
| `price_mode` | `follow`（跟随站内原价）或 `fixed`（API 独立定价） |
| `price_cents` | `fixed` 时的单价（积分/次） |
| `pending_price` | 计划中的调价：`{price_cents, effective_at}`，到点自动生效 |
| `sunset_at` | 弃用后计划下线的时间 |
| `replacement_id` | 推荐替代的 API 模型，用于弃用提示和 410 响应 |
| `max_concurrency` | 该 API 模型同时进行的 `/v1` 请求上限，**默认 0 = 不限制**，后台可调。迁移时取自站内模型原来的 `developerApiMaxConcurrency`（该字段已移除） |
| `description` | 控制台模型页显示的说明 |

### 3.2 与站内模型的关系

- 一个站内模型可以被多个 API 模型指向（例如同一上游、不同定价档）；一个 API 模型只指向一个站内模型。
- API 模型的可用性 = 自身状态为 `live` 或 `deprecated`，且目标站内模型存在、启用、非维护，线路为 OpenAI 协议。**不再检查工作台绑定**。
- 站内模型上的 `developerApi` 开关已移除，由“是否有 API 模型指向它”取代。

## 4. 存储

目录放数据库表，不放进模型配置 JSON：需要被 Key 外键引用、需要变更审计、需要按条件查询影响范围。

```sql
CREATE TABLE developer_api_models (
    id               text PRIMARY KEY,               -- apim_xxx
    api_name         text NOT NULL,
    aliases          text[] NOT NULL DEFAULT '{}',
    kind             text NOT NULL CHECK (kind IN ('image','chat')),
    target_model_id  text NOT NULL,                  -- 站内模型 ID（模型配置 JSON 内，无外键）
    status           text NOT NULL CHECK (status IN ('draft','live','maintenance','deprecated','retired')),
    price_mode       text NOT NULL CHECK (price_mode IN ('follow','fixed')),
    price_cents      bigint CHECK (price_cents >= 0),
    pending_price_cents  bigint,
    pending_price_at     timestamptz,
    sunset_at        timestamptz,
    replacement_id   text REFERENCES developer_api_models(id),
    max_concurrency  int NOT NULL DEFAULT 0,
    description      text NOT NULL DEFAULT '',
    published_at     timestamptz,                    -- 首次 live 的时间；非空后 api_name 锁定
    created_at, updated_at timestamptz
);
CREATE UNIQUE INDEX ON developer_api_models (lower(api_name));
-- 别名与名称共享唯一空间，由应用层在同一事务内校验。

CREATE TABLE developer_api_model_events (          -- 变更审计与通知来源
    id bigserial PRIMARY KEY,
    api_model_id text NOT NULL REFERENCES developer_api_models(id),
    admin_id uuid, action text NOT NULL,            -- create/publish/retarget/price/status/alias
    before jsonb, after jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
```

其他表的调整：

| 表 | 调整 |
| --- | --- |
| `user_api_keys` | 新增 `allowed_api_model_ids text[]`，取代 `allowed_model_ids`（后者保留一个版本后删除） |
| `developer_api_billing_requests` | 新增 `api_model_id`、`api_model_name`（请求当时的名称快照） |
| `usage_profit_ledger` | 继续写内部 `model_id`（成本核算用），元数据加 `apiModelId` |
| `api_key_usage_events` | 额度与模型限制改按 `api_model_id` 判断 |

## 5. 生命周期

| 状态 | 控制台可见 | 可调用 | 调用结果 | 典型用途 |
| --- | --- | --- | --- | --- |
| `draft` | 否 | 否 | 404 `model_not_found` | 配置中，尚未发布 |
| `live` | 是 | 是 | 正常 | — |
| `maintenance` | 是（标“维护中”） | 否 | 503 `model_unavailable`，`Retry-After`，`X-Should-Retry: true` | 上游故障、临时停用 |
| `deprecated` | 是（标“将于 X 下线”） | 是 | 正常，附 `Deprecation`、`Sunset`、`Link: <替代模型文档>; rel="successor-version"` 响应头 | 预告下线 |
| `retired` | 是（标“已下线”） | 否 | 410 `model_retired`，消息给出替代模型名 | 正式停止 |

规则：

- `deprecated` 必须带 `sunset_at`，且距当前不少于**弃用预告期**。预告期在后台“API 调用设置”中可调，**默认 7 天**；到期由定时任务转为 `retired`。
- 紧急下线（上游彻底不可用、合规要求）可跳过预告期直接转 `retired`，需要二次确认并填写原因，记入 `developer_api_model_events`。
- 目标站内模型处于维护、被禁用或线路不可用时，API 模型按 `maintenance` 对外表现（503），不再是 404。
- 503 的请求在鉴权后、预留积分前拒绝，不扣费；可安全重试，与现有“网关不重试”并不冲突。
- `retired` 条目保留，用于 410 提示和历史账单；**下线 90 天后从控制台模型列表隐藏**，调用记录、账单和 410 提示不受影响。

## 6. 运营操作

### 6.1 影响预览

所有会改变调用结果或价格的操作（改状态、改指向、调价、删别名）在提交前展示：

- 引用它的有效 Key 数，以及其中“只剩它一个可用模型”的 Key 数；
- 近 7 天、30 天调用次数与调用用户数（来自 `developer_api_billing_requests`）；
- 对价格变更：按近 30 天调用量估算的月度费用变化。

站内模型配置页同步显示“被 N 个 API 模型引用”，对被 `live` API 模型引用的站内模型执行删除、禁用、切到非 OpenAI 线路时给出阻断或二次确认。

### 6.2 更换指向（retarget）

用于换服务商、换上游版本。保存前做兼容性检查：

- `kind` 必须一致；
- 新目标的能力不能少于旧目标：图片看分辨率、质量、参考图上限、单次张数、透明背景；对话看上下文长度、推理档位；
- 能力收窄时允许保存，但要求填写原因，并在控制台模型页显示“参数范围已调整”。

### 6.3 改名

`api_name` 发布后锁定。需要新名字时：

1. 新建 API 模型，指向同一站内模型，发布；
2. 旧模型设为 `deprecated`，`replacement_id` 指向新模型；
3. 预告期后旧模型转 `retired`。

若只是希望旧名继续可用，可把旧名作为新条目的别名（需先把旧条目转 `retired` 以释放名称）。

### 6.4 调价

- `follow`：跟随站内价格，**包括站内折扣价**（已确认）。站内打折时 API 同步降价，折扣结束恢复原价视为涨价，同样走预告（见下）。
- `fixed`：API 独立定价。
- 涨价只能通过 `pending_price` 定时生效，**预告期 7 天**；降价立即生效，不需要预告。
- `follow` 模式下站内价上涨（含折扣结束）同样会触发预告：系统把新价写入 `pending_price`，到期后才对 API 生效。
- 每次请求在预留时确定价格并写入 `developer_api_billing_requests.price_cents`，调价不影响已发出的请求（现有行为）。

## 7. 调用方可见的变化

**`/v1/models`** 返回稳定名，不含草稿与已下线：

```json
{"id": "gpt-image-2", "object": "model", "owned_by": "starcloudsai",
 "status": "deprecated", "sunset_at": "2026-11-01T00:00:00Z", "replacement": "gpt-image-3"}
```

`status`、`sunset_at`、`replacement` 为扩展字段，OpenAI SDK 会忽略，不影响兼容。

**控制台**

- 模型页显示状态、下线日期、替代模型，以及“X 月 X 日起调整为 N 积分/次”；
- Key 列表对引用了 `deprecated` 模型的 Key 标黄，引用了 `retired` 模型的标红（现有“未开放/无可用模型”标记改由此承担）；
- Key 编辑抽屉的模型选择只列 `live` 和 `deprecated`，`deprecated` 带标签。

**通知**：发布弃用、计划涨价时，给近 30 天调用过该模型或 Key 引用了它的用户发送站内通知（复用公告推送）。**只发站内通知，不发邮件**（已确认）。

**错误码**（加入 [开放 API](OPEN_API.md)）

| HTTP | code | 含义 |
| --- | --- | --- |
| 404 | `model_not_found` | 名称不存在、草稿，或未开放给这把 Key（现有） |
| 410 | `model_retired` | 模型已下线，消息中给出替代模型 |
| 503 | `model_unavailable` | 模型维护中，可稍后重试，不扣费 |

## 8. 充值与订阅

`/v1` 与站内共用一个钱包，扣费顺序与站内一致（`wallet.FreezeFeatureCredits`）。现状与决定如下。

### 8.1 现状（2026-09-30 核对）

| 资金来源 | 现状 | 依据 |
| --- | --- | --- |
| 充值余额 | API 可用 | 普通余额 |
| 订阅积分 | 套餐 `channels` 含 `api` 时可用；默认套餐为 `web` + `api` | `store.SubscriptionPolicy`，`wallet.WithSubscriptionScope(ctx, "api", modelID)` |
| 体验积分 | 用户持有文生图或 AI 助手体验资格时，API 生图、对话会消耗体验积分 | API 生图用文生图功能标识，对话用 AI 助手功能标识 |
| 订阅锁价 | **API 生图享受锁价**：生图报价复用 `taskflow.QuoteTaskPrice`，其中以 `api` 渠道调用 `contractpricing.Resolve`，套餐开启锁价且包含 `api` 渠道时按锁定价扣费（默认套餐即如此）。**API 对话不享受**，按当前价扣费 | `openAPIOnly` 设置 `api` 计费渠道；`handlers_openai_direct_images.go` 调 `QuoteTaskPrice`；`handlers_openai_chat.go` 未调用 `Resolve` |
| 订阅模型范围 | 按内部模型 ID 判断（`policy.ModelIDs`） | `SubscriptionPolicy.Allows` |
| 用户可见性 | API 扣费不进钱包明细，只在控制台调用记录中显示 | API 调用控制台调用记录 |

### 8.2 决定

| 编号 | 事项 | 决定 |
| --- | --- | --- |
| A | API 可用的资金 | 充值余额可用；订阅积分由套餐 `channels` 决定，后台套餐编辑页明确展示“可用于API 调用”；**体验积分不可用于 API** |
| B | 订阅锁价 | **不作用于 API**（2026-09-30 再次确认）。API 价格以本目录为准；控制台模型页注明“API 价格不享受订阅锁价”。因现有订阅用户的 API 生图目前按锁价扣费，取消属于涨价：上线后锁价对 API 生图再保留 7 天（截止时间存于后台设置 `developer_api_contract_lock_until`，可调），期间向近 30 天有 API 生图调用的订阅用户发站内消息；到期后 API 生图、对话统一按目录价格扣费 |
| C | 订阅模型范围 | `api` 渠道按 API 模型判断：套餐策略新增 `apiModelIds`；迁移时由原 `modelIds` 映射到指向这些站内模型的 API 模型。更换 API 模型指向不影响订阅权益 |
| D | 用户可见性 | 钱包页、订阅页各增加一行汇总：“API 调用本月消耗 N 积分 · 查看调用记录”，跳转控制台调用记录；明细仍只在调用记录中 |
| E | 后台核算 | 用户账务详情中，每个充值包、每期订阅额度的“已用”拆为“站内 / API”；订单退款核算注明“其中 API 调用消耗 N”。数据取自 `subscription_credit_allocations`、`topup_credit_allocations` 的 `source_type`，只读汇总，不改数据结构、扣费和退款公式 |

API 调用的 `source_type`：`openai_image_request`（生图、编辑）、`open_api_chat`（对话）、历史 `open_api_responses_chat`。

### 8.3 实现要点

- **A**：API 扣费使用专用功能标识（如 `developer_api_image`、`developer_api_chat`），体验资格不包含它们，体验积分因此自然不参与；订阅 `featureKeys` 为空（不限功能）的套餐不受影响，限定了功能的套餐需要在迁移时把原文生图、助手功能标识映射为对应的 API 标识，保持现有订阅权益不变。
- **C**：`modelIds` 为空（不限模型）的套餐对 API 也不限；限定了 `modelIds` 的套餐在 `api` 渠道判断 `apiModelIds`（为空表示订阅积分不能用于 API），`web` 渠道仍判断 `modelIds`。
- **D**：汇总按自然月、按用户，从 `developer_api_billing_requests`（`succeeded`）求和。

## 9. 迁移

一次迁移完成建表与回填，不改变任何调用方当前能调用的模型名。

1. **建表**：`developer_api_models`、`developer_api_model_events`，以及第 4 节的新增列。
2. **回填目录**：对每个 `DeveloperAPI = true` 的站内模型：
   - 当前能出现在 `/v1/models` 的（有工作台绑定、OpenAI 线路、未按名去重掉）→ 建 `live` 条目，`api_name` = 当前公开名，`price_mode = follow`（跟随站内价与折扣，与现有扣费一致），`published_at` = 迁移时间；
   - 其余（未绑定工作台、被同名去重、非 OpenAI 线路）→ 建 `draft` 条目，名称加后缀避免冲突（如 `gpt-5.6-luna-2`），等待运营确认。
3. **回填 Key**：`allowed_model_ids` 中每个内部 ID 映射到指向它的目录条目：
   - 映射到 `live` 条目的直接保留；
   - 映射到 `draft` 条目的也写入（发布后即恢复可用），迁移报告里列出；
   - 找不到条目的丢弃，并写入迁移报告。
   - 若一把 Key 回填后没有任何 `live` 模型，保持“指定模型”语义（不能变成“全部模型”），控制台标红提示。
4. **回填账单快照**：`developer_api_billing_requests` 的历史行按 `usage_profit_ledger.model_id` 与当前配置补 `api_model_name`，补不上的留空。
5. **迁移报告**：输出到后台“API 模型”页顶部，列出所有 `draft` 条目和受影响 Key，运营逐项确认。
6. **不设兼容期**（2026-09-30 决定，尚未上线，无需保留回滚通道）：迁移 `00174` 删除 `user_api_keys.allowed_model_ids`；站内模型的 `developerApi`、`developerApiMaxConcurrency` 字段从 `modelconfig.Model` 移除，后台模型编辑页不再有这两项。旧值只由一次性迁移读取：Key 旧列在删列前读取；站内模型的旧开关与并发上限直接从模型配置 JSON 读取（`apicatalog.ParseLegacy`，缺省视为开启），模型配置下一次保存时这些旧字段自然消失。
7. **执行顺序**：`serve` 启动时先迁移到 `00173`（`apicatalog.BackfillSchemaVersion`），执行目录初始化，再迁移到最新；`server api-models-migrate --apply` 同样只迁移到 `00173`。`00174` 自带检查：目录为空且仍有 Key 指定了模型时拒绝删列并报错，防止其他入口（如 `seed`）先删列造成丢失。已升级的库重复执行整个流程不会有任何变化。

**回滚**：`00174` 的 Down 会恢复旧列，并按 `allowed_api_model_ids` 指向的站内模型回填；旧版本的站内模型旧开关缺省视为开启。

## 10. 分期

| 阶段 | 内容 | 解决的问题 |
| --- | --- | --- |
| **一：稳定名称、Key 引用与账务** | 目录表、回填迁移、请求路径改走目录、Key 指定模型改存目录 ID、调用记录名称快照、后台“API 模型”页（列表、创建、发布、改指向、影响预览）；充值与订阅 A（体验积分不可用于 API）、C（订阅 API 模型范围）、D（钱包/订阅页 API 消耗汇总）、E（后台站内/API 消耗拆分） | 改名/换条目导致 Key 失效；工作台解绑连带下线；同名去重；体验积分被 API 消耗；用户看不到 API 花费 |
| **二：生命周期** | `maintenance`/`deprecated`/`retired`、503/410 错误码、`Deprecation`/`Sunset` 响应头、定时转下线、控制台状态展示 | 下线无预告、维护显示为 404 |
| **三：价格与通知** | `follow`/`fixed`、折扣隔离、定时调价、控制台调价预告、站内通知 | 调价立即生效、站内促销误伤 API |

每一阶段都可以单独上线；阶段一完成后，现有调用方行为不变。

## 11. 测试要点

- 迁移：用本地库副本验证回填结果（`live`/`draft` 分类、Key 映射、迁移报告），并验证可回滚。
- 改站内模型名称、改指向、解绑工作台后，`/v1` 仍按原 `api_name` 可调用。
- Key 指定模型在改指向后仍有效；指向被删时按 `maintenance` 表现。
- 各状态下的状态码、错误码、响应头、是否扣费。
- 定时调价到点生效；请求中途调价不影响该请求的价格。
- 影响预览的计数与实际数据一致。

## 12. 已确认的决定

| 事项 | 决定 |
| --- | --- |
| 弃用预告期 | 后台可调，默认 7 天；允许紧急下线（二次确认 + 填写原因） |
| 涨价预告期 | 7 天；降价立即生效 |
| `follow` 与站内折扣 | 跟随站内折扣；折扣结束恢复原价按涨价处理，走预告 |
| 通知渠道 | 只发站内消息 |
| 同一站内模型挂多个 API 模型 | 允许（用于不同定价档、专属客户价） |
| 已下线条目隐藏 | 下线 90 天后从控制台列表隐藏 |
| 并发上限 | API 默认不限并发；每个 API 模型可在后台单独设上限（0 = 不限）。站内模型上原来的 `developerApiMaxConcurrency` 已迁移到 API 模型并删除 |
| 充值与订阅 | 见第 8.2 节 A–E：体验积分不可用于 API；API 不享受订阅锁价；订阅 API 范围按 API 模型判断；钱包/订阅页显示 API 消耗汇总；后台拆分站内/API 消耗 |

### 12.1 与站内用户的隔离

`/v1` 请求直接转发上游，不创建站内任务、不进 Asynq 队列、不占 Worker 并发名额和用户的站内并发额度，因此 API 流量不会让站内用户排队。唯一的共享点是上游服务商本身的容量：

- 若上游对同一账号有并发或速率限制，API 突发流量可能让站内同一模型变慢或报错。
- 解决办法是给 API 模型指向一个**使用独立上游账号/线路的站内模型**（同一上游模型、不同 Provider 配置），站内与 API 各用各的配额；需要时再给该 API 模型设并发上限。
- 后台影响预览里同时显示该站内模型近 1 小时的站内调用量与 API 调用量，便于判断是否需要拆线路。

## 13. 实现说明与前提

**状态与价格按请求时刻计算。** `apicatalog.Match` 用 `StatusAt(now)` 判断状态：弃用（或弃用期间转维护）的模型一过 `sunset_at` 就按已下线处理（410），不依赖定时任务是否已经跑过。价格用 `EffectivePrice`：固定价取 `price_cents`，到期的 `pending_price_cents` 立即生效；跟随价取 `min(站内价, committed_price_cents 或到期的预告价)`，所以站内降价、打折立即生效，站内涨价在预告期内仍按原价。

**定时任务只负责落库与通知。** Worker 每分钟运行 `cron:reconcile_developer_api_models`（`apicatalog.Reconcile`）：把过了下线时间的模型记为 `retired` 并通知；把到期的预告价写入当前价；跟随价的模型发现站内价上涨时写入 `pending_price_*`（7 天后）并通知。后台保存模型配置后也会立即执行一次，涨价预告当场发出。**前提：Worker 需要以包含该任务的版本重启**；在此之前请求路径的即时计算保证不会提前涨价或让已下线模型继续调用，只是通知和落库会延后。

**涨价预告的细节。** 同一次预告期内站内价再小幅回落，保留原生效日期、只下调预告价；再次上涨超过已预告的价格，则按新价格重新预告 7 天并再发通知。草稿模型没有调用方，价格立即生效；发布时以当时的价格为起点。

**通知对象。** 近 30 天调用过该 API 模型的用户，加上未撤销的 Key 明确指定了它的用户（不限模型的 Key 不在内，因为无法判断是否在用）。消息类型为 `system` 站内消息，不发邮件。

**名称。** 已下线模型的 `api_name` 仍然占用（唯一索引与 410 提示需要），但它的别名释放；旧名称可以作为替代模型的别名继续使用，匹配时上线中的模型优先于已下线模型。

**订阅套餐的 API 范围。** 套餐 `modelIds`（站内模型范围）为空时，订阅积分可用于全部 API 模型；只有限定了 `modelIds` 的套餐才按 `apiModelIds` 判断 API 调用，且 `apiModelIds` 为空表示订阅积分不能用于 API。后台套餐编辑页在勾选「API」渠道且填写了模型范围时显示「API 模型」多选，并在适用场景里提供「API 调用生图 / 对话」（限定了适用场景的套餐需要勾选它们，API 才能用订阅积分）。目前线上只有额度包、没有订阅套餐，这些设置在上架订阅后才生效。

**站内模型配置的保护。** `PUT /api/v1/admin/model-config` 比较保存前后，凡是上线或弃用中的 API 模型会因此从可执行变为不可执行（站内模型被删除、停用、设为维护，或服务商线路改为非 OpenAI 协议），先返回 `409 api_model_impact`；管理员确认后带 `confirmApiImpact=1` 保存。后台模型卡片显示“API N”，编辑页列出引用它的 API 模型名。

**兼容期收尾已完成**（2026-09-30）：见第 9 节第 6、7 条。**未做的事**：真实上游的端到端验证需要在确认后单独进行。
