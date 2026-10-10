# StarClouds API

StarClouds API 兼容 OpenAI 接口格式。把 OpenAI SDK 的 `base_url` 换成 `https://starcloudisai.com/v1`，`api_key` 换成你的 StarClouds API Key，就能用现有代码调用图片和对话模型。

所有接口都是同步返回：一次 HTTP 请求直接拿到结果，不需要轮询，也不需要回调。

| 接口 | 用途 |
| --- | --- |
| `GET /v1/models` | 列出可调用的模型 |
| `GET /v1/models/{model}` | 查询单个模型 |
| `POST /v1/images/generations` | 文生图 |
| `POST /v1/images/edits` | 上传参考图编辑 |
| `POST /v1/chat/completions` | 对话，支持流式 |

## 快速开始

1. 登录后打开「API 调用」控制台，创建一把 API Key。密钥只显示一次，请立即保存；建议先设置较小的额度。
2. 在控制台「模型」页或通过 `GET /v1/models` 找到要用的模型名。
3. 运行下面的示例生成第一张图。调用会按模型价格扣除积分。

```bash
pip install openai
```

```python
import base64
import urllib.request
from openai import OpenAI

client = OpenAI(
    base_url="https://starcloudisai.com/v1",
    api_key="你的 API Key",
    timeout=270.0,
    max_retries=0,
)

result = client.images.generate(
    model="gpt-image-2",  # 换成控制台里的模型名
    prompt="一只在窗边晒太阳的橘猫，柔和自然光，摄影风格",
    size="auto",
)

image = result.data[0]
# 部分模型返回图片链接（url），两种都要处理
data = base64.b64decode(image.b64_json) if image.b64_json else urllib.request.urlopen(image.url).read()
with open("cat.png", "wb") as file:
    file.write(data)
```

## 认证与通用约定

- **认证**：请求头带 `Authorization: Bearer <你的 API Key>`。
- **请求格式**：JSON 接口用 `Content-Type: application/json`；图片编辑用 `multipart/form-data`。
- **模型名**：`model` 填控制台「模型」页或 `GET /v1/models` 返回的 `id`，区分大小写。
- **超时**：单次请求最长约 240 秒，客户端读取超时请设为 270 秒以上。
- **重试**：平台不会自动重试，建议关闭 SDK 的自动重试（`max_retries=0`），需要时自己重新发起请求。
- **额度**：每把 Key 可设置每分钟请求数、每日/每月请求数和积分预算、每日流量、可用模型、IP 白名单和到期时间，超出时返回 `429`。
- **浏览器调用**：支持在网页里直接调用。但写在网页前端的 Key 所有访问者都能看到，正式产品请从你自己的服务端发起请求。

## 模型

```bash
curl https://starcloudisai.com/v1/models \
  -H "Authorization: Bearer $API_KEY"
```

返回当前 Key 可调用的模型：

```json
{"object":"list","data":[{"id":"gpt-image-2","object":"model","created":0,"owned_by":"starcloudsai","status":"live"}]}
```

| `status` | 含义 |
| --- | --- |
| `live` | 正常可用 |
| `maintenance` | 维护中，调用返回 `503`，稍后重试即可，不扣费 |
| `deprecated` | 即将下线，仍可调用；会带 `sunset_at`（下线时间）和 `replacement`（建议替代的模型） |

模型下线前至少提前 7 天通过站内消息通知；已下线的模型调用返回 `410`。

每个模型能用的 `size`、`quality`、单次张数和参考图数量各不相同，请在控制台「模型」页查看，价格也在那里。

## 生成图片

`POST /v1/images/generations`

```bash
curl https://starcloudisai.com/v1/images/generations \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只在窗边晒太阳的橘猫，柔和自然光，摄影风格",
    "n": 1,
    "size": "auto",
    "quality": "auto"
  }'
```

### 请求参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `model` | 是 | 模型名 |
| `prompt` | 是 | 提示词 |
| `n` | 否 | 生成张数，默认 1，不超过模型的单次上限 |
| `size` | 否 | 默认 `auto`，按模型默认尺寸出图。填 `宽x高`（如 `1024x1536`）只适用于控制台「模型」页 size 列标出了范围的模型，其他模型会返回 400 |
| `quality` | 否 | 默认 `auto`；可选值见控制台「模型」页 quality 列，如 `low`、`medium`、`high` |
| `response_format` | 否 | `b64_json`（默认）或 `url` |
| `output_format` | 否 | `png`、`jpeg`、`webp`，模型支持时生效 |
| `background` | 否 | `auto`（默认）、`opaque`、`transparent`；透明背景需模型支持，且不能用 `jpeg` |
| `user` | 否 | 你自己的终端用户标识，最多 256 个字符 |

不支持 `mask`、`stream`、`partial_images`、`style`、`input_fidelity`、`output_compression`，传了会返回 400。

### 返回结果

```json
{"created":1788912000,"data":[{"b64_json":"iVBORw0KGgo..."}]}
```

部分模型返回图片链接：

```json
{"created":1788912000,"data":[{"url":"https://..."}]}
```

> **两种格式都要处理**：`data` 里的每一项有 `b64_json` 就是图片的 Base64 数据，否则是 `url` 图片链接。链接有有效期，请及时下载保存。两种都算成功，正常扣费。

## 编辑图片

`POST /v1/images/edits`，用 `multipart/form-data` 上传参考图：

```bash
curl https://starcloudisai.com/v1/images/edits \
  -H "Authorization: Bearer $API_KEY" \
  -F model=gpt-image-2 \
  -F prompt=保留主体，将背景改为简洁的浅蓝色摄影棚 \
  -F image=@./reference.png
```

- 一张图用 `image`，多张图重复 `image[]`；支持 JPEG、PNG、WebP。
- 张数上限见控制台「模型」页的参考图上限，整个请求不超过 512 MiB。
- 其余参数和返回结果与生成图片相同。

## 对话

`POST /v1/chat/completions`，参数和返回与 OpenAI Chat Completions 一致，支持 `stream`、`tools`、`response_format` 和图片输入（以模型能力为准）。

```python
chat = client.chat.completions.create(
    model="对话模型名",
    messages=[
        {"role": "system", "content": "用简体中文回答。"},
        {"role": "user", "content": "用一句话介绍你自己"},
    ],
)
print(chat.choices[0].message.content)

stream = client.chat.completions.create(
    model="对话模型名",
    messages=[{"role": "user", "content": "你好"}],
    stream=True,
)
for chunk in stream:
    if chunk.choices:
        print(chunk.choices[0].delta.content or "", end="")
```

- 流式输出以 `data: [DONE]` 结束；中途收到 `data: {"error": {...}}` 表示本次失败，不扣费。
- 单次请求体不超过 48 MiB（含 Base64 图片），单次最长 300 秒。
- 生成图片请用图片接口，对话接口不出图。

## 计费

- **成功才扣费**：拿到图片或回答后按模型价格扣一次。价格以发起请求时为准。
- **失败不扣费**：出错、超时、模型不可用都会退回预扣的积分，也不占用 Key 的额度。
- **内容违规**：提示词或图片不符合内容安全规范被拒绝时，超出每日免扣次数后照常扣费。
- **中途断开**：生图和非流式对话发出后，即使你断开连接，结果产生了也会扣费；流式对话在收到内容前断开不扣费。
- **对账**：控制台「调用记录」列出每次请求的模型、用量、扣费和退回原因。API 扣费不显示在钱包明细里。
- **调价**：涨价至少提前 7 天在控制台「模型」页公告并发站内消息；降价立即生效。

## 错误码

出错时返回：

```json
{"error":{"message":"中文错误说明","type":"invalid_request_error","param":"size","code":"invalid_parameter"}}
```

`message` 会说明原因和是否扣费；`param` 指出有问题的参数。5xx 错误带请求 ID，联系我们时提供它即可。

| HTTP | `code` | 含义与处理 |
| --- | --- | --- |
| 400 | `invalid_parameter` / `unsupported_parameter` | 参数不合法，或这个模型不支持该取值；按 `message` 修改 |
| 400 | `upstream_rejected` | 请求未被模型接受，请检查提示词、参考图和参数，不扣费 |
| 400 | `content_policy_violation` | 内容不符合安全规范，`message` 会说明是否扣费 |
| 401 | `invalid_api_key` | Key 缺失、格式错误或已撤销 |
| 401 | `api_key_expired` | Key 已过期 |
| 403 | `api_key_frozen` | Key 已被冻结，`message` 含原因 |
| 403 | `api_key_paused` | Key 已在控制台停用，重新启用即可 |
| 403 | `api_key_ip_denied` | 来源 IP 不在 Key 的白名单里 |
| 404 | `model_not_found` | 模型名不存在，或这把 Key 不能使用该模型 |
| 410 | `model_retired` | 模型已下线，`message` 给出替代模型 |
| 413 | `request_too_large` | 请求体超过 512 MiB |
| 429 | `rate_limited` / `api_key_daily_limit` / `api_key_monthly_limit` | 请求太频繁，或 Key 的额度已用完 |
| 429 | `model_concurrency_limited` / `upstream_rate_limited` | 该模型当前请求较多，稍后再发 |
| 502 | `upstream_error` / `upstream_unreachable` | 模型服务暂时出错，不扣费，稍后重试 |
| 502 | `upstream_misconfigured` | 模型暂时不可用（平台侧问题，与你的 Key 无关），不扣费 |
| 503 | `model_unavailable` | 模型维护中，不扣费；带 `Retry-After`，稍后重试 |
| 504 | `request_timeout` | 处理超时，不扣费，可稍后重试 |

请不要在日志里记录完整的 `Authorization` 请求头或图片 Base64 数据。

## StarClouds Image 插件

在 Codex 等 AI 编程工具里安装 StarClouds Image 插件后，直接用文字描述就能生图或改图。第一次使用会打开星空云绘登录页，确认授权后插件自动获得一把专用 Key（默认 180 天后过期），不需要手动复制密钥。
