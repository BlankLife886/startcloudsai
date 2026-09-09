import { readCardImage } from './holoCardImages.js';

export async function readCardGraphic(blob, kind, { artworkRect = { x: .1, y: .18, width: .8, height: .55 } } = {}) {
  const transparent = kind === 'frame' || kind === 'effects';
  if (transparent && blob.type !== 'image/png') throw new Error('卡框和前景装饰请使用带透明区域的 PNG。');
  // Reuse file signatures, decompression limits and orientation handling, but
  // don't impose a character's foreground coverage on decorative particles.
  const dimensions = await readCardImage(blob);
  if (transparent && Math.abs(dimensions.width / dimensions.height - 2 / 3) > .005) throw new Error('卡框和前景装饰请使用 2:3 竖版画布，例如 1024 × 1536。');
  if (!transparent) return dimensions;
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = Math.min(128, bitmap.height);
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('浏览器暂时无法检查图片透明区域。');
    let visible = 0, transparentPixels = 0, clearPixels = 0, windowPixels = 0, windowTransmission = 0;
    const window = { left: artworkRect.x * bitmap.width, right: (artworkRect.x + artworkRect.width) * bitmap.width, top: artworkRect.y * bitmap.height, bottom: (artworkRect.y + artworkRect.height) * bitmap.height };
    for (let y = 0; y < bitmap.height; y += canvas.height) {
      const rows = Math.min(canvas.height, bitmap.height - y);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, y, bitmap.width, rows, 0, 0, bitmap.width, rows);
      const pixels = context.getImageData(0, 0, bitmap.width, rows).data;
      for (let i = 3; i < pixels.length; i += 4) {
        const alpha = pixels[i], pixel = (i - 3) / 4;
        if (alpha > 0) visible++;
        if (alpha < 255) transparentPixels++;
        if (alpha <= 8) clearPixels++;
        if (kind === 'frame') {
          const x = pixel % bitmap.width, row = y + Math.floor(pixel / bitmap.width);
          if (x >= window.left && x < window.right && row >= window.top && row < window.bottom) { windowPixels++; windowTransmission += 255 - alpha; }
        }
      }
    }
    if (!visible) throw new Error('这张 PNG 完全透明，请选择含有可见装饰的图片。');
    if (!transparentPixels) throw new Error('这张 PNG 没有透明区域，会挡住人物。请导出真正透明的卡框或装饰。');
    if (clearPixels / (bitmap.width * bitmap.height) < .01) throw new Error('这张 PNG 几乎完全不透明。请清空装饰之外的背景后，再导出透明 PNG。');
    if (kind === 'frame' && (!windowPixels || windowTransmission / (windowPixels * 255) < .5)) throw new Error('这张卡框会盖住大部分人物。请在当前人物位置留出透明图窗，再导入。');
    return { ...dimensions, visiblePixels: visible, transparentPixels, clearPixels };
  } finally { bitmap.close(); canvas.width = 1; canvas.height = 1; }
}
