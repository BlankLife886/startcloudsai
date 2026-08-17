import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { useIsDark } from "../../../../hooks/useIsDark.js";
import { useLocale } from "../../../../i18n/index.js";
import { AuthenticatedImage } from "../../../../components/AuthenticatedImage.jsx";
import { CommerceSelect } from "../../CommerceSelect.jsx";

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
  children,
}) {
  const isDark = useIsDark();
  const { t } = useLocale();
  const popupRootRef = useRef(null);
  const popupPanelRef = useRef(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupRendered, setPopupRendered] = useState(false);

  const closePopup = useCallback(() => {
    setPopupOpen(false);
  }, []);

  const openPopup = useCallback(() => {
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
          disabled={disabled}
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
                className={`tryon-model-popup${popupKind ? ` is-${popupKind}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={popupTitleId}
              >
                <header className="tryon-model-popup__head">
                  <div>
                    <strong id={popupTitleId}>{popupTitle}</strong>
                    <small>{popupHint}</small>
                  </div>
                  <button type="button" aria-label="关闭" onClick={closePopup}>
                    <i className="bi bi-x-lg" />
                  </button>
                </header>
                <div className="tryon-model-popup__grid">
                  {catalog.map((option) => {
                    const selected =
                      source !== "upload" && featured.id === option.id;
                    return (
                      <article
                        key={option.id}
                        className={`tryon-model-popup__card${selected ? " is-active" : ""}`}
                      >
                        <button
                          type="button"
                          className="tryon-model-popup__hit"
                          aria-label={option.label}
                          onClick={() => {
                            onSelectBuiltin(option);
                            closePopup();
                          }}
                        >
                          <span className="tryon-model-popup__media">
                            <img src={option.image} alt="" />
                            <span className="tryon-model-popup__name">
                              {option.label}
                            </span>
                          </span>
                        </button>
                      </article>
                    );
                  })}
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
  const value = Math.max(0, Number(seconds) || 0);
  return value >= 100 ? String(value) : String(value).padStart(2, "0");
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
  onRevealEnd,
  onElapsed,
}) {
  const frame = modelImage || garmentUrl || sceneImage;
  const canPrefetch = Boolean(resultUrl) && !failed;
  const revealShot = canPrefetch ? resultUrl : "";
  const startedRef = useRef(Date.now());
  const onRevealEndRef = useRef(onRevealEnd);
  const onElapsedRef = useRef(onElapsed);
  onRevealEndRef.current = onRevealEnd;
  onElapsedRef.current = onElapsed;
  const [phase, setPhase] = useState("open");
  const [closed, setClosed] = useState(false);
  const [showClock, setShowClock] = useState(false);
  const [seconds, setSeconds] = useState(0);
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
    const tick = () => {
      setSeconds(
        Math.max(0, Math.floor((Date.now() - startedRef.current) / 1000)),
      );
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [showClock, phase]);

  useEffect(() => {
    if (running && phase !== "opening") return;
    onElapsedRef.current?.(
      Math.max(0, Math.floor((Date.now() - startedRef.current) / 1000)),
    );
  }, [running, phase]);

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
            ? `正在生成，已等待 ${seconds} 秒`
            : "正在生成"
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
  onPreview,
  onUploadGarment,
  onGenerate,
  onCancel,
  onSelectHistory,
  generateDisabled,
  generateHint,
  shotCount,
  cancelling,
  modelPicker,
  scenePicker,
  garmentPicker,
  uploadNotice = "",
  onDropSlot,
  copy = TRYON_STAGE_COPY,
}) {
  const { locale, t } = useLocale();
  const [curtainHold, setCurtainHold] = useState(false);
  const [curtainRun, setCurtainRun] = useState(0);
  const [runSeconds, setRunSeconds] = useState(0);
  const [elapsedByUrl, setElapsedByUrl] = useState({});
  const modelRef = useRef(null);
  const garmentRef = useRef(null);
  const sceneRef = useRef(null);
  const resultRef = useRef(null);

  useEffect(() => {
    if (!running) return;
    setCurtainHold(true);
    setCurtainRun((value) => value + 1);
    setRunSeconds(0);
  }, [running]);

  useEffect(() => {
    if (!resultUrl || !runSeconds) return;
    setElapsedByUrl((current) =>
      current[resultUrl] ? current : { ...current, [resultUrl]: runSeconds },
    );
  }, [resultUrl, runSeconds]);

  const showCurtain = running || curtainHold;
  const resultSeconds =
    (resultUrl && elapsedByUrl[resultUrl]) || elapsedSeconds || 0;

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

  return (
    <div className="tryon-stage" aria-label={t(copy.aria)}>
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
          <span className="tryon-stage__tag">{t(copy.centerTag)}</span>
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
          className={`tryon-stage__card tryon-stage__scene-card${sceneImage ? "" : " is-empty"}`}
          onDragOver={handleSlotDragOver}
          onDrop={(event) => handleSlotDrop(event, "scene")}
        >
          <span className="tryon-stage__tag">{t("场景")}</span>
          {sceneImage ? (
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
          {scenePicker}
        </div>
      </div>
      <div className="tryon-stage__output">
        <div
          ref={resultRef}
          className={`tryon-stage__card tryon-stage__result${resultUrl && !showCurtain ? " has-image" : " is-empty"}${running || showCurtain ? " is-running" : ""}${failed ? " is-failed" : ""}`}
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
                src={resultUrl}
                alt={copy.resultAlt || "生成结果"}
                loading="eager"
                maxDimension={1600}
              />
            </button>
          ) : (
            <>
              <i className="bi bi-stars" />
              <span>{t("生成结果")}</span>
            </>
          )}
          {resultUrl && !running && resultSeconds > 0 ? (
            <span
              className="tryon-stage__elapsed"
              aria-label={`生成耗时 ${resultSeconds} 秒`}
            >
              {formatTryonSeconds(resultSeconds)}秒
            </span>
          ) : null}
          <div className="tryon-stage__card-actions">
            <button
              type="button"
              className={`tryon-generate generate-button${running ? " is-running" : ""}${failed ? " is-failed" : ""}`}
              disabled={running ? cancelling : generateDisabled}
              title={generateHint}
              aria-label={
                running
                  ? "停止生成"
                  : failed
                    ? `重试生成（${shotCount}张）`
                    : `一键生成（${shotCount}张）`
              }
              onClick={running ? onCancel : onGenerate}
            >
              <i
                className={`bi ${
                  running
                    ? "bi-stop-fill"
                    : failed
                      ? "bi-arrow-repeat"
                      : "bi-stars"
                }`}
              />
              {running ? t("停止") : failed ? t("重试") : t("生成")}
              <small>
                {running
                  ? t("进行中")
                  : locale === "en"
                    ? `${shotCount} ${shotCount === 1 ? "image" : "images"}`
                    : `${shotCount}张`}
              </small>
            </button>
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
      <aside className="tryon-stage__history" aria-label="生成历史">
        <p className="tryon-history__label">历史</p>
        {history.length ? (
          <div className="tryon-history" role="list">
            {history.map((row) => (
              <button
                key={row.url}
                type="button"
                role="listitem"
                className={`tryon-stage__card tryon-history__item${row.url === resultUrl ? " is-active" : ""}`}
                style={{ aspectRatio: tryonHistoryRatio(row) }}
                disabled={running}
                aria-label="查看历史生成图"
                aria-pressed={row.url === resultUrl}
                onClick={() => onSelectHistory?.(row.url)}
              >
                <figure>
                  <AuthenticatedImage
                    src={row.preview || row.url}
                    alt=""
                    loading="eager"
                    maxDimension={720}
                  />
                </figure>
              </button>
            ))}
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
