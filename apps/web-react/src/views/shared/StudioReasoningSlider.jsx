import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import "./StudioReasoningSlider.css";

gsap.registerPlugin(useGSAP);

const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const rank = (value) => {
  const index = EFFORT_ORDER.indexOf(String(value).toLowerCase());
  return index < 0 ? EFFORT_ORDER.length : index;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, amount) => from + (to - from) * amount;

export function StudioReasoningSlider({ options, value, onChange, onClose, renderPrice, modelLabel, style, className }) {
  const rootRef = useRef(null);
  const railRef = useRef(null);
  const thumbRef = useRef(null);
  const resetRef = useRef(null);
  const inputRef = useRef(null);
  const live = useRef({
    ratio: 0,
    nearest: 0,
    dragging: false,
    grab: 0,
    onThumb: false,
    pointerId: null,
    startX: 0,
    lastX: 0,
    velocity: 0,
    lastTs: 0,
  });
  const latest = useRef({ last: 0, stops: [], onChange, motionOff: false });
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(-1);
  const [motionOff, setMotionOff] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.classList.contains("settings-no-animations"));
  const stops = useMemo(() => options.filter(option => !option.disabled)
    .slice().sort((a, b) => rank(a.value) - rank(b.value)), [options]);
  const index = Math.max(0, stops.findIndex(option => String(option.value) === String(value)));
  const last = Math.max(0, stops.length - 1);
  const shownIndex = dragging && preview >= 0 ? preview : index;
  const selected = stops[shownIndex] || stops[index];
  const position = last ? index / last : 0;
  const extreme = Boolean(selected) && shownIndex === last && last > 0;
  latest.current = { last, stops, onChange, motionOff };

  const metrics = () => {
    const width = railRef.current?.offsetWidth || 0;
    const size = thumbRef.current?.offsetWidth || 28;
    const styles = rootRef.current ? getComputedStyle(rootRef.current) : null;
    const thumb = Number.parseFloat(styles?.getPropertyValue("--thumb") || "") || size;
    const inset = Number.parseFloat(styles?.getPropertyValue("--inset") || "") || 4;
    const pad = inset + thumb / 2;
    return { pad, travel: Math.max(0, width - pad * 2) };
  };

  const thumbX = (ratio) => {
    const { pad, travel } = metrics();
    return pad + ratio * travel;
  };

  // Soft notch pull while dragging so stops feel tactile.
  const magnetize = (ratio) => {
    const max = latest.current.last;
    if (max < 1) return ratio;
    const step = 1 / max;
    const nearest = Math.round(ratio * max) / max;
    const dist = Math.abs(ratio - nearest);
    const zone = step * 0.42;
    if (dist >= zone) return ratio;
    const t = 1 - dist / zone;
    return lerp(ratio, nearest, 0.22 + t * t * 0.55);
  };

  const pulseThumb = (amount = "soft") => {
    const thumb = thumbRef.current;
    if (!thumb || latest.current.motionOff) return;
    const pressed = live.current.dragging;
    const peak = amount === "tick"
      ? (pressed ? 1.05 : 1.06)
      : (pressed ? 1.03 : 1.04);
    gsap.fromTo(thumb, { scale: peak }, {
      scale: pressed ? 1.01 : 1,
      duration: amount === "tick" ? 0.22 : 0.28,
      ease: "power2.out",
      overwrite: "scale",
    });
  };

  const placeThumb = (ratio, mode) => {
    const thumb = thumbRef.current;
    if (!thumb) return;
    live.current.ratio = ratio;
    rootRef.current?.style.setProperty("--heat", String(ratio));
    const x = thumbX(ratio);
    if (latest.current.motionOff || mode === "set" || mode === "drag") {
      gsap.set(thumb, { x, xPercent: -50 });
      return;
    }
    const distance = Math.abs(x - (Number(gsap.getProperty(thumb, "x")) || 0));
    const isClick = mode === "click" || mode === "snap";
    const duration = isClick
      ? clamp(0.34 + distance / 520, 0.34, 0.56)
      : 0.34;
    gsap.to(thumb, {
      x,
      xPercent: -50,
      duration,
      ease: mode === "click" ? "power3.out" : "power2.out",
      overwrite: "auto",
    });
  };

  const ratioFromEvent = (event) => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return live.current.ratio;
    const { pad, travel } = metrics();
    if (travel <= 0) return 0;
    return clamp((event.clientX - live.current.grab - rect.left - pad) / travel, 0, 1);
  };

  const commitRatio = (ratio, velocity = 0, { pulse = true, mode = "snap" } = {}) => {
    const { last: max, stops: list, onChange: change } = latest.current;
    let next = Math.round(ratio * max);
    // Light flick bias toward travel direction when near a midpoint.
    if (max > 0 && Math.abs(velocity) > 0.55) {
      const raw = ratio * max;
      const frac = raw - Math.floor(raw);
      if (velocity > 0 && frac > 0.28 && frac < 0.72) next = Math.min(max, Math.ceil(raw));
      if (velocity < 0 && frac > 0.28 && frac < 0.72) next = Math.max(0, Math.floor(raw));
    }
    next = clamp(next, 0, max);
    placeThumb(max ? next / max : 0, mode);
    if (pulse) pulseThumb(mode === "click" ? "soft" : "tick");
    const option = list[next];
    if (option) change(option.value);
    return next;
  };

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotionOff(media.matches || document.documentElement.classList.contains("settings-no-animations"));
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    media.addEventListener("change", update);
    return () => { observer.disconnect(); media.removeEventListener("change", update); };
  }, []);

  const { contextSafe } = useGSAP(() => {
    const root = rootRef.current;
    const thumb = thumbRef.current;
    const rail = railRef.current;
    if (!root || !thumb) return;
    gsap.set(thumb, { x: thumbX(position), xPercent: -50, scale: 1 });
    live.current.ratio = position;
    root.style.setProperty("--heat", String(position));
    live.current.nearest = index;
    const onResize = () => { if (!live.current.dragging) placeThumb(live.current.ratio, "set"); };
    const observer = rail ? new ResizeObserver(onResize) : null;
    observer?.observe(rail);
    if (!motionOff) {
      gsap.fromTo(root, { opacity: 0, y: 6, scale: 0.985 }, {
        opacity: 1, y: 0, scale: 1, duration: 0.28, ease: "power3.out",
      });
    }
    return () => observer?.disconnect();
  }, { scope: rootRef, dependencies: [motionOff] });

  useGSAP(() => {
    if (live.current.dragging || Math.abs(live.current.ratio - position) < 0.001) return;
    placeThumb(position, "snap");
    live.current.nearest = index;
  }, { dependencies: [position, index] });

  useGSAP(() => {
    if (!extreme || motionOff) return;
    const rays = rootRef.current?.querySelectorAll(".studio-reasoning__spark");
    if (!rays?.length) return;
    gsap.fromTo(rays, { x: 0, y: 0, opacity: 0.85, scale: 0.55 }, {
      x: sparkIndex => [-18, -11, 7, 16, -14, 12, -6, 9][sparkIndex],
      y: sparkIndex => [-10, -16, -8, 4, 11, 15, -13, 8][sparkIndex],
      opacity: 0,
      scale: 0.05,
      duration: 0.85,
      stagger: 0.04,
      repeat: dragging ? -1 : 1,
      repeatDelay: 0.22,
      ease: "power2.out",
    });
  }, { scope: rootRef, dependencies: [extreme, dragging, motionOff, selected?.value], revertOnUpdate: true });

  if (!selected) return null;

  const close = () => {
    rootRef.current?.parentElement.querySelector(".studio-composer__control")?.focus({ preventScroll: true });
    onClose?.();
  };

  const onPointerMove = contextSafe((event) => {
    if (!live.current.dragging || event.pointerId !== live.current.pointerId) return;
    const now = event.timeStamp || performance.now();
    const dt = Math.max(8, now - (live.current.lastTs || now));
    live.current.velocity = (event.clientX - live.current.lastX) / dt;
    live.current.lastX = event.clientX;
    live.current.lastTs = now;

    const raw = ratioFromEvent(event);
    const ratio = magnetize(raw);
    const next = Math.round(ratio * last);
    placeThumb(ratio, "drag");
    if (next !== live.current.nearest) {
      live.current.nearest = next;
      setPreview(next);
      pulseThumb("tick");
    }
  });

  const onPointerUp = contextSafe((event) => {
    if (!live.current.dragging || (event.pointerId != null && event.pointerId !== live.current.pointerId)) return;
    const clickSettle = !live.current.onThumb
      && Math.abs(event.clientX - live.current.startX) < 6
      && Math.abs(live.current.velocity) < 0.2;
    live.current.dragging = false;
    live.current.pointerId = null;
    live.current.grab = 0;
    live.current.onThumb = false;
    const velocity = live.current.velocity;
    live.current.velocity = 0;
    const next = commitRatio(
      magnetize(ratioFromEvent(event)),
      velocity,
      { pulse: false, mode: clickSettle ? "click" : "snap" },
    );
    setPreview(next);
    setDragging(false);
    const thumb = thumbRef.current;
    if (thumb && !latest.current.motionOff) {
      gsap.to(thumb, {
        scale: 1,
        duration: clickSettle ? 0.28 : 0.24,
        ease: "power2.out",
        overwrite: "scale",
      });
    } else if (thumb) {
      gsap.set(thumb, { scale: 1 });
    }
  });

  const onPointerDown = contextSafe((event) => {
    if (last < 1 || event.button) return;
    event.preventDefault();
    const thumbBox = thumbRef.current?.getBoundingClientRect();
    const onThumb = Boolean(thumbBox)
      && event.clientX >= thumbBox.left
      && event.clientX <= thumbBox.right
      && event.clientY >= thumbBox.top
      && event.clientY <= thumbBox.bottom;
    live.current.grab = onThumb ? event.clientX - (thumbBox.left + thumbBox.width / 2) : 0;
    live.current.onThumb = onThumb;
    live.current.dragging = true;
    live.current.pointerId = event.pointerId;
    live.current.startX = event.clientX;
    live.current.lastX = event.clientX;
    live.current.lastTs = event.timeStamp || performance.now();
    live.current.velocity = 0;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    const thumb = thumbRef.current;
    if (thumb && !latest.current.motionOff && onThumb) {
      gsap.to(thumb, { scale: 0.96, duration: 0.16, ease: "power2.out", overwrite: "scale" });
    }
    const ratio = magnetize(ratioFromEvent(event));
    const next = Math.round(ratio * last);
    // Track click: glide instead of teleporting to the pointer.
    placeThumb(ratio, onThumb ? "drag" : "click");
    live.current.nearest = next;
    setPreview(next);
  });

  const selectStop = contextSafe((stopIndex) => {
    const option = stops[stopIndex];
    if (!option) return;
    placeThumb(last ? stopIndex / last : 0, "click");
    pulseThumb("soft");
    onChange(option.value);
  });

  const reset = contextSafe(() => {
    const first = stops[0];
    if (!first) return;
    if (resetRef.current && !motionOff) {
      gsap.fromTo(resetRef.current, { rotation: 0 }, { rotation: -360, duration: 0.42, ease: "power2.out" });
    }
    selectStop(0);
  });

  const mark = (stopIndex) => last ? `${(stopIndex / last) * 100}%` : "50%";

  return (
    <div
      ref={rootRef}
      className={["studio-composer__field-menu is-reasoning studio-reasoning", className].filter(Boolean).join(" ")}
      role="group"
      aria-label="推理强度"
      data-effort={selected.value}
      data-stage={shownIndex}
      data-extreme={extreme ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      style={style}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}
    >
      <div className="studio-reasoning__header">
        {modelLabel ? <small className="studio-reasoning__model">{modelLabel}</small> : <span className="studio-reasoning__model" aria-hidden="true" />}
        <div className="studio-reasoning__price">{renderPrice?.(selected)}</div>
      </div>
      <div
        className="studio-reasoning__slider"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={onPointerUp}
      >
        <div className="studio-reasoning__track" ref={railRef} aria-hidden="true">
          <span className="studio-reasoning__rail">
            <i className="studio-reasoning__glimmer" aria-hidden="true" />
          </span>
          <span className="studio-reasoning__thumb" ref={thumbRef}>
            <span className="studio-reasoning__sparks">{Array.from({ length: 8 }, (_, sparkIndex) => <i key={sparkIndex} className="studio-reasoning__spark" />)}</span>
          </span>
        </div>
        <input
          ref={inputRef}
          type="range"
          min="0"
          max={last}
          step="1"
          value={index}
          disabled={stops.length < 2}
          aria-label="推理强度"
          aria-valuetext={selected.label}
          onChange={event => {
            selectStop(Number(event.target.value));
          }}
        />
      </div>
      <button
        type="button"
        className="studio-reasoning__reset"
        aria-label="恢复默认推理强度"
        disabled={index === 0}
        onClick={reset}
      >
        <svg ref={resetRef} viewBox="0 0 24 24" aria-hidden="true">
          <path d="M19.6 12a7.6 7.6 0 1 1-2.2-5.4" />
          <path d="M19.7 5.2v4.2h-4.2" />
        </svg>
      </button>
      <div className="studio-reasoning__stops">
        {stops.map((option, stopIndex) => {
          const edge = stopIndex === 0 ? "start" : stopIndex === last ? "end" : undefined;
          return (
            <button
              key={option.value}
              type="button"
              aria-label={`选择${option.label}推理`}
              aria-pressed={stopIndex === shownIndex}
              data-edge={edge}
              style={{ left: mark(stopIndex) }}
              onClick={() => selectStop(stopIndex)}
            >{option.label}</button>
          );
        })}
      </div>
    </div>
  );
}
