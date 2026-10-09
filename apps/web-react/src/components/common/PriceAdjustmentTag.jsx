import { resolvePriceAdjustment } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import "./PriceAdjustmentTag.css";

// 模型价格旁的「限时降 20%」标签；悬停显示规则名称和结束时间（北京时间）。
// compact 用于很窄的下拉框，只显示「−20%」。
export function PriceAdjustmentTag({ model, className = "", compact = false }) {
  const adjustment = resolvePriceAdjustment(model);
  if (!adjustment) return null;
  return (
    <span
      className={["sc-price-adjust-tag", `is-${adjustment.direction}`, className].filter(Boolean).join(" ")}
      title={compact ? `${adjustment.label} · ${adjustment.title}` : adjustment.title}
    >
      <i className={`bi ${adjustment.direction === "down" ? "bi-lightning-charge-fill" : "bi-graph-up-arrow"}`} aria-hidden="true" />
      {compact ? adjustment.short : adjustment.label}
    </span>
  );
}
