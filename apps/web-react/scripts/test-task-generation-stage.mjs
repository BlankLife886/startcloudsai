import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const vite = await createServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
})

try {
  const [{ taskToLegacyJob }, { taskSnapshotSignature }, { assistantMessageMatchesRun, messageStatus }, { ecommerceGenerationStage, ecommerceGenerationStageLabel }, { canvasNodeHasTaskId, restartCanvasNodeGeneration, shouldCancelCreatedCanvasTask }, { canvasGenerationStageLabel }] = await Promise.all([
    vite.ssrLoadModule('/src/legacy-modules/services/aiWallpaper.js'),
    vite.ssrLoadModule('/src/legacy-modules/services/tasksApi.js'),
	vite.ssrLoadModule('/src/features/assistant/domain/assistantMessages.js'),
	vite.ssrLoadModule('/src/features/ecommerce/useEcommerceJobs.js'),
    vite.ssrLoadModule('/src/canvas/lib/canvas/canvas-generation-helpers.ts'),
    vite.ssrLoadModule('/src/canvas/lib/canvas/canvas-generation-stage.ts'),
  ])
  const job = taskToLegacyJob({
    id: 'generation-stage-test',
    type: 't2i',
    status: 'running',
    generationStage: 'fetching_result',
    cancelPolicy: {
      allowed: true,
      mode: 'abandon_upstream',
      upstreamSubmitted: true,
      refunded: false,
      message: 'upstream may continue',
    },
  })

  assert.equal(job.generationStage, 'fetching_result')
  assert.deepEqual(job.cancelPolicy, {
    allowed: true,
    mode: 'abandon_upstream',
    upstreamSubmitted: true,
    refunded: false,
    message: 'upstream may continue',
  })
  const generatingSignature = taskSnapshotSignature({
    id: job.id,
    status: 'running',
    generationStage: 'upstream_generating',
    cancelPolicy: job.cancelPolicy,
  })
  const fetchingSignature = taskSnapshotSignature({
    id: job.id,
    status: 'running',
    generationStage: 'fetching_result',
    cancelPolicy: job.cancelPolicy,
  })
  assert.notEqual(
    generatingSignature,
    fetchingSignature,
    '实时任务去重必须识别 generationStage 变化',
  )
	assert.equal(messageStatus({ pending: true, kind: 'image', statusStage: 'fetching-image' }).label, '正在获取生成结果')
	assert.equal(messageStatus({ pending: true, kind: 'image', statusStage: 'saving-image' }).label, '正在保存图片')
	assert.equal(messageStatus({ pending: true, kind: 'image', statusStage: 'upstream_generating' }).label, '上游正在生成')
	assert.equal(messageStatus({ pending: true, kind: 'chat', statusStage: 'web_search' }).label, '正在联网搜索')
	assert.equal(messageStatus({ pending: true, kind: 'agent', status: 'queued', statusStage: 'routing', routing: true }).label, '正在理解你的问题')
	assert.equal(messageStatus({ pending: true, kind: 'agent', status: 'queued', statusStage: 'queued', routing: true }).label, '排队中')
	assert.equal(messageStatus({ pending: true, kind: 'chat', statusStage: 'queued' }).label, '排队中')
	assert.equal(messageStatus({ pending: true, kind: 'agent', status: 'running', statusStage: 'routing', routing: true }).label, '正在理解你的问题')
	assert.equal(assistantMessageMatchesRun({ id: 'local-message' }, 'local-message', { id: 'run-1', assistantMessageId: 'stored-message' }), true)
	assert.equal(assistantMessageMatchesRun({ id: 'stored-message', runId: 'run-1' }, 'local-message', { id: 'run-1', assistantMessageId: 'stored-message' }), true)
	const ecommerceStage = ecommerceGenerationStage([
		{ status: 'running', generationStage: 'upstream_generating' },
		{ status: 'running', generationStage: 'fetching_result' },
	])
	assert.equal(ecommerceStage, 'fetching_result')
	assert.equal(ecommerceGenerationStageLabel(ecommerceStage, true), '正在获取生成结果')
  const [tryonSource, handheldSource, detailSource, ecommerceSessionSource, assistantWorkspaceSource] = await Promise.all([
    readFile(new URL('../src/features/ecommerce/businesses/tryon/TryonBusinessWorkspace.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/ecommerce/HandheldStudio.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/features/ecommerce/DetailStudio.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/views/EcommerceBusinessSession.jsx', import.meta.url), 'utf8'),
    Promise.all([
      readFile(new URL('../src/features/assistant/assistantWorkspaceCore.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/assistant/AssistantMessageComponents.jsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/assistant/useAssistantWorkspaceController.js', import.meta.url), 'utf8'),
      readFile(new URL('../src/features/assistant/AssistantWorkspaceLayout.jsx', import.meta.url), 'utf8'),
    ]).then((parts) => parts.join('\n')),
  ])
  assert.equal(tryonSource.includes('<span>{generationStageLabel}</span>'), false, '虚拟试穿画布不应重复显示真实阶段')
  assert.ok(tryonSource.includes(': generationStageLabel\n                  : revisionReady'), '虚拟试穿底部按钮应显示真实阶段')
  assert.equal(handheldSource.includes('<em>{generationStageLabel}</em>'), false, '手持图画布不应重复显示真实阶段')
  assert.ok(handheldSource.includes('? generationStageLabel\n                          : `${shotCount}张'), '手持图底部按钮应显示真实阶段')
  assert.ok(detailSource.includes('? `已等待 ${formatSeconds(waitSeconds)}s`'), '详情页画布只显示等待时间')
  assert.equal(ecommerceSessionSource.includes('<span className="commerce-cost" role="status" aria-live="polite">'), false, 'AI 电商页头不应重复显示真实阶段')
  assert.equal(assistantWorkspaceSource.includes('className="image-generation-elapsed"'), false, 'AI 助手参数行不应重复显示生成耗时')
  assert.equal(assistantWorkspaceSource.includes('className="image-generation-stage-elapsed"'), true, 'AI 助手耗时应显示在真实流程当前阶段内')
  assert.equal(assistantWorkspaceSource.includes('status && !showImageStage'), true, 'AI 助手图片生成中不应重复显示顶部状态行')
  assert.ok(assistantWorkspaceSource.includes('className="assistant-followup-queue"'), '排队中的后续消息应只出现在输入框上方的紧凑队列')
  assert.ok(assistantWorkspaceSource.includes('hiddenQueuedMessageIds.has(message.id)'), '尚未开始的排队回合不应出现在对话线程里')
  assert.equal(assistantWorkspaceSource.includes('className="image-generation-queue"'), false, 'AI 助手图片生成中不应重复显示中间状态行')
  assert.equal(assistantWorkspaceSource.includes('className="image-generation-flow"'), false, 'AI 助手不应显示四阶段流程')
  assert.equal(assistantWorkspaceSource.includes('className="image-generation-current-stage"'), true, 'AI 助手只应显示当前真实阶段')
  assert.equal(assistantWorkspaceSource.includes('metrics.push(`耗时 ${formatDurationMs(usage.durationMs)}`)'), false, 'AI 助手完成后的生成耗时不应在顶部重复显示')
  assert.ok(assistantWorkspaceSource.includes('className="message-meta-duration"'), 'AI 助手完成后的生成耗时应只保留在消息底部')
  assert.ok(assistantWorkspaceSource.includes('className="assistant-web-sources"'), 'AI 助手联网结果必须显示独立来源区')
  assert.ok(assistantWorkspaceSource.includes('event?.tool?.name === "web_search"'), 'AI 助手必须实时接收联网工具结果')
  assert.ok(assistantWorkspaceSource.includes('className="agent-proposal-prompt-mode"'), 'AI 助手创作方案必须提供忠实执行与智能优化切换')
  assert.ok(assistantWorkspaceSource.includes('className="agent-proposal-plan"'), 'AI 助手必须显示每张图的独立生成方案')
  assert.ok(assistantWorkspaceSource.includes('imagePlanItems: (assistantMessage.imagePlanItems'), 'AI 助手必须把独立多图方案传给服务端')
  assert.ok(assistantWorkspaceSource.includes('{ id: image.id, name: image.name'), 'AI 助手必须保留参考图 ID 以支持逐图映射')
  assert.ok(assistantWorkspaceSource.includes('const retryPlanItems = responseMode === "image"'), 'AI 助手重新生成时必须保留独立多图方案')
  assert.equal(canvasGenerationStageLabel('saving_result'), '正在保存图片')
  assert.equal(canvasNodeHasTaskId({ metadata: { images: [{ id: 'slot', taskId: 'image-task' }] } }, 'image-task'), true)
  const retried = restartCanvasNodeGeneration({
    id: 'result', type: 'image', title: 'result', position: { x: 0, y: 0 }, width: 100, height: 100,
    metadata: {
      status: 'error', taskId: 'old-task', taskKind: 'image', generationStage: 'failed',
      cancelPolicy: { upstreamSubmitted: true }, executionStatus: 'failed',
      generationStartedAt: '2026-08-01T00:00:00.000Z', generationCompletedAt: '2026-08-01T00:01:00.000Z', generationDurationMs: 60000,
      images: [{ id: 'slot', status: 'error', errorDetails: 'failed', taskId: 'old-image-task', content: '', storageKey: '', naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: '' }],
    },
  }, '2026-08-29T00:00:00.000Z', 'slot')
  assert.equal(retried.metadata.generationStartedAt, '2026-08-29T00:00:00.000Z')
  assert.equal(retried.metadata.generationDurationMs, undefined)
  assert.equal(retried.metadata.taskId, undefined)
  assert.equal(retried.metadata.images[0].taskId, undefined)
  assert.equal(retried.metadata.generationStage, 'preparing')
  assert.equal(retried.metadata.executionStatus, 'running')
  assert.equal(shouldCancelCreatedCanvasTask({ node: retried, workflowControlled: false, workflowCancelQueued: true, workflowStopped: true, workflowNodeCanceled: true }), false, '手动重试不能继承已停止工作流的取消标记')
  assert.equal(shouldCancelCreatedCanvasTask({ node: retried, workflowControlled: true, workflowStopped: true }), true, '工作流任务必须服从当前工作流的停止标记')
  assert.equal(shouldCancelCreatedCanvasTask({ node: { ...retried, metadata: { ...retried.metadata, status: 'error', executionStatus: 'failed', images: retried.metadata.images.map((image) => ({ ...image, status: 'error' })) } }, workflowControlled: false }), true, '已不在运行中的节点不能保留刚创建的任务')
  console.log('task generation stage checks passed')
} finally {
  await vite.close()
}
