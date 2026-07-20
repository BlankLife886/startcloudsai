export function decodePreviewProxyUrl(url) {
  const value = String(url || '').trim()
  if (!value) return ''
  try {
    const parsed = new URL(value, window.location.origin)
    return parsed.searchParams.get('url') || value
  } catch {
    return value
  }
}

export function pickPreviewSourceImageUrl({ wallpaper, previewDisplayUrl, imageUrl }) {
  // AI 输入优先走原图/大图，避免 small 缩略图导致细节丢失和构图异常。
  const item = wallpaper || {}
  const candidates = [
    item?.raw_path,
    item?.path,
    item?.url,
    item?.raw_thumbs?.original,
    item?.thumbs?.original,
    item?.raw_thumbs?.large,
    item?.thumbs?.large,
    item?.raw_thumbnail,
    item?.thumbnail,
    previewDisplayUrl,
    imageUrl,
    item?.raw_thumbs?.small,
    item?.thumbs?.small,
  ]
    .map((url) => decodePreviewProxyUrl(url))
    .filter(Boolean)

  const picked =
    candidates.find((url) => /w\.wallhaven\.cc\/full/i.test(url)) ||
    candidates.find((url) => /th\.wallhaven\.cc\/(large|lg)/i.test(url)) ||
    candidates.find((url) => /th\.wallhaven\.cc/i.test(url) && !/\/small\//i.test(url)) ||
    candidates.find((url) => !/\/small\//i.test(url)) ||
    candidates.find((url) => /th\.wallhaven\.cc\/small/i.test(url)) ||
    candidates[0]

  if (/^https?:\/\//i.test(picked)) return picked
  return ''
}
