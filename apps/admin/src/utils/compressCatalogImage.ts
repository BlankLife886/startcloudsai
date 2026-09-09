const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_TARGET_RATIO = 0.1;
const DEFAULT_THRESHOLD_BYTES = 1024 * 1024;
const MIN_TARGET_BYTES = 12 * 1024;
const MAX_INPUT_BYTES = 80 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_INPUT_PIXELS = 60_000_000;
const MAX_INITIAL_EDGE = 3200;
const MIN_OUTPUT_EDGE = 480;
const MIN_QUALITY = 0.16;
const MAX_QUALITY = 0.88;
const QUALITY_STEPS = 7;
const RESIZE_FACTOR = 0.82;

export interface CatalogCompressionResult {
  file: File;
  compressed: boolean;
  originalBytes: number;
  compressedBytes: number;
  targetBytes: number;
  ratio: number;
  width: number;
  height: number;
  quality: number;
  targetReached: boolean;
}

export interface CatalogCompressionOptions {
  targetRatio?: number;
  thresholdBytes?: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

interface EncodedCandidate {
  blob: Blob;
  width: number;
  height: number;
  quality: number;
}

function outputName(name: string) {
  const stem = String(name || "ecommerce-catalog")
    .replace(/\.[^.]+$/, "")
    .trim();
  return `${stem || "ecommerce-catalog"}.webp`;
}

export function formatCatalogBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  }

  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  try {
    image.src = url;
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function encodeWebp(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob || blob.type !== "image/webp") {
          reject(new Error("当前浏览器不支持 WebP 压缩"));
          return;
        }
        resolve(blob);
      },
      "image/webp",
      quality,
    );
  });
}

function nextDimensions(width: number, height: number, minimumEdge: number) {
  const longEdge = Math.max(width, height);
  const nextLongEdge = Math.max(minimumEdge, Math.round(longEdge * RESIZE_FACTOR));
  const scale = nextLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function compressCatalogImage(
  file: File,
  options: CatalogCompressionOptions = {},
): Promise<CatalogCompressionResult> {
  if (!SUPPORTED_TYPES.has(file.type)) {
    throw new Error("仅支持 PNG、JPG 或 WebP 图片");
  }
  if (!file.size) throw new Error("图片文件为空");
  if (file.size > MAX_INPUT_BYTES) throw new Error("原图不能超过 80MB");

  const targetRatio = Math.min(
    0.95,
    Math.max(0.01, Number(options.targetRatio) || DEFAULT_TARGET_RATIO),
  );
  const thresholdBytes = Math.max(
    0,
    Number(options.thresholdBytes) || DEFAULT_THRESHOLD_BYTES,
  );
  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error("无法读取图片尺寸");
    if (decoded.width * decoded.height > MAX_INPUT_PIXELS) {
      throw new Error("图片像素过大，请先缩小到 6000 万像素以内");
    }
    if (file.size <= thresholdBytes) {
      return {
        file,
        compressed: false,
        originalBytes: file.size,
        compressedBytes: file.size,
        targetBytes: file.size,
        ratio: 1,
        width: decoded.width,
        height: decoded.height,
        quality: 1,
        targetReached: true,
      };
    }

    const targetBytes = Math.min(
      MAX_OUTPUT_BYTES,
      Math.max(MIN_TARGET_BYTES, Math.round(file.size * targetRatio)),
    );
    const originalLongEdge = Math.max(decoded.width, decoded.height);
    const initialScale = Math.min(1, MAX_INITIAL_EDGE / originalLongEdge);
    let width = Math.max(1, Math.round(decoded.width * initialScale));
    let height = Math.max(1, Math.round(decoded.height * initialScale));
    const minimumEdge = Math.min(originalLongEdge, MIN_OUTPUT_EDGE);
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("浏览器无法创建图片压缩画布");

    let smallest: EncodedCandidate | null = null;
    for (let resizeStep = 0; resizeStep < 14; resizeStep += 1) {
      canvas.width = width;
      canvas.height = height;
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(decoded.source, 0, 0, width, height);

      let low = MIN_QUALITY;
      let high = MAX_QUALITY;
      let bestUnderTarget: EncodedCandidate | null = null;
      for (let qualityStep = 0; qualityStep < QUALITY_STEPS; qualityStep += 1) {
        const quality = (low + high) / 2;
        const blob = await encodeWebp(canvas, quality);
        const candidate = { blob, width, height, quality };
        if (!smallest || blob.size < smallest.blob.size) smallest = candidate;
        if (blob.size <= targetBytes) {
          bestUnderTarget = candidate;
          low = quality;
        } else {
          high = quality;
        }
      }

      if (bestUnderTarget) {
        smallest = bestUnderTarget;
        break;
      }
      if (Math.max(width, height) <= minimumEdge) break;
      const next = nextDimensions(width, height, minimumEdge);
      if (next.width === width && next.height === height) break;
      width = next.width;
      height = next.height;
    }

    if (!smallest) throw new Error("WebP 压缩失败，请重新选择图片");
    const compressedFile = new File([smallest.blob], outputName(file.name), {
      type: "image/webp",
      lastModified: Date.now(),
    });
    if (compressedFile.size > MAX_OUTPUT_BYTES) {
      throw new Error("图片压缩后仍超过 8MB，请降低目标比例或更换原图");
    }
    return {
      file: compressedFile,
      compressed: true,
      originalBytes: file.size,
      compressedBytes: compressedFile.size,
      targetBytes,
      ratio: compressedFile.size / file.size,
      width: smallest.width,
      height: smallest.height,
      quality: smallest.quality,
      targetReached: compressedFile.size <= targetBytes,
    };
  } finally {
    decoded.release();
  }
}
