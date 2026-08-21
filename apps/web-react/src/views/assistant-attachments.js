export function isPSDFile(file) {
  const name = String(file?.name || "").trim().toLowerCase();
  const type = String(file?.type || "").trim().toLowerCase();
  return name.endsWith(".psd") || type === "image/vnd.adobe.photoshop" || type === "image/x-photoshop";
}

export function assistantClipboardFiles(clipboardData) {
  if (!clipboardData) return [];
  const out = [];
  const seen = new Set();
  const add = (file) => {
    if (!file) return;
    const key = [file.name || "", file.type || "", file.size || 0, file.lastModified || 0].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };
  for (const file of Array.from(clipboardData.files || [])) add(file);
  for (const item of Array.from(clipboardData.items || [])) {
    if (item?.kind === "file" && typeof item.getAsFile === "function") add(item.getAsFile());
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
