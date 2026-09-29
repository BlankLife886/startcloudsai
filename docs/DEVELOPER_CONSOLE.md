# 开发者控制台

核对日期：2026-09-29。面向开发者的接口说明见 [OPEN_API.md](OPEN_API.md)（同时渲染在 `/developer-api/docs`）。

## 设计原则

开发者 API 只有一套：OpenAI 兼容的 `/v1`（模型、生图、编辑、Chat Completions 对话），全部是直通、同步返回结果。开发者只需要知道 Base URL、Key 和模型名三样东西。

2026-09-29 起移除了以下旧设计，不再对外提供：

- 旧任务 API `/api/open/v1/*`（报价、建任务、上传、查任务、下载文件、用量、模型）。
- Webhook 回调与投递记录（`/api/v1/me/webhooks*`、`/api/v1/me/webhook-deliveries*`、worker 的 `cron:dispatch_api_webhooks`），相关数据表由迁移 `00167` 删除。
- Key 的 scope 权限（`models:read` 等）。Key 现在只按可用模型、额度、IP 白名单和有效期约束。
- 演示工作区 `/developer-api/demo`，旧链接重定向到 `/developer-api`。
- `/v1/responses`（含 WebSocket）：它是把 Responses 转成上游 chat 接口再转回来的转换层，丢失上游原生能力且问题多，已由纯直通的 `/v1/chat/completions` 取代。

后台日志里旧接口的路由名称保留并标注“已下线”，用于查看历史记录。旧任务 API 创建过的历史任务仍带 `_apiKeyId`，taskflow 的对应计费分支保留以正确结算这些存量任务。

## 页面

- `/developer-api`：控制台，包含概览、API Keys、调用记录、模型、快速接入五个分区。
- `/developer-api/docs`：渲染 `docs/OPEN_API.md`。

视觉与账号设置、订单页一致：白色卡片、18px 圆角、胶囊按钮与胶囊式分区切换，主色 `#5b4dff`，跟随站点明暗主题，适配 375–1440px 宽度。

**只展示开发者会用到的标识。** 模型页的主标识是模型名（即 `/v1` 的 `model`，由 `/api/v1/me/api-models` 的 `model` 字段提供，与 `/v1/models` 的 `id` 一致），可一键复制；该接口只返回 `/v1` 能调用的模型。内部模型 UUID 只作为 Key“可用模型”勾选项的值，不在界面出现。Key 只显示 `sk-sc-` 加 4 位，服务端返回的 `prefix` 同样截短。

调用记录读取 `GET /api/v1/me/api-calls?page=&limit=&key=`（`key` 为 Key 的 id，可选），数据来自 `developer_api_billing_requests` 关联 Key 与 `developer_api` 利润流水：时间、接口、模型名、Key 名称与短前缀、图片张数或 token 用量、扣费积分、状态（已扣费/已退回/进行中）与原因。不返回 billing id、内部模型 UUID 或上游成本。API 调用的钱包流水（来源 `openai_image_request`、`open_api_chat`、历史 `open_api_responses_chat`）不出现在用户钱包明细与导出中，只在这里展示；余额、后台账本和利润统计仍包含它们。

快速接入提供 Images 生图与 Chat Completions 对话两种 cURL 示例，只复制、不发送请求；下方列出计费规则和常见错误码。

下拉菜单、复选框、数字步进和日期日历为自定义控件，保留原生表单语义与键盘操作；面板与弹窗动画遵循系统的减少动态效果设置。

## 运维配置

- 管理后台“服务商”的 Base URL 填真实上游地址（例如 `https://上游域名/v1`），协议选 **OpenAI 兼容**，模型的 `UpstreamModel` 填上游真实模型名。不要填 StarClouds 自己的 `/v1`，否则会回环调用。
- 模型编辑页的“开放 API 调用”决定模型是否出现在 `/v1`；新建模型默认关闭，开关出现前保存的模型视为开启。“API 并发上限”限制该模型同时进行的 `/v1` 请求数（所有 Key 合计，跨实例用 Redis 计数），0 为不限制；超出时立即返回 `429 model_concurrency_limited`，不排队。服务商的“最大并发”只作用于站内任务，不作用于 `/v1`。
- 模型名在开发者 API 中作为 `model` 使用，同一类型内应保持唯一；重名时 `/v1` 只取第一个。
- `/v1` 请求不创建站内任务、不进入站内队列、不保存输入输出图片。每次调用记入 `developer_api` 利润流水。后台“业务 → 开发者 API”页（`/developer-api`）按时间、接口、结果、模型、用户、Key 筛选全站 `/v1` 调用：汇总调用数、扣费/退回数、实收、上游成本与毛利，列出每次调用的用户、Key、模型、服务商与线路、用量、实收、成本、结果原因，详情抽屉含计费单号、错误码、备注与上游 usage；“按模型”视图列出调用最多的 20 个模型。接口：`GET /api/v1/admin/developer-api/calls`、`GET /api/v1/admin/developer-api/summary`。
- 计费只有两种结局：拿到上游结果就结算，否则（上游/平台失败、风控拒绝、超时）立即释放预留并删除 Key 额度记录。生图与非流式对话的上游调用不随调用方断开而取消，上游成功照常结算；流式对话已送出内容后调用方断开按成功结算，未送出内容则释放；调用方断开后结算的请求在利润 metadata 记 note=client_disconnected（生图同样），调用记录显示“调用方中途断开，照常扣费”。网关不重试、不支持幂等键。进程中途退出留下的 pending 预留在 1 小时后由后台回收任务（每 5 分钟）释放。
- 编辑请求的参考图由 multipart 解析落到临时文件（内存只留 1 MiB），读一遍算黑名单哈希、识别格式，再边读边写进发往上游的请求体，整张图不进内存。张数以模型的参考图上限为准，请求体上限 512 MiB 只用于保护磁盘。`/v1` 不做 ClamAV 与内容审核，由上游负责。

## 验证

- 展示规则：`node --test src/features/developer-api/presentation.test.mjs`。
- 页面：`npx playwright test tests/e2e/developer-console.spec.js --project=chromium --workers=1`。用例通过路由拦截提供接口响应，不操作真实账号数据；覆盖读取失败提示、模型按 `/v1` 名称展示且不出现内部 ID、Key 表单控件，以及旧演示链接的重定向。
