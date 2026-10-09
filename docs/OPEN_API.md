# StarClouds API

StarClouds API 与 OpenAI API 兼容：把 OpenAI SDK 的 `base_url` 换成 `https://<你的域名>/v1`，`api_key` 换成你的 StarClouds Key，`model` 填模型名，现有代码就能调用 StarClouds 的图片与对话模型。

所有接口都同步返回结果：请求在一次 HTTP 调用内完成，不需要轮询任务，也不需要配置回调。

| 方法与路径 | 用途 |
| --- | --- |
| `GET /v1/models` | 列出当前 Key 可调用的模型 |
| `GET /v1/models/{model}` | 读取单个模型 |
| `POST /v1/images/generations` | 文生图 |
| `POST /v1/images/edits` | 上传参考图并编辑 |
| `POST /v1/chat/completions` | 对话（可流式），原样转发给上游 |

## 三步接入

1. 登录后打开“API 调用”控制台，创建一把 Key，先设置较小的额度。密钥只显示一次，请立即保存。
2. 调用 `GET /v1/models`，从返回的 `data[].id` 里选模型。控制台“模型”页展示同样的模型名、价格和能力。
3. 用下方示例生成第一张图。**实际执行生图、编辑或对话会按模型价格消耗积分**；控制台只复制示例，不会替你发送请求。

```bash
python -m pip install openai
export STAR_CLOUD_BASE_URL='https://example.com/v1'
export STAR_CLOUD_API_KEY='替换为你的 Key'
```

```python
import base64
import os
import urllib.request
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["STAR_CLOUD_API_KEY"],
    base_url=os.environ["STAR_CLOUD_BASE_URL"],
    timeout=270.0,
    max_retries=0,
)

print([model.id for model in client.models.list()])

result = client.images.generate(
    model="gpt-image-2",  # 替换为 /v1/models 返回的模型名
    prompt="一只在窗边晒太阳的橘猫，柔和自然光，摄影风格",
    size="auto",
)
image = result.data[0]
# 个别模型的上游只返回 url，两种都要处理
data = base64.b64decode(image.b64_json) if image.b64_json else urllib.request.urlopen(image.url).read()
with open("cat.png", "xb") as file:
    file.write(data)
```

更完整的脚本（自动识别图片格式、编辑图片、Node 示例）见 `examples/open-api/`。

## 通用约定

- 认证：`Authorization: Bearer sk-sc-...`。
- 请求：JSON 接口使用 `Content-Type: application/json`；图片编辑使用 `multipart/form-data`。
- 成功响应与 OpenAI 相同；错误统一为 `{"error":{"message":"...","type":"...","param":null,"code":"..."}}`。
- `model` 填模型名，也就是 `/v1/models` 返回的 `id`。模型名在控制台和本文档里始终一致。
- 每把 Key 都有每分钟请求数、日/月请求数、日/月积分预算、每日流量上限，可选限定可用模型、IP 白名单和到期日期。这些都在控制台设置；超出时返回 `429`。
- 支持在浏览器网页里直接调用（已开启跨域，只认 Key，不带 Cookie）。但写在网页前端的 Key 任何访问者都能看到，正式产品请从你自己的服务端转发，或给 Key 设置较小的额度和到期日期。
- 客户端和反向代理的读取超时不低于 270 秒；服务端最多等待上游 240 秒。

## 模型

模型名（`model`）由平台的 API 模型目录维护，发布后保持不变：平台调整站内模型名称、服务商或线路，都不会改变你代码里使用的模型名。

模型的状态变化都会提前或当场告诉你：

| 状态 | 调用结果 | 你需要做什么 |
| --- | --- | --- |
| 维护中 | `503 model_unavailable`，带 `Retry-After: 60`、`X-Should-Retry: true`；在预扣积分前拒绝，不扣费 | 稍后重试 |
| 即将下线 | 照常调用，响应额外带 `Deprecation`（弃用时间，`@Unix 秒`）、`Sunset`（下线时间，HTTP 日期）、`Link: </v1/models/替代模型>; rel="successor-version"` 头 | 在下线前把 `model` 换成替代模型，并更新 Key 的指定模型 |
| 已下线 | `410 model_retired`，消息里给出替代模型 | 改用替代模型 |

弃用至少提前 7 天（平台可调长）通过站内消息通知近 30 天调用过该模型、或 Key 指定了它的用户；紧急下线（上游停服等）会立即生效并同样发站内消息。

价格：每次请求在开始时按当时的价格计费，之后调价不影响已发出的请求。涨价至少提前 7 天在控制台“模型”页显示“X 月 X 日起调整为 N 积分/次”并发站内消息，到期后生效；降价立即生效。API 调用价格不享受订阅锁价。

```bash
curl -sS "$STAR_CLOUD_BASE_URL/models" \
  -H "Authorization: Bearer $STAR_CLOUD_API_KEY"
```

返回 `{"object":"list","data":[{"id":"gpt-image-2","object":"model","created":0,"owned_by":"starcloudsai","status":"live"}, ...]}`。列表包含当前 Key 可用的模型（Key 限定了可用模型时只返回那几个），含维护中和即将下线的，不含已下线的。`status` 为 `live`、`maintenance` 或 `deprecated`；即将下线的模型另有 `sunset_at`（RFC 3339）和 `replacement`（替代模型名，可能为空）。这些是扩展字段，OpenAI SDK 会忽略。`GET /v1/models/{model}` 返回同样的对象，已下线的模型返回 `410 model_retired`。不同模型支持的尺寸、质量和参考图数量不同，可在控制台“模型”页查看。

## 生成图片

```bash
curl -sS --max-time 270 "$STAR_CLOUD_BASE_URL/images/generations" \
  -H "Authorization: Bearer $STAR_CLOUD_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "gpt-image-2",
    "prompt": "一只在窗边晒太阳的橘猫，柔和自然光，摄影风格",
    "n": 1,
    "size": "auto",
    "response_format": "b64_json"
  }'
```

成功返回 `{"created":1788912000,"data":[{"b64_json":"..."}]}`。`response_format: "url"` 时数组项为 `{"url":"https://..."}`，这是有有效期的地址，请及时下载，不要公开分享。

> **以实际返回为准**：个别模型的上游会忽略 `response_format`，只返回 `url` 或只返回 `b64_json`。这时平台把上游的结果原样返回给你，照常计费。请在代码里两种都处理：有 `b64_json` 就解码，否则下载 `url`。

| 字段 | 说明 |
| --- | --- |
| `model` | 必填，模型名 |
| `prompt` | 必填 |
| `n` | 默认 1，1–10，且不超过模型的单次张数上限 |
| `size` | 默认 `auto`，按模型原生尺寸出图。`宽x高`（如 `1024x1536`）只有控制台“模型”页 size 列标出了范围的模型支持，其他模型返回 400，请改用 `auto` |
| `quality` | 默认 `auto`；`low`、`medium`、`high`、`xhigh`、`max`，每个模型可用的取值见控制台“模型”页 quality 列，`standard`/`hd` 分别视为 `medium`/`high`。开发者 API 按 API 模型目录价计费，不使用站内的分辨率 × 质量分档价 |
| `response_format` | `b64_json`（默认）或 `url`。上游不支持你选的格式时，返回上游实际给出的格式 |
| `output_format` | `png`、`jpeg`、`webp`。模型支持指定格式时生效；模型只输出原生格式时忽略此字段 |
| `background` | `auto`（默认）、`opaque`、`transparent`；透明背景需模型支持，且不能搭配 JPEG |
| `moderation` | 可选 `auto` 或 `low`，需模型支持 |
| `user` | 可选，你自己的终端用户标识，最多 256 字符 |

暂不支持 `mask`、`stream`、`partial_images`、`style`、`input_fidelity`、`output_compression`；传入会返回 400，不会静默忽略。

## 编辑图片

```bash
curl -sS --max-time 270 "$STAR_CLOUD_BASE_URL/images/edits" \
  -H "Authorization: Bearer $STAR_CLOUD_API_KEY" \
  -F 'model=gpt-image-2' \
  -F 'prompt=保留主体，将背景改为简洁的浅蓝色摄影棚' \
  -F 'image=@./reference.png'
```

单张图用 `image`，多张图重复 `image[]`，支持 JPEG、PNG、WebP。张数以模型的参考图上限为准（控制台“模型”页可查）；单张大小不做额外限制，以上游能接受的为准，整个请求体不超过 512 MiB。参考图边收边转发给上游，服务端不保存。其余字段与生成图片相同。

## 对话

`POST /v1/chat/completions` 与 OpenAI Chat Completions 相同。请求**原样转发**给上游，只把 `model` 换成上游的模型名，返回时再换回你填的模型名；上游支持的能力（`stream`、`tools` 函数调用、`response_format`、消息里的图片输入等）都能直接使用。

```python
chat = client.chat.completions.create(
    model="gpt-5.6-luna",  # 替换为 /v1/models 返回的对话模型名
    messages=[
        {"role": "system", "content": "用简体中文回答。"},
        {"role": "user", "content": "用一句话介绍你自己"},
    ],
)
print(chat.choices[0].message.content)

for chunk in client.chat.completions.create(model="gpt-5.6-luna", messages=[{"role": "user", "content": "你好"}], stream=True):
    print(chunk.choices[0].delta.content or "", end="")
```

- 按次计费：每次拿到回答扣一次该模型的价格。上游报错、超时或流在中途被上游切断都不扣费。
- 流式请求：已经收到回答内容后你主动断开，照常扣费；还没收到任何内容就断开，不扣费。
- 非流式请求：发出后你断开连接，平台仍会等上游完成，上游成功就扣费。
- 流式输出以 `data: [DONE]` 结束；如果中途收到 `data: {"error": {...}}`，表示这次失败，不扣费。
- 单次请求体（含 Base64 图片）不超过 48 MiB，单次对话最长 300 秒。
- 出图请用 `/v1/images/generations`；对话接口本身不生成图片。

## 计费与失败

- **成功才扣费**。拿到图片或回答才按模型价格结算，每个请求只扣一次；图片以 `url` 还是 `b64_json` 返回都算成功。
- **失败全额退回**。上游拒绝（含内容风控）、出错、超时或平台故障都算失败：退回预留积分，也不计入 Key 的日/月额度。上游故障或超时不会导致 Key 被冻结。
- **客户端断开不等于失败**。生图和非流式对话发出后，即使你断开连接，平台也会等上游完成：上游成功就扣费（结果无法再取回），失败才退回。流式对话在收到回答内容后断开照常扣费，收到内容前断开不扣费。
- **不自动重试**。网关不会替你重试，也不支持用同一个请求编号找回结果。需要重试时直接发一个新请求。所有付费接口都返回 `X-Should-Retry: false`，并建议把 SDK 的自动重试关掉（`max_retries=0`），避免一次失败被 SDK 悄悄重发。
- **模型并发上限**。平台可能给个别模型设置同时进行的请求数上限，超出时立即返回 `429 model_concurrency_limited`，不会排队，稍后再发即可。
- **在哪里对账**。控制台“调用记录”列出每次请求的模型、Key、用量（图片张数或 token）、扣费积分和退回原因。API 调用的扣费不进入钱包的积分明细，钱包余额照常变化。

## 错误码

报错统一为 `{"error":{"message":"...","type":"...","param":"...","code":"..."}}`。`message` 用中文写明具体原因：参数错误会指出哪个字段、允许哪些值；上游拒绝时附上上游给出的原因（其中的链接和密钥已隐藏）；5xx 错误附带请求 ID，反馈问题时提供它即可。所有失败都不扣费。

| HTTP | `code` | 含义 |
| --- | --- | --- |
| 400 | `invalid_parameter` / `unsupported_parameter` | 参数不合法、模型不支持该取值，或传了不支持的字段；`param` 指出字段 |
| 400 | `upstream_rejected` | 上游拒绝了这次请求（例如内容安全拦截），消息里附上游原因 |
| 401 | `invalid_api_key` | Key 缺失、格式不对或已撤销 |
| 401 | `api_key_expired` | Key 已过期，请创建或轮换 |
| 403 | `api_key_frozen` | Key 被风控冻结，消息中含原因 |
| 403 | `api_key_paused` | Key 已被你在控制台停用，重新启用后立即恢复，密钥不变 |
| 403 | `api_key_ip_denied` | 来源 IP 不在 Key 的白名单中 |
| 404 | `model_not_found` | 模型名不存在，或未开放给这把 Key；消息里带上你填的名字 |
| 410 | `model_retired` | 模型已下线，消息里给出替代模型 |
| 503 | `model_unavailable` | 模型暂时不可用（维护或上游线路停用），不扣费；带 `Retry-After` 与 `X-Should-Retry: true`，可稍后重试 |
| 413 | `request_too_large` | 请求体超过 512 MiB |
| 429 | `model_concurrency_limited` | 该模型同时进行的请求已达上限，稍后再发 |
| 429 | `upstream_rate_limited` | 上游当前限流，稍后再发 |
| 429 | `rate_limited` / `api_key_daily_limit` / `api_key_monthly_limit` | 请求过于频繁，或 Key 的请求数、积分预算已用完 |
| 502 | `upstream_error` | 上游服务出错，消息里附 HTTP 状态和上游原因 |
| 502 | `upstream_unreachable` | 连接上游失败或中途断开 |
| 502 | `upstream_misconfigured` | 平台的上游配置异常，与你的 Key 无关，请联系平台 |
| 504 | `request_timeout` | 等待上游超过 240 秒仍未返回 |

日志里不要记录完整的 `Authorization` 头或图片 Base64。

## StarClouds Image Skill

在 Codex 等工具里安装 StarClouds Image 插件后，直接描述生图或编辑需求即可。首次调用会打开星空云绘登录页，确认后插件通过 OAuth（Authorization Code + PKCE）自动获得一把专用 Key，默认 180 天后过期，不需要手动复制密钥。

| 端点 | 用途 |
| --- | --- |
| `GET /.well-known/oauth-authorization-server` | OAuth 元数据 |
| `POST /oauth/register` | 动态注册本地客户端 |
| `GET /oauth/authorize` | 登录与授权确认 |
| `POST /oauth/token` | 用授权码换取 Key |

本地开发时先把插件指向开发服务器：

```bash
python3 scripts/starclouds_image.py config --base-url http://127.0.0.1:8000/v1
python3 scripts/starclouds_image.py login
python3 scripts/starclouds_image.py generate --prompt '蓝天白云'
```
