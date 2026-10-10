import { zip } from "fflate";
import { fetchAuthenticatedMediaBlob } from "@react/legacy-modules/services/authenticatedMedia.js";
import notificationService from "@react/legacy-modules/services/notification.js";

// 各投放位的推荐宽度：按原图比例缩放到这个宽度，导出 JPG。
// 套图里比例不同的那张（如竖屏投放 9:16）保持自己的比例，只统一宽度。
export const HANDHELD_EXPORT_SPECS = {
  taobao: { short: "淘宝", width: 800, maxBytes: 3 * 1024 * 1024 },
  detail: { short: "详情页", width: 750, maxBytes: 3 * 1024 * 1024 },
  xhs: { short: "小红书", width: 1080, maxBytes: 10 * 1024 * 1024 },
  douyin: { short: "抖音", width: 1080, maxBytes: 10 * 1024 * 1024 },
  amazon: { short: "亚马逊", width: 1600, maxBytes: 10 * 1024 * 1024 },
  shop: { short: "独立站", width: 1080, maxBytes: 10 * 1024 * 1024 },
};

export function handheldExportSpec(platform) {
  return HANDHELD_EXPORT_SPECS[platform] || HANDHELD_EXPORT_SPECS.taobao;
}

// 模型出图只是接近标准比例（9:16 出成 940×1672），导出时对齐到标准比例
const HANDHELD_STANDARD_RATIOS = [
  [1, 1],
  [3, 4],
  [4, 5],
  [2, 3],
  [9, 16],
  [4, 3],
  [16, 9],
];

// 导出尺寸：宽度取平台推荐值，高度按原图比例（接近标准比例时取标准值）
export function handheldExportSize(platform, sourceWidth, sourceHeight) {
  const { width } = handheldExportSpec(platform);
  const w = Number(sourceWidth);
  const h = Number(sourceHeight);
  if (!(w > 0 && h > 0)) return null;
  const ratio = h / w;
  const standard = HANDHELD_STANDARD_RATIOS.find(
    ([rw, rh]) => Math.abs(rh / rw - ratio) / ratio < 0.02,
  );
  const height = standard
    ? Math.round((width * standard[1]) / standard[0])
    : Math.round(width * ratio);
  return { width, height };
}

function cleanPart(value, fallback) {
  const text = String(value || "")
    .replace(/[\\/:*?"<>|\s]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return text || fallback;
}

export function handheldExportFilename({
  productName = "",
  platform,
  index = 0,
  label = "",
  width,
  height,
}) {
  const spec = handheldExportSpec(platform);
  return [
    cleanPart(productName, "手持商品"),
    spec.short,
    `${String(index + 1).padStart(2, "0")}-${cleanPart(label, "图")}`,
    `${width}x${height}`,
  ].join("_") + ".jpg";
}

async function canvasToJpeg(canvas, maxBytes) {
  // 超过平台大小上限就逐步降低质量
  for (const quality of [0.92, 0.86, 0.8, 0.72]) {
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) break;
    if (blob.size <= maxBytes || quality === 0.72) return blob;
  }
  throw new Error("图片导出失败，请下载原图");
}

export async function renderHandheldExport(sourceBlob, platform) {
  const bitmap = await createImageBitmap(sourceBlob);
  try {
    const size = handheldExportSize(platform, bitmap.width, bitmap.height);
    if (!size) throw new Error("原图尺寸无效");
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    // JPG 没有透明通道：先铺白底，避免透明区域变黑
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // 按目标比例从中间取景（对齐标准比例时只会裁掉一两个像素）
    const scale = Math.max(size.width / bitmap.width, size.height / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(
      bitmap,
      (size.width - drawWidth) / 2,
      (size.height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
    const blob = await canvasToJpeg(canvas, handheldExportSpec(platform).maxBytes);
    return { blob, ...size };
  } finally {
    bitmap.close?.();
  }
}

function saveBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}

// items: [{ url, label, index, platform }]；一张直接下载，多张打包
export async function downloadHandheldPlatformImages(items = [], { productName = "" } = {}) {
  const sources = (Array.isArray(items) ? items : []).filter((item) => item?.url);
  if (!sources.length) throw new Error("没有可导出的图片");
  const notificationId = notificationService.addNotification({
    type: "info",
    title: "导出中",
    message: `按平台尺寸导出 ${sources.length} 张`,
    position: "bottom-right",
    duration: 0,
    closable: true,
    dedupe: false,
    download: true,
    progress: 0,
    progressKnown: true,
  });
  try {
    const files = {};
    let done = 0;
    for (const item of sources) {
      const source = await fetchAuthenticatedMediaBlob(item.url, { cache: "default" });
      const rendered = await renderHandheldExport(source, item.platform);
      let filename = handheldExportFilename({ productName, ...item, ...rendered });
      for (let suffix = 2; files[filename]; suffix += 1) {
        filename = filename.replace(/(\.jpg)$/, `-${suffix}$1`);
      }
      files[filename] = rendered.blob;
      done += 1;
      notificationService.updateNotification(notificationId, {
        message: `已导出 ${done} / ${sources.length} 张`,
        progress: Math.round((done / sources.length) * 90),
        progressKnown: true,
      });
    }
    const names = Object.keys(files);
    if (names.length === 1) {
      saveBlob(files[names[0]], names[0]);
    } else {
      const entries = {};
      for (const name of names) {
        entries[name] = new Uint8Array(await files[name].arrayBuffer());
      }
      const archive = await new Promise((resolve, reject) =>
        zip(entries, { level: 0 }, (error, data) => (error ? reject(error) : resolve(data))),
      );
      const spec = handheldExportSpec(sources[0].platform);
      saveBlob(
        new Blob([archive], { type: "application/zip" }),
        `${cleanPart(productName, "手持商品")}_${spec.short}_${names.length}张.zip`,
      );
    }
    notificationService.updateNotification(notificationId, {
      type: "success",
      title: "导出完成",
      message: `${names.length} 张已按平台尺寸保存`,
      download: false,
      progress: 100,
      progressKnown: true,
      duration: 3200,
      closable: false,
    });
    return { count: names.length };
  } catch (error) {
    notificationService.updateNotification(notificationId, {
      type: "error",
      title: "导出失败",
      message: error?.message || "按平台尺寸导出失败",
      download: false,
      progress: null,
      progressKnown: false,
      duration: 5200,
      closable: true,
    });
    throw error;
  }
}
