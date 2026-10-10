// 试衣上传质检：只在浏览器本地读像素，给出“可能影响出图”的提示，不拦截上传。

const MIN_SHORT_SIDE = 600;
const SAMPLE_SIZE = 64;

async function readPixels(file) {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  bitmap.close?.();
  const { data } = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  return { width, height, data };
}

// 四周一圈像素的颜色离散度：越低越接近纯色/白底背景
function borderSpread(data) {
  const samples = [];
  const push = (x, y) => {
    const index = (y * SAMPLE_SIZE + x) * 4;
    samples.push([data[index], data[index + 1], data[index + 2]]);
  };
  for (let i = 0; i < SAMPLE_SIZE; i += 2) {
    push(i, 0);
    push(i, SAMPLE_SIZE - 1);
    push(0, i);
    push(SAMPLE_SIZE - 1, i);
  }
  const mean = [0, 1, 2].map(
    (channel) =>
      samples.reduce((sum, pixel) => sum + pixel[channel], 0) / samples.length,
  );
  const variance =
    samples.reduce(
      (sum, pixel) =>
        sum +
        (pixel[0] - mean[0]) ** 2 +
        (pixel[1] - mean[1]) ** 2 +
        (pixel[2] - mean[2]) ** 2,
      0,
    ) / samples.length;
  return Math.sqrt(variance);
}

export async function inspectTryonImage(file, role) {
  if (!(file instanceof Blob) || typeof createImageBitmap !== "function") {
    return [];
  }
  let pixels;
  try {
    pixels = await readPixels(file);
  } catch {
    return [];
  }
  const hints = [];
  const shortSide = Math.min(pixels.width, pixels.height);
  if (shortSide < MIN_SHORT_SIDE) {
    hints.push(`分辨率偏低（${pixels.width}×${pixels.height}），细节可能丢失`);
  }
  if (role === "garment" || role === "bottom") {
    if (borderSpread(pixels.data) > 42) {
      hints.push("背景较杂，建议用白底/平铺/挂拍图");
    }
  }
  if (role === "model") {
    if (pixels.width > pixels.height * 1.15) {
      hints.push("横版图可能含多余排版，建议单人竖版全身照");
    }
  }
  return hints;
}
