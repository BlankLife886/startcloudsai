import { useNavigate } from "react-router";
import "./StatusShowcase.css";

const STATUS_ART = {
  developing: { src: "/sucai/development.webp", alt: "页面开发中" },
  maintenance: { src: "/sucai/maintenance.webp", alt: "页面维护中" },
  removed: { src: "/sucai/unavailable.webp", alt: "页面下架" },
  unavailable: { src: "/sucai/unavailable.webp", alt: "页面不可用" },
  notfound: { src: "/sucai/404.webp", alt: "页面未找到" },
};

export function goToPreviousPage(navigate) {
  if (window.history.length > 1) navigate(-1);
  else navigate("/");
}

export function StatusBackButton({ className = "is-primary" }) {
  const navigate = useNavigate();
  return (
    <button className={className} type="button" onClick={() => goToPreviousPage(navigate)}>
      <i className="bi bi-arrow-left" aria-hidden="true" />
      返回上一页
    </button>
  );
}

/**
 * @param {{
 *   kind?: keyof typeof STATUS_ART,
 *   eyebrow?: string,
 *   title?: string,
 *   label?: string,
 *   reason?: string,
 *   compact?: boolean,
 *   actions?: import("react").ReactNode,
 * }} props
 */
export function StatusShowcase({
  kind = "unavailable",
  eyebrow = "",
  title = "",
  label = "",
  reason = "",
  compact = false,
  actions = null,
}) {
  const art = STATUS_ART[kind] || STATUS_ART.unavailable;
  const hasCopy = Boolean(eyebrow || title || label || reason || actions);
  return (
    <section className={`status-showcase is-${kind}${compact ? " is-compact" : ""}`} aria-label={title || art.alt}>
      <figure className="status-showcase__art">
        <i aria-hidden="true" />
        <img src={art.src} alt={art.alt} width="1254" height="1254" decoding="async" fetchPriority="high" />
      </figure>
      {hasCopy ? (
        <div className="status-showcase__copy">
          {eyebrow ? <p className="status-showcase__eyebrow">{eyebrow}</p> : null}
          {title ? <h1>{title}</h1> : null}
          {label ? <strong>{label}</strong> : null}
          {reason ? <p className="status-showcase__reason">{reason}</p> : null}
          {actions ? <div className="status-showcase__actions">{actions}</div> : null}
        </div>
      ) : null}
    </section>
  );
}
