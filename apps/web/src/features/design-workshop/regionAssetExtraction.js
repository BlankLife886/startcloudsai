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
