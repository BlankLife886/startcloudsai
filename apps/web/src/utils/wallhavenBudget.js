/** Wallhaven 官方建议约 45 次/分钟：用滑动窗口估算搜索调用占用 */

const WINDOW_MS = 60_000
const CAPACITY = 45
const timestamps = []

function prune(now = Date.now()) {
  while (timestamps.length && now - timestamps[0] > WINDOW_MS) {
    timestamps.shift()
  }
}

/** 每次实际发起 /search 请求前调用一次 */
export function recordWallhavenSearchWindowHit() {
  const now = Date.now()
  prune(now)
  timestamps.push(now)
}

export function getWallhavenSearchWindowUsage() {
  const now = Date.now()
  prune(now)
  const used = timestamps.length
  return {
    used,
    remaining: Math.max(0, CAPACITY - used),
    capacity: CAPACITY,
    windowMs: WINDOW_MS,
    /** 0–1，用于进度条 */
    ratio: Math.min(1, used / CAPACITY),
  }
}
