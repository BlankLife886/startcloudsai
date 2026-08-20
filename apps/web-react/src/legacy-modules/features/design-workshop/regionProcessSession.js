import {
  getScopedLocalItem,
  removeScopedLocalItem,
  setScopedLocalItem,
} from '../../services/scopedLocalStorage.js'
import { buildRegionProcessSnapshot } from './regionProcessState.js'

export const REGION_PROCESS_KEY = 'ui-design-region-process-v1'

export {
  assistantRunsToRegionJobs,
  buildRegionProcessSnapshot,
  durableMediaUrl,
  inferredParentFromRegionJobs,
  recoverRegionBoxesFromJobs,
  shouldContinueRegionProcess,
} from './regionProcessState.js'

export function readRegionProcessSession() {
  try {
    const parsed = JSON.parse(getScopedLocalItem(REGION_PROCESS_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.outputUrl || !(parsed.selection || parsed.selections?.length)) return null
    return parsed
  } catch {
    return null
  }
}

export function writeRegionProcessSession(snapshot = {}) {
  const payload = buildRegionProcessSnapshot(snapshot)
  if (!payload.outputUrl || !payload.selections.length) return false
  if (setScopedLocalItem(REGION_PROCESS_KEY, JSON.stringify(payload))) return true
  const slimmer = {
    ...payload,
    selections: payload.selections.map((box) => ({ ...box, elements: [] })),
  }
  slimmer.selection = slimmer.selections[0] || null
  slimmer.resultUrls = slimmer.selections.map((box) => box.resultUrl).filter(Boolean)
  return setScopedLocalItem(REGION_PROCESS_KEY, JSON.stringify(slimmer))
}

export function clearRegionProcessSession() {
  removeScopedLocalItem(REGION_PROCESS_KEY)
}
