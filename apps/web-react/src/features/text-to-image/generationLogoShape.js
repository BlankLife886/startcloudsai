// The reference is only sampled offscreen. The visible logo consists of particles.
let shape = null;
let pending = null;
const STRIDE = 6;

export function sampleLogoShape(data, width, height) {
  const samples = [];
  const lightAt = (x, y) => {
    const i = (Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))) * 4;
    return (data[i] * 0.24 + data[i + 1] * 0.56 + data[i + 2] * 0.2) / 255;
  };
  for (let y = 1; y < height - 1; y += 2) for (let x = 1; x < width - 1; x += 2) {
    const i = (y * width + x) * 4;
    const light = lightAt(x, y);
    if (data[i + 3] < 128 || light < 0.17) continue;
    const depth = Math.min(1, Math.max(0, (light - 0.17) / 0.7));
    samples.push((x + 0.5) / width, (y + 0.5) / height, depth,
      Math.max(-1, Math.min(1, (lightAt(x + 2, y) - lightAt(x - 2, y)) * 3)),
      Math.max(-1, Math.min(1, (lightAt(x, y + 2) - lightAt(x, y - 2)) * 3)),
      0.4 + depth * 0.6);
  }
  const points = new Float32Array(samples);
  return { width, height, points, count: points.length / STRIDE, bytes: points.byteLength };
}

export function loadGenerationLogoShape() {
  if (shape) return Promise.resolve(shape);
  if (!pending) pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      try {
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Logo sampling unavailable");
        context.drawImage(image, 0, 0);
        shape = sampleLogoShape(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        resolve(shape);
      } catch (error) { reject(error); }
      finally { canvas.width = canvas.height = 1; }
    };
    image.onerror = () => reject(new Error("Logo reference unavailable"));
    image.src = "/brand/generation-logo-source.png";
  }).catch(() => { pending = null; return null; });
  return pending;
}

export const generationLogoShapeStats = () => ({ bytes: shape?.bytes || 0, points: shape?.count || 0 });

export function logoPlacement(width, height, shape) {
  const w = Math.min(width * 1.04, height * 0.76 * shape.width / shape.height, 430);
  const h = w * shape.height / shape.width;
  return { x: (width - w) / 2, y: height * 0.44 - h / 2, width: w, height: h };
}
