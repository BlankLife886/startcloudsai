# API 调用 手动测试方案

覆盖范围：2026-09-29 至 09-30 的 6 次提交：`6970057`（/v1 直通与计费）、`78a418c`（模型目录、生命周期、调价）、`63adb30`（用户端控制台）、`678a57a`（后台 API 模型管理）、`9ad68a5`（文档）、`d5d268e`（结束兼容期，迁移 00174）。

用例编号格式为「章节-序号」，每条都写了**预期结果**。标 ⚠️ 的步骤会产生真实费用或影响真实数据，执行前要确认。

---

## 0. 原则与准备

### 0.1 不要打到真实上游

本地服务默认连的是**真实上游**，一次生图就是一次真实调用。本方案所有 `/v1` 用例都走本地假上游 `scripts/devapi-mock-upstream.mjs`。它按 prompt 里的标记返回成功、500、拒绝、限流、超时、断流等结果，可以免费覆盖所有计费分支。只有第 15 节「真实上游冒烟」会用到真实上游，那一节要单独确认后再执行。

```bash
node scripts/devapi-mock-upstream.mjs 18080
```

| 标记 | 假上游行为 | 用途 |
| --- | --- | --- |
| （无） | 成功，返回 1×1 PNG 或 mock 回答 | 正常路径 |
| `#fail500` | 500，消息里带一个 URL 和 `sk-live-123` | 失败退款、脱敏 |
| `#reject` | 400 内容安全拒绝 | `upstream_rejected` |
| `#rate` | 429 | `upstream_rate_limited` |
| `#empty` | 200 但没有图片 | 空结果不扣费 |
| `#slow` | 延迟 20 秒后成功 | 调用方断开、并发上限 |
| `#hang` | 一直不返回 | 240 秒超时 |
| `#drop` | 直接断开连接 | `upstream_unreachable` |
| `#cut` | 流式：发出两段内容后断开 | 流中途被上游切断 |
| `#cutearly` | 流式：什么都不发就断开 | 流开始前失败 |

假上游终端会逐行打印收到的请求、耗时，以及对方是否先断开。检查「断开后平台是否继续等上游」时看这里。

### 0.2 服务版本

- [ ] API（serve）和 **Worker** 都用包含这 6 次提交的代码重新构建并重启过。Worker 负责每分钟一次的 `cron:reconcile_developer_api_models`（落库「已下线」、到期调价、发通知）。Worker 没重启时请求路径照样正确，但通知和落库不会发生。
- [ ] `curl localhost:8000/api/v1/health` 正常。
- [ ] 用户端 3105、管理端 3200 已启动。

### 0.3 账号与数据

| 角色 | 要求 |
| --- | --- |
| 管理员 A | 能登录 `/admin/` |
| 用户 U1 | 普通账号，充值余额 ≥ 1000 积分（后台调账或支付沙箱） |
| 用户 U2 | 只有体验积分、没有充值余额（用于 11-1） |
| 用户 U3（可选） | 有订阅，套餐渠道包含 `api`（用于 11-2 至 11-4） |

### 0.4 搭建测试模型（后台）

1. 「服务商」新建 `mock-upstream`：协议选 **OpenAI 兼容**，Base URL 填 `http://127.0.0.1:18080/v1`。
2. 「模型配置」新建两个站内模型，都挂在 `mock-upstream` 上：
   - `测试图片模型`：类型为图片，`UpstreamModel=mock-image`，价格 10 积分/次，参考图上限 ≥ 2，单次张数上限 ≥ 2。
   - `测试对话模型`：类型为对话，`UpstreamModel=mock-chat`，价格 2 积分/次。
3. 「API 调用 → API 模型」新建：
   - `test-image`：kind=image，指向 `测试图片模型`，价格模式 `fixed`，10 积分。
   - `test-chat`：kind=chat，指向 `测试对话模型`，价格模式 `follow`。
   - `test-image-v2`：kind=image，指向 `测试图片模型`，fixed 12 积分。作为替代模型使用。
4. 三个模型都先保持**草稿**状态，第 2 节再发布。

### 0.5 终端变量

```bash
export BASE=http://localhost:8000/v1
export KEY='U1 在控制台创建的 Key'
export DB="$(本地 API 使用的 DATABASE_URL)"
```

下文 `SQL:` 开头的语句都用 `psql "$DB" -c '...'` 执行，只读语句可以随时运行。

### 0.6 每条计费用例都要核对的「计费四件套」

1. **响应**：状态码、`error.code`、`X-Should-Retry` 头。
2. **余额**：U1 钱包余额的变化（刷新钱包页，或查 `wallet` 相关表）。
3. **调用记录**：控制台「调用记录」这一行的状态（已扣费 / 已退回 / 进行中）和原因。
4. **Key 额度**：Key 列表「今日请求」「今日积分」是否增加。失败的请求不应计入。

```sql
-- 最近 10 次调用
SELECT created_at, source_type, status, api_model_name, price_cents, settled_at
FROM developer_api_billing_requests ORDER BY created_at DESC LIMIT 10;
```

`status` 取值为 `pending`（进行中）、`succeeded`（已扣费）、`failed`（已退回）、`expired`（被回收任务释放）。失败原因不在这张表里，要在控制台调用记录或后台API 调用 页查看。

---

## 1. 迁移与升级（`d5d268e`、`78a418c`）

| # | 步骤 | 预期 |
| --- | --- | --- |
| 1-1 | `SQL: SELECT max(version_id) FROM goose_db_version;` | ≥ 174 |
| 1-2 | `SQL: \d user_api_keys` | 有 `allowed_api_model_ids`；**没有** `allowed_model_ids`；status 约束包含 `paused` |
| 1-3 | `SQL: SELECT id, api_name, kind, status, price_mode FROM developer_api_models ORDER BY api_name;` | 迁移前 `/v1/models` 能看到的每个模型都有一条 `live` 记录，名称不变；未绑定工作台或同名被去重的是 `draft`，名称带后缀（如 `-2`） |
| 1-4 | 后台「API 模型」页顶部 | 显示迁移报告：草稿条目和受影响的 Key |
| 1-5 | 后台模型编辑页 | 不再有「开放 API 调用」「API 并发上限」两项；模型卡片显示「API N」 |
| 1-6 | 重启 serve 一次 | 启动日志没有迁移错误，目录条目数量不变（迁移是幂等的） |
| 1-7（可选，用库副本） | 用迁移前的库备份起一个临时实例并启动 serve | 自动迁到 173、回填目录、再迁到 174；原来 Key 的「指定模型」映射到对应的目录 ID |

---

## 2. 后台：API 模型管理（`678a57a`）

| # | 步骤 | 预期 |
| --- | --- | --- |
| 2-1 | 发布 `test-image` | 发布前显示影响预览（引用它的 Key 数、近期调用数、目标站内模型近 1 小时站内与 API 负载）；发布后状态为「上线」 |
| 2-2 | 发布后尝试修改 `test-image` 的 api_name | 不允许（发布后名称锁定） |
| 2-3 | 修改 kind | 不允许 |
| 2-4 | 新建一个 api_name 为 `TEST-IMAGE` 的条目（只有大小写不同） | 提示名称冲突 |
| 2-5 | 给 `test-chat` 加别名 `test-chat-alias`，然后发布 `test-chat` 和 `test-image-v2` | 成功 |
| 2-6 | 新建别名与已有名称相同的条目 | 提示冲突（别名与名称共用唯一空间） |
| 2-7 | 「API 调用 设置」把弃用预告期改为 0、400、3 | 0 和 400 被拒绝（允许范围 1–365）；3 保存成功，最后改回 7 |
| 2-8 | `SQL: SELECT action, reason, created_at FROM developer_api_model_events ORDER BY id DESC LIMIT 10;` | 上面每个操作都有一条审计记录 |

---

## 3. 用户端：Key 管理（`63adb30`）

用 U1 登录 `http://localhost:3105/developer-api`。

| # | 步骤 | 预期 |
| --- | --- | --- |
| 3-1 | 进入控制台，依次切换四个分区 | URL 分别是无参数、`?tab=keys`、`?tab=calls`、`?tab=models`；刷新后仍停在同一分区。旧链接 `?tab=overview`、`?tab=quickstart` 落到「开始使用」；`/developer-api/demo` 重定向到 `/developer-api` |
| 3-2 | 新建 Key「全部模型」，额度选「标准」 | 抽屉从右侧滑出；密钥只完整显示一次；「开始使用」的示例代码自动填入该密钥 |
| 3-3 | 刷新页面 | 示例代码里不再有完整密钥；列表里只显示 `sk-sc-` 加 4 位 |
| 3-4 | 再新建一把 Key「指定模型」，只选 `test-image` | 下拉面板里图片模型和对话模型分 tab，显示已选数/总数；支持搜索、全选、清空；按 Esc 收起 |
| 3-5 | 编辑时额度选「自定义」 | 展开六项输入；预设档只显示一行摘要 |
| 3-6 | 点 Key 名称 | 打开详情抽屉：用量卡片、可用模型及状态、IP 白名单、有效期等 |
| 3-7 | 停用第二把 Key | 状态变为琥珀色「已停用」 |
| 3-8 | 轮换第一把 Key | 旧密钥立即失效（见 4-4），新密钥只显示一次 |
| 3-9 | 撤销一把 Key，再打开列表底部的「显示已撤销」 | 撤销的 Key 默认隐藏，打开开关后显示 |
| 3-10 | 页面上搜索内部模型 UUID | 任何地方都不应出现内部 UUID |

---

## 4. /v1 鉴权与模型列表

| # | 请求 | 预期 |
| --- | --- | --- |
| 4-1 | `curl -s $BASE/models -H "Authorization: Bearer $KEY"` | 列表包含 `test-image`、`test-chat`、`test-image-v2`，每项有 `status:"live"`；不包含草稿；不包含内部 ID |
| 4-2 | `curl -s $BASE/models/test-chat-alias -H ...` | 能通过别名查到 |
| 4-3 | 不带 Authorization / 随便写一个 Key | `401 invalid_api_key` |
| 4-4 | 用 3-8 轮换前的旧密钥 | `401 invalid_api_key` |
| 4-5 | 用 3-7 停用的 Key | `403 api_key_paused`；重新启用后立即恢复，密钥不变 |
| 4-6 | 给 Key 设 IP 白名单 `10.0.0.1` 后调用 | `403 api_key_ip_denied` |
| 4-7 | 把 Key 有效期设为昨天（`SQL: UPDATE user_api_keys SET expires_at=now()-interval '1 day' WHERE ...`） | `401 api_key_expired` |
| 4-8 | 只允许 `test-image` 的 Key 调用 `test-chat` | `404 model_not_found`，消息里带模型名；`/v1/models` 只返回 `test-image` |
| 4-9 | `model` 填一个不存在的名称，或填草稿模型的名称 | `404 model_not_found` |
| 4-10 | 已删除的旧接口：`/v1/responses`、`/api/open/v1/models` | 404；不能回退到旧逻辑 |
| 4-11 | 每分钟请求上限设为 2，连发 3 次 `/v1/models` 以外的付费请求 | 第 3 次返回 `429 rate_limited` |

---

## 5. 生成图片 `/v1/images/generations`

```bash
curl -s -D - $BASE/images/generations -H "Authorization: Bearer $KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"test-image","prompt":"一只猫","n":1}'
```

| # | 请求体变化 | 预期 |
| --- | --- | --- |
| 5-1 | 默认 | 200，`data[0].b64_json`；响应头 `X-Should-Retry: false`；**扣 10 积分**；调用记录「已扣费」，模型名 `test-image` |
| 5-2 | `"n":2` | 2 张图，按张数计费（以模型报价规则为准） |
| 5-3 | `"response_format":"url"` | `data[0].url` 有值 |
| 5-4 | `"n":11` / 超过模型单次上限 | `400 invalid_parameter`，`param:"n"`，不扣费 |
| 5-5 | `"size":"1234x777"`（模型不支持精确尺寸） | 400，不会被偷偷缩放 |
| 5-6 | 分别传 `mask`、`stream`、`style`、`input_fidelity` | `400 unsupported_parameter`，`param` 指出字段 |
| 5-7 | `"background":"transparent","output_format":"jpeg"` | 400 |
| 5-8 | 缺少 `prompt` / 缺少 `model` | `400 invalid_parameter` |
| 5-9 | `"quality":"hd"` | 按 `high` 处理，不报错 |
| 5-10 | `"user"` 字段超过 256 个字符 | 400 |

---

## 6. 编辑图片 `/v1/images/edits`

```bash
curl -s $BASE/images/edits -H "Authorization: Bearer $KEY" \
  -F model=test-image -F prompt=换背景 -F image=@artifacts/text-test.png
```

| # | 变化 | 预期 |
| --- | --- | --- |
| 6-1 | 单张 `image` | 200，扣费；假上游终端打印「收到参考图 1 张」 |
| 6-2 | 两张 `-F 'image[]=@a.png' -F 'image[]=@b.png'` | 200；假上游打印「收到参考图 2 张」 |
| 6-3 | 张数超过模型参考图上限 | 400，不扣费，假上游没有收到请求 |
| 6-4 | 上传 `.txt` 文件或 GIF | 400，格式不支持 |
| 6-5 | 不传图片 | 400 |
| 6-6 | 用一张 50–100MB 的 PNG 测试 | 正常转发；API 进程内存没有明显暴涨（参考图边读边转发，不整张进内存） |
| 6-7 | 调用后查看服务器临时目录和对象存储 | 不保存输入图和输出图 |

---

## 7. 对话 `/v1/chat/completions`

| # | 请求 | 预期 |
| --- | --- | --- |
| 7-1 | 非流式 `{"model":"test-chat","messages":[{"role":"user","content":"你好"}]}` | 200；返回的 `model` 是 `test-chat`（不是上游的 `mock-chat`）；扣 2 积分；调用记录里有 token 用量 |
| 7-2 | `"stream":true`（`curl -N`） | SSE 逐段输出，以 `data: [DONE]` 结束；每个 chunk 的 `model` 都是 `test-chat`；扣费 1 次 |
| 7-3 | 用别名 `test-chat-alias` 调用 | 成功，计入 `test-chat` |
| 7-4 | 带 `tools`、`response_format` 等额外字段 | 原样转发（在假上游日志里看请求体大小，或临时让假上游打印 body） |
| 7-5 | 用 OpenAI Python SDK 走一遍（`max_retries=0`），包括流式 | 与 curl 结果一致 |
| 7-6 | 请求体 > 48 MiB | `413 request_too_large` |

---

## 8. 计费与失败矩阵（重点）

每行都要核对 0.6 的「计费四件套」。图片用 `test-image`，对话用 `test-chat`，在 prompt 或消息内容里写入标记。

| # | 接口 / 标记 | 预期 HTTP / code | 扣费 | 计入 Key 额度 |
| --- | --- | --- | --- | --- |
| 8-1 | 图片 `#fail500` | 502 `upstream_error`；消息里的 URL 和 `sk-live-123` **已打码**；带请求 ID | 否，已退回 | 否 |
| 8-2 | 图片 `#reject` | 400 `upstream_rejected`，附上游原因 | 否 | 否 |
| 8-3 | 图片 `#rate` | 429 `upstream_rate_limited` | 否 | 否 |
| 8-4 | 图片 `#empty` | 502 `image_result_unavailable`「上游没有返回任何图片，本次不扣费」 | 否 | 否 |
| 8-5 | 图片 `#drop` | 502 `upstream_unreachable` | 否 | 否 |
| 8-6 | 图片 `#hang`（约 4 分钟） | 504 `request_timeout` | 否 | 否 |
| 8-7 | 图片 `#slow`，3 秒后 Ctrl-C 断开 curl | 假上游约 20 秒后打印请求完成（**平台继续等待，没有取消**）；随后**扣费**；调用记录显示「调用方中途断开，照常扣费」 | 是 | 是 |
| 8-8 | 对话非流式 `#slow`，中途断开 | 同 8-7 | 是 | 是 |
| 8-9 | 对话流式 `#cut` | 流里出现 `data: {"error":...}` 或连接中断 | **否**（上游切断的算失败） | 否 |
| 8-10 | 对话流式 `#cutearly` | 失败 | 否 | 否 |
| 8-11 | 对话流式 `#slow`（首段内容前延迟），在收到任何内容前断开 | — | 否 | 否 |
| 8-12 | 对话流式正常请求，收到第一段内容后立即 Ctrl-C | — | **是** | 是 |
| 8-13 | 对话 `#fail500` / `#reject` | 502 / 400 | 否 | 否 |
| 8-14 | U1 余额调到 5 积分，再请求 10 积分的图片 | 余额不足错误，假上游没有收到请求 | 否 | 否 |
| 8-15 | Key 日积分预算设为 15，连发两次 10 积分的图片 | 第 2 次 `429 api_key_daily_limit` | — | — |
| 8-16 | 查看钱包「积分明细」和导出文件 | 看不到任何 API 扣费（来源 `openai_image_request`、`open_api_chat`），但**余额已变化** | — | — |
| 8-17 | 残留预扣回收：请求 `#hang` 时 kill serve，再重启 | 调用记录留一条「进行中」；约 1 小时后（回收任务每 5 分钟跑一次）释放预扣，余额恢复 | — | — |

8-17 耗时较长，可以最后做。想加速的话，执行 `UPDATE developer_api_billing_requests SET expires_at=now() WHERE status='pending'`，最多等 5 分钟，状态会变为 `expired`，余额恢复。

---

## 9. 模型并发上限

| # | 步骤 | 预期 |
| --- | --- | --- |
| 9-1 | 后台把 `test-image` 的并发上限设为 1 | 保存成功 |
| 9-2 | 终端 A 发 `#slow` 请求（20 秒），同时终端 B 发普通请求 | B 立即返回 `429 model_concurrency_limited`，不排队、不扣费 |
| 9-3 | 用两把不同的 Key、甚至不同用户同时请求 | 同样被限（上限是所有 Key 合计） |
| 9-4 | A 完成后 B 再发 | 成功 |
| 9-5 | A 请求期间 kill serve 并重启 | 并发名额能恢复，不会永久占用（Redis 槽位有过期时间） |
| 9-6 | 把上限改回 0 | 不再限制 |

---

## 10. 生命周期（`78a418c`）

### 10.1 维护

| # | 步骤 | 预期 |
| --- | --- | --- |
| 10-1 | 后台把 `test-image` 设为维护，然后调用它 | `503 model_unavailable`；响应头 `Retry-After: 60`、`X-Should-Retry: true`；**不扣费**，假上游**没有**收到请求 |
| 10-2 | `/v1/models` | 仍然列出，`status:"maintenance"` |
| 10-3 | 控制台模型页 | 显示「维护中」徽标和「暂时不可用，调用返回 503」 |
| 10-4 | 恢复上线 | 调用恢复正常 |
| 10-5 | 在后台把**站内模型** `测试图片模型` 设为维护或停用 | 先弹出 409 影响确认（见 12-1）；确认后 `/v1` 调用 `test-image` 返回 503（不是 404），`/v1/models` 显示 maintenance |

### 10.2 弃用 → 下线

| # | 步骤 | 预期 |
| --- | --- | --- |
| 10-6 | 弃用 `test-image`，sunset 设为 3 天后（预告期为 7 天时） | 被拒绝，提示预告期不足 |
| 10-7 | 弃用 `test-image`，sunset 设为 8 天后，替代模型选 `test-image-v2` | 成功；U1 收到**站内通知**（前提：U1 近 30 天调用过它，或 Key 指定了它） |
| 10-8 | 调用 `test-image` | 200，照常扣费；响应头有 `Deprecation: @<unix秒>`、`Sunset: <HTTP 日期>`、`Link: </v1/models/test-image-v2>; rel="successor-version"` |
| 10-9 | `/v1/models/test-image` | `status:"deprecated"`，有 `sunset_at`（RFC 3339）和 `replacement:"test-image-v2"` |
| 10-10 | 控制台 | 模型页显示「X月X日 下线，建议改用 test-image-v2」；指定了它的 Key 标琥珀色「1 个即将下线」；Key 详情里有对应提醒；在「开始使用」选中它时，下拉框下方有提示 |
| 10-11 | 撤销弃用（undeprecate） | 恢复为 live，响应头消失 |
| 10-12 | 再次弃用，然后执行 `SQL: UPDATE developer_api_models SET sunset_at=now()-interval '1 minute' WHERE api_name='test-image';`，**立即**调用 | `410 model_retired`，消息里给出 `test-image-v2`。**不依赖 Worker**，这一步就应该生效 |
| 10-13 | 等 1–2 分钟（Worker 在运行） | `SQL:` 查询显示 status 变为 `retired`，`retired_at` 有值；用户收到下线通知 |
| 10-14 | `/v1/models` | 不再列出 `test-image`；`/v1/models/test-image` 返回 410 |
| 10-15 | 控制台 | 模型页显示「已下线」，没有「用它生成代码」；只指定了它的 Key 标红「无可用模型」；编辑这把 Key 时，已下线的模型被自动移出选择，保存不报错 |
| 10-16 | 历史调用记录 | 仍然显示 `test-image` 这个名称（名称快照） |

### 10.3 紧急下线与撤回

| # | 步骤 | 预期 |
| --- | --- | --- |
| 10-17 | 对 `test-chat` 执行紧急下线 | 必须填写原因并二次确认；立即返回 410；审计记录里有原因 |
| 10-18 | 新建草稿 `test-draft`，发布后执行「撤回」（withdraw） | 按撤回规则变化（回到草稿，调用返回 404）；核对是否与后台说明一致 |
| 10-19 | 新建一个条目，把已下线的 `test-image` 旧名作为别名 | 可以（已下线模型的别名会释放，主名仍占用）；调用 `test-image` 时，上线中的别名优先于已下线的条目 |

### 10.4 更换指向

| # | 步骤 | 预期 |
| --- | --- | --- |
| 10-20 | 新建站内模型 `测试图片模型B`（能力相同），把 `test-image-v2` 改指向它 | 成功；调用名称不变；Key 的指定模型仍然有效 |
| 10-21 | 改指向一个能力更少的模型（参考图上限更小） | 要求填写原因；控制台显示「参数范围已调整」 |
| 10-22 | 把 image 条目改指向对话模型 | 被拒绝（kind 不一致） |
| 10-23 | 修改站内模型显示名称、解绑工作台 | `/v1` 仍按原 `api_name` 可调用 |

---

## 11. 资金来源与订阅

| # | 步骤 | 预期 |
| --- | --- | --- |
| 11-1 | U2（只有体验积分）创建 Key 并调用 | 余额不足，**体验积分不被消耗** |
| 11-2 | U3 的订阅套餐 `modelIds` 为空、渠道含 `api` | API 可以用订阅积分 |
| 11-3 | 套餐限定了 `modelIds`、`apiModelIds` 只含 `test-chat` | 调用 `test-chat` 用订阅积分；调用 `test-image-v2` 不用订阅积分（改扣充值余额；余额不足则报错） |
| 11-4 | 套餐限定了 `featureKeys`、但没勾「API 调用 生图/对话」 | API 不能用订阅积分 |
| 11-5 | 后台编辑套餐（`678a57a`） | 勾选 API 渠道并填了模型范围时出现「API 模型」多选；编辑其他字段后再保存，API 模型范围**不丢失** |
| 11-6 | 订阅锁价 | API 价格不享受锁价；在 `developer_api_contract_lock_until` 之前，API 生图仍按锁价，之后按目录价 |

---

## 12. 站内模型配置保护与后台页面

| # | 步骤 | 预期 |
| --- | --- | --- |
| 12-1 | 删除、停用或设维护一个被 live API 模型引用的站内模型，或把它的服务商改为非 OpenAI 协议 | 弹窗列出受影响的 API 模型（接口返回 `409 api_model_impact`）；取消后不保存；确认后带 `confirmApiImpact=1` 保存成功 |
| 12-2 | 修改一个**没有**被引用的站内模型 | 不弹确认 |
| 12-3 | 模型编辑页 | 列出引用它的 API 模型名称 |
| 12-4 | 后台「业务 → API 调用」 | 按时间、接口、结果、模型、用户、Key 筛选；汇总调用数、扣费/退回数、实收、成本、毛利；详情抽屉有计费单号、错误码、上游 usage；「按模型」视图正常 |
| 12-5 | 用户账务详情 | 每个充值包、每期订阅额度的「已用」拆成「站内 / API」；订单退款核算注明 API 消耗 |
| 12-6 | 侧栏与顶部待办 | 订单、订阅变更入口在侧栏；待办里有待审核的退款，徽标数量包含订阅退款 |
| 12-7 | 旧的盈利分析页路由 | 已移除，不能访问 |

---

## 13. 调价（`78a418c` 第三期）

| # | 步骤 | 预期 |
| --- | --- | --- |
| 13-1 | `test-image-v2`（fixed 12）改为 8 | **立即生效**，下一次调用扣 8 |
| 13-2 | 再改为 15 | 不立即生效：`pending_price_cents=15`，`pending_price_at` 约为 7 天后；调用仍扣 8；控制台模型页显示「X月X日 起 15 积分/次」；相关用户收到站内通知 |
| 13-3 | `SQL: UPDATE developer_api_models SET pending_price_at=now()-interval '1 minute' WHERE api_name='test-image-v2';` 后立即调用 | 扣 15（请求路径即时计算，不等 Worker）；1 分钟内 Worker 把 15 写入当前价，并清空 pending |
| 13-4 | follow 模式的 `test-chat`（需要先恢复一个 follow 条目，或新建一个）：把站内模型价格从 2 调到 5 | 保存后立即写入 pending（7 天后生效）并发通知；API 仍扣 2；站内立即按 5 计价 |
| 13-5 | 同一预告期内，站内价从 5 降到 4 | 生效日期不变，预告价下调为 4 |
| 13-6 | 站内价再涨到 6（超过已预告的价格） | 按 6 重新预告 7 天，并再发一次通知 |
| 13-7 | 站内价降到 1（低于当前 API 价） | API **立即**按 1 扣费 |
| 13-8 | 站内设置折扣价，之后结束折扣 | 打折时 API 立即跟着降价；折扣结束算涨价，走 7 天预告 |
| 13-9 | 请求中途调价：发 `#slow` 请求，在 20 秒内把 fixed 价格降低 | 这次请求仍按开始时的价格扣费 |
| 13-10 | 草稿模型调价 | 立即生效，没有预告 |

---

## 14. 用户端其他页面

| # | 步骤 | 预期 |
| --- | --- | --- |
| 14-1 | 「开始使用」依次选择三个接口 | 显示完整路径；「图片编辑」只列出参考图上限 > 0 的模型；Python / Node / cURL 代码中受影响的行用对应颜色标出；只复制、不发送请求 |
| 14-2 | 「模型」页「用它生成代码」 | 切到「开始使用」并选中该模型 |
| 14-3 | 「调用记录」 | 显示时间、接口、模型、Key 名称与前缀、张数或 token、扣费、状态、原因；可按 Key 筛选；可分页；不暴露 billing id、内部 UUID、上游成本 |
| 14-4 | 钱包页、订阅页 | 本月有 API 调用时显示「API 调用 本月消耗 N 积分（M 次调用），不计入积分明细 · 查看调用记录」，链接能跳到调用记录；本月没有调用时不显示 |
| 14-5 | 暗色主题；把窗口缩到 960px 以下 | 侧栏变为顶部横向导航，页面布局不乱 |
| 14-6 | 系统开启「减少动态效果」 | 抽屉和面板没有动画 |
| 14-7 | `/developer-api/docs` | 渲染出最新的 OPEN_API.md（包含 410、503 和弃用响应头的说明） |
| 14-8 | 1280×720 视口下的 Key 表格 | 中间列横向滚动，名称列和操作列固定 |

---

## 15. ⚠️ 真实上游冒烟（需确认后执行）

前面各节都通过后，用一个真实模型各跑一次最小请求，确认真实上游的协议兼容。这一步会产生真实费用。

- [ ] 文生图 1 张，`size=auto`
- [ ] 图片编辑 1 张参考图
- [ ] 对话非流式和流式各 1 次
- [ ] 每次都核对「计费四件套」，以及后台API 调用 页的上游成本和毛利

## 16. 自动化测试（辅助，可与手动测试同时跑）

```bash
cd apps/server && go test ./internal/apicatalog/... ./internal/httpapi/... -run 'Developer|OpenAI|Catalog|Lifecycle'
```

```bash
cd apps/web-react && node --test src/features/developer-api/presentation.test.mjs && npx playwright test tests/e2e/developer-console.spec.js --project=chromium --workers=1
```

```bash
cd apps/admin && npx playwright test tests/e2e/admin-developer-api-models.spec.js tests/e2e/admin-plan-api-scope.spec.js --workers=1
```

## 17. 清理

- 用 SQL 改过的 `sunset_at`、`pending_price_at`、`expires_at` 恢复原值，或直接删除测试条目。
- 撤销测试用的 Key；删除 `mock-upstream` 服务商和测试站内模型（删除前会弹 409 确认，这是预期行为）。
- 弃用预告期改回 7 天；并发上限改回 0。
- 如果 U1、U2、U3 是临时账号，一并清理。
