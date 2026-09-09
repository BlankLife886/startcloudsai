import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import gsap from "gsap";
import {
  isProductGuidesEnabled,
  markProductGuideSeen,
  PRODUCT_GUIDE_DOCK_SELECTOR,
  subscribeProductGuideReplay,
} from "./productGuides.js";
import "./ProductGuideTour.css";

function isVisibleTarget(node) {
  if (node.closest("[aria-hidden='true']")) return false;
  const rect = node.getBoundingClientRect();
  const style = window.getComputedStyle(node);
  return rect.width > 2 && rect.height > 2 && style.display !== "none";
}

function visibleTargets(selector) {
  if (!selector) return [];
  return [...document.querySelectorAll(selector)].filter(isVisibleTarget);
}

function visibleTarget(selector) {
  return visibleTargets(selector)[0] || null;
}

function unionRect(nodes) {
  const rects = nodes.map((node) => node.getBoundingClientRect());
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
    toJSON() {},
  };
}

function paddedRect(rect, pad = 14) {
  return {
    left: Math.max(8, rect.left - pad),
    top: Math.max(8, rect.top - pad),
    width: Math.min(window.innerWidth - 16, rect.width + pad * 2),
    height: Math.min(window.innerHeight - 16, rect.height + pad * 2),
  };
}

function placeTooltip(spot, hasTarget, cardWidth = 380, cardHeight = 240) {
  if (!spot || !hasTarget) {
    return {
      style: { left: "50%", top: "46%", transform: "translate(-50%, -50%)" },
      side: "center",
    };
  }
  const width = Math.min(cardWidth, window.innerWidth - 24);
  const height = Math.max(180, cardHeight);
  const gap = 18;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const canRight = spot.left + spot.width + gap + width < vw - 12;
  const canLeft = spot.left - gap - width > 12;
  const canBottom = spot.top + spot.height + gap + height < vh - 12;
  const canTop = spot.top - gap - height > 12;
  const clampTop = (top) => Math.max(12, Math.min(top, vh - height - 12));
  const clampLeft = (left) => Math.max(12, Math.min(left, vw - width - 12));

  if (spot.width > vw * 0.55 && spot.height > vh * 0.42) {
    return {
      style: { left: clampLeft(spot.left + 20), top: clampTop(spot.top + spot.height - height - 20), width },
      side: "inside",
    };
  }
  if (spot.height > vh * 0.5 && (canRight || canLeft)) {
    const side = canRight ? "right" : "left";
    return {
      style: {
        left: side === "right" ? spot.left + spot.width + gap : spot.left - width - gap,
        top: clampTop(spot.top + 12),
        width,
      },
      side,
    };
  }
  if (spot.left < 300 && canRight) {
    return {
      style: { left: spot.left + spot.width + gap, top: clampTop(spot.top + 12), width },
      side: "right",
    };
  }
  if (spot.left > vw * 0.55 && canLeft) {
    return {
      style: { left: spot.left - width - gap, top: clampTop(spot.top + 12), width },
      side: "left",
    };
  }
  if (canBottom) {
    return {
      style: { left: clampLeft(spot.left), top: spot.top + spot.height + gap, width },
      side: "bottom",
    };
  }
  if (canTop) {
    return {
      style: { left: clampLeft(spot.left), top: spot.top - height - gap, width },
      side: "top",
    };
  }
  if (canRight) {
    return {
      style: { left: spot.left + spot.width + gap, top: clampTop(spot.top), width },
      side: "right",
    };
  }
  if (canLeft) {
    return {
      style: { left: spot.left - width - gap, top: clampTop(spot.top), width },
      side: "left",
    };
  }
  return {
    style: { left: clampLeft(spot.left + 16), top: clampTop(spot.top + 16), width },
    side: "inside",
  };
}

/**
 * @param {{ enabled?: boolean, pendingKey?: string, storageKey?: string }} options
 */
export function useProductGuide({ enabled = true, pendingKey, storageKey } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    const fromQuery = searchParams.get("guide") === "1";
    if (pendingKey) {
      try {
        sessionStorage.removeItem(pendingKey);
      } catch {
        /* ignore */
      }
    }
    if (fromQuery) {
      const next = new URLSearchParams(searchParams);
      next.delete("guide");
      setSearchParams(next, { replace: true });
    }
    if (!isProductGuidesEnabled() || startedRef.current) return undefined;
    const timer = window.setTimeout(() => {
      startedRef.current = true;
      setOpen(true);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [enabled, pendingKey, searchParams, setSearchParams, storageKey]);

  useEffect(() => subscribeProductGuideReplay(() => {
    startedRef.current = true;
    setOpen(true);
  }), []);

  return { open, setOpen };
}

export function ProductGuideTour({
  open,
  dark,
  steps,
  storageKey,
  onClose,
  pad = 14,
  cardWidth = 380,
  finishLabel = "开始使用",
}) {
  const cardRef = useRef(null);
  const packTweenRef = useRef(null);
  const packFromRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState(null);
  const [cardSize, setCardSize] = useState({ width: cardWidth, height: 240 });
  const [visibleSteps, setVisibleSteps] = useState(steps);
  const [packing, setPacking] = useState(false);
  const step = visibleSteps[Math.min(index, Math.max(0, visibleSteps.length - 1))] || steps[0];

  useEffect(() => () => {
    packTweenRef.current?.kill();
  }, []);

  useEffect(() => {
    if (open) return;
    packTweenRef.current?.kill();
    packFromRef.current = null;
    setPacking(false);
    setIndex(0);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setIndex(0);
    const refresh = () => {
      const next = steps.filter((item) => !item.target || visibleTarget(item.target));
      setVisibleSteps((current) => {
        const resolved = next.length ? next : steps;
        if (current.length === resolved.length && current.every((item, i) => item.id === resolved[i].id)) {
          return current;
        }
        return resolved;
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 200);
    return () => window.clearInterval(timer);
  }, [open, steps]);

  useLayoutEffect(() => {
    if (!open) return;
    visibleTarget(step?.target)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [open, index, step?.target]);

  useLayoutEffect(() => {
    if (!open || packing) return undefined;
    const update = () => {
      const nodes = visibleTargets(step?.target);
      setSpot(nodes.length ? paddedRect(unionRect(nodes), pad) : null);
      const card = cardRef.current;
      if (!card) return;
      const rect = card.getBoundingClientRect();
      setCardSize((current) => (
        Math.abs(rect.width - current.width) > 2 || Math.abs(rect.height - current.height) > 2
          ? { width: rect.width, height: rect.height }
          : current
      ));
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    const timer = window.setInterval(update, 160);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.clearInterval(timer);
    };
  }, [open, step?.target, index, pad, packing]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useLayoutEffect(() => {
    if (!packing || !packFromRef.current) return undefined;
    const { cardRect, dockRect } = packFromRef.current;
    const card = cardRef.current;
    const dock = document.querySelector(PRODUCT_GUIDE_DOCK_SELECTOR);
    const root = card?.closest(".product-guide");
    if (!card || !dock || !root) {
      onClose();
      return undefined;
    }
    const mask = root.querySelector(".product-guide__mask");
    const spotlight = root.querySelector(".product-guide__spot");
    gsap.set(card, {
      left: cardRect.left,
      top: cardRect.top,
      width: cardRect.width,
      height: cardRect.height,
      x: 0,
      y: 0,
      xPercent: 0,
      yPercent: 0,
      transformOrigin: "center center",
    });
    dock.classList.add("is-receiving");
    const tween = gsap.timeline({
      onComplete: () => {
        dock.classList.remove("is-receiving");
        gsap.set(dock, { clearProps: "transform" });
        onCloseRef.current();
      },
    });
    packTweenRef.current = tween;
    tween.to([mask, spotlight].filter(Boolean), { opacity: 0, duration: 0.2, ease: "power1.out" }, 0);
    tween.to(card, {
      left: dockRect.left + dockRect.width / 2 - cardRect.width / 2,
      top: dockRect.top + dockRect.height / 2 - cardRect.height / 2,
      scale: 0.08,
      opacity: 0,
      duration: 0.48,
      ease: "power2.in",
    }, 0);
    tween.fromTo(dock, { scale: 1 }, {
      scale: 1.12,
      duration: 0.16,
      yoyo: true,
      repeat: 1,
      ease: "power1.out",
      transformOrigin: "center center",
    }, 0.32);
    return () => tween.kill();
  }, [packing]);

  function finish(pack = false) {
    if (packing) return;
    if (storageKey) markProductGuideSeen(storageKey);
    const card = cardRef.current;
    const dock = document.querySelector(PRODUCT_GUIDE_DOCK_SELECTOR);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!pack || !card || !dock || !isVisibleTarget(dock) || reduceMotion) {
      onCloseRef.current();
      return;
    }
    packFromRef.current = {
      cardRect: card.getBoundingClientRect(),
      dockRect: dock.getBoundingClientRect(),
    };
    setPacking(true);
  }

  function goNext() {
    if (index >= visibleSteps.length - 1) {
      finish(true);
      return;
    }
    setIndex((value) => value + 1);
  }

  function goPrev() {
    setIndex((value) => Math.max(0, value - 1));
  }

  if (!open || !step) return null;

  const placement = placeTooltip(spot, Boolean(step.target), cardSize.width || cardWidth, cardSize.height);
  const total = Math.max(1, visibleSteps.length);
  const isLast = index >= visibleSteps.length - 1;

  return createPortal(
    <div className={`product-guide${dark ? " is-dark" : ""}${packing ? " is-packing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="product-guide-title">
      <div className="product-guide__mask" aria-hidden="true" />
      {spot ? (
        <div
          className="product-guide__spot"
          style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }}
        />
      ) : null}
      <section
        ref={cardRef}
        className={`product-guide__card is-${placement.side}${spot ? " is-anchored" : ""}${isLast ? " is-last" : ""}${packing ? " is-packing" : ""}`}
        style={packing && packFromRef.current
          ? {
            left: packFromRef.current.cardRect.left,
            top: packFromRef.current.cardRect.top,
            width: packFromRef.current.cardRect.width,
            height: packFromRef.current.cardRect.height,
            transform: "none",
          }
          : placement.style}
      >
        <i className="product-guide__caret" aria-hidden="true" />
        <div className="product-guide__head">
          <span className="product-guide__badge">第 {index + 1} / {total} 步</span>
        </div>
        <h2 id="product-guide-title">{step.title}</h2>
        <p>{step.body}</p>
        {isLast ? (
          <p className="product-guide__hint">
            关闭引导：到右上角头像 → 账号设置 → 操作引导。
          </p>
        ) : null}
        <div className="product-guide__foot">
          <div className="product-guide__dots" role="tablist" aria-label="引导步骤">
            {visibleSteps.map((item, itemIndex) => (
              <button
                key={item.id || item.title}
                type="button"
                role="tab"
                aria-label={`第 ${itemIndex + 1} 步`}
                aria-selected={itemIndex === index}
                className={itemIndex === index ? "is-on" : ""}
                onClick={() => setIndex(itemIndex)}
              />
            ))}
          </div>
          <div className="product-guide__actions">
            {index > 0 ? <button type="button" className="is-ghost" onClick={goPrev}>上一步</button> : null}
            {isLast ? (
              <button type="button" className="is-settings" onClick={() => setIndex(0)}>
                重新引导
              </button>
            ) : (
              <button type="button" className="product-guide__skip" onClick={() => finish(true)}>
                智能跳过
              </button>
            )}
            <button type="button" className="is-primary" onClick={goNext}>
              {isLast ? finishLabel : "下一步"}
            </button>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export { markProductGuideSeen };
