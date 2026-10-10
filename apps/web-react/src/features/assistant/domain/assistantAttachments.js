export function isPSDFile(file) {
  const name = String(file?.name || "").trim().toLowerCase();
  const type = String(file?.type || "").trim().toLowerCase();
  return name.endsWith(".psd") || type === "image/vnd.adobe.photoshop" || type === "image/x-photoshop";
}

const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp)$/i;

function clipboardHintType(file, hintType = "") {
  return String(file?.type || hintType || "").trim().toLowerCase();
}

export function isAssistantImageFile(file, hintType = "") {
  if (!file || isPSDFile(file)) return false;
  const type = clipboardHintType(file, hintType);
  if (type.startsWith("image/")) return true;
  return IMAGE_NAME.test(String(file.name || ""));
}

function extensionForImageType(type) {
  if (type.includes("jpeg")) return "jpg";
  if (type.includes("webp")) return "webp";
  if (type.includes("gif")) return "gif";
  if (type.includes("bmp")) return "bmp";
  return "png";
}

function normalizeClipboardFile(file, hintType = "") {
  if (!isAssistantImageFile(file, hintType)) return file;
  const type = clipboardHintType(file, hintType);
  const name = String(file.name || "").trim();
  const nextType = type || "image/png";
  const nextName = name || `paste-${Date.now()}.${extensionForImageType(nextType)}`;
  if (file.type === nextType && file.name === nextName) return file;
  return new File([file], nextName, { type: nextType, lastModified: file.lastModified || Date.now() });
}

function clipboardFileKey(file, hintType = "") {
  const type = clipboardHintType(file, hintType) || "application/octet-stream";
  return `${file.size || 0}|${type}`;
}

export function assistantClipboardFiles(clipboardData) {
  if (!clipboardData) return [];
  const out = [];
  const seen = new Set();
  const add = (file, hintType = "") => {
    if (!file) return;
    const key = clipboardFileKey(file, hintType);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalizeClipboardFile(file, hintType));
  };
  const files = Array.from(clipboardData.files || []);
  for (const file of files) add(file);
  for (const item of Array.from(clipboardData.items || [])) {
    if (item?.kind !== "file" || typeof item.getAsFile !== "function") continue;
    add(item.getAsFile(), item.type);
  }
  return out;
}

export function isImageToPSDRequest(prompt, referenceCount = 0) {
  const value = String(prompt || "").trim().toLowerCase();
  if (!value.includes("psd") || Number(referenceCount) < 1) return false;
  const compact = value.replace(/\s+/g, "");
  const chineseCommands = [
    "转成psd", "转换成psd", "转为psd", "转换为psd", "做成psd",
    "导出psd", "导出为psd", "保存为psd", "生成psd", "制作psd", "输出psd",
  ];
  if (chineseCommands.some((phrase) => compact.includes(phrase))) return true;
  return /\b(?:convert|export|save|make|create)\b[\s\S]{0,40}\b(?:to|as)\s+(?:an?\s+)?psd\b/i.test(value);
}
