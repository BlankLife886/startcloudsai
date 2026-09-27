import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { useIsDark } from "../../../../hooks/useIsDark.js";
import { useLocale } from "../../../../i18n/index.js";
import { AuthenticatedImage } from "../../../../components/AuthenticatedImage.jsx";
import { RegenerateIcon } from "../../../../components/common/RegenerateIcon.jsx";
import { CommerceSelect } from "../../CommerceSelect.jsx";
import { TryonGroupViewer } from "./TryonGroupViewer.jsx";

const TRYON_STAGE_COPY = {
  aria: "试衣画布",
  centerTag: "衣服",
  centerEmpty: "上传服装",
  centerEmptyAria: "选择服装图片",
  centerUploadAria: "上传服装",
  centerPreviewAria: "查看服装大图",
  centerTitle: "服装",
  centerHint: "",
  dropRole: "garment",
  selectAria: "选择衣服类型",
  emptyIcon: "bi-bag",
  resultAlt: "试衣生成结果",
};

function tryonAnimationsDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

function mentionQueryAtCaret(value, caret) {
  const before = String(value || "").slice(0, Math.max(0, Number(caret) || 0));
  const match = /@([^\s@]*)$/.exec(before);
  if (!match) return null;
  return { start: before.length - match[0].length, query: match[1] || "" };
}

function filterTryonMentions(mentions, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return mentions;
  return mentions.filter((item) =>
    `${item.token} ${item.hint || ""}`.toLowerCase().includes(q),
  );
}

function ecommerceOverlayRoot() {
  const id = "react-ecommerce-overlay-root";
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    document.body.appendChild(root);
  }
  return root;
}

const TRYON_PICKS_RECENT_LIMIT = 6;

function tryonPicksKey(kind) {
  return `starclouds.tryon.picks.${kind || "default"}.v1`;
}

function readTryonPicks(kind) {
  try {
    const value = JSON.parse(localStorage.getItem(tryonPicksKey(kind)) || "{}");
    return {
      favorites: Array.isArray(value.favorites) ? value.favorites : [],
      recent: Array.isArray(value.recent) ? value.recent : [],
    };
  } catch {
    return { favorites: [], recent: [] };
  }
}

function writeTryonPicks(kind, picks) {
  try {
    localStorage.setItem(tryonPicksKey(kind), JSON.stringify(picks));
  } catch {
    /* 收藏只是便利功能，存储不可用时忽略 */
  }
}

export function TryonChoicePicker({
  groupAria,
  uploadLabel,
  moreAria,
  popupTitle,
  popupHint,
  popupTitleId = "tryon-choice-popup-title",
  popupKind = "",
  closeScrimLabel,
  catalog,
  featured,
  source,
  disabled,
  onPickUpload,
  onSelectBuiltin,
  customItems = [],
  onSelectCustom,
  onForgetCustom,
  children,
}) {
  const isDark = useIsDark();
  const { t } = useLocale();
  const popupRootRef = useRef(null);
  const popupPanelRef = useRef(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupRendered, setPopupRendered] = useState(false);
  const [picks, setPicks] = useState(() => readTryonPicks(popupKind));
  const updatePicks = useCallback(
    (update) => {
      setPicks((current) => {
        const next = update(current);
        writeTryonPicks(popupKind, next);
        return next;
      });
    },
    [popupKind],
  );
  const favoriteSet = new Set(picks.favorites);
  const recentSet = new Set(picks.recent);
  const rank = (option) =>
    favoriteSet.has(option.id)
      ? 0
      : recentSet.has(option.id)
        ? 1 + picks.recent.indexOf(option.id) / 100
        : 2;
  const [filter, setFilter] = useState("all");
  const favoriteCount = catalog.filter((option) => favoriteSet.has(option.id)).length;
  const recentBuiltin = picks.recent
    .map((id) => catalog.find((option) => option.id === id))
    .filter(Boolean);
  // “最近”：自己的图（上传/裁剪/设为模特）在前，再接最近选过的内置素材
  const recentCount = customItems.length + recentBuiltin.length;
  const filters = [
    ["all", "全部", customItems.length + catalog.length],
    ...(favoriteCount ? [["favorite", "收藏", favoriteCount]] : []),
    ...(recentCount ? [["recent", "最近", recentCount]] : []),
  ];
  const orderedCatalog = catalog
    .map((option, index) => ({ option, index }))
    .sort((a, b) => rank(a.option) - rank(b.option) || a.index - b.index)
    .map(({ option }) => option);
  const visibleCatalog =
    filter === "favorite"
      ? [...customItems, ...orderedCatalog].filter((option) =>
          favoriteSet.has(option.id),
        )
      : filter === "recent"
        ? [...customItems, ...recentBuiltin]
        : [...customItems, ...orderedCatalog];

  const closePopup = useCallback(() => {
    setPopupOpen(false);
  }, []);

  const openPopup = useCallback(() => {
    setFilter("all");
    setPopupRendered(true);
    setPopupOpen(true);
  }, []);

  useEffect(() => {
    if (!popupRendered) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closePopup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popupRendered, closePopup]);

  useGSAP(
    (context, contextSafe) => {
      if (!popupRendered) return undefined;
      const panel = popupPanelRef.current;
      const scrim = popupRootRef.current?.querySelector(
        ".tryon-model-popup__scrim",
      );
      if (!panel) return undefined;
      const reduced = tryonAnimationsDisabled();
      gsap.killTweensOf([panel, scrim]);
      if (popupOpen) {
        if (reduced) {
          gsap.set(panel, { autoAlpha: 1, y: 0, scale: 1 });
          if (scrim) gsap.set(scrim, { autoAlpha: 1 });
          return undefined;
        }
        if (scrim) {
          gsap.fromTo(
            scrim,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.16, ease: "power2.out" },
          );
        }
        gsap.fromTo(
          panel,
          { autoAlpha: 0, y: 12, scale: 0.96 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.26,
            ease: "power3.out",
          },
        );
        return undefined;
      }
      if (reduced) {
        setPopupRendered(false);
        return undefined;
      }
      const finishClose = (contextSafe || ((callback) => callback))(() => {
        setPopupRendered(false);
      });
      if (scrim) {
        gsap.to(scrim, { autoAlpha: 0, duration: 0.14, ease: "power2.in" });
      }
      gsap.to(panel, {
        autoAlpha: 0,
        y: 8,
        scale: 0.98,
        duration: 0.18,
        ease: "power2.in",
        onComplete: finishClose,
      });
      return undefined;
    },
    {
      dependencies: [popupOpen, popupRendered],
      revertOnUpdate: false,
      scope: popupRootRef,
    },
  );

  return (
    <>
      <div
        className="tryon-stage__card-actions"
        role="group"
        aria-label={groupAria}
      >
        <button
          type="button"
          disabled={disabled}
          aria-label={`${t("上传")}${t(uploadLabel)}`}
          onClick={onPickUpload}
        >
          <i className="bi bi-cloud-arrow-up" />
          {t("上传")}
        </button>
        <button
          type="button"
          className={popupOpen ? "is-active" : ""}
          disabled={disabled || !catalog.length}
          onClick={() => {
            if (popupOpen) closePopup();
            else openPopup();
          }}
          aria-haspopup="dialog"
          aria-expanded={popupOpen}
          aria-label={moreAria}
        >
          <i className="bi bi-grid" />
          {t("更多")}
        </button>
        {children}
      </div>
      {popupRendered
        ? createPortal(
            <div
              ref={popupRootRef}
              className={`tryon-model-popup-root${isDark ? "" : " is-light"}${popupOpen ? " is-open" : " is-closing"}`}
            >
              <button
                type="button"
                className="tryon-model-popup__scrim"
                aria-label={closeScrimLabel}
                onClick={closePopup}
              />
              <section
                ref={popupPanelRef}
                className={`tryon-model-popup is-v2${popupKind ? ` is-${popupKind}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={popupTitleId}
              >
                <header className="tryon-model-popup__head">
                  <div className="tryon-model-popup__heading">
                    <strong id={popupTitleId}>{popupTitle}</strong>
                    <small>{popupHint}</small>
                  </div>
                  <button
                    type="button"
                    className="tryon-model-popup__close"
                    aria-label="关闭"
                    onClick={closePopup}
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                </header>
                {filters.length > 1 ? (
                  <div
                    className="tryon-model-popup__filters"
                    role="tablist"
                    aria-label={t("筛选")}
                  >
                    {filters.map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={filter === id}
                        className={filter === id ? "is-active" : ""}
                        onClick={() => setFilter(id)}
                      >
                        {t(label)}
                        <span>{count}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className="tryon-model-popup__grid">
                  {filter === "all" && onPickUpload ? (
                    <button
                      type="button"
                      className="tryon-model-popup__upload"
                      onClick={() => {
                        closePopup();
                        onPickUpload();
                      }}
                    >
                      <span className="tryon-model-popup__upload-icon">
                        <i className="bi bi-cloud-arrow-up" aria-hidden="true" />
                      </span>
                      <strong>
                        {t("上传")}
                        {t(uploadLabel)}
                      </strong>
                      <small>{t("用你自己的图片")}</small>
                    </button>
                  ) : null}
                  {visibleCatalog.length ? (
                    visibleCatalog.map((option) => {
                      const selected =
                        !option.custom &&
                        source !== "upload" &&
                        featured?.id === option.id;
                      const favorite = favoriteSet.has(option.id);
                      return (
                        <article
                          key={option.id}
                          className={`tryon-model-popup__card${selected ? " is-active" : ""}${option.custom ? " is-custom" : ""}`}
                        >
                          <button
                            type="button"
                            className="tryon-model-popup__hit"
                            aria-label={option.label}
                            aria-current={selected ? "true" : undefined}
                            onClick={() => {
                              if (option.custom) {
                                onSelectCustom?.(option);
                                closePopup();
                                return;
                              }
                              updatePicks((current) => ({
                                ...current,
                                recent: [
                                  option.id,
                                  ...current.recent.filter(
                                    (id) => id !== option.id,
                                  ),
                                ].slice(0, TRYON_PICKS_RECENT_LIMIT),
                              }));
                              onSelectBuiltin(option);
                              closePopup();
                            }}
                          >
                            <span className="tryon-model-popup__media">
                              <img src={option.image} alt="" loading="lazy" />
                              {option.custom ? (
                                <span className="tryon-model-popup__recent is-custom">
                                  {t(option.label)}
                                </span>
                              ) : !favorite && recentSet.has(option.id) ? (
                                <span className="tryon-model-popup__recent">
                                  {t("最近")}
                                </span>
                              ) : null}
                            </span>
                            <span className="tryon-model-popup__meta">
                              {option.custom ? (
                                <span className="tryon-model-popup__name">
                                  {t(option.label)}
                                </span>
                              ) : null}
                              {selected ? (
                                <i
                                  className="bi bi-check-circle-fill"
                                  aria-hidden="true"
                                />
                              ) : null}
                              {option.custom ? null : (
                                <span className="tryon-model-popup__name">
                                  {option.label}
                                </span>
                              )}
                            </span>
                          </button>
                          {option.custom && onForgetCustom ? (
                            <button
                              type="button"
                              className="tryon-model-popup__forget"
                              aria-label={`${t("移除")} ${t(option.label)}`}
                              title={t("从最近中移除")}
                              onClick={() => onForgetCustom(option.id)}
                            >
                              <i className="bi bi-x" aria-hidden="true" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={`tryon-model-popup__fav${favorite ? " is-on" : ""}`}
                            aria-label={
                              favorite
                                ? `${t("取消收藏")} ${option.label}`
                                : `${t("收藏")} ${option.label}`
                            }
                            aria-pressed={favorite}
                            onClick={() =>
                              updatePicks((current) => ({
                                ...current,
                                favorites: favorite
                                  ? current.favorites.filter(
                                      (id) => id !== option.id,
                                    )
                                  : [option.id, ...current.favorites],
                              }))
                            }
                          >
                            <i
                              className={`bi ${favorite ? "bi-star-fill" : "bi-star"}`}
                              aria-hidden="true"
                            />
                          </button>
                        </article>
                      );
                    })
                  ) : (
                    <p className="tryon-model-popup__empty">
                      {t(filter === "all" ? "暂无预设素材" : "这里还没有内容")}
                    </p>
                  )}
                </div>
              </section>
            </div>,
            ecommerceOverlayRoot(),
          )
        : null}
    </>
  );
}

const TRYON_CURTAIN_CLOSE_MS = 900;
const TRYON_CURTAIN_OPEN_MS = 420;
const TRYON_RESULT_PREFETCH_MS = 280;

function tryonCurtainReducedMotion() {
  if (typeof document === "undefined") return false;
  return (
    document.documentElement.classList.contains("settings-no-animations") ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function formatTryonSeconds(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return String(value).padStart(2, "0");
}

function TryonGeneratingStage({
  garmentUrl,
  modelImage,
  sceneImage,
  resultUrl,
  running,
  failed = false,
  failCancelled = false,
  failMessage = "",
  startedAt = "",
  elapsedSeconds = 0,
  generationStageLabel = "正在生成",
  onRevealEnd,
  onElapsed,
}) {
  const frame = modelImage || garmentUrl || sceneImage;
  const canPrefetch = Boolean(resultUrl) && !failed;
  const revealShot = canPrefetch ? resultUrl : "";
  const parsedStartedAt = Date.parse(startedAt);
  const hasStartedAt = Number.isFinite(parsedStartedAt);
  const startedRef = useRef(hasStartedAt ? parsedStartedAt : Date.now());
  if (hasStartedAt) startedRef.current = parsedStartedAt;
  const onRevealEndRef = useRef(onRevealEnd);
  const onElapsedRef = useRef(onElapsed);
  onRevealEndRef.current = onRevealEnd;
  onElapsedRef.current = onElapsed;
  const [phase, setPhase] = useState("open");
  const [closed, setClosed] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [seconds, setSeconds] = useState(
    Math.max(0, Number(elapsedSeconds) || 0),
  );
  const [shotReady, setShotReady] = useState(false);

  useEffect(() => {
    if (tryonCurtainReducedMotion()) {
      setPhase("shut");
      setClosed(true);
      setShowClock(true);
      return undefined;
    }
    let innerId = 0;
    const frameId = requestAnimationFrame(() => {
      innerId = requestAnimationFrame(() => setPhase("shut"));
    });
    const closeId = setTimeout(() => {
      setClosed(true);
      setShowClock(true);
    }, TRYON_CURTAIN_CLOSE_MS);
    return () => {
      cancelAnimationFrame(frameId);
      cancelAnimationFrame(innerId);
      clearTimeout(closeId);
    };
  }, []);

  useEffect(() => {
    if (!resultUrl) {
      setShotReady(false);
      return undefined;
    }
    setShotReady(false);
    const fallback = setTimeout(
      () => setShotReady(true),
      TRYON_RESULT_PREFETCH_MS,
    );
    return () => clearTimeout(fallback);
  }, [resultUrl]);

  useEffect(() => {
    if (!showClock || phase === "opening") return undefined;
    if (!hasStartedAt) {
      setSeconds(Math.max(0, Number(elapsedSeconds) || 0));
      return undefined;
    }
    const tick = () => {
      setSeconds(
        Math.max(0, Math.floor((Date.now() - startedRef.current) / 1000)),
      );
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [showClock, phase, hasStartedAt, startedAt, elapsedSeconds]);

  useEffect(() => {
    if (running && phase !== "opening") return;
    onElapsedRef.current?.(
      hasStartedAt
        ? Math.max(0, Math.floor((Date.now() - startedRef.current) / 1000))
        : Math.max(0, Number(elapsedSeconds) || 0),
    );
  }, [running, phase, hasStartedAt, startedAt, elapsedSeconds]);

  useEffect(() => {
    if (!closed || phase === "opening") return undefined;
    const canOpen = shotReady || (!running && failed);
    if (!canOpen) return undefined;
    if (tryonCurtainReducedMotion()) {
      onRevealEndRef.current?.();
      return undefined;
    }
    setPhase("opening");
  }, [running, closed, shotReady, phase, failed]);

  useEffect(() => {
    if (phase !== "opening") return undefined;
    const timer = setTimeout(
      () => onRevealEndRef.current?.(),
      TRYON_CURTAIN_OPEN_MS,
    );
    return () => clearTimeout(timer);
  }, [phase]);

  return (
    <div
      className={`tryon-generating is-${phase}`}
      aria-live="polite"
      aria-label={
        !running && failed
          ? failCancelled
            ? "已停止生成"
            : "生成失败"
          : showClock
            ? `${generationStageLabel}，已等待 ${seconds} 秒`
            : generationStageLabel
      }
    >
      {!running && failed ? (
        <div className="tryon-stage__fail">
          <i
            className={`bi ${failCancelled ? "bi-stop-circle" : "bi-exclamation-circle"}`}
          />
          <strong>{failCancelled ? "已停止生成" : "生成失败"}</strong>
          <span>{failMessage || "请稍后重试"}</span>
        </div>
      ) : revealShot ? (
        <AuthenticatedImage
          className="tryon-generating__frame"
          src={revealShot}
          alt=""
          loading="eager"
          maxDimension={1600}
          onLoad={() => setShotReady(true)}
          onError={() => setShotReady(true)}
        />
      ) : frame ? (
        <img className="tryon-generating__frame" src={frame} alt="" />
      ) : null}
      <span className="tryon-generating__dim" />
      <div className="tryon-generating__veil">
        <span className="is-left" />
        <span className="is-right" />
      </div>
      {showClock && running ? (
        <div className="tryon-generating__time">
          <strong key={seconds}>{formatTryonSeconds(seconds)}</strong>
        </div>
      ) : null}
    </div>
  );
}

function tryonFileUrl(key) {
  const value = String(key || "").trim();
  if (!value) return "";
  return `/api/v1/files/${value.split("/").map(encodeURIComponent).join("/")}`;
}

// 结果当时实际用到的参考图：[衣服, 模特, 场景, 下装?]；改图任务第 1 张是上一版结果
export function tryonRowReferences(row) {
  const params = row?.task?.params || {};
  const keys = Array.isArray(params.referenceKeys) ? params.referenceKeys : null;
  if (!keys?.length) return null;
  const offset = params.parentOutputUrl || params.iterationMode ? 1 : 0;
  const garment = tryonFileUrl(keys[offset]);
  if (!garment) return null;
  // 纯白棚拍没有场景图，下装紧跟在模特之后
  const bottomAt = params.tryonBackdrop === "white" ? 2 : 3;
  return {
    garment,
    model: tryonFileUrl(keys[offset + 1]),
    bottom: tryonFileUrl(keys[offset + bottomAt]),
  };
}

// “虚拟试衣 · 上身主图 · 第2件” → “第2件 · 上身主图”
export function tryonRowShotLabel(row) {
  const parts = String(row?.task?.params?.viewLabel || "")
    .split(" · ")
    .slice(1)
    .filter(Boolean);
  const piece = parts.find((part) => /^第\s*\d+\s*件$/.test(part));
  const rest = parts.filter((part) => part !== piece);
  return [piece, ...rest].filter(Boolean).join(" · ");
}

// 批量里第几件衣服（0 起）：viewId 末尾 -gN，旧数据退回看 viewLabel 的“第N件”
export function tryonRowGarmentIndex(row) {
  const params = row?.task?.params || {};
  const byId = String(params.viewId || "").match(/-g(\d+)$/);
  if (byId) return Math.max(0, Number(byId[1]) - 1);
  const byLabel = String(params.viewLabel || "").match(/第\s*(\d+)\s*件/);
  return byLabel ? Math.max(0, Number(byLabel[1]) - 1) : 0;
}

export function groupTryonGarments(rows = []) {
  const byGarment = new Map();
  for (const row of rows) {
    const garment = tryonRowGarmentIndex(row);
    if (!byGarment.has(garment)) byGarment.set(garment, []);
    byGarment.get(garment).push(row);
  }
  return [...byGarment.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([garment, items]) => ({
      garment,
      rows: items.sort((a, b) => (a.index || 0) - (b.index || 0)),
    }));
}

export function groupTryonHistory(rows = []) {
  const groups = [];
  const byId = new Map();
  for (const row of rows) {
    const id = String(row.groupId || row.url);
    let group = byId.get(id);
    if (!group) {
      group = { id, rows: [], size: 1 };
      byId.set(id, group);
      groups.push(group);
    }
    group.rows.push(row);
    group.size = Math.max(group.size, Number(row.groupSize) || 1);
  }
  for (const group of groups) {
    group.rows.sort((a, b) => (a.index || 0) - (b.index || 0));
    group.size = Math.max(group.size, group.rows.length);
  }
  return groups;
}

function tryonShotName(row) {
  return tryonRowShotLabel(row)
    .split(" · ")
    .filter((part) => !/^第\s*\d+\s*件$/.test(part))
    .join(" · ");
}

// 一件衣服的卡组：鼠标左右划过即逐张预览本件各机位，点击从当前这张打开全屏
function TryonGarmentStack({ entry, order, expected, onOpen }) {
  const { t } = useLocale();
  const [skim, setSkim] = useState(0);
  const count = entry.rows.length;
  const row = entry.rows[Math.min(skim, count - 1)] || entry.rows[0];
  const layers = Math.min(2, count - 1);
  const shotName = tryonShotName(row);

  function skimFromPointer(event) {
    if (count < 2 || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
    const next = Math.min(count - 1, Math.max(0, Math.floor(ratio * count)));
    if (next !== skim) setSkim(next);
  }

  return (
    <button
      type="button"
      role="listitem"
      data-garment={entry.garment}
      className={`tryon-stage__stack${layers ? " has-layers" : ""}`}
      style={{ "--stack-order": order }}
      aria-label={`${t("预览第")}${entry.garment + 1}${t("件")}（${count}${t("张")}）`}
      onPointerMove={skimFromPointer}
      onPointerLeave={() => setSkim(0)}
      onBlur={() => setSkim(0)}
      onKeyDown={(event) => {
        if (count < 2 || document.querySelector(".tryon-viewer")) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          setSkim((current) =>
            (current + (event.key === "ArrowRight" ? 1 : -1) + count) % count,
          );
        }
      }}
      onClick={(event) => {
        const cover = event.currentTarget.querySelector(
          ".tryon-stage__stack-cover",
        );
        onOpen(row, cover?.getBoundingClientRect() || null);
      }}
    >
      {layers > 1 ? <span className="tryon-stage__stack-layer is-back" /> : null}
      {layers > 0 ? <span className="tryon-stage__stack-layer is-mid" /> : null}
      <span className="tryon-stage__stack-cover">
        {entry.rows.map((item, at) => (
          <AuthenticatedImage
            key={item.url}
            className={`tryon-stage__stack-frame${item === row ? " is-shown" : ""}`}
            src={item.preview || item.url}
            fallbackSrc={item.url}
            alt=""
            loading={at === 0 ? "eager" : "lazy"}
            maxDimension={720}
          />
        ))}
        {count > 1 ? (
          <span className="tryon-stage__stack-skim" aria-hidden="true">
            {entry.rows.map((item) => (
              <i key={item.url} className={item === row ? "is-on" : ""} />
            ))}
          </span>
        ) : null}
      </span>
      <span className="tryon-stage__stack-label">
        {t("第")}
        {entry.garment + 1}
        {t("件")}
        {shotName && count > 1 ? <em>{shotName}</em> : null}
      </span>
      <span className="tryon-stage__stack-count">
        <i className="bi bi-images" aria-hidden="true" />
        {count}
        {count < expected ? `/${expected}` : ""}
      </span>
    </button>
  );
}

function tryonHistoryRatio(row) {
  const [width, height] = String(row?.aspectRatio || "2:3")
    .split(":")
    .map(Number);
  if (!width || !height) return "2 / 3";
  return `${width} / ${height}`;
}

function composeLinkPath(x1, y1, x2, y2) {
  const dx = Math.max(28, (x2 - x1) * 0.48);
  return `M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}`;
}

function TryonComposeLinks({
  running,
  modelRef,
  garmentRef,
  sceneRef,
  targetRef,
}) {
  const svgRef = useRef(null);
  const [links, setLinks] = useState({
    viewBox: "0 0 1 1",
    paths: ["", "", ""],
  });

  useLayoutEffect(() => {
    const svg = svgRef.current;
    const target = targetRef?.current;
    const sources = [
      [garmentRef?.current, 0.22],
      [modelRef?.current, 0.5],
      [sceneRef?.current, 0.78],
    ];
    if (!svg || !target || sources.some(([node]) => !node)) return undefined;

    const update = () => {
      const root = svg.getBoundingClientRect();
      const dest = target.getBoundingClientRect();
      if (root.width < 8 || dest.width < 8) return;
      const startX =
        Math.max(
          ...sources.map(([node]) => node.getBoundingClientRect().right),
        ) - root.left;
      const endX = dest.left - root.left;
      if (endX - startX < 10) return;
      setLinks({
        viewBox: `0 0 ${root.width} ${root.height}`,
        paths: sources.map(([node, t]) => {
          const box = node.getBoundingClientRect();
          return composeLinkPath(
            startX,
            box.top - root.top + box.height / 2,
            endX,
            dest.top - root.top + dest.height * t,
          );
        }),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    observer.observe(target);
    sources.forEach(([node]) => observer.observe(node));
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [running, modelRef, garmentRef, sceneRef, targetRef]);

  return (
    <svg
      ref={svgRef}
      className={`tryon-compose${running ? " is-running" : ""}`}
      viewBox={links.viewBox}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {links.paths.map((d, index) => (
        <path key={index} className="tryon-compose__link" d={d} />
      ))}
    </svg>
  );
}

export function TryonLiveStage({
  aspectRatio,
  ratioStyle,
  apparel,
  apparelOptions,
  onChangeApparel,
  garment,
  bottomGarment,
  onUploadBottom,
  onRemoveBottom,
  garmentDetect = null,
  slotHints = {},
  undo = null,
  balanceShort = false,
  packLabel = "",
  batchGarments = null,
  estimateSeconds = 0,
  backdrop = "scene",
  onChangeBackdrop,
  historyPending = false,
  inputsPending = false,
  runningGarments = 0,
  historyHasMore = false,
  historyLoadingMore = false,
  onLoadMoreHistory,
  onAddBatch,
  onRemoveBatch,
  onDropBatch,
  modelImage,
  modelLabel,
  scene,
  sceneImage,
  resultUrl,
  history = [],
  running,
  failed,
  failCancelled = false,
  failMessage = "",
  elapsedSeconds = 0,
  runStartedAt = "",
  generationStageLabel = "正在生成",
  onPreview,
  onUploadGarment,
  onGenerate,
  onCancel,
  onSelectHistory,
  onUseResultAsModel,
  onDownloadResult,
  onDownloadGroup,
  onResultImageSize,
  generateDisabled,
  generateHint,
  shotCount,
  costLabel = "",
  cancelling,
  modelPicker,
  scenePicker,
  garmentPicker,
  uploadNotice = "",
  onDropSlot,
  editBrief = "",
  editMentions = [],
  onChangeEdit,
  revisionReady = false,
  copy = TRYON_STAGE_COPY,
}) {
  const { locale, t } = useLocale();
  const [curtainHold, setCurtainHold] = useState(false);
  const [curtainRun, setCurtainRun] = useState(0);
  const [runSeconds, setRunSeconds] = useState(0);
  const [elapsedByUrl, setElapsedByUrl] = useState({});
  const [historyRatios, setHistoryRatios] = useState({});
  const [editOpen, setEditOpen] = useState(false);
  const [editRendered, setEditRendered] = useState(false);
  const [editDraft, setEditDraft] = useState("");
  const [downloading, setDownloading] = useState("");
  async function runDownload(kind, task) {
    if (downloading) return;
    setDownloading(kind);
    try {
      await task();
    } catch {
      /* 失败提示由下载工具自身的通知负责 */
    } finally {
      setDownloading("");
    }
  }
  const historyGroups = groupTryonHistory(history);
  // 右侧历史：滚到底再加载下一页；缩略图进入可视区才加载
  const [historyScroller, setHistoryScroller] = useState(null);
  const historySentinelRef = useRef(null);
  const loadMoreRef = useRef(onLoadMoreHistory);
  loadMoreRef.current = onLoadMoreHistory;
  useEffect(() => {
    const sentinel = historySentinelRef.current;
    if (!sentinel || !historyScroller || !historyHasMore || historyLoadingMore)
      return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting))
          loadMoreRef.current?.();
      },
      { root: historyScroller, rootMargin: "240px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [historyScroller, historyHasMore, historyLoadingMore, history.length]);
  const currentRow = history.find((row) => row.url === resultUrl) || null;
  const currentGroup =
    historyGroups.find((group) =>
      group.rows.some((row) => row.url === resultUrl),
    ) || null;
  // 多件衣服：默认折叠卡组，点开进全屏预览；选“在画布查看”后回到单件视图
  const [groupFocus, setGroupFocus] = useState(false);
  const [viewerUrl, setViewerUrl] = useState("");
  const [viewerOrigin, setViewerOrigin] = useState(null);
  useEffect(() => {
    setGroupFocus(false);
    setViewerUrl("");
  }, [currentGroup?.id]);
  const garmentGroups = currentGroup ? groupTryonGarments(currentGroup.rows) : [];
  // 生成中按计划件数判断（有的件可能一张都还没出）
  const garmentTotal = Math.max(
    garmentGroups.length,
    running ? runningGarments : 0,
  );
  const multiGarment = garmentTotal > 1;
  const groupGrid = Boolean(multiGarment && !groupFocus);
  const perGarment = multiGarment
    ? Math.max(1, Math.round((currentGroup?.size || 1) / garmentTotal))
    : currentGroup?.size || 1;
  // 边出边看：这一批已出至少一张时不再整体遮挡，未出的位置显示生成中
  const progressive = Boolean(
    running && resultUrl && currentGroup && currentGroup.size > 1,
  );
  const stackEntries = multiGarment
    ? Array.from({ length: garmentTotal }, (_, garment) =>
        garmentGroups.find((entry) => entry.garment === garment) || {
          garment,
          rows: [],
        },
      )
    : garmentGroups;
  const currentGarment =
    garmentGroups.find((entry) =>
      entry.rows.some((row) => row.url === resultUrl),
    ) || null;
  // 单件多机位（4 连拍）：其余机位挂在大图右上角
  const hangingSlots =
    !groupGrid && currentGarment && perGarment > 1
      ? Array.from(
          { length: perGarment },
          (_, at) =>
            currentGarment.rows.find(
              (row) => (row.index || 0) % perGarment === at,
            ) || null,
        )
      : [];
  const [mention, setMention] = useState(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const composingRef = useRef(false);
  const editInputRef = useRef(null);
  const composerRef = useRef(null);
  const modelRef = useRef(null);
  const garmentRef = useRef(null);
  const sceneRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    setCurtainHold(true);
    setCurtainRun((value) => value + 1);
    setRunSeconds(0);
    setEditOpen(false);
  }, [running]);

  useEffect(() => {
    if (!editOpen) {
      setMention(null);
      setMentionIndex(0);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      editInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editOpen]);

  useEffect(() => {
    setEditDraft(editBrief);
    setMention(null);
    setMentionIndex(0);
    setEditOpen(false);
  }, [resultUrl, editBrief]);

  useGSAP(
    (context, contextSafe) => {
      if (!editRendered) return undefined;
      const panel = composerRef.current;
      if (!panel) return undefined;
      const reduced = tryonAnimationsDisabled();
      gsap.killTweensOf(panel);
      if (editOpen) {
        if (reduced) {
          gsap.set(panel, { autoAlpha: 1, y: 0, scale: 1 });
          return undefined;
        }
        gsap.fromTo(
          panel,
          { autoAlpha: 0, y: 14, scale: 0.92 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.26,
            ease: "power3.out",
            transformOrigin: "left bottom",
          },
        );
        return undefined;
      }
      if (reduced) {
        setEditRendered(false);
        return undefined;
      }
      const finishClose = (contextSafe || ((callback) => callback))(() => {
        setEditRendered(false);
      });
      gsap.to(panel, {
        autoAlpha: 0,
        y: 10,
        scale: 0.94,
        duration: 0.18,
        ease: "power2.in",
        transformOrigin: "left bottom",
        onComplete: finishClose,
      });
      return undefined;
    },
    {
      dependencies: [editOpen, editRendered],
      revertOnUpdate: false,
    },
  );

  useEffect(() => {
    if (!resultUrl || !runSeconds) return;
    setElapsedByUrl((current) =>
      current[resultUrl] ? current : { ...current, [resultUrl]: runSeconds },
    );
  }, [resultUrl, runSeconds]);

  const showCurtain = (running || curtainHold) && !progressive;
  useEffect(() => {
    if (progressive) setCurtainHold(false);
  }, [progressive]);
  const keyStateRef = useRef({});
  keyStateRef.current = {
    running,
    generateDisabled,
    history,
    historyGroups,
    resultUrl,
    onGenerate,
    onSelectHistory,
    onPreview,
    copy,
    editOpen,
  };
  useEffect(() => {
    // 快捷键：⌘/Ctrl+Enter 生成，←/→ 切换历史结果，空格放大当前结果
    function onKeyDown(event) {
      const state = keyStateRef.current;
      if (document.querySelector(".tryon-model-popup-root, .tryon-viewer"))
        return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        if (state.running || state.generateDisabled) return;
        event.preventDefault();
        state.onGenerate?.();
        return;
      }
      // 补充说明框打开时（哪怕焦点还没落进输入框）不响应切换/放大，避免改错图
      if (
        typing ||
        state.editOpen ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (
        (event.key === "ArrowLeft" || event.key === "ArrowRight") &&
        state.historyGroups.length &&
        !state.running
      ) {
        // 按“组”切换：一次批量/4 连拍算一格
        const groups = state.historyGroups;
        const index = groups.findIndex((group) =>
          group.rows.some((row) => row.url === state.resultUrl),
        );
        const step = event.key === "ArrowRight" ? 1 : -1;
        const next =
          groups[index < 0 ? 0 : (index + step + groups.length) % groups.length];
        if (next?.rows[0]) {
          event.preventDefault();
          state.onSelectHistory?.(next.rows[0].url);
        }
        return;
      }
      if (event.key === " " && state.resultUrl && !state.running) {
        if (target instanceof HTMLElement && target.tagName === "BUTTON")
          return;
        event.preventDefault();
        const rect = resultRef.current?.getBoundingClientRect();
        state.onPreview?.(
          {
            currentTarget: resultRef.current,
            clientX: rect ? rect.left + rect.width / 2 : 0,
            clientY: rect ? rect.top + rect.height / 2 : 0,
          },
          {
            url: state.resultUrl,
            alt: state.copy.resultAlt || "生成结果",
            title: "生成结果",
          },
        );
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  const renderHints = (list) =>
    list?.length
      ? list.map((hint) => (
          <span
            key={hint}
            className="tryon-stage__hint"
            role="note"
            title={t(hint)}
          >
            <i className="bi bi-exclamation-triangle" aria-hidden="true" />
            {t(hint)}
          </span>
        ))
      : null;
  const resultSeconds =
    (resultUrl && elapsedByUrl[resultUrl]) || elapsedSeconds || 0;

  function rememberImageSize(url, width, height) {
    if (!url || !width || !height) return;
    setHistoryRatios((current) =>
      current[url] ? current : { ...current, [url]: `${width} / ${height}` },
    );
    onResultImageSize?.(url, width, height);
  }

  function handleSlotDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
  }
  function handleSlotDrop(event, role) {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files?.length) onDropSlot?.(role, files);
  }
  function openResultEdit() {
    setEditDraft(editBrief);
    setMention(null);
    setMentionIndex(0);
    setEditRendered(true);
    setEditOpen(true);
  }
  function closeResultEdit() {
    setEditDraft(editBrief);
    setMention(null);
    setMentionIndex(0);
    setEditOpen(false);
  }
  function completeResultEdit() {
    onChangeEdit?.(editDraft.trim());
    setMention(null);
    setMentionIndex(0);
    setEditOpen(false);
  }
  function toggleResultEdit() {
    if (editOpen) closeResultEdit();
    else openResultEdit();
  }
  function syncMentionFromInput(value, caret) {
    if (composingRef.current || !editMentions.length) {
      setMention(null);
      setMentionIndex(0);
      return;
    }
    const next = mentionQueryAtCaret(value, caret);
    const same =
      Boolean(mention) === Boolean(next) &&
      mention?.start === next?.start &&
      mention?.query === next?.query;
    setMention(next);
    if (!same) setMentionIndex(0);
  }
  function insertMention(item) {
    const input = editInputRef.current;
    const caret = input?.selectionStart ?? editDraft.length;
    const state = mentionQueryAtCaret(editDraft, caret) || mention;
    if (!state || !item?.token) return;
    const insert = `@${item.token} `;
    const next = `${editDraft.slice(0, state.start)}${insert}${editDraft.slice(caret)}`;
    const pos = state.start + insert.length;
    setEditDraft(next);
    setMention(null);
    setMentionIndex(0);
    window.requestAnimationFrame(() => {
      const el = editInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }
  const mentionCandidates = mention
    ? filterTryonMentions(editMentions, mention.query)
    : [];
  const mentionActive = Math.min(
    mentionIndex,
    Math.max(0, mentionCandidates.length - 1),
  );

  return (
    <div
      className={`tryon-stage${history.length || historyPending ? "" : " is-history-empty"}${inputsPending ? " is-inputs-pending" : ""}`}
      aria-label={t(copy.aria)}
    >
      {uploadNotice ? (
        <p className="tryon-stage__notice" role="status">
          {uploadNotice}
        </p>
      ) : null}
      <div className="tryon-stage__frame" data-scene={scene}>
        <div
          ref={modelRef}
          className={`tryon-stage__card tryon-stage__model${modelImage ? "" : " is-empty"}`}
          data-model={modelLabel}
          onDragOver={handleSlotDragOver}
          onDrop={(event) => handleSlotDrop(event, "model")}
        >
          <span className="tryon-stage__tag">{t("模特")}</span>
          {slotHints.model?.length ? (
            <div className="tryon-stage__foot">
              {renderHints(slotHints.model)}
            </div>
          ) : null}
          {modelImage ? (
            <button
              type="button"
              className="tryon-stage__card-hit"
              aria-label="查看模特大图"
              onClick={(event) =>
                onPreview?.(event, {
                  url: modelImage,
                  alt: modelLabel || "模特",
                  title: "模特",
                })
              }
            >
              <figure>
                <img src={modelImage} alt={modelLabel || "模特"} />
              </figure>
            </button>
          ) : (
            <>
              <i className="bi bi-person" />
              <span>{t("选择模特")}</span>
            </>
          )}
          {modelPicker}
        </div>
        <div
          ref={garmentRef}
          className={`tryon-stage__card tryon-stage__garment${garment?.url ? "" : " is-empty"}`}
          data-apparel={apparel}
          onDragOver={handleSlotDragOver}
          onDrop={(event) => handleSlotDrop(event, "garment")}
        >
          <div
            className={`tryon-stage__head${bottomGarment !== undefined ? " has-bottom" : ""}`}
          >
            <span className="tryon-stage__tag">
              {t(bottomGarment !== undefined ? "上装" : copy.centerTag)}
            </span>
          {garmentDetect ? (
            <span
              className={`tryon-stage__detect is-${garmentDetect.status}`}
              role="status"
            >
              {garmentDetect.status === "busy" ? (
                <>
                  <i className="bi bi-arrow-repeat" aria-hidden="true" />
                  {t("识别服装中")}
                </>
              ) : garmentDetect.status === "done" ? (
                <>
                  <i className="bi bi-magic" aria-hidden="true" />
                  {garmentDetect.label ? `${garmentDetect.label} · ` : ""}
                  {t(garmentDetect.apparel)}
                </>
              ) : (
                <>
                  <i className="bi bi-info-circle" aria-hidden="true" />
                  {t("未识别，请手动选类型")}
                </>
              )}
            </span>
          ) : null}
          </div>
          {Array.isArray(batchGarments) && bottomGarment === undefined ? (
            <div
              className="tryon-stage__batch is-corner"
              aria-label={t("批量服装")}
              onDragOver={handleSlotDragOver}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const files = event.dataTransfer?.files;
                if (files?.length) onDropBatch?.(files);
              }}
            >
              {batchGarments.map((entry, index) => (
                <div key={entry.id} className="tryon-stage__batch-item">
                  <img src={entry.url} alt={`${t("批量服装")} ${index + 2}`} />
                  <span className="tryon-stage__batch-index">{index + 2}</span>
                  <button
                    type="button"
                    className="tryon-stage__batch-remove"
                    aria-label={t("移除这件服装")}
                    disabled={running}
                    onClick={() => onRemoveBatch?.(entry.id)}
                  >
                    <i className="bi bi-x" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {batchGarments.length < 5 ? (
                <button
                  type="button"
                  className="tryon-stage__batch-add"
                  disabled={running}
                  title={t("再加几件衣服，用同一模特和场景一起出图")}
                  aria-label={t("批量添加衣服")}
                  onClick={onAddBatch}
                >
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                  <span>
                    {batchGarments.length ? t("加衣服") : t("批量")}
                  </span>
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="tryon-stage__foot">
            {renderHints(slotHints.garment)}
            {bottomGarment?.url
              ? renderHints(
                  (slotHints.bottom || []).map((hint) => `下装：${hint}`),
                )
              : null}
          </div>
          {bottomGarment !== undefined ? (
            <div
              className={`tryon-stage__bottom${bottomGarment?.url ? "" : " is-empty"}`}
              onDragOver={handleSlotDragOver}
              onDrop={(event) => {
                event.stopPropagation();
                handleSlotDrop(event, "bottom");
              }}
            >
              {bottomGarment?.url ? (
                <>
                  <button
                    type="button"
                    className="tryon-stage__bottom-hit"
                    aria-label={t("查看下装大图")}
                    onClick={(event) =>
                      onPreview?.(event, {
                        url: bottomGarment.url,
                        alt: "下装参考图",
                        title: "下装",
                      })
                    }
                  >
                    <img src={bottomGarment.url} alt={t("下装参考图")} />
                  </button>
                  <button
                    type="button"
                    className="tryon-stage__bottom-remove"
                    aria-label={t("移除下装")}
                    disabled={running}
                    onClick={onRemoveBottom}
                  >
                    <i className="bi bi-x" aria-hidden="true" />
                  </button>
                  <span className="tryon-stage__bottom-tag">{t("下装")}</span>
                </>
              ) : (
                <button
                  type="button"
                  className="tryon-stage__bottom-hit is-upload"
                  disabled={running}
                  onClick={onUploadBottom}
                >
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                  <span>{t("下装")}</span>
                </button>
              )}
            </div>
          ) : null}
          {garment?.url ? (
            <button
              type="button"
              className="tryon-stage__card-hit"
              aria-label={copy.centerPreviewAria}
              onClick={(event) =>
                onPreview?.(event, {
                  url: garment.url,
                  alt: `${apparel}${copy.centerTitle}参考图`,
                  title: copy.centerTitle,
                })
              }
            >
              <figure>
                <img src={garment.url} alt={`${copy.centerTitle}参考图`} />
              </figure>
            </button>
          ) : (
            <button
              type="button"
              className="tryon-stage__card-hit is-upload"
              aria-label={copy.centerEmptyAria}
              disabled={running}
              onClick={onUploadGarment}
            >
              <i className={`bi ${copy.emptyIcon}`} />
              <span>{t(copy.centerEmpty)}</span>
              {copy.centerHint ? <small>{copy.centerHint}</small> : null}
            </button>
          )}
          {garmentPicker || (
            <div className="tryon-stage__card-actions">
              <button
                type="button"
                disabled={running}
                aria-label={copy.centerUploadAria}
                onClick={onUploadGarment}
              >
                <i className="bi bi-cloud-arrow-up" />
                {t("上传")}
              </button>
              <label className="tryon-stage__apparel">
                <CommerceSelect
                  value={apparel}
                  options={apparelOptions}
                  onChange={onChangeApparel}
                  ariaLabel={copy.selectAria}
                  menuMinWidth={132}
                  disabled={running}
                />
              </label>
            </div>
          )}
        </div>
        <div
          ref={sceneRef}
          className={`tryon-stage__card tryon-stage__scene-card${backdrop === "white" ? " is-white" : sceneImage ? "" : " is-empty"}`}
          data-backdrop={backdrop}
          onDragOver={handleSlotDragOver}
          onDrop={(event) => {
            if (backdrop === "white") onChangeBackdrop?.("scene");
            handleSlotDrop(event, "scene");
          }}
        >
          <span className="tryon-stage__tag">{t("背景")}</span>
          {onChangeBackdrop ? (
            <div
              className="tryon-stage__backdrop"
              role="radiogroup"
              aria-label={t("选择背景")}
            >
              {[
                ["scene", "场景图"],
                ["white", "纯白棚拍"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={backdrop === id}
                  className={backdrop === id ? "is-active" : ""}
                  disabled={running}
                  onClick={() => onChangeBackdrop(id)}
                >
                  {t(label)}
                </button>
              ))}
            </div>
          ) : null}
          {backdrop === "white" ? (
            <div className="tryon-stage__white-studio">
              <span className="tryon-stage__white-swatch" aria-hidden="true" />
              <strong>{t("纯白棚拍")}</strong>
              <small>{t("RGB 255 纯白背景 · 均匀柔光")}</small>
              <small>{t("适合亚马逊等平台主图")}</small>
            </div>
          ) : sceneImage ? (
            <button
              type="button"
              className="tryon-stage__card-hit"
              aria-label="查看场景大图"
              onClick={(event) =>
                onPreview?.(event, {
                  url: sceneImage,
                  alt: scene || "拍摄场景",
                  title: "场景",
                })
              }
            >
              <figure>
                <img
                  className="tryon-stage__scene-photo"
                  src={sceneImage}
                  alt={scene || "拍摄场景"}
                />
              </figure>
            </button>
          ) : (
            <>
              <i className="bi bi-image" />
              <span>{t("选择场景")}</span>
            </>
          )}
          {backdrop === "white" ? null : scenePicker}
        </div>
      </div>
      <div className="tryon-stage__output">
        <div
          ref={resultRef}
          className={`tryon-stage__card tryon-stage__result${resultUrl && !showCurtain ? " has-image" : historyPending ? " is-pending" : " is-empty"}${running || showCurtain ? " is-running" : ""}${failed ? " is-failed" : ""}`}
          data-ratio={aspectRatio}
          style={ratioStyle}
        >
          {showCurtain ? (
            <TryonGeneratingStage
              key={curtainRun}
              garmentUrl={garment?.url}
              modelImage={modelImage}
              sceneImage={sceneImage}
              resultUrl={resultUrl}
              running={running}
              failed={failed}
              failCancelled={failCancelled}
              failMessage={failMessage}
              startedAt={runStartedAt}
              elapsedSeconds={elapsedSeconds}
              generationStageLabel={generationStageLabel}
              onRevealEnd={() => setCurtainHold(false)}
              onElapsed={(value) => {
                const seconds = Math.max(0, Number(value) || 0);
                setRunSeconds(seconds);
                if (!resultUrl) return;
                setElapsedByUrl((current) => ({
                  ...current,
                  [resultUrl]: seconds,
                }));
              }}
            />
          ) : failed ? (
            <div className="tryon-stage__fail" role="alert">
              <i
                className={`bi ${failCancelled ? "bi-stop-circle" : "bi-exclamation-circle"}`}
              />
              <strong>{failCancelled ? "已停止生成" : "生成失败"}</strong>
              <span>{failMessage || "请稍后重试"}</span>
            </div>
          ) : resultUrl ? (
            <>
              {groupGrid ? null : (
              <button
                type="button"
                className="tryon-stage__card-hit tryon-stage__result-hit"
                aria-label="查看生成结果"
                onClick={(event) =>
                  onPreview?.(event, {
                    url: resultUrl,
                    alt: copy.resultAlt || "生成结果",
                    title: "生成结果",
                  })
                }
              >
                <AuthenticatedImage
                  key={resultUrl}
                  className="tryon-stage__result-image"
                  src={
                    // 主舞台大图优先展示图（服务端压缩大图），404 回退原图
                    history.find((row) => row.url === resultUrl)?.display ||
                    resultUrl
                  }
                  fallbackSrc={resultUrl}
                  alt={copy.resultAlt || "生成结果"}
                  loading="eager"
                  maxDimension={1600}
                  onLoad={(event) => {
                    rememberImageSize(
                      resultUrl,
                      event.currentTarget.naturalWidth,
                      event.currentTarget.naturalHeight,
                    );
                  }}
                />
              </button>
              )}
              {progressive ? (
                <span className="tryon-stage__progress" role="status">
                  <i className="bi bi-arrow-repeat is-spin" aria-hidden="true" />
                  {t("生成中")} · {t("已出")} {currentGroup.rows.length}/
                  {currentGroup.size}
                </span>
              ) : null}
              {groupGrid && onDownloadGroup && !running ? (
                <button
                  type="button"
                  className="tryon-stage__stacks-download"
                  disabled={Boolean(downloading)}
                  onClick={() =>
                    runDownload("group", () => onDownloadGroup(currentGroup.rows))
                  }
                >
                  <i
                    className={`bi ${downloading === "group" ? "bi-arrow-repeat is-spin" : "bi-download"}`}
                    aria-hidden="true"
                  />
                  {t(downloading === "group" ? "打包中" : "下载全部")}
                  <span>{currentGroup.rows.length}</span>
                </button>
              ) : null}
              {groupGrid ? (
                <div
                  className={`tryon-stage__stacks is-${garmentGroups.length > 4 ? "wide" : "compact"}`}
                  role="list"
                  aria-label={`${t("本次生成")} ${garmentGroups.length} ${t("件")}`}
                >
                  {stackEntries.map((entry, order) =>
                    entry.rows.length ? (
                    <TryonGarmentStack
                      key={entry.garment}
                      entry={entry}
                      order={order}
                      expected={perGarment}
                      onOpen={(row, rect) => {
                        setViewerOrigin(rect);
                        setViewerUrl(row.url);
                      }}
                    />
                    ) : (
                      <div
                        key={`pending-${entry.garment}`}
                        role="listitem"
                        className="tryon-stage__stack is-pending"
                        style={{ "--stack-order": order }}
                      >
                        <span className="tryon-stage__stack-cover">
                          <span className="tryon-stage__skeleton" />
                          <span className="tryon-stage__pending-note">
                            <i className="bi bi-arrow-repeat is-spin" aria-hidden="true" />
                            {t("生成中")}
                          </span>
                        </span>
                        <span className="tryon-stage__stack-label">
                          {t("第")}
                          {entry.garment + 1}
                          {t("件")}
                        </span>
                      </div>
                    ),
                  )}
                </div>
              ) : null}
              {multiGarment && groupFocus ? (
                <button
                  type="button"
                  className="tryon-stage__group-back"
                  onClick={() => setGroupFocus(false)}
                >
                  <i className="bi bi-collection" aria-hidden="true" />
                  {t("返回全部")} {garmentGroups.length} {t("件")}
                  {currentGarment ? (
                    <em>
                      {t("第")}
                      {currentGarment.garment + 1}
                      {t("件")}
                    </em>
                  ) : null}
                </button>
              ) : null}
              {hangingSlots.length ? (
                <div
                  className="tryon-stage__hanging"
                  role="list"
                  aria-label={t("本件其他机位")}
                >
                  {hangingSlots.map((row, at) =>
                    row ? (
                      <button
                        key={row.url}
                        type="button"
                        role="listitem"
                        className={`tryon-stage__hanging-card${row.url === resultUrl ? " is-active" : ""}`}
                        aria-label={tryonRowShotLabel(row) || `${at + 1}`}
                        aria-current={row.url === resultUrl ? "true" : undefined}
                        title={tryonRowShotLabel(row)}
                        onClick={() => onSelectHistory?.(row.url)}
                      >
                        <AuthenticatedImage
                          src={row.preview || row.url}
                          fallbackSrc={row.url}
                          alt=""
                          maxDimension={240}
                        />
                      </button>
                    ) : (
                      <span
                        key={`pending-${at}`}
                        role="listitem"
                        className={`tryon-stage__hanging-card is-pending${running ? " is-running" : ""}`}
                        title={t(running ? "生成中" : "未出图")}
                      >
                        {running ? (
                          <i className="bi bi-arrow-repeat is-spin" aria-hidden="true" />
                        ) : null}
                      </span>
                    ),
                  )}
                </div>
              ) : null}
            </>
          ) : historyPending ? (
            <span className="tryon-stage__skeleton" aria-hidden="true" />
          ) : (
            <div className="tryon-stage__empty-guide">
              <i className="bi bi-stars" />
              <strong>{t("生成结果")}</strong>
              {packLabel ? (
                <small className="tryon-stage__pack-note">
                  {t(packLabel)}
                </small>
              ) : null}
              <ol className="tryon-stage__steps">
                {[
                  [
                    t(bottomGarment !== undefined ? "上装" : copy.centerTitle),
                    Boolean(garment?.url),
                    true,
                  ],
                  ...(bottomGarment !== undefined
                    ? [[t("下装"), Boolean(bottomGarment?.url), true]]
                    : []),
                  [t("模特"), Boolean(modelImage), false],
                  [
                    t(backdrop === "white" ? "纯白棚拍" : "场景"),
                    backdrop === "white" || Boolean(sceneImage),
                    false,
                  ],
                ].map(([label, done, required]) => (
                  <li key={label} className={done ? "is-done" : ""}>
                    <i
                      className={`bi ${done ? "bi-check-circle-fill" : "bi-circle"}`}
                      aria-hidden="true"
                    />
                    {label}
                    {required && !done ? <em>{t("必填")}</em> : null}
                  </li>
                ))}
              </ol>
              {generateDisabled && generateHint ? (
                <span className="tryon-stage__empty-hint">{generateHint}</span>
              ) : null}
            </div>
          )}
          {resultUrl && !running && resultSeconds > 0 && !groupGrid ? (
            <span
              className="tryon-stage__elapsed"
              aria-label={`生成耗时 ${resultSeconds} 秒`}
            >
              {formatTryonSeconds(resultSeconds)}秒
            </span>
          ) : null}
          {editRendered ? (
            <div
              ref={composerRef}
              className={`tryon-stage__result-composer${editOpen ? " is-open" : ""}${mentionCandidates.length ? " is-mentioning" : ""}`}
            >
              {editOpen && mentionCandidates.length ? (
                <ul
                  id="tryon-mention-list"
                  className="tryon-stage__mention-menu"
                  role="listbox"
                  aria-label={t("引用输入信息")}
                >
                  {mentionCandidates.map((item, index) => (
                    <li key={item.id} role="presentation">
                      <button
                        type="button"
                        role="option"
                        id={`tryon-mention-${item.id}`}
                        aria-selected={index === mentionActive}
                        className={
                          index === mentionActive
                            ? "tryon-stage__mention-item is-active"
                            : "tryon-stage__mention-item"
                        }
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setMentionIndex(index)}
                        onClick={() => insertMention(item)}
                      >
                        <strong>@{item.token}</strong>
                        {item.hint ? <small>{item.hint}</small> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <button
                type="button"
                className="tryon-stage__result-close"
                aria-label={t("关闭补充说明")}
                onClick={closeResultEdit}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
              </button>
              <textarea
                ref={editInputRef}
                className="tryon-stage__result-input"
                value={editDraft}
                maxLength={600}
                placeholder={t(
                  "输入补充说明，输入 @ 可引用衣服、模特、场景等",
                )}
                aria-label={t("补充说明")}
                aria-autocomplete="list"
                aria-expanded={Boolean(mentionCandidates.length)}
                aria-controls={
                  mentionCandidates.length ? "tryon-mention-list" : undefined
                }
                aria-activedescendant={
                  mentionCandidates[mentionActive]
                    ? `tryon-mention-${mentionCandidates[mentionActive].id}`
                    : undefined
                }
                onCompositionStart={() => {
                  composingRef.current = true;
                }}
                onCompositionEnd={(event) => {
                  composingRef.current = false;
                  syncMentionFromInput(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onChange={(event) => {
                  const value = event.target.value;
                  setEditDraft(value);
                  syncMentionFromInput(value, event.target.selectionStart);
                }}
                onSelect={(event) => {
                  syncMentionFromInput(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                }}
                onKeyDown={(event) => {
                  if (composingRef.current) return;
                  if (mention && mentionCandidates.length) {
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setMentionIndex(
                        (index) => (index + 1) % mentionCandidates.length,
                      );
                      return;
                    }
                    if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setMentionIndex(
                        (index) =>
                          (index - 1 + mentionCandidates.length) %
                          mentionCandidates.length,
                      );
                      return;
                    }
                    if (event.key === "Enter") {
                      event.preventDefault();
                      insertMention(mentionCandidates[mentionActive]);
                      return;
                    }
                    if (event.key === "Tab") {
                      event.preventDefault();
                      insertMention(mentionCandidates[mentionActive]);
                      return;
                    }
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    if (mention) {
                      setMention(null);
                      setMentionIndex(0);
                      return;
                    }
                    closeResultEdit();
                  }
                }}
              />
              <button
                type="button"
                className="tryon-stage__result-done"
                onClick={completeResultEdit}
              >
                {t("完成")}
              </button>
            </div>
          ) : null}
          <div className="tryon-stage__card-actions is-result-bar">
            {balanceShort && !running ? (
              <Link className="tryon-stage__balance" to="/wallet">
                <i className="bi bi-exclamation-circle" aria-hidden="true" />
                {t("积分不足，去充值")}
              </Link>
            ) : null}
            {resultUrl && !showCurtain && !failed && !groupGrid ? (
              <button
                type="button"
                className={`tryon-stage__result-edit${editBrief.trim() ? " has-brief" : ""}${editOpen ? " is-open" : ""}`}
                disabled={running}
                aria-label={t("补充说明当前结果")}
                aria-expanded={editOpen}
                onClick={toggleResultEdit}
              >
                <i className="bi bi-pencil-square" aria-hidden="true" />
                {t("补充说明")}
              </button>
            ) : null}
            <button
              type="button"
              className={`tryon-generate generate-button${running ? " is-running" : ""}${failed ? " is-failed" : ""}`}
              disabled={running ? cancelling : generateDisabled}
              title={
                revisionReady
                  ? locale === "en"
                    ? "Apply the notes to the current result"
                    : "按补充说明修改当前结果"
                  : generateHint
              }
              aria-label={
                running
                  ? "停止生成"
                  : failed
                    ? `重试生成（${shotCount}张）`
                    : revisionReady
                      ? "按补充说明修改当前结果"
                      : `一键生成（${shotCount}张）`
              }
              onClick={running ? onCancel : onGenerate}
            >
              {running ? <i className="bi bi-stop-fill" /> : failed ? <RegenerateIcon /> : <i className="bi bi-stars" />}
              {running
                ? t("停止")
                : failed
                  ? t("重试")
                  : revisionReady
                    ? locale === "en"
                      ? "Apply"
                      : "应用"
                    : t("生成")}
              <small>
                {running
                  ? cancelling
                    ? t("正在停止")
                    : generationStageLabel
                  : revisionReady
                    ? locale === "en"
                      ? "new version"
                      : "新版本"
                  : locale === "en"
                    ? `${shotCount} ${shotCount === 1 ? "image" : "images"}`
                    : `${shotCount}张`}
                {!running && !revisionReady && costLabel ? ` · ${costLabel}` : ""}
                {!running && !failed && estimateSeconds > 0
                  ? ` · ${t("约")} ${Math.round(estimateSeconds)} ${t("秒")}`
                  : ""}
              </small>
            </button>
            {resultUrl && !showCurtain && !failed && !groupGrid ? (
              <div className="tryon-stage__result-tools">
                {onDownloadResult ? (
                  <button
                    type="button"
                    disabled={Boolean(downloading)}
                    onClick={() =>
                      runDownload("one", () => onDownloadResult(resultUrl))
                    }
                  >
                    <i
                      className={`bi ${downloading === "one" ? "bi-arrow-repeat is-spin" : "bi-download"}`}
                      aria-hidden="true"
                    />
                    {t(downloading === "one" ? "下载中" : "下载")}
                  </button>
                ) : null}
                {onDownloadGroup && currentGroup && currentGroup.size > 1 ? (
                  <button
                    type="button"
                    disabled={Boolean(downloading)}
                    title={t("打包下载这一组全部图片")}
                    onClick={() =>
                      runDownload("group", () => onDownloadGroup(currentGroup.rows))
                    }
                  >
                    <i className="bi bi-file-earmark-zip" aria-hidden="true" />
                    {t("全部")} {currentGroup.rows.length}
                  </button>
                ) : null}

                {onUseResultAsModel ? (
                  <button
                    type="button"
                    disabled={running}
                    title={t("用这张结果继续换其他衣服")}
                    onClick={() => onUseResultAsModel(resultUrl)}
                  >
                    <i className="bi bi-person-check" aria-hidden="true" />
                    {t("设为模特")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <TryonComposeLinks
        running={running || showCurtain}
        modelRef={modelRef}
        garmentRef={garmentRef}
        sceneRef={sceneRef}
        targetRef={resultRef}
      />
      {viewerUrl && currentGroup ? (
        <TryonGroupViewer
          rows={garmentGroups.flatMap((entry) => entry.rows)}
          startUrl={viewerUrl}
          originRect={viewerOrigin}
          returnRectOf={(row) =>
            resultRef.current
              ?.querySelector(
                `.tryon-stage__stack[data-garment="${tryonRowGarmentIndex(row)}"] .tryon-stage__stack-cover`,
              )
              ?.getBoundingClientRect() || null
          }
          garmentOf={tryonRowGarmentIndex}
          labelOf={(row) => tryonRowShotLabel(row) || t("生成结果")}
          referencesOf={tryonRowReferences}
          onClose={() => setViewerUrl("")}
          onDownload={onDownloadResult}
          onUseAsModel={(url) => {
            setViewerUrl("");
            onUseResultAsModel?.(url);
          }}
          onShowOnCanvas={(url) => {
            setViewerUrl("");
            onSelectHistory?.(url);
            setGroupFocus(true);
          }}
        />
      ) : null}
      {undo ? (
        <div className="tryon-stage__undo" role="status">
          <span>{t(undo.message)}</span>
          <button type="button" onClick={undo.onUndo}>
            {t("撤销")}
          </button>
        </div>
      ) : null}
      <aside className="tryon-stage__history" aria-label="生成历史">
        <p className="tryon-history__label">历史</p>
        {historyPending && !history.length ? (
          <div className="tryon-history" aria-hidden="true">
            <span className="tryon-stage__card tryon-history__item tryon-stage__skeleton-card" />
            <span className="tryon-stage__card tryon-history__item tryon-stage__skeleton-card" />
          </div>
        ) : history.length ? (
          <div className="tryon-history" role="list" ref={setHistoryScroller}>
            {historyGroups.map((group) => {
              const row = group.rows[0];
              const active = group === currentGroup;
              return (
              <button
                key={group.id}
                type="button"
                role="listitem"
                className={`tryon-stage__card tryon-history__item${active ? " is-active" : ""}`}
                style={{
                  aspectRatio: historyRatios[row.url] || tryonHistoryRatio(row),
                }}
                disabled={running}
                aria-label={
                  group.size > 1
                    ? `查看历史生成组（${group.size}张）`
                    : "查看历史生成图"
                }
                aria-pressed={active}
                onClick={() => {
                  onSelectHistory?.(row.url);
                  setGroupFocus(false);
                }}
              >
                {group.size > 1 ? (
                  <span className="tryon-history__count">
                    <i className="bi bi-images" aria-hidden="true" />
                    {group.size}
                  </span>
                ) : null}
                <figure>
                  <AuthenticatedImage
                    src={row.preview || row.url}
                    alt=""
                    loading="lazy"
                    observerRoot={historyScroller}
                    maxDimension={720}
                    onLoad={(event) => {
                      rememberImageSize(
                        row.url,
                        event.currentTarget.naturalWidth,
                        event.currentTarget.naturalHeight,
                      );
                    }}
                  />
                </figure>
              </button>
              );
            })}
            {historyHasMore ? (
              <span
                ref={historySentinelRef}
                className={`tryon-history__more${historyLoadingMore ? " is-loading" : ""}`}
                aria-hidden="true"
              >
                <i className="bi bi-arrow-repeat is-spin" />
              </span>
            ) : null}
          </div>
        ) : (
          <div className="tryon-stage__card tryon-history__empty">
            <i className="bi bi-clock-history" />
            <span>暂无记录</span>
          </div>
        )}
      </aside>
    </div>
  );
}
