import { Link } from "react-router";
import { ECOMMERCE_RAIL_MODES } from "./ecommerceTools.js";
import { PAGE_STATUS } from "../../config/pageControls.js";
import "@react/legacy-styles/generated/views/EcommerceDesignView.css";
import "./EcommerceModuleStatus.css";

const STATUS_COPY = {
  [PAGE_STATUS.MAINTENANCE]: {
    eyebrow: "TEMPORARILY UNAVAILABLE",
    title: "模块维护中",
    icon: "bi-tools",
  },
  [PAGE_STATUS.DEVELOPING]: {
    eyebrow: "COMING SOON",
    title: "模块正在开发",
    icon: "bi-code-slash",
  },
};

export function EcommerceModuleStatus({
  mode,
  control,
  availableModeIds,
  overlay = false,
}) {
  const copy =
    STATUS_COPY[control.status] || STATUS_COPY[PAGE_STATUS.MAINTENANCE];
  const available = new Set(availableModeIds);
  const mobileModes = ECOMMERCE_RAIL_MODES.filter((item) =>
    available.has(item.id),
  );

  return (
    <section
      className={`commerce-studio ecommerce-module-state${overlay ? " is-overlay" : ""}`}
      data-ecommerce-business={mode.id}
      aria-labelledby="ecommerce-module-state-title"
    >
      <div className="commerce-atmosphere" aria-hidden="true" />
      <nav
        className="ecommerce-module-state__mobile-tools"
        aria-label="可用电商工具"
      >
        {mobileModes.map((item) => (
          <Link
            key={item.id}
            to={`/ecommerce-design?tool=${item.id}`}
            className={item.id === mode.id ? "active" : ""}
          >
            <i className={`bi ${item.icon}`} aria-hidden="true" />
            <span>{item.shortLabel || item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="ecommerce-module-state__content">
        <span className="ecommerce-module-state__icon" aria-hidden="true">
          <i className={`bi ${copy.icon}`} />
        </span>
        <p>{copy.eyebrow}</p>
        <h2 id="ecommerce-module-state-title">{copy.title}</h2>
        <strong>{mode.shortLabel || mode.label}</strong>
        <span>
          {control.reason || "该模块暂时无法使用，请选择其它电商工具。"}
        </span>
      </div>
    </section>
  );
}
