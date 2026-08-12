function jobParams(job = {}) {
  return job?.input && typeof job.input === 'object' ? job.input : job?.params || {}
}

export function isAutomaticBackgroundRemovalJob(job = {}) {
  const params = jobParams(job)
  return params?._automatic === true && Boolean(String(params?._parentTaskId || '').trim())
}

export function inheritBackgroundRemovalPresentation(task = {}, parent = {}) {
  if (!task?.automaticBackgroundRemoval || !parent?.serverJobId) return task
  const outputIndex = Math.max(0, Number(task.parentOutputIndex || 0))
  const parentOutputs = Array.isArray(parent.originalOutputs)
    ? parent.originalOutputs
    : Array.isArray(parent.outputs)
      ? parent.outputs
      : []
  const sourceUrl = String(parentOutputs[outputIndex] || parentOutputs[0] || '').trim()
  const outputSize = parent.actualOutputSize || parent.outputSize || task.outputSize || ''

  return {
    ...task,
    sourceMode: 'background-removal',
    sourcePreview: sourceUrl || task.sourcePreview || '',
    sourceRemoteUrl: sourceUrl || task.sourceRemoteUrl || '',
    sourceLabel: '抠图原图',
    originalOutputUrl: sourceUrl || task.originalOutputUrl || '',
    userPrompt: parent.userPrompt || parent.prompt || task.userPrompt || '',
    prompt: parent.prompt || task.prompt || '',
    aspectRatio: parent.aspectRatio || task.aspectRatio,
    requestedAspectRatio: parent.requestedAspectRatio || task.requestedAspectRatio,
    outputSize,
    upstreamOutputSize: parent.upstreamOutputSize || outputSize,
    actualOutputSize: parent.actualOutputSize || task.actualOutputSize || '',
    resolutionScale: parent.resolutionScale || task.resolutionScale,
    batchId: parent.batchId || task.batchId,
    batchIndex: parent.batchIndex ?? task.batchIndex,
    batchSize: parent.batchSize || task.batchSize,
    batchCreatedAt: parent.batchCreatedAt || task.batchCreatedAt,
  }
}
