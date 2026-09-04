import { isCloudThumbnailUrl, isLocalImageKey, isRemoteOriginalSource, softMissingFileUrl } from "@/lib/canvas/canvas-preview-url";
import { dataUrlToBlob } from "@/lib/data-url";
import { getImageBlob } from "@/services/image-storage";

export const CANVAS_PREVIEW_MIN_EDGE = 160;
export const CANVAS_PREVIEW_MAX_EDGE = 384;
export const CANVAS_PREVIEW_QUALITY = 0.5;
export const CANVAS_PREVIEW_TYPE = "image/webp";
export const CANVAS_PREVIEW_CACHE_LIMIT = 48;
export const CANVAS_PREVIEW_CACHE_PIXEL_BUDGET = CANVAS_PREVIEW_CACHE_LIMIT * CANVAS_PREVIEW_MAX_EDGE * CANVAS_PREVIEW_MAX_EDGE;
const PREVIEW_CACHE_HARD_LIMIT = CANVAS_PREVIEW_CACHE_LIMIT * 4;
const PREVIEW_CACHE_HARD_PIXEL_BUDGET = CANVAS_PREVIEW_CACHE_PIXEL_BUDGET * 4;
const FAILED_SOURCE_TTL_MS = 60_000;

let liveScale = 1;
const scaleListeners = new Set<() => void>();

export function setCanvasPreviewScale(scale: number) {
    const next = Number.isFinite(scale) ? scale : 1;
    if (Math.abs(liveScale - next) < 0.03) return;
    liveScale = next;
    scaleListeners.forEach((listener) => listener());
}

export function subscribeCanvasPreviewScale(listener: () => void) {
    scaleListeners.add(listener);
    return () => {
        scaleListeners.delete(listener);
    };
}

export function previewEdgeForScale(scale: number, maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    const edge = scale < 0.18 ? 160 : scale < 0.4 ? 256 : CANVAS_PREVIEW_MAX_EDGE;
    return clampPreviewEdge(Math.min(maxEdge, edge));
}

export function getCanvasPreviewEdge(maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    return previewEdgeForScale(liveScale, maxEdge);
}

const inflight = new Map<string, Promise<string | undefined>>();
const blobUrls = new Map<string, string>();
const blobRefs = new Map<string, number>();
const previewPixels = new Map<string, number>();
const recent = new Set<string>();
const failedSources = new Map<string, number>();
const MAX_DOWNSCALE_JOBS = 2;
let activeJobs = 0;
let cachedPreviewPixels = 0;
let previewCacheGeneration = 0;
const downscaleQueue: Array<() => void> = [];

function runDownscaleJob<T>(work: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
        const start = () => {
            activeJobs += 1;
            work()
                .then(resolve, reject)
                .finally(() => {
                    activeJobs -= 1;
                    downscaleQueue.shift()?.();
                });
        };
        if (activeJobs < MAX_DOWNSCALE_JOBS) start();
        else downscaleQueue.push(start);
    });
}

function cacheKey(src: string, maxEdge: number) {
    return `${src}#webp=${maxEdge}@${CANVAS_PREVIEW_QUALITY}`;
}

function isTransientPreviewError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /failed to fetch|network|Preview image fetch failed: (5\d\d|408|429)/i.test(message);
}

async function loadPreviewBlob(src: string) {
    if (isRemoteOriginalSource(src)) return;
    if (isLocalImageKey(src)) return (await getImageBlob(src)) || undefined;
    if (src.startsWith("data:")) return dataUrlToBlob(src);
    const credentials = src.startsWith("blob:") ? ("omit" as const) : ("include" as const);
    const response = await fetch(softMissingFileUrl(src), { cache: "force-cache", credentials });
    const missing = response.status === 204 || response.headers.get("X-StarCloud-Media-Missing") === "1";
    if (!response.ok) {
        if (response.status === 404 && isCloudThumbnailUrl(src)) {
            if (/\/thumb\/[^/.?#]+$/.test(src)) {
                const legacy = await fetch(softMissingFileUrl(`${src}.jpg`), { cache: "force-cache", credentials });
                const legacyMissing = legacy.status === 204 || legacy.headers.get("X-StarCloud-Media-Missing") === "1";
                if (legacy.ok && !legacyMissing) return legacy.blob();
            }
            return;
        }
        throw new Error(`Preview image fetch failed: ${response.status}`);
    }
    if (missing) {
        if (/\/thumb\/[^/.?#]+$/.test(src)) {
            const legacy = await fetch(softMissingFileUrl(`${src}.jpg`), { cache: "force-cache", credentials });
            const legacyMissing = legacy.status === 204 || legacy.headers.get("X-StarCloud-Media-Missing") === "1";
            if (legacy.ok && !legacyMissing) return legacy.blob();
        }
        return;
    }
    return response.blob();
}

async function decodePreviewBitmap(blob: Blob, edge: number) {
    const bitmap = await createImageBitmap(blob);
    const longEdge = Math.max(bitmap.width, bitmap.height);
    if (longEdge <= edge) return bitmap;
    const scale = edge / longEdge;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    try {
        const next = await createImageBitmap(bitmap, {
            resizeWidth: width,
            resizeHeight: height,
            resizeQuality: "medium",
        });
        bitmap.close();
        return next;
    } catch {
        return bitmap;
    }
}

function encodePreviewBlob(canvas: HTMLCanvasElement) {
    return new Promise<Blob | null>((resolve) => {
        canvas.toBlob(
            (webp) => {
                if (webp) {
                    resolve(webp);
                    return;
                }
                canvas.toBlob(resolve, "image/jpeg", CANVAS_PREVIEW_QUALITY);
            },
            CANVAS_PREVIEW_TYPE,
            CANVAS_PREVIEW_QUALITY,
        );
    });
}

function touch(key: string) {
    recent.delete(key);
    recent.add(key);
}

function revokePreview(key: string) {
    const url = blobUrls.get(key);
    if (url) URL.revokeObjectURL(url);
    cachedPreviewPixels = Math.max(0, cachedPreviewPixels - (previewPixels.get(key) || 0));
    blobUrls.delete(key);
    blobRefs.delete(key);
    previewPixels.delete(key);
    recent.delete(key);
    inflight.delete(key);
}

function evict() {
    while (recent.size > CANVAS_PREVIEW_CACHE_LIMIT || cachedPreviewPixels > CANVAS_PREVIEW_CACHE_PIXEL_BUDGET) {
        let oldest: string | undefined;
        for (const key of recent) {
            if (!blobRefs.get(key)) {
                oldest = key;
                break;
            }
        }
        if (!oldest) {
            if (recent.size <= PREVIEW_CACHE_HARD_LIMIT && cachedPreviewPixels <= PREVIEW_CACHE_HARD_PIXEL_BUDGET) return;
            oldest = recent.keys().next().value;
        }
        if (!oldest) return;
        revokePreview(oldest);
    }
}

export function clampPreviewEdge(maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    return Math.min(CANVAS_PREVIEW_MAX_EDGE, Math.max(CANVAS_PREVIEW_MIN_EDGE, Math.round(maxEdge)));
}

export function retainPreviewUrl(url: string) {
    let retainedKey = "";
    blobUrls.forEach((value, key) => {
        if (!retainedKey && value === url) retainedKey = key;
    });
    if (!retainedKey) return () => undefined;
    blobRefs.set(retainedKey, (blobRefs.get(retainedKey) || 0) + 1);
    return () => {
        const next = (blobRefs.get(retainedKey) || 1) - 1;
        if (next <= 0) {
            blobRefs.delete(retainedKey);
            evict();
        } else blobRefs.set(retainedKey, next);
        return undefined;
    };
}

export async function buildLightweightPreview(src: string, maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    if (!src || src.startsWith("data:image/svg") || isRemoteOriginalSource(src)) return;
    const failedAt = failedSources.get(src);
    if (failedAt && Date.now() - failedAt < FAILED_SOURCE_TTL_MS) return;
    if (failedAt) failedSources.delete(src);
    const edge = clampPreviewEdge(maxEdge);
    const key = cacheKey(src, edge);
    const cached = blobUrls.get(key);
    if (cached) {
        touch(key);
        return cached;
    }
    const pending = inflight.get(key);
    if (pending) return pending;
    const generation = previewCacheGeneration;

    const task = runDownscaleJob(async () => {
        if (generation !== previewCacheGeneration) return;
        const blob = await loadPreviewBlob(src);
        if (generation !== previewCacheGeneration) return;
        if (!blob) {
            failedSources.set(src, Date.now());
            return;
        }
        const bitmap = await decodePreviewBitmap(blob, edge);
        if (generation !== previewCacheGeneration) {
            bitmap.close();
            return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, bitmap.width);
        canvas.height = Math.max(1, bitmap.height);
        const keepAlpha = blob.type === "image/png" || blob.type === "image/webp";
        const context = canvas.getContext("2d", { alpha: keepAlpha });
        if (!context) {
            bitmap.close();
            return;
        }
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "medium";
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close();
        const preview = await encodePreviewBlob(canvas);
        const pixelCount = canvas.width * canvas.height;
        canvas.width = 0;
        canvas.height = 0;
        if (!preview || generation !== previewCacheGeneration) return;
        const previous = blobUrls.get(key);
        if (previous) {
            URL.revokeObjectURL(previous);
            cachedPreviewPixels = Math.max(0, cachedPreviewPixels - (previewPixels.get(key) || 0));
        }
        const url = URL.createObjectURL(preview);
        blobUrls.set(key, url);
        previewPixels.set(key, pixelCount);
        cachedPreviewPixels += pixelCount;
        touch(key);
        evict();
        return url;
    })
        .catch((error) => {
            if (generation === previewCacheGeneration) {
                if (!isTransientPreviewError(error)) failedSources.set(src, Date.now());
                console.warn("[CanvasPreviewImage] failed to build lightweight preview", error);
            }
            return undefined;
        })
        .finally(() => {
            if (inflight.get(key) === task) inflight.delete(key);
        });

    inflight.set(key, task);
    evict();
    return task;
}

export function shouldDownscalePreview(src: string) {
    return Boolean(src) && !src.startsWith("data:image/svg") && !isRemoteOriginalSource(src);
}

export function clearPreviewCache() {
    previewCacheGeneration += 1;
    blobUrls.forEach((url) => URL.revokeObjectURL(url));
    blobUrls.clear();
    blobRefs.clear();
    previewPixels.clear();
    recent.clear();
    inflight.clear();
    failedSources.clear();
    cachedPreviewPixels = 0;
}
