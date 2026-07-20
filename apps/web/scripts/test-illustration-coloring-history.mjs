import assert from 'node:assert/strict'
import { createServer } from 'vite'

globalThis.localStorage = {
  values: new Map(),
  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null
  },
  setItem(key, value) {
    this.values.set(key, String(value))
  },
  removeItem(key) {
    this.values.delete(key)
  },
}

const server = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
})

try {
  const history = await server.ssrLoadModule('/src/services/aiIllustrationColoringState.js')
  const mapper = await server.ssrLoadModule(
    '/src/features/ai-illustration-coloring/domain/mapColoringJobToHistory.js',
  )
  const wallpaperMapper = await server.ssrLoadModule(
    '/src/features/ai-wallpaper/domain/mapServerJobToTask.js',
  )
  const stability = await server.ssrLoadModule(
    '/src/features/ai-illustration-coloring/domain/coloringStability.js',
  )
  const coloringService = await server.ssrLoadModule('/src/services/aiIllustrationColoring.js')
  const legacyJsonResultUrl =
    '/api/client/business/ai/jobs/legacy-job-id/result'
  const normalizedLegacyMedia = history.normalizeColoringHistoryItem({
    id: 'legacy-json-result',
    serverJobId: 'legacy-job-id',
    status: 'completed',
    resultUrl: legacyJsonResultUrl,
    outputs: [legacyJsonResultUrl],
  })
  assert.equal(
    normalizedLegacyMedia.resultUrl,
    '',
    'JSON 结果接口不能作为图片地址持久化',
  )
  assert.deepEqual(normalizedLegacyMedia.outputs, [])
  const mappedLegacyMedia = mapper.mapColoringJobToHistory(
    {
      id: 'legacy-job-id',
      kind: 'illustration-coloring',
      status: 'completed',
      createdAt: '2026-07-09T11:43:54.000Z',
      updatedAt: '2026-07-09T11:44:54.000Z',
    },
    {
      existingItem: {
        ...normalizedLegacyMedia,
        resultUrl: legacyJsonResultUrl,
        outputs: [legacyJsonResultUrl],
      },
    },
  )
  assert.equal(mappedLegacyMedia.resultUrl, '')
  assert.equal(mappedLegacyMedia.status, 'failed')
  assert.equal(
    stability.coloringRetryMayCreatePaidRequest({
      status: 'failed',
      serverJobId: 'failed-server-job',
    }),
    true,
    '失败的服务端任务重试会重新请求上游，必须重新走费用确认',
  )
  assert.equal(
    stability.coloringRetryMayCreatePaidRequest({
      status: 'paused',
      serverJobId: 'paused-server-job',
    }),
    false,
    '暂停任务只续查原上游结果，不应重复费用确认',
  )
  assert.equal(
    stability.coloringRetryMayCreatePaidRequest({
      status: 'failed',
      statusConfidence: 'client-validation',
      serverJobId: 'client-only-job',
    }),
    false,
    '客户端校验失败会走新建任务路径，由 startColoring 统一确认费用',
  )
  const newerCreated = {
    id: 'newer-created',
    serverJobId: 'job-newer-created',
    status: 'running',
    createdAt: '2026-07-15T12:00:00.000Z',
    updatedAt: '2026-07-15T12:00:01.000Z',
  }
  const olderButRecentlyPolled = {
    id: 'older-polled',
    serverJobId: 'job-older-polled',
    status: 'running',
    createdAt: '2026-07-15T11:00:00.000Z',
    updatedAt: '2026-07-15T13:00:00.000Z',
  }

  const stable = history.mergeColoringHistory([olderButRecentlyPolled, newerCreated], [])
  assert.deepEqual(
    stable.map((item) => item.id),
    ['newer-created', 'older-polled'],
    '轮询更新时间不能改变历史展示顺序',
  )
  const clientRequestId = '11111111-1111-4111-8111-111111111111'
  const replayCreateRequest = {
    sourceUrl: 'https://app.example.test/api/ai-temp/source.png',
    clientRequestId,
    publicModelKey: 'walleven-illustration-coloring',
    batchId: 'stable-batch-id',
    variantIndex: 1,
    variantCount: 1,
    outputSize: '2k',
    outputOrientation: 'portrait',
    outputWidth: 1536,
    outputHeight: 2048,
  }
  const responseLostHistory = history.normalizeColoringHistoryItem({
      id: 'response-lost-history',
      status: 'failed',
      statusConfidence: 'create-response-unknown',
      clientRequestId,
      createRequest: replayCreateRequest,
    })
  assert.equal(
    responseLostHistory.clientRequestId,
    clientRequestId,
    '创建响应丢失后必须保留请求 UUID，重试才能取回原任务而不是重复扣费',
  )
  assert.deepEqual(
    responseLostHistory.createRequest,
    replayCreateRequest,
    '创建响应未知时必须持久化完整请求快照，不能在重试时漂移 batch/model/size',
  )
  assert.equal(stability.shouldReplayUnknownColoringCreate(responseLostHistory), true)
  assert.equal(
    stability.shouldReplayUnknownColoringCreate({
      ...responseLostHistory,
      statusConfidence: 'server-rejected',
    }),
    false,
    '服务端明确拒绝后必须开启新尝试并生成新 UUID',
  )
  assert.equal(stability.isColoringCreateOutcomeUnknown(new TypeError('fetch failed')), true)
  assert.equal(
    stability.isColoringCreateOutcomeUnknown({ responseReceived: true, httpStatus: 503 }),
    true,
  )
  assert.equal(
    stability.isColoringCreateOutcomeUnknown({ responseReceived: true, httpStatus: 400 }),
    false,
  )
  assert.equal(
    stability.isColoringCreateOutcomeUnknown({
      responseReceived: true,
      httpStatus: 409,
      apiCode: 'idempotency_request_pending',
      retryable: true,
    }),
    true,
    '幂等初始化仍在进行时必须原样重放旧请求，不能换 UUID',
  )

  const orphanRequestId = '22222222-2222-4222-8222-222222222222'
  const localOrphan = history.normalizeColoringHistoryItem({
    id: 'local-orphan-history',
    clientRequestId: orphanRequestId,
    status: 'failed',
    statusConfidence: 'create-response-unknown',
    createRequest: replayCreateRequest,
    createdAt: '2026-07-15T07:00:00.000Z',
  })
  const claimedRemote = mapper.mapColoringJobToHistory(
    {
      id: 'claimed-server-job',
      clientRequestId: orphanRequestId,
      kind: 'illustration-coloring',
      status: 'queued',
      createdAt: '2026-07-15T07:00:00.000Z',
      updatedAt: '2026-07-15T07:00:01.000Z',
    },
    { existingItem: localOrphan },
  )
  assert.equal(claimedRemote.id, localOrphan.id)
  assert.equal(claimedRemote.serverJobId, 'claimed-server-job')
  assert.equal(claimedRemote.clientRequestId, orphanRequestId)
  assert.equal(claimedRemote.createRequest.batchId, replayCreateRequest.batchId)
  const claimedHistory = history.mergeColoringHistory([claimedRemote], [localOrphan])
  assert.equal(claimedHistory.length, 1, '同 clientRequestId 的云端任务和本地 orphan 必须合并')
  assert.equal(claimedHistory[0].id, localOrphan.id)
  assert.equal(claimedHistory[0].serverJobId, 'claimed-server-job')

  const completedTerminal = {
    id: 'terminal-completed',
    serverJobId: 'job-terminal-completed',
    status: 'completed',
    resultUrl: 'https://cdn.example.com/completed.png',
    outputs: ['https://cdn.example.com/completed.png'],
    createdAt: '2026-07-15T08:00:00.000Z',
    startedAt: Date.parse('2026-07-15T08:00:10.000Z'),
    finishedAt: Date.parse('2026-07-15T08:01:00.000Z'),
    updatedAt: '2026-07-15T08:01:00.000Z',
  }
  const staleRunning = {
    ...completedTerminal,
    status: 'running',
    resultUrl: '',
    outputs: [],
    finishedAt: 0,
    updatedAt: '2026-07-15T08:00:30.000Z',
  }
  const terminalPreserved = history.mergeColoringHistory([staleRunning], [completedTerminal])[0]
  assert.equal(terminalPreserved.status, 'completed', '完成态不能被旧 running 快照降级')
  assert.equal(terminalPreserved.resultUrl, completedTerminal.resultUrl)
  const staleFailedAfterCompletion = {
    ...staleRunning,
    status: 'failed',
    error: 'late stale failure',
  }
  assert.equal(
    history.mergeColoringHistory([staleFailedAfterCompletion], [completedTerminal])[0]?.status,
    'completed',
    '完成态也不能被迟到的失败终态覆盖',
  )

  const oldFailure = {
    id: 'same-history-retry',
    serverJobId: 'same-server-job-retry',
    status: 'failed',
    error: 'old provider failure',
    createdAt: '2026-07-15T09:00:00.000Z',
    startedAt: Date.parse('2026-07-15T09:00:00.000Z'),
    finishedAt: Date.parse('2026-07-15T09:01:00.000Z'),
    updatedAt: '2026-07-15T09:01:00.000Z',
  }
  const acceptedRetry = {
    ...oldFailure,
    status: 'queued',
    statusConfidence: 'local-retry',
    error: '',
    startedAt: Date.parse('2026-07-15T09:02:00.000Z'),
    finishedAt: 0,
    updatedAt: '2026-07-15T09:02:00.000Z',
  }
  const retriedInPlace = history.mergeColoringHistory([oldFailure], [acceptedRetry])
  assert.equal(retriedInPlace.length, 1, '重试必须复用同一条历史')
  assert.equal(retriedInPlace[0]?.id, acceptedRetry.id)
  assert.equal(retriedInPlace[0]?.serverJobId, acceptedRetry.serverJobId)
  assert.equal(retriedInPlace[0]?.status, 'queued', '新一轮重试不能被旧 failed 快照覆盖')

  const mappedRetry = mapper.mapColoringJobToHistory(
    {
      id: acceptedRetry.serverJobId,
      kind: 'illustration-coloring',
      status: 'failed',
      error: 'old provider failure',
      createdAt: '2026-07-15T09:00:00.000Z',
      updatedAt: '2026-07-15T09:01:00.000Z',
    },
    { existingItem: acceptedRetry },
  )
  assert.equal(mappedRetry.id, acceptedRetry.id)
  assert.equal(mappedRetry.serverJobId, acceptedRetry.serverJobId)
  assert.equal(mappedRetry.status, 'queued', '列表刷新也必须保留刚接受的原任务重试状态')

  const mappedCompleted = mapper.mapColoringJobToHistory(
    {
      id: completedTerminal.serverJobId,
      kind: 'illustration-coloring',
      status: 'running',
      createdAt: '2026-07-15T08:00:00.000Z',
      startedAt: '2026-07-15T08:00:10.000Z',
      updatedAt: '2026-07-15T08:00:30.000Z',
    },
    { existingItem: completedTerminal },
  )
  assert.equal(mappedCompleted.status, 'completed', '列表映射不能让终态回退为运行中')
  assert.equal(mappedCompleted.resultUrl, completedTerminal.resultUrl)
  assert.equal(
    mapper.mapColoringJobToHistory(
      {
        id: completedTerminal.serverJobId,
        kind: 'illustration-coloring',
        status: 'failed',
        error: 'late stale failure',
        createdAt: '2026-07-15T08:00:00.000Z',
        updatedAt: '2026-07-15T08:00:40.000Z',
      },
      { existingItem: completedTerminal },
    ).status,
    'completed',
  )

  assert.equal(mapper.isConfirmedColoringJobCancellation(null), false)
  assert.equal(
    mapper.isConfirmedColoringJobCancellation({ cancelled: false, job: { status: 'running' } }),
    false,
    '取消接口没有确认时绝不能把任务写成已取消',
  )
  assert.equal(mapper.isConfirmedColoringJobCancellation({ cancelled: true }), true)
  assert.equal(mapper.isConfirmedColoringJobCancellation({ job: { status: 'cancelled' } }), true)
  let timeoutRetryState = mapper.nextColoringTimeoutControlRetryState(0)
  assert.deepEqual(timeoutRetryState, { failures: 1, remaining: 2, exhausted: false })
  timeoutRetryState = mapper.nextColoringTimeoutControlRetryState(timeoutRetryState.failures)
  assert.deepEqual(timeoutRetryState, { failures: 2, remaining: 1, exhausted: false })
  timeoutRetryState = mapper.nextColoringTimeoutControlRetryState(timeoutRetryState.failures)
  assert.deepEqual(timeoutRetryState, { failures: 3, remaining: 0, exhausted: true })
  assert.equal(
    mapper.resolveColoringJobPollStartedAt(
      {
        createdAt: '2026-07-15T09:00:00.000Z',
        startedAt: Date.parse('2026-07-15T09:10:00.000Z'),
      },
      Date.parse('2026-07-15T09:11:00.000Z'),
    ),
    Date.parse('2026-07-15T09:10:00.000Z'),
    '原任务重试必须按新 startedAt 计时，不能沿用旧 createdAt 立即超时',
  )

  const provisionalSyncFailure = {
    ...oldFailure,
    statusConfidence: 'provisional',
    error: '任务状态连续确认失败，后台任务未取消',
    finishedAt: Date.parse('2026-07-15T09:03:00.000Z'),
    updatedAt: '2026-07-15T09:03:00.000Z',
  }
  const recoveredRemote = {
    ...acceptedRetry,
    status: 'running',
    statusConfidence: 'server',
    updatedAt: '2026-07-15T09:04:00.000Z',
  }
  const mappedRecovered = mapper.mapColoringJobToHistory(
    {
      id: provisionalSyncFailure.serverJobId,
      kind: 'illustration-coloring',
      status: 'running',
      createdAt: '2026-07-15T09:00:00.000Z',
      startedAt: '2026-07-15T09:02:00.000Z',
      updatedAt: '2026-07-15T09:04:00.000Z',
    },
    { existingItem: provisionalSyncFailure },
  )
  assert.equal(mappedRecovered.status, 'running')
  assert.equal(mappedRecovered.statusConfidence, 'server')
  assert.equal(mappedRecovered.error, '', '远端恢复运行后必须清除临时同步失败文案')
  assert.equal(mappedRecovered.finishedAt, 0, '远端恢复运行后必须清除临时结束时间')
  assert.equal(
    history.mergeColoringHistory([recoveredRemote], [provisionalSyncFailure])[0]?.status,
    'running',
    '临时状态同步失败必须允许被后续远端事实纠正',
  )
  assert.equal(mapper.isActiveColoringJobStatus('running'), true)
  assert.equal(mapper.isActiveColoringJobStatus('waiting_provider'), true)
  assert.equal(
    mapper.isTerminalColoringJobStatus('paused'),
    true,
    '暂停任务是等待人工恢复的稳定终态，页面恢复时不能继续自动轮询',
  )
  assert.equal(
    mapper.isActiveColoringJobStatus('paused'),
    false,
    '暂停任务不能占用运行并发槽或锁死编辑界面',
  )

  const pausedSnapshot = {
    id: 'paused-history',
    serverJobId: 'paused-server-job',
    status: 'paused',
    statusConfidence: 'server',
    error: '上游结果需人工确认',
    createdAt: '2026-07-15T10:00:00.000Z',
    startedAt: Date.parse('2026-07-15T10:00:00.000Z'),
    finishedAt: Date.parse('2026-07-15T10:10:00.000Z'),
    updatedAt: '2026-07-15T10:10:00.000Z',
  }
  const staleWaitingAfterPause = {
    ...pausedSnapshot,
    status: 'waiting_provider',
    error: '',
    finishedAt: 0,
    updatedAt: '2026-07-15T10:09:00.000Z',
  }
  assert.equal(
    history.mergeColoringHistory([staleWaitingAfterPause], [pausedSnapshot])[0]?.status,
    'paused',
    '历史恢复不能让已暂停任务被迟到的 waiting_provider 快照重新激活',
  )
  const mappedPaused = mapper.mapColoringJobToHistory(
    {
      id: pausedSnapshot.serverJobId,
      kind: 'illustration-coloring',
      status: 'waiting_provider',
      createdAt: pausedSnapshot.createdAt,
      startedAt: '2026-07-15T10:00:00.000Z',
      updatedAt: '2026-07-15T10:09:00.000Z',
    },
    { existingItem: pausedSnapshot },
  )
  assert.equal(mappedPaused.status, 'paused', '列表映射也必须保留更新的暂停快照')

  const manuallyResumed = {
    ...pausedSnapshot,
    status: 'queued',
    statusConfidence: 'local-retry',
    error: '',
    startedAt: Date.parse('2026-07-15T10:11:00.000Z'),
    finishedAt: 0,
    updatedAt: '2026-07-15T10:11:00.000Z',
  }
  assert.equal(
    history.mergeColoringHistory([manuallyResumed], [pausedSnapshot])[0]?.status,
    'queued',
    '用户手动恢复产生的新一轮任务必须允许离开暂停终态',
  )

  assert.equal(
    wallpaperMapper.isConfirmedServerJobCancellation({
      cancelled: false,
      job: { status: 'paused' },
    }),
    false,
    '壁纸任务未被服务端确认取消时不能假取消',
  )
  assert.equal(
    wallpaperMapper.isConfirmedServerJobCancellation({
      cancelled: true,
      job: { status: 'cancelled' },
    }),
    true,
  )
  assert.equal(
    wallpaperMapper.shouldKeepExistingTaskSnapshot('completed', 'failed'),
    true,
    '已完成壁纸不能被迟到的失败快照覆盖',
  )
  assert.equal(
    wallpaperMapper.shouldKeepExistingTaskSnapshot('failed', 'running'),
    true,
    '壁纸终态不能被迟到的运行快照覆盖',
  )

  const failed = {
    id: 'failed-item',
    serverJobId: 'job-failed-item',
    status: 'failed',
    error: 'provider timeout',
    createdAt: '2026-07-15T10:00:00.000Z',
  }
  history.writeColoringHistory([failed])
  assert.equal(history.readColoringHistory()[0]?.status, 'failed')

  history.markColoringJobDeleted(failed.serverJobId)
  assert.equal(history.readColoringHistory().length, 0)
  const restored = history.mergeColoringHistory([failed], [])
  assert.equal(restored[0]?.id, failed.id)
  assert.equal(history.readDeletedColoringJobIds().includes(failed.serverJobId), false)

  const staleBlob = 'blob:http://localhost:3102/stale-object-url'
  const durableSource = 'https://cdn.example.com/source.png'
  const durableResult = 'https://cdn.example.com/result.png'
  history.writeColoringHistory([
    {
      id: 'stale-media',
      serverJobId: 'job-stale-media',
      sourceRemoteUrl: staleBlob,
      sourcePreview: durableSource,
      sourceThumbUrl: staleBlob,
      referenceImageUrls: [staleBlob, durableSource],
      referenceThumbUrls: [staleBlob, 'data:image/png;base64,dGh1bWI='],
      resultUrl: staleBlob,
      resultRemoteUrl: durableResult,
      resultThumbUrl: staleBlob,
      outputs: [staleBlob, durableResult],
      createdAt: '2026-07-15T14:00:00.000Z',
    },
  ])
  const sanitized = history.readColoringHistory()[0]
  assert.equal(sanitized.sourceRemoteUrl, durableSource)
  assert.equal(sanitized.sourcePreview, durableSource)
  assert.equal(sanitized.sourceThumbUrl, '')
  assert.deepEqual(sanitized.referenceImageUrls, [durableSource])
  assert.deepEqual(sanitized.referenceThumbUrls, ['data:image/png;base64,dGh1bWI='])
  assert.equal(sanitized.resultRemoteUrl, durableResult)
  assert.equal(sanitized.resultUrl, durableResult)
  assert.equal(sanitized.resultThumbUrl, '')
  assert.deepEqual(sanitized.outputs, [durableResult])
  assert.equal(JSON.stringify(sanitized).includes('blob:'), false)

  history.writeColoringDraft({
    sourceRemoteUrl: staleBlob,
    sourcePreview: staleBlob,
    resultUrl: staleBlob,
    referenceImageUrls: [staleBlob, durableSource],
  })
  const sanitizedDraft = history.readColoringDraft()
  assert.equal(sanitizedDraft.sourceRemoteUrl, '')
  assert.equal(sanitizedDraft.sourcePreview, '')
  assert.equal(sanitizedDraft.resultUrl, '')
  assert.deepEqual(sanitizedDraft.referenceImageUrls, [durableSource])

  const providerPollUrl = 'https://provider.example.com/api/v3/predictions/task-1'
  const completedWithoutImage = mapper.mapColoringJobToHistory({
    id: 'completed-without-image',
    kind: 'illustration-coloring',
    status: 'completed',
    providerResultUrl: providerPollUrl,
    createdAt: '2026-07-15T15:00:00.000Z',
    updatedAt: '2026-07-15T15:01:00.000Z',
  })
  assert.equal(
    completedWithoutImage.status,
    'failed',
    '服务商 completed 但只有 JSON 轮询地址时必须在本地转为失败态',
  )
  assert.equal(completedWithoutImage.statusConfidence, 'client-validation')
  assert.equal(completedWithoutImage.resultUrl, '')
  assert.deepEqual(completedWithoutImage.outputs, [])
  assert.match(completedWithoutImage.error, /未返回可用结果图/)

  const completedWithImage = mapper.mapColoringJobToHistory({
    id: 'completed-with-image',
    kind: 'illustration-coloring',
    status: 'completed',
    providerResultUrl: providerPollUrl,
    resultMediaUrl: durableResult,
    createdAt: '2026-07-15T15:00:00.000Z',
    updatedAt: '2026-07-15T15:01:00.000Z',
  })
  assert.equal(completedWithImage.status, 'completed')
  assert.equal(completedWithImage.resultUrl, durableResult)
  assert.deepEqual(completedWithImage.outputs, [durableResult])

  const upstreamUnknown = mapper.mapColoringJobToHistory(
    {
      id: 'upstream-unknown',
      kind: 'illustration-coloring',
      status: 'waiting_provider',
      createdAt: '2026-07-15T15:00:00.000Z',
      updatedAt: '2026-07-15T15:11:00.000Z',
    },
    {
      existingItem: {
        id: 'upstream-unknown-local',
        serverJobId: 'upstream-unknown',
        status: 'waiting_provider',
        statusConfidence: 'upstream-unknown',
        error: '上游结果状态暂时未知，系统会继续查询原任务，请勿重复提交。',
        createdAt: '2026-07-15T15:00:00.000Z',
      },
    },
  )
  assert.equal(upstreamUnknown.status, 'waiting_provider')
  assert.equal(upstreamUnknown.statusConfidence, 'upstream-unknown')
  assert.match(upstreamUnknown.error, /继续查询原任务/)

  assert.equal(coloringService.COLORING_JOB_MAX_WAIT_MS, 10 * 60 * 1000)
  assert.equal(coloringService.COLORING_JOB_POLL_INTERVAL_MS, 3 * 1000)
  assert.equal(
    coloringService.COLORING_JOB_MAX_POLLS,
    Math.ceil(
      coloringService.COLORING_JOB_MAX_WAIT_MS / coloringService.COLORING_JOB_POLL_INTERVAL_MS,
    ),
  )
  assert.equal(
    stability.formatColoringErrorText('x'.repeat(500)).length,
    stability.COLORING_ERROR_TEXT_MAX_LENGTH + 1,
    '页面错误文案必须限制长度并追加省略号',
  )
  const gptsImageFetchFailure =
    'gpt-image-2 处理失败：success ; stage=provider_poll_failed ; endpoint=https://api.gptsapi.net/api/v3/predictions/task-1/result ; providerStatus=failed ; providerMessage=success ; keys=code|data|message ; bodyPreview={"code":200,"data":{"created_at":"2026-07-16 01:12:59","error":"Image fetch failed. Check access settings or use our File Upload API instead.","outputs":['
  const gptsImageFetchMessage = stability.formatColoringErrorText(gptsImageFetchFailure)
  assert.equal(gptsImageFetchMessage, '上游无法读取源图，请重新上传后重试')
  for (const internalToken of [
    'stage=',
    'endpoint=',
    'providerStatus=',
    'providerMessage=',
    'keys=',
    'bodyPreview=',
    'api.gptsapi.net',
  ]) {
    assert.equal(
      gptsImageFetchMessage.includes(internalToken),
      false,
      `用户错误文案不得暴露内部诊断字段：${internalToken}`,
    )
  }
  assert.equal(
    stability.formatColoringErrorText(
      'AI provider 未返回图片或结果查询地址 ; stage=parse_media_output ; endpoint=/images/edits ; bodyPreview={}',
    ),
    '服务商未返回可用结果图，请重试',
  )
  assert.equal(
    stability.formatColoringErrorText(
      '未知上游失败 ; stage=provider_poll_failed ; endpoint=https://provider.example/task/1 ; keys=data|message',
    ),
    '生图服务处理失败，请稍后重试',
  )
  assert.equal(
    stability.formatColoringErrorText(
      '任务失败 ; bodyPreview={"error":"上游内部异常，详情 https://private.example/task/secret"}',
    ),
    '上游处理失败，请稍后重试',
    '未识别的中文上游错误也不得把 bodyPreview 或 URL 暴露给用户',
  )
  const pausedDiagnosticMessage = stability.formatColoringErrorText(
    '任务执行节点失联，已暂停原任务 ; origin=queue ; stage=our_worker_stale ; endpoint=https://provider.example/tasks/paid-task-1',
  )
  assert.equal(pausedDiagnosticMessage, '生图服务处理失败，请稍后重试')
  for (const internalToken of ['origin=', 'stage=', 'endpoint=', 'provider.example']) {
    assert.equal(
      pausedDiagnosticMessage.includes(internalToken),
      false,
      `暂停态用户文案不得暴露内部诊断字段：${internalToken}`,
    )
  }
  assert.equal(
    stability.isUsableColoringImageMeta({ type: 'application/json', bytes: 1024 }),
    false,
  )
  assert.equal(stability.isUsableColoringImageMeta({ type: 'image/png', bytes: 1024 }), true)

  const headCalls = []
  const reusableTempUrl = 'https://app.example.com/api/ai-temp/source-1'
  assert.equal(
    await stability.validateReusableAiTempImageUrl(reusableTempUrl, {
      fetchImpl: async (url, options) => {
        headCalls.push({ url, options })
        return {
          ok: true,
          headers: { get: (name) => (name === 'content-type' ? 'image/webp' : '') },
        }
      },
    }),
    true,
  )
  assert.equal(headCalls[0]?.options?.method, 'HEAD')
  assert.equal(headCalls[0]?.options?.cache, 'no-store')
  assert.equal(
    await stability.validateReusableAiTempImageUrl(reusableTempUrl, {
      fetchImpl: async () => ({
        ok: true,
        headers: { get: () => 'application/json' },
      }),
    }),
    false,
    'HEAD 返回 JSON 时不能复用为源图',
  )
  assert.equal(
    await stability.validateReusableAiTempImageUrl(reusableTempUrl, {
      fetchImpl: async () => ({ ok: false, headers: { get: () => 'image/png' } }),
    }),
    false,
    '过期临时图必须触发本地重新上传',
  )

  const recoveredReferenceUrl = 'https://app.example.com/api/ai-temp/reference-reuploaded'
  const localReferenceData = 'data:image/png;base64,bG9jYWwtcmVmZXJlbmNl'
  const checkedReferenceUrls = []
  const reusableReference = await stability.resolveReusableAiTempImageUrl(reusableTempUrl, {
    validateUrl: async (url) => {
      checkedReferenceUrls.push(url)
      return true
    },
    recoveryCandidates: [localReferenceData],
    reuploadLocalSource: async () => {
      throw new Error('有效参考图不应重新上传')
    },
  })
  assert.deepEqual(reusableReference, {
    url: reusableTempUrl,
    reused: true,
    recovered: false,
    expired: false,
  })
  assert.deepEqual(checkedReferenceUrls, [reusableTempUrl], '参考图复用前必须先执行 HEAD 探活')

  const reuploadedSources = []
  const recoveredReference = await stability.resolveReusableAiTempImageUrl(reusableTempUrl, {
    validateUrl: async () => false,
    recoveryCandidates: [reusableTempUrl, localReferenceData],
    reuploadLocalSource: async (source) => {
      reuploadedSources.push(source)
      return recoveredReferenceUrl
    },
  })
  assert.deepEqual(recoveredReference, {
    url: recoveredReferenceUrl,
    reused: false,
    recovered: true,
    expired: true,
  })
  assert.deepEqual(
    reuploadedSources,
    [localReferenceData],
    '参考图 ai-temp 过期后只能用本地图片数据重新上传，不能读取原 410 地址',
  )

  const unavailableReference = await stability.resolveReusableAiTempImageUrl(reusableTempUrl, {
    validateUrl: async () => false,
    recoveryCandidates: [reusableTempUrl, 'https://cdn.example.com/not-local.png'],
    reuploadLocalSource: async () => {
      throw new Error('不应尝试上传远程候选')
    },
  })
  assert.deepEqual(unavailableReference, {
    url: '',
    reused: false,
    recovered: false,
    expired: true,
  })
  assert.notEqual(
    unavailableReference.url,
    reusableTempUrl,
    '参考图过期且无本地数据时必须明确失败，不能把 410 URL 发送给上游',
  )

  console.log('illustration coloring history tests passed')
} finally {
  await server.close()
}
