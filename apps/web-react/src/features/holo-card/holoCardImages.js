import { inspectAlphaPixels, inspectLineartPixels, MAX_IMAGE_PIXELS } from './holoCard.js';

export async function readCardImage(blob, { strictAlpha = false, registeredTo = null, detectAlpha = false } = {}) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw new Error('仅支持 PNG、JPG 和 WebP 图片');
  if (!blob.size || blob.size > (strictAlpha ? 50 : 15) * 1024 * 1024) throw new Error(strictAlpha ? '主体图片不能超过 50 MB' : '图片不能超过 15 MB');
  if (registeredTo && blob.type !== 'image/png') throw new Error('线稿图层必须使用 PNG');
  if (strictAlpha || blob.type === 'image/png') {
    const header = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
    if (header.length < 33 || ![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value)) {
      throw new Error('透明主体必须是真实 PNG 文件');
    }
    const view = new DataView(header.buffer);
    const width = view.getUint32(16), height = view.getUint32(20);
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452 || !width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('PNG 尺寸无效或超过 3200 万像素');
    if (strictAlpha && Math.min(width, height) < 1024) throw new Error('透明主体短边至少需要 1024 像素');
  }
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  try {
    const { width, height } = bitmap;
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('图片不能超过 3200 万像素');
    const probeAlpha = detectAlpha && blob.type === 'image/png';
    if (!strictAlpha && !registeredTo && !probeAlpha) return { width, height };
    if (registeredTo && (width !== registeredTo.width || height !== registeredTo.height)) throw new Error('线稿画布尺寸必须与透明主体完全一致');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('浏览器无法读取透明通道');
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      if (registeredTo) return inspectLineartPixels(pixels, width, height, registeredTo);
      const alphaStats = inspectAlphaPixels(pixels, width, height);
      return strictAlpha ? alphaStats : { width, height, alphaStats };
    } catch (error) {
      // Optional recognition never turns an unverified image into a subject.
      // Explicit subject/lineart imports retain their existing rejection behavior.
      if (probeAlpha && !strictAlpha && !registeredTo) return { width, height };
      throw error;
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  } finally {
    bitmap.close();
  }
}

export function downloadCardBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
