# 精确图片尺寸

后台进入“模型配置 → 添加/编辑生图模型 → 图片能力”，开启“支持精确尺寸”。此能力按模型分别配置，旧模型默认关闭。

开启后，文生图、AI 助手的直接生图模式及画布图片设置可切换到“精确尺寸”，输入像素宽度和高度。输入值会按该模型的限制校验；合法值原样传给模型服务，不自动改成最接近的比例或分辨率。最终输出仍取决于模型服务是否兑现其尺寸能力。

## 配置限制

| 配置 | 说明 | 默认值 |
| --- | --- | --- |
| 最小/最大宽度 | 允许输入的宽度，单位像素 | 256 / 4096 |
| 最小/最大高度 | 允许输入的高度，单位像素 | 256 / 4096 |
| 像素步长 | 宽、高都必须是此数的整数倍 | 1 |
| 最少/最多总像素 | 宽 × 高；0 表示不额外限制 | 0 / 0 |
| 最大长短边比 | 长边 ÷ 短边；0 表示不额外限制 | 0 |

宽高与步长的配置范围为 1–16384。请按模型实际接受的范围填写；例如模型要求 8 像素对齐，就把步长设为 8。限制必须至少容纳一个可用尺寸，不允许最小值大于最大值等无效组合。

用户主动切换到不支持精确尺寸的模型时，客户端恢复比例尺寸模式。如果已选模型下架或进入维护，系统保留原来的精确宽高并提示重新选模型，不自动降级到比例尺寸。助手的 Agent、自动判断和对话模式不接收精确尺寸输入；画布工作流的图片节点可以使用精确尺寸。

OpenAI 兼容图片接口使用标准 `size: "宽x高"` 参数。CRUN 模型需要声明字符串 `size` 或数值 `width` + `height` 输入，才允许开启；提交还会检查该模型声明的枚举、范围和步长限制。没有相应输入的模型在后台不可开启此能力。

## 数据与请求

模型配置与公开模型目录使用：

```json
{
  "supportsExactSize": true,
  "exactSizeLimits": {
    "minWidth": 256,
    "maxWidth": 2048,
    "minHeight": 256,
    "maxHeight": 2048,
    "step": 8,
    "minPixels": 0,
    "maxPixels": 4194304,
    "maxAspectRatio": 0
  }
}
```

用户明确选择精确模式后，图片请求携带以下字段（普通任务放在 `params` 内，助手放在直接生图请求中）：

```json
{
  "sizeMode": "exact",
  "exactWidth": 1200,
  "exactHeight": 800
}
```

服务端根据实际模型验证后形成 `1200x800` 并传给上游。模型不支持或尺寸不合法时返回明确的参数错误。缺少 `sizeMode: "exact"` 的旧请求继续走原来的比例/分辨率逻辑，原有由客户端换算得到的 `size`、`outputSize` 和 `requestSize` 不会被误判为精确模式。

发布需同时更新 Go 服务、管理端与用户端，本地已运行的 Go 服务需重启。配置沿用现有模型目录，无需数据库迁移。

## 验证

```bash
cd apps/server
go test ./internal/modelconfig ./internal/crun ./internal/taskflow ./internal/httpapi ./internal/worker -run ExactSize -count=1

cd ../admin
npm run build

cd ../web-react
npm run typecheck:canvas
node --test scripts/test-exact-image-size.mjs scripts/test-image-output-size.mjs
ADMIN_BASE_URL=http://127.0.0.1:3200 npx playwright test tests/e2e/admin-exact-image-size.spec.js tests/e2e/exact-image-size.spec.js tests/e2e/canvas-exact-size.spec.js --project=chromium
npm run build
```

浏览器测试使用模拟接口，不调用收费模型服务或修改真实模型配置；Go 接口与执行测试使用临时数据库和本地模拟上游。
