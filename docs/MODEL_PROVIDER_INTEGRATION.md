# 多厂商模型接入

核对基线：2026-10-08 当前工作区（未提交）。交接说明（进度、下一步、文件归属）见 [多模型接入交接](MODEL_INTEGRATION_HANDOFF.md)。本文说明如何把 Gemini、Grok、国内大模型等接入站内模型目录，以及背后的连接、兼容和测试机制。模型目录、执行快照、调度与重试见 [AI 服务路由](AI_SERVICE_ROUTING.md)。

## 设计原则

- **数据驱动，不写死厂商**：厂商之间的差异（地址、接口路径、鉴权头、参数差异）全部是服务商上的配置，或后台可编辑的厂商模板。新增一个 OpenAI 兼容厂商只需在后台配置，不改代码。
- **只有真正非 OpenAI 的协议才写适配器**：目前有 `openai`、`crun`、`gemini`、`dashscope`（百炼原生）、`minimax`（MiniMax 原生）五种协议。后三种的生图走 `internal/gemini`、`internal/vendorimage` 里实现了 `c2a.ImageBackend` 的客户端，对话仍走 OpenAI 兼容接口。
- **所有调用点共用一个入口**：生图任务、AI 助手、画布、图片分析、开发者 `/v1` 都通过 `internal/providerclient` 构建上游客户端，连接规则只在这一处生效。

## 接入范围

| 厂商 | 协议 | 对话 | 生图 | 状态 |
|---|---|---|---|---|
| Google Gemini | `gemini` | OpenAI 兼容端点 | 原生 `generateContent` / Imagen `predict` | 已接入，待真实 Key 实测 |
| xAI Grok | `openai` | ✓ | ✓（`aspect_ratio`，裁剪不支持的参数；图生图 `imageEdit=json_image_url`） | 已按官方文档适配，待实测 |
| DeepSeek、Kimi | `openai` | ✓ | — | 模板就绪 |
| 智谱 GLM | `openai`（`/api/paas/v4`） | ✓ | CogView（模板移除 quality 等参数；不支持参考图） | 已按官方文档适配，无 Key 未测 |
| 火山方舟 · 豆包 | `openai`（`/api/v3`） | ✓ | Seedream（参考图 `imageEdit=json_generations`，模板关水印） | 已按官方文档适配，待实测 |
| 阿里云百炼 · 通义 | `dashscope`（原生 `/api/v1`；对话和目录走 `/compatible-mode/v1`） | ✓ | qwen-image / qwen-image-edit：`multimodal-generation` 同步接口，参考图最多 3 张，结果为 URL（下载后保存），每张图单独调用（n=1） | 已按官方文档适配，待实测 |
| MiniMax | `minimax`（`/v1`） | ✓ | image-01：`/image_generation`，尺寸换算为最接近的 `aspect_ratio`，返回 base64；参考图只能是人物（`subject_reference` type=character） | 已按官方文档适配，待实测 |
| Anthropic、OpenRouter、硅基流动、自定义 | `openai` | ✓ | 视上游 | 模板就绪 |

不接入：文心/千帆、混元、阶跃、零一万物、讯飞星火、商汤、可灵、即梦（均为私有异步协议，按需求排除）。

## 服务商连接配置

服务商（`model_dispatch_config.providers[]`）在原有名称、协议、线路之外新增以下字段，全部可选；旧服务商不填时行为与以前完全一致。

| 字段 | 含义 | 默认 |
|---|---|---|
| `vendor` | 创建时使用的厂商模板 ID，仅用于展示和“获取 API Key”链接 | 空 |
| `apiPath` | 兼容接口根路径，拼在每条线路 Base URL 之后，如 `/v1beta/openai`、`/api/v3`、`/api/paas/v4` | 空：OpenAI 自动补 `/v1`；CRUN 为 `/api/v1`；Gemini 为 `/v1beta` |
| `authStyle` | Key 放在哪个请求头：`bearer`、`x-api-key`、`x-goog-api-key`、`bearer+x-api-key` | 空：OpenAI 为 Bearer；CRUN 为 Bearer + `x-api-key`；Gemini 为 `x-goog-api-key` |
| `imageApi` | `standard` 表示只调用标准 `/images/generations`、`/images/edits` | 空：先走 chatgpt2api 可恢复异步任务协议，不支持时回退标准接口 |
| `compat` | **已废弃**：兼容规则只设在模型上（`models[].compat`）。旧配置里服务商上的规则会在加载时合并进它下面的每个模型，然后清空 | 空 |

`apiPath` 只允许 `/段/段` 形式（字母、数字、`._~-`），不能包含 `..`、协议或域名。

请求地址 = 线路 Base URL + `apiPath` + 操作路径。例如 Base URL `https://ark.cn-beijing.volces.com`、`apiPath` `/api/v3` 时，对话请求发往 `https://ark.cn-beijing.volces.com/api/v3/chat/completions`。

## 请求兼容规则

兼容规则**只按模型配置**（`models[].compat`，后台模型编辑窗口的「请求兼容规则」）。同一个中转站下不同模型的要求可能不同，所以不再设服务商级规则（2026-10-08 用户要求）。规则在发送前改写 JSON 请求体（`internal/upstreamcompat`，以 HTTP Transport 实现，覆盖所有调用路径）。

| 规则 | 作用 | 例子 |
|---|---|---|
| `dropParams` | 删除上游不认的顶层字段 | Grok 生图删除 `quality`、`background`、`moderation`、`output_format`、`output_compression`、`style` |
| `renameParams` | 字段改名 | `{"max_completion_tokens": "max_tokens"}` |
| `extraBody` | 合并进每个请求体，覆盖同名字段 | 豆包 Seedream `{"watermark": false}` |
| `imageSizeParam` | 生图请求如何传尺寸：空为 `size=宽x高`；`aspect_ratio` 把 `size` 换算成最接近的比例；`none` 不传尺寸 | Grok 用 `aspect_ratio` |
| `imageEdit` | 仅 OpenAI 兼容协议的生图模型：参考图怎么发。空为 multipart `POST /images/edits`（OpenAI 标准）；`json_image_url` 为 JSON `POST /images/edits`，`image: {type: image_url, url}`，多张用 `images: [...]`（xAI）；`json_generations` 为 JSON `POST /images/generations`，`image` 为 data URI 或数组（豆包 Seedream）。按配置选择，不自动识别 | xAI、豆包模板已预设 |
| `chatApi` | 仅 `gemini` 协议的对话模型：对话走哪个接口。空为 `{apiPath}/openai/chat/completions`（Google 官方 OpenAI 兼容）；`v1` 为 `/v1/chat/completions`（多数中转站提供）。都用 Bearer 鉴权。按配置选择，不自动识别 | 中转站 `api.klong.lat` 用 `v1` |
| `imageResponse` | 仅 `gemini` 协议：生图结果在哪里。空为原生 `inlineData`（官方接口）；`text_url` 为文本里的图片链接（平台用安全下载取回）；`text_data_uri` 为文本里的 `data:image/…;base64,…`。**只按配置读取，不自动识别**；选错时报“没有返回图片（图片返回方式：…）”并附上上游文本。只影响响应，不改写请求体 | 中转站 `api.klong.lat` 用 `text_url` |

限制：`model`、`messages`、`prompt`、`stream` 由平台控制，不能被删除、改名或覆盖；字段名必须是合法标识符。只改写 JSON 请求体，multipart 上传（标准 `/images/edits`）不受影响。

对话客户端已按模型自动选择 `max_tokens` 或 `max_completion_tokens`（GPT-5 / o 系列用后者），一般不需要为此配置改名规则。

## 生图参数档案

GPT、Grok、Gemini 的生图参数有的相同、有的不同；有的中转站已经把参数聚合成 OpenAI 格式，有的没有。平台统一生成尺寸（`size=宽x高`）、画质等参数，再按模型选定的**生图参数档案**换成上游认的字段（2026-10-08）。

- 档案是数据，存在 `app_settings.model_image_param_profiles`；没有保存时用内置的 `image_param_profiles_default.json`。后台「模型配置」工具栏的「生图参数档案」按钮打开大窗口：左侧档案列表（显示规则摘要和在用模型数），中间分五块编辑（基本信息、尺寸、画质、不发送的字段、选用时填入的能力），右侧按选定的分辨率 / 比例 / 画质预览上游实际收到的请求体，并可选一个生图模型用**未保存的草稿规则**做真实测试，显示请求尺寸和实际输出的像素、格式、大小。
- 内置三个：**OpenAI 标准**（原样发送，GPT 生图和已聚合的中转用）、**Grok 原生**（`aspect_ratio` + `resolution: 1k/2k`，不发 quality、background 等）、**Gemini 原生（OpenAI 接口）**（`aspect_ratio` + `image_size: 1K/2K/4K`，字段名可在档案里改）。
- 档案规则：尺寸写法（`size` / 只发比例 / 比例 + 分辨率档位 / 不发）、比例字段名和可选比例（就近取值）、档位字段名和 1K/2K/4K 的取值（缺的档位降到下一档）、画质（原样 / 换值 / 不发）、不发送的字段。档位按平台尺寸的长边判断：≤1536 为 1K，≤2880 为 2K，更大为 4K。
- 模型在「请求兼容规则」里选档案（只对 OpenAI 兼容协议的生图模型显示），存为 `compat.imageParams`。选档案时按档案的「能力」填好模型的分辨率、画质、参考图上限等，可再手动调整。选了档案后，「生图尺寸参数」不再显示，由档案决定。
- 服务端保存模型配置时，把档案规则复制到 `compat.imageParamRules`；修改或恢复档案时，自动刷新所有用到它的模型。这样执行快照和 worker 都带着完整规则。正在被模型使用的档案不能删除（保存会报错）。
- 改写发生在请求发出前（`upstreamcompat.ApplyImageParamRules`），只作用于 JSON 生图请求（含 JSON 方式发送的参考图）；multipart 上传不受影响。模型上的移除、改名、附加参数规则在档案之后执行，可做个别微调。
- 管理接口：`GET/PUT/DELETE /api/v1/admin/model-config/image-param-profiles`。
- 诊断：`model-smoke -image-params <档案ID> -size 2048x1152 -image-edit json_image_url` 可只在本次测试里套用档案。

## 厂商模板

- 内置模板：`apps/server/internal/modelconfig/presets_default.json`。
- 管理员修改后保存在 `app_settings.model_provider_presets`，后台可新建、编辑、删除，或“恢复默认”删除该设置回到内置模板。
- 模板在创建服务商时预填 Base URL、`apiPath`、`authStyle`、`imageApi`。模板的 `compat` 是「导入模型时的默认兼容规则」：从该模板的服务商导入模型时复制到每个模型上，之后在模型上单独改。修改模板不会影响已创建的服务商和已导入的模型。
- 模型是对话还是生图**一律由管理员在导入时设定**，系统不按模型名猜测，模板里也没有关键词字段（原来的 `imageModelPatterns` 已于 2026-10-08 删除，旧数据里的这个字段会被忽略）。

## Gemini 原生协议

协议 `gemini`（`internal/gemini`）：

- **对话**：走 Google 的 OpenAI 兼容端点 `{Base URL}{apiPath}/openai/chat/completions`，Key 以 Bearer 发送；流式、工具调用、推理强度与其他 OpenAI 兼容模型一致。
- **Gemini 图片模型**（ID 含 `image`，如 `gemini-2.5-flash-image`、`gemini-3-pro-image-preview`）：`POST {apiPath}/models/{模型}:generateContent`，`responseModalities: ["TEXT","IMAGE"]`。
  - 参考图以 `inlineData` 随提示词发送，支持文生图和图生图。
  - 请求尺寸 `宽x高` 换算为 `imageConfig.aspectRatio`（1:1、2:3、3:2、3:4、4:3、4:5、5:4、9:16、16:9、21:9 中最接近的）和 `imageSize`（长边 ≤1536 为 1K，≤3072 为 2K，否则 4K；1K 不发送）。
  - 每次调用返回一张图；需要 n 张时并发 n 次，部分成功时返回已成功的图片。
- **Imagen**（ID 以 `imagen` 开头）：`POST {apiPath}/models/{模型}:predict`，`sampleCount` 每次最多 4，比例收窄到 Imagen 支持的 1:1、3:4、4:3、9:16、16:9，2K 时发送 `sampleImageSize`。Imagen 不支持参考图，带参考图会直接报错。
- **错误处理**：
  - 提示词被拦截（`blockReason`）或没有返回图片时，报错带上 Google 给出的 `finishReason` 和文字说明。
  - 429 和 5xx 视为可重试的网络错误，其余为不重试的上游错误。
  - 连接中断或超时包装为同步生图错误，不会盲目重提交，避免重复计费。
- **接入方式**：Gemini 生图后端挂在 `c2a.Client` 的 `ImageBackend` 上，所以 Worker 生图任务、AI 助手、画布等原有调用代码不需要区分协议。
- **模型目录**：调用原生 `GET {apiPath}/models`（自动翻页）。
  - 有 `supportedGenerationMethods` 时：`predict` 的 Imagen 视为生图，`generateContent` 且 ID 含 `image` 的视为生图，其余 `generateContent` 视为对话。
  - 中转站常不返回该字段，此时按模型名判断。
  - 嵌入、TTS、原生音频、Live、Veo 视频等暂不接入，在目录中标为“暂不支持”。
- **当前限制**：开发者 `/v1` 直通只开放 `openai` 协议服务商的模型，Gemini 原生模型暂不对开发者 API 开放。

## 后台操作

位置：后台「模型配置 → 服务商」。左侧是服务商列表，右侧直接编辑（不再使用弹窗）。所有修改都要点右上角「保存配置」才会生效。PPT / PSD 导出设置移到了右上角「PPT / PSD 导出」按钮里。

接入一个新厂商的步骤：

1. 点「添加」，从厂商模板中选择（国外厂商 / 国内厂商 / 中转与自定义）。新服务商默认停用。
2. 填写线路的 API Key（中转站把 Base URL 改成中转地址），确认「接口根地址」预览正确。
3. 「连接检查」：只检查地址、路径和 Key 能否读取模型列表。上游返回的模型都无法使用时，不会显示“全部通过”，而是列出模型名。**对话和出图不在服务商页测试**，见第 6 步。
4. 「模型目录 → 读取模型」：按类型筛选，勾选后「导入选中」。导入的模型默认停用、不对用户开放，生图默认 20 积分、对话 0 积分。也可以点单行的「配置」打开完整编辑器。
5. 在「模型目录」页设置名称、积分和能力后启用、开放，再在「页面分配」中分配到具体页面。
6. 保存配置后，在「模型目录」的模型卡片上点「测试」：对话模型测问答（可选测工具调用），生图模型测文生图（可选再测图生图），直接显示回复和图片。测试使用已保存的服务商地址和 Key，以及模型当前的类型和兼容规则（包括未保存的修改），停用的服务商和模型也能测。
7. 打开服务商「启用」开关，保存配置。

CRUN 服务商的媒体模型需要读取实时 schema，不能批量导入，请使用「同步全部媒体工具」或单行「配置」。

## 管理接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/v1/admin/model-config/connection-tests?routeId=` | 用服务商草稿检查连接（只读取模型目录），返回 `{ok, checks[]}` |
| POST | `/api/v1/admin/model-config/model-tests` | 真实测试一个模型。请求 `{providerId, upstreamModel, kind: chat|image, compat, prompt?, editPrompt?, size?, quality?, edit?, skipTools?, reasoningEffort?, imageParamRules?}（`imageParamRules` 为档案草稿规则，档案窗口测试用；不传时按 `compat.imageParams` 读取已保存的档案）（`reasoningEffort` 作为 `reasoning_effort` 发给上游，对话和工具调用两步都带；空为模型默认）`；服务商取已保存配置的第一条有 Key 的线路。返回 `{ok, provider, route, result: {model, kind, steps[]}}`，`steps[]` 为 `{name, ok, optional?, latencyMs, detail?, image?(base64)}`。工具调用是可选项，不通过不影响 `ok` |
| GET | `/api/v1/admin/model-config/presets` | 返回 `{presets, customized}`，未自定义时为内置模板 |
| PUT | `/api/v1/admin/model-config/presets` | 保存整份模板列表（校验 ID 唯一、协议、路径、鉴权与兼容规则） |
| DELETE | `/api/v1/admin/model-config/presets` | 恢复内置模板 |
| POST | `/api/v1/admin/model-config/discoveries` | 读取上游模型目录；不给出对话/生图类型，类型由管理员在导入时设定 |

草稿中掩码（`****abcd`）或留空的 Key 会用已保存的 Key 补齐。

## 真实模型测试：`model-smoke`

`server model-smoke` 子命令读取已保存的模型配置（使用应用自身的 `DATABASE_URL` 与 `APP_SECRET`，不会打印 Key），通过与线上相同的客户端逐个测试某个服务商的模型：

- 对话模型：一句中文问答，再加一次工具调用探测。工具调用失败只提示可在模型上关闭「支持工具调用」，不算整体失败。
- 生图模型：1024x1024 文生图一次，再用生成的图作参考，以 1536x1024 图生图一次（Imagen 跳过图生图）。图片保存到 `-out` 目录。

```bash
server model-smoke -provider <服务商ID|名称|模板ID> [-catalog] [-models a,b] [-kind chat|image] [-edit=false] [-parallel 3] [-image-response inline|text_url|text_data_uri] [-chat-api official|v1] [-raw-image '<请求体 JSON 数组>'] [-out 目录]
server model-smoke -provider gemini -list
```

- 默认测试该服务商下已配置的模型，按后台设定的类型测试。`-catalog` 改为测试上游目录里的所有模型：已配置的按后台类型测，未配置的需要用 `-kind` 指定按哪种类型测，否则跳过并列出。
- `-list` 只列出目录和分类，不发起生成。
- 服务商停用时也可以测试，使用第一条填写了 Key 的线路。
- 每次运行都会真实调用上游并产生费用，生图模型会被调用两次。

## 代码位置

| 内容 | 位置 |
|---|---|
| 连接字段、兼容规则、校验与合并 | `apps/server/internal/modelconfig/connection.go` |
| 厂商模板 | `apps/server/internal/modelconfig/presets.go`、`presets_default.json` |
| 请求体改写 | `apps/server/internal/upstreamcompat` |
| 统一客户端入口 | `apps/server/internal/providerclient` |
| Gemini 原生客户端 | `apps/server/internal/gemini` |
| 模型目录（含 Gemini） | `apps/server/internal/modelprovider/catalog.go` |
| 连接检查与模板接口 | `apps/server/internal/httpapi/handlers_model_presets.go` |
| 模型测试接口 | `apps/server/internal/httpapi/handlers_model_tests.go`，测试逻辑在 `apps/server/internal/modeltest`（与 `model-smoke` 共用） |
| 后台模型测试弹窗 | `apps/admin/src/views/model-config/ModelTestDialog.vue` |
| 真实测试命令 | `apps/server/cmd/server/model_smoke.go` |
| 后台服务商工作台 | `apps/admin/src/views/model-config/` |
| 后台 e2e | `apps/web-react/tests/e2e/admin-model-providers.spec.js`（需 `ADMIN_BASE_URL`） |

## 阶段进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 1 | 接口路径、鉴权、兼容规则、厂商模板、测试连接、后台服务商页重建 | 完成，单测与 e2e 通过 |
| 2 | Gemini 原生协议（对话 + 生图 + 目录） | 生图已用中转站实测通过（2 个模型，文生图和图生图都通过，2026-10-08）；中转站上的对话地址不可用，待处理；官方 Key 未测 |
| 3 | 百炼 qwen-image 原生生图、MiniMax image-01、豆包与 Grok 参考图格式、智谱参数 | 代码与单测完成（2026-10-08），按官方文档实现，待真实 Key 实测 |
| 4 | 各厂商真实 Key 实测（对话 + 生图） | 未开始 |
