import { createRegionBox } from './regionOutputPolicy.js'
import { mediaIdentity } from './versionTree.js'

export function isEphemeralMediaUrl(url = '') {
  const text = String(url || '').trim()
  return !text || text.startsWith('data:') || text.startsWith('blob:')
}

export function durableMediaUrl(url = '') {
  const text = String(url || '').trim()
  return isEphemeralMediaUrl(text) ? '' : text
}

export function sameMediaIdentity(left = '', right = '') {
  const a = String(left || '').trim()
  const b = String(right || '').trim()
  if (!a || !b) return false
  return a === b || mediaIdentity(a) === mediaIdentity(b)
}

function slimNode(node = {}) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    text: node.text,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    manual: node.manual === true,
  }
}

function slimBox(box = {}) {
  return {
    id: box.id,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    marked: Array.isArray(box.marked) ? box.marked : [],
    resultUrl: durableMediaUrl(box.resultUrl),
    runId: String(box.runId || ''),
    conversationId: String(box.conversationId || ''),
    viewport: box.viewport || null,
    elements: Array.isArray(box.elements) ? box.elements.map(slimNode) : [],
  }
}

export function buildRegionProcessSnapshot(snapshot = {}) {
  const selections = (Array.isArray(snapshot.selections) ? snapshot.selections : [])
    .map(slimBox)
    .filter((box) => box.id && box.width > 0 && box.height > 0)
  return {
    outputUrl: durableMediaUrl(snapshot.outputUrl),
    selection: selections[0] || null,
    selections,
    coordinateSpace: 'image-content-v1',
    prompt: String(snapshot.prompt || ''),
    recognitionTypes: Array.isArray(snapshot.recognitionTypes) ? snapshot.recognitionTypes : [],
    editAction: String(snapshot.editAction || 'remove'),
    resultUrl: durableMediaUrl(
      snapshot.resultUrl || selections.find((item) => item.resultUrl)?.resultUrl || '',
    ),
    resultUrls: selections.map((item) => item.resultUrl).filter(Boolean),
    stage: String(snapshot.stage || ''),
    error: String(snapshot.error || ''),
    loading: Boolean(snapshot.loading),
    conversationId: String(
      snapshot.conversationId ||
        selections.find((item) => item.conversationId)?.conversationId ||
        '',
    ),
    runId: String(
      snapshot.runId ||
        selections.find((item) => item.runId && !item.resultUrl)?.runId ||
        selections.find((item) => item.runId)?.runId ||
        '',
    ),
    updatedAt: new Date().toISOString(),
  }
}

export function jobLooksLikeRegionEdit(job = {}) {
  const kind = String(job.kind || job.input?._kind || job.params?._kind || '')
    .trim()
    .toLowerCase()
  return kind === 'ui-design-region-edit'
}

function jobStatus(job = {}) {
  return String(job.status || '')
    .trim()
    .toLowerCase()
}

function jobRunId(job = {}) {
  return String(job.input?.assistantRunId || job.id || '').trim()
}

function jobParentUrl(job = {}) {
  return String(job.input?.parentOutputUrl || job.parentOutputUrl || '').trim()
}

function jobOutputUrls(job = {}) {
  const urls = job.originalMediaUrls?.length
    ? job.originalMediaUrls
    : job.resultMediaUrls || []
  return urls.map((url) => durableMediaUrl(url)).filter(Boolean)
}

export function assistantRunsToRegionJobs(runs = []) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => {
      const serviceKey = String(run.serviceKey || run.params?.serviceKey || '').trim()
      return !serviceKey || serviceKey === 'ui_design_asset'
    })
    .map((run) => ({
      id: run.id,
      status: run.status,
      kind: 'ui-design-region-edit',
      input: {
        _kind: 'ui-design-region-edit',
        assistantRunId: run.id,
        conversationId: run.conversationId,
        parentOutputUrl: run.parentOutputUrl || run.params?.parentOutputUrl || '',
        serviceKey: run.serviceKey || 'ui_design_asset',
      },
      originalMediaUrls: [],
    }))
}

function boxesFromJobs(jobs = [], parentUrl = '', { matchParent = false } = {}) {
  const parent = String(parentUrl || '').trim()
  const extras = []
  const seen = new Set()
  for (const job of jobs) {
    const runId = jobRunId(job)
    if (!runId || seen.has(runId)) continue
    const parentOfJob = jobParentUrl(job)
    if (matchParent && parent && parentOfJob && !sameMediaIdentity(parent, parentOfJob)) {
      continue
    }
    const box = createRegionBox(
      {
        id: `region-run-${runId}`,
        x: 0.12,
        y: 0.12,
        width: 0.76,
        height: 0.76,
        runId,
        conversationId: String(job.input?.conversationId || ''),
        resultUrl: jobOutputUrls(job)[0] || '',
      },
      extras.length,
    )
    if (!box) continue
    extras.push(box)
    seen.add(runId)
  }
  return extras
}

export function inferredParentFromRegionJobs(jobs = []) {
  const active = (Array.isArray(jobs) ? jobs : []).find(
    (job) =>
      jobLooksLikeRegionEdit(job) && ['queued', 'running'].includes(jobStatus(job)),
  )
  return jobParentUrl(active || {})
}

export function shouldContinueRegionProcess(snapshot = {}, boxes = []) {
  const list = (boxes.length ? boxes : snapshot.selections || []).filter(Boolean)
  const unfinished = list.filter((box) => !box.resultUrl)
  if (!unfinished.length) return false
  if (snapshot.loading) return true
  return unfinished.some((box) => String(box.runId || '').trim())
}

export function recoverRegionBoxesFromJobs(boxes = [], jobs = [], parentUrl = '') {
  const list = (Array.isArray(jobs) ? jobs : []).filter(jobLooksLikeRegionEdit)
  const parent = String(parentUrl || '').trim()
  const completed = list.filter((job) => ['completed', 'succeeded'].includes(jobStatus(job)))
  const active = list.filter((job) => ['queued', 'running'].includes(jobStatus(job)))

  const unused = []
  for (const job of completed) {
    const parentOfJob = jobParentUrl(job)
    if (!parent || !parentOfJob || !sameMediaIdentity(parent, parentOfJob)) continue
    for (const url of jobOutputUrls(job)) {
      unused.push({
        url,
        runId: jobRunId(job),
        conversationId: String(job.input?.conversationId || ''),
      })
    }
  }

  const taken = new Set(
    (Array.isArray(boxes) ? boxes : []).map((box) => box.resultUrl).filter(Boolean),
  )
  let cursor = 0
  let next = (Array.isArray(boxes) ? boxes : []).map((box) => {
    if (box.resultUrl) return box
    while (cursor < unused.length && taken.has(unused[cursor].url)) cursor += 1
    const hit = unused[cursor]
    if (!hit) return box
    cursor += 1
    taken.add(hit.url)
    return {
      ...box,
      resultUrl: hit.url,
      runId: box.runId || hit.runId,
      conversationId: box.conversationId || hit.conversationId,
    }
  })

  const existingRunIds = new Set(next.map((box) => box.runId).filter(Boolean))
  const attachActive = (source, options) =>
    boxesFromJobs(source, parent, options).filter((box) => {
      if (existingRunIds.has(box.runId)) return false
      existingRunIds.add(box.runId)
      return true
    })

  next = [...next, ...attachActive(active, { matchParent: Boolean(parent && next.length) })]
  if (!next.length) {
    next = attachActive(active, { matchParent: false })
  }
  return next
}
