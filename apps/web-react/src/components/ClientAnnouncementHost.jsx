import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { useLocale } from "../i18n/index.js";
import { usePageControls } from "../page-control/PageControlContext.jsx";
import { useLiveAnnouncements } from "../features/announcements/useLiveAnnouncements.js";
import { markAnnouncementsRead } from "../features/announcements/announcementRead.js";
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

// 点公告按钮：先关掉公告；站内地址走前端路由跳转，不整页刷新（整页刷新会让“每次打开都弹”的公告又弹出来）
function useCtaClick(cta, onDismiss) {
  const navigate = useNavigate();
  return (event) => {
    onDismiss();
    if (!cta || event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (event.currentTarget.target === "_blank") return;
    let target;
    try {
      target = new URL(cta.url, window.location.href);
    } catch {
      return;
    }
    if (target.origin !== window.location.origin) return;
    event.preventDefault();
    navigate(`${target.pathname}${target.search}${target.hash}`);
  };
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
    interval,
    playing: play,
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
  const onCta = useCtaClick(cta, onDismiss);
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
            onClick={onCta}
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

// 左文右图：图片区按原图比例定尺寸。竖图做成窄高条、方图做成方块、横图做成宽矮块，
// 文字列宽度固定，整张卡片的比例不会被极端尺寸的图片撑坏。
// 原图比例超出图片区可接受范围太多时（超宽横幅、超长竖图）改为完整显示 + 同图模糊铺底，避免裁掉主体。
function sideMediaBox(ratio) {
  const r = Number.isFinite(ratio) && ratio > 0 ? ratio : 4 / 3;
  const shape = r < 0.85 ? "portrait" : r <= 1.25 ? "square" : "landscape";
  const height = shape === "portrait" ? 560 : shape === "square" ? 500 : 420;
  const boxRatio = Math.min(1.56, Math.max(0.62, r));
  const width = Math.round(height * boxRatio);
  const fit = Math.abs(Math.log(r / boxRatio)) > 0.2 ? "contain" : "cover";
  // 窄屏上下排列，图片区比例也做上下限，过高的竖图不会把文字挤出屏幕
  const mobileRatio = Math.min(1.9, Math.max(0.9, r));
  const mobileFit = Math.abs(Math.log(r / mobileRatio)) > 0.2 ? "contain" : "cover";
  return { shape, width, height, fit, mobileRatio, mobileFit };
}

function SideMedia({ asset, title, box, onMeasure }) {
  return (
    <div
      className={`client-announcement__media is-side fit-${box.fit} m-fit-${box.mobileFit}`}
    >
      <img className="client-announcement__media-bg" src={asset.url} alt="" aria-hidden="true" />
      <img
        className="client-announcement__media-img"
        src={asset.url}
        alt={asset.alt || title}
        onLoad={(event) => {
          const { naturalWidth, naturalHeight } = event.currentTarget;
          if (naturalWidth && naturalHeight) onMeasure(naturalWidth / naturalHeight);
        }}
        onError={() => onMeasure(4 / 3)}
      />
    </div>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function AnnouncementCard({ item, cta, onDismiss }) {
  const { t } = useLocale();
  const onCta = useCtaClick(cta, onDismiss);
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

  const isSide = placement === "modal" && (layout === "image_left" || layout === "image_right") && Boolean(current);
  const [sideRatio, setSideRatio] = useState(null);
  useEffect(() => {
    setSideRatio(null);
    if (!isSide) return undefined;
    // 图片迟迟不回来也要先把弹窗露出来，按 4:3 排版
    const timer = window.setTimeout(() => setSideRatio((value) => value ?? 4 / 3), 1200);
    return () => window.clearTimeout(timer);
  }, [current?.url, isSide]);
  const sideBox = isSide ? sideMediaBox(sideRatio ?? 4 / 3) : null;

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
            onClick={onCta}
          >
            {cta.text}
          </a>
        ) : null}
      </article>
    );
  }

  return (
    <article
      className={[
        "client-announcement",
        `is-${placement}`,
        `is-${layout.replaceAll("_", "-")}`,
        sideBox ? `is-${sideBox.shape}` : "",
        isSide && sideRatio == null ? "is-measuring" : "",
      ].filter(Boolean).join(" ")}
      style={sideBox ? {
        "--ann-media-w": `${sideBox.width}px`,
        "--ann-media-h": `${sideBox.height}px`,
        "--ann-media-ratio": sideBox.mobileRatio,
      } : undefined}
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
      <small className="client-announcement__tag">
        <i className="bi bi-megaphone-fill" aria-hidden="true" />
        {t("公告")}
      </small>
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
          style={{ "--ann-interval": `${carousel.interval}ms` }}
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
          <div className={`client-announcement__dots${carousel.playing ? " is-autoplay" : ""}`} role="tablist">
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
      ) : current && isSide ? (
        <SideMedia asset={current} title={item.title} box={sideBox} onMeasure={setSideRatio} />
      ) : current ? (
        <div className="client-announcement__media">
          <img src={current.url} alt={current.alt || item.title} />
        </div>
      ) : null}
      <div className="client-announcement__copy">
        <strong>{item.title}</strong>
        {item.body ? <p>{item.body}</p> : null}
        <div className="client-announcement__actions">
          {canClose ? (
            <button type="button" onClick={() => onDismiss()}>
              {closeText}
            </button>
          ) : null}
          {cta ? (
            <a
              href={cta.url}
              target={cta.url.startsWith("http") ? "_blank" : undefined}
              rel={cta.url.startsWith("http") ? "noreferrer" : undefined}
              onClick={onCta}
            >
              {cta.text}
            </a>
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
  // 关掉一个弹窗时还在排队的其它弹窗公告：本次打开页面不再接着弹，之后新推送的照常弹
  const [queuedModalIds, setQueuedModalIds] = useState(() => new Set());
  const [bannerSlot, setBannerSlot] = useState(null);
  const [leavingId, setLeavingId] = useState("");
  const leaveTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);

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
  const modals = visible.filter((item) => item.placement !== "banner");
  const modal = modals.find((item) => !queuedModalIds.has(announcementIdentity(item))) || null;
  const bannerCta = banner ? announcementCta(banner, isEntryVisible) : null;
  const modalCta = modal ? announcementCta(modal, isEntryVisible) : null;

  const dismiss = (item) => {
    if (!item?.id) return;
    rememberDismiss(item);
    // 弹窗/横幅已经看过并关掉，公告入口上不再算未读
    markAnnouncementsRead(item);
    setHiddenIds((current) => new Set(current).add(announcementIdentity(item)));
    if (item === modal) {
      setQueuedModalIds((current) => {
        const next = new Set(current);
        for (const other of modals) next.add(announcementIdentity(other));
        return next;
      });
    }
  };

  // 弹窗先播离场动画再真正关闭
  const dismissModal = (item) => {
    if (!item?.id || leavingId) return;
    if (prefersReducedMotion()) {
      dismiss(item);
      return;
    }
    // 关闭记录立即写入：动画期间页面跳走也不会再弹
    rememberDismiss(item);
    markAnnouncementsRead(item);
    const id = announcementIdentity(item);
    setLeavingId(id);
    leaveTimer.current = window.setTimeout(() => {
      dismiss(item);
      setLeavingId((current) => (current === id ? "" : current));
    }, 240);
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
          className={`client-announcement-modal${leavingId && leavingId === announcementIdentity(modal) ? " is-leaving" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={modal.title || "公告"}
        >
          {/* 遮罩只挡住页面，不响应点击：公告必须通过关闭按钮或行动按钮离开 */}
          <div className="client-announcement-modal__backdrop" aria-hidden="true" />
          <AnnouncementCard key={announcementIdentity(modal)} item={modal} cta={modalCta} onDismiss={() => dismissModal(modal)} />
        </div>
      ) : null}
    </>
  );
}
