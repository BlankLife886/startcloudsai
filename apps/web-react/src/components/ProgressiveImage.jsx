import { useEffect, useRef, useState } from "react";
import "@react/legacy-styles/generated/features/share/components/ShareProgressiveImage.css";

export function ProgressiveImage({
  src = "",
  alt = "",
  eager = false,
  className = "",
  ...props
}) {
  const rootRef = useRef(null);
  const [active, setActive] = useState(eager);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoaded(false);
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
  }, [src, eager, retryKey]);

  function retry(event) {
    event.stopPropagation();
    setFailed(false);
    setLoaded(false);
    setActive(false);
    requestAnimationFrame(() => setRetryKey((value) => value + 1));
  }

  return (
    <span
      ref={rootRef}
      className={`share-progressive-image${loaded ? " is-loaded" : ""}${failed ? " is-failed" : ""}${className ? ` ${className}` : ""}`}
      {...props}
    >
      <span className="share-progressive-image__skeleton" aria-hidden="true" />
      {active && src && (
        <img
          key={`${src}:${retryKey}`}
          src={src}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          draggable="false"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
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
