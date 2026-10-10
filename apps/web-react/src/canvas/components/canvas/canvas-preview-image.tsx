import { useEffect, useRef, useState, type DragEventHandler, type Ref } from "react";

import { buildLightweightPreview, getCanvasPreviewEdge, retainPreviewUrl, shouldDownscalePreview, subscribeCanvasPreviewScale } from "@/lib/canvas/canvas-preview-image";
import { canvasCompressSource, cloudDisplayUrl, cloudFileUrl, softMissingFileUrl } from "@/lib/canvas/canvas-preview-url";
import { resolveMediaUrl } from "@/services/file-storage";

const VIEWPORT_MARGIN = 160;

export function useViewportMedia(enabled: boolean) {
    const elementRef = useRef<Element | null>(null);
    const [shouldLoad, setShouldLoad] = useState(false);

    useEffect(() => {
        if (!enabled) {
            setShouldLoad(false);
            return;
        }
        const element = elementRef.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setShouldLoad(true);
            return;
        }
        const inView = (rect: DOMRect) => rect.bottom >= -VIEWPORT_MARGIN && rect.top <= window.innerHeight + VIEWPORT_MARGIN && rect.right >= -VIEWPORT_MARGIN && rect.left <= window.innerWidth + VIEWPORT_MARGIN;
        setShouldLoad(inView(element.getBoundingClientRect()));
        const observer = new IntersectionObserver((entries) => {
            setShouldLoad(entries.some((entry) => entry.isIntersecting));
        }, { rootMargin: `${VIEWPORT_MARGIN}px`, threshold: 0 });
        observer.observe(element);
        return () => observer.disconnect();
    }, [enabled]);

    return { elementRef, shouldLoad };
}

function isUsableImageSrc(value = "") {
    return /^(blob:|data:image\/|https?:|\/)/.test(value);
}

export function useCanvasPreviewSrc(src?: string, options?: { storageKey?: string; thumbnailUrl?: string; maxEdge?: number; enabled?: boolean; allowOriginalFallback?: boolean }) {
    const enabled = options?.enabled !== false;
    const allowOriginalFallback = options?.allowOriginalFallback !== false;
    const [maxEdge, setMaxEdge] = useState(() => getCanvasPreviewEdge(options?.maxEdge));
    const lightweightSource = canvasCompressSource({ src, storageKey: options?.storageKey, thumbnailUrl: options?.thumbnailUrl });
    const compressSrc = maxEdge > 512 && allowOriginalFallback ? cloudDisplayUrl(options?.storageKey || src) || cloudFileUrl(options?.storageKey || src) || lightweightSource : lightweightSource;
    const source = src || "";
    const rawOriginalSrc = source && !source.startsWith("data:") && isUsableImageSrc(source)
        ? source
        : cloudFileUrl(options?.storageKey || source) || source;
    const originalSrc = softMissingFileUrl(rawOriginalSrc);
    const identity = options?.storageKey || source || options?.thumbnailUrl || "";
    const [display, setDisplay] = useState<{ identity: string; url: string; kind: string; release: () => void }>();
    const [failedIdentity, setFailedIdentity] = useState("");

    useEffect(() => {
        const stop = subscribeCanvasPreviewScale(() => setMaxEdge(getCanvasPreviewEdge(options?.maxEdge)));
        return () => {
            stop();
        };
    }, [options?.maxEdge]);

    useEffect(() => {
        // Visibility controls new work, not the lifetime of an already displayed image.
        if (!enabled || !identity) return;
        let cancelled = false;
        const controller = new AbortController();
        setFailedIdentity("");
        void (async () => {
            const previewUrl = compressSrc ? await buildLightweightPreview(compressSrc, maxEdge, { signal: controller.signal, priority: allowOriginalFallback ? 10 : 0 }) : undefined;
            if (cancelled) return;
            const directPreview = !shouldDownscalePreview(compressSrc) && isUsableImageSrc(compressSrc) ? softMissingFileUrl(compressSrc) : undefined;
            const candidates = [...new Set([previewUrl, directPreview, allowOriginalFallback && isUsableImageSrc(originalSrc) ? originalSrc : undefined].filter((url): url is string => Boolean(url)))];
            for (const url of candidates) {
                // Pin blobs while decoding; release the previous display only after React commits its replacement.
                const release = retainPreviewUrl(url);
                const ready = await loadCanvasImage(url, controller.signal);
                if (cancelled) { release(); return; }
                if (ready) {
                    setDisplay({ identity, url, kind: url === previewUrl ? "canvas" : "", release });
                    return;
                }
                release();
            }
            setFailedIdentity(identity);
        })();
        return () => {
            cancelled = true;
            controller.abort();
        };
    }, [allowOriginalFallback, compressSrc, enabled, maxEdge, identity, originalSrc]);

    useEffect(() => () => display?.release(), [display]);
    const current = display?.identity === identity ? display : undefined;

    return {
        remote: allowOriginalFallback ? originalSrc : "",
        src: current?.url || "",
        previewKind: current?.kind || "",
        failed: !current && failedIdentity === identity,
    };
}

/** Never expose an undecoded or failed candidate to the visible image element. */
export function loadCanvasImage(url: string, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
        if (signal.aborted) { resolve(false); return; }
        const image = new Image();
        const finish = (ready: boolean) => {
            image.onload = null;
            image.onerror = null;
            signal.removeEventListener("abort", abort);
            resolve(ready);
        };
        const abort = () => { finish(false); image.src = ""; };
        signal.addEventListener("abort", abort, { once: true });
        image.onerror = () => finish(false);
        image.onload = () => {
            if (typeof image.decode === "function") void image.decode().then(() => finish(true), () => finish(false));
            else finish(image.naturalWidth > 0);
        };
        image.src = url;
    });
}

type CanvasPreviewImageProps = {
    src?: string;
    storageKey?: string;
    thumbnailUrl?: string;
    alt?: string;
    className?: string;
    maxEdge?: number;
    allowOriginalFallback?: boolean;
    draggable?: boolean;
    onDragStart?: DragEventHandler<HTMLImageElement>;
    onLoad?: React.ReactEventHandler<HTMLImageElement>;
};

function bindViewportRef<T extends Element>(ref: { current: Element | null }): Ref<T> {
    return (node) => {
        ref.current = node;
    };
}

export function CanvasPreviewImage({ src, storageKey, thumbnailUrl, alt = "", className, maxEdge, allowOriginalFallback = true, draggable = false, onDragStart, onLoad }: CanvasPreviewImageProps) {
    const hasSource = Boolean(src || thumbnailUrl || storageKey);
    const { elementRef, shouldLoad } = useViewportMedia(hasSource);
    const preview = useCanvasPreviewSrc(src, { storageKey, thumbnailUrl, maxEdge, enabled: shouldLoad, allowOriginalFallback });

    return (
        <span ref={bindViewportRef<HTMLSpanElement>(elementRef)} className="block h-full w-full">
            {preview.src ? <img
                src={preview.src}
                data-preview-src={preview.previewKind || undefined}
                alt={alt}
                className={className}
                draggable={draggable}
                loading="eager"
                decoding="async"
                onDragStart={onDragStart}
                onLoad={onLoad}
            /> : <span role="status" aria-label={preview.failed ? "图片暂时无法加载" : "图片加载中"} className="block h-full w-full bg-black/5" />}
        </span>
    );
}

type CanvasPreviewVideoProps = {
    src?: string;
    storageKey?: string;
    className?: string;
    poster?: string;
};

export function CanvasPreviewVideo({ src, storageKey, className, poster }: CanvasPreviewVideoProps) {
    const { elementRef, shouldLoad } = useViewportMedia(Boolean(src || storageKey));
    const [activated, setActivated] = useState(false);
    const [resolved, setResolved] = useState("");

    useEffect(() => {
        if (!shouldLoad) {
            setResolved("");
            setActivated(false);
            return;
        }
        if (!activated || resolved) return;
        const direct = src && (src.startsWith("/api/") || src.startsWith("http://") || src.startsWith("https://")) ? src : "";
        if (direct) {
            setResolved(direct);
            return;
        }
        const key = storageKey || src || "";
        if (!key) return;
        let cancelled = false;
        void resolveMediaUrl(key, "").then((url) => {
            if (!cancelled) setResolved(url);
        });
        return () => {
            cancelled = true;
        };
    }, [activated, resolved, shouldLoad, src, storageKey]);

    return (
        <span ref={bindViewportRef<HTMLSpanElement>(elementRef)} className="relative block h-full w-full">
            {resolved ? (
                <video src={resolved} poster={poster} controls playsInline preload="none" className={className} data-canvas-no-zoom />
            ) : (
                <button type="button" className="flex h-full w-full items-center justify-center bg-black/80 text-white" onClick={() => setActivated(true)} data-canvas-no-zoom>
                    {poster ? <img src={poster} alt="" className="absolute inset-0 h-full w-full object-contain" /> : null}
                    <span className="relative rounded-full border border-white/40 px-3 py-1 text-xs">播放</span>
                </button>
            )}
        </span>
    );
}
