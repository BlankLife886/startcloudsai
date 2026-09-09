import { useId } from "react";
import { initialExactImageSize, normalizeExactSizeCapabilities, validateExactImageSize } from "../config/exactImageSize.js";
import "./ExactImageSizeControl.css";

export function ExactImageSizeControl({ model, mode = "ratio", width = "", height = "", onChange, disabled = false }) {
  const descriptionId = useId();
  const { supportsExactSize, exactSizeLimits: limits } = normalizeExactSizeCapabilities(model);
  const exact = mode === "exact";
  if (!supportsExactSize && !exact) return null;
  const result = validateExactImageSize(model, width, height);
  const selectMode = (nextMode) => {
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
  return <fieldset className="exact-size-control" disabled={disabled}>
    <div className="exact-size-control__modes" role="group" aria-label="尺寸方式">
      <button type="button" aria-pressed={!exact} onClick={() => selectMode("ratio")}>比例尺寸</button>
      <button type="button" aria-pressed={exact} disabled={!supportsExactSize} onClick={() => selectMode("exact")}>精确尺寸</button>
    </div>
    {exact && <>
      <div className="exact-size-control__fields">
        <label>宽 (px)<input type="number" inputMode="numeric" disabled={!supportsExactSize} min={Math.ceil(limits.minWidth / limits.step) * limits.step} max={Math.floor(limits.maxWidth / limits.step) * limits.step} step={limits.step} value={width} aria-describedby={descriptionId} aria-invalid={!result.valid} onChange={(event) => onChange({ exactWidth: event.target.value })} /></label>
        <label>高 (px)<input type="number" inputMode="numeric" disabled={!supportsExactSize} min={Math.ceil(limits.minHeight / limits.step) * limits.step} max={Math.floor(limits.maxHeight / limits.step) * limits.step} step={limits.step} value={height} aria-describedby={descriptionId} aria-invalid={!result.valid} onChange={(event) => onChange({ exactHeight: event.target.value })} /></label>
      </div>
      <p id={descriptionId} className="exact-size-control__hint">{supportsExactSize ? constraints : "已保留当前宽高，请重新选择支持精确尺寸的可用模型。"}</p>
      {!result.valid && <p className="exact-size-control__error" role="alert">{result.error}</p>}
    </>}
  </fieldset>;
}
