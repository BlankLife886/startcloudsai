# 无限画布与 Agent 审查

审查日期：2026-09-06。范围：当前工作区中的 React 画布、托管 Agent、工具投递、Go 工具协议和工作流记录接口。保留现有未提交修改，本报告不包含业务修复。使用 CodeGraph 定位后阅读实现，并运行现有测试及无上游调用的最小复现。

## 结论

画布不是空壳：已有图结构校验、布局、视觉检查、生成预检、费用确认、工作流拓扑调度、浏览器锁、服务端租约、节点取消闭包、检查点和输出恢复。

但不能说“所有节点都可让 Agent 完整操作”，也不能据单元测试通过认定真实模型和整条工作流端到端正常。主要缺口是插件节点协议不一致、跨页面生命周期的工具幂等，以及工作流恢复时的身份和版本校验。

## 按优先级排序的问题

### P1：工具已执行但确认失败，页面崩溃恢复后可能重复执行

- 位置：`apps/web-react/src/canvas/services/canvas-task-api.ts:918`、`:949`；`apps/web-react/src/canvas/lib/canvas/canvas-agent-tool-delivery.ts:55`；`apps/server/internal/store/assistant.go:452`。
- executor ID 写入 sessionStorage，但工具结果缓存只是模块级 Map。服务端允许相同 executor 对未完成请求重复 claim。工具修改成功、结果回执未到服务端时，页面进程崩溃或未能完成取消的重载会丢失缓存；恢复后同一 requestId 可再次执行。
- Web Locks 和当前页内的结果缓存能防止同一页面重复投递，但不覆盖这个持久化故障窗口。正常导航的取消逻辑可缩小窗口，不能替代持久幂等。
- 无网络最小复现：对同一 runId/requestId，第一次 delivery 执行成功、ack 抛错，随后用空缓存重建 delivery；执行次数为 `2`。这是投递层的故障复现，不是已完成的浏览器崩溃端到端测试。
- 影响：不带显式 ID 的建图可能重复；`startGeneration` 未把工具 requestId 作为 taskKeySalt 传下去（`use-agent-bridge.ts:158`），存在重复生成和计费的风险。工作流本身的 runId 任务幂等不能自动覆盖这些普通 Agent 生成请求。
- 建议：持久化 requestId、操作结果及执行状态；生成工具沿用稳定 requestId 构造任务幂等键；图修改采用确定性节点 ID 或服务端事务版本。补充“变更已保存、ack 失败、崩溃恢复”的故障注入测试。

### P2：恢复检查点只比较节点 ID，忽略连线、提示词、模型和参数变化

- 位置：`apps/web-react/src/canvas/lib/canvas/canvas-workflow.ts:198`；`apps/web-react/src/canvas/pages/canvas/project.tsx:4070`、`:4616`。
- `workflowPlanMatchesCheckpoint` 仅判断有序 nodeIds 相同。恢复时会保留 completedNodeIds，因此同一批节点改了输入或依赖后，仍可能跳过应当重算的已完成节点。
- 最小复现：两个配置节点 a、b 原本无依赖，随后增加 `a -> image -> b`；两次计划均为 `[a,b]`，b 的依赖从 `[]` 变为 `[a]`，但检查点匹配仍返回 `true`。
- 建议：保存规范化图版本/摘要及每个节点的输入、参数摘要；变更后显式选择新运行，或将变更节点及下游标记为失效。执行前和恢复时均校验。

### P2：托管 Agent 创建协议没有覆盖插件节点，部分类型会静默降级为文本

- 位置：`apps/server/internal/worker/assistant_canvas.go:52`、`:102`、`:126`、`:3235`。
- 服务端 create_graph 和 add_node 的公开 schema 仅列出 text、image、config、group。create_graph 的清洗器将其他类型改成 text；前端却已注册 Markdown、SVG、HTML、全景和便利贴节点。
- 现有插件节点的通用 metadata 修改、移动、缩放、删除可以走通用操作；这不等于模型能通过官方工具协议可靠地创建和理解它们。add_node 运行时未严格拒绝未知枚举也不能当作受支持的产品能力。
- 建议：由统一能力目录生成前后端工具 schema；返回可创建类型、可编辑字段、可执行动作及资源种类。未知类型应明确返回错误，不应偷偷变成文本。

### P2：全景节点人工可生成，但 Agent 标准生成入口和工作流不会执行

- 位置：`apps/web-react/src/canvas/components/canvas/nodes/bundled/panorama-node.tsx:266`；`apps/web-react/src/canvas/lib/canvas/canvas-operation-node.ts:19`；`apps/web-react/src/canvas/pages/canvas/hooks/use-agent-bridge.ts:145`；`apps/web-react/src/canvas/lib/canvas/canvas-workflow.ts:345`。
- 全景节点声明了 `useBuiltinPanel` 和 `writeBackToSelf`，页面生成器在 `project.tsx:3342` 有实际生成分支；但 `isCanvasExecutableNode` 只允许 config 和五种 builtin 操作节点。Agent 的标准 startGeneration 与工作流编译均用这个过滤器，因而排除全景。
- 旧式 apply_ops/run_generation 可直接经过另一路径，不构成完整支持：没有标准 requestId 状态跟踪，且各入口行为不一致。
- 建议：为节点注册能力增加执行适配器、输入校验、输出校验、费用估算、取消和恢复契约；让人工、Agent 与工作流共用同一执行注册表。

### P2：重试/恢复工作流时，Agent 可能把实际结果显示为取消

- 位置：`apps/web-react/src/canvas/pages/canvas/hooks/use-agent-bridge.ts:273`、`:284`；`apps/web-react/src/canvas/lib/canvas/canvas-workflow.ts:131`、`:161`。
- Agent 状态记录用当前 startedAt 保存 baseline，再通过 startedAt 是否变化判断本次是否开始；工作流失败重试和恢复会保留原始 startedAt。相同 startedAt 的成功重试在 record.settled 后会落入 `!started ? canceled`，而非成功或失败。
- 这是代码路径确认的状态映射缺陷，尚未进行真实模型重试的浏览器端到端复现。
- 建议：用工作流 runId 加独立的 attemptId 判断执行身份；不要用显示用时间戳作为轮次标识。补充失败后重试成功、刷新恢复及用户取消三类桥接测试。

## 节点覆盖表

“通用编辑”指读取、改标题/metadata、移动、缩放、删除、连接等图操作，不包含任意点击插件内部 UI。

| 节点类型 | Agent 创建 | 已有节点通用编辑 | 标准生成/工作流 | 输入资源 |
| --- | --- | --- | --- | --- |
| text | 支持 | 支持 | 本身是资源，不是调度执行节点 | 文本 |
| image | 支持、附件导入支持 | 支持 | 作为输入/输出，生成由配置节点驱动 | 图片 |
| config | 支持 | 支持 | 支持文本/图片模式 | 参数及连接关系 |
| group | 支持 | 支持 | 布局分组，不执行 | 非生成资源 |
| builtin:crop | 专用 image operation 工具 | 支持 | 已接入 | 图片输入/输出 |
| builtin:split | 专用 image operation 工具 | 支持 | 已接入 | 图片输入/多输出 |
| builtin:upscale | 专用 image operation 工具 | 支持 | 已接入 | 图片输入/输出 |
| builtin:angle | 专用 image operation 工具 | 支持 | 已接入，依赖实际模型配置 | 图片输入/输出 |
| builtin:reverse-prompt | 专用 image operation 工具 | 支持 | 已接入，依赖实际模型配置 | 图片输入/文本输出 |
| markdown:doc | schema 未覆盖 | 通用内容编辑可用 | 无专用执行器 | 声明文本 resource |
| svg:vector | schema 未覆盖 | 通用内容编辑可用 | 渲染节点，非执行节点 | 未声明 resource |
| html:render | schema 未覆盖 | 通用内容编辑可用 | 沙箱渲染节点，非执行节点 | 未声明 resource |
| panorama:viewer | schema 未覆盖 | 通用编辑可用 | 人工生成支持；标准 Agent/工作流缺失 | 声明图片 resource |
| sticky-note:note | schema 未覆盖 | 通用内容/颜色编辑可用 | 注释节点，非执行节点 | 未声明 resource |
| video / audio | 当前禁用 | 历史数据不可视为完整支持 | 开关禁用，不应宣称可用 | 类型接口存在 |

视频/音频开关见 `apps/web-react/src/canvas/constant/canvas.ts:14`。资源接入依据 `canvas-resource-references.ts:151` 和各插件 resource 声明。显示节点没有执行器不一定是缺陷，但应在产品能力表里明确区分“可编辑”“可作为输入”“可运行”。

## Agent 能力与权限现状

- 工具已覆盖状态/选区查询、视觉检查、图操作、工作流校验、运行预检、停止/恢复/重试、生成状态、历史/检查点、模板、附件与站内导航。
- 删除和恢复等高风险工具会要求确认；用户可开启其他写工具逐次确认。批准后重新核验活动画布和待处理请求（`hosted-agent-panel.tsx:773`）。
- 运行与发起画布绑定，旧画布的迟到响应会被作用域检查阻止；不是通用操作系统 Agent，也不是任意插件 UI 自动化工具。
- Agent 检查点和事务历史只存在 hook 的 ref 中（`use-agent-bridge.ts:60`、`:308`），刷新后不可恢复；与会持久化的工作流检查点不是同一种能力。建议 UI 明确“本次页面会话”，或实现持久版本历史。
- HTML 节点使用 iframe sandbox，SVG 使用 DOMPurify；本审查没有进行完整不可信内容渗透测试，也没有证明所有媒体 URL 和工具权限组合均安全。

## 工作流现状与待完善项

1. 已有 DAG 编译、依赖层、循环和非法连接检查，以及执行前输入/模型/价格预检。
2. 已有本地检查点、云项目文档、服务端租约和进度记录。单个上游生成任务在服务端执行，但 DAG 后续调度仍主要在浏览器 `project.tsx` 内；不能把它宣传成关闭浏览器后完整 DAG 自动继续运行的后端工作流引擎。
3. 已有队列停止、下游取消闭包、任务取消、输出对账和恢复。真实上游是否可取消、是否退款，应依赖后端 cancelPolicy 和对应供应商状态，不能承诺所有运行任务都立即停止。
4. 除上述缺陷外，建议优先补充租约丢失、浏览器冻结/崩溃、同账号多设备、冲突合并、部分输出失败、退款与重试的集成测试。

## 验证结果

- `npm run test:canvas-agent-graph`：107 项通过，0 失败。
- `npm run test:canvas-workflow`：66 项通过，0 失败；包含纯逻辑及源码结构断言，不能等价替代用户操作测试。
- `npm run typecheck:canvas`：通过。
- `go test ./internal/httpapi ./internal/worker -run 'Canvas|Assistant' -count=1`：两个包通过；JSON 结果统计 httpapi 142 项、worker 251 项（含子测试），0 失败、0 跳过。涉及测试环境，不调用真实收费上游。
- 无上游最小复现：图依赖改变仍匹配旧检查点；工具投递重建空缓存后执行次数变为 2。

未验证：真实模型选择与多模态能力、真实 Agent 自主完成每一种节点任务、真实供应商取消/退款、跨设备断线/崩溃端到端恢复、100+ 节点实际渲染性能、浏览器视觉回归、本地 Agent 外部桥接环境。以上结论仅适用于本次阅读时的工作区版本。

## 建议交付顺序

1. 修复工具跨刷新幂等、检查点版本校验及 Agent 运行状态身份。
2. 建立统一 NodeCapability 注册表，覆盖创建 schema、可编辑字段、资源协议、执行器、计费和取消策略。
3. 将全景等现有生成能力接入统一执行器；显示/注释节点保持非执行类型，但补齐受支持的创建和内容编辑协议。
4. 增加故障注入及浏览器端到端覆盖，再以明确测试账号和预算进行收费模型验收。
5. 若要支持真正无人值守执行，独立设计服务端 DAG 调度、租约续期、任务事件、重试策略和持久检查点，避免把浏览器心跳误认为后端调度能力。
