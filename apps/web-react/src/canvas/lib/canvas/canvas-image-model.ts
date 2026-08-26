import { normalizeGptImageOutputSize } from "@react/legacy-modules/services/aiImageOutputSize.js";
import { modelOptionMeta, type AiConfig, type ChannelModel } from "@/stores/use-config-store";

export const CANVAS_IMAGE_MAX_COUNT = 4;
export const CANVAS_IMAGE_HARD_MAX_COUNT = 16;
export const CANVAS_IMAGE_ASPECT_RATIOS = ["auto", "16:9", "9:16", "1:1", "3:2", "2:3", "5:4", "4:5", "4:3", "3:4", "21:9", "9:21"] as const;
export const CANVAS_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
export const CANVAS_IMAGE_QUALITIES = ["low", "medium", "high"] as const;

export type CanvasImageModelCapabilities = {
    aspectRatios: string[];
    aspectRatiosByResolution: Record<string, string[]>;
    resolutions: string[];
    qualities: string[];
    transparentBackground: boolean;
    maxImages: number;
};

export type CanvasImageSettings = {
    quality: string;
    size: string;
    resolution: string;
    background: string;
    count: string;
};

function normalizeList(value: unknown, allowed: readonly string[], fallback: readonly string[]) {
    const allowedSet = new Set(allowed.map((item) => item.toLowerCase()));
    const source = Array.isArray(value) ? value : fallback;
    const next = Array.from(
        new Set(
            source
                .map((item) => String(item || "").trim())
                .filter((item) => allowedSet.has(item.toLowerCase()))
                .map((item) => allowed.find((option) => option.toLowerCase() === item.toLowerCase()) || item),
        ),
    );
    return next.length ? next : Array.isArray(value) ? [] : [...fallback];
}

function normalizeQuality(value: string) {
    const quality = String(value || "").trim().toLowerCase();
    if (quality === "standard") return "medium";
    if (quality === "hd") return "high";
    return quality;
}

export function canvasImageMaxCount(model?: ChannelModel | null) {
    const raw = Number(model?.maxImages);
    if (Number.isFinite(raw) && raw >= 1) {
        return Math.min(CANVAS_IMAGE_HARD_MAX_COUNT, Math.floor(raw));
    }
    return CANVAS_IMAGE_MAX_COUNT;
}

export function canvasImageModelCapabilities(model?: ChannelModel | null): CanvasImageModelCapabilities {
    const safe: Partial<ChannelModel> = model ?? {};
    const hasConfiguredAspectRatios = Array.isArray(safe.aspectRatios);
    const globalAspectRatios = normalizeList(safe.aspectRatios, CANVAS_IMAGE_ASPECT_RATIOS, CANVAS_IMAGE_ASPECT_RATIOS);
    const resolutions = normalizeList(safe.resolutions, CANVAS_IMAGE_RESOLUTIONS, CANVAS_IMAGE_RESOLUTIONS).map((item) => item.toUpperCase());
    const sourceRatios = safe.aspectRatiosByResolution && typeof safe.aspectRatiosByResolution === "object" ? safe.aspectRatiosByResolution : {};
    const hasResolutionRules = Object.keys(sourceRatios).length > 0;
    const aspectRatiosByResolution = Object.fromEntries(
        resolutions.map((resolution) => {
            const configured = sourceRatios[resolution] || sourceRatios[resolution.toLowerCase()];
            const ratios = normalizeList(hasResolutionRules ? configured : configured || globalAspectRatios, CANVAS_IMAGE_ASPECT_RATIOS, globalAspectRatios);
            return [resolution, ratios.length ? ratios : [...globalAspectRatios]];
        }),
    );
    const configuredRatioSet = new Set(Object.values(aspectRatiosByResolution).flat());
    const aspectRatios = CANVAS_IMAGE_ASPECT_RATIOS.filter((ratio) => configuredRatioSet.has(ratio));
    return {
        aspectRatios: aspectRatios.length ? aspectRatios : hasConfiguredAspectRatios ? [] : ["1:1"],
        aspectRatiosByResolution,
        resolutions,
        qualities: normalizeList(safe.qualities, CANVAS_IMAGE_QUALITIES, CANVAS_IMAGE_QUALITIES),
        transparentBackground: safe.transparentBackground !== false,
        maxImages: canvasImageMaxCount(model),
    };
}

export function aspectRatiosForResolution(model: ChannelModel | null | undefined, resolution: string) {
    const capabilities = canvasImageModelCapabilities(model);
    const key = String(resolution || "").trim().toUpperCase();
    const configured = capabilities.aspectRatiosByResolution[key];
    return configured?.length ? configured : capabilities.aspectRatios;
}

export function parseCanvasImageSize(size: string) {
    const value = String(size || "").trim();
    if (!value || value === "auto") return { ratio: "auto" };
    const tier = value.match(/^(.*)-(1k|2k|4k)$/i);
    if (tier) return { ratio: tier[1], resolution: tier[2].toUpperCase() };
    if (value.includes(":")) return { ratio: value };
    const pixels = value.match(/^(\d+)x(\d+)$/i);
    if (!pixels) return { ratio: value };
    const width = Number(pixels[1]);
    const height = Number(pixels[2]);
    const longSide = Math.max(width, height);
    return {
        ratio: closestAspectRatio(width, height),
        resolution: longSide >= 3000 ? "4K" : longSide >= 1600 ? "2K" : "1K",
    };
}

export function canvasImageOutputSize(ratio: string, resolution: string) {
    if (!ratio || ratio === "auto") return null;
    const [rawWidth, rawHeight] = ratio.split(":").map(Number);
    if (!rawWidth || !rawHeight) return null;
    const longSide = resolution === "4K" ? 3840 : resolution === "2K" ? 2048 : 1024;
    const requested = rawWidth >= rawHeight
        ? { width: longSide, height: Math.max(1, Math.round((longSide * rawHeight) / rawWidth)) }
        : { width: Math.max(1, Math.round((longSide * rawWidth) / rawHeight)), height: longSide };
    const normalized = normalizeGptImageOutputSize(requested.width, requested.height);
    return { width: normalized.width, height: normalized.height };
}

export function canvasImageRequestSize(ratio: string, resolution: string) {
    if (!ratio || ratio === "auto") return "auto";
    const output = canvasImageOutputSize(ratio, resolution);
    return output ? `${output.width}x${output.height}` : "";
}

export function coerceCanvasImageSettings(model: ChannelModel | null | undefined, settings: Partial<CanvasImageSettings>): CanvasImageSettings {
    const capabilities = canvasImageModelCapabilities(model);
    const parsed = parseCanvasImageSize(String(settings.size || ""));
    const requestedResolution = String(settings.resolution || parsed.resolution || "").trim().toUpperCase();
    const resolution = capabilities.resolutions.includes(requestedResolution) ? requestedResolution : capabilities.resolutions[0] || "";
    const ratios = aspectRatiosForResolution(model, resolution);
    const requestedRatio = parsed.ratio || "auto";
    const size = ratios.includes(requestedRatio) ? requestedRatio : ratios[0] || "";
    const requestedQuality = normalizeQuality(String(settings.quality || ""));
    const quality = capabilities.qualities.includes(requestedQuality) ? requestedQuality : capabilities.qualities[0] || "";
    return {
        quality,
        size,
        resolution,
        background: capabilities.transparentBackground && settings.background === "transparent" ? "transparent" : "",
        count: String(Math.max(1, Math.min(capabilities.maxImages, Math.floor(Math.abs(Number(settings.count)) || 1)))),
    };
}

export function applyCanvasImageModelSettings(config: AiConfig, model?: ChannelModel | null) {
    return { ...config, ...coerceCanvasImageSettings(model ?? null, config) };
}

export function canvasImageSettingsFromModel(config: AiConfig, model: string) {
    const next = applyCanvasImageModelSettings({ ...config, model }, modelOptionMeta({ ...config, model }, model));
    return {
        model,
        quality: next.quality,
        size: next.size,
        resolution: next.resolution,
        background: next.background,
        count: Number(next.count) || 1,
    };
}

function closestAspectRatio(width: number, height: number) {
    const target = width / Math.max(1, height);
    return CANVAS_IMAGE_ASPECT_RATIOS.filter((ratio) => ratio !== "auto").reduce(
        (best, ratio) => {
            const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
            const diff = Math.abs(ratioWidth / Math.max(1, ratioHeight) - target);
            return diff < best.diff ? { ratio, diff } : best;
        },
        { ratio: "1:1", diff: Number.POSITIVE_INFINITY },
    ).ratio;
}
