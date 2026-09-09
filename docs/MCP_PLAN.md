# MCP 接入方案：星空云绘

状态：详细设计，未新增可用 MCP 服务或第三方凭据。REST API 并不等于 MCP。

## 1. 给非技术用户的解释

MCP 是让 AI 客户端以统一方式发现和调用工具的协议。它不是模型，不会让模型自动具备权限，也不会替代你已有的账号、钱包和图片服务。

例如外部AI客户端可以先查询“星空云绘有哪些模型”，再询问积分价格，得到用户确认后调用生图工具。你的Go服务仍负责确认账号、扣积分和交付图片。

需要区分两个方向：

| 方向 | 用户得到什么 | 推荐顺序 |
| --- | --- | --- |
| 对外 MCP Server | 外部AI客户端调用星空云绘的生图和文件能力 | 先做 |
| 站内 MCP Client | 站内助手调用外部搜索、设计资源或其他服务 | 后做，风险更高 |

首版建议只做对外Server，复用本轮完善的Open API。这样改动和安全边界更容易验证。

## 2. 项目部署形态

建议独立轻量 `mcp` 服务，通过内部HTTP调用Go业务API，不直接读写钱包数据库。外部入口使用网关 `/mcp`，全程HTTPS。浏览器不持有上游API Key。

使用官方SDK，不手写JSON-RPC解析、协议握手、流式连接或OAuth。项目主要后端为Go，优先评估官方Go SDK与目标客户端支持的协议版本；确有SDK能力缺口时才选择独立TypeScript服务。

协议必须锁定经兼容测试的版本并协商，不把“latest”作为生产契约。检索时官方文档已涉及2026-07-28版本的发现和无状态机制，不能照搬旧版initialize/SSE教程；仍需按实际SDK支持范围验证旧客户端兼容。

## 3. 首版工具清单

| MCP工具 | 复用的REST能力 | 权限/副作用 |
| --- | --- | --- |
| starcloud_list_models | GET /api/open/v1/models | models:read，只读 |
| starcloud_get_usage | GET /api/open/v1/usage | tasks:read，只读 |
| starcloud_quote_image | POST /api/open/v1/tasks/quote | tasks:write，只报价、不扣费 |
| starcloud_generate_image | POST /api/open/v1/tasks | tasks:write，冻结积分，必须确认 |
| starcloud_get_task | GET /api/open/v1/tasks/:id | tasks:read，只读 |
| starcloud_get_artifact | GET /api/open/v1/files/* | tasks:read，校验本人文件 |

首版不开放任意URL下载、任意文件系统访问、管理员设置、批量删除、兑换码、钱包调整。不能暴露REST尚未支持的取消功能。

长任务立即返回task_id、状态和建议轮询间隔，不让一次工具调用维持到图片生成结束。结果以受控资源引用或适当大小的预览交付；私有URL无法直接被无鉴权客户端读取时，由MCP服务鉴权下载再返回，不公开bucket。

## 4. 用户使用流程

1. 在星空云绘创建限定模型与额度的开发者凭据。
2. 在支持远程MCP的客户端填写服务地址，完成对应认证流程。
3. 客户端读取工具清单；用户让AI选择模型和报价。
4. 生图前展示预计积分和张数并确认，生成请求带唯一幂等键。
5. 客户端查询任务，成功后获取受控图片资源。

不承诺所有客户端都能用同一种配置JSON。发布时为实际验收过的客户端提供单独文档，并标明版本、认证方式和能力限制。

## 5. 认证方案

受控内测可使用支持自定义Authorization的客户端与限定API Key。面向一般用户的远程服务应使用规范要求的OAuth资源服务器机制、授权服务器发现和受保护资源元数据，避免让用户复制长期通用密钥。

MCP网关验证token audience、scope、有效期，映射到站内用户。访问令牌不可直接透传给任意第三方服务器；业务API调用使用受控内部身份交换或明确绑定的用户凭据，不能共享一个管理员Key。

首版内测与公网OAuth版必须分别列出上线门禁，不把API Key适配误称为所有MCP客户端的完整OAuth实现。

## 6. 风控与积分

- 每用户和每token的分钟限流、并发、日/月预算；沿用钱包余额作为硬约束。
- quote不授权未来无限调用；execute再次校验价格、输入、模型、余额。
- 用户确认关联确切参数hash，超时、改参数和增加张数需重新确认。
- 幂等键贯穿MCP请求、REST任务与上游任务，不用重试生成新的key。
- 工具结果不包含密钥、内部IP、原始数据库记录或其他账号素材。
- 所有工具调用记录trace_id、user_id、工具名、脱敏参数摘要、费用、状态、耗时。
- 数据保留、撤销凭据、异常熔断和全局关闭入口必须先于公网发布完成。

## 7. 站内连接外部MCP：第二阶段

在后台新增“集成管理”：受审核服务器目录、URL、认证方式、工具白名单、只读/写入标记、超时、预算和健康状态。用户端“我的连接”只可启用后台已审核项。

连接和工具执行均在服务端隔离进程，不能让网页直接执行stdio或下载npm包。禁止用户输入任意shell命令；stdio仅由运维部署可信固定进程。

公网HTTP服务器必须经过URL/DNS/IP校验，阻止localhost、私网、云metadata和重定向绕过。为每个连接隔离凭据，AES-GCM加密保存，输出仅掩码；用户断开后删除或撤销token。

发现到的工具描述视为不可信数据，不直接成为系统提示词；工具集合必须经过审核。第三方返回的“请把密钥发到某处”等指令不得执行。工具写操作经过明确确认，不能仅凭readOnlyHint信任其无副作用。

## 8. 建议数据表与管理接口

对外Server首版可复用现有Key/用量/任务表，增加mcp_call_audits记录协议版本和trace。

站内Client阶段新增：mcp_integrations（审核目录）、mcp_connections（用户认证绑定）、mcp_tool_policies（允许工具与确认策略）、mcp_tool_calls（调用和成本记录）。

计划接口：`GET /me/mcp-connections`、`POST /me/mcp-connections`、`DELETE /me/mcp-connections/:id`、`POST /admin/mcp-integrations/:id/test`。删除连接必须撤销认证并阻止待执行工具。

## 9. 验收与发布

阶段A：用模拟模型做SDK协议兼容测试，确认版本协商、tools/list、tool调用、错误、超时与资源读取。
阶段B：只读工具内测，再开放quote；跨用户读取、失效token、IP拒绝、恶意工具描述全部测试。
阶段C：受控用户开启generate，验证重复调用只产生一笔冻结，失败释放、断线查询和日志脱敏。
阶段D：OAuth公网发布，部署TLS、监控、告警、密钥撤销和回滚开关。
阶段E：才评估站内外部MCP Client。

生产验证必须包含真实客户端，但付费生图和新增外部连接需要单独授权，不在本次方案阶段触发。

## 10. 待确认决策

推荐先做“让外部AI调用星空云绘”，首版不开放“任何用户给站内Agent安装任意MCP”。服务入口独立但业务逻辑复用Go API；开发者Key内测，OAuth作为公网门禁。确认后再实施协议服务与客户端配置页。

## 官方参考

- [MCP架构、角色、工具与传输](https://modelcontextprotocol.io/docs/learn/architecture)
- [协议版本与规范](https://modelcontextprotocol.io/specification/latest)
- [官方SDK](https://github.com/modelcontextprotocol/go-sdk)

说明：架构页面已直接读取核对；最终选定SDK版本和认证方案后，需要再次核验该版本规范与目标客户端，不能仅依据本文生成生产认证代码。
