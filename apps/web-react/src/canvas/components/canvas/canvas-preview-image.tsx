import { useEffect, useRef, useState, type DragEventHandler, type Ref } from "react";

import { buildLightweightPreview, getCanvasPreviewEdge, retainPreviewUrl, shouldDownscalePreview, subscribeCanvasPreviewScale } from "@/lib/canvas/canvas-preview-image";
import { canvasCompressSource, cloudFileUrl, softMissingFileUrl } from "@/lib/canvas/canvas-preview-url";
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
        if (shouldLoad) return;
        const element = elementRef.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setShouldLoad(true);
            return;
        }
        const inView = (rect: DOMRect) => rect.bottom >= -VIEWPORT_MARGIN && rect.top <= window.innerHeight + VIEWPORT_MARGIN && rect.right >= -VIEWPORT_MARGIN && rect.left <= window.innerWidth + VIEWPORT_MARGIN;
        if (inView(element.getBoundingClientRect())) {
            setShouldLoad(true);
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (!entries.some((entry) => entry.isIntersecting)) return;
            setShouldLoad(true);
            observer.disconnect();
        }, { rootMargin: `${VIEWPORT_MARGIN}px`, threshold: 0 });
        observer.observe(element);
        return () => observer.disconnect();
    }, [enabled, shouldLoad]);

    return { elementRef, shouldLoad };
}

function isUsableImageSrc(value = "") {
    return /^(blob:|data:image\/|https?:|\/)/.test(value);
}

export function useCanvasPreviewSrc(src?: string, options?: { storageKey?: string; thumbnailUrl?: string; maxEdge?: number; enabled?: boolean; allowOriginalFallback?: boolean }) {
    const enabled = options?.enabled !== false;
    const allowOriginalFallback = options?.allowOriginalFallback !== false;
    const [maxEdge, setMaxEdge] = useState(() => getCanvasPreviewEdge(options?.maxEdge));
    const compressSrc = canvasCompressSource({ src, storageKey: options?.storageKey, thumbnailUrl: options?.thumbnailUrl });
    const source = src || "";
    const rawOriginalSrc = source && !source.startsWith("data:") && isUsableImageSrc(source)
        ? source
        : cloudFileUrl(options?.storageKey || source) || source;
    const originalSrc = softMissingFileUrl(rawOriginalSrc);
    const placeholderSrc = isUsableImageSrc(compressSrc) ? softMissingFileUrl(compressSrc) : "";
    const [previewSrc, setPreviewSrc] = useState<string>();
    const [useOriginal, setUseOriginal] = useState(false);

    useEffect(() => {
        const stop = subscribeCanvasPreviewScale(() => setMaxEdge(getCanvasPreviewEdge(options?.maxEdge)));
        return () => {
            stop();
        };
    }, [options?.maxEdge]);

    useEffect(() => {
        if (!enabled) {
            setPreviewSrc(undefined);
            setUseOriginal(false);
            return;
        }
        if (!compressSrc) {
            setPreviewSrc(undefined);
            setUseOriginal(allowOriginalFallback);
            return;
        }
        let cancelled = false;
        setPreviewSrc(undefined);
        setUseOriginal(false);
        void buildLightweightPreview(compressSrc, maxEdge).then((url) => {
            if (cancelled) return;
            if (url) setPreviewSrc(url);
            else if (allowOriginalFallback) setUseOriginal(true);
        });
        return () => {
            cancelled = true;
        };
    }, [allowOriginalFallback, compressSrc, enabled, maxEdge]);

    useEffect(() => {
        if (!previewSrc) return;
        const release = retainPreviewUrl(previewSrc);
        return () => {
            release();
        };
    }, [previewSrc]);

    const directPreviewSrc = shouldDownscalePreview(compressSrc) ? "" : placeholderSrc;
    const displaySrc = useOriginal && allowOriginalFallback && isUsableImageSrc(originalSrc) ? originalSrc : previewSrc || directPreviewSrc;

    return {
        remote: allowOriginalFallback ? originalSrc : "",
        src: enabled ? displaySrc || "" : "",
        previewKind: previewSrc && !useOriginal ? "canvas" : "",
        onError: () => {
            if (allowOriginalFallback && originalSrc && originalSrc !== displaySrc) setUseOriginal(true);
        },
        fallbackSrc: useOriginal && isUsableImageSrc(originalSrc) ? originalSrc : undefined,
    };
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
};

function bindViewportRef<T extends Element>(ref: { current: Element | null }): Ref<T> {
    return (node) => {
        ref.current = node;
    };
}

export function CanvasPreviewImage({ src, storageKey, thumbnailUrl, alt = "", className, maxEdge, allowOriginalFallback = true, draggable = false, onDragStart }: CanvasPreviewImageProps) {
    const hasSource = Boolean(src || thumbnailUrl || storageKey);
    const { elementRef, shouldLoad } = useViewportMedia(hasSource);
    const preview = useCanvasPreviewSrc(src, { storageKey, thumbnailUrl, maxEdge, enabled: shouldLoad, allowOriginalFallback });

    return (
        <span ref={bindViewportRef<HTMLSpanElement>(elementRef)} className="block h-full w-full">
            <img
                src={preview.fallbackSrc || preview.src || undefined}
                data-preview-src={preview.previewKind || undefined}
                alt={alt}
                className={className}
                draggable={draggable}
                loading="eager"
                decoding="async"
                onDragStart={onDragStart}
                onError={preview.onError}
            />
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
