import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router";
import { PAGE_STATUS, pageControlForLocation } from "../config/pageControls.js";
import { usePageControls } from "./PageControlContext.jsx";
import "./page-access.css";

const STATUS_COPY = {
  [PAGE_STATUS.MAINTENANCE]: {
    eyebrow: "TEMPORARILY UNAVAILABLE",
    title: "页面维护中",
    icon: "bi-tools",
  },
  [PAGE_STATUS.DEVELOPING]: {
    eyebrow: "COMING SOON",
    title: "页面正在开发",
    icon: "bi-code-slash",
  },
  [PAGE_STATUS.REMOVED]: {
    eyebrow: "NO LONGER AVAILABLE",
    title: "页面已移除",
    icon: "bi-archive",
  },
};

function LoadingView() {
  return (
    <div
      className="page-access-loading"
      role="status"
      aria-label="正在读取页面状态"
      data-route-motion-ignore
    >
      <span />
    </div>
  );
}

function PageStatusView({ control }) {
  const copy = STATUS_COPY[control.status] || STATUS_COPY[PAGE_STATUS.MAINTENANCE];
  useEffect(() => {
    const previous = document.title;
    document.title = `${copy.title} · 星空云绘`;
    return () => {
      document.title = previous;
    };
  }, [copy.title]);

  return (
    <section className={`page-access-state is-${control.status}`} aria-labelledby="page-access-title">
      <div className="page-access-state__mark" aria-hidden="true">
        <i className={`bi ${copy.icon}`} />
      </div>
      <p>{copy.eyebrow}</p>
      <h1 id="page-access-title">{copy.title}</h1>
      <strong>{control.label}</strong>
      <span>{control.reason || "该页面暂时无法访问，请稍后再试。"}</span>
      <Link to="/">
        <i className="bi bi-house-door" aria-hidden="true" />
        返回首页
      </Link>
    </section>
  );
}

export function PageAccessBoundary() {
  const location = useLocation();
  const { controls, loading } = usePageControls();
  if (loading) return <LoadingView />;
  const control = pageControlForLocation(controls, location.pathname, location.search);
  if (control.status !== PAGE_STATUS.NORMAL) return <PageStatusView control={control} />;
  return <Outlet />;
}
