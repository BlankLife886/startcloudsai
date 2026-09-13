import { isCloudThumbnailUrl, isLocalImageKey, isRemoteOriginalSource, softMissingFileUrl } from "@/lib/canvas/canvas-preview-url";
import { dataUrlToBlob } from "@/lib/data-url";
import { getImageBlob } from "@/services/image-storage";
import { createCanvasMediaQueue } from "./canvas-media-queue";

export const CANVAS_PREVIEW_MIN_EDGE = 160;
export const CANVAS_PREVIEW_MAX_EDGE = 2048;
export const CANVAS_PREVIEW_QUALITY = 0.85;
export const CANVAS_PREVIEW_TYPE = "image/webp";
export const CANVAS_PREVIEW_CACHE_LIMIT = 48;
export const CANVAS_PREVIEW_CACHE_PIXEL_BUDGET = CANVAS_PREVIEW_CACHE_LIMIT * 512 * 512;
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
    const density = typeof window === "undefined" ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const pixels = scale * density;
    const edge = pixels < 0.18 ? 160 : pixels < 0.4 ? 256 : pixels <= 1 ? 512 : pixels <= 2 ? 1024 : CANVAS_PREVIEW_MAX_EDGE;
    return clampPreviewEdge(Math.min(maxEdge, edge));
}

export function getCanvasPreviewEdge(maxEdge = CANVAS_PREVIEW_MAX_EDGE) {
    return previewEdgeForScale(liveScale, maxEdge);
}

const previewQueue = createCanvasMediaQueue<string | undefined>(2);
const blobUrls = new Map<string, string>();
const blobRefs = new Map<string, number>();
const previewPixels = new Map<string, number>();
const recent = new Set<string>();
const failedSources = new Map<string, number>();
let cachedPreviewPixels = 0;
let previewCacheGeneration = 0;

function cacheKey(src: string, maxEdge: number) {
    return `${src}#webp=${maxEdge}@${CANVAS_PREVIEW_QUALITY}`;
}

function isTransientPreviewError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /failed to fetch|network|Preview image fetch failed: (5\d\d|408|429)/i.test(message);
}

async function loadPreviewBlob(src: string, signal: AbortSignal, allowDetail = false) {
    if (isRemoteOriginalSource(src) && !allowDetail) return;
    if (isLocalImageKey(src)) return (await getImageBlob(src)) || undefined;
    if (src.startsWith("data:")) return dataUrlToBlob(src);
    const credentials = src.startsWith("blob:") ? ("omit" as const) : ("include" as const);
    const response = await fetch(softMissingFileUrl(src), { cache: "force-cache", credentials, signal });
    const missing = response.status === 204 || response.headers.get("X-StarCloud-Media-Missing") === "1";
    if (!response.ok) {
        if (response.status === 404 && isCloudThumbnailUrl(src)) {
            if (/\/thumb\/[^/.?#]+$/.test(src)) {
                const legacy = await fetch(softMissingFileUrl(`${src}.jpg`), { cache: "force-cache", credentials, signal });
                const legacyMissing = legacy.status === 204 || legacy.headers.get("X-StarCloud-Media-Missing") === "1";
                if (legacy.ok && !legacyMissing) return legacy.blob();
            }
            return;
        }
        throw new Error(`Preview image fetch failed: ${response.status}`);
    }
    if (missing) {
        if (/\/thumb\/[^/.?#]+$/.test(src)) {
            const legacy = await fetch(softMissingFileUrl(`${src}.jpg`), { cache: "force-cache", credentials, signal });
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
}

function evict(protectedKey = "") {
    while (recent.size > CANVAS_PREVIEW_CACHE_LIMIT || cachedPreviewPixels > CANVAS_PREVIEW_CACHE_PIXEL_BUDGET) {
        let oldest: string | undefined;
        for (const key of recent) {
            if (key !== protectedKey && !blobRefs.get(key)) {
                oldest = key;
                break;
            }
        }
        if (!oldest) {
            return; // Never revoke an image still used by a visible card.
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

export async function buildLightweightPreview(src: string, maxEdge = CANVAS_PREVIEW_MAX_EDGE, options: { signal?: AbortSignal; priority?: number } = {}) {
    if (!src || src.startsWith("data:image/svg") || (isRemoteOriginalSource(src) && maxEdge <= 512)) return;
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
    const generation = previewCacheGeneration;

    const task = previewQueue.request(key, async (signal) => {
        if (generation !== previewCacheGeneration || signal.aborted) return;
        const blob = await loadPreviewBlob(src, signal, edge > 512);
        if (generation !== previewCacheGeneration || signal.aborted) return;
        if (!blob) {
            failedSources.set(src, Date.now());
            return;
        }
        const bitmap = await decodePreviewBitmap(blob, edge);
        if (generation !== previewCacheGeneration || signal.aborted) {
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
        if (!preview || generation !== previewCacheGeneration || signal.aborted) return;
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
        evict(key);
        return url;
    }, options)
        .catch((error) => {
            if (options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return undefined;
            if (generation === previewCacheGeneration) {
                if (!isTransientPreviewError(error)) failedSources.set(src, Date.now());
                console.warn("[CanvasPreviewImage] failed to build lightweight preview", error);
            }
            return undefined;
        });
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
    previewQueue.clear();
    failedSources.clear();
    cachedPreviewPixels = 0;
}
