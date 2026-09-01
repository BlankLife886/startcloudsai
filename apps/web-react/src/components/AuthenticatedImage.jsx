import { useEffect, useRef, useState } from "react";
import {
  cancelAuthenticatedMediaResolve,
  isAuthenticatedAiMediaUrl,
  releaseAuthenticatedMediaUrl,
  resolveAuthenticatedMediaUrl,
} from "@react/legacy-modules/services/authenticatedMedia.js";
import "@react/legacy-styles/generated/components/common/AuthenticatedImage.css";

const loadedMediaSources = new Set();
const MAX_REMEMBERED_MEDIA_SOURCES = 512;

function rememberLoadedMediaSource(value) {
  loadedMediaSources.delete(value);
  loadedMediaSources.add(value);
  while (loadedMediaSources.size > MAX_REMEMBERED_MEDIA_SOURCES) {
    loadedMediaSources.delete(loadedMediaSources.values().next().value);
  }
}

function retryableExternalUrl(value, attempt) {
  if (!/^https?:\/\//i.test(value) || attempt <= 0) return value;
  try {
    const url = new URL(value);
    if (
      url.searchParams.has("X-Amz-Signature") ||
      url.searchParams.has("Signature") ||
      url.searchParams.has("OSSAccessKeyId")
    ) {
      return value;
    }
    url.searchParams.set("__sc_image_retry", String(attempt));
    return url.toString();
  } catch {
    return value;
  }
}

export function AuthenticatedImage({
  src = "",
  alt = "",
  loading = "lazy",
  rootMargin = "360px 0px",
  retryCount = 1,
  maxDimension = 0,
  // 旧数据可能没有小图/展示图变体：主地址 404 时自动回退到该地址（一般传原图）。
  fallbackSrc = "",
  // 指定滚动容器，避免用视口当 root 时，侧栏内滚动判断错位。
  observerRoot = null,
  keepLoaded = false,
  onLoad,
  onError,
  className = "",
  ...props
}) {
  const rootRef = useRef(null);
  const tokenRef = useRef(0);
  const retryRef = useRef(0);
  const displayRetryRef = useRef(0);
  const timerRef = useRef(0);
  const resolvedRef = useRef("");
  const [active, setActive] = useState(loading === "eager");
  const [resolved, setResolved] = useState("");
  const [state, setState] = useState(() =>
    loadedMediaSources.has(src) ? "loaded" : "placeholder",
  );

  useEffect(() => {
    const root = rootRef.current;
    if (
      !src ||
      loading === "eager" ||
      typeof IntersectionObserver === "undefined"
    ) {
      setActive(Boolean(src));
      return undefined;
    }
    const scrollRoot = (
      observerRoot && typeof observerRoot === "object" && "current" in observerRoot
        ? observerRoot.current
        : observerRoot
    ) || root.closest(".t2i-panel") || null;
    const observer = new IntersectionObserver(
      (entries) => {
        const nextActive = entries.some((entry) => entry.isIntersecting);
        if (nextActive) {
          setActive(true);
          return;
        }
        if (keepLoaded) return;
        setActive(false);
        setResolved("");
        setState("placeholder");
      },
      { root: scrollRoot instanceof Element ? scrollRoot : null, rootMargin, threshold: 0.01 },
    );
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, [keepLoaded, loading, observerRoot, rootMargin, src]);

  useEffect(() => {
    if (!src || !active) return undefined;
    const token = ++tokenRef.current;
    let disposed = false;
    retryRef.current = 0;
    displayRetryRef.current = 0;
    if (!keepLoaded || !resolvedRef.current) {
      setResolved("");
      if (!loadedMediaSources.has(src)) setState("loading");
    }

    const resolve = async () => {
      try {
        const value = await resolveAuthenticatedMediaUrl(src, {
          maxDimension,
          fallbackUrl: fallbackSrc,
        });
        if (disposed || token !== tokenRef.current) return;
        resolvedRef.current = value;
        setResolved(value);
      } catch (error) {
        if (disposed || token !== tokenRef.current) return;
        if (retryRef.current < Math.max(0, Number(retryCount) || 0)) {
          retryRef.current += 1;
          timerRef.current = window.setTimeout(resolve, 240 * retryRef.current);
          return;
        }
        setState("failed");
        onError?.(error);
      }
    };
    resolve();

    return () => {
      disposed = true;
      ++tokenRef.current;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (resolvedRef.current) {
        releaseAuthenticatedMediaUrl(src, resolvedRef.current, {
          maxDimension,
        });
        resolvedRef.current = "";
      } else {
        // 尚未取到图就离开视口/卸载：注销等待，让排队中的请求立即出队，
        // 不再占用浏览器连接阻塞页面切换。
        cancelAuthenticatedMediaResolve(src, { maxDimension });
      }
    };
  }, [active, fallbackSrc, keepLoaded, maxDimension, retryCount, src]);

  return (
    <span
      ref={rootRef}
      className={`authenticated-image is-${state}${className ? ` ${className}` : ""}`}
      role="img"
      aria-label={
        alt || (state === "failed" ? "图片暂时无法读取" : "图片加载中")
      }
    >
      {resolved && (
        <img
          {...props}
          className="authenticated-image-media"
          src={resolved}
          alt={alt}
          loading={isAuthenticatedAiMediaUrl(src) ? "eager" : loading}
          decoding="async"
          draggable="false"
          onLoad={(event) => {
            rememberLoadedMediaSource(src);
            setState("loaded");
            onLoad?.(event);
          }}
          onError={(event) => {
            const maxRetries = Math.max(0, Number(retryCount) || 0);
            if (
              !isAuthenticatedAiMediaUrl(src) &&
              displayRetryRef.current < maxRetries
            ) {
              displayRetryRef.current += 1;
              const attempt = displayRetryRef.current;
              setState("loading");
              setResolved("");
              if (timerRef.current) window.clearTimeout(timerRef.current);
              timerRef.current = window.setTimeout(() => {
                setResolved(retryableExternalUrl(resolved || src, attempt));
              }, 300 * attempt);
              return;
            }
            setState("failed");
            onError?.(event);
          }}
        />
      )}
    </span>
  );
}
