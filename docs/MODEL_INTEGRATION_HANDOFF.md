# 多模型接入交接文档

> 更新时间：2026-10-08
> 分支：`codex/publish-current-project`。2026-10-08 已单独提交（提交信息 `feat(models): multi-vendor model integration …`），与工作区里其他未提交的工作分开（见第 9 节）。
> 技术参考手册：[多厂商模型接入](MODEL_PROVIDER_INTEGRATION.md)，包括字段、规则、接口、命令的完整说明。本文侧重交接：做到哪了、怎么继续、注意什么。

状态标记：✅ 已完成并有测试　🟡 代码完成、未真实验证　⬜ 未开始　⏸ 用户决定不做

---

## 1. 一句话现状

后端已经做到“新厂商主要靠后台配置接入”：接口路径、鉴权头、生图接口类型、请求兼容规则、厂商模板都已就绪，Gemini 原生协议（对话 + 生图 + 模型目录）的代码也已写完。后台「服务商」页已重做。**所有厂商都还没有用真实 Key 跑通过对话和生图**，这是接手后的第一件事。

---

## 2. 需求来源

用户原始需求（2026-10-08，编号沿用用户清单）：

7. 准备接入 Gemini 的生图模型和对话模型
8. 准备接入 Grok 的生图模型和对话模型
9. 准备接入国内国外的知名大模型
10. 模型接入要做好页面和接入的灵活性，**不可以把数据写死，必须要灵活**

后续追加的要求：

- 后台模型配置页要重新做，原来的操作太难用（已完成）。
- PPT / PSD 导出设置不要占服务商页面空间，改成按钮打开；顶部那行统计文字也删掉（已完成）。
- 生图和对话都要测试，**每个模型都要测**（待完成，见第 6 节）。
- 整个过程要写文档，交接给下一个人（本文）。

---

## 3. 已定决策（接手前必读）

| 决策 | 内容 |
|---|---|
| 接入方式 | **官方直连和中转都要支持**，后台按服务商选择。 |
| 厂商范围 | 国外：Gemini、Grok、Anthropic、OpenAI；国内：DeepSeek、通义千问（百炼）、豆包（火山方舟）、智谱 GLM、Kimi、MiniMax；中转：OpenRouter、硅基流动、chatgpt2api、CRUN、自定义。 |
| 不接的厂商 | ⏸ 用户明确排除：百度文心/千帆、腾讯混元、阶跃星辰、零一万物、讯飞星火、商汤、可灵、即梦。它们都是私有异步协议，所以**通用异步任务适配器也不做**。不要再主动提。 |
| 灵活性 | 厂商差异只能放在配置里（服务商字段、模型上的兼容规则、后台可编辑的厂商模板），不能在代码里按厂商写分支。只有协议确实和 OpenAI 不同的才写适配器（目前只有 `gemini`）。 |
| 按模型配置 | 兼容规则、图片返回方式都**只设在模型上**，服务商上没有；对话和出图测试在「模型目录」里按模型做，服务商页只做连接检查（用户 2026-10-08）。模板里的兼容规则只在导入模型时复制给模型。旧配置中服务商上的规则在加载时自动合并进它的模型。 |
| 模型类型 | **对话还是生图只能由管理员设定**，程序不得按模型名或关键词猜测，目录导入时也不预选（用户 2026-10-08 明确要求）。 |
| 导入安全 | 从上游目录导入的模型一律**停用、不对用户开放**，管理员设置积分后再手动开放。新建的服务商也默认停用。 |
| 后台布局 | 服务商页采用左侧列表、右侧直接编辑的布局，不用弹窗；页面占满宽度，信息尽量一屏放下（用户的通用偏好）。 |
| 真实调用 | 用户允许真实生成测试，不需要每次请示，但要控制规模。 |
| 本地服务 | 只有用户要求，或为了完成用户要求的测试时，才重启本地 API/worker（见第 8 节）。 |

---

## 4. 架构速览

```text
后台「服务商」配置（model_dispatch_config.providers[]）
  adapter: openai | crun | gemini
  apiPath / authStyle / imageApi / compat     ← 第 1 阶段新增，全部可选
        │
        ▼
internal/providerclient   ← 唯一入口，所有调用点都从这里拿客户端
  ├─ Chat()  → sub2api.Client（前缀 / 鉴权头 / compat Transport）
  │           gemini：{apiPath}/openai/chat/completions，Bearer
  └─ Image() → c2a.Client（前缀 / 鉴权头 / compat Transport）
              imageApi=standard：只走标准 Images 接口
              gemini：挂 ImageBackend = internal/gemini（generateContent / Imagen predict）
        │
        ▼
调用点：worker 生图任务、AI 助手（对话 / 生图 / 联网搜索）、画布、
       图片分析、开发者 /v1 对话与直通生图、轮询
```

- **兼容规则**（`internal/upstreamcompat`）是一个 HTTP Transport，在请求发出前改写 JSON 请求体，因此所有调用路径都会生效，调用方不用逐个修改。
- **厂商模板**存在 `app_settings.model_provider_presets`；没有保存时使用内置的 `presets_default.json`。
- **Gemini 生图接入方式**：挂在 `c2a.Client.WithImageBackend` 上，`SubmitGenerateImagesTracked` 等方法会转交给它。worker 和助手原有的生图代码只把 `case AdapterOpenAI` 扩成了 `case AdapterOpenAI, AdapterGemini`。

---

## 5. 完成情况

### 第 1 阶段：去掉写死的接口路径和鉴权 ✅

| 项 | 状态 | 说明 |
|---|---|---|
| `apiPath`、`authStyle`、`imageApi`、`vendor` 字段 | ✅ | `modelconfig/connection.go`；旧配置不受影响，有校验 |
| 请求兼容规则（**只按模型**，10-08 改） | ✅ | 支持移除参数、参数改名、附加参数，生图尺寸可改为 `aspect_ratio`；平台控制的字段不能被改写 |
| 统一客户端入口 `providerclient` | ✅ | 替换了 9 处各自构建客户端的代码；顺带修复了开发者 `/v1` 对话直通原来漏传 CRUN `x-api-key` 的问题 |
| 模型目录支持路径前缀和鉴权头 | ✅ | 自动去掉 `models/` 前缀 |
| 厂商模板（15 个，后台可增删改、可恢复默认） | ✅ | `presets.go` + `presets_default.json` |
| 连接检查接口 | ✅ | 只读取模型列表（10-08 去掉了对话探测）；可用模型为 0 时判为不通过并列出模型名 |
| 模型目录里的模型测试 | ✅ | 10-08：用户要求对话、出图测试做在「模型目录」，不在服务商页。模型卡片「测试」→ `ModelTestDialog`，调用 `POST /model-config/model-tests`（逻辑在 `internal/modeltest`，与 `model-smoke` 共用） |
| 后台服务商工作台（重做） | ✅ | `apps/admin/src/views/model-config/`：模板选择、连接方式、线路表、连接检查、模型目录批量导入（兼容规则和对话测试已移出服务商页） |
| 模型编辑器加「请求兼容规则」 | ✅ | CRUN 服务商不显示 |
| PPT / PSD 设置改为工具栏按钮和弹窗 | ✅ | 只在服务商页显示 |
| 文档 | ✅ | `MODEL_PROVIDER_INTEGRATION.md`；`API_ROUTES.md`、`API_CONTRACT.md`、`AI_SERVICE_ROUTING.md`、`README.md` 已同步 |

### 第 2 阶段：Gemini 原生协议 🟡

| 项 | 状态 | 说明 |
|---|---|---|
| `gemini` 协议，默认 `/v1beta`、`x-goog-api-key` | ✅ | 后台协议选项多了「Gemini 原生」，「Google Gemini」模板已改用它 |
| Gemini 图片模型生图（含参考图） | ✅ | 10-08 用中转站实测通过（见 6.1）；官方 Key 未测 |
| Imagen 生图 | 🟡 | 单测通过，未真实验证 |
| Gemini 对话 | ✅ | 中转站 `api.klong.lat` 不支持 `/v1beta/openai`（报 `Invalid URL`）。10-08 新增模型级「对话接口」（兼容规则 `chatApi`）：官方 OpenAI 兼容 或 `/v1/chat/completions`。实测服务商「香蕉对话模型」4 个模型（gemini-3.1-pro-preview、3.6/3.7/3.8-flash）选 `v1` 后对话全部通过；工具调用：中转站的**非流式**响应会丢掉 `tool_calls`（返回空的 `{"content":""}`），**流式**正常。AI 助手的 Agent 用的是流式，所以 4 个模型的工具调用都可用（auto 和 required 都通过）。模型测试的工具调用步骤已改为调用生产环境同一个流式函数 `ChatAgentWithTools`，避免误判。中转站还提供原生 `generateContent` 和 `/v1/responses`，目前未接 |
| Gemini 原生模型目录 | ✅ | 只排除平台没接入的能力（向量、语音、视频等），**不判断对话/生图**，类型由管理员设定 |
| Gemini 推理档位 | 🟡 | 10-08 实测（中转站 `/v1`）：平台照常发 `reasoning_effort`，中转站会转成 Gemini 的思考档位。`none` 两个模型都报“thinking cannot be disabled”；`minimal` 3.8-flash 报不支持、3.1-pro 能用；`low/medium/high/xhigh` 都能用。3.1-pro 推理量明显随档位变化（low≈2.9k、medium≈4.1k、high≈13.5k、xhigh≈15.9k、不传≈15.5k tokens），3.8-flash 各档差别不明显。注意：这次的测试题本身无解，且每档只测一次，数据只能看趋势。`model-smoke` 新增 `-reasoning`、`-prompt`、`-skip-tools` |
| 图片返回方式（兼容规则 `imageResponse`） | ✅ | 10-08：各中转站返回图片的位置不同，用户要求**在模型上手动选择，不自动识别**。三种：原生 inlineData（默认）、文本里的图片链接、文本里的 base64。只设在模型上；后台只对 Gemini 协议的生图模型显示。实测：`api.klong.lat` 用「文本里的图片链接」2/2 通过，另外两种方式按预期报错 |
| 模型类型完全不预选 | ✅ | 10-08 用户要求：后端和前端都不再按名字猜类型，删除了模板的 `imageModelPatterns`、`GuessModelKind`、前端 `guessKind`；目录行默认「未设定类型」，没选类型不能导入 |
| 真实测试命令 `model-smoke` | ✅ | 见 6.1 |
| 每个模型真实测试 | 🟡 | 生图 2/2 通过；`gemini-nano-banana-2.1` 等用户在后台设定类型后再测 |

### 第 3 阶段：剩余厂商的生图差异 🟡

10-08 按官方文档实现完，单测和 e2e 通过，**还没用真实 Key 测**（用户有 Grok、豆包、通义、MiniMax 的 Key，智谱没有）。

| 项 | 状态 | 说明 |
|---|---|---|
| 参考图发送方式（兼容规则 `imageEdit`，按模型） | ✅ | `c2a/json_edits.go`：`json_image_url`（xAI）、`json_generations`（豆包）；后台模型编辑器「参考图发送方式」，只对 OpenAI 兼容协议的生图模型显示 |
| 百炼原生协议 `dashscope` | 🟡 | `vendorimage/dashscope.go`；生图 `/api/v1/services/aigc/multimodal-generation/generation`，每张图单独调用，下载 URL；对话和模型目录走 `/compatible-mode/v1`（目录里可能没有 qwen-image，可手动添加） |
| MiniMax 原生协议 `minimax` | 🟡 | `vendorimage/minimax.go`；`/v1/image_generation`，`aspect_ratio` 取最接近的预设（输出约 1K），`response_format=base64`，参考图作为人物主体参考 |
| 模板更新 | ✅ | xAI 加 `imageEdit`；豆包加 `watermark:false` 和 `imageEdit`；智谱移除 quality、response_format 等参数；通义、MiniMax 改用新协议 |
| 模板兼容规则只套用到生图模型 | ✅ | 避免把生图参数（如豆包 `watermark`）带进对话请求 |
| Grok 参数实测（中转站 `api.klong.lat`，grok-imagine-image-2.0，10-08） | ✅ | 不传参数：1248x832 JPEG。`size` 有效：中转站把它换成比例 + 档位（1024x1024→1024²；1792x1024→2816x1584；1024x1792→1584x2816；2048x2048→2048²；3840x2160 也只到 2816x1584）。`aspect_ratio` 有效（16:9→1280x720，9:16→720x1280，1K）。`resolution`：1k→1024²，2k→2048²，4k 不报错但最大只有 2048²，1.5k 报错。2K 输出是 PNG（约 7MB），1K 是 JPEG（约 350KB）。`quality`：low/medium 能用但看不出区别；中转站文档写的 standard/hd 会被 xAI 拒（422），high 报 400。`style: natural` 不报错，效果未知。中转站不返回 `usage`，看不到扣费。**结论：这个中转站上 Grok 模型的「生图尺寸参数」应选 `size`（模板默认的 aspect_ratio 会丢掉 2K），继续移除 quality，分辨率只开放 1K/2K。** 诊断命令：`model-smoke -raw-image '<JSON 数组>'` |
| 生图参数档案 | 🟡 | 10-08 用户要求把 GPT / Grok / Gemini 的参数分开处理（中转可能已聚合也可能没聚合）。实现为后台可编辑的档案（见 `MODEL_PROVIDER_INTEGRATION.md`「生图参数档案」），内置 OpenAI 标准 / Grok 原生 / Gemini 原生；xAI 模板改为使用 Grok 档案。单测、e2e 通过；用中转站实测时该 Key 一直返回“并发已满”，**还没跑通真实请求** |
| 待实测重点 | ⬜ | 豆包 4.5 / 5.0 lite 的 `size` 像素下限较高（≥3686400），平台的 1K/2K 尺寸可能被拒，需要在模型能力里只开放够大的分辨率，或再加尺寸写法选项；Grok 编辑接口的多图字段 `images` 文档没给完整示例 |

见 6.2。

### 第 4 阶段：各厂商真实 Key 实测 ⬜

见 6.3。

---

## 6. 接手后要做的事（按顺序）

### 6.1 跑通 Gemini 真实测试（最优先）

**当前状态（2026-10-08）**：Gemini 原生服务商“恐龙香蕉”（中转站 `https://api.klong.lat`，ID `provider-muytzow5-1ku6o`）已保存，目录里有 3 个模型。实测结果：

| 模型 | 测试类型 | 文生图 | 图生图 | 对话 | 工具调用 |
|---|---|---|---|---|---|
| `gemini-3-pro-image-preview` | 生图 | ✅ 24s | ✅ 31s | — | — |
| `gemini-3.1-flash-image-preview` | 生图 | ✅ 16s | ✅ 30s | — | — |
| `gemini-nano-banana-2.1` | 未设定 | ⬜ | ⬜ | ⬜ | ⬜ |

- 图片质量人工看过：正常，图生图保留了原图主体。
- `gemini-nano-banana-2.1` 第一次被当成对话测试，报 `Invalid URL (POST /v1beta/openai/chat/completions)`，说明这个中转站不支持 Gemini 的 OpenAI 兼容对话地址（坑 1）。它的类型要等用户在后台设定，**不要替用户判断**。
- **用户要在后台「模型目录」里把这两个模型的「图片返回方式」设为「文本里的图片链接」**（模型编辑 → 请求兼容规则），设好后可直接点模型卡片的「测试」验证，否则默认按原生 inlineData 读取，会生图失败。
- 改动要重启 API 和 worker 后才在站内生效（第 8 节）。
- `model-smoke -image-response <方式>` 可以只在本次测试里覆盖返回方式，不改后台配置。

测试步骤：

```bash
cd apps/server && go build -o /tmp/startcloudsai-smoke ./cmd/server
# 用本地 API 的环境变量运行（launcher 脚本路径见第 8 节）；Key 不会被打印
zsh -c "source <(grep -v '^exec' <launch-serve.sh 路径>) && /tmp/startcloudsai-smoke model-smoke -provider gemini -list"
zsh -c "source <(grep -v '^exec' <launch-serve.sh 路径>) && /tmp/startcloudsai-smoke model-smoke -provider gemini -catalog -out <输出目录>"
```

- `-provider` 可以填服务商 ID、名称或模板 ID。如果匹配到多个，命令会报错并列出全部服务商。
- 不加 `-catalog` 时只测已配置的模型，按后台设定的类型测。`-catalog` 会测上游目录里的所有模型，但未配置的模型没有类型，需要加 `-kind chat|image` 指定，否则跳过并列出。
- 对话模型测两项：问答，以及工具调用。工具调用不通过时，到后台把该模型的「支持工具调用」关掉，Agent 模式就不会再用它。
- 生图模型测两项：文生图，然后用生成的图做一次图生图。图片保存在 `-out` 目录，**要人工看一眼质量**。
- 结果要写回 `MODEL_PROVIDER_INTEGRATION.md` 的“阶段进度”表和本文第 5 节。

**容易踩的坑**（都还没验证过）：

1. **中转站上的 Gemini 对话**：`gemini` 协议的对话发往 `{Base URL}/v1beta/openai/chat/completions`。Google 官方有这个地址，但很多中转站（new-api 一类）只在 `/v1/chat/completions` 提供 OpenAI 格式。如果对话测试返回 404：
   - 推荐：再建一个 `openai` 协议的服务商，Base URL 填同一个中转地址，专门跑 Gemini 对话。
   - 或者：确认这个中转站提供 OpenAI 兼容路径后，把 `GeminiChatPath` 改为可配置。
2. **中转站的鉴权**：生图默认用 `x-goog-api-key` 请求头。如果中转站只认 `Authorization: Bearer`，在服务商「鉴权方式」里改成 Bearer。对话固定用 Bearer。
3. 4K 只有部分 Gemini 图片模型支持；Imagen 只支持 1K/2K。超出时上游会报错，需要在模型能力里限制可选分辨率。
4. 多张出图会并发调用 n 次，费用也是 n 倍，部分成功时只返回成功的那几张。计费按实际出图数是否正确，需要用一次真实的多张任务核对。

### 6.2 第 3 阶段：剩余厂商的生图差异

这些都是**只看文档的推断，没有实测**；动手前先用 `model-smoke -kind image` 确认实际报错，再决定是加配置还是写代码。原则是能用兼容规则解决的，就不写代码。

| 厂商 | 现状 | 预计要做的 |
|---|---|---|
| xAI Grok 生图 | 模板已配：移除 `quality`、`background` 等参数，尺寸改用 `aspect_ratio` | 实测文生图。图生图走标准 multipart `/images/edits`，Grok 是否支持、需要什么格式没有确认；如果需要 JSON 格式的参考图，参考下一行豆包的做法 |
| 豆包 Seedream | 模板只配了路径 `/api/v3` | 实测文生图；`size` 可能需要 `2K` 这类写法，水印可用附加参数 `{"watermark": false}` 关掉。**参考图很可能要用 JSON 字段**（`image` 传 URL 或 base64），而现有的标准图生图走 multipart，需要给兼容规则加一种“参考图用 JSON 发送”的方式（`modelconfig.RequestCompat` + `c2a` 图生图分支） |
| 智谱 CogView | 模板路径 `/api/paas/v4` | 实测；可选尺寸较少，可能要在模型能力里限制；返回的是图片 URL（c2a 已支持下载 URL） |
| 通义 qwen-image | 兼容模式不提供生图 | 需要新写**百炼原生适配器**（第 2 阶段 Gemini 的做法：实现 `c2a.ImageBackend`，在 `providerclient` 里按协议挂上）。百炼的多模态生成接口有同步调用方式（multimodal-generation）。具体地址和字段**以阿里云官方文档为准**，加一个新协议值（如 `dashscope`），对话仍走兼容模式 |
| MiniMax image-01 | 地址和字段与 OpenAI 不同 | 优先考虑写一个轻量的 `ImageBackend`（地址、`aspect_ratio`、`response_format`、返回结构都不同，兼容规则管不到地址），以官方文档为准 |
| 其他对话模型 | 模板就绪 | 第 4 阶段逐个实测 |

每新增一个协议，都要同步：
- `modelconfig.ValidAdapter`、`AuthStyleFor`；
- `providerclient.Image/Chat`；
- worker 的 `callConfiguredUpstream` 和助手的 `executeConfiguredAssistantImage` 里的 `case`；
- `modelprovider.DiscoverModels`；
- 后台 `providerTypes.ts` 的 `ADAPTER_OPTIONS` 和 `apiRoot`；
- 模板 JSON；
- 两篇文档。

### 6.3 第 4 阶段：各厂商真实测试清单

用户说过手上有各家的 Key，配置到后台就能测。每一家：后台用模板添加，填 Key，测试连接，保存，然后跑 `model-smoke -provider <模板ID> -catalog`，再到站内用 AI 助手和文生图各走一次真实流程，确认计费、模型健康状态、错误提示是否正常。

| 厂商 | 对话 | 工具调用 | 文生图 | 图生图 | 备注 |
|---|---|---|---|---|---|
| Gemini | ⬜ | ⬜ | ✅ | ✅ | 中转站实测，见 6.1 |
| Grok | ⬜ | ⬜ | ⬜ | ⬜ | |
| DeepSeek | ⬜ | ⬜ | — | — | 推理模型是否支持工具调用要实测 |
| 通义千问 | ⬜ | ⬜ | ⬜ | ⬜ | 生图依赖 6.2 |
| 豆包 | ⬜ | ⬜ | ⬜ | ⬜ | |
| 智谱 GLM | ⬜ | ⬜ | ⬜ | — | |
| Kimi | ⬜ | ⬜ | — | — | |
| MiniMax | ⬜ | ⬜ | ⬜ | — | 生图依赖 6.2 |
| Anthropic（兼容层） | ⬜ | ⬜ | — | — | |
| OpenRouter / 硅基流动 | ⬜ | ⬜ | 视模型 | 视模型 | |

### 6.4 可选的后续工作

- 开发者 `/v1` 目前只开放 `openai` 协议服务商的模型（`apicatalog/catalog.go`）。如果要让开发者调用 Gemini 原生生图，需要放开这个检查，并确认 `handlers_openai_direct_images.go` 的直通路径（目前只有 `GenerateImagesStandard` 有转交给 ImageBackend，`EditImagesStandardStream` 没有）。
- 兼容规则只改写 JSON 请求体，multipart 请求不受影响。
- 以后可以考虑把各模型的默认能力（比例、分辨率、参考图上限）也放进模板。但对话还是生图仍然只能由管理员设定，模板里不能放关键词规则。

---

## 7. 怎么验证

```bash
# 后端：新增和受影响的包
cd apps/server
go test ./internal/modelconfig ./internal/upstreamcompat ./internal/providerclient ./internal/gemini ./internal/modelprovider ./internal/c2a ./internal/sub2api
go test ./internal/httpapi ./internal/worker ./internal/apicatalog   # 较慢，httpapi 约 8 分钟

# 后台：类型检查和构建
cd apps/admin && npx vue-tsc --noEmit && npx vite build && npm run test:model-config-save

# 后台 e2e（需要后台开发服务在 3200 端口运行，全部使用模拟接口，不需要登录）
cd apps/web-react
ADMIN_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/admin-model-providers.spec.js
# 可选：MODEL_PROVIDER_SHOTS=<目录> 保存截图
```

已知的**改动前就存在的**失败：`tests/e2e/admin-exact-image-size.spec.js` 的 3 个用例（找不到「支持精确尺寸」开关，因为模型编辑器改成标签页后它被隐藏了）。已用改动前的页面验证过同样失败，与本项工作无关。

交接时的结果：上面的后端测试、类型检查、构建和 e2e（3 个用例）全部通过。

---

## 8. 本地环境注意事项

- **本地服务**：API 和 worker 在两个分离的 `screen` 会话 `startcloudsai-api`、`startcloudsai-worker` 里运行，由之前会话草稿目录下的 `launch-serve.sh`、`launch-worker.sh` 启动。这两个脚本含凭据，不要打印。用 `ps -o ppid= -p <serve pid>`，再看其父进程的命令行，就能找到脚本路径。
- **重启步骤**：
  1. `go build -o /tmp/startcloudsai-local-server.new ./cmd/server`，再用 `mv` 覆盖 `/tmp/startcloudsai-local-server`。
  2. kill 掉 serve 和 worker 的进程号。注意：`pgrep -f "startcloudsai-local-server serve"` 也会匹配到父 zsh，要用 `pgrep -fl "startcloudsai-local-server (serve|worker)"` 核对。
  3. 等 8000 端口释放，旧 serve 会先处理完 SSE 连接，约 15–20 秒。
  4. `screen -dmS startcloudsai-api /bin/zsh <launch-serve.sh>`，worker 同理。
  5. 检查 `curl localhost:8000/api/v1/health`，并确认恰好一个 serve 和一个 worker。
- 只改了 httpapi、catalog 这类只在 API 进程里用的代码时，只需要重启 serve。改了 `providerclient`、`gemini`、`c2a`、worker 的代码时，worker 也要重启。
- **后台开发服务**（vite，3200 端口）支持热更新，改前端不需要重启。
- **权限限制**：本次会话里，创建临时管理员会话、直接读数据库里的模型配置，都被自动权限检查拦截了。所以后台页面只用 Playwright 加模拟接口验证过，真实数据下的页面要请用户登录后看。`model-smoke` 通过应用自己的配置读取 Key，可以正常运行。
- 上游请求经过本地代理 `127.0.0.1:7897`，遇到 TLS 或下载超时时，先排查网络。

---

## 9. 提交说明

本项已在 2026-10-08 单独提交。提交时工作区里还有两项**不属于本项**的未提交工作，没有一起提交：

- AI 助手：提示词拆成固定部分和每轮变化部分（为上游提示词缓存）、按需加载工具（`assistant_tool_loading*`）、`assistantv2`、`assistanttools`、会话生命周期，以及前端 assistant 页面。
- 前端导航栏与主题：`NavBar`、`NavDrawer`、`ThemeSwitch`、`appearance.js` 等。

两项工作都改了的文件，只提交了属于本项的部分：
- `apps/server/internal/worker/assistant.go`：只提交了对话客户端和生图客户端改用 `providerclient`、新增协议的 `case`。
- `apps/server/internal/sub2api/client.go`：只提交了 `WithAPIPrefix`、`WithAuthHeaders`、`WithTransportWrapper`、`endpoint` 及其调用；提示词缓存命中统计（`CachedTokens`）和对应测试留给 AI 助手那项工作。

本项没有数据库迁移：新字段都放在 `app_settings` 的 JSON 里，旧数据直接兼容（服务商级兼容规则会在加载时合并进模型）。

## 10. 已知风险和待确认问题

| 问题 | 影响 | 建议 |
|---|---|---|
| 中转站是否支持 `/v1beta/openai` 对话 | Gemini 原生服务商在中转站上可能无法对话 | 见 6.1 第 1 条 |
| 厂商模板里的地址、兼容规则都按公开文档推断，没有实测 | 个别厂商可能需要调整模板 | 实测后在后台改模板，或直接改 `presets_default.json` |
| Grok 和豆包的图生图格式没有确认 | 图生图可能失败 | 6.2 |
| Gemini 多张出图是并发 n 次请求 | 费用乘以 n，可能触发限流 | 实测后考虑限制 Gemini 模型的最大张数 |
| `sniffMime` 只识别 PNG、JPEG、WebP、GIF，其他格式一律当成 PNG | 少见格式的参考图可能被拒 | 需要时扩展 |
| 开发者 `/v1` 不能调用 Gemini 原生模型 | 功能限制 | 6.4 |
| 后台只用模拟数据验证过 | 真实配置下的布局细节可能有问题 | 请用户在真实后台看一遍 |
