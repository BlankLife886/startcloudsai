/**
 * 旧「客户端状态云同步」的兼容占位：新架构下服务端任务列表就是历史记录源，
 * 本地 localStorage 只保留草稿，不再向后端推送/拉取客户端状态。
 */

export function isCloudSyncEnabled() {
  return false
}

export function getCloudSyncConflictStrategy() {
  return 'local'
}

export async function fetchClientStateQuietly() {
  return null
}

export function scheduleClientStatePushQuietly() {
  return null
}

export function shouldApplyRemoteClientState() {
  return false
}
