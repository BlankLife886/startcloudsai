# StarClouds API 调用示例

StarClouds API 与 OpenAI API 兼容，下面的示例都直接使用官方 OpenAI SDK。完整参数与错误码见 [API 文档](../../docs/OPEN_API.md)。以下命令在项目根目录运行，域名、模型和 Key 替换为控制台中的真实数据。

```bash
export STAR_CLOUD_BASE_URL='https://example.com/v1'
export STAR_CLOUD_API_KEY='替换为你的 Key'
```

## Python

需要 Python 3.10+：

```bash
python -m pip install openai
python examples/open-api/openai_images.py models
```

`models` 只读取模型，每行输出一个模型名，后续 `--model` 填它。确定要生成一张图片后：

```bash
python examples/open-api/openai_images.py generate \
  --model 'gpt-image-2' \
  --prompt '一只在窗边晒太阳的橘猫，柔和自然光，摄影风格' \
  --output './cat.png'
```

编辑已有图片（多图时重复 `--image`，张数以模型的参考图上限为准）：

```bash
python examples/open-api/openai_images.py edit \
  --model 'gpt-image-2' \
  --prompt '保留主体，将背景改为简洁的浅蓝色摄影棚' \
  --image './reference.png' \
  --output './edited.png'
```

`generate` 和 `edit` 会按模型价格消耗积分，先在控制台给 Key 设置较小的额度。脚本按真实图片格式选择 `.png`、`.jpg` 或 `.webp` 后缀，拒绝覆盖已有文件，关闭 SDK 自动重试，最长等待 270 秒。

失败（包括上游出错、风控拒绝、超时）不扣费，也不计入 Key 额度；你主动断开连接不算失败：生图和非流式对话上游成功仍扣费，流式对话收到内容后断开也扣费；网关不会重试，需要时直接重新运行。

## Node.js

需要 Node.js 20+：

```bash
npm install openai
node examples/open-api/openai_images.mjs models
node examples/open-api/openai_images.mjs generate gpt-image-2 '一只橘猫' ./cat-node.png
```

对话接口与 OpenAI Chat Completions 相同，直接用 SDK 即可：

```python
chat = client.chat.completions.create(model="对话模型名", messages=[{"role": "user", "content": "你好"}])
print(chat.choices[0].message.content)
```

只在服务端运行，不要把 Key 放进前端代码或提交到仓库。

## 无网络 SDK 协议检查

安装 OpenAI SDK 后运行 `python examples/open-api/test_openai_sdk.py`。它用真实 SDK 加本地 MockTransport 验证模型列表、JSON 生图、multipart 单图/多图编辑、错误解析和重试提示，不请求任何服务。

## 真实环境验收脚本

`verify_developer_api.py` 只用 Python 标准库。默认只跑免费检查（模型目录、无效 Key、大请求体与未知模型、参数校验），不生成图片也不扣费：

```bash
python3 examples/open-api/verify_developer_api.py
```

加 `--paid` 会真实生成 1 张图片并调用 2 次对话（其中 1 次中途断开），执行前列出付费请求并要求输入 `yes`。它会验证每次请求独立计费、对话计入 Key 额度、收到内容后断开照常扣费且不残留冻结。提供 `--database-url` 且本机有 `psql` 时，还会核对 Key 用量与钱包冻结额；不提供时跳过这几项。

```bash
python3 examples/open-api/verify_developer_api.py --paid \
  --image-model '图片模型名' --chat-model '对话模型名' \
  --database-url 'postgres://...'
```
