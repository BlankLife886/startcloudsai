# StarClouds API 调用示例

文档基线：2026-09-22 当前工作区。Images 使用不存站内图片的直通接口，Node 任务客户端使用持久队列接口；二者不能互换 Base URL 或超时恢复方式。完整兼容范围还包括 Responses 子集，见 [API 文档](../../docs/OPEN_API.md)。

新应用可使用 OpenAI Images 兼容接口；旧的任务客户端继续可用。以下命令在项目根目录运行。域名、模型和 Key 均需替换为真实控制台的数据，演示页凭据不能调用真实 API。

## Python OpenAI SDK

准备 Python 3.10 或更新版本，然后安装 SDK 并配置自己的服务地址：

```bash
python -m pip install openai
export STAR_CLOUD_BASE_URL='https://example.com/v1'
export STAR_CLOUD_API_KEY='替换为真实测试Key'
python examples/open-api/openai_images.py models
```

`models` 只读取模型，输出的每一行都是可用于后续调用的模型 ID。Key 需要 `models:read` 权限。若列表为空，检查模型开放状态与 Key 模型白名单。

确定要生成一张图片后，执行：

```bash
python examples/open-api/openai_images.py generate \
  --model '替换为模型目录返回的ID' \
  --prompt '一只在窗边晒太阳的橘猫，柔和自然光，摄影风格' \
  --idempotency-key '你已保存的请求编号，例如test-cat-001' \
  --output './cat.png'
```

`generate` 和 `edit` 会把请求直接转发到图片上游，并按站内价格消耗积分。先在控制台设置小额测试额度；需要提前核对积分时使用旧版 `/api/open/v1/tasks/quote`。上述调用只请求一张图片，使用模型默认尺寸、质量与输出格式。脚本按真实图片格式自动使用 `.png`、`.jpg` 或 `.webp` 后缀，并拒绝覆盖已有文件。

编辑已有图片使用 `edit`，Key 额外需要 `files:write`，模型必须支持参考图：

```bash
python examples/open-api/openai_images.py edit \
  --model '替换为支持编辑的模型ID' \
  --prompt '保留主体，将背景改为简洁的浅蓝色摄影棚' \
  --image './reference.png' \
  --idempotency-key '你已保存的新编辑请求编号，例如test-edit-001' \
  --output './edited.png'
```

多图时重复 `--image`；最多6张，图片文件合计不超过32 MiB，含multipart元数据的请求体不超过33 MiB。单图大小与张数还受平台和模型限制。SDK负责生成multipart边界，不要自行设置Content-Type。

脚本打印本次幂等键，关闭自动重试，最长等待270秒。每次业务请求需提前保存一个唯一编号及其参数；网络错误后的重试使用同一个编号。网关不保存任务结果，无法通过站内任务接口恢复已断开的标准请求。

如果收到504，只能确定本次HTTP处理超时，上游是否已生成无法确认。保持模型、提示词、图片和参数不变，复用原幂等键重试；只有上游本身支持幂等时，才能避免重复生成。若 Base64 响应过大，可改用 `response_format=url` 获取上游短期下载地址。完整参数、cURL、下载和错误说明见 [API文档](../../docs/OPEN_API.md)。

## 旧版 Node.js 任务客户端

`client.mjs` 是导出 `StarCloudClient` 的模块，**不是CLI**。直接运行 `node examples/open-api/client.mjs` 不会发起请求。Node.js 22或更新版本可以按下面方式导入，仅查询模型：

```bash
export STAR_CLOUD_TASK_BASE_URL='https://example.com/api/open/v1'
node --input-type=module <<'JS'
import {StarCloudClient} from './examples/open-api/client.mjs';

const client = new StarCloudClient({
  baseURL: process.env.STAR_CLOUD_TASK_BASE_URL,
  apiKey: process.env.STAR_CLOUD_API_KEY,
});
console.log(await client.models());
JS
```

在自己的服务端程序中，`quote(input)` 获取报价，`createTask(input, idempotencyKey)` 才会创建任务，`waitForTask(id)` 查询终态；调用创建前请按文档保存幂等键与完整输入。这个客户端使用 `/api/open/v1` 的任务信封，不能把Base URL改为`/v1`来调用Images协议。

`webhook.mjs` 提供签名校验与投递去重的参考实现。运行验签测试不会调用真实业务接口：

```bash
node --test examples/open-api/webhook.test.mjs
```

这些示例只在你明确执行相应命令时调用服务。不要把API Key放进公开前端代码或提交到仓库。

## 无网络 SDK 协议检查

安装 OpenAI SDK 后可运行 `python examples/open-api/test_openai_sdk.py`。该检查使用真实 SDK 与本地 MockTransport，验证模型列表、JSON 生图、multipart 单图/多图编辑、错误解析和重试提示，不请求任何服务或生成图片。先前记录使用 OpenAI SDK 3.10.0 验证；本次文档更新未重跑该检查，不代表其他 SDK 版本已验证。
