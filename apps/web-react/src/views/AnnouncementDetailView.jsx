import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useIsDark } from "../hooks/useIsDark.js";
import { useAnnouncementHistory } from "../features/announcements/useAnnouncementHistory.js";
import { useReadAnnouncements } from "../features/announcements/announcementRead.js";
import { AnnouncementArticle } from "../features/announcements/AnnouncementCenter.jsx";
import "../features/inbox/inbox.css";
import "../features/announcements/AnnouncementCenter.css";

/** 公告详情：从公告列表点进来的独立页面，同样公开可看。 */
export function AnnouncementDetailView() {
  const isDark = useIsDark();
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { items, loading, error, refresh } = useAnnouncementHistory();
  const { markRead } = useReadAnnouncements();
  const [now, setNow] = useState(() => Date.now());
  const item = items.find((entry) => entry.id === id) || null;
  const listHref = `/announcements${location.search}`;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (item) markRead(item);
  }, [item, markRead]);

  // 从列表点进来时用浏览器返回，列表能回到原来的位置
  const goBack = (event) => {
    if (!location.state?.fromList) return;
    event.preventDefault();
    navigate(-1);
  };

  return (
    <div className={`nt-page ${isDark ? "is-dark" : "is-light"}`}>
      <div className="nt-shell ann-detail">
        <Link className="ann-detail__back" to={listHref} onClick={goBack}>
          <i className="bi bi-arrow-left" /> 全部公告
        </Link>

        {item ? (
          <AnnouncementArticle item={item} now={now} />
        ) : (
          <section className="nt-board">
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
            ) : (
              <div className="nt-empty">
                <i className="bi bi-megaphone" />
                <strong>公告不存在或已下线</strong>
                <p>可以回到公告列表看看其他公告。</p>
                <Link className="nt-btn" to={listHref}>
                  返回公告列表
                </Link>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
