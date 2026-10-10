import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import { initialExactImageSize, normalizeExactSizeCapabilities, validateExactImageSize } from "../config/exactImageSize.js";
import "./ExactImageSizeControl.css";

function modeMotionDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

function clampStep(value, min, max, step) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  const snapped = Math.round(numeric / step) * step;
  return Math.min(max, Math.max(min, snapped));
}

function SizeField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  invalid,
  describedBy,
  onChange,
}) {
  const fieldId = useId();
  const valueRef = useRef(value);
  const holdRef = useRef({ delayId: 0, repeatId: 0, direction: 0 });

  valueRef.current = value;

  const stopHold = useCallback(() => {
    const hold = holdRef.current;
    if (hold.delayId) window.clearTimeout(hold.delayId);
    if (hold.repeatId) window.clearInterval(hold.repeatId);
    hold.delayId = 0;
    hold.repeatId = 0;
    hold.direction = 0;
  }, []);

  const applyNudge = useCallback((direction) => {
    const current = Number(valueRef.current);
    const base = Number.isFinite(current) && current > 0 ? current : min;
    const next = clampStep(base + direction * step, min, max, step);
    if (String(next) === String(valueRef.current)) {
      stopHold();
      return false;
    }
    valueRef.current = String(next);
    onChange(String(next));
    return true;
  }, [max, min, onChange, step, stopHold]);

  const startHold = useCallback((direction, event) => {
    if (disabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    stopHold();
    holdRef.current.direction = direction;
    applyNudge(direction);
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      /* ignore */
    }
    holdRef.current.delayId = window.setTimeout(() => {
      let ticks = 0;
      holdRef.current.repeatId = window.setInterval(() => {
        ticks += 1;
        // After a short while, nudge faster (2 steps).
        const stride = ticks > 12 ? 2 : 1;
        for (let index = 0; index < stride; index += 1) {
          if (!applyNudge(direction)) break;
        }
      }, 55);
    }, 360);
  }, [applyNudge, disabled, stopHold]);

  useEffect(() => () => stopHold(), [stopHold]);

  return (
    <div className="exact-size-control__field">
      <label htmlFor={fieldId}>{label}</label>
      <div className={`exact-size-control__stepper${invalid ? " is-invalid" : ""}${disabled ? " is-disabled" : ""}`}>
        <button
          type="button"
          className="exact-size-control__step"
          aria-label={`减少${label}`}
          disabled={disabled || Number(value) <= min}
          onPointerDown={(event) => startHold(-1, event)}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          onLostPointerCapture={stopHold}
          onContextMenu={(event) => event.preventDefault()}
        >
          <i className="bi bi-dash" aria-hidden="true" />
        </button>
        <input
          id={fieldId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          value={value}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          onChange={(event) => {
            const next = event.target.value.replace(/[^\d]/g, "");
            onChange(next);
          }}
          onBlur={() => {
            if (!value) return;
            onChange(String(clampStep(value, min, max, step)));
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") {
              event.preventDefault();
              applyNudge(1);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              applyNudge(-1);
            }
          }}
        />
        <button
          type="button"
          className="exact-size-control__step"
          aria-label={`增加${label}`}
          disabled={disabled || Number(value) >= max}
          onPointerDown={(event) => startHold(1, event)}
          onPointerUp={stopHold}
          onPointerCancel={stopHold}
          onLostPointerCapture={stopHold}
          onContextMenu={(event) => event.preventDefault()}
        >
          <i className="bi bi-plus" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function ExactImageSizeControl({ model, mode = "ratio", width = "", height = "", onChange, disabled = false }) {
  const descriptionId = useId();
  const modesRef = useRef(null);
  const thumbRef = useRef(null);
  const readyRef = useRef(false);
  const { supportsExactSize, exactSizeLimits: limits } = normalizeExactSizeCapabilities(model);
  const exact = mode === "exact";
  const visible = supportsExactSize || exact;
  const result = validateExactImageSize(model, width, height);
  const minWidth = Math.ceil(limits.minWidth / limits.step) * limits.step;
  const maxWidth = Math.floor(limits.maxWidth / limits.step) * limits.step;
  const minHeight = Math.ceil(limits.minHeight / limits.step) * limits.step;
  const maxHeight = Math.floor(limits.maxHeight / limits.step) * limits.step;

  const syncThumb = useCallback((animate) => {
    const root = modesRef.current;
    const thumb = thumbRef.current;
    const active = root?.querySelector('button[aria-pressed="true"]');
    if (!root || !thumb || !active) return;
    const rootBox = root.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    const shouldAnimate = animate && readyRef.current && !modeMotionDisabled();
    thumb.style.transition = shouldAnimate ? "" : "none";
    thumb.style.width = `${Math.round(box.width)}px`;
    thumb.style.height = `${Math.round(box.height)}px`;
    thumb.style.transform = `translate3d(${Math.round(box.left - rootBox.left)}px, ${Math.round(box.top - rootBox.top)}px, 0)`;
    thumb.style.opacity = "1";
    root.classList.add("is-ready");
    readyRef.current = true;
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    readyRef.current = false;
    syncThumb(false);
  }, [supportsExactSize, syncThumb, visible]);

  useLayoutEffect(() => {
    if (!visible) return;
    syncThumb(true);
  }, [exact, syncThumb, visible]);

  useEffect(() => {
    const root = modesRef.current;
    if (!visible || !root || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => syncThumb(false));
    observer.observe(root);
    return () => observer.disconnect();
  }, [syncThumb, visible]);

  if (!visible) return null;

  const selectMode = (nextMode, event) => {
    if (event?.detail > 0) event.currentTarget.blur();
    if (nextMode === mode) return;
    const initial = nextMode === "exact" ? initialExactImageSize(model) : { width: "", height: "" };
    onChange({ sizeMode: nextMode, exactWidth: String(initial.width), exactHeight: String(initial.height) });
  };
  const constraints = [
    `宽 ${limits.minWidth}–${limits.maxWidth} px，高 ${limits.minHeight}–${limits.maxHeight} px`,
    `步长 ${limits.step} px`,
    limits.minPixels ? `总像素至少 ${limits.minPixels.toLocaleString("zh-CN")}` : "",
    limits.maxPixels ? `总像素最多 ${limits.maxPixels.toLocaleString("zh-CN")}` : "",
    limits.maxAspectRatio ? `长短边比不超过 ${limits.maxAspectRatio}:1` : "",
  ].filter(Boolean).join("；");

  return (
    <fieldset className="exact-size-control" disabled={disabled}>
      <div ref={modesRef} className="exact-size-control__modes" role="group" aria-label="尺寸方式">
        <span className="exact-size-control__thumb" ref={thumbRef} aria-hidden="true" />
        <button type="button" aria-pressed={!exact} onClick={(event) => selectMode("ratio", event)}>比例尺寸</button>
        <button type="button" aria-pressed={exact} disabled={!supportsExactSize} onClick={(event) => selectMode("exact", event)}>精确尺寸</button>
      </div>
      {exact ? (
        <>
          <div className="exact-size-control__fields">
            <SizeField
              label="宽 (px)"
              value={width}
              min={minWidth}
              max={maxWidth}
              step={limits.step}
              disabled={disabled || !supportsExactSize}
              invalid={!result.valid && Boolean(width)}
              describedBy={descriptionId}
              onChange={(next) => onChange({ exactWidth: next })}
            />
            <SizeField
              label="高 (px)"
              value={height}
              min={minHeight}
              max={maxHeight}
              step={limits.step}
              disabled={disabled || !supportsExactSize}
              invalid={!result.valid && Boolean(height)}
              describedBy={descriptionId}
              onChange={(next) => onChange({ exactHeight: next })}
            />
          </div>
          <p id={descriptionId} className="exact-size-control__hint">{supportsExactSize ? constraints : "已保留当前宽高，请重新选择支持精确尺寸的可用模型。"}</p>
          {!result.valid && <p className="exact-size-control__error" role="alert">{result.error}</p>}
        </>
      ) : null}
    </fieldset>
  );
}
