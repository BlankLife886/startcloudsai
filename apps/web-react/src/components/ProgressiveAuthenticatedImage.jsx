import { useEffect, useMemo, useState } from "react";
import "@react/legacy-styles/generated/components/common/ProgressiveAuthenticatedImage.css";
import { AuthenticatedImage } from "./AuthenticatedImage.jsx";

export function ProgressiveAuthenticatedImage({
  src = "",
  previewSrc = "",
  alt = "",
  loading = "lazy",
  decoding = "async",
  fetchPriority = "auto",
  rootMargin = "240px 0px",
  retryCount = 1,
  loadOriginal = false,
  hideStatus = false,
  className = "",
  onLoad,
  onPreviewLoad,
  onError,
  onOriginalError,
  ...props
}) {
  const source = String(src || "").trim();
  const preview = String(previewSrc || "").trim();
  const shouldLoadOriginal = loadOriginal && Boolean(source);
  const distinctPreview = Boolean(preview) && preview !== source;
  const [previewLoaded, setPreviewLoaded] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [originalActive, setOriginalActive] = useState(
    shouldLoadOriginal && !distinctPreview,
  );
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [originalFailed, setOriginalFailed] = useState(false);

  useEffect(() => {
    setPreviewLoaded(false);
    setPreviewFailed(false);
    setOriginalLoaded(false);
    setOriginalFailed(false);
    setOriginalActive(shouldLoadOriginal && !distinctPreview);
  }, [distinctPreview, preview, shouldLoadOriginal, source]);

  const targetLoaded = shouldLoadOriginal ? originalLoaded : previewLoaded;
  const targetFailed = shouldLoadOriginal
    ? originalFailed && !previewLoaded
    : previewFailed;
  const hasTarget = shouldLoadOriginal ? Boolean(source) : Boolean(preview);
  const classes = useMemo(
    () => [
      "authenticated-image progressive-authenticated-image",
      hasTarget && !targetLoaded && !targetFailed ? "is-loading" : "",
      previewLoaded && !originalLoaded ? "is-preview-loaded" : "",
      originalLoaded ? "is-original-loaded" : "",
      !shouldLoadOriginal ? "is-thumbnail-only" : "",
      targetFailed ? "is-failed" : "",
      className,
    ].filter(Boolean).join(" "),
    [className, hasTarget, originalLoaded, previewLoaded, shouldLoadOriginal, targetFailed, targetLoaded],
  );

  return (
    <span
      {...props}
      className={classes}
      role="img"
      aria-label={alt || (targetFailed ? "图片暂时无法读取" : "图片加载中")}
    >
      {preview && (!shouldLoadOriginal || distinctPreview) && (
        <AuthenticatedImage
          className={`progressive-authenticated-image__layer is-preview${
            originalLoaded ? " is-hidden" : ""
          }`}
          src={preview}
          alt=""
          loading={loading}
          decoding={decoding}
          fetchPriority={fetchPriority}
          rootMargin={rootMargin}
          retryCount={retryCount}
          onLoad={(event) => {
            setPreviewLoaded(true);
            setPreviewFailed(false);
            onPreviewLoad?.(event);
            if (shouldLoadOriginal) setOriginalActive(true);
            else onLoad?.(event);
          }}
          onError={(event) => {
            setPreviewLoaded(false);
            setPreviewFailed(true);
            if (shouldLoadOriginal) setOriginalActive(true);
            else onError?.(event);
          }}
        />
      )}
      {originalActive && (
        <AuthenticatedImage
          className={`progressive-authenticated-image__layer is-original${
            originalLoaded ? " is-visible" : ""
          }`}
          src={source}
          alt={alt}
          loading={loading}
          decoding={decoding}
          fetchPriority={fetchPriority}
          rootMargin={rootMargin}
          retryCount={retryCount}
          onLoad={(event) => {
            setOriginalLoaded(true);
            setOriginalFailed(false);
            onLoad?.(event);
          }}
          onError={(event) => {
            setOriginalLoaded(false);
            setOriginalFailed(true);
            if (previewLoaded) onOriginalError?.(event);
            else onError?.(event);
          }}
        />
      )}
      {!hideStatus && hasTarget && !targetLoaded && (
        <span className={`progressive-authenticated-image__status${targetFailed ? " is-failed" : ""}`} aria-hidden="true">
          <i className={`bi ${targetFailed ? "bi-image-alt" : "bi-arrow-repeat"}`} />
          <span>{targetFailed ? "图片暂时无法读取" : "图片加载中"}</span>
        </span>
      )}
    </span>
  );
}
