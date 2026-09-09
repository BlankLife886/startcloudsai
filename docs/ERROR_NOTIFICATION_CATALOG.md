# 项目错误码、返回信息与通知字典

本文档整理当前项目服务端、异步任务、通知中心及客户端提示的统一契约。统计时间为 `2026-09-01`，同步 API 共提取 `166` 个稳定错误码；任务、AI 助手和文档解析还会产生独立的异步终态码。

## 1. 使用原则

客户端必须按以下优先级处理错误：

1. 使用 HTTP 状态判断大类。
2. 使用 `code` 做程序分支。
3. 将服务端 `error` 或任务 `errorMessage` 展示给用户。
4. 只有服务端没有可用文案时，才使用客户端兜底文案。
5. 不解析中文文案判断业务状态，因为文案可以优化，`code` 才是稳定契约。

任务失败和 API 请求失败不是同一个概念：

- API 请求失败：HTTP 非 2xx，返回 `{success:false,code,error}`。
- 任务执行失败：创建任务的 API 可能已经成功，之后任务进入 `failed`，错误位于任务对象的 `errorCode/errorMessage`。
- 站内通知：写入 `notifications`，用于长期展示和未读统计。
- 页面 Toast：短暂反馈，不写通知数据库。

## 2. 通用返回结构

成功：

```json
{
  "success": true,
  "data": {}
}
```

失败：

```json
{
  "success": false,
  "code": "validation_error",
  "error": "prompt: 长度须在 1-10000 之间"
}
```

任务失败：

```json
{
  "success": true,
  "data": {
    "id": "task-uuid",
    "status": "failed",
    "errorCode": "upstream_unreachable",
    "errorMessage": "所有生成线路均已失联或失败，任务已终止并退款",
    "attempt": 2,
    "finishedAt": "2026-09-01T12:00:00Z"
  }
}
```

未知路由返回 `404/not_found`，已知路径使用错误 HTTP 方法返回 `405/bad_request`。未分类内部错误返回 `500/internal_error`，不得包含数据库错误、堆栈、密钥或内部端点。

## 3. HTTP 状态含义

| HTTP | 客户端处理 |
| --- | --- |
| `400` | 请求语义不成立或当前操作不允许；修正操作后再提交。 |
| `401` | 未登录、会话失效、验证码错误或 API Key 无效；重新认证。 |
| `403` | 已认证但没有权限、账号被禁用、Origin/IP/Scope 被拒绝。 |
| `404` | 路由、资源或受保护功能不存在；不要无限重试。 |
| `405` | HTTP 方法错误。 |
| `409` | 状态冲突、并发冲突、重复资源或需要额外确认。 |
| `410` | 兑换码等资源已经永久失效。 |
| `413` | 请求体、文件或个人存储额度超过限制。 |
| `422` | 字段、枚举、格式、数量或模型能力校验失败。 |
| `429` | 频率、并发、队列、容量、额度或流量受限；按提示等待。 |
| `500` | 本站内部一致性错误；用户不应自行重复扣费尝试。 |
| `502` | 上游返回异常或响应结构无效。 |
| `503` | 上游、存储、安全组件或功能配置暂不可用。 |

## 4. 认证、权限与通用错误码

| Code | HTTP | 返回含义/默认文案 |
| --- | --- | --- |
| `auth_required` | 401 | 请先登录；也用于需要用户身份的 Webhook 管理等接口。 |
| `admin_required` | 401 | 请登录管理员账号。 |
| `invalid_code` | 401 | 验证码错误或已过期。 |
| `email_unavailable` | 503 | 邮箱验证码服务未配置或邮件发送失败，请稍后重试或联系管理员。 |
| `invalid_credentials` | 401/403/422 | 管理员凭据错误、账号停用、用户禁用或原密码错误。 |
| `registration_closed` | 403 | 当前未开放新用户注册；既有用户仍可登录。 |
| `origin_not_allowed` | 403 | 当前浏览器 Origin 不在 `ALLOWED_ORIGINS`。 |
| `rate_limited` | 429 | 操作过于频繁；具体等待时间可能写入 `error`。 |
| `busy` | 429 | 当前分析请求过多，请稍后再试。 |
| `bad_request` | 400/405 | 请求或内部回调无效，或者 HTTP 方法错误。 |
| `validation_error` | 409/422 | 字段或业务参数校验失败；详细原因在 `error`。 |
| `not_found` | 404 | 资源不存在、无权访问或路由不存在。 |
| `conflict` | 409 | 状态已变化、工具请求被其他客户端处理或批次当前不可操作。 |
| `payload_too_large` | 413 | 请求体、导入文件或封面超过上限。 |
| `unsupported_file` | 400 | 文件类型、内容、尺寸或压缩结构不受支持。 |
| `internal_error` | 500 | 服务器内部错误或钱包/冻结账目一致性异常。 |
| `unavailable` | 503 | 流式后端、工具确认或工具结果投递暂不可用。 |
| `temporarily_unavailable` | 503 | 内部回调查询或调度暂不可用。 |
| `unauthorized` | 401 | C2A 内部回调签名无效。 |
| `unhealthy` | 503 | 健康检查发现数据库或 Redis 不健康。 |

`validation_error` 的 `error` 通常采用 `字段名: 原因`，例如 `modelId: 无效`、`count: 须在 1-4 之间`。它不是一个单一问题，客户端应原样展示具体 `error`，不要只显示“参数错误”。

## 5. Open API 与 API Key 错误码

| Code | HTTP | 返回含义/处理方式 |
| --- | --- | --- |
| `open_api_disabled` | 404 | 开放 API 页面/功能被后台关闭；对外表现为不存在。 |
| `open_api_unavailable` | 503 | 开放 API 处于维护或配置不可用。 |
| `api_key_required` | 401 | 缺少 `Authorization: Bearer <API_KEY>`。 |
| `api_key_invalid` | 401 | Key 无效、撤销、过期、上下文异常或所属账号不可用。 |
| `api_key_scope_denied` | 403 | Key 缺少当前接口需要的 Scope。 |
| `api_key_model_denied` | 403 | 模型不在该 Key 的模型白名单。 |
| `api_key_ip_denied` | 403 | 来源 IP 不在 Key 的 IP/CIDR 白名单。 |
| `api_key_temporarily_blocked` | 429 | Key 因异常请求或风控被临时限制。 |
| `api_key_daily_limit` | 429 | 今日任务数或积分额度耗尽。 |
| `api_key_monthly_limit` | 429 | 本月任务数或积分额度耗尽。 |
| `api_key_limit` | 422 | 每个账号最多保留 10 个有效 Key。 |
| `api_key_not_found` | 404 | Key 不存在、已撤销或不属于当前用户。 |
| `api_key_not_frozen` | 404 | 管理员尝试解冻不存在或未被冻结的 Key。 |
| `webhook_limit` | 422 | 每个账号最多配置 10 个 Webhook。 |
| `webhook_not_found` | 404 | Webhook 不存在或不属于当前用户。 |
| `webhook_delivery_not_retryable` | 404 | 投递不存在、不是死信或当前无需重试。 |

Open API 遇到 `401/403` 不应自动无限重试；`429` 应遵循额度和等待时间；`503` 可使用指数退避。使用同一个 `Idempotency-Key` 重试任务创建，避免重复冻结积分。

## 6. 任务、模型、容量与取消错误码

| Code | HTTP | 返回含义/处理方式 |
| --- | --- | --- |
| `task_not_found` | 404 | 任务不存在或不属于当前用户。 |
| `task_not_cancelable` | 400/409 | 当前状态不能取消、删除、重试或强制失败。 |
| `task_cancel_confirmation_required` | 409 | 已提交上游；必须明确确认停止接收结果且不退款。 |
| `task_in_use` | 409 | 任务产物仍被资产、投稿或业务内容引用，不能删除。 |
| `user_task_limit` | 429 | 当前用户运行中任务数达到上限。 |
| `user_image_capacity` | 429 | 当前用户运行中图片单位达到上限。 |
| `system_task_capacity` | 429 | 全局活跃/排队任务容量已满。 |
| `system_image_capacity` | 429 | 全局活跃图片容量已满。 |
| `queue_error` | 503 | 任务已无法可靠入队；不能假装任务已开始。 |
| `insufficient_balance` | 400 | 普通积分或可用余额不足。 |
| `trial_credit_feature_mismatch` | 400 | 体验积分不适用于当前业务，普通积分也不足。 |
| `price_changed` | 409 | 模型价格已变化，前端应刷新报价并让用户重新确认。 |
| `model_zero_price_blocked` | 503 | 模型价格为 0 且管理员未允许零积分调用。 |
| `model_price_inverted` | 503 | 用户价格低于上游成本且未允许补贴。 |
| `puzzle_local_only` | 422 | 拼图为浏览器本地工具，不创建云端任务。 |
| `revision_conflict` | 409 | 画布版本已被其他页面修改；刷新后重试。 |
| `workflow_run_lock_lost` | 409 | 画布工作流运行已被其他页面接管或结束。 |
| `id_conflict` | 409 | 指定画布项目 ID 已被占用。 |

取消确认提示的稳定含义：

- 未提交上游：可取消，释放冻结积分。
- 已提交上游：只停止本站等待和收图；上游可能继续生成，本次按已发生调用结算。
- 客户端第一次收到 `task_cancel_confirmation_required` 时必须弹确认框，确认后带 `acknowledgeUpstream:true` 再请求。

## 7. AI 助手错误码

| Code | HTTP | 返回含义/默认文案 |
| --- | --- | --- |
| `assistant_unavailable` | 502/503 | AI 服务、商品分析或后台图片分析尚未配置/暂不可用。 |
| `assistant_upstream_error` | 502 | 上游助手返回业务错误；安全清洗后的原因在 `error`。 |
| `assistant_bad_response` | 502 | AI 返回内容无法解析为所需商品、模板或素材结构。 |
| `assistant_run_limit` | 409 | 最多同时运行 4 个对话任务。 |
| `assistant_system_capacity` | 429 | 全局助手任务较多，输入未丢失，可稍后重试。 |
| `assistant_conversation_busy` | 409 | 对话仍有活动任务，当前操作要求先停止或等待。 |
| `assistant_conversation_queue_full` | 409 | 当前对话最多排队 10 个任务。 |
| `assistant_queue_full` | 409 | 当前用户最多排队 20 个助手任务。 |
| `assistant_queue_boundary` | 409 | 排队任务已位于边界或已经开始，不能再移动。 |
| `assistant_queue_item_unavailable` | 409 | 任务已经开始，不能再编辑。 |
| `assistant_idempotency_conflict` | 409 | 同一幂等键被用于不同助手请求。 |
| `assistant_cancel_confirmation_required` | 409 | 图片请求已提交上游，停止前需要确认结算后果。 |
| `assistant_editable_files_disabled` | 422 | PPT/PSD 可编辑文件功能未开放。 |
| `assistant_editable_files_unavailable` | 503 | PPT/PSD 服务商或线路配置不可用。 |
| `assistant_psd_reference_required` | 422 | 生成 PSD 前必须上传 JPG、PNG 或 WebP 参考图。 |
| `assistant_psd_unavailable` | 400 | PSD 不能作为普通助手文档上传解析。 |
| `assistant_file_not_ready` | 409 | 文档仍在解析，完成后才能加入对话。 |
| `assistant_file_count_limit` | 409 | 最多保留 50 个助手文档。 |
| `assistant_file_storage_limit` | 409 | 助手文档总容量达到 300MB。 |
| `assistant_file_processing_limit` | 429 | 最多同时解析 4 个文档。 |
| `assistant_file_daily_limit` | 429 | 24 小时最多上传 50 个助手文档。 |
| `assistant_billing_invalid` | 500 | 实际图片数或结算金额超出预留，属于内部计费保护。 |
| `assistant_run_corrupt` | 500 | 助手运行关联的用户/回复消息不存在。 |
| `agent_eval_no_cases` | 409 | 没有启用的 Agent 评测项。 |
| `agent_eval_no_samples` | 409 | 当前筛选范围没有可评测的 Agent 追踪。 |
| `ai_analysis_failed` | 502 | AI 检测/分析结果格式无效。 |

## 8. 文件、上传、下载与存储错误码

| Code | HTTP | 返回含义/处理方式 |
| --- | --- | --- |
| `invalid_upload` | 400 | 图片上传数据不完整，应重新选择文件。 |
| `upload_too_large` | 413 | 文件超过接口上限，具体限制在 `error`。 |
| `upload_storage_limit` | 413 | 用户个人素材存储空间已满。 |
| `upload_blocked` | 422 | 文件 SHA-256 命中禁止规则或基础安全检查失败。 |
| `upload_malware_detected` | 422 | 扫描器检测到恶意文件。 |
| `upload_content_rejected` | 422 | 内容安全审核拒绝。 |
| `upload_scanner_unavailable` | 503 | 强制文件扫描开启，但扫描服务不可用。 |
| `upload_review_unavailable` | 503 | 强制内容审核开启，但审核服务不可用。 |
| `download_concurrency_limited` | 429 | 同时下载数量过多。 |
| `download_temporarily_blocked` | 429 | 下载流量或风险策略临时阻止。 |
| `security_limit_unavailable` | 503 | Redis 等请求/下载保护组件不可用，生产采用失败关闭。 |
| `storage_unavailable` | 422/503 | 对象存储或文件内容暂时不可读。 |
| `image_read_failed` | 422 | 商品图片无法读取，应重新上传。 |
| `media_not_found` | 409 | 投稿或业务对象没有可用媒体。 |
| `media_unavailable` | 502 | 审核媒体读取失败。 |
| `cover_fetch_failed` | 404/502 | 封面不存在、源响应异常或读取失败。 |
| `template_asset_unavailable` | 422 | 画布模板中的图片失效或无法读取。 |

上传错误文案必须说明当前接口的实际上限，例如普通文件 15MB、公告/封面 8MB、模板包 128MiB。客户端不要用一个固定大小覆盖所有入口。

## 9. 资产与商品错误码

| Code | HTTP | 返回含义 |
| --- | --- | --- |
| `asset_exists` | 409 | 同一来源素材已经添加。 |
| `asset_duplicate_content` | 409 | 同一用户资产库已存在相同内容哈希。 |
| `asset_limit_reached` | 409 | 素材库最多保存 200 项。 |
| `asset_in_use` | 409 | 素材仍被商品引用，不能回收或永久删除。 |
| `asset_group_exists` | 409 | 分组名称重复。 |
| `asset_group_limit_reached` | 409 | 最多创建 50 个资产分组。 |
| `ecommerce_product_exists` | 409 | 商品 SKU 已存在。 |
| `ecommerce_product_limit` | 409 | 商品数量达到上限。 |
| `handheld_item_not_retryable` | 409 | 手持商品图不是失败/取消状态，或已被其他请求重试。 |
| `review_not_ready` | 409 | 图片尚未生成完成，不能批准。 |
| `review_incomplete` | 409 | 商业质检项未全部通过。 |

## 10. 支付、套餐与兑换码错误码

| Code | HTTP | 返回含义 |
| --- | --- | --- |
| `payment_unavailable` | 503 | 支付渠道未配置或配置不完整。 |
| `payment_method_unavailable` | 422 | 支付宝/微信等指定方式未开放。 |
| `payment_provider_error` | 502 | 支付方创建、查询或关闭订单异常。 |
| `order_not_found` | 404 | 订单不存在或不属于当前用户。 |
| `order_not_payable` | 400 | 订单当前状态不能完成入账。 |
| `plan_not_found` | 404 | 套餐不存在或已下架。 |
| `plan_in_use` | 409 | 套餐已有订单/订阅引用，只能下架不能删除。 |
| `plan_reorder_failed` | 409 | 套餐排序发生并发冲突，应刷新重试。 |
| `code_invalid` | 404 | 兑换码不存在。 |
| `code_redeemed` | 409 | 兑换码已使用。 |
| `code_expired` | 410 | 兑换码已过期。 |
| `code_disabled` | 410 | 兑换码已停用。 |
| `code_not_active` | 409 | 只有未兑换的兑换码可以禁用。 |
| `lanjing_pay_test_failed` | 502 | 蓝鲸支付连接测试失败。 |

## 11. 投稿、提示词、反馈、签到与增长错误码

| Code | HTTP | 返回含义 |
| --- | --- | --- |
| `submission_disabled` | 403 | 投稿功能已关闭。 |
| `submission_banned` | 403 | 用户在禁投期，文案可能包含解禁时间。 |
| `submission_daily_limit` | 429 | 今日投稿达到上限。 |
| `submission_not_allowed` | 400/409 | 任务无成功产物、已经投稿或当前状态不允许。 |
| `submission_not_approved` | 409 | 只有审核通过图片可进入提示词库。 |
| `prompt_already_exists` | 409 | 审核图片已经加入提示词库。 |
| `prompt_import_failed` | 422 | 提示词导入文件或内容解析失败。 |
| `prompt_reorder_failed` | 409 | 提示词排序并发冲突。 |
| `builtin_category_protected` | 409 | 内置分类可改名/停用，但不能删除。 |
| `catalog_reorder_failed` | 409 | 电商素材目录排序冲突。 |
| `template_reorder_failed` | 409 | 画布模板排序冲突。 |
| `feedback_daily_limit` | 429 | 24 小时最多提交 20 条反馈。 |
| `checkin_campaign_inactive` | 409 | 签到活动未开放。 |
| `growth_group_disabled` | 409 | 拼团活动未开放。 |
| `growth_group_exists` | 409 | 用户已参加本期拼团。 |
| `growth_group_not_found` | 404 | 拼团码不存在。 |
| `growth_group_expired` | 409 | 拼团已结束。 |
| `growth_group_full` | 409 | 拼团人数已满。 |

## 12. 体验活动错误码

| Code | HTTP | 返回含义 |
| --- | --- | --- |
| `trial_feature_access_required` | 403 | 功能处于内测，需要先获得体验资格。 |
| `trial_campaign_closed` | 409 | 没有开放活动、活动结束或当前操作已停止。 |
| `trial_campaign_expired` | 409 | 截止时间已过，需修改后再启用。 |
| `trial_campaign_full` | 409 | 本期名额已满。 |
| `trial_campaign_active` | 409 | 活动启用中，不能直接删除。 |
| `trial_campaign_not_active` | 409 | 活动不是启用状态，不能关闭。 |
| `trial_campaign_in_use` | 409 | 活动已有申请记录，只能关闭。 |
| `trial_campaign_features_locked` | 409 | 已有申请后不能修改体验功能。 |
| `trial_application_not_found` | 404 | 用户尚未申请或申请不存在。 |
| `trial_application_pending` | 409 | 申请正在审核。 |
| `trial_application_approved` | 409 | 申请已经通过。 |
| `trial_application_not_pending` | 409 | 申请已经处理。 |
| `trial_application_not_approved` | 409 | 只有通过的申请可以补发积分。 |
| `trial_application_conflict` | 409 | 申请状态被并发修改，刷新后重试。 |
| `trial_reward_not_ready` | 409 | 体验积分尚不可领取。 |
| `trial_reward_already_claimed` | 409 | 体验积分已经领取。 |
| `trial_reward_not_reissuable` | 409 | 当前礼包仍有效或已经领取，不能补发。 |

## 13. 管理、模型发现与安全中心错误码

| Code | HTTP | 返回含义 |
| --- | --- | --- |
| `c2a_test_failed` | 502 | C2A/ChatGPT2API 连接测试失败。 |
| `sub2api_test_failed` | 502 | Sub2API 连接测试失败。 |
| `crun_test_failed` | 502 | CRUN 连接测试失败。 |
| `model_discovery_failed` | 502 | 服务商模型发现请求失败。 |
| `model_discovery_empty` | 502 | 服务商连接成功但没有返回模型。 |
| `model_schema_failed` | 502 | 服务商模型响应结构无效。 |
| `block_not_found` | 404 | 风险限制不存在或已解除。 |
| `risk_not_found` | 404 | 风险事件不存在或已处理。 |
| `hash_not_found` | 404 | 上传哈希规则不存在或已停用。 |

## 14. 异步任务终态错误码

这些代码不会一定作为 HTTP 非 2xx 返回，而是出现在任务、助手运行或助手文件对象的 `errorCode` 中。

### 14.1 图片/媒体任务

| ErrorCode | 用户信息/含义 | 重试与结算 |
| --- | --- | --- |
| `upstream_unreachable` | 生成服务失联、轮询超时或所有线路失败。 | 可按后台预算重试；耗尽后失败退款。 |
| `upstream_error` | 上游返回明确错误或只返回文本，没有有效图片。 | 文案经过脱敏后展示；是否重试由错误类型决定。 |
| `upstream_unavailable` | 上游 5xx 或网络不可用。 | 助手可切换线路；图片任务按策略重试。 |
| `upstream_timeout` | 上游请求或流式读取超时。 | 通常可重试。 |
| `upstream_rate_limited` | 上游 429、繁忙或额度不足。 | 延迟或切换线路。 |
| `upstream_auth_failed` | 上游 401/403，密钥或账号异常。 | 不应让用户连续重试，管理员修复配置。 |
| `upstream_rejected` | 上游以非重试型 4xx 拒绝请求。 | 展示安全文案，通常不自动重试。 |
| `upstream_stream_incomplete` | 文本流异常中断。 | 可切换线路/重试。 |
| `upstream_empty_response` | 上游没有返回有效内容。 | 可重试。 |
| `upstream_text_reply` | 兼容旧任务：上游返回文本而非图片。 | 用户端转换为可读提示。 |
| `image_stream_timeout` | 兼容旧任务：图片流等待超时。 | 可重试。 |
| `image_poll_timeout` | 兼容旧任务：图片轮询超时。 | 可重试。 |
| `image_processing_error` | 图片解码、缩放、格式转换等失败。 | 失败退款，可重试。 |
| `storage_error` | 结果写入对象存储失败。 | 失败退款，可重试；不应误报上游慢。 |
| `user_canceled` | 用户主动停止。 | 提交前退款；提交后按已发生调用结算。 |
| `admin_canceled` | 管理员取消任务。 | 费用退回。 |
| `system_canceled` | 系统回滚未提交任务。 | 费用退回。 |
| `admin_force_failed` | 管理员将卡死运行任务强制失败。 | 释放冻结并记录通知。 |

### 14.2 AI 助手运行

| ErrorCode | 用户信息/含义 |
| --- | --- |
| `provider_route_failed` | 当前服务商线路失败，运行已重新排队尝试其他线路。 |
| `assistant_routes_exhausted` | 所有可用助手线路均失败或没有容量。 |
| `assistant_run_failed` | 未能归类的助手执行失败。 |
| `assistant_run_canceled` | 运行在执行过程中被取消。 |
| `assistant_interrupted` | 上下文取消或 Worker 中断。 |
| `output_limit_reached` | 上游输出达到长度/流式上限。 |
| `content_filtered` | 上游内容策略过滤。 |

### 14.3 助手文档解析

| ErrorCode | 用户信息/含义 |
| --- | --- |
| `storage_unavailable` | 文档对象多次读取失败，请重新上传。 |
| `unsupported_file` | 不支持该文档格式。 |
| `unsafe_file` | 文档结构异常、压缩炸弹风险或超过安全限制。 |
| `no_text` | 文档中没有可提取文字。 |
| `ocr_failed` | 扫描 PDF OCR 失败。 |
| `parse_failed` | 文档解析失败；后面可附安全截断后的原因。 |

## 15. 任务失败文案展示规则

Web 历史记录按以下顺序生成失败提示：

1. 优先读取任务的 `errorMessage`。
2. 若没有文案，按 `errorCode` 使用本地稳定映射。
3. 仍没有时使用“生成失败，请稍后重试”。

展示前会：

- 移除 HTTP/HTTPS URL。
- 隐藏 UUID。
- 隐藏 `requestId/taskId/traceId/runId/jobId` 后的内部编号。
- 合并空白。
- 最多展示 500 个字符。

已知本地映射包括：

| ErrorCode | 用户文案 |
| --- | --- |
| `upstream_unreachable` / `upstream_unavailable` | 生成服务暂时不可用，请稍后重试 |
| `upstream_rate_limited` | 生成服务当前繁忙或额度不足，请稍后重试 |
| `upstream_auth_failed` | 模型服务配置异常，请联系管理员处理 |
| `image_stream_timeout` / `image_poll_timeout` | 图片生成超时，请稍后重试 |
| `storage_error` | 图片保存失败，请重试 |
| `image_processing_error` | 图片处理失败，请重试 |
| `upstream_text_reply` | 上游返回了文本内容，没有生成图片 |
| `user_canceled` | 任务已由用户取消 |
| `admin_canceled` | 任务已由管理员取消 |
| `system_canceled` | 任务已由系统停止 |

## 16. 站内通知结构

通知接口返回：

```json
{
  "id": "notification-uuid",
  "kind": "task",
  "title": "文生图已完成",
  "body": "文生图已生成 2 张图片。",
  "sourceType": "task",
  "sourceId": "task-uuid",
  "readAt": null,
  "createdAt": "2026-09-01T12:00:00Z"
}
```

| 字段 | 说明 |
| --- | --- |
| `kind` | 通知类别，用于图标、筛选和默认跳转。 |
| `title/body` | 用户可见内容。 |
| `sourceType/sourceId` | 精确关联任务或订单；没有关联时可省略。 |
| `readAt` | 个人通知直接记录；全站通知通过用户读取关系计算。 |
| `createdAt` | RFC 3339 创建时间。 |

通知接口：

- `GET /api/v1/me/notifications`：cursor 分页并返回 `unread`。
- `PATCH /api/v1/me/notifications`：`{ids?:[]}`，省略 IDs 表示全部已读。
- `DELETE /api/v1/me/notifications`：清空/隐藏当前用户通知。
- `GET /api/v1/me/tasks/events`：SSE 同步任务事件和 `notifications` 未读数。

## 17. 通知类别、标题和内容

### 17.1 `task`

| 触发 | 标题模板 | Body/结算说明 |
| --- | --- | --- |
| 成功 | `{业务名}已完成` | `{业务名}已生成 N 张图片/个结果。` |
| 失败 | `{业务名}失败` | 执行失败，费用已退回。 |
| 管理员取消 | `{业务名}已取消` | 管理员取消，费用已退回。 |
| 用户提交前停止 | `{业务名}已主动停止` | 尚未提交上游，冻结积分已退回。 |
| 用户提交后停止 | `{业务名}已主动停止` | 已提交上游，按预留积分结算，不按失败退款。 |

任务通知附带 `sourceType:"task"`、`sourceId:taskId`，Web 跳转历史页，移动端可直接跳转作品详情。

### 17.2 `reward`

| 标题 | 内容模板 |
| --- | --- |
| `生成失败补偿已到账` | 任务费用已退回，另补偿 N 积分；注明每日上限。 |
| `创作里程碑达成` | 本月累计交付达到 N 张，奖励 N 积分已到账。 |
| `好友拼团成功` | 拼团满员，奖励积分已到账。 |

### 17.3 `order`

| 标题 | 内容模板 | 关联 |
| --- | --- | --- |
| `充值到账` | 订单完成，套餐积分和赠送积分已入账。 | `sourceType:"order"` |
| `订阅开通成功` | 套餐生效、每日发放积分和到期日期。 | `sourceType:"order"` |

### 17.4 `trial_access`

| 标题 | 内容模板 |
| --- | --- |
| `体验资格申请已通过` | 获得指定功能权限，专属体验积分等待领取。 |
| `体验资格申请未通过` | 显示管理员审核说明。 |
| `体验积分已到账` | 显示领取积分和可使用的体验功能。 |
| `体验积分已重新发放` | 新礼包已发放，等待领取。 |
| `体验活动已结束` | 待审申请停止审核；已通过用户的未用余额保留但暂停使用。 |

### 17.5 `system`

| 标题 | 内容模板 |
| --- | --- |
| `兑换码入账` | 兑换成功，N 分已进入钱包。 |
| `投稿审核结果` | 投稿通过或拒绝及原因。 |
| `投稿违规处理` | 作品处理、禁投时间和违规说明。 |
| `问题反馈进度更新` | 状态、管理员回复；建议采纳时包含积分奖励。 |

公告也会以全站通知形式出现，`sourceType` 可用于识别公告来源；用户已读和清除不会删除其他用户的公告。

## 18. SSE 实时信息

### 18.1 单任务 `/api/v1/tasks/{id}/events`

默认 `data`：

```json
{
  "task": {},
  "stage": "upstream_generating",
  "imageIndex": 0,
  "imageCount": 2,
  "done": false
}
```

每 15 秒发送 `: ping`。服务端每秒检查持久化终态；`done:true` 或任务进入 `succeeded|failed|canceled` 后结束连接。

### 18.2 用户任务 `/api/v1/me/tasks/events`

- 普通任务事件与单任务格式一致。
- 额外事件：`event: notifications`，`data:{"unreadCount":N}`。
- 建立连接时立即推一次未读数，任务终态后刷新，每 60 秒兜底刷新。
- SSE 不可用时，客户端使用低频接口轮询兜底，不能高频请求。

### 18.3 助手 `/api/v1/assistant/runs/{id}/events`

事件字段可能包含 `content`、`reasoning`、`kind`、`stage`、`status`、`done`、`error`、`tool`。工具事件包含 `requestId`、`name`、`arguments`、`title`、`execution` 和 `status`。

## 19. 页面 Toast 与确认信息

页面短提示统一分为：

| 类型 | 用途 | 示例 |
| --- | --- | --- |
| `success` | 保存、上传、删除、发布、兑换等操作成功 | “系统设置已生效”“模板已上传”“已入账 N” |
| `info` | 非错误状态或下一步说明 | “请输入兑换码”“任务仍在处理中” |
| `warning` | 本地校验、配置不完整、需要确认 | “请先选择模板”“封面不能超过 8MB” |
| `error` | API、网络、文件读取或执行失败 | 优先显示服务端 `error`，否则显示本地兜底 |

确认弹窗必须用于不可逆或有费用后果的操作：删除、永久删除、撤销 Key、轮换 Key、停止已提交上游任务、强制失败、关闭活动、清空日志和批量操作。

Toast 不代替通知中心：任务成功/失败、钱包到账、体验审核、订单和投稿结果需要持久通知；普通表单保存成功只显示 Toast。

## 20. 客户端网络错误

这些是客户端本地错误，不一定来自服务端：

| Code/状态 | 含义 |
| --- | --- |
| `network_error` | 无法连接服务端、DNS/TLS/浏览器网络失败。 |
| `request_aborted` | 页面切换或调用方主动取消读取请求，不应弹严重错误。 |
| `AbortError` | 浏览器/Flutter 请求被主动中止。 |
| 动态导入失败 | 发布后旧资源分块失效；前端最多做一次受控刷新恢复。 |

网络错误不能覆盖已经存在的任务终态。重新联网后应按任务 ID 查询服务端真实状态。

## 21. 错误文案安全规则

返回用户前必须移除：

- API Key、Webhook Secret、支付密钥和 Cookie。
- 服务商 Base URL、内部端点和内部路由 ID。
- 数据库 SQL、堆栈和文件系统路径。
- 内部 UUID/请求 ID（管理员诊断页除外）。
- 上游响应中的 HTML、超长正文和不可信 URL。

允许返回：

- 用户可采取行动的原因。
- 是否已提交上游、是否退款、是否可以重试。
- 合理的字段名、限制数量和等待建议。
- 经清洗、截断后的上游失败说明。

## 22. 重试建议

| 类型 | 建议 |
| --- | --- |
| `400/401/403/404/405/409/410/422` | 默认不自动重试；由用户修正、确认、登录或管理员处理。 |
| `429` | 使用服务端提示或指数退避；不要并发重试。 |
| `500` | 不自动重复有费用请求；先用幂等键查询原请求状态。 |
| `502/503` | 可有限次数指数退避；任务创建必须复用幂等键。 |
| 任务 `upstream_unreachable/upstream_timeout` | 由 Worker 使用后台重试预算；客户端不重复创建新任务。 |
| `storage_error/image_processing_error` | 任务终态后允许用户手动重试新一轮。 |

## 23. 维护要求

1. 新增 `apperr.E` 错误码时同步本文档。
2. 新增任务 `errorCode` 时同步异步终态表和前端安全文案映射。
3. 新增通知标题时明确 `kind`、`sourceType/sourceId`、跳转和是否幂等。
4. 任何错误都必须说明费用是否冻结、退回或结算。
5. 终态后停止 SSE/轮询，不能让失败任务继续显示“生成中”。
6. 客户端不得将原始上游错误、内部 ID 或 URL 不经清洗直接展示。
7. 管理后台可以看到更完整诊断，但仍不得返回密钥和数据库错误。
