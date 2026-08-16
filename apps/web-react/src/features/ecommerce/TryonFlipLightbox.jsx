import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  isAuthenticatedAiMediaUrl,
  releaseAuthenticatedMediaUrl,
  resolveAuthenticatedMediaUrl,
} from "@react/legacy-modules/services/authenticatedMedia.js";
import "./TryonFlipLightbox.css";

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const OPEN_MS = 340;
const CLOSE_MS = 280;

function motionDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

function readRect(element) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function destinationRect(naturalWidth, naturalHeight) {
  const maxWidth = Math.max(120, window.innerWidth - 48);
  const maxHeight = Math.max(120, window.innerHeight - 48);
  const scale = Math.min(1, maxWidth / naturalWidth, maxHeight / naturalHeight);
  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);
  return {
    left: Math.round((window.innerWidth - width) / 2),
    top: Math.round((window.innerHeight - height) / 2),
    width,
    height,
  };
}

function applyFrame(element, rect) {
  element.style.left = `${rect.left}px`;
  element.style.top = `${rect.top}px`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
}

function playFrame(element, from, to, duration) {
  applyFrame(element, from);
  if (!element.animate || motionDisabled()) {
    applyFrame(element, to);
    return { finished: Promise.resolve(), cancel() {} };
  }
  const animation = element.animate(
    [
      {
        left: `${from.left}px`,
        top: `${from.top}px`,
        width: `${from.width}px`,
        height: `${from.height}px`,
      },
      {
        left: `${to.left}px`,
        top: `${to.top}px`,
        width: `${to.width}px`,
        height: `${to.height}px`,
      },
    ],
    { duration, easing: EASE, fill: "forwards" },
  );
  animation.addEventListener("finish", () => {
    applyFrame(element, to);
    animation.cancel();
  });
  return animation;
}

export function TryonFlipLightbox({
  origin,
  src,
  alt = "预览图片",
  title = "查看大图",
  onClose,
}) {
  const overlayRef = useRef(null);
  const frameRef = useRef(null);
  const imageRef = useRef(null);
  const closingRef = useRef(false);
  const animationRef = useRef(null);
  const requestCloseRef = useRef(() => onClose?.());
  const onCloseRef = useRef(onClose);
  const [heroSrc, setHeroSrc] = useState("");
  onCloseRef.current = onClose;

  useEffect(() => {
    let cancelled = false;
    let resolved = "";
    const source = String(src || "").trim();
    if (!source) {
      setHeroSrc("");
      return undefined;
    }
    if (!isAuthenticatedAiMediaUrl(source)) {
      setHeroSrc(source);
      return undefined;
    }
    setHeroSrc("");
    resolveAuthenticatedMediaUrl(source, { maxDimension: 0 })
      .then((value) => {
        if (cancelled) return;
        resolved = value;
        setHeroSrc(value);
      })
      .catch(() => {
        if (!cancelled) setHeroSrc(source);
      });
    return () => {
      cancelled = true;
      if (resolved) {
        releaseAuthenticatedMediaUrl(source, resolved, { maxDimension: 0 });
      }
    };
  }, [src]);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const frame = frameRef.current;
    const hero = imageRef.current;
    const thumb = origin instanceof Element ? origin : null;
    if (!overlay || !frame || !hero || !heroSrc) return undefined;

    let cancelled = false;
    closingRef.current = false;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const stop = () => {
      const animation = animationRef.current;
      animation?.commitStyles?.();
      animation?.cancel();
      animationRef.current = null;
    };

    const show = () => {
      if (cancelled || closingRef.current) return;
      const dest = destinationRect(hero.naturalWidth, hero.naturalHeight);
      const from = thumb?.isConnected ? readRect(thumb) : dest;
      if (thumb?.isConnected) {
        const style = getComputedStyle(thumb);
        hero.style.objectFit = style.objectFit || "cover";
        hero.style.objectPosition = style.objectPosition || "center";
        thumb.style.opacity = "0";
      }
      applyFrame(frame, from);
      overlay.classList.add("is-open");
      frame.classList.add("is-shown");
      if (motionDisabled() || from === dest) {
        applyFrame(frame, dest);
        return;
      }
      animationRef.current = playFrame(frame, from, dest, OPEN_MS);
    };

    const onReady = () => show();
    if (hero.complete && hero.naturalWidth) show();
    else {
      hero.addEventListener("load", onReady);
      hero.addEventListener("error", onReady);
    }

    const close = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      overlay.classList.remove("is-open");
      const finish = () => {
        if (thumb?.isConnected) thumb.style.opacity = "";
        requestAnimationFrame(() => onCloseRef.current?.());
      };
      if (motionDisabled() || !thumb?.isConnected) {
        finish();
        return;
      }
      stop();
      const from = readRect(frame);
      const to = readRect(thumb);
      const animation = playFrame(frame, from, to, CLOSE_MS);
      animationRef.current = animation;
      Promise.resolve(animation.finished).then(finish).catch(finish);
    };

    requestCloseRef.current = close;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("keydown", onKeyDown);
      hero.removeEventListener("load", onReady);
      hero.removeEventListener("error", onReady);
      document.body.style.overflow = previousOverflow;
      if (thumb?.isConnected) thumb.style.opacity = "";
    };
  }, [heroSrc, origin]);

  return (
    <div
      ref={overlayRef}
      className="tryon-flip-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}全屏预览`}
    >
      <div
        className="tryon-flip-lightbox__scrim"
        onClick={() => requestCloseRef.current?.()}
      />
      <figure ref={frameRef} className="tryon-flip-lightbox__figure">
        {heroSrc ? (
          <img
            ref={imageRef}
            className="tryon-flip-lightbox__image"
            src={heroSrc}
            alt={alt}
            draggable="false"
          />
        ) : (
          <span className="tryon-flip-lightbox__pending">加载原图</span>
        )}
      </figure>
      <button
        type="button"
        className="tryon-flip-lightbox__close"
        aria-label="关闭预览"
        title="关闭预览"
        onClick={() => requestCloseRef.current?.()}
      >
        <i className="bi bi-x-lg" />
      </button>
    </div>
  );
}
