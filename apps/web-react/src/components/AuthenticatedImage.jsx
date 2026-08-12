import { useEffect, useRef, useState } from "react";
import {
  isAuthenticatedAiMediaUrl,
  releaseAuthenticatedMediaUrl,
  resolveAuthenticatedMediaUrl,
} from "@react/legacy-modules/services/authenticatedMedia.js";
import "@react/legacy-styles/generated/components/common/AuthenticatedImage.css";

export function AuthenticatedImage({
  src = "",
  alt = "",
  loading = "lazy",
  rootMargin = "360px 0px",
  retryCount = 1,
  maxDimension = 0,
  onLoad,
  onError,
  className = "",
  ...props
}) {
  const rootRef = useRef(null);
  const tokenRef = useRef(0);
  const retryRef = useRef(0);
  const timerRef = useRef(0);
  const resolvedRef = useRef("");
  const [active, setActive] = useState(loading === "eager");
  const [resolved, setResolved] = useState("");
  const [state, setState] = useState("placeholder");

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
    const observer = new IntersectionObserver(
      (entries) => {
        const nextActive = entries.some((entry) => entry.isIntersecting);
        setActive(nextActive);
        if (!nextActive) {
          setResolved("");
          setState("placeholder");
        }
      },
      { rootMargin, threshold: 0.01 },
    );
    if (root) observer.observe(root);
    return () => observer.disconnect();
  }, [loading, rootMargin, src]);

  useEffect(() => {
    if (!src || !active) return undefined;
    const token = ++tokenRef.current;
    let disposed = false;
    retryRef.current = 0;
    setResolved("");
    setState("loading");

    const resolve = async () => {
      try {
        const value = await resolveAuthenticatedMediaUrl(src, { maxDimension });
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
      }
    };
  }, [active, maxDimension, retryCount, src]);

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
            setState("loaded");
            onLoad?.(event);
          }}
          onError={(event) => {
            setState("failed");
            onError?.(event);
          }}
        />
      )}
    </span>
  );
}
