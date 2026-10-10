export interface ExactSizeLimits {
  minWidth: number;
  maxWidth: number;
  minHeight: number;
  maxHeight: number;
  step: number;
  minPixels: number;
  maxPixels: number;
  maxAspectRatio: number;
}

export const DEFAULT_EXACT_SIZE_LIMITS: Readonly<ExactSizeLimits> = Object.freeze({
  minWidth: 256,
  maxWidth: 4096,
  minHeight: 256,
  maxHeight: 4096,
  step: 1,
  minPixels: 0,
  maxPixels: 0,
  maxAspectRatio: 0,
});

export function exactSizeLimits(source?: Partial<ExactSizeLimits> | null): ExactSizeLimits {
  return Object.fromEntries(
    Object.entries(DEFAULT_EXACT_SIZE_LIMITS).map(([key, fallback]) => [
      key,
      source?.[key as keyof ExactSizeLimits] == null
        ? fallback
        : Number(source[key as keyof ExactSizeLimits]),
    ]),
  ) as unknown as ExactSizeLimits;
}

export function validateExactSizeLimits(limits: ExactSizeLimits): string {
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight", "step"] as const) {
    if (!Number.isInteger(limits[key]) || limits[key] < 1 || limits[key] > 16384) {
      return "精确尺寸的宽高与步长须为 1–16384 之间的整数";
    }
  }
  if (limits.minWidth > limits.maxWidth || limits.minHeight > limits.maxHeight) {
    return "精确尺寸的最小宽高不能大于最大宽高";
  }
  for (const key of ["minPixels", "maxPixels"] as const) {
    if (!Number.isInteger(limits[key]) || limits[key] < 0 || limits[key] > 268435456) {
      return "总像素限制须为 0–268435456 之间的整数，0 表示不额外限制";
    }
  }
  if (limits.maxPixels > 0 && limits.minPixels > limits.maxPixels) {
    return "最少总像素不能大于最多总像素";
  }
  if (!Number.isFinite(limits.maxAspectRatio) || (limits.maxAspectRatio !== 0 && limits.maxAspectRatio < 1)) {
    return "最大长短边比须为不小于 1 的数字，0 表示不额外限制";
  }

  // Find a feasible height for each step-aligned width, without enumerating all pairs.
  for (let width = Math.ceil(limits.minWidth / limits.step) * limits.step; width <= limits.maxWidth; width += limits.step) {
    const minHeight = Math.max(
      limits.minHeight,
      limits.minPixels > 0 ? Math.ceil(limits.minPixels / width) : 1,
      limits.maxAspectRatio > 0 ? Math.ceil(width / limits.maxAspectRatio) : 1,
    );
    const maxHeight = Math.min(
      limits.maxHeight,
      limits.maxPixels > 0 ? Math.floor(limits.maxPixels / width) : limits.maxHeight,
      limits.maxAspectRatio > 0 ? Math.floor(width * limits.maxAspectRatio) : limits.maxHeight,
    );
    if (Math.ceil(minHeight / limits.step) * limits.step <= maxHeight) return "";
  }
  return "这些限制没有可用的精确尺寸，请调整宽高范围、步长或像素限制";
}

export function schemaSupportsExactSize(schema: Record<string, unknown> = {}, fields?: string[]): boolean {
  const properties = schema.properties as Record<string, { type?: string | string[]; enum?: unknown[] }> | undefined;
  if (!properties) return false;
  const hasType = (field: string, allowed: string[]) => {
    if (fields && !fields.includes(field)) return false;
    const type = properties[field]?.type;
    return (Array.isArray(type) ? type : [type]).some(value => value && allowed.includes(value));
  };
  if (hasType("size", ["string"])) {
    const values = properties.size?.enum;
    if (!values?.length || values.some(value => typeof value === "string" && /^[1-9][0-9]*x[1-9][0-9]*$/.test(value))) return true;
  }
  return hasType("width", ["integer", "number"]) && hasType("height", ["integer", "number"]);
}
