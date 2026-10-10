export const EXACT_IMAGE_SIZE_DEFAULT_LIMITS = Object.freeze({
  minWidth: 256,
  maxWidth: 4096,
  minHeight: 256,
  maxHeight: 4096,
  step: 1,
  minPixels: 0,
  maxPixels: 0,
  maxAspectRatio: 0,
});

function integerLimit(value, fallback, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return value !== null && value !== "" && Number.isSafeInteger(parsed) && parsed >= minimum
    ? Math.min(maximum, parsed)
    : fallback;
}

export function normalizeExactSizeLimits(value = {}) {
  const limits = value && typeof value === "object" ? value : {};
  const defaults = EXACT_IMAGE_SIZE_DEFAULT_LIMITS;
  const ratio = Number(limits.maxAspectRatio);
  return {
    minWidth: integerLimit(limits.minWidth, defaults.minWidth, 1, 16384),
    maxWidth: integerLimit(limits.maxWidth, defaults.maxWidth, 1, 16384),
    minHeight: integerLimit(limits.minHeight, defaults.minHeight, 1, 16384),
    maxHeight: integerLimit(limits.maxHeight, defaults.maxHeight, 1, 16384),
    step: integerLimit(limits.step, defaults.step, 1, 16384),
    minPixels: integerLimit(limits.minPixels, 0, 0),
    maxPixels: integerLimit(limits.maxPixels, 0, 0),
    maxAspectRatio: Number.isFinite(ratio) && ratio >= 1 ? ratio : 0,
  };
}

export function normalizeExactSizeCapabilities(model = {}) {
  return {
    supportsExactSize: model?.supportsExactSize === true,
    exactSizeLimits: normalizeExactSizeLimits(model?.exactSizeLimits),
  };
}

function integerDimension(value) {
  if (typeof value === "string" && !/^\d+$/.test(value.trim())) return 0;
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}

export function validateExactImageSize(model, requestedWidth, requestedHeight) {
  const { supportsExactSize, exactSizeLimits: limits } = normalizeExactSizeCapabilities(model);
  const width = integerDimension(requestedWidth);
  const height = integerDimension(requestedHeight);
  const invalid = (error) => ({ valid: false, error, width, height, size: "", params: {} });
  if (!supportsExactSize) return invalid("当前模型不支持精确尺寸，请使用比例尺寸。");
  if (!width || !height) return invalid("请输入宽度和高度的整数像素值。");
  if (width < limits.minWidth || width > limits.maxWidth) {
    return invalid(`宽度需在 ${limits.minWidth}–${limits.maxWidth} px 之间。`);
  }
  if (height < limits.minHeight || height > limits.maxHeight) {
    return invalid(`高度需在 ${limits.minHeight}–${limits.maxHeight} px 之间。`);
  }
  if (width % limits.step || height % limits.step) {
    return invalid(`宽度和高度都必须是 ${limits.step} px 的整数倍。`);
  }
  const pixels = width * height;
  if (limits.minPixels && pixels < limits.minPixels) {
    return invalid(`总像素不得少于 ${limits.minPixels.toLocaleString("zh-CN")}，当前为 ${pixels.toLocaleString("zh-CN")}。`);
  }
  if (limits.maxPixels && pixels > limits.maxPixels) {
    return invalid(`总像素不得超过 ${limits.maxPixels.toLocaleString("zh-CN")}，当前为 ${pixels.toLocaleString("zh-CN")}。`);
  }
  if (limits.maxAspectRatio && Math.max(width, height) / Math.min(width, height) > limits.maxAspectRatio) {
    return invalid(`长边与短边的比例不得超过 ${limits.maxAspectRatio}:1。`);
  }
  return {
    valid: true,
    error: "",
    width,
    height,
    size: `${width}x${height}`,
    params: { sizeMode: "exact", exactWidth: width, exactHeight: height },
  };
}

export function exactImageSizeParams(model, width, height) {
  const result = validateExactImageSize(model, width, height);
  if (!result.valid) throw new Error(result.error);
  return result.params;
}

export function initialExactImageSize(model) {
  const { supportsExactSize, exactSizeLimits: limits } = normalizeExactSizeCapabilities(model);
  if (!supportsExactSize) return { width: "", height: "" };
  const preferred = validateExactImageSize(model, 1024, 1024);
  if (preferred.valid) return { width: 1024, height: 1024 };
  const widths = [];
  for (let width = Math.ceil(limits.minWidth / limits.step) * limits.step; width <= limits.maxWidth; width += limits.step) {
    widths.push(width);
  }
  widths.sort((left, right) => Math.abs(left - 1024) - Math.abs(right - 1024));
  for (const width of widths) {
    const minHeight = Math.max(limits.minHeight,
      limits.minPixels ? Math.ceil(limits.minPixels / width) : 0,
      limits.maxAspectRatio ? Math.ceil(width / limits.maxAspectRatio) : 0);
    const maxHeight = Math.min(limits.maxHeight,
      limits.maxPixels ? Math.floor(limits.maxPixels / width) : limits.maxHeight,
      limits.maxAspectRatio ? Math.floor(width * limits.maxAspectRatio) : limits.maxHeight);
    const first = Math.ceil(minHeight / limits.step) * limits.step;
    const last = Math.floor(maxHeight / limits.step) * limits.step;
    if (first > last) continue;
    const height = Math.max(first, Math.min(last, Math.round(1024 / limits.step) * limits.step));
    if (validateExactImageSize(model, width, height).valid) return { width, height };
  }
  return { width: "", height: "" };
}
