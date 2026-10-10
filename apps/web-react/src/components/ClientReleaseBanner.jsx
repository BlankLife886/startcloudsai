import { useEffect, useRef, useState } from "react";
import { getLatestChangelog } from "@react/legacy-modules/services/metaApi.js";
import { useLocale } from "../i18n/index.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import updateIcon from "@react/legacy-static/assets/release/update-icon.webp";
import updateRocket from "@react/legacy-static/assets/release/update-rocket.webp";
import "./ClientReleaseBanner.css";

const POLL_MS = 30 * 60 * 1000;
const LOADED_AT_KEY = "starclouds-client-release-loaded-at";

function pageLoadedAt() {
  const origin = Number(performance?.timeOrigin);
  return Number.isFinite(origin) && origin > 0 ? origin : Date.now();
}

try {
  sessionStorage.removeItem(LOADED_AT_KEY);
} catch {
  /* ignore quota / private mode */
}

const PAGE_LOADED_AT = pageLoadedAt();

function publishedAtMs(latest) {
  const value = Date.parse(latest?.publishedAt || latest?.createdAt || "");
  return Number.isFinite(value) ? value : 0;
}

export function ClientReleaseBanner() {
  const { t } = useLocale();
  const { isEntryVisible } = usePageControls();
  const [release, setRelease] = useState(null);
  const dismissedIdRef = useRef("");

  useEffect(() => {
    let active = true;
    let timer = 0;

    const applyLatest = (latest) => {
      if (!latest?.id || latest.id === dismissedIdRef.current) return;
      const publishedAt = publishedAtMs(latest);
      if (!publishedAt || publishedAt <= PAGE_LOADED_AT) {
        setRelease(null);
        return;
      }
      setRelease(latest);
    };

    const poll = () => {
      getLatestChangelog()
        .then((latest) => {
          if (active) applyLatest(latest);
        })
        .catch(() => null);
    };

    poll();
    timer = window.setInterval(poll, POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", poll);

    return () => {
      active = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", poll);
    };
  }, []);

  if (!release) return null;

  return (
    <div className="client-release-banner" role="status" aria-live="polite">
      <img className="client-release-banner__icon" src={updateIcon} alt="" aria-hidden="true" />
      <img className="client-release-banner__rocket" src={updateRocket} alt="" aria-hidden="true" />
      <button
        type="button"
        className="client-release-banner__close"
        aria-label={t("关闭")}
        onClick={() => {
          dismissedIdRef.current = release.id;
          setRelease(null);
        }}
      >
        <i className="bi bi-x-lg" aria-hidden="true" />
      </button>
      <div className="client-release-banner__copy">
        <strong>
          {t("站点已更新到")} <em>{release.version}</em>
        </strong>
        <span>{release.title || t("刷新页面即可使用最新功能。")}</span>
      </div>
      <div className="client-release-banner__actions">
        {isEntryVisible("/updates") && <a className="client-release-banner__notes" href="/updates">
          {t("查看说明")}
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </a>}
        <button
          type="button"
          className="client-release-banner__refresh"
          onClick={() => window.location.reload()}
        >
          <i className="bi bi-arrow-repeat" aria-hidden="true" />
          {t("刷新页面")}
        </button>
      </div>
    </div>
  );
}
