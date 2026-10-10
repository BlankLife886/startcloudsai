import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { ModelCatalogIcon } from "../../components/common/ModelCatalogIcon.jsx";
import "./HomeModelMarquee.css";

gsap.registerPlugin(useGSAP);

const PIXELS_PER_SECOND = 32;

export function HomeModelMarquee({ models, motionOff = false }) {
  const rootRef = useRef(null);
  const viewportRef = useRef(null);
  const trackRef = useRef(null);
  const groupRef = useRef(null);
  const offsetRef = useRef(0);

  useGSAP((context, contextSafe) => {
    if (!models.length) return;

    const viewport = viewportRef.current;
    if (motionOff) {
      viewport.scrollLeft = offsetRef.current;
      const rememberScroll = () => { offsetRef.current = viewport.scrollLeft; };
      viewport.addEventListener("scroll", rememberScroll, { passive: true });
      return () => {
        rememberScroll();
        viewport.removeEventListener("scroll", rememberScroll);
      };
    }

    const track = trackRef.current;
    let tween;
    let distance = 0;
    let visible = false;
    let hovered = window.matchMedia("(hover: hover)").matches && viewport.matches(":hover");
    let focused = viewport.contains(document.activeElement);
    let dragging = false;
    let tracking = false;
    let pointerId = null;
    let pointerX = 0;
    viewport.scrollLeft = 0;

    const rememberOffset = () => {
      if (tween) offsetRef.current = tween.progress() * distance;
    };
    const syncPlayback = () => {
      if (!tween) return;
      const paused = !visible || document.hidden || hovered || focused || dragging;
      tween.paused(paused);
      rememberOffset();
      if (tracking === !paused) return;
      tracking = !paused;
      if (tracking) gsap.ticker.add(rememberOffset);
      else gsap.ticker.remove(rememberOffset);
    };

    const resize = contextSafe(() => {
      const nextDistance = groupRef.current.getBoundingClientRect().width;
      if (!nextDistance || Math.abs(nextDistance - distance) < 0.5) return;
      const offset = tween ? tween.progress() * distance : offsetRef.current;
      tween?.kill();
      distance = nextDistance;
      // Each group includes the gap at the seam, so the loop never snaps or leaves a blank edge.
      tween = gsap.fromTo(track, { x: 0 }, {
        x: -distance,
        duration: distance / PIXELS_PER_SECOND,
        ease: "none",
        repeat: -1,
        paused: true,
      });
      tween.progress(gsap.utils.wrap(0, distance, offset) / distance);
      syncPlayback();
    });

    const moveBy = (delta) => {
      if (!tween || !distance) return;
      tween.progress(gsap.utils.wrap(0, distance, tween.progress() * distance + delta) / distance);
      rememberOffset();
    };
    const enter = (event) => {
      if (event.pointerType !== "mouse") return;
      hovered = true;
      syncPlayback();
    };
    const leave = () => {
      hovered = false;
      syncPlayback();
    };
    const focus = () => {
      focused = true;
      syncPlayback();
    };
    const blur = (event) => {
      focused = viewport.contains(event.relatedTarget);
      syncPlayback();
    };
    const pointerDown = (event) => {
      if (!event.isPrimary || event.button !== 0) return;
      // Keep mouse dragging from leaving keyboard focus behind and pausing the strip indefinitely.
      if (event.pointerType === "mouse") event.preventDefault();
      pointerId = event.pointerId;
      pointerX = event.clientX;
      dragging = true;
      viewport.dataset.dragging = "true";
      viewport.setPointerCapture(pointerId);
      syncPlayback();
    };
    const pointerMove = (event) => {
      if (event.pointerId !== pointerId) return;
      moveBy(pointerX - event.clientX);
      pointerX = event.clientX;
    };
    const pointerEnd = (event) => {
      if (event.pointerId !== pointerId) return;
      if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      pointerId = null;
      dragging = false;
      delete viewport.dataset.dragging;
      syncPlayback();
    };
    const keyDown = (event) => {
      if (!tween) return;
      if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
        event.preventDefault();
        moveBy(event.key === "ArrowRight" ? 160 : -160);
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        tween.progress(event.key === "Home" ? 0 : Math.max(0, distance - viewport.clientWidth) / distance);
        rememberOffset();
      }
    };
    const wheel = (event) => {
      const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
      if (!horizontal && !event.shiftKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1;
      moveBy((horizontal ? event.deltaX : event.deltaY) * unit);
    };

    const events = {
      pointerenter: enter,
      pointerleave: leave,
      pointerdown: pointerDown,
      pointermove: pointerMove,
      pointerup: pointerEnd,
      pointercancel: pointerEnd,
      lostpointercapture: pointerEnd,
      focusin: focus,
      focusout: blur,
      keydown: keyDown,
    };
    Object.entries(events).forEach(([name, handler]) => viewport.addEventListener(name, handler));
    viewport.addEventListener("wheel", wheel, { passive: false });
    document.addEventListener("visibilitychange", syncPlayback);

    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncPlayback();
    });
    visibilityObserver.observe(rootRef.current);
    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(groupRef.current);
    resize();

    return () => {
      // Sample during playback, not tween callbacks: GSAP's context revert also fires onUpdate.
      gsap.ticker.remove(rememberOffset);
      visibilityObserver.disconnect();
      sizeObserver.disconnect();
      Object.entries(events).forEach(([name, handler]) => viewport.removeEventListener(name, handler));
      viewport.removeEventListener("wheel", wheel);
      document.removeEventListener("visibilitychange", syncPlayback);
      delete viewport.dataset.dragging;
    };
  }, { scope: rootRef, dependencies: [models, motionOff], revertOnUpdate: true });

  if (!models.length) return null;

  return (
    <section
      ref={rootRef}
      className="home-model-marquee"
      aria-label="当前可用模型"
      data-motion={motionOff ? "off" : "on"}
    >
      <div
        ref={viewportRef}
        className="home-model-marquee__viewport"
        role="group"
        aria-label={`横向浏览全部 ${models.length} 个模型`}
        tabIndex={0}
      >
        <div ref={trackRef} className="home-model-marquee__track">
          {[false, true].map((copy) => (
            <ul
              key={String(copy)}
              ref={copy ? undefined : groupRef}
              className="home-model-marquee__group"
              aria-hidden={copy ? "true" : undefined}
            >
              {models.map((model) => (
                <li key={model.id} className="home-model-marquee__model" data-model-id={model.id} title={model.name}>
                  <ModelCatalogIcon model={model} size="lg" className="home-model-marquee__icon" />
                  <span className="home-model-marquee__name">{model.name}</span>
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}
