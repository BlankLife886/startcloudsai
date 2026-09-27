import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "../../../../i18n/index.js";
import { AuthenticatedImage } from "../../../../components/AuthenticatedImage.jsx";

const SWIPE_THRESHOLD = 48;
const OPEN_MS = 320;
const CLOSE_MS = 240;
const EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";

function reducedMotion() {
  return (
    document.documentElement.classList.contains("settings-no-animations") ||
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

// 让 stage 从卡片位置“长”出来：只用 transform，保持 60fps
function rectTransform(from, to) {
  if (!from || !to || !to.width || !to.height) return null;
  const scale = Math.max(from.width / to.width, from.height / to.height);
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

// 批量结果的全屏沉浸预览：左右切换/滑动，底部按“件”分段的整组缩略条，
// 右侧抽屉显示本张实际用到的衣服、模特和操作。
export function TryonGroupViewer({
  rows,
  startUrl,
  originRect = null,
  returnRectOf,
  garmentOf,
  labelOf,
  referencesOf,
  onClose,
  onDownload,
  onUseAsModel,
  onShowOnCanvas,
}) {
  const { t } = useLocale();
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      rows.findIndex((row) => row.url === startUrl),
    ),
  );
  const [downloading, setDownloading] = useState(false);
  const [direction, setDirection] = useState(0);
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const closingRef = useRef(false);
  const swipeRef = useRef(null);
  const stripRef = useRef(null);
  const row = rows[index] || rows[0];
  const refs = referencesOf(row);
  const total = rows.length;

  const go = (step) => {
    setDirection(step);
    setIndex((current) => (current + step + total) % total);
  };
  const jump = (target) => {
    setDirection(target === index ? 0 : target > index ? 1 : -1);
    setIndex(target);
  };

  useLayoutEffect(() => {
    // 焦点移进预览：键盘操作只作用于预览，关闭后交还给原来的卡组
    const previous = document.activeElement;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);

  useLayoutEffect(() => {
    if (reducedMotion()) return;
    const root = rootRef.current;
    const stage = stageRef.current;
    root?.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: OPEN_MS * 0.8,
      easing: "ease-out",
    });
    const from = rectTransform(originRect, stage?.getBoundingClientRect());
    stage?.animate(
      from
        ? [
            { transform: from, opacity: 0.6, borderRadius: "12px" },
            { transform: "none", opacity: 1, borderRadius: "0px" },
          ]
        : [
            { transform: "scale(0.96)", opacity: 0 },
            { transform: "none", opacity: 1 },
          ],
      { duration: OPEN_MS, easing: EASE },
    );
    // 只在打开时播放一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    if (reducedMotion()) {
      onClose();
      return;
    }
    const stage = stageRef.current;
    const to = rectTransform(
      returnRectOf?.(rows[index]),
      stage?.getBoundingClientRect(),
    );
    rootRef.current?.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: CLOSE_MS,
      easing: "ease-in",
      fill: "forwards",
    });
    const animation = stage?.animate(
      [
        { transform: "none", opacity: 1 },
        to
          ? { transform: to, opacity: 0.4 }
          : { transform: "scale(0.96)", opacity: 0 },
      ],
      { duration: CLOSE_MS, easing: EASE, fill: "forwards" },
    );
    if (animation) animation.onfinish = () => onClose();
    else onClose();
  }, [index, onClose, returnRectOf, rows]);

  // 预加载前后各一张，切换时不闪白
  useEffect(() => {
    [1, -1].forEach((step) => {
      const neighbor = rows[(index + step + total) % total];
      if (!neighbor) return;
      const image = new Image();
      image.src = neighbor.display || neighbor.url;
    });
  }, [index, rows, total]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    };
    // 不拦截传播：Esc 还要让全站的防连点等逻辑收到；画布快捷键会在预览打开时自行忽略
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    // 只滚动缩略条自身：scrollIntoView 会连带滚动外层容器，导致整个预览被推偏
    const strip = stripRef.current;
    const active = strip?.querySelector(".is-active");
    if (!strip || !active) return;
    const stripBox = strip.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const target =
      strip.scrollLeft +
      (activeBox.left + activeBox.width / 2) -
      (stripBox.left + stripBox.width / 2);
    strip.scrollTo({
      left: Math.max(0, target),
      behavior: reducedMotion() ? "auto" : "smooth",
    });
  }, [index]);

  // 缩略条按件分段
  const segments = [];
  rows.forEach((item, at) => {
    const garment = garmentOf(item);
    const last = segments[segments.length - 1];
    if (last && last.garment === garment) last.items.push({ item, at });
    else segments.push({ garment, items: [{ item, at }] });
  });

  const inputs = refs
    ? [
        [refs.garment, refs.bottom ? "上装" : "衣服", "本张使用的衣服"],
        refs.bottom ? [refs.bottom, "下装", "本张使用的下装"] : null,
        refs.model ? [refs.model, "模特", "本张使用的模特"] : null,
      ].filter(Boolean)
    : [];

  return createPortal(
    <div
      ref={rootRef}
      tabIndex={-1}
      className="tryon-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={t("批量结果预览")}
    >
      <div className="tryon-viewer__ambient" aria-hidden="true">
        <AuthenticatedImage
          key={row.url}
          src={row.preview || row.url}
          fallbackSrc={row.url}
          alt=""
          maxDimension={240}
        />
      </div>

      <header className="tryon-viewer__bar">
        <div className="tryon-viewer__title">
          <strong>{labelOf(row)}</strong>
          <span className="tryon-viewer__count">
            {index + 1} / {total}
          </span>
        </div>
        <div className="tryon-viewer__tools">
          <button
            type="button"
            className="tryon-viewer__tool is-primary"
            disabled={downloading}
            onClick={async () => {
              setDownloading(true);
              try {
                await onDownload?.(row.url);
              } finally {
                setDownloading(false);
              }
            }}
          >
            <i className="bi bi-download" aria-hidden="true" />
            <span>{t(downloading ? "下载中" : "下载")}</span>
          </button>
          <button
            type="button"
            className="tryon-viewer__tool"
            onClick={() => onUseAsModel?.(row.url)}
          >
            <i className="bi bi-person-check" aria-hidden="true" />
            <span>{t("设为模特")}</span>
          </button>
          <button
            type="button"
            className="tryon-viewer__tool"
            onClick={() => onShowOnCanvas?.(row.url)}
          >
            <i className="bi bi-easel2" aria-hidden="true" />
            <span>{t("在画布查看")}</span>
          </button>
          <span className="tryon-viewer__divider" aria-hidden="true" />
          <button
            type="button"
            className="tryon-viewer__tool is-icon"
            aria-label={t("关闭预览")}
            onClick={close}
          >
            <i className="bi bi-x-lg" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div
        ref={stageRef}
        className="tryon-viewer__stage"
        onPointerDown={(event) => {
          swipeRef.current = { x: event.clientX, id: event.pointerId };
        }}
        onPointerUp={(event) => {
          const start = swipeRef.current;
          swipeRef.current = null;
          if (!start || start.id !== event.pointerId) return;
          const delta = event.clientX - start.x;
          if (Math.abs(delta) >= SWIPE_THRESHOLD) go(delta < 0 ? 1 : -1);
        }}
      >
        <AuthenticatedImage
          key={row.url}
          className={`tryon-viewer__image${direction > 0 ? " is-from-right" : direction < 0 ? " is-from-left" : ""}`}
          src={row.display || row.url}
          fallbackSrc={row.url}
          alt={labelOf(row)}
          loading="eager"
          maxDimension={2048}
        />
        {total > 1 ? (
          <>
            <button
              type="button"
              className="tryon-viewer__nav is-prev"
              aria-label={t("上一张")}
              onClick={() => go(-1)}
            >
              <span>
                <i className="bi bi-chevron-left" aria-hidden="true" />
              </span>
            </button>
            <button
              type="button"
              className="tryon-viewer__nav is-next"
              aria-label={t("下一张")}
              onClick={() => go(1)}
            >
              <span>
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </span>
            </button>
          </>
        ) : null}
      </div>

      <footer className="tryon-viewer__foot">
        <aside className="tryon-viewer__inputs" aria-label={t("本张输入")}>
          <span className="tryon-viewer__inputs-title">{t("本张输入")}</span>
          {inputs.length ? (
            <div className="tryon-viewer__inputs-list">
              {inputs.map(([src, label, alt]) => (
                <figure key={label}>
                  <AuthenticatedImage src={src} alt={t(alt)} maxDimension={240} />
                  <figcaption>{t(label)}</figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <p className="tryon-viewer__muted">{t("这张没有记录输入图")}</p>
          )}
        </aside>

        <nav
          ref={stripRef}
          className="tryon-viewer__strip"
          aria-label={t("整组缩略图")}
        >
          {segments.map((segment) => (
            <div key={segment.garment} className="tryon-viewer__segment">
              <span className="tryon-viewer__segment-label">
                {t("第")}
                {segment.garment + 1}
                {t("件")}
              </span>
              <div className="tryon-viewer__segment-items">
                {segment.items.map(({ item, at }) => (
                  <button
                    key={item.url}
                    type="button"
                    className={at === index ? "is-active" : ""}
                    aria-label={labelOf(item)}
                    aria-current={at === index ? "true" : undefined}
                    title={labelOf(item)}
                    onClick={() => jump(at)}
                  >
                    <AuthenticatedImage
                      src={item.preview || item.url}
                      fallbackSrc={item.url}
                      alt=""
                      maxDimension={240}
                    />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <p className="tryon-viewer__keys" aria-hidden="true">
          <kbd>←</kbd>
          <kbd>→</kbd> {t("切换")} · <kbd>Esc</kbd> {t("关闭")}
        </p>
      </footer>
    </div>,
    document.body,
  );
}
