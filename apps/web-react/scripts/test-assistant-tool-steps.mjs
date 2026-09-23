import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assistantToolLabel,
  assistantToolStepDetail,
  assistantToolStepsSummary,
  mergeAssistantToolSteps,
  normalizeAssistantPlan,
  normalizeAssistantToolSteps,
  summarizeAssistantToolArguments,
} from '../src/features/assistant/domain/assistantToolSteps.js'

test('a tool lifecycle collapses into one ordered step carrying its duration', () => {
  const running = mergeAssistantToolSteps([], {
    requestId: 'call-1',
    name: 'web_search',
    arguments: '{"query":"上海明天天气"}',
    status: 'running',
  }, { at: 1_000 })

  assert.equal(running.length, 1)
  assert.equal(running[0].label, '联网搜索')
  assert.equal(running[0].summary, '上海明天天气')
  assert.equal(running[0].status, 'running')
  assert.equal(running[0].durationMs, 0)

  const completed = mergeAssistantToolSteps(running, {
    requestId: 'call-1',
    name: 'web_search',
    status: 'completed',
    result: { sources: [] },
  }, { at: 3_400 })

  assert.equal(completed.length, 1, 'the completion event updates the step instead of appending a new one')
  assert.equal(completed[0].status, 'completed')
  assert.equal(completed[0].durationMs, 2_400)
  assert.equal(completed[0].summary, '上海明天天气', 'the completion event keeps the summary from the arguments')
  assert.deepEqual(completed[0].result, { sources: [] })
})

test('a late running event cannot revive a finished step', () => {
  const finished = mergeAssistantToolSteps([], {
    requestId: 'call-1',
    name: 'files_read',
    status: 'failed',
    error: '附件已过期',
  }, { at: 1_000 })

  const replayed = mergeAssistantToolSteps(finished, {
    requestId: 'call-1',
    name: 'files_read',
    status: 'running',
  }, { at: 2_000 })

  assert.equal(replayed, finished, 'a redelivered running event must not reopen a resolved step')
  assert.equal(replayed[0].status, 'failed')
  assert.equal(replayed[0].error, '附件已过期')
})

test('distinct calls stay in execution order and events without a name are ignored', () => {
  let steps = mergeAssistantToolSteps([], { requestId: 'a', name: 'web_search', status: 'completed' }, { at: 1_000 })
  steps = mergeAssistantToolSteps(steps, { requestId: 'b', name: 'files_read', status: 'running' }, { at: 1_100 })
  steps = mergeAssistantToolSteps(steps, { requestId: 'c', name: '', status: 'running' }, { at: 1_200 })

  assert.deepEqual(steps.map((step) => step.name), ['web_search', 'files_read'])
})

test('calls without a request id are keyed by name and arguments', () => {
  let steps = mergeAssistantToolSteps([], { name: 'files_read', arguments: '{"fileId":"a"}', status: 'running' }, { at: 1_000 })
  steps = mergeAssistantToolSteps(steps, { name: 'files_read', arguments: '{"fileId":"b"}', status: 'running' }, { at: 1_000 })
  assert.equal(steps.length, 2, 'different arguments are different steps')

  steps = mergeAssistantToolSteps(steps, { name: 'files_read', arguments: '{"fileId":"a"}', status: 'completed' }, { at: 1_500 })
  assert.equal(steps.length, 2, 'the same arguments resolve the existing step')
  assert.equal(steps[0].status, 'completed')
})

test('partial or unknown tool arguments degrade without throwing', () => {
  assert.equal(summarizeAssistantToolArguments('{"query":"半截的 JSON'), '', 'streamed arguments may not be parseable yet')
  assert.equal(summarizeAssistantToolArguments(''), '')
  assert.equal(summarizeAssistantToolArguments('{"count":3}'), '', 'non-string fields make no readable summary')
  assert.equal(summarizeAssistantToolArguments('{"somethingNew":"回退到第一个字符串"}'), '回退到第一个字符串')
  assert.equal(summarizeAssistantToolArguments(`{"query":"${'长'.repeat(200)}"}`).length, 73, 'long summaries are clamped with an ellipsis')
  assert.equal(assistantToolLabel('a_tool_added_later'), 'a_tool_added_later', 'unknown tools fall back to their raw name')
  assert.equal(
    summarizeAssistantToolArguments('{"model":"model-aa4b0b5f","items":[{"title":"蓝天白云","prompt":"一片开阔的蓝天"}]}', 'propose_image_action'),
    '蓝天白云',
    'image proposals summarize the picture, not the internal model id',
  )
})

test('the timeline never shows raw tool JSON to the user', () => {
  const proposalArgs = '{"model":"model-aa4b0b5f","count":1,"items":[{"title":"蓝天白云"}]}'
  assert.equal(assistantToolStepDetail({ name: 'propose_image_action', arguments: proposalArgs, result: proposalArgs }), '')
  assert.equal(assistantToolStepDetail({ name: 'propose_image_action', arguments: proposalArgs, result: { ok: true } }), '')
  assert.equal(
    assistantToolStepDetail({ name: 'propose_image_action', arguments: proposalArgs, error: '方案缺少提示词' }),
    '方案缺少提示词',
  )
  assert.equal(assistantToolStepDetail({ name: 'web_search', result: '查到三条来源。' }), '查到三条来源。')
})

test('persisted steps from message metadata normalize into the same shape', () => {
  const steps = normalizeAssistantToolSteps([
    { requestId: 'call-1', name: 'web_search', arguments: '{"query":"积分退款规则"}', status: 'completed', durationMs: 2_400 },
    { requestId: 'call-2', name: 'propose_image_action', status: 'failed', error: '解析失败' },
    { name: '', status: 'completed' },
  ])

  assert.equal(steps.length, 2)
  assert.equal(steps[0].label, '联网搜索')
  assert.equal(steps[0].summary, '积分退款规则')
  assert.equal(steps[0].durationMs, 2_400)
  assert.equal(steps[1].label, '整理图片方案')
  assert.equal(steps[1].status, 'failed')
  assert.deepEqual(normalizeAssistantToolSteps(steps), steps, 'normalizing live steps again changes nothing')
  assert.deepEqual(normalizeAssistantToolSteps(undefined), [])
})

test('the timeline summary reports progress and failures', () => {
  assert.equal(assistantToolStepsSummary([{ status: 'completed' }, { status: 'completed' }]), '2 个步骤')
  assert.equal(
    assistantToolStepsSummary([{ status: 'completed' }, { status: 'running' }, { status: 'failed' }]),
    '3 个步骤 · 1 个进行中 · 1 个失败',
  )
})

test('the workspace controller feeds every tool event into the timeline', async () => {
  const controller = await readFile(
    new URL('../src/features/assistant/useAssistantWorkspaceController.js', import.meta.url),
    'utf8',
  )

  assert.match(
    controller,
    /const toolSteps = event\?\.tool \? mergeAssistantToolSteps\(message\.toolSteps, event\.tool\) : message\.toolSteps/,
    'tool events other than a completed web search must also reach the timeline',
  )
  assert.match(controller, /\.\.\.\(toolSteps\?\.length \? \{ toolSteps \} : \{\}\)/)
  assert.match(
    controller,
    /toolSteps: message\.toolSteps\?\.length \? message\.toolSteps : persisted\?\.toolSteps/,
    'the terminal snapshot must not drop the richer streamed steps',
  )
})

test('the worker persists tool steps onto the assistant message', async () => {
  const worker = await readFile(new URL('../../server/internal/worker/assistant.go', import.meta.url), 'utf8')

  assert.match(worker, /metadata\["toolSteps"\] = steps/)
  assert.equal(
    worker.match(/attachAssistantToolSteps\(metadata, toolSteps\)/g)?.length,
    3,
    'the streaming checkpoint and both completion paths must attach the steps',
  )
  assert.match(
    worker,
    /Name: proposalTool\.Name, Arguments: string\(arguments\), Execution: "server", Status: "running"/,
    'the image proposal step needs a stream event to appear on the timeline',
  )
})

test('a plan keeps only valid steps and falls back to pending for unknown status', () => {
  const plan = normalizeAssistantPlan([
    { title: '  读取附件  ', status: 'COMPLETED' },
    { title: '联网核实', status: 'in_progress' },
    { title: '出图', status: 'nonsense' },
    { title: '   ', status: 'pending' },
  ])

  assert.deepEqual(plan, [
    { title: '读取附件', status: 'completed' },
    { title: '联网核实', status: 'in_progress' },
    { title: '出图', status: 'pending' },
  ])
})

test('a plan is capped so a runaway model cannot grow the checklist without bound', () => {
  const plan = normalizeAssistantPlan(
    Array.from({ length: 20 }, (_, index) => ({ title: `步骤 ${index}`, status: 'pending' })),
  )

  assert.equal(plan.length, 8)
  assert.deepEqual(normalizeAssistantPlan(null), [])
})

test('the plan tool has no side effects, so it must not block retries or be deduped', async () => {
  const worker = await readFile(new URL('../../server/internal/worker/assistant.go', import.meta.url), 'utf8')

  const planBranch = worker.slice(
    worker.indexOf('if next.ToolCall.Name == planTool.Name {'),
    worker.indexOf('if batch := assistantAgentParallelBatch(next)'),
  )
  assert.ok(planBranch.length > 0, 'the plan tool needs its own branch ahead of the dedup logic')
  assert.doesNotMatch(
    planBranch,
    /toolExecutionStarted = true/,
    'listing a plan must not mark the turn as having produced external output',
  )
  assert.match(worker, /attachAssistantPlan\(metadata, plan\)/)
})

test('auto approval follows the user switch, not the classifier', async () => {
  const worker = await readFile(new URL('../../server/internal/worker/assistant.go', import.meta.url), 'utf8')

  const decision = worker.slice(
    worker.indexOf('func assistantProposalAutoApprovable('),
    worker.indexOf('func (w *Worker) assistantUserAutoApproves('),
  )
  // 用户开了开关就是授权。再要求分类器也确信，等于让一个更弱的信号否决
  // “Agent 自己决定要出图”这个更强的信号，结果就是开了开关仍然出卡片。
  assert.doesNotMatch(decision, /intent\.confident/)
  assert.match(decision, /if !autoApprove \{\s*return false/)
  // 编辑已有图片是用户明确要求保留确认的操作。
  assert.match(decision, /return strings\.TrimSpace\(proposal\.Action\) == "generate"/)

  // 授权判定必须来自用户偏好，读不到时按未授权处理，不能因为查询失败就替用户花钱。
  assert.match(worker, /autoApprove := w\.assistantUserAutoApproves\(ctx, run\.UserID\)/)
  assert.match(worker, /proposal\.AutoApprovable = assistantProposalAutoApprovable\(proposal, autoApprove\)/)
})

test('a proposal leaked as plain text is turned into a proposal instead of shown to the user', async () => {
  const worker = await readFile(new URL('../../server/internal/worker/assistant.go', import.meta.url), 'utf8')

  // 模型不调工具、直接把方案 JSON 当正文输出时，没有任何人接手它：用户说了“开始做图”
  // 却一张图都没有，只看到一段 JSON。兜底必须接住这种情况。
  assert.match(worker, /assistantTextLooksLikeProposal\(result\.Text\)/)
})

test('auto-authorized proposals render no card at all', async () => {
  const components = await readFile(
    new URL('../src/features/assistant/AssistantMessageComponents.jsx', import.meta.url),
    'utf8',
  )

  // 之前的做法是把卡片渲染出来再让它自己点自己，用户还是会看到卡片闪一下。
  assert.match(components, /if \(autoApproved\) \{/)
  assert.match(components, /agent-proposal-auto/)
  // 关掉授权会从“一行凭据”切回完整卡片。收起方案的 hook 必须写在提前返回前面，
  // 否则这一下会触发 “Rendered more hooks than during the previous render”。
  const autoReturn = components.indexOf('if (autoApproved) {')
  const dismissEffect = components.indexOf('if (!message.proposal?.dismissed) return')
  assert.ok(dismissEffect > 0 && dismissEffect < autoReturn, 'dismiss cleanup hook must run before the auto-approve early return')
  // 退回卡片时必须说清楚是超预算还是自动执行失败，否则会被当成开关没生效。
  assert.match(components, /超出自动授权预算（\$\{autoApproveBudgetCents\} 积分）/)
  assert.match(components, /自动执行未成功，请确认后重试/)
})

test('a failed auto submission hands the card back instead of stranding the user', async () => {
  const components = await readFile(
    new URL('../src/features/assistant/AssistantMessageComponents.jsx', import.meta.url),
    'utf8',
  )

  // 之前 autoSubmittedRef 在调用前就锁死了，而 approveAgentProposal 有一堆早退路径：
  // 一旦命中，卡片永远不渲染、也永远不会重试，用户只剩一句“已自动开始生成”，
  // 图没有、改模型换参考图的入口也没有。
  const effect = components.slice(
    components.indexOf('const autoSubmittedRef = useRef(false)'),
    components.indexOf('const proposal = message.proposal;'),
  )
  assert.ok(effect.length > 0, 'the auto-approve effect must still exist')
  assert.match(effect, /autoSubmittedRef\.current = false/, 'a failed submission must release the one-shot lock')
  assert.match(effect, /if \(result !== "retry"\) onChange\?\.\(\{ autoFailed: true \}\)/)
  // "retry" 是暂时不能提交（本轮还在忙），不该把方案永久打回人工。
  assert.match(effect, /if \(result === true\) return/)

  const controller = await readFile(
    new URL('../src/features/assistant/useAssistantWorkspaceController.js', import.meta.url),
    'utf8',
  )
  assert.match(controller, /if \(conversationHasWork \|\| proposal\.submitting\) return "retry"/)
  assert.match(controller, /notificationService\.warning\(resolved\.blocked\)/)
  // 已经被打回人工的方案不能再自动提交，否则会反复失败刷提示。
  assert.match(controller, /proposal\.dismissed \|\| proposal\.autoFailed/)
})

test('the budget check prices the same model the order will actually use', async () => {
  const controller = await readFile(
    new URL('../src/features/assistant/useAssistantWorkspaceController.js', import.meta.url),
    'utf8',
  )

  // 预算判定和真正下单必须共用 resolveProposalRequest。分成两段各自解析模型时，
  // 一边 fallback 到 imageModels[0]、另一边 fallback 到当前选中的模型，
  // 就会按 A 模型的单价放行、按 B 模型的单价扣费。
  const autoCheck = controller.slice(
    controller.indexOf('const proposalAutoApproved = (message) =>'),
    controller.indexOf('const approveAgentProposal = async'),
  )
  assert.ok(autoCheck.length > 0, 'the auto-approval check must live next to the shared resolver')
  assert.match(autoCheck, /resolveProposalRequest\(message\)/)
  // 资格判定不能掺进“此刻忙不忙”：那会让方案卡在本轮收尾的一瞬间闪出来再消失。
  const resolver = controller.slice(
    controller.indexOf('const resolveProposalRequest = (message) =>'),
    controller.indexOf('const proposalAutoApproved = (message) =>'),
  )
  assert.ok(resolver.length > 0, 'the shared resolver must exist')
  assert.doesNotMatch(resolver, /conversationHasWork/)
  assert.match(autoCheck, /resolved\.totalCents <= assistantAutoApproveBudgetCents/)
  // 单价取不到时按未授权处理，不能当成 0 积分放行。
  assert.match(autoCheck, /!resolved\.unitCents/)

  // 组件不再自己算价，只接收结论。
  const components = await readFile(
    new URL('../src/features/assistant/AssistantMessageComponents.jsx', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(components, /imageModels\.find\(\(item\) => item\.model === candidate\.model\)/)
})

test('the server enforces the auto-approve budget, because the client price is only a hint', async () => {
  const handlers = await readFile(
    new URL('../../server/internal/httpapi/handlers_assistant_workspace.go', import.meta.url),
    'utf8',
  )

  // 预算此前只在前端把关，服务端从来没读过这一列——用户设的花费上限等于没设。
  assert.match(handlers, /AutoApproved\s+bool\s+`json:"autoApproved"`/)
  const guard = handlers.slice(
    handlers.indexOf('func assistantAutoApproveRejection('),
    handlers.indexOf('func assistantRunReservedCost('),
  )
  assert.ok(guard.length > 0, 'the auto-approve guard must exist')
  assert.match(guard, /imageCostCents > user\.AssistantAutoApproveBudgetCents/)
  // 资格只认 worker 写进消息里的那份判定，客户端说了不算。
  assert.match(guard, /proposal\["autoApprovable"\]\.\(bool\)/)
  assert.match(guard, /source\.ConversationID != conversationID/)
  assert.match(guard, /!user\.AssistantAutoApprove/)

  // 必须等最终定价（含合同折扣和价格覆盖）算完再判，否则判定金额和实际扣费对不上。
  const callSite = handlers.slice(handlers.indexOf('if body.AutoApproved {'))
  assert.ok(
    handlers.indexOf('params["_reservedCostCents"] = reservedCents\n\t\t}') < handlers.indexOf('if body.AutoApproved {'),
    'the budget check must run after contract pricing has settled',
  )
  assert.match(callSite, /assistantAutoApproveRejection\(/)
})

test('withholding the proposal tool stays regex-only, because removing it blocks real requests', async () => {
  const worker = await readFile(new URL('../../server/internal/worker/assistant.go', import.meta.url), 'utf8')

  assert.match(
    worker,
    /withholdProposal := intent\.fromFastPath && intent\.intent == "chat"/,
    'a model guess must not be enough to take the proposal tool away',
  )
  assert.match(worker, /expectProposal := intent\.intent == "image" &&/)
})

test('the queue wait stages mean the same thing on both sides of the wire', async () => {
  const router = await readFile(new URL('../../server/internal/worker/assistant_router.go', import.meta.url), 'utf8')
  const messages = await readFile(new URL('../src/features/assistant/domain/assistantMessages.js', import.meta.url), 'utf8')
  const core = await readFile(new URL('../src/features/assistant/assistantWorkspaceCore.jsx', import.meta.url), 'utf8')

  // 等额度可能要等很久。服务端把"在等什么"写进 stage，界面照着换文案；
  // 任意一边改了名字而另一边没跟上，用户就会退回到一个不动的"排队中"。
  for (const stage of ['waiting-agent-pool', 'waiting-execution-pool']) {
    assert.match(router, new RegExp(`SetAssistantRunQueuedStage\\(ctx, tx, runID, "${stage}"\\)`))
    assert.match(messages, new RegExp(`'${stage}': \\{`))
    assert.match(core, new RegExp(`'${stage}'|"${stage}"`))
  }

  // 排队不是失败，没有次数上限，所以重投必须退避，否则满载的池子会被一直空转扫描。
  assert.match(router, /RecordAssistantRunOutboxCapacityWait\(/)
  assert.doesNotMatch(router, /RecordAssistantRunOutboxFailure\(ctx, tx, runID, "waiting/)
})
