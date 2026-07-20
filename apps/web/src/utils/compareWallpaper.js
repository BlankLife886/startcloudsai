/** 从分辨率字符串解析约简比例，如 1920x1080 → 16:9 */
export function ratioLabelFromResolution(resolution) {
  const m = String(resolution || '')
    .toLowerCase()
    .match(/(\d+)\s*[x×]\s*(\d+)/)
  if (!m) return '—'
  let w = Number(m[1])
  let h = Number(m[2])
  if (!w || !h) return '—'
  const g = gcd(w, h)
  w /= g
  h /= g
  return `${w}:${h}`
}

function gcd(a, b) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const t = y
    y = x % y
    x = t
  }
  return x || 1
}

/** 根据 path/url 猜测展示用文件类型 */
export function guessWallpaperFileType(w = {}) {
  if (w.file_type) return String(w.file_type).toUpperCase()
  const p = String(w.path || w.url || '').toLowerCase()
  if (p.includes('.png')) return 'PNG'
  if (p.includes('.webp')) return 'WebP'
  return 'JPG'
}
