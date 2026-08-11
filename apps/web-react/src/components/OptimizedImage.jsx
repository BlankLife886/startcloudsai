import { useEffect, useRef, useState } from "react";
import "@legacy/components/common/OptimizedImage.vue?react-style";

export function OptimizedImage({
  src = "",
  alt = "",
  width = 0,
  height = 0,
  fit = "cover",
  loading = "lazy",
  decoding = "async",
  fetchPriority = "auto",
  rootMargin = "480px 0px",
  retryCount = 1,
  className = "",
  onLoad,
  onError,
  ...props
}) {
  const rootRef = useRef(null);
  const observerRef = useRef(null);
  const retryTimerRef = useRef(0);
  const retryAttemptRef = useRef(0);
  const [active, setActive] = useState(loading === "eager");
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const intrinsicWidth = Math.max(0, Number(width) || 0);
  const intrinsicHeight = Math.max(0, Number(height) || 0);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    retryAttemptRef.current = 0;
    setActive(loading === "eager");
    observerRef.current?.disconnect();
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    if (
      loading === "eager" ||
      !src ||
      typeof IntersectionObserver === "undefined"
    ) {
      setActive(Boolean(src));
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setActive(true);
        observer.disconnect();
      },
      { rootMargin, threshold: 0.01 },
    );
    observerRef.current = observer;
    if (rootRef.current) observer.observe(rootRef.current);
    return () => {
      observer.disconnect();
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [loading, rootMargin, src]);

  return (
    <span
      {...props}
      ref={rootRef}
      className={`optimized-image${loaded ? " is-loaded" : ""}${
        failed ? " is-failed" : ""
      }${className ? ` ${className}` : ""}`}
      style={{
        "--optimized-image-fit": fit === "contain" ? "contain" : "cover",
        ...(intrinsicWidth > 0 && intrinsicHeight > 0
          ? { aspectRatio: `${intrinsicWidth} / ${intrinsicHeight}` }
          : {}),
      }}
      role="img"
      aria-label={alt || (failed ? "图片加载失败" : "图片加载中")}
    >
      <span className="optimized-image__skeleton" aria-hidden="true" />
      {active && src && !failed && (
        <img
          key={`${src}:${retryKey}`}
          src={src}
          alt={alt}
          width={intrinsicWidth || undefined}
          height={intrinsicHeight || undefined}
          loading={loading}
          decoding={decoding}
          fetchPriority={fetchPriority}
          draggable="false"
          onLoad={(event) => {
            setLoaded(true);
            setFailed(false);
            retryAttemptRef.current = 0;
            onLoad?.(event);
          }}
          onError={(event) => {
            setLoaded(false);
            if (
              retryAttemptRef.current < Math.max(0, Number(retryCount) || 0)
            ) {
              retryAttemptRef.current += 1;
              setActive(false);
              retryTimerRef.current = window.setTimeout(() => {
                retryTimerRef.current = 0;
                setRetryKey((key) => key + 1);
                setActive(true);
              }, 240 * retryAttemptRef.current);
              return;
            }
            setFailed(true);
            onError?.(event);
          }}
        />
      )}
      {(failed || !src) && (
        <span className="optimized-image__fallback">
          <i className="bi bi-image" aria-hidden="true" />
          <span>{failed ? "图片加载失败" : "暂无图片"}</span>
        </span>
      )}
    </span>
  );
}
