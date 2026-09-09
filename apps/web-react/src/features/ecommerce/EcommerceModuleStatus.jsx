import { Link } from "react-router";
import { ECOMMERCE_RAIL_MODES } from "./ecommerceTools.js";
import { PAGE_STATUS } from "../../config/pageControls.js";
import { StatusShowcase } from "../../components/status/StatusShowcase.jsx";
import "@react/legacy-styles/generated/views/EcommerceDesignView.css";
import "./EcommerceModuleStatus.css";

const STATUS_KIND = {
  [PAGE_STATUS.MAINTENANCE]: "maintenance",
  [PAGE_STATUS.DEVELOPING]: "developing",
  [PAGE_STATUS.REMOVED]: "removed",
};

export function EcommerceModuleStatus({
  mode,
  control,
  availableModeIds,
  overlay = false,
}) {
  const kind = STATUS_KIND[control.status] || "maintenance";
  const available = new Set(availableModeIds);
  const mobileModes = ECOMMERCE_RAIL_MODES.filter((item) =>
    available.has(item.id),
  );

  return (
    <section
      className={`commerce-studio ecommerce-module-state${overlay ? " is-overlay" : ""}`}
      data-ecommerce-business={mode.id}
      aria-label="模块暂时无法使用"
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
        <StatusShowcase
          kind={kind}
          reason={control.reason}
          compact
        />
      </div>
    </section>
  );
}
