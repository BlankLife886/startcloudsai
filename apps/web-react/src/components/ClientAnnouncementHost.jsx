import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router";
import { useLocale } from "../i18n/index.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import { useLiveAnnouncements } from "../features/announcements/useLiveAnnouncements.js";
import {
  ANNOUNCEMENT_STORAGE_PREFIX,
  announcementDismissRecord,
  announcementIdentity,
  shouldShowAnnouncement,
} from "../features/announcements/announcementPolicy.js";
import "./ClientAnnouncementHost.css";

const STORAGE_PREFIX = ANNOUNCEMENT_STORAGE_PREFIX;

function assetsOf(item) {
  return (Array.isArray(item?.assets) ? item.assets : [])
    .map((asset) => ({
      url: String(asset?.url || "").trim(),
      alt: String(asset?.alt || "").trim(),
    }))
    .filter((asset) => asset.url);
}

function announcementCta(item, isEntryVisible) {
  const text = String(item?.ctaText || "").trim();
  const url = String(item?.ctaUrl || "").trim();
  if (!text || !url || url.startsWith("//")) return null;
  if (!/^https?:\/\//i.test(url) && !url.startsWith("/")) return null;
  try {
    const target = new URL(url, window.location.href);
    if (target.origin === window.location.origin && !isEntryVisible(`${target.pathname}${target.search}`)) return null;
    return { text, url };
  } catch {
    return null;
  }
}

function readLocal(id) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocal(id, value) {
  try {
    localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

function sessionSeen(id) {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

function markSessionSeen(id) {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + id, "1");
  } catch {
    /* ignore */
  }
}

function rememberDismiss(item) {
  markSessionSeen(item.id);
  const record = announcementDismissRecord(item);
  writeLocal(item.id, record);
  if (record.pushId) writeLocal(announcementIdentity(item), record);
}

function useCarouselIndex(item, count, autoplay) {
  const play = Boolean(autoplay) && count > 1;
  const interval = Math.max(1500, Number(item?.carouselIntervalMs) || 4500);
  const [index, setIndex] = useState(0);
  const pausedRef = useRef(false);

  useEffect(() => {
    setIndex(0);
    if (!play) return undefined;
    const timer = window.setInterval(() => {
      if (pausedRef.current) return;
      setIndex((current) => (current + 1) % count);
    }, interval);
    return () => window.clearInterval(timer);
  }, [count, interval, item?.id, play]);

  return {
    index: count > 1 ? index : 0,
    setIndex,
    pause: () => {
      pausedRef.current = true;
    },
    resume: () => {
      pausedRef.current = false;
    },
  };
}

function PromoBannerCopy({ title, body }) {
  const viewportRef = useRef(null);
  const chunkRef = useRef(null);
  const [marquee, setMarquee] = useState({ active: false, distance: 0 });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const chunk = chunkRef.current;
    if (!viewport || !chunk) return undefined;

    const measure = () => {
      const extra = chunk.scrollWidth - viewport.clientWidth;
      setMarquee({
        active: extra > 8,
        distance: chunk.scrollWidth + 48,
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(chunk);
    return () => observer.disconnect();
  }, [body, title]);

  const text = (
    <>
      {title ? <strong>{title}</strong> : null}
      {title && body ? " " : null}
      {body ? <span>{body}</span> : null}
    </>
  );
  const duration = Math.max(10, marquee.distance / 36);

  return (
    <p
      ref={viewportRef}
      className={`promo-banner__copy${marquee.active ? " is-marquee" : ""}`}
    >
      <span
        className="promo-banner__track"
        style={
          marquee.active
            ? {
                "--marquee-distance": `${marquee.distance}px`,
                "--marquee-duration": `${duration}s`,
              }
            : undefined
        }
      >
        <span ref={chunkRef} className="promo-banner__chunk">
          {text}
        </span>
        {marquee.active ? (
          <span className="promo-banner__chunk" aria-hidden="true">
            {text}
          </span>
        ) : null}
      </span>
    </p>
  );
}

function PromoBanner({ item, cta, onDismiss }) {
  const { t } = useLocale();
  const canClose = item.allowClose !== false || !cta;
  const title = String(item.title || "").trim();
  const body = String(item.body || "").trim();

  return (
    <div className="promo-banner" role="region" aria-label={t("公告")}>
      <span className="promo-banner__glow" aria-hidden="true" />
      {item.decorImageUrl ? (
        <img className="promo-banner__art" src={item.decorImageUrl} alt="" />
      ) : (
        <span className="promo-banner__orb is-left" aria-hidden="true" />
      )}
      <span className="promo-banner__orb is-right" aria-hidden="true" />
      <div className="promo-banner__center">
        <PromoBannerCopy title={title} body={body} />
        {cta ? (
          <a
            className="promo-banner__cta"
            href={cta.url}
            target={cta.url.startsWith("http") ? "_blank" : undefined}
            rel={cta.url.startsWith("http") ? "noreferrer" : undefined}
            onClick={() => onDismiss()}
          >
            {cta.text}
          </a>
        ) : null}
      </div>
      {canClose ? (
        <button
          type="button"
          className="promo-banner__close"
          aria-label={t("关闭")}
          onClick={() => onDismiss()}
        >
          <i className="bi bi-x" />
        </button>
      ) : null}
    </div>
  );
}

function AnnouncementCard({ item, cta, onDismiss }) {
  const { t } = useLocale();
  const placement = item.placement === "banner" ? "banner" : "modal";
  const layout = placement === "banner" ? "text_only" : item.layout || "text_only";
  const assets = assetsOf(item);
  const isCarousel = layout === "carousel" && assets.length > 1;
  const carousel = useCarouselIndex(
    isCarousel ? item : null,
    assets.length,
    isCarousel && item.carouselEnabled !== false,
  );
  const canClose = item.allowClose !== false || !cta;
  const closeText = String(item.closeText || "").trim() || t("我知道了");

  const media =
    placement === "modal" && layout !== "text_only" && assets.length
      ? assets
      : [];
  const current = media[carousel.index] || media[0];
  const isPoster = placement === "modal" && layout === "image_top";
  const step = (delta) => {
    if (!media.length) return;
    carousel.setIndex((value) => (value + delta + media.length) % media.length);
  };

  if (isPoster) {
    return (
      <article className="client-announcement is-modal is-image-top">
        {canClose ? (
          <button
            type="button"
            className="client-announcement__close"
            aria-label={t("关闭")}
            onClick={() => onDismiss()}
          >
            <i className="bi bi-x" />
          </button>
        ) : null}
        {current ? (
          <img
            className="client-announcement__poster"
            src={current.url}
            alt={current.alt || item.title}
          />
        ) : (
          <div className="client-announcement__poster-fallback">
            <strong>{item.title}</strong>
            {item.body ? <p>{item.body}</p> : null}
          </div>
        )}
        {cta ? (
          <a
            className="client-announcement__poster-cta"
            href={cta.url}
            target={cta.url.startsWith("http") ? "_blank" : undefined}
            rel={cta.url.startsWith("http") ? "noreferrer" : undefined}
            onClick={() => onDismiss()}
          >
            {cta.text}
          </a>
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={`client-announcement is-${placement} is-${layout.replaceAll("_", "-")}`}
    >
      {canClose ? (
        <button
          type="button"
          className="client-announcement__close"
          aria-label={t("关闭")}
          onClick={() => onDismiss()}
        >
          <i className="bi bi-x" />
        </button>
      ) : null}
      {placement === "banner" && item.decorImageUrl ? (
        <img
          className="client-announcement__decor"
          src={item.decorImageUrl}
          alt=""
        />
      ) : null}
      {layout === "grid" && media.length ? (
        <div className="client-announcement__media is-grid">
          {media.map((asset) => (
            <img key={asset.url} src={asset.url} alt={asset.alt || item.title} />
          ))}
        </div>
      ) : isCarousel ? (
        <div
          className="client-announcement__media is-carousel"
          onMouseEnter={carousel.pause}
          onMouseLeave={carousel.resume}
        >
          {media.map((asset, index) => (
            <img
              key={asset.url}
              className={index === carousel.index ? "is-active" : ""}
              src={asset.url}
              alt={asset.alt || item.title}
            />
          ))}
          <button
            type="button"
            className="client-announcement__nav is-prev"
            aria-label={t("上一张")}
            onClick={() => step(-1)}
          >
            <i className="bi bi-chevron-left" />
          </button>
          <button
            type="button"
            className="client-announcement__nav is-next"
            aria-label={t("下一张")}
            onClick={() => step(1)}
          >
            <i className="bi bi-chevron-right" />
          </button>
          <div className="client-announcement__dots" role="tablist">
            {media.map((asset, index) => (
              <button
                key={asset.url}
                type="button"
                role="tab"
                aria-selected={index === carousel.index}
                className={index === carousel.index ? "is-active" : ""}
                aria-label={`${index + 1} / ${media.length}`}
                onClick={() => carousel.setIndex(index)}
              />
            ))}
          </div>
        </div>
      ) : current ? (
        <div className="client-announcement__media">
          <img src={current.url} alt={current.alt || item.title} />
        </div>
      ) : null}
      <div className="client-announcement__copy">
        <small>{t("公告")}</small>
        <strong>{item.title}</strong>
        {item.body ? <p>{item.body}</p> : null}
        <div className="client-announcement__actions">
          {cta ? (
            <a
              href={cta.url}
              target={cta.url.startsWith("http") ? "_blank" : undefined}
              rel={cta.url.startsWith("http") ? "noreferrer" : undefined}
              onClick={() => onDismiss()}
            >
              {cta.text}
            </a>
          ) : null}
          {canClose ? (
            <button type="button" onClick={() => onDismiss()}>
              {closeText}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function ClientAnnouncementHost() {
  const location = useLocation();
  const { isEntryVisible } = usePageControls();
  const { items } = useLiveAnnouncements();
  const [hiddenIds, setHiddenIds] = useState(() => new Set());
  const [bannerSlot, setBannerSlot] = useState(null);

  useLayoutEffect(() => {
    setBannerSlot(document.getElementById("site-announcement-slot"));
  }, [items, location.pathname]);

  const visible = useMemo(
    () =>
      items.filter(
        (item) => shouldShowAnnouncement(item, {
          dismissedInPage: hiddenIds.has(announcementIdentity(item)),
          seenInSession: sessionSeen(item.id),
          dismissed: readLocal(item.id),
          hasDismissedPush: Boolean(item.pushId && readLocal(announcementIdentity(item))),
        }),
      ),
    [hiddenIds, items],
  );
  const banner = visible.find((item) => item.placement === "banner") || null;
  const modal = visible.find((item) => item.placement !== "banner") || null;
  const bannerCta = banner ? announcementCta(banner, isEntryVisible) : null;
  const modalCta = modal ? announcementCta(modal, isEntryVisible) : null;

  const dismiss = (item) => {
    if (!item?.id) return;
    rememberDismiss(item);
    setHiddenIds((current) => new Set(current).add(announcementIdentity(item)));
  };

  if (!banner && !modal) return null;

  return (
    <>
      {banner && bannerSlot
        ? createPortal(
            <PromoBanner item={banner} cta={bannerCta} onDismiss={() => dismiss(banner)} />,
            bannerSlot,
          )
        : null}
      {modal ? (
        <div
          className="client-announcement-modal"
          role="dialog"
          aria-modal="true"
          aria-label={modal.title || "公告"}
        >
          <button
            type="button"
            className="client-announcement-modal__backdrop"
            aria-label="关闭公告"
            disabled={modal.allowClose === false && Boolean(modalCta)}
            onClick={() => {
              if (modal.allowClose === false && modalCta) return;
              dismiss(modal);
            }}
          />
          <AnnouncementCard item={modal} cta={modalCta} onDismiss={() => dismiss(modal)} />
        </div>
      ) : null}
    </>
  );
}
