import { Navigate, useLocation } from "react-router";
import { useIsDark } from "../hooks/useIsDark.js";
import { useAnnouncementHistory } from "../features/announcements/useAnnouncementHistory.js";
import { useReadAnnouncements } from "../features/announcements/announcementRead.js";
import {
  AnnouncementCenter,
  announcementDetailPath,
  unreadAnnouncementCount,
} from "../features/announcements/AnnouncementCenter.jsx";
import "../features/inbox/inbox.css";

/** 平台公告：公开页面，未登录也能看；往期公告保留可回看。 */
export function AnnouncementsView() {
  const isDark = useIsDark();
  const location = useLocation();
  const { items, loading, refreshing, error, refresh } = useAnnouncementHistory();
  const { isRead, markRead } = useReadAnnouncements();
  const unread = unreadAnnouncementCount(items, isRead);
  const query = new URLSearchParams(location.search);
  const legacyId = query.get("id");

  // 旧链接 /announcements?id=xxx 改到独立详情页
  if (legacyId) {
    query.delete("id");
    const search = query.toString();
    return <Navigate replace to={announcementDetailPath({ id: legacyId }, search ? `?${search}` : "")} />;
  }

  return (
    <div className={`nt-page ${isDark ? "is-dark" : "is-light"}`}>
      <div className="nt-shell">
        <header className="nt-head">
          <div className="nt-head__copy">
            <span className="nt-head__eyebrow">
              <i className="bi bi-megaphone" /> 平台公告
            </span>
            <h1>
              公告
              {unread > 0 ? <em>{unread}</em> : null}
            </h1>
            <p>活动、上新与维护公告都在这里，结束的公告也可以随时回看。</p>
          </div>
          <div className="nt-head__actions">
            <button
              type="button"
              className={`nt-btn${unread > 0 ? " is-primary" : ""}`}
              disabled={unread <= 0}
              onClick={() => markRead(items)}
            >
              <i className="bi bi-check2-all" /> 全部已读
            </button>
            <button
              type="button"
              className="nt-btn is-icon"
              aria-label="刷新"
              title="刷新"
              disabled={refreshing}
              onClick={() => refresh()}
            >
              <i className={`bi bi-arrow-repeat${refreshing ? " spin" : ""}`} />
            </button>
          </div>
        </header>

        <section className={`nt-board${items.length ? " is-plain" : ""}`} aria-live="polite">
          {loading ? (
            <div className="nt-skel" aria-hidden="true">
              {Array.from({ length: 3 }, (_, index) => (
                <div key={index} className="nt-skel__row" />
              ))}
            </div>
          ) : error ? (
            <div className="nt-empty is-error">
              <i className="bi bi-wifi-off" />
              <strong>公告读取失败</strong>
              <p>{error}</p>
              <button type="button" className="nt-btn" onClick={() => refresh()}>
                重试
              </button>
            </div>
          ) : items.length ? (
            <AnnouncementCenter items={items} />
          ) : (
            <div className="nt-empty">
              <i className="bi bi-megaphone" />
              <strong>暂无公告</strong>
              <p>平台发布的活动、上新和维护公告都会保存在这里。</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
