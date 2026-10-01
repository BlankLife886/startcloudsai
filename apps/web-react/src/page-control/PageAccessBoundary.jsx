import { useEffect } from "react";
import { Outlet, useLocation } from "react-router";
import { PAGE_STATUS, pageControlForLocation } from "../config/pageControls.js";
import { StatusBackButton, StatusShowcase } from "../components/status/StatusShowcase.jsx";
import { usePageControls } from "./PageControlContext.jsx";
import "./page-access.css";

const STATUS_KIND = {
  [PAGE_STATUS.MAINTENANCE]: "maintenance",
  [PAGE_STATUS.DEVELOPING]: "developing",
  [PAGE_STATUS.REMOVED]: "removed",
};

const STATUS_DOCUMENT_TITLE = {
  maintenance: "页面维护中",
  developing: "页面开发中",
  removed: "页面已下架",
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
  const kind = STATUS_KIND[control.status] || "maintenance";
  useEffect(() => {
    const previous = document.title;
    document.title = `${STATUS_DOCUMENT_TITLE[kind] || "暂时无法访问"} · 星空云绘`;
    return () => {
      document.title = previous;
    };
  }, [kind]);

  return (
    <StatusShowcase
      kind={kind}
      reason={control.reason}
      actions={<StatusBackButton />}
    />
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
