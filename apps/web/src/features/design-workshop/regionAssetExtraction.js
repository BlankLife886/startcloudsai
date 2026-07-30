export function svgBlob(svg) {
  return new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
}

export function sanitizeGeneratedSvg(source, { title = 'UI asset' } = {}) {
  const parser = new DOMParser()
  const document = parser.parseFromString(String(source || ''), 'image/svg+xml')
  if (document.querySelector('parsererror') || document.documentElement?.localName !== 'svg') {
    throw new Error('AI 返回的 SVG 无法解析，请重新生成')
  }
  document
    .querySelectorAll('script, style, foreignObject, image, a, use, text')
    .forEach((element) => element.remove())
  document.querySelectorAll('*').forEach((element) => {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (
        name.startsWith('on') ||
        name === 'style' ||
        name === 'href' ||
        name.endsWith(':href') ||
        (value.includes('url(') && !value.includes('url(#'))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  })
  const root = document.documentElement
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  root.setAttribute('role', 'img')
  root.setAttribute('aria-label', String(title).replace(/[<>&"]/g, ''))
  if (!root.querySelector('path, rect, circle, ellipse, line, polyline, polygon')) {
    throw new Error('AI 没有返回可编辑的 SVG 矢量图形')
  }
  return new XMLSerializer().serializeToString(root)
}

export async function hasTransparency(blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  const scale = Math.min(1, 256 / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  if (!context) return false
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data
  for (let index = 3; index < data.length; index += 4) {
    if (data[index] < 250) return true
  }
  return false
}
