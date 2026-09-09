# StarClouds API · OpenAI Images 兼容

通过同一组 API Key 和统一图片接口，将不同模型接入自己的应用。新应用可使用 OpenAI SDK 的 Images 方法；已有应用可继续使用下方的任务 API。模型权限、积分账户、额度和任务队列共用。

这是 **OpenAI Images 兼容子集**，不代表完整 OpenAI 协议。支持模型目录、生成图片和编辑图片，不提供 Chat Completions、Responses、视频或 OpenAI 自有模型。第三方工具须允许自定义 Base URL、模型 ID，并支持本文列出的 Images 参数。

## 先完成一次测试

1. 在真实“开发者 API”控制台创建测试 Key，设置较小的任务和积分额度。勾选 `models:read`、`tasks:write`、`tasks:read`；编辑图片还需 `files:write`。保存一次性显示的密钥。
2. Base URL 填 `https://<你的域名>/v1`。本地可填后端可访问的地址，如 `http://127.0.0.1:<后端端口>/v1`；前端地址仅在已代理 `/v1` 时可用。
3. 先调用 `GET /v1/models`，从返回的 `data[].id` 选择真实模型 ID。不要直接填写 OpenAI 模型名，也不要使用演示页的 `demo-` 模型或 `demo_` Key。
4. 需要确认价格时，使用下方旧版 `POST /api/open/v1/tasks/quote` 报价。查询模型和报价不创建图片任务。
5. 用下方 SDK 或 cURL 示例生成一张图片。**实际执行生图或编辑请求会按站内价格消耗积分**；控制台的复制和模拟按钮不会发送付费请求。

若遇到服务未开放提示，需要管理员开启已有 Open API 配置。加入兼容接口不会自动开放原本关闭的服务。

### 用 Python OpenAI SDK

安装依赖后，在自己的终端设置环境变量；以下密钥与域名均是占位值。

```bash
python -m pip install openai
export STAR_CLOUD_BASE_URL='https://example.com/v1'
export STAR_CLOUD_API_KEY='替换为真实测试Key'
python examples/open-api/openai_images.py models
```

最后一条命令只列出模型。选择一个真实 ID 后，再明确执行生图：

```bash
python examples/open-api/openai_images.py generate \
  --model '替换为上一步的模型ID' \
  --prompt '一只在窗边晒太阳的橘猫，柔和自然光，摄影风格' \
  --idempotency-key '你保存的本次请求唯一编号' \
  --output './cat.png'
```

同一次请求发生网络错误时，保持模型、提示词和参数不变，并复用同一幂等键；新的一张图使用新编号。示例脚本按真实图片格式自动设置文件后缀，禁止覆盖已有输出文件，打印任务 ID，且关闭 SDK 自动重试，便于首次联调时判断发生了什么。图片编辑用法见 `examples/open-api/README.md`。

核心调用如下，结果中 `b64_json` 是图片数据的 Base64：

```python
import base64
import os
from pathlib import Path
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["STAR_CLOUD_API_KEY"],
    base_url=os.environ["STAR_CLOUD_BASE_URL"],
    timeout=270.0,
    max_retries=0,
)

# 在自己的业务记录中提前保存此 ID；重试时复用，不能每次重新随机生成。
request_id = os.environ["STAR_CLOUD_REQUEST_ID"]
response = client.images.with_raw_response.generate(
    model=os.environ["STAR_CLOUD_MODEL"],
    prompt="一只在窗边晒太阳的橘猫，柔和自然光，摄影风格",
    n=1,
    size="auto",
    quality="auto",
    response_format="b64_json",
    extra_headers={"Idempotency-Key": request_id},
)
print("任务 ID:", response.headers.get("x-task-id"))
result = response.parse()
image = base64.b64decode(result.data[0].b64_json, validate=True)
# 默认输出格式由模型决定，根据真实文件头选择扩展名。
if image.startswith(b"\x89PNG\r\n\x1a\n"):
    extension = ".png"
elif image.startswith(b"\xff\xd8\xff"):
    extension = ".jpg"
elif image[:4] == b"RIFF" and image[8:12] == b"WEBP":
    extension = ".webp"
else:
    raise ValueError("未知图片格式，请使用任务 ID 检查结果")
with Path("result" + extension).open("xb") as image_file:
    image_file.write(image)
```

## OpenAI Images 兼容协议

- Base URL：`https://<你的域名>/v1`，路径中不包含 `/api/open`。
- 认证：`Authorization: Bearer sk-sc-...`，沿用已有真实 API Key。
- JSON 生成请求使用 `Content-Type: application/json`；图片编辑使用 `multipart/form-data`。
- 成功响应使用 OpenAI Images 结构，不再包裹 `success/data` 任务信封。
- 错误统一为 `{"error":{"message":"...","type":"...","param":null,"code":"..."}}`。
- API Key、任务与文件仍按用户隔离；接口不会绕过模型开放状态、Key 白名单、账号风控、限流或余额校验。

| 方法与路径 | 用途 | 所需权限 |
| --- | --- | --- |
| `GET /v1/models` | 列出当前 Key 可用的图片模型 | `models:read` |
| `GET /v1/models/{id}` | 读取单个可用图片模型 | `models:read` |
| `POST /v1/images/generations` | 文生图，等待结果后返回图片 | `tasks:write` |
| `POST /v1/images/edits` | 上传参考图并编辑，等待结果后返回图片 | `tasks:write`、`files:write` |

### 模型目录

```bash
curl -sS "$STAR_CLOUD_BASE_URL/models" \
  -H "Authorization: Bearer $STAR_CLOUD_API_KEY"
```

返回 `{"object":"list","data":[...模型对象...]}`；每个模型包含 `id`、`object: "model"`、`created: 0` 和 `owned_by: "starcloudsai"`。`created: 0` 表示当前未提供模型创建时间；`id` 是后续请求的 `model`。列表受到模型开放状态和 Key 白名单限制，并不保证每个模型都支持相同的尺寸、质量或参考图数量。具体能力、参考图限制和业务价格通过旧版 `GET /api/open/v1/models` 读取。

### 生成图片

```bash
# 此 ID 应保存到自己的业务记录；重试同一请求时复用。
export STAR_CLOUD_REQUEST_ID='替换为本次请求唯一编号'
export STAR_CLOUD_MODEL='替换为真实模型ID'

curl -sS --max-time 270 -D './generation-headers.txt' \
  "$STAR_CLOUD_BASE_URL/images/generations" \
  -H "Authorization: Bearer $STAR_CLOUD_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $STAR_CLOUD_REQUEST_ID" \
  -d "{
    \"model\": \"$STAR_CLOUD_MODEL\",
    \"prompt\": \"一只在窗边晒太阳的橘猫，柔和自然光，摄影风格\",
    \"n\": 1,
    \"size\": \"auto\",
    \"quality\": \"auto\",
    \"response_format\": \"b64_json\"
  }" \
  -o './generation-response.json'
```

`generation-response.json` 是 JSON，不是图片文件；按 Python 示例将 `data[0].b64_json` 解码保存。响应头文件中可以读取 `X-Task-ID`。自行拼接 JSON 时注意转义特殊字符；包含任意用户输入的程序应使用 JSON 序列化库或 SDK。

| 字段 | 说明 |
| --- | --- |
| `model` | 必填，使用当前 Key 可调用的真实公开模型 ID |
| `prompt` | 必填，非空提示词 |
| `n` | 默认 1，必须为 1–10 的整数，且不能超过模型的单次张数上限 |
| `size` | 默认 `auto`。指定 `宽x高` 像素要求模型 `supportsExactSize: true`，同时满足该模型的精确尺寸限制；不支持的尺寸返回错误，不会通过事后缩放伪装成该尺寸 |
| `quality` | 默认 `auto`；支持 `low`、`medium`、`high`，并将 `standard` 映射到 `medium`、`hd` 映射到 `high`。最终仍须是目标模型支持的质量 |
| `response_format` | `b64_json`（默认）或 `url` |
| `output_format` | `png`、`jpeg` 或 `webp`，须受目标模型支持；省略时采用模型内置格式 |
| `background` | `auto`（默认）、`opaque` 或 `transparent`；透明背景须受模型支持，且不能搭配 JPEG |
| `moderation` | 可选 `auto` 或 `low`，须受目标模型支持 |
| `user` | 可选客户端用户标识，最多256字符，不参与账号认证或权限判定 |
| `stream` | 只接受省略或 `false`；本版返回完整结果 |

首次接入建议只传 `model`、`prompt`、`n: 1`，或使用示例中的 `auto` 参数。模型切换时重新核对能力；本接口不承诺所有上游都支持 OpenAI 图片模型的全部选项。

成功返回 HTTP 200：

```json
{
  "created": 1788912000,
  "data": [
    {"b64_json": "这里是完整图片的Base64"}
  ]
}
```

`created` 为 Unix 秒时间戳。选用 `response_format: "url"` 时，数组项改为 `{"url":"https://...短期签名地址..."}`，该地址可直接下载，无需再附加 Bearer Header。签名地址有有效期，应及时下载；不要把它当成永久素材地址，也不要公开分享带签名的 URL。

Base64返回限制为单张原图不超过32 MiB、同一响应的原始图片内容总计不超过64 MiB。图片过大时使用同一幂等键改为 `response_format: "url"` 获取地址，不必重复生成。

### 编辑图片

使用同一个 Images 协议，但将本地图片与参数以 multipart 上传。单张图使用 `image`；多张图重复使用 `image[]` 字段。不要手写 multipart 的 Content-Type 边界，交给 cURL 或 SDK 生成。

```bash
curl -sS --max-time 270 -D './edit-headers.txt' \
  "$STAR_CLOUD_BASE_URL/images/edits" \
  -H "Authorization: Bearer $STAR_CLOUD_API_KEY" \
  -H "Idempotency-Key: $STAR_CLOUD_REQUEST_ID" \
  -F "model=$STAR_CLOUD_MODEL" \
  -F 'prompt=保留主体，将背景改为简洁的浅蓝色摄影棚' \
  -F 'n=1' \
  -F 'size=auto' \
  -F 'quality=auto' \
  -F 'response_format=b64_json' \
  -F 'image=@./reference.png' \
  -o './edit-response.json'
```

编辑操作是新请求，应使用与前面生图请求不同的 `STAR_CLOUD_REQUEST_ID`；只有编辑本身的重试才复用。最多上传 6 张参考图，图片文件合计不超过 32 MiB，含 multipart 元数据的请求体不超过 33 MiB；单张图同时受平台上传限制，张数同时受模型 `maxReferenceImages` 限制。使用 JPEG、PNG 或 WebP 图片；空文件、伪装文件和不支持的格式会被拒绝。多图示例：`-F 'image[]=@./front.png' -F 'image[]=@./side.png'`。

编辑接口直接接收图片文件；不要将旧版 `uploads/...key`、本地路径字符串或远程 URL 当成二进制 `image` 字段。

### 等待、重试与结果恢复

兼容接口会创建现有图片任务，并最多等待 240 秒：

- 成功后返回 `200` 与图片；`X-Task-ID` 响应头关联站内任务。
- 返回 `504` 表示本次 HTTP 处理或网关等待超时，不等于生成失败；已创建的任务会继续处理，不会因为等待超时而自动取消或再次扣费。
- 保存 `X-Task-ID`，通过 `GET /api/open/v1/tasks/{id}` 查询终态（需 `tasks:read`），或通过已有 Webhook 接收结果。
- 没收到任务 ID 时，复用原来的 `Idempotency-Key` 和完全相同内容重试原请求，可重新等待已有任务。不要更换幂等键重复提交同一业务需求。
- 兼容接口对同一幂等键但生成参数或参考图字节不同的请求返回 `409`。`response_format` 仅决定交付形式，可在 `b64_json` 与 `url` 间切换以取回已有结果。幂等键按 API Key 隔离，生成与编辑共用同一兼容命名空间，与旧版任务 API 隔离；重试时须使用原 API Key，更换或轮换 API Key 后不能用它恢复原幂等请求。
- 部分模型可能只交付部分图片，此时 `data.length` 可小于请求的 `n`；不要假定长度固定。沿用站内任务结算规则，按实际交付结果结算。
- 任务失败、已取消或其他业务错误通过错误信封返回。根据 `error.message` 和 `error.code` 判断是否可恢复，不能把所有错误都直接重新扣费提交。

客户端与反向代理应允许至少 270 秒的请求读取时间。更短的客户端超时或代理 504 不代表服务端未创建任务；仍须保留原幂等键并按上述方式恢复。

未提供 `Idempotency-Key` 时，服务端会生成并在响应头返回一个编号，同时设置 `X-Should-Retry: false`，提示支持此头的 SDK 不自动重试；若网络在收到响应前断开，客户端仍可能不知道编号。因此实际接入应主动保存并传入幂等键，或关闭 SDK 自动重试。网关自产错误也会提示不自动重试，客户端可带原幂等键明确恢复。

### 兼容边界与错误

首版不支持 `mask`、`stream: true`、`partial_images`、`style`、`input_fidelity`、`output_compression`；传入不支持的参数会明确返回 400，不会静默忽略。只使用 Chat Completions/Responses 的聊天客户端无法调用本图片接口。

常见状态：`400` 参数/能力不支持，`401` 密钥无效，`403` 缺少权限或模型未授权，`409` 幂等内容冲突或余额不足，`429` 限流/额度已用满，`5xx` 服务或上游失败，`504` 等待超时。不要在日志中记录完整 Authorization Header 或图片 Base64。

## 旧版任务 API

以下 `/api/open/v1` 接口保持原有异步协议，用于报价、用量、任务查询以及已接入应用。它与兼容接口共用账户、Key、任务和账务，但响应格式不同，不应将两个 Base URL 混用。

### 基本约定

- Base URL：`https://<你的域名>/api/open/v1`
- 认证：`Authorization: Bearer sk-sc-...`
- 请求和响应：UTF-8 JSON；上传接口除外。
- 金额字段以 `Cents` 结尾，但在本项目中 `1 cent = 1 积分`。
- 时间使用 RFC 3339。
- 成功响应：`{"success":true,"data":...}`。
- 失败响应：`{"success":false,"code":"...","error":"..."}`。
- API Key、任务和文件始终按所属用户隔离，不能读取其他账号的数据。

API Key 可分别授权以下 scope：

| Scope | 能力 |
| --- | --- |
| `models:read` | 读取当前 Key 可调用的模型 |
| `files:write` | 上传任务输入文件 |
| `tasks:write` | 报价、创建任务 |
| `tasks:read` | 查询任务和读取任务文件 |

### 读取模型

旧版任务 API 公开端点共7个：`GET /models`、`GET /usage`、`POST /uploads`、`GET /files/*key`、`POST /tasks/quote`、`POST /tasks`、`GET /tasks/:id`。未提供开放的任务列表、取消、对话、PSD或MCP端点；这些旧版端点使用 StarClouds 任务协议；OpenAI Images 兼容接口见上文。

```bash
curl -sS 'https://example.com/api/open/v1/models' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME'
```

响应中的 `id` 是创建任务时使用的公开模型 ID。若 Key 配置了模型白名单，只返回白名单内仍处于开放状态的模型。

生图模型还会返回 `supportsExactSize` 与 `exactSizeLimits`。支持精确尺寸时，可在 `/tasks/quote` 和 `/tasks` 的 `params` 中传 `sizeMode: "exact"`、`exactWidth`、`exactHeight`。例如 `1200` × `800` 会按原始像素提交；服务端会校验该模型的宽高、步长、总像素和长短边比限制。字段说明见 [精确图片尺寸](EXACT_IMAGE_SIZE.md)。

### 上传参考图

```bash
curl -sS -X POST 'https://example.com/api/open/v1/uploads' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME' \
  -F 'file=@./reference.png'
```

响应示例：

```json
{
  "success": true,
  "data": {
    "key": "uploads/<user>/original/<id>.png",
    "url": "/api/open/v1/files/uploads/<user>/original/<id>.png",
    "thumbnailKey": "uploads/<user>/thumb/<id>.jpg",
    "thumbnailUrl": "/api/open/v1/files/uploads/<user>/thumb/<id>.jpg"
  }
}
```

创建任务时传 `key`，不要把 `url` 当作 `inputKeys`。文件 URL 同样需要带 Bearer Header 才能读取。

### 创建任务

#### 先获取报价

```bash
curl -sS 'https://example.com/api/open/v1/tasks/quote' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME' \
  -H 'Content-Type: application/json' \
  -d '{"type":"t2i","count":1,"params":{"modelId":"PUBLIC_MODEL_ID","aspectRatio":"1:1","resolution":"1K"}}'
```

返回 `unitPriceCents`、`totalPriceCents`、`count`、`modelId`、`configVersion`。报价不冻结积分，不代表已预订队列容量；创建时通过 `expectedUnitPriceCents` 传回单价，价格变化会拒绝创建，需要重新报价。模型仍受当前Key白名单限制。

#### 查询用量

`GET /usage` 需要 `tasks:read`，返回本Key的 `usage`、`limits`、`dailyResetAt`、`monthlyResetAt`。任务数与积分预算的日/月窗口按UTC计算；Key创建要求配置正数额度，不支持用0表示不限。账号钱包、风控和全局容量限制仍然生效。

`todaySpendCents`、`monthSpendCents` 是累计提交时预留的积分预算，不是成功任务的净消费；失败退款不会减少此计数。流量统计当前为近似控制，chunked请求和已经发出的响应不能作为严格预付费流量闸门。轮换Key会生成新ID及新用量窗口，账号钱包与账号风控仍然生效；已冻结Key不能自行轮换解冻。

请求支持 `Idempotency-Key` Header，也支持 JSON 中的 `idempotencyKey`。网络重试必须复用同一个值，避免创建重复任务和重复冻结积分。

首次创建返回201，命中已有任务返回200；JSON字段优先于Header。幂等键当前按用户隔离，不按Key隔离。同key必须使用完全相同参数，现实现不会对冲突payload返回409，而是返回原任务。客户端应将key与自己的业务单号及请求参数一起持久化。

核心字段：`type` 为业务任务类型（最简单为 `t2i`）；`prompt` 必填；`count` 必须在模型公布的上限内；`inputKeys` 为本人上传的key数组；`params.modelId` 取模型列表ID；画幅、质量、分辨率必须取该模型返回的合法选项。不要提交 `_apiKeyId`、`_source` 等内部字段。

```bash
curl -sS -X POST 'https://example.com/api/open/v1/tasks' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME' \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: order-20260829-0001' \
  -d '{
    "type": "t2i",
    "prompt": "product photography, clean white background",
    "count": 2,
    "inputKeys": ["uploads/<user>/original/<id>.png"],
    "params": {
      "modelId": "PUBLIC_MODEL_ID",
      "aspectRatio": "1:1",
      "resolution": "1K"
    }
  }'
```

任务创建仍经过站内同一套模型开放状态、参考图权限、用户并发、全局容量、API Key 日/月任务额度、API Key 日/月积分额度、钱包冻结与任务队列校验。Open API 不会绕过业务限制。

常见错误：

| Code | HTTP | 含义 |
| --- | --- | --- |
| `api_key_required` | 401 | 缺少 Bearer Key |
| `api_key_invalid` | 401 | Key 已撤销、过期或所属账号不可用 |
| `api_key_scope_denied` | 403 | Key 缺少当前接口所需 scope |
| `api_key_model_denied` | 403 | 模型不在 Key 白名单 |
| `api_key_daily_limit` | 429 | 当日任务数或积分额度已满 |
| `api_key_monthly_limit` | 429 | 当月任务数或积分额度已满 |
| `model_zero_price_blocked` | 503 | 模型价格未配置，系统阻止零积分调用 |
| `model_price_inverted` | 503 | 用户价格低于上游成本且未明确允许补贴 |
| `insufficient_balance` | 409 | 用户可用积分不足 |
| `validation_error` | 422 | 请求字段、模型或输入文件不合法 |

### 查询任务和文件

```bash
curl -sS 'https://example.com/api/open/v1/tasks/TASK_UUID' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME'
```

终态为 `succeeded|failed|canceled`。失败时使用 `errorCode` 和 `errorMessage` 向最终用户展示真实原因，不要在 `failed` 后继续轮询。

建议间隔2秒轮询，临时网络错误和429/5xx退避，不自动重试不可恢复的4xx。客户端等待超时不代表服务端失败，应保留task_id稍后查询；不能用新幂等键重复提交同一需求。同用户不同Key可以读取该用户的任务，Key不是独立租户；跨用户禁止访问。

成功任务返回 `outputUrls`、`originalUrls` 和 `thumbnailUrls`。读取文件时继续携带同一 Bearer Key：

```bash
curl -L 'https://example.com/api/open/v1/files/tasks/<user>/<task>/original/0.png' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME' \
  -o result.png
```

### Webhook

支持事件：

- `task.succeeded`
- `task.failed`
- `task.canceled`

Webhook 只为通过 Open API 创建的任务投递。请求 Header：

```text
X-StarCloud-Event: task.succeeded
X-StarCloud-Delivery: <delivery uuid>
X-StarCloud-Timestamp: <unix seconds>
X-StarCloud-Signature: v1=<hex hmac sha256>
```

签名原文是：

```text
<X-StarCloud-Timestamp>.<原始 HTTP 请求体字节>
```

Node.js 校验示例：

```js
import crypto from "node:crypto";

export function verifyStarCloudWebhook({ rawBody, timestamp, signature, secret }) {
  if (!Buffer.isBuffer(rawBody) || typeof secret !== 'string' || !secret) return false;
  if (typeof timestamp !== 'string' || !/^\d{10,12}$/.test(timestamp)) return false;
  if (typeof signature !== 'string' || !/^v1=[0-9a-f]{64}$/.test(signature)) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(signature.slice(3), 'hex');
  return supplied.length === expected.length && crypto.timingSafeEqual(expected, supplied);
}
```

必须使用解析 JSON 前的原始请求体校验签名，并拒绝与服务器时间相差过大的 timestamp，建议容差 5 分钟。

事件示例：

```json
{
  "id": "event-uuid",
  "type": "task.failed",
  "createdAt": "2026-08-29T01:00:00Z",
  "data": {
    "taskId": "task-uuid",
	"attempt": 0,
    "status": "failed",
    "type": "t2i",
    "modelId": "PUBLIC_MODEL_ID",
    "count": 2,
    "errorCode": "upstream_failed",
    "errorMessage": "上游返回的实际失败说明"
  }
}
```

接收方返回任意 `2xx` 即视为成功。网络错误、`408`、`425`、`429` 和 `5xx` 最多投递 8 次，7次重试等待依次约为30秒、2分钟、10分钟、30分钟、2小时、6小时、12小时。其他 `4xx` 直接进入失败状态。用户可以在“开发者 API > 投递记录”查看结果并手动重新投递死信。停用Webhook端点后不再领取其新投递，已经发出的请求无法撤回。

接收方应使用 `X-StarCloud-Delivery` 去重；重复投递必须返回成功且不能重复执行业务副作用。

验签只能阻止伪造与过期重放，5分钟内重复请求仍需业务去重。将delivery_id唯一记录和业务变更放入同一数据库事务；处理持久化成功后才返回2xx。Webhook是至少一次投递，不保证恰好一次或顺序。

`examples/open-api/client.mjs` 导出 `StarCloudClient`，是供导入的模块，不是 CLI。运行 `node examples/open-api/client.mjs` 不会请求接口。完整导入用法见 `examples/open-api/README.md`；Webhook 验签模块为 `examples/open-api/webhook.mjs`，验证命令为 `node --test examples/open-api/webhook.test.mjs`。这两个模块只使用 Node 标准库，导入时不自动发起付费任务。

### 安全建议

- 不要把 API Key 或 Webhook Secret 放进前端代码、截图、日志和工单。
- 为生产、测试环境分别创建 Key，并使用模型白名单与最小 scope。
- 根据业务量设置日/月任务和积分额度。
- 泄露后立即撤销 Key；Webhook Secret 泄露后立即轮换。
- 下载后的图片应存入自己的受控存储，不要长期依赖短生命周期的站内访问地址。
