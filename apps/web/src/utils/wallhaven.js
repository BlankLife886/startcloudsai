/**
 * 详情接口里 uploader 可能是字符串或 { username, ... }，用于路由 /user/:username
 */
export function normalizeUploaderUsername(raw) {
  if (raw == null || raw === '') return ''
  if (typeof raw === 'object') {
    const u = raw.username ?? raw.name ?? raw.user?.username
    return u != null ? String(u).replace(/^@+/, '').trim() : ''
  }
  return String(raw).replace(/^@+/, '').trim()
}

/**
 * Wallhaven API v1 随机排序使用的 seed（文档建议 6 位字母数字）
 */
export function randomWallhavenSeed() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}
