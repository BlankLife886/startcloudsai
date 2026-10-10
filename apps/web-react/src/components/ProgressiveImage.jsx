import { useEffect, useRef, useState } from "react";
import "@react/legacy-styles/generated/features/share/components/ShareProgressiveImage.css";

function markIfComplete(img, onReady) {
  if (img?.complete && img.naturalWidth > 0) onReady();
}

export function ProgressiveImage({
  src = "",
  previewSrc = "",
  fallbackSrc = "",
  alt = "",
  eager = false,
  className = "",
  ...props
}) {
  const rootRef = useRef(null);
  const [active, setActive] = useState(eager);
  const [fullSrc, setFullSrc] = useState(src);
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const preview = previewSrc && previewSrc !== fullSrc ? previewSrc : "";

  useEffect(() => {
    setFullSrc(src);
    setLoaded(false);
    setPreviewLoaded(false);
    setFailed(false);
    setActive(eager);
    if (eager || typeof IntersectionObserver === "undefined") {
      setActive(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setActive(true);
        observer.disconnect();
      },
      { rootMargin: "320px 0px", threshold: 0.01 },
    );
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [src, previewSrc, eager, retryKey]);

  useEffect(() => {
    if (!active) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    markIfComplete(root.querySelector("img.is-preview"), () =>
      setPreviewLoaded(true),
    );
    markIfComplete(
      root.querySelector("img.is-full") || root.querySelector("img"),
      () => setLoaded(true),
    );
    return undefined;
  }, [active, fullSrc, preview, retryKey]);

  function retry(event) {
    event.stopPropagation();
    setFailed(false);
    setLoaded(false);
    setPreviewLoaded(false);
    setFullSrc(src);
    setActive(false);
    requestAnimationFrame(() => setRetryKey((value) => value + 1));
  }

  function onFullError() {
    if (fallbackSrc && fullSrc !== fallbackSrc) {
      setFullSrc(fallbackSrc);
      setLoaded(false);
      return;
    }
    if (preview && previewLoaded) return;
    setFailed(true);
  }

  return (
    <span
      ref={rootRef}
      className={`share-progressive-image${previewLoaded ? " is-preview-loaded" : ""}${loaded ? " is-loaded" : ""}${failed ? " is-failed" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    >
      <span className="share-progressive-image__skeleton" aria-hidden="true" />
      {active && preview && (
        <img
          className="is-preview"
          src={preview}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable="false"
          onLoad={() => setPreviewLoaded(true)}
        />
      )}
      {active && fullSrc && (
        <img
          key={`${fullSrc}:${retryKey}`}
          className="is-full"
          src={fullSrc}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          draggable="false"
          onLoad={() => setLoaded(true)}
          onError={onFullError}
        />
      )}
      {failed && (
        <button
          type="button"
          className="share-progressive-image__fallback"
          onClick={retry}
        >
          <i className="bi bi-image" />
          <span>图片加载失败</span>
          <small>点击重试</small>
        </button>
      )}
    </span>
  );
}
