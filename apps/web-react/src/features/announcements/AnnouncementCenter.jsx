import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { translateClientText } from "@react/legacy-modules/i18n/clientTranslations.js";
import { useReadAnnouncements } from "./announcementRead.js";
import { announcementPublishedAt } from "./useAnnouncementHistory.js";
import "./AnnouncementCenter.css";

const DAY_MS = 86_400_000;

function localizedText(value) {
  let locale = "zh-CN";
  try {
    locale = localStorage.getItem("starclouds-locale") || locale;
  } catch {
    /* ignore */
  }
  return translateClientText(String(value || ""), locale);
}

function photosOf(item) {
  const seen = new Set();
  const images = [];
  for (const asset of Array.isArray(item?.assets) ? item.assets : []) {
    const url = String(asset?.url || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    images.push({ url, alt: String(asset?.alt || "").trim() });
  }
  return images;
}

function coverOf(item) {
  return photosOf(item)[0]?.url || String(item?.decorImageUrl || "").trim();
}

function ctaOf(item) {
  const text = String(item?.ctaText || "").trim();
  const url = String(item?.ctaUrl || "").trim();
  if (!text || !url || url.startsWith("//")) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return { text, url };
  return null;
}

function bodyParts(body) {
  const listMark = /^(?:\d+[\.．、)]\s+|[-*•]\s+)/;
  const lines = String(body || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const listed = lines.filter((line) => listMark.test(line)).length;
  if (lines.length >= 2 && listed >= Math.ceil(lines.length * 0.6)) {
    return { items: lines.map((line) => line.replace(listMark, "")) };
  }
  return { paragraphs: lines };
}

function snippetOf(body) {
  const parts = bodyParts(body);
  return ((parts.items || parts.paragraphs || [])[0] || "").replace(/\s+/g, " ").trim();
}

/** ended：已结束；limited：限时进行中；ongoing：长期有效。 */
export function announcementStatus(item, now = Date.now()) {
  const endsAt = Date.parse(item?.endsAt || "");
  if (item?.active === false || (Number.isFinite(endsAt) && endsAt <= now)) return "ended";
  return Number.isFinite(endsAt) ? "limited" : "ongoing";
}

function remainingText(item, now) {
  const left = Date.parse(item.endsAt) - now;
  if (left >= DAY_MS) return `还剩 ${Math.floor(left / DAY_MS)} 天`;
  if (left >= 3_600_000) return `还剩 ${Math.floor(left / 3_600_000)} 小时`;
  return "即将结束";
}

function shortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function fullStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const clock = date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

function monthKey(time) {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(time) {
  const date = new Date(time);
  return date.getFullYear() === new Date().getFullYear()
    ? `${date.getMonth() + 1} 月`
    : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function periodText(item) {
  const start = fullStamp(item.startsAt || item.createdAt);
  const end = fullStamp(item.endsAt);
  if (end) return `${start} – ${end}`;
  return start ? `${start} 起长期有效` : "";
}

// 后台「立即推送」过的公告：推送时间晚于发布时间才算更新。
function updatedAt(item) {
  const pushed = Date.parse(item?.pushedAt || "");
  const published = Date.parse(item?.startsAt || "") || Date.parse(item?.createdAt || "");
  return Number.isFinite(pushed) && (!Number.isFinite(published) || pushed > published) ? item.pushedAt : "";
}

function DetailBody({ body }) {
  const parts = bodyParts(body);
  if (parts.items) {
    return (
      <ol className="ann-article__list">
        {parts.items.map((line, index) => (
          <li key={`${line}-${index}`}>
            <em>{String(index + 1).padStart(2, "0")}</em>
            <span>{localizedText(line)}</span>
          </li>
        ))}
      </ol>
    );
  }
  if (!parts.paragraphs?.length) return null;
  return (
    <div className="ann-article__text">
      {parts.paragraphs.map((line, index) => (
        <p key={`${line}-${index}`}>{localizedText(line)}</p>
      ))}
    </div>
  );
}

function StatusChip({ status, item, now }) {
  if (status === "ended") return <span className="ann-chip is-ended">已结束</span>;
  if (status === "limited") return <span className="ann-chip is-live">{remainingText(item, now)}</span>;
  return <span className="ann-chip is-ongoing">长期有效</span>;
}

/** 公告正文：详情页使用。 */
export function AnnouncementArticle({ item, now }) {
  const photos = photosOf(item);
  const cta = ctaOf(item);
  const status = announcementStatus(item, now);
  const body = String(item.body || "").trim();

  return (
    <article className="ann-article">
      <header className="ann-article__head" data-no-translate>
        <StatusChip status={status} item={item} now={now} />
        <h1>{localizedText(item.title)}</h1>
        {periodText(item) ? (
          <p className="ann-article__period">
            <i className="bi bi-clock" /> {periodText(item)}
            {updatedAt(item) ? <span className="ann-updated">更新于 {fullStamp(updatedAt(item))}</span> : null}
          </p>
        ) : null}
      </header>
      <div className="ann-article__content" data-no-translate>
        {photos.length ? (
          <div className={`ann-article__media${photos.length > 1 ? " is-grid" : ""}`}>
            {photos.map((image) => (
              <img key={image.url} src={image.url} alt={image.alt || item.title} />
            ))}
          </div>
        ) : null}
        {body ? <DetailBody body={body} /> : null}
      </div>
      {cta && status !== "ended" ? (
        <footer className="ann-article__foot">
          <a
            className="ann-article__cta"
            href={cta.url}
            target={cta.url.startsWith("http") ? "_blank" : undefined}
            rel={cta.url.startsWith("http") ? "noreferrer" : undefined}
          >
            {cta.text}
            <i className="bi bi-arrow-up-right" />
          </a>
        </footer>
      ) : null}
    </article>
  );
}

/** 列表页滚动位置：从详情返回时恢复。 */
const LIST_SCROLL_KEY = "starclouds-announcement-list-scroll";

export function announcementDetailPath(item, search = "") {
  return `/announcements/${encodeURIComponent(item.id)}${search}`;
}

export function AnnouncementCenter({ items }) {
  const { isRead } = useReadAnnouncements();
  const location = useLocation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const { featured, months } = useMemo(() => {
    const featuredItems = [];
    const groups = new Map();
    for (const item of items) {
      if (announcementStatus(item, now) === "limited") {
        featuredItems.push(item);
        continue;
      }
      const time = announcementPublishedAt(item);
      const key = monthKey(time);
      if (!groups.has(key)) groups.set(key, { key, label: monthLabel(time), items: [] });
      groups.get(key).items.push(item);
    }
    return { featured: featuredItems, months: [...groups.values()] };
  }, [items, now]);

  useEffect(() => {
    let saved = null;
    try {
      saved = sessionStorage.getItem(LIST_SCROLL_KEY);
      sessionStorage.removeItem(LIST_SCROLL_KEY);
    } catch {
      /* ignore */
    }
    if (saved) window.scrollTo({ top: Number(saved) || 0, behavior: "instant" });
  }, []);

  const linkProps = (item) => ({
    to: announcementDetailPath(item, location.search),
    state: { fromList: true },
    onClick: () => {
      try {
        sessionStorage.setItem(LIST_SCROLL_KEY, String(window.scrollY));
      } catch {
        /* ignore */
      }
    },
  });

  return (
    <div className="ann-center">
      {featured.length ? (
        <section className="ann-section" aria-label="进行中">
          <h3 className="ann-section__title">进行中</h3>
          <div className="ann-featured">
            {featured.map((item) => {
              const cover = coverOf(item);
              const snippet = snippetOf(item.body);
              return (
                <Link key={item.id} className="ann-card" {...linkProps(item)}>
                  <span className={`ann-card__cover${cover ? "" : " is-empty"}`}>
                    {cover ? <img src={cover} alt="" /> : <i className="bi bi-megaphone" />}
                  </span>
                  <span className="ann-card__body" data-no-translate>
                    <span className="ann-card__title">
                      {!isRead(item) ? <i className="ann-dot" aria-label="未读" /> : null}
                      <strong>{localizedText(item.title)}</strong>
                    </span>
                    {snippet ? <span className="ann-card__snippet">{localizedText(snippet)}</span> : null}
                    <span className="ann-card__meta">
                      <StatusChip status="limited" item={item} now={now} />
                      <span>{shortDate(item.startsAt || item.createdAt)} – {shortDate(item.endsAt)}</span>
                      <span className="ann-card__more">
                        查看详情 <i className="bi bi-arrow-right" />
                      </span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
      {months.map((group) => (
        <section key={group.key} className="ann-section" aria-label={group.label}>
          <h3 className="ann-section__title">{group.label}</h3>
          <ol className="ann-timeline">
            {group.items.map((item) => {
              const status = announcementStatus(item, now);
              const unread = !isRead(item) && status !== "ended";
              return (
                <li key={item.id}>
                  <Link className={`ann-row${status === "ended" ? " is-ended" : ""}`} {...linkProps(item)}>
                    <time dateTime={item.startsAt || item.createdAt}>
                      {shortDate(item.startsAt || item.createdAt)}
                    </time>
                    <span className="ann-row__main" data-no-translate>
                      <span className="ann-row__title">
                        {unread ? <i className="ann-dot" aria-label="未读" /> : null}
                        <strong>{localizedText(item.title)}</strong>
                        {updatedAt(item) ? (
                          <span className="ann-updated" title={`更新于 ${fullStamp(updatedAt(item))}`}>已更新</span>
                        ) : null}
                      </span>
                      {snippetOf(item.body) ? <em>{localizedText(snippetOf(item.body))}</em> : null}
                    </span>
                    <StatusChip status={status} item={item} now={now} />
                    <i className="bi bi-chevron-right ann-row__arrow" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

/** 未读：还在生效、且本机没打开过的公告。 */
export function unreadAnnouncementCount(items, isRead, now = Date.now()) {
  return items.filter((item) => announcementStatus(item, now) !== "ended" && !isRead(item)).length;
}
