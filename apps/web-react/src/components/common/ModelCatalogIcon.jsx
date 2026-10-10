import { useEffect, useState } from "react";
import { SoftMark } from "./SoftMark.jsx";
import "./ModelCatalogIcon.css";

export function isCatalogModelMaintenance(model) {
  return model?.maintenance === true || String(model?.status || "").toLowerCase() === "maintenance";
}

export function availableCatalogModels(models) {
  return (Array.isArray(models) ? models : []).filter((model) => !isCatalogModelMaintenance(model));
}

export function ModelCatalogIcon({ model, size = "sm", className = "" }) {
  const source = String(model?.iconUrl || "").trim();
  const [failedSource, setFailedSource] = useState("");

  useEffect(() => {
    if (failedSource && failedSource !== source) setFailedSource("");
  }, [failedSource, source]);

  if (!source || failedSource === source) {
    return <SoftMark name="cpu" size={size} className={className} />;
  }

  return (
    <span
      className={["sc-model-catalog-icon", `sc-model-catalog-icon--${size}`, className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <img src={source} alt="" decoding="async" onError={() => setFailedSource(source)} />
    </span>
  );
}

export function ModelMaintenanceBadge({ model, className = "" }) {
  if (!isCatalogModelMaintenance(model)) return null;
  return <span className={["sc-model-maintenance-badge", className].filter(Boolean).join(" ")}>维护中</span>;
}
