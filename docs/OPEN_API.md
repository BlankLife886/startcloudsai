# StarClouds Open API

Open API 用于从外部系统上传参考图、创建图片任务、查询结果并接收任务终态回调。用户在网站的“开发者 API”页面创建 API Key 和 Webhook。API Key 与 Webhook Secret 只在创建或轮换时显示一次。

## 基本约定

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
| `tasks:write` | 创建任务 |
| `tasks:read` | 查询任务和读取任务文件 |

## 读取模型

```bash
curl -sS 'https://example.com/api/open/v1/models' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME'
```

响应中的 `id` 是创建任务时使用的公开模型 ID。若 Key 配置了模型白名单，只返回白名单内仍处于开放状态的模型。

## 上传参考图

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

## 创建任务

请求支持 `Idempotency-Key` Header，也支持 JSON 中的 `idempotencyKey`。网络重试必须复用同一个值，避免创建重复任务和重复冻结积分。

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

## 查询任务和文件

```bash
curl -sS 'https://example.com/api/open/v1/tasks/TASK_UUID' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME'
```

终态为 `succeeded|failed|canceled`。失败时使用 `errorCode` 和 `errorMessage` 向最终用户展示真实原因，不要在 `failed` 后继续轮询。

成功任务返回 `outputUrls`、`originalUrls` 和 `thumbnailUrls`。读取文件时继续携带同一 Bearer Key：

```bash
curl -L 'https://example.com/api/open/v1/files/tasks/<user>/<task>/original/0.png' \
  -H 'Authorization: Bearer sk-sc-REPLACE_ME' \
  -o result.png
```

## Webhook

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
  const expected = "v1=" + crypto
    .createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
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

接收方返回任意 `2xx` 即视为成功。网络错误、`408`、`425`、`429` 和 `5xx` 最多投递 8 次，退避约为 30 秒、2 分钟、10 分钟、30 分钟、2 小时、6 小时、12 小时、24 小时。其他 `4xx` 直接进入失败状态。用户可以在“开发者 API > 投递记录”查看结果并手动重新投递死信。

接收方应使用 `X-StarCloud-Delivery` 去重；重复投递必须返回成功且不能重复执行业务副作用。

## 安全建议

- 不要把 API Key 或 Webhook Secret 放进前端代码、截图、日志和工单。
- 为生产、测试环境分别创建 Key，并使用模型白名单与最小 scope。
- 根据业务量设置日/月任务和积分额度。
- 泄露后立即撤销 Key；Webhook Secret 泄露后立即轮换。
- 下载后的图片应存入自己的受控存储，不要长期依赖短生命周期的站内访问地址。
