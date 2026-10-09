import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { formatMessageDate, generatedImageRatioLabel, messageDateTime, messageStatus, uid } from "./domain/assistantMessages.js";
import { assistantToolStepDetail, normalizeAssistantPlan, normalizeAssistantToolSteps } from "./domain/assistantToolSteps.js";
import { humanizeAssistantTrace } from "./domain/assistantTraceSteps.js";
import { assistantErrorKind } from "./domain/assistantErrorKinds.js";
import { useAssistantWalletBalance } from "./useAssistantWalletBalance.js";
import { useSavedAssistantImages } from "./assistantSavedImages.js";
import { imageSlots, missingImageSlots } from "./domain/assistantImageSlots.js";
import { assistantMessageVersion, assistantMessageVersions } from "./domain/assistantVersions.js";
import "./assistant-markdown-extras.css";
import "./assistant-reply-extras.css";
import { downloadDiagram, linkMarkdownCitations, markdownOutline, markdownTableClipboard, openDiagramViewer, renderMermaidDiagrams, sortMarkdownTable, toggleDiagramSource } from "./assistantMarkdownEnhance.js";
import { promptNeedsRecentVisual } from "./domain/visualContext.js";
import { assistantImageBatchLimit } from "./domain/assistantImageLimits.js";
import { resolveModelTierPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import {
  clampImageCount,
  getModelAspectRatiosForResolution,
  imageCountChoices,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { useIsDark } from "../../hooks/useIsDark.js";
import { DownloadIcon } from "../../components/common/DownloadIcon.jsx";
import { RegenerateIcon } from "../../components/common/RegenerateIcon.jsx";
import { SoftMark } from "../../components/common/SoftMark.jsx";
import { ModelCatalogIcon, ModelMaintenanceBadge, isCatalogModelMaintenance } from "../../components/common/ModelCatalogIcon.jsx";
import { isAssistantImageFile, isPSDFile } from "./domain/assistantAttachments.js";
import {
  IMAGE_QUALITY_OPTIONS,
  MAX_ASSISTANT_MESSAGE_CHARACTERS,
  RESOLUTIONS,
  applyThreadSearchMarks,
  assistantCharacterCount,
  assistantImageSettings,
  assistantModelLabel,
  copyAssistantImage,
  documentIcon,
  downloadAssistantImage,
  formatContextTokens,
  formatDocumentSize,
  formatDurationMs,
  formatElapsedClock,
  highlightSearchNodes,
  imageGenerationMeta,
  imageRatioValue,
  imageThumbUrl,
  normalizeAssistantContext,
  normalizeAssistantUsage,
  proposalImagePlanItems,
  proposalReferenceImages,
  proposalReferenceMode,
  ratioOption,
  ratioPreviewStyle,
  referenceImageIdentity,
  renderAssistantMarkdownHtml,
  retryableImageUrl,
  streamInsideFence,
  streamNeedsRebuild,
  takeStreamChunk,
  ensureStreamCaret,
  appendStreamChunk,
  uniqueReferenceImages,
  usageStartedAtMs,
  useElapsedMs,
} from "./assistantWorkspaceCore.jsx";
import { AssistantPreviewImage, ModelMenuPrice } from "./AssistantWorkspaceUi.jsx";
import { AssistantDataViews } from "./AssistantDataViews.jsx";
import { AssistantProactiveNote } from "./AssistantMemoryViews.jsx";
import { ASSISTANT_CORRECTIONS, assistantCorrectionActions } from "./domain/assistantCorrections.js";


function GeneratedImageGrid({ message, editSources = [], imageModels, loadedImages, failedImages, imageRetryVersions, onOpenImage, onImageLoad, onImageError, onImageRetry, onUseReference, canGenerateMissing = false, onGenerateMissing }) {
  // 改图结果带上自己的原图，全屏查看时可以对比（对话里不显示对比，避免挤占画面）。
  const viewerImages = useMemo(
    () => message.images.map((image, index) => (editSources[index] ? { ...image, editSource: editSources[index] } : image)),
    [editSources, message.images],
  );
  const meta = { ...imageGenerationMeta(message, imageModels), messageId: message.id, runId: message.runId || "", model: message.model || "", requestRatio: message.requestRatio || message.ratio || "", requestSize: message.requestSize || "", width: message.width, height: message.height, quality: message.quality || "", pending: Boolean(message.pending) };
  const imagePlanItems = Array.isArray(message.imagePlanItems) ? message.imagePlanItems : [];
  const savedImages = useSavedAssistantImages(message.pending ? [] : message.images.map((image) => image?.fileKey || ""));
  const missing = missingImageSlots(message);
  // 有缺图时按“第几张”排好，缺的位置留占位；其余情况照原顺序。
  const gridSlots = missing.length ? imageSlots(message) : message.images.map((image, index) => ({ index, image }));
  const [downloadBusyKey, setDownloadBusyKey] = useState("");
  const downloadImage = async (image, index, key) => {
    if (downloadBusyKey) return;
    setDownloadBusyKey(key);
    try {
      await downloadAssistantImage(image, index);
    } catch (error) {
      if (!error?.downloadNotificationShown) {
        notificationService.error(error?.message || "图片下载失败");
      }
    } finally {
      setDownloadBusyKey("");
    }
  };
  return (
    <div className={`generated-images${message.images.length + missing.length === 1 ? " is-single" : ""}${message.images.length + missing.length > 2 ? " is-many" : ""}`} style={{ "--generated-ratio": imageRatioValue(message), "--image-slot-count": message.images.length + missing.length }}>
      {gridSlots.map((slot) => {
        if (!slot.image) {
          return (
            <figure key={`missing-${slot.index}`} className="is-missing">
              <div className="generated-image-failed is-missing">
                <i className="bi bi-image" aria-hidden="true" />
                <span>第 {slot.index + 1} 张没有生成出来</span>
              </div>
            </figure>
          );
        }
        const image = slot.image;
        const index = message.images.indexOf(image);
        const key = `${message.id}-${index}`;
        const loaded = loadedImages.has(key);
        const failed = failedImages.has(key);
        const deleted = Boolean(image?.deleted || image?.deletedByHistory);
        const ratioLabel = generatedImageRatioLabel(image, { ...message, ...(imagePlanItems[index] || {}) });
        return (
          <figure key={key} data-image-key={key} className={deleted ? "is-deleted" : failed ? "is-failed" : loaded ? "" : "is-loading"}>
            {deleted ? (
              <div className="generated-image-failed is-deleted">
                <i className="bi bi-image-alt" />
                <span>{image.deletionMessage || "该图片已被删除"}</span>
              </div>
            ) : failed ? (
              <div className="generated-image-failed">
                <i className="bi bi-image-alt" />
                <span>图片加载失败</span>
                <button type="button" onClick={() => onImageRetry(message.id, index)}>重新加载</button>
              </div>
            ) : (
              <button className="generated-image-preview" type="button" onClick={() => onOpenImage(viewerImages[index], index, viewerImages, meta)}>
                <AssistantPreviewImage image={image} src={retryableImageUrl(imageThumbUrl(image), imageRetryVersions[key])} alt={image.revisedPrompt || "AI 生成图片"} loading="lazy" onLoad={() => onImageLoad(message.id, index)} onError={() => onImageError(message.id, index)} />
                <i className="tile-sheen" aria-hidden="true" />
              </button>
            )}
            {loaded && !failed && !deleted && ratioLabel ? <span className="generated-image-ratio">{ratioLabel}</span> : null}
            {!deleted && savedImages.has(image?.fileKey) ? (
              <span className="generated-image-saved" title={savedImages.get(image.fileKey).groupName ? `已存入素材库「${savedImages.get(image.fileKey).groupName}」` : "已存入素材库"}>
                <i className="bi bi-bookmark-check-fill" aria-hidden="true" />已存入
              </span>
            ) : null}
            {loaded && !failed && !deleted && (
              <div className="generated-image-actions">
                <button type="button" title="复制图片" aria-label="复制图片" onClick={() => void copyAssistantImage(image).then(() => notificationService.success("图片已复制")).catch(() => notificationService.error("复制图片失败"))}><i className="bi bi-copy" /></button>
                <button type="button" title="用作参考图" aria-label="用作参考图" onClick={() => onUseReference(image)}><i className="bi bi-image" /></button>
                <button type="button" title={downloadBusyKey === key ? "正在下载" : "下载原图"} aria-label={downloadBusyKey === key ? "正在下载原图" : "下载原图"} aria-busy={downloadBusyKey === key} disabled={Boolean(downloadBusyKey)} onClick={() => void downloadImage(image, index, key)}>{downloadBusyKey === key ? <i className="bi bi-arrow-repeat spin" aria-hidden="true" /> : <DownloadIcon />}</button>
              </div>
            )}
          </figure>
        );
      })}
      {missing.length ? (
        <div className="generated-images-missing" role="status">
          <span>{`${missing.length + message.images.length} 张里有 ${missing.length} 张没生成出来，没扣这 ${missing.length} 张的积分`}</span>
          {canGenerateMissing && onGenerateMissing ? (
            <button type="button" onClick={onGenerateMissing}><i className="bi bi-arrow-clockwise" aria-hidden="true" />补生成 {missing.length} 张</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


function normalizeReasoningText(text) {
  return String(text || "")
    .replace(/\*\*\s*\*\*/g, "**\n\n**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function writeClipboard(text, html = "") {
  try {
    if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" }),
      })]);
      return;
    }
    await navigator.clipboard.writeText(text);
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.append(area);
    area.select();
    document.execCommand("copy");
    area.remove();
  }
}

// 按钮短暂显示“已复制”，再换回原样。
function flashCopied(button, label = "已复制") {
  if (button.dataset.copiedTimer) return;
  const html = button.innerHTML;
  const title = button.title;
  button.classList.add("is-copied");
  button.title = label;
  button.innerHTML = button.querySelector("span")
    ? `<i class="bi bi-check2" aria-hidden="true"></i><span>${label}</span>`
    : '<i class="bi bi-check2" aria-hidden="true"></i>';
  button.dataset.copiedTimer = String(window.setTimeout(() => {
    if (!button.isConnected) return;
    button.classList.remove("is-copied");
    button.title = title;
    button.innerHTML = html;
    delete button.dataset.copiedTimer;
  }, 1600));
}

// 长回复的目录：开头一份完整目录；往下读、开头的目录滚出视野后，
// 右上角吸顶一个小“目录”按钮，显示当前读到哪一节，点开随时跳转。
function AssistantReplyOutline({ outline, rootRef }) {
  const [open, setOpen] = useState(true);
  const [floating, setFloating] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState(0);
  const navRef = useRef(null);
  const floatRef = useRef(null);

  const headings = () => [...(rootRef.current?.querySelectorAll(":scope > h1, :scope > h2, :scope > h3") || [])];
  const jump = (index) => {
    headings()[index]?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(index);
    setMenuOpen(false);
  };

  useEffect(() => {
    const nav = navRef.current;
    const scroller = nav?.closest(".assistant-messages");
    if (!nav || !scroller) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = scroller.getBoundingClientRect().top;
      const body = rootRef.current?.getBoundingClientRect();
      // 开头的目录看不见、回复正文还在视野里，才显示吸顶按钮
      const passed = nav.getBoundingClientRect().bottom < top + 8;
      setFloating(Boolean(passed && body && body.bottom > top + 96));
      const line = top + 96;
      let current = 0;
      headings().forEach((heading, index) => {
        if (heading.getBoundingClientRect().top <= line) current = index;
      });
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outline]);

  useEffect(() => {
    if (!floating) setMenuOpen(false);
  }, [floating]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onPointer = (event) => {
      if (!floatRef.current?.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointer, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const list = (
    <ol>
      {outline.map((item) => (
        <li key={item.index} className={`is-level-${Math.min(3, item.level)}${item.index === active ? " is-active" : ""}`}>
          <button type="button" aria-current={item.index === active ? "location" : undefined} onClick={() => jump(item.index)}>{item.title}</button>
        </li>
      ))}
    </ol>
  );
  const current = outline[active] || outline[0];
  return (
    <>
      <nav ref={navRef} className={`assistant-outline${open ? " is-open" : ""}`} aria-label="回复目录">
        <button type="button" className="assistant-outline-toggle" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          <i className="bi bi-list-ul" aria-hidden="true" />目录<small>{outline.length} 节</small>
          <i className="bi bi-chevron-down assistant-outline-chevron" aria-hidden="true" />
        </button>
        {open ? list : null}
      </nav>
      <div className={`assistant-outline-dock${floating ? " is-visible" : ""}`} aria-hidden={!floating}>
        <div ref={floatRef} className={`assistant-outline-float${menuOpen ? " is-open" : ""}`}>
          <button
            type="button"
            className="assistant-outline-float-toggle"
            aria-expanded={menuOpen}
            aria-label={`回复目录，当前：${current?.title || ""}`}
            tabIndex={floating ? 0 : -1}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <i className="bi bi-list-ul" aria-hidden="true" />
            <span>{current?.title || "目录"}</span>
            <small className="tnum">{active + 1}/{outline.length}</small>
            <i className="bi bi-chevron-down assistant-outline-chevron" aria-hidden="true" />
          </button>
          {menuOpen ? <div className="assistant-outline-menu" role="navigation" aria-label="回复目录">{list}</div> : null}
        </div>
      </div>
    </>
  );
}

function AssistantMarkdown({ content, streaming, highlightQuery = "", sources = [] }) {
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const outline = useMemo(() => (streaming ? [] : markdownOutline(content)), [content, streaming]);
  const sourcesKey = sources.map((source) => source.url).join("|");
  const targetRef = useRef("");
  const revealedRef = useRef("");
  const polishedRef = useRef(false);
  const rafRef = useRef(0);
  const lastTsRef = useRef(0);
  const carryRef = useRef(0);
  const tickRef = useRef(null);

  const stopStream = () => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    lastTsRef.current = 0;
    carryRef.current = 0;
  };

  tickRef.current = (timestamp) => {
    const root = rootRef.current;
    if (!root) {
      rafRef.current = 0;
      return;
    }
    const target = targetRef.current;
    let revealed = revealedRef.current;
    if (revealed === target) {
      rafRef.current = 0;
      lastTsRef.current = 0;
      return;
    }
    if (revealed && !target.startsWith(revealed)) {
      revealed = "";
      revealedRef.current = "";
      root.innerHTML = "";
    }
    const elapsed = lastTsRef.current ? Math.min(48, timestamp - lastTsRef.current) : 16.6;
    lastTsRef.current = timestamp;
    const backlog = target.length - revealed.length;
    const rush = Math.min(1, backlog / 140);
    const msPerChar = 34 - rush * 22;
    carryRef.current += elapsed / msPerChar;
    let take = Math.floor(carryRef.current);
    if (take < 1) {
      rafRef.current = window.requestAnimationFrame((next) => tickRef.current?.(next));
      return;
    }
    carryRef.current -= take;
    take = Math.min(take, backlog);
    if (!revealed && backlog > 280) take = Math.max(take, backlog - 64);
    const chunk = takeStreamChunk(target, revealed.length, take);
    const next = revealed + chunk;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!revealed || streamNeedsRebuild(revealed, next)) {
      root.innerHTML = renderAssistantMarkdownHtml(next, { streaming: true });
      ensureStreamCaret(root, streamInsideFence(next)
        ? root.querySelector("figure.assistant-code:last-of-type .assistant-code-src")
        : null);
    } else {
      appendStreamChunk(root, chunk, reduceMotion, revealed);
    }
    revealedRef.current = next;
    rafRef.current = window.requestAnimationFrame((nextTs) => tickRef.current?.(nextTs));
  };

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const text = String(content || "");
    if (!streaming) {
      stopStream();
      if (!polishedRef.current || revealedRef.current !== text) {
        root.innerHTML = renderAssistantMarkdownHtml(text, { streaming: false });
        polishedRef.current = true;
        revealedRef.current = text;
        targetRef.current = text;
      }
      return undefined;
    }
    polishedRef.current = false;
    targetRef.current = text;
    if (revealedRef.current && !text.startsWith(revealedRef.current)) {
      revealedRef.current = "";
      root.innerHTML = "";
    }
    if (!text && !revealedRef.current) {
      root.innerHTML = "";
      ensureStreamCaret(root);
    }
    if (!rafRef.current) {
      lastTsRef.current = 0;
      rafRef.current = window.requestAnimationFrame((timestamp) => tickRef.current?.(timestamp));
    }
    return undefined;
  }, [content, streaming]);

  // 写完之后：引用编号换成角标，流程图画出来。重新渲染正文会清掉角标，所以跟着正文一起重做。
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || streaming) return;
    if (sourcesKey && !root.querySelector(".assistant-cite")) linkMarkdownCitations(root, sources);
    void renderMermaidDiagrams(root);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, streaming, sourcesKey]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || streaming) return;
    applyThreadSearchMarks(root, highlightQuery);
  }, [content, highlightQuery, streaming]);

  useEffect(() => () => stopStream(), []);

  const handleClick = async (event) => {
    // In-app links (e.g. /wallet) open inside the app instead of a new tab.
    const inApp = event.target.closest("a[data-in-app='true']");
    if (inApp && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      navigate(inApp.getAttribute("href"));
      return;
    }
    const sortButton = event.target.closest("[data-table-sort]");
    if (sortButton) {
      sortMarkdownTable(sortButton.closest(".assistant-table"), Number(sortButton.dataset.tableSort));
      return;
    }
    const tableCopy = event.target.closest("[data-table-copy]");
    if (tableCopy) {
      const { text, html } = markdownTableClipboard(tableCopy.closest(".assistant-table"));
      await writeClipboard(text, html);
      flashCopied(tableCopy);
      return;
    }
    const diagramSource = event.target.closest("[data-diagram-source]");
    if (diagramSource) {
      toggleDiagramSource(diagramSource.closest(".assistant-diagram"));
      return;
    }
    const diagramDownload = event.target.closest("[data-diagram-download]");
    if (diagramDownload) {
      const done = await downloadDiagram(diagramDownload.closest(".assistant-diagram"));
      if (done) flashCopied(diagramDownload, "已下载");
      return;
    }
    const diagramZoom = event.target.closest("[data-diagram-zoom], .assistant-diagram[data-rendered] .assistant-diagram-canvas");
    if (diagramZoom) {
      openDiagramViewer(diagramZoom.closest(".assistant-diagram"));
      return;
    }
    const diagramCopy = event.target.closest("[data-diagram-copy]");
    if (diagramCopy) {
      await writeClipboard(diagramCopy.closest(".assistant-diagram")?.dataset.source || "");
      flashCopied(diagramCopy);
      return;
    }
    const button = event.target.closest("[data-copy-code]");
    const block = button?.closest(".assistant-code");
    const code = block?.dataset.code ?? block?.querySelector(".assistant-code-raw")?.value;
    if (!button || code == null) return;
    await writeClipboard(code);
    button.classList.add("is-copied");
    button.setAttribute("aria-label", "已复制");
    button.title = "已复制";
    button.innerHTML = '<i class="bi bi-check2" aria-hidden="true"></i>';
    window.setTimeout(() => {
      if (!button.isConnected) return;
      button.classList.remove("is-copied");
      button.setAttribute("aria-label", "复制代码");
      button.title = "复制代码";
      button.innerHTML = '<i class="bi bi-copy" aria-hidden="true"></i>';
    }, 1600);
  };

  return (
    <>
      {outline.length ? <AssistantReplyOutline outline={outline} rootRef={rootRef} /> : null}
      <div ref={rootRef} className={`assistant-markdown${streaming ? " is-streaming" : ""}`} onClick={(event) => void handleClick(event)} />
    </>
  );
}

const TOOL_STEP_STATE_LABELS = {
  running: "进行中",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
};

const PLAN_STATE_LABELS = {
  pending: "待开始",
  in_progress: "进行中",
  completed: "已完成",
};

// 执行计划：一行横向步骤条，没有卡片和标题；圆点之间的连线随进度填色。
function AssistantPlan({ steps }) {
  const items = useMemo(() => normalizeAssistantPlan(steps), [steps]);
  if (!items.length) return null;
  const completed = items.filter((step) => step.status === "completed").length;
  return (
    <section className="assistant-plan" aria-label={`执行计划，已完成 ${completed} / ${items.length}`}>
      <ol style={{ "--plan-steps": items.length }}>
        {items.map((step, index) => (
          <li key={`${index}-${step.title}`} className={`is-${step.status}`}>
            <span className="assistant-plan-mark" aria-label={PLAN_STATE_LABELS[step.status]}>
              {step.status === "completed" ? <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.6 5.2 4.3 6.8 7.4 3.5" /></svg> : null}
            </span>
            <span className="assistant-plan-title" title={step.title}>{step.title}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AssistantToolTimeline({ steps, pending, expanded = false }) {
  const items = useMemo(() => normalizeAssistantToolSteps(steps), [steps]);
  const [openKey, setOpenKey] = useState("");
  if (!items.length || !expanded) return null;
  return (
    <section className={`assistant-tool-timeline is-embedded${pending ? " is-live" : ""}`} aria-label="过程">
      <ol className="assistant-tool-timeline-list">
          {items.map((step) => {
            // 运行已结束却仍停在 running 的步骤，说明结果事件丢了，不要一直转圈。
            const status = step.status === "running" && !pending ? "interrupted" : step.status;
            const detail = assistantToolStepDetail(step);
            const open = openKey === step.key;
            return (
              <li key={step.key} className={`assistant-tool-step is-${status}`}>
                <button
                  type="button"
                  className="assistant-tool-step-head"
                  aria-expanded={open}
                  disabled={!detail}
                  onClick={() => setOpenKey(open ? "" : step.key)}
                >
                  <span className="assistant-tool-step-icon" aria-hidden="true">
                    <i className={`bi ${step.icon}`} />
                  </span>
                  <span className="assistant-tool-step-copy">
                    <strong>{step.label}</strong>
                    {step.summary ? <small title={step.summary}>{step.summary}</small> : null}
                  </span>
                  {step.durationMs > 0 ? <b className="assistant-tool-step-duration">{formatDurationMs(step.durationMs)}</b> : null}
                  <span className="assistant-tool-step-state" aria-label={TOOL_STEP_STATE_LABELS[status]}>
                    {status === "running" ? <i className="bi bi-arrow-repeat assistant-tool-spin" /> : null}
                    {status === "completed" ? <i className="bi bi-check2" /> : null}
                    {status === "failed" ? <i className="bi bi-exclamation-triangle" /> : null}
                    {status === "interrupted" ? <i className="bi bi-dash-lg" /> : null}
                  </span>
                </button>
                {open && detail ? <pre className="assistant-tool-step-detail">{detail}</pre> : null}
              </li>
            );
          })}
        </ol>
    </section>
  );
}

function artifactLayerLabel(item = {}) {
  const count = Math.max(0, Number(item.layerCount) || 0);
  return count > 1 ? ` · ${count} 图层` : "";
}

function AssistantArtifacts({ items = [] }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className="assistant-artifacts" aria-label="生成的文件">{items.map((item, index) => <a key={item.id || `${item.name}-${index}`} className="assistant-artifact" href={item.downloadUrl} download={item.name || "assistant-output.txt"}><i className={`bi ${documentIcon(item)}`} aria-hidden="true" /><span><strong>{item.name || "生成文件"}</strong><small>{String(item.format || "file").toUpperCase()} · {formatDocumentSize(item.sizeBytes)}{artifactLayerLabel(item)}</small></span><DownloadIcon /></a>)}</div>;
}

const TOOL_ACTION_ICONS = { download: "bi-download", webpage_capture: "bi-window", product_import: "bi-bag-plus", navigate: "bi-compass" };

// 工具结果：普通操作是一行紧凑条（图标/缩略图 + 标题 + 一个按钮）；图片搜索是一排小缩略图。
function AssistantToolActions({ actions, busyId, onExecute }) {
  const items = Array.isArray(actions) ? actions.filter((item) => item && typeof item === "object") : [];
  if (!items.length) return null;
  return (
    <section className="assistant-tool-actions" aria-label="AI 工具结果">
      {items.map((action, actionIndex) => {
        const results = Array.isArray(action.items) ? action.items : [];
        const busy = busyId === action.id;
        if (action.kind === "image_results") {
          return (
            <div className="assistant-tool-images" key={action.id || actionIndex}>
              <p><strong>{action.title || "图片搜索结果"}</strong>{action.description ? <small>{action.description}</small> : null}</p>
              <div className="assistant-tool-image-grid">
                {results.map((image, index) => (
                  <a key={image.id || image.sourceUrl || index} href={image.sourceUrl || image.imageUrl} target="_blank" rel="noreferrer" title={[image.title, image.license, image.creator].filter(Boolean).join(" · ") || "查看原始来源与授权"}>
                    <img src={image.thumbnailUrl || image.imageUrl} alt={image.title || `搜索结果 ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                    <span>{[image.license, image.creator].filter(Boolean).join(" · ") || "查看授权"}</span>
                  </a>
                ))}
              </div>
            </div>
          );
        }
        return (
          <article className={`assistant-tool-card is-${String(action.kind || "action")}`} key={action.id || actionIndex}>
            {action.previewUrl ? (
              <a className="assistant-tool-preview" href={action.targetUrl || action.previewUrl} target="_blank" rel="noreferrer" title="查看预览"><img src={action.previewUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /></a>
            ) : (
              <span className="assistant-tool-card-icon" aria-hidden="true"><i className={`bi ${TOOL_ACTION_ICONS[action.kind] || "bi-arrow-left-right"}`} /></span>
            )}
            <span className="assistant-tool-card-copy"><strong>{action.title || "AI 工具"}</strong><small>{action.description || "操作已准备"}</small></span>
            <button type="button" disabled={busy} onClick={() => onExecute?.(action)}>
              {busy ? <i className="bi bi-arrow-repeat assistant-tool-spin" aria-hidden="true" /> : null}
              <span>{busy ? "处理中" : action.buttonLabel || "打开"}</span>
            </button>
          </article>
        );
      })}
    </section>
  );
}

function ProposalSelect({ id, label, ariaLabel, valueLabel, options, disabled, open, onToggle, onPick }) {
  const wrapRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);
  const selectedOption = options.find((option) => option.selected) || options[0];

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return undefined;
    }
    const place = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const minWidth = Math.max(rect.width, id === "model" ? 220 : 0);
      const spaceBelow = window.innerHeight - rect.bottom - 12;
      const openUp = spaceBelow < 180 && rect.top > spaceBelow;
      const alignRight = id === "resolution" || id === "count";
      const next = {
        minWidth: `${minWidth}px`,
        maxHeight: `${Math.min(240, Math.max(120, openUp ? rect.top - 16 : spaceBelow))}px`,
      };
      if (openUp) next.bottom = `${window.innerHeight - rect.top + 6}px`;
      else next.top = `${rect.bottom + 6}px`;
      if (alignRight) next.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
      else next.left = `${Math.max(8, rect.left)}px`;
      setMenuStyle(next);
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, id, options.length, valueLabel]);

  const host = wrapRef.current?.closest(".assistant-workspace");
  const menu = open && menuStyle ? (
    <div className="agent-proposal-menu" role="listbox" aria-label={ariaLabel} style={menuStyle}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="option"
          aria-selected={option.selected}
          className={option.selected ? "active" : ""}
          disabled={option.disabled}
          title={option.disabled ? "模型维护中，暂不可选择" : undefined}
          onClick={(event) => { event.stopPropagation(); onPick(option.id); }}
        >
          {option.model ? <ModelCatalogIcon model={option.model} size="xs" /> : null}
          {option.mark ? <i className={`ratio-shape is-${option.mark}`} style={option.markStyle} /> : null}
          <span className="agent-proposal-menu-copy">
            <strong>{option.label}</strong>
            {option.detail}
          </span>
          {option.model ? <ModelMaintenanceBadge model={option.model} /> : null}
          {option.selected ? <i className="bi bi-check-lg" aria-hidden="true" /> : null}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className={`agent-proposal-field${id === "model" ? " is-model" : ""}`}>
      <span>{label}</span>
      <div className="agent-proposal-menu-wrap" ref={wrapRef}>
        <button
          type="button"
          className={`agent-proposal-trigger${open ? " is-open" : ""}`}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={(event) => { event.stopPropagation(); onToggle(); }}
        >
          {id === "model" ? <ModelCatalogIcon model={selectedOption?.model} size="xs" /> : null}
          <span>{valueLabel}</span>
          <i className={`bi bi-chevron-down${open ? " is-open" : ""}`} aria-hidden="true" />
        </button>
        {menu && host ? createPortal(menu, host) : menu}
      </div>
    </div>
  );
}

function ProposalPromptDialog({ value, title = "编辑生成提示词", maxMessageCharacters = MAX_ASSISTANT_MESSAGE_CHARACTERS, onCancel, onSave }) {
  const isDark = useIsDark();
  const [draft, setDraft] = useState(value || "");
  const textareaRef = useRef(null);
  const draftRef = useRef(draft);
  const onCancelRef = useRef(onCancel);
  const onSaveRef = useRef(onSave);
  draftRef.current = draft;
  onCancelRef.current = onCancel;
  onSaveRef.current = onSave;
  const count = assistantCharacterCount(draft);
  const overLimit = count > maxMessageCharacters;

  useEffect(() => {
    const node = textareaRef.current;
    if (node) {
      node.focus();
      const end = node.value.length;
      node.setSelectionRange(end, end);
    }
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelRef.current();
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (assistantCharacterCount(draftRef.current) <= maxMessageCharacters) {
          onSaveRef.current(draftRef.current);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [maxMessageCharacters]);

  return createPortal(
    <div
      className={`assistant-dialog-layer agent-proposal-prompt-layer${isDark ? " is-dark" : ""}`}
      role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}
    >
      <section
        className="agent-proposal-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-proposal-prompt-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="agent-proposal-prompt-title">{title}</h2>
            <p>在弹窗里修改文案，确认后写回方案。</p>
          </div>
          <button type="button" aria-label="关闭" onClick={onCancel}><i className="bi bi-x-lg" /></button>
        </header>
        <textarea
          ref={textareaRef}
          rows={8}
          maxLength={maxMessageCharacters}
          aria-label="编辑生成提示词"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <footer>
          <span className={overLimit ? "is-over" : ""}>{count.toLocaleString("zh-CN")} / {maxMessageCharacters.toLocaleString("zh-CN")}</span>
          <div>
            <button type="button" onClick={onCancel}>取消</button>
            <button type="button" className="is-primary" disabled={overLimit} onClick={() => onSave(draft)}>完成</button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

// 独立方案里每张图只带自己的参考图，所以它的提示词按自己的参考图编号（第一张就是图1）；
// 卡片顶部却按整组统一编号。显示和编辑时换成统一编号，保存时再换回这张图自己的编号，
// 交给出图模型的提示词不变。numbers 把一种编号映射到另一种。
function renumberPlanPrompt(prompt, numbers) {
  return String(prompt || "").replace(/图\s*(\d+)/g, (text, number) => {
    const next = numbers.get(Number(number));
    return next ? `图${next}` : text;
  });
}

function planItemReferenceNumbers(item, referenceNumbers) {
  const toCard = new Map();
  const toItem = new Map();
  (item.referencedImageIds || []).forEach((id, index) => {
    const cardNumber = referenceNumbers.get(id);
    if (!cardNumber) return;
    toCard.set(index + 1, cardNumber);
    toItem.set(cardNumber, index + 1);
  });
  return { toCard, toItem };
}

function AgentProposal({ message, imageModels, generating, executed, attachedReferences, autoApprove = false, autoApproveBudgetCents = 0, autoApproved = false, maxMessageCharacters = MAX_ASSISTANT_MESSAGE_CHARACTERS, onChange, onDismiss, onRestore, onApprove, onOpenImage }) {
  const [openMenu, setOpenMenu] = useState("");
  const [promptEditor, setPromptEditor] = useState(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [replaceReferenceKey, setReplaceReferenceKey] = useState("");
  const proposalReferenceInputRef = useRef(null);
  const proposalReferenceUploadRef = useRef(null);
  useEffect(() => () => proposalReferenceUploadRef.current?.abort(), []);
  useEffect(() => {
    if (!openMenu) return undefined;
    const onPointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest(".agent-proposal-menu-wrap, .agent-proposal-menu")) return;
      setOpenMenu("");
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpenMenu("");
    };
    const onScroll = (event) => {
      if (event.target instanceof Element && event.target.closest(".agent-proposal-menu")) return;
      setOpenMenu("");
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    const scrollTimer = window.setTimeout(() => {
      window.addEventListener("scroll", onScroll, true);
    }, 160);
    return () => {
      window.clearTimeout(scrollTimer);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [openMenu]);
  // 自动授权：资格由服务端按用户的开关判定，预算由控制器按真正要下单的那个模型核对。
  // 够格就完全不渲染卡片，只留一行凭据。
  // 每份方案只自动提交一次，重渲染不会重复扣费；但提交没成立时必须把入口还给用户，
  // 否则界面会永远停在"已自动开始生成"，图没有、卡片也回不来。
  const autoSubmittedRef = useRef(false);
  useEffect(() => {
    if (!autoApproved || autoSubmittedRef.current || executed || generating) return;
    if (message.proposal?.submitting) return;
    autoSubmittedRef.current = true;
    void Promise.resolve(onApprove?.({ auto: true })).then((result) => {
      if (result === true) return;
      autoSubmittedRef.current = false;
      // "retry" 只是此刻不能提交，等这轮忙完会自己再试；其余情况退回人工卡片。
      if (result !== "retry") onChange?.({ autoFailed: true });
    });
  }, [autoApproved, executed, generating, message.proposal?.submitting, onApprove, onChange]);
  // 必须和上面的 hook 放在一起。自动授权开启时下面会提前返回一行凭据，关掉后又
  // 要渲染完整卡片；钩子写在提前返回后面，关闭授权那一下就会炸。
  useEffect(() => {
    if (!message.proposal?.dismissed) return;
    setOpenMenu("");
    setPromptEditor(null);
    setPromptExpanded(false);
  }, [message.proposal?.dismissed]);
  const proposal = message.proposal;
  const navigate = useNavigate();
  const walletBalance = useAssistantWalletBalance(Boolean(message.proposal) && !message.proposal.dismissed && !autoApproved);
  if (!proposal) return null;
  if (autoApproved) {
    const autoCount = Math.max(1, Number(proposal.count) || 1);
    return (
      <section className="agent-proposal-auto" aria-label="已自动执行创作方案">
        <i className="bi bi-lightning-charge-fill" aria-hidden="true" />
        <p>{executed ? `已自动生成 ${autoCount} 张图片。` : `已自动开始生成 ${autoCount} 张图片，无需确认。`}</p>
      </section>
    );
  }
  const sourceReferences = attachedReferences?.length ? attachedReferences : promptNeedsRecentVisual(message.prompt) ? proposal.referenceImages : [];
  const referenceImages = proposalReferenceImages(proposal, sourceReferences);
  const recordedModel = imageModels.find((item) => item.model === proposal.model) || imageModels[0] || null;
  const frozenProposal = Boolean(executed || generating || proposal.submitting);
  const selectedModel = recordedModel && !frozenProposal
    ? { ...recordedModel, maxImages: assistantImageBatchLimit(recordedModel) }
    : recordedModel;
  const planItems = proposalImagePlanItems(proposal).map((item) => ({
    ...item,
    ...(frozenProposal ? {} : assistantImageSettings(selectedModel, { ...proposal, ...item })),
  }));
  const independentPlan = planItems.length >= 2;
  const modelCapabilities = normalizeImageModelCapabilities(selectedModel || {});
  const resolutions = RESOLUTIONS.filter((item) => modelCapabilities.resolutions.includes(item.id));
  const qualities = IMAGE_QUALITY_OPTIONS.filter((item) => modelCapabilities.qualities.includes(item.id));
  const ratios = getModelAspectRatiosForResolution(selectedModel, proposal.resolution).map(ratioOption);
  const counts = selectedModel && assistantImageBatchLimit(selectedModel) > 0 ? imageCountChoices(selectedModel, proposal.count) : [];
  const referenceMode = proposalReferenceMode(proposal, referenceImages);
  const individualReferences = !independentPlan && referenceMode === "individual" && referenceImages.length > 0;
  const proposalCount = independentPlan ? planItems.length : individualReferences ? referenceImages.length : frozenProposal ? Math.max(1, Number(proposal.count) || 1) : clampImageCount(proposal.count || 1, selectedModel, 1);
  const busy = Boolean(proposal.submitting);
  // 按方案的模型单价（分档模型取方案的分辨率和质量档）× 张数预估；余额读得到才比较，读不到就只显示预估。
  const costPoints = Math.max(0, Number(resolveModelTierPointPricing(selectedModel || {}, { resolution: proposal.resolution, quality: proposal.quality }).effective || 0)) * proposalCount;
  const shortPoints = walletBalance !== null && costPoints > 0 ? Math.max(0, costPoints - walletBalance) : 0;
  const toggleMenu = (id) => setOpenMenu((current) => current === id ? "" : id);
  const promptMode = proposal.promptMode === "faithful" ? "faithful" : "enhanced";
  const referenceNumbers = new Map(referenceImages.map((image, index) => [referenceImageIdentity(image), index + 1]));
  const referenceLabels = new Map(Array.from(referenceNumbers, ([key, number]) => [key, `图${number}`]));
  const validPlan = Boolean(selectedModel && assistantImageBatchLimit(selectedModel) > 0) && (!independentPlan || planItems.every((item) => String(item.prompt || "").trim()));
  const applyReferenceImages = (nextImages) => {
    const nextReferences = uniqueReferenceImages(nextImages).slice(0, modelCapabilities.maxReferenceImages);
    const nextIDs = nextReferences.map(referenceImageIdentity).filter(Boolean);
    const patch = {
      action: nextReferences.length ? "edit" : proposal.action,
      referenceImages: nextReferences,
      referencedImageIds: nextIDs,
      referenceImagesEdited: true,
      referenceMode: proposal.referenceMode === "individual" ? "individual" : "shared",
    };
    if (planItems.length) {
      patch.items = planItems.map((item) => ({
        ...item,
        referenceImages: nextReferences,
        referencedImageIds: nextIDs,
      }));
    }
    onChange(patch);
  };
  const openReferencePicker = (replaceKey = "") => {
    if (busy || referenceUploading || modelCapabilities.maxReferenceImages <= 0) return;
    setReplaceReferenceKey(replaceKey);
    if (proposalReferenceInputRef.current) proposalReferenceInputRef.current.value = "";
    proposalReferenceInputRef.current?.click();
  };
  const uploadProposalReferences = async (files) => {
    const selected = Array.from(files || []).filter((file) => isAssistantImageFile(file) && !isPSDFile(file));
    const replacing = Boolean(replaceReferenceKey);
    const capacity = replacing ? 1 : Math.max(0, modelCapabilities.maxReferenceImages - referenceImages.length);
    const accepted = selected.slice(0, capacity);
    setReplaceReferenceKey("");
    if (selected.length > accepted.length) {
      notificationService.warning(`当前模型最多接收 ${modelCapabilities.maxReferenceImages} 张参考图`);
    }
    if (!accepted.length) {
      if (files?.length && !selected.length) notificationService.warning("请选择 JPG、PNG 或 WebP 图片");
      return;
    }
    const controller = new AbortController();
    proposalReferenceUploadRef.current?.abort();
    proposalReferenceUploadRef.current = controller;
    setReferenceUploading(true);
    try {
      const uploaded = await Promise.all(accepted.map(async (file) => {
        const result = await uploadFile(file, {
          signal: controller.signal,
          referenceUpload: true,
          behaviorFeature: "assistant",
        });
        return { id: uid(), name: file.name, dataUrl: result.url, thumbnailUrl: result.thumbnailUrl, fileKey: result.key };
      }));
      if (controller.signal.aborted) return;
      if (replacing) {
        applyReferenceImages(referenceImages.map((image) => (
          referenceImageIdentity(image) === replaceReferenceKey ? uploaded[0] : image
        )));
      } else {
        applyReferenceImages([...referenceImages, ...uploaded]);
      }
    } catch (error) {
      if (error?.name !== "AbortError") notificationService.error(error?.message || "参考图上传失败");
    } finally {
      if (proposalReferenceUploadRef.current === controller) {
        proposalReferenceUploadRef.current = null;
        setReferenceUploading(false);
      }
    }
  };
  const savePrompt = (prompt) => {
    const trimmed = String(prompt || "").trim();
    if (promptEditor?.itemId) {
      onChange({
        items: planItems.map((item) => item.id === promptEditor.itemId
          ? { ...item, prompt: renumberPlanPrompt(trimmed, planItemReferenceNumbers(item, referenceNumbers).toItem) }
          : item),
        count: planItems.length,
      });
    } else {
      onChange({
        prompt: trimmed,
        [promptMode === "faithful" ? "faithfulPrompt" : "enhancedPrompt"]: trimmed,
      });
    }
    setPromptEditor(null);
  };
  const changePlanItemSetting = (itemId, patch) => {
    const nextItems = planItems.map((item) => {
      if (item.id !== itemId) return item;
      const settings = assistantImageSettings(selectedModel, { ...proposal, ...item, ...patch });
      if (patch.resolution && settings.ratio && settings.ratio !== item.ratio) {
        notificationService.info(`${patch.resolution} 不支持 ${item.ratio}，该张比例已调整为 ${settings.ratio}`);
      }
      return { ...item, ...settings };
    });
    onChange({ items: nextItems, count: nextItems.length });
  };
  const changeProposalModel = (nextModel) => {
    const model = imageModels.find((item) => item.model === nextModel) || selectedModel;
    if (!model || isCatalogModelMaintenance(model)) return;
    const batchLimit = assistantImageBatchLimit(model);
    if (batchLimit <= 0) return;
    const fixedCount = independentPlan ? planItems.length : individualReferences ? referenceImages.length : 0;
    if (fixedCount && batchLimit < fixedCount) {
      notificationService.warning(`当前额度下该模型一次最多生成 ${batchLimit} 张，方案需要 ${fixedCount} 张`);
      return;
    }
    const settings = assistantImageSettings(model, proposal);
    if (settings.ratio && settings.ratio !== proposal.ratio) {
      notificationService.info(`新模型不支持 ${proposal.ratio}，比例已调整为 ${settings.ratio}`);
    }
    onChange({
      model: nextModel,
      ...settings,
      ...(planItems.length ? { items: planItems.map((item) => ({ ...item, ...assistantImageSettings(model, item) })) } : {}),
      count: fixedCount || clampImageCount(proposal.count, model, 1),
    });
  };
  return (
    <div className={`agent-proposal${proposal.dismissed ? " is-dismissed" : ""}${executed ? " is-executed" : ""}`}>
      {proposal.dismissed ? (
        <button type="button" className="agent-proposal-restore" onClick={onRestore}>
          <span>创作方案已收起</span>
          <em>展开</em>
        </button>
      ) : null}
      <div className="agent-proposal-body" hidden={proposal.dismissed}>
      <header className="agent-proposal-head">
        <strong>{proposal.action === "edit" ? "图片编辑方案" : "图片生成方案"}</strong>
        {independentPlan ? <em className="agent-proposal-count">{planItems.length} 张独立图</em> : null}
        {executed ? <span className="agent-proposal-state">已执行</span> : null}
        {/* 开了自动授权却还出卡片，一定要说清楚原因，否则会被当成开关没生效。 */}
        {autoApprove && proposal.autoApprovable && !executed ? (
          <span className="agent-proposal-state is-budget">
            {proposal.autoFailed
              ? "自动执行未成功，请确认后重试"
              : `超出自动授权预算（${autoApproveBudgetCents} 积分），需要确认`}
          </span>
        ) : null}
        {!independentPlan ? (
          <div className="agent-proposal-prompt-mode" role="group" aria-label="提示词执行方式">
            <button
              type="button"
              className={promptMode === "faithful" ? "is-active" : ""}
              aria-pressed={promptMode === "faithful"}
              disabled={busy}
              onClick={() => onChange({ promptMode: "faithful", prompt: proposal.faithfulPrompt || proposal.prompt })}
            >忠实执行</button>
            <button
              type="button"
              className={promptMode === "enhanced" ? "is-active" : ""}
              aria-pressed={promptMode === "enhanced"}
              disabled={busy}
              onClick={() => onChange({ promptMode: "enhanced", prompt: proposal.enhancedPrompt || proposal.prompt })}
            >智能优化</button>
          </div>
        ) : null}
      </header>
      {(referenceImages.length > 0 || modelCapabilities.maxReferenceImages > 0) && (
        <div className="agent-proposal-refs" aria-label="参考图">
          {referenceImages.map((image, index) => (
            <figure className="agent-proposal-ref" key={image.id || image.fileKey || index}>
              <button className="agent-proposal-ref-preview" type="button" title={`查看图${index + 1}`} onClick={() => onOpenImage(image, index, referenceImages)}>
                <AssistantPreviewImage image={image} alt={image.name || `参考图 ${index + 1}`} />
                <span>图{index + 1}</span>
              </button>
              <button className="agent-proposal-ref-replace" type="button" title={`替换图${index + 1}`} aria-label={`替换参考图 ${index + 1}`} disabled={busy || referenceUploading} onClick={() => openReferencePicker(referenceImageIdentity(image))}>
                <i className="bi bi-arrow-repeat" aria-hidden="true" />
              </button>
              <button className="agent-proposal-ref-remove" type="button" title={`移除图${index + 1}`} aria-label={`移除参考图 ${index + 1}`} disabled={busy || referenceUploading} onClick={() => applyReferenceImages(referenceImages.filter((_, itemIndex) => itemIndex !== index))}>
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </figure>
          ))}
          {referenceImages.length < modelCapabilities.maxReferenceImages ? (
            <button className="agent-proposal-ref-add" type="button" title="添加参考图" aria-label="添加参考图" disabled={busy || referenceUploading} onClick={() => openReferencePicker()}>
              <i className={`bi ${referenceUploading ? "bi-hourglass-split" : "bi-plus-lg"}`} aria-hidden="true" />
            </button>
          ) : null}
          <input ref={proposalReferenceInputRef} className="reference-file-input" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { void uploadProposalReferences(event.target.files); event.target.value = ""; }} />
        </div>
      )}
      {independentPlan ? (
        <div className="agent-proposal-plan" aria-label={`${planItems.length} 张独立图片方案`}>
          {planItems.map((item, index) => {
            const labels = item.referencedImageIds.map((id) => referenceLabels.get(id)).filter(Boolean);
            const cardPrompt = renumberPlanPrompt(item.prompt, planItemReferenceNumbers(item, referenceNumbers).toCard);
            const itemRatios = getModelAspectRatiosForResolution(selectedModel, item.resolution).map(ratioOption);
            return (
              <div className="agent-proposal-plan-item" key={item.id}>
                <div className="agent-proposal-plan-item-head">
                  <b>{index + 1}</b>
                  <strong>{item.title}</strong>
                  <div className="agent-proposal-plan-settings agent-proposal-params">
                  <ProposalSelect
                    id="ratio"
                    label="比例"
                    ariaLabel={`${item.title}比例`}
                    valueLabel={itemRatios.find((option) => option.id === item.ratio)?.label || item.ratio || itemRatios[0]?.label}
                    disabled={busy}
                    open={openMenu === `plan-ratio:${item.id}`}
                    onToggle={() => toggleMenu(`plan-ratio:${item.id}`)}
                    onPick={(ratio) => { setOpenMenu(""); changePlanItemSetting(item.id, { ratio }); }}
                    options={itemRatios.map((option) => ({
                      id: option.id,
                      label: option.label,
                      selected: item.ratio === option.id,
                      mark: option.shape,
                      markStyle: ratioPreviewStyle(option.id),
                    }))}
                  />
                  {resolutions.length ? (
                    <ProposalSelect
                      id="resolution"
                      label="分辨率"
                      ariaLabel={`${item.title}分辨率`}
                      valueLabel={resolutions.find((option) => option.id === item.resolution)?.label || item.resolution || resolutions[0]?.label}
                      disabled={busy}
                      open={openMenu === `plan-resolution:${item.id}`}
                      onToggle={() => toggleMenu(`plan-resolution:${item.id}`)}
                      onPick={(resolution) => { setOpenMenu(""); changePlanItemSetting(item.id, { resolution }); }}
                      options={resolutions.map((option) => ({
                        id: option.id,
                        label: option.label,
                        selected: item.resolution === option.id,
                      }))}
                    />
                  ) : null}
                  </div>
                </div>
                <button
                  className="agent-proposal-plan-prompt"
                  type="button"
                  disabled={busy}
                  aria-label={`编辑${item.title}提示词`}
                  onClick={() => { setOpenMenu(""); setPromptEditor({ itemId: item.id, title: item.title, value: cardPrompt }); }}
                >
                  <span>{cardPrompt}</span>
                  {labels.length ? <em>{labels.join(" · ")}</em> : null}
                  <i className="bi bi-pencil" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="agent-proposal-prompt">
          <button
            type="button"
            className={`agent-proposal-prompt-preview${proposal.prompt ? "" : " is-empty"}${promptExpanded ? " is-expanded" : ""}`}
            disabled={busy}
            aria-label="编辑生成提示词"
            onClick={() => { setOpenMenu(""); setPromptEditor({ value: proposal.prompt || "" }); }}
          >
            <span>{proposal.prompt || "点击编辑生成提示词"}</span>
            <i className="bi bi-pencil" aria-hidden="true" />
          </button>
          {String(proposal.prompt || "").length > 72 ? (
            <button
              type="button"
              className="agent-proposal-prompt-toggle"
              disabled={busy}
              onClick={(event) => { event.stopPropagation(); setPromptExpanded((open) => !open); }}
            >{promptExpanded ? "收起全文" : "展开"}</button>
          ) : null}
        </div>
      )}
      {promptEditor ? (
        <ProposalPromptDialog
          value={promptEditor.value || ""}
          title={promptEditor.title ? `编辑${promptEditor.title}提示词` : "编辑生成提示词"}
          maxMessageCharacters={maxMessageCharacters}
          onCancel={() => setPromptEditor(null)}
          onSave={savePrompt}
        />
      ) : null}
      <div className="agent-proposal-toolbar">
        <div className="agent-proposal-params">
        {imageModels.length ? (
          <ProposalSelect
            id="model"
            label="模型"
            ariaLabel="生成模型"
            valueLabel={selectedModel?.label || proposal.modelName || proposal.model || "选择模型"}
            disabled={busy}
            open={openMenu === "model"}
            onToggle={() => toggleMenu("model")}
            onPick={(nextModel) => { setOpenMenu(""); changeProposalModel(nextModel); }}
            options={imageModels.map((model) => ({
              id: model.model,
              label: model.label,
              model,
              disabled: isCatalogModelMaintenance(model),
              selected: (proposal.model || selectedModel?.model) === model.model,
              detail: <ModelMenuPrice model={model} perImage />,
            }))}
          />
        ) : (
          <div className="agent-proposal-field is-model">
            <span>模型</span>
            <div className="agent-proposal-readonly">{proposal.modelName || proposal.model || "模型不可用"}</div>
          </div>
        )}
        {!independentPlan && ratios.length ? <ProposalSelect
          id="ratio"
          label="比例"
          ariaLabel="画面比例"
          valueLabel={ratios.find((item) => item.id === proposal.ratio)?.label || proposal.ratio || ratios[0]?.label}
          disabled={busy}
          open={openMenu === "ratio"}
          onToggle={() => toggleMenu("ratio")}
          onPick={(ratio) => { setOpenMenu(""); onChange({ ratio }); }}
          options={ratios.map((ratio) => ({
            id: ratio.id,
            label: ratio.label,
            selected: proposal.ratio === ratio.id,
            mark: ratio.shape,
            markStyle: ratioPreviewStyle(ratio.id),
          }))}
        /> : null}
        {!independentPlan && resolutions.length ? <ProposalSelect
          id="resolution"
          label="清晰度"
          ariaLabel="清晰度"
          valueLabel={resolutions.find((item) => item.id === proposal.resolution)?.label || resolutions[0]?.label}
          disabled={busy}
          open={openMenu === "resolution"}
          onToggle={() => toggleMenu("resolution")}
          onPick={(resolution) => {
            setOpenMenu("");
            const settings = assistantImageSettings(selectedModel, { ...proposal, resolution });
            if (settings.ratio && settings.ratio !== proposal.ratio) {
              notificationService.info(`${resolution} 不支持 ${proposal.ratio}，比例已调整为 ${settings.ratio}`);
            }
            onChange({ resolution, ...settings });
          }}
          options={resolutions.map((option) => ({
            id: option.id,
            label: option.label,
            selected: proposal.resolution === option.id,
          }))}
        /> : null}
        {qualities.length ? <ProposalSelect
          id="quality"
          label="质量"
          ariaLabel="图片质量"
          valueLabel={qualities.find((item) => item.id === (proposal.quality || qualities[0]?.id))?.label || qualities[0]?.label}
          disabled={busy}
          open={openMenu === "quality"}
          onToggle={() => toggleMenu("quality")}
          onPick={(quality) => {
            setOpenMenu("");
            onChange({
              quality,
              ...(planItems.length ? { items: planItems.map((item) => ({ ...item, quality })) } : {}),
            });
          }}
          options={qualities.map((option) => ({
            id: option.id,
            label: option.label,
            selected: (proposal.quality || qualities[0]?.id) === option.id,
          }))}
        /> : null}
        {selectedModel?.transparentBackground ? <ProposalSelect
          id="background"
          label="背景"
          ariaLabel="背景"
          valueLabel={proposal.transparentBackground ? "透明 PNG" : "不透明"}
          disabled={busy}
          open={openMenu === "background"}
          onToggle={() => toggleMenu("background")}
          onPick={(value) => { setOpenMenu(""); onChange({ transparentBackground: value === "transparent" }); }}
          options={[
            { id: "opaque", label: "不透明", selected: !proposal.transparentBackground },
            { id: "transparent", label: "透明 PNG", selected: proposal.transparentBackground === true },
          ]}
        /> : null}
          <ProposalSelect
            id="count"
            label="数量"
            ariaLabel="生成数量"
            valueLabel={`${proposalCount} 张${independentPlan ? " · 独立方案" : individualReferences ? " · 逐张" : ""}`}
            disabled={busy || independentPlan || individualReferences}
            open={openMenu === "count"}
            onToggle={() => toggleMenu("count")}
            onPick={(count) => { setOpenMenu(""); onChange({ count: Number(count) }); }}
            options={counts.map((count) => ({
              id: String(count),
              label: `${count} 张`,
              selected: proposalCount === count,
            }))}
          />
        </div>
        <footer className="agent-proposal-actions">
          {costPoints > 0 ? (
            <span className={`agent-proposal-cost${shortPoints > 0 ? " is-short" : ""}`}>
              预计 <b>{costPoints.toLocaleString("zh-CN")}</b> 积分
              {walletBalance !== null ? <small>{shortPoints > 0 ? `可用 ${walletBalance.toLocaleString("zh-CN")}，还差 ${shortPoints.toLocaleString("zh-CN")}` : `可用 ${walletBalance.toLocaleString("zh-CN")}`}</small> : null}
            </span>
          ) : null}
          <button type="button" className="is-secondary" disabled={busy} onClick={onDismiss}>收起</button>
          {shortPoints > 0 && !busy ? (
            <button type="button" className="is-primary" onClick={() => navigate("/wallet")}>
              <i className="bi bi-plus-circle" aria-hidden="true" /><span>积分不足，去充值</span>
            </button>
          ) : (
            <button type="button" className="is-primary" disabled={busy || generating || !validPlan || (!independentPlan && !String(proposal.prompt || "").trim())} onClick={() => void onApprove?.()}>
              {busy ? <i className="bi bi-arrow-repeat" aria-hidden="true" /> : null}
              <span>{busy ? "正在提交" : executed ? "再生成一组" : "开始生成"}</span>
            </button>
          )}
        </footer>
      </div>
      </div>
    </div>
  );
}

function formatStepDuration(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 60_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0).replace(/\.0$/, "")} 秒`;
  return `${Math.floor(value / 60_000)} 分 ${Math.round((value % 60_000) / 1000)} 秒`;
}

// “用时”：每一步一句话，右侧是这一步自己花的时间，慢的标出来。
function AssistantDebugPanel({ items, startedAt, pending = false }) {
  const nowMs = useElapsedMs(Number(startedAt) || 0, pending) + (Number(startedAt) || 0);
  const steps = humanizeAssistantTrace(items, { startedAt, pending, nowMs });
  if (!steps.length) return null;
  return (
    <ol className="assistant-debug-trace" aria-label="用时">
      {steps.map((step) => (
        <li key={step.key} className={[step.slow ? "is-slow" : "", step.running ? "is-running" : "", step.tone ? `is-${step.tone}` : ""].filter(Boolean).join(" ") || undefined}>
          <span>{step.text}</span>
          {step.durationMs >= 1000 || step.running ? <time>{step.running ? "进行中" : formatStepDuration(step.durationMs)}{step.slow && !step.running ? <b>较慢</b> : null}</time> : null}
        </li>
      ))}
    </ol>
  );
}

// “参考了 N 条消息”：一句话说明这次回答带上了哪些对话。占用比例已在顶栏“清除上文”旁常驻，
// 这里只在快满时提醒一句，并指向那个按钮。
function AssistantContextExplain({ usage }) {
  const included = usage.includedMessages;
  const total = Number(usage.totalMessages) || included;
  const summarized = usage.compactedMessages;
  const skipped = usage.omittedMessages + (Number(usage.droppedMessages) || 0);
  const parts = [];
  if (summarized > 0) parts.push(`更早的 ${summarized} 条已自动概括后一起带上`);
  if (skipped > 0) parts.push(`还有 ${skipped} 条太早，这次没有参考`);
  return (
    <div className="message-status-detail">
      <div className="message-context-stats">
        <p>这次回答参考了最近 {included} 条消息{total > included ? `（整段对话共 ${total} 条）` : ""}。{parts.length ? `${parts.join("，")}。` : ""}</p>
        {usage.usagePercent >= 80 ? <p className="message-context-warning">对话快到上限了，较早的内容可能会被遗忘，可以点右上角「清除上文」重新开始。</p> : null}
      </div>
    </div>
  );
}

const STATUS_SECTION_LABELS = { tools: "过程", trace: "用时" };

// One status line per reply: state on the left, then 思考 / 过程 / 流程 as quiet
// inline links. Every section opens in the same panel below, one at a time.
function AssistantMessageStatus({ message, status, contextUsage, expanded, hideErrorDetail = false }) {
  const pending = Boolean(message.pending);
  const usage = normalizeAssistantUsage(message);
  const elapsedMs = useElapsedMs(usageStartedAtMs(message), pending);
  const reasoning = normalizeReasoningText(message.reasoning);
  const reasoningHtml = useMemo(() => (reasoning ? renderAssistantMarkdownHtml(reasoning, { streaming: false }) : ""), [reasoning]);
  const toolItems = useMemo(() => normalizeAssistantToolSteps(message.toolSteps), [message.toolSteps]);
  const debugItems = Array.isArray(message.debugTrace) ? message.debugTrace : [];
  // While a reply streams, its thinking (or else its tool steps) shows live; it folds away when done.
  const liveSection = pending ? (reasoning ? "reasoning" : toolItems.length ? "tools" : "") : "";
  const [open, setOpen] = useState(() => liveSection || (expanded ? "detail" : ""));
  const liveSectionRef = useRef(liveSection);
  const [folding, setFolding] = useState(false);
  useEffect(() => {
    const previous = liveSectionRef.current;
    if (previous === liveSection) return undefined;
    liveSectionRef.current = liveSection;
    if (liveSection) {
      setFolding(false);
      setOpen(liveSection);
      return undefined;
    }
    // The reply just finished: keep the live view a moment, then fold it away.
    setFolding(true);
    const timer = window.setTimeout(() => {
      setOpen((current) => (current === previous ? "" : current));
      setFolding(false);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [liveSection]);
  const liveLook = pending || folding;
  const failed = status.tone === "error";
  const shownRef = useRef(open);
  if (open) shownRef.current = open;
  const shown = open || shownRef.current;
  const toggle = (key) => setOpen((current) => (current === key ? "" : key));
  // The live thinking window only fades its top edge once the text overflows it.
  const reasoningRef = useRef(null);
  const [reasoningClipped, setReasoningClipped] = useState(false);
  useLayoutEffect(() => {
    const node = reasoningRef.current;
    setReasoningClipped(Boolean(node && liveLook && node.scrollHeight > node.clientHeight + 1));
  }, [liveLook, reasoningHtml, shown]);

  const sections = [];
  if (reasoning) sections.push({ key: "reasoning", label: pending ? "在想" : "思考" });
  if (toolItems.length) sections.push({ key: "tools", label: STATUS_SECTION_LABELS.tools, count: toolItems.length });
  if (debugItems.length) sections.push({ key: "trace", label: STATUS_SECTION_LABELS.trace });
  if (!pending && contextUsage?.includedMessages > 0) sections.push({ key: "detail", label: `参考了 ${contextUsage.includedMessages} 条消息` });
  const activity = pending ? [...toolItems].reverse().find((step) => step.status === "running")?.label || "" : "";
  const metrics = [];
  if (usage?.outputTokens) metrics.push({ key: "out", title: "输出 token", text: `输出 ${formatContextTokens(usage.outputTokens)}` });
  if (usage?.inputTokens) metrics.push({ key: "in", title: usage.cachedInputTokens ? `输入 token，其中 ${usage.cachedInputTokens} 命中缓存（按折扣计费）` : "输入 token", text: `输入 ${formatContextTokens(usage.inputTokens)}${usage.cachedInputTokens ? `（缓存 ${formatContextTokens(usage.cachedInputTokens)}）` : ""}` });
  if (usage?.firstTokenMs) metrics.push({ key: "ttft", title: "首字耗时", text: `首字 ${formatDurationMs(usage.firstTokenMs)}` });

  return (
    <div className={`assistant-message-label is-${status.tone}${pending ? " is-live" : ""}${open ? " is-open" : ""}`}>
      <div className="message-status-row">
        <span className="message-status-indicator" aria-hidden="true"><i /></span>
        <span className="message-status-toggle" role="status"><strong aria-live="polite"><span key={status.label} className="message-status-label">{status.label}</span></strong></span>
        {pending && usageStartedAtMs(message) ? <span className="message-status-clock" aria-label="已用时">{formatElapsedClock(elapsedMs)}</span> : null}
        {activity ? <span key={activity} className="message-status-activity">{activity}</span> : null}
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`message-status-section${section.key === "reasoning" ? " message-reasoning-toggle" : ""}${open === section.key ? " is-active" : ""}`}
            aria-expanded={open === section.key}
            aria-label={section.label}
            onClick={() => toggle(section.key)}
          >
            {section.label}{section.count ? <small>{section.count}</small> : null}
          </button>
        ))}
        {!pending && metrics.length ? (
          <span className="message-status-metrics">
            {metrics.map((item, index) => (
              <Fragment key={item.key}>
                {index ? <i aria-hidden="true" /> : null}
                <span title={item.title}>{item.text}</span>
              </Fragment>
            ))}
          </span>
        ) : null}
      </div>
      {failed && status.detail && !hideErrorDetail ? <p className="message-status-error">{status.detail}</p> : null}
      <div className="message-status-panel" aria-hidden={!open}>
        <div className="message-status-panel-inner">
          <div key={shown} className="message-status-panel-body">
            {shown === "reasoning" && reasoningHtml ? <div ref={reasoningRef} className={`assistant-reasoning-body${liveLook ? " is-live" : ""}${reasoningClipped ? " is-clipped" : ""}`} dangerouslySetInnerHTML={{ __html: reasoningHtml }} /> : null}
            {shown === "tools" ? <AssistantToolTimeline steps={message.toolSteps} pending={pending} expanded /> : null}
            {shown === "trace" ? <AssistantDebugPanel items={debugItems} startedAt={usageStartedAtMs(message)} pending={pending} /> : null}
            {shown === "detail" && contextUsage ? <AssistantContextExplain usage={contextUsage} /> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImageGenerationStage({ message, imageModelLabel, imageModels, loadedImages, onOpenImage, onImageLoad }) {
  const elapsedMs = useElapsedMs(usageStartedAtMs(message), Boolean(message.pending));
  const stageCopy = {
    "preparing-image": ["准备任务", "正在整理提示词与参考图"],
    preparing: ["准备任务", "正在整理提示词与参考图"],
    "submitting-image": ["提交任务", "正在提交图片服务"],
    "generating-image": ["正在生成", "图片服务正在生成"],
    upstream_generating: ["正在生成", "图片服务正在生成"],
    "fetching-image": ["获取结果", "正在拉取生成结果"],
    fetching_result: ["获取结果", "正在拉取生成结果"],
    "saving-image": ["保存图片", "正在生成预览并保存"],
    saving_result: ["保存图片", "正在生成预览并保存"],
  }[message.statusStage] || ["处理任务", "正在处理图片任务"];
  const previewMeta = { ...imageGenerationMeta(message, imageModels), messageId: message.id, runId: message.runId || "", model: message.model || "", requestRatio: message.requestRatio || message.ratio || "", requestSize: message.requestSize || "", width: message.width, height: message.height, quality: message.quality || "", pending: Boolean(message.pending) };
  const stageParameters = [message.ratio, message.resolution, message.quality].filter(Boolean);
  const slots = imageSlots({ ...message, count: Number(message.count || 2) });
  const planItems = Array.isArray(message.imagePlanItems) ? message.imagePlanItems : [];
  const doneCount = slots.filter((slot) => slot.image).length;
  return (
    <div className="image-generation-stage">
      <div className="image-generation-summary">
        <strong>{message.prompt || "正在生成图片"}</strong>
        <span title={imageModelLabel}>{imageModelLabel}</span>
        {stageParameters.map((value) => <Fragment key={value}><i /><span>{value}</span></Fragment>)}
      </div>
      <div className={`image-dream-grid${Number(message.count || 2) === 1 ? " is-single" : ""}${Number(message.count || 2) > 2 ? " is-many" : ""}`} style={{ "--image-skeleton-ratio": imageRatioValue(message), "--image-slot-count": Number(message.count || 2) }}>
        {slots.map(({ index, image }) => {
          const position = image ? message.images.indexOf(image) : -1;
          const loaded = Boolean(image && loadedImages.has(`${message.id}-${position}`));
          const title = planItems[index]?.title;
          return (
            <div key={index} className={`image-dream-slot${image ? " is-ready" : ""}${loaded ? " is-loaded" : ""}`}>
              {image && (
                <button className="image-dream-preview" type="button" title="查看大图" onClick={() => onOpenImage(image, position, message.images, previewMeta)}>
                  <AssistantPreviewImage image={image} alt={image.revisedPrompt || "AI 生成图片"} loading="lazy" onLoad={() => onImageLoad(message.id, position)} />
                </button>
              )}
              {(!image || !loaded) && <i className="dream-slot-spinner" aria-hidden="true" />}
              {slots.length > 1 ? (
                <span className={`image-dream-slot-label${image ? " is-done" : ""}`}>
                  {image ? <i className="bi bi-check-lg" aria-hidden="true" /> : null}
                  {title ? `${index + 1} · ${title}` : `第 ${index + 1} 张`}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="image-generation-current-stage" role="status" aria-live="polite">
        <span>
          {stageCopy[0]}
          {usageStartedAtMs(message) ? <b className="image-generation-stage-elapsed">{formatElapsedClock(elapsedMs)}</b> : null}
        </span>
        <strong>{stageCopy[1]}</strong>
        {slots.length > 1 ? <em className="image-generation-progress">已完成 {doneCount}/{slots.length}</em> : null}
      </div>
    </div>
  );
}

function assistantWebSources(searches) {
  const seen = new Set();
  const sources = [];
  for (const search of Array.isArray(searches) ? searches : []) {
    for (const source of Array.isArray(search?.sources) ? search.sources : []) {
      const rawUrl = String(source?.url || "").trim();
      if (!rawUrl || seen.has(rawUrl)) continue;
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
        seen.add(rawUrl);
        sources.push({
          url: parsed.href,
          title: String(source?.title || parsed.hostname).trim() || parsed.hostname,
          host: parsed.hostname.replace(/^www\./i, ""),
        });
      } catch {
        // Ignore malformed or non-web citations from upstreams.
      }
      if (sources.length >= 12) return sources;
    }
  }
  return sources;
}

const WEB_SOURCES_COLLAPSED = 4;

function AssistantWebSources({ searches }) {
  const sources = assistantWebSources(searches);
  const [expanded, setExpanded] = useState(false);
  if (!sources.length) return null;
  const visible = expanded ? sources : sources.slice(0, WEB_SOURCES_COLLAPSED);
  const hidden = sources.length - visible.length;
  return (
    <section className="assistant-web-sources" aria-label="联网来源">
      <span className="assistant-web-sources-label"><i className="bi bi-globe2" aria-hidden="true" />来源</span>
      {visible.map((source, index) => (
        <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={`${source.title}\n${source.url}`}>
          <b>{index + 1}</b><span>{source.title}</span><small>{source.host}</small>
        </a>
      ))}
      {hidden > 0 ? <button type="button" className="assistant-web-sources-more" onClick={() => setExpanded(true)}>+{hidden}</button> : null}
    </section>
  );
}

function AssistantFollowUpQueue({ items, editingId, busyId, onEdit, onRemove }) {
  const visible = items.filter((run) => run.id !== editingId);
  if (!visible.length) return null;
  return (
    <section className="assistant-followup-queue" aria-label="排队消息">
      {visible.map((run, index) => {
        const busy = busyId === run.id || Boolean(run.pending);
        return (
          <article key={run.id}>
            <button
              type="button"
              className="assistant-followup-prompt"
              title={run.pending ? "正在加入队列" : "回到输入框修改"}
              disabled={Boolean(run.pending)}
              onClick={() => onEdit(run)}
            >
              {run.prompt || `排队消息 ${index + 1}`}
            </button>
            <button
              type="button"
              className="assistant-followup-remove"
              title="移出队列并退款"
              aria-label="移出队列并退款"
              disabled={busy}
              onClick={() => void onRemove(run)}
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 3l6 6M9 3L3 9" />
              </svg>
            </button>
          </article>
        );
      })}
    </section>
  );
}

function AssistantMessageFeedbackActions({ message, busy, onFeedback }) {
  const feedback = ["positive", "negative"].includes(message.feedback) ? message.feedback : "";
  return (
    <>
      <button className={`message-feedback-button${feedback === "positive" ? " is-active" : ""}`} type="button" title={feedback === "positive" ? "取消赞" : "赞"} aria-label={feedback === "positive" ? "取消赞" : "赞"} aria-pressed={feedback === "positive"} aria-busy={busy} disabled={busy} onClick={() => onFeedback(message, "positive")}>
        <i className={`bi bi-hand-thumbs-up${feedback === "positive" ? "-fill" : ""}`} aria-hidden="true" />
      </button>
      <button className={`message-feedback-button${feedback === "negative" ? " is-active" : ""}`} type="button" title={feedback === "negative" ? "取消踩" : "踩"} aria-label={feedback === "negative" ? "取消踩" : "踩"} aria-pressed={feedback === "negative"} aria-busy={busy} disabled={busy} onClick={() => onFeedback(message, "negative")}>
        <i className={`bi bi-hand-thumbs-down${feedback === "negative" ? "-fill" : ""}`} aria-hidden="true" />
      </button>
    </>
  );
}

// 视频结果：回复数据里带 videos 时显示（[{ url, posterUrl, durationSeconds, title, width, height, model }]）。
// 助手目前还不能出视频，先把卡片做好，有视频产出时直接用。
function formatVideoDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function AssistantVideoResult({ video }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(Number(video.durationSeconds) || 0);
  const meta = [video.model, video.width && video.height ? `${video.width}×${video.height}` : "", duration ? formatVideoDuration(duration) : ""].filter(Boolean);
  const play = () => {
    const element = videoRef.current;
    if (!element) return;
    void element.play().catch(() => undefined);
  };
  return (
    <figure className={`assistant-video-card${playing ? " is-playing" : ""}`}>
      <div className="assistant-video-frame" style={video.width && video.height ? { aspectRatio: `${video.width} / ${video.height}` } : undefined}>
        <video ref={videoRef} src={video.url} poster={video.posterUrl || undefined} preload="metadata" playsInline controls={playing}
          onPlay={() => setPlaying(true)} onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || duration)} />
        {!playing ? (
          <button type="button" className="assistant-video-play" aria-label="播放视频" onClick={play}>
            <i className="bi bi-play-fill" aria-hidden="true" />
          </button>
        ) : null}
        {!playing && duration ? <span className="assistant-video-duration">{formatVideoDuration(duration)}</span> : null}
      </div>
      <figcaption>
        <div>
          <strong title={video.title || "生成的视频"}>{video.title || "生成的视频"}</strong>
          {meta.length ? <small>{meta.join(" · ")}</small> : null}
        </div>
        <a className="assistant-video-download" href={video.url} download title="下载视频" aria-label="下载视频"><i className="bi bi-download" aria-hidden="true" /></a>
      </figcaption>
    </figure>
  );
}

function AssistantVideoResults({ videos }) {
  const list = (Array.isArray(videos) ? videos : []).filter((video) => video?.url);
  if (!list.length) return null;
  return <div className="assistant-video-results">{list.map((video, index) => <AssistantVideoResult key={video.id || video.url || index} video={video} />)}</div>;
}

// 失败的回复：按原因给一张卡片，带上能直接做的下一步（重试、去充值、改一下再发）。
function AssistantErrorCard({ error, canRetry, onRetry, onEditPrompt }) {
  const navigate = useNavigate();
  const buttons = error.actions.map((action) => {
    if (action === "retry" && canRetry) return { key: action, label: "重试", icon: "bi-arrow-clockwise", run: onRetry };
    if (action === "recharge") return { key: action, label: "去充值", icon: "bi-plus-circle", run: () => navigate("/wallet") };
    if (action === "edit" && onEditPrompt) return { key: action, label: "修改后重发", icon: "bi-pencil", run: onEditPrompt };
    return null;
  }).filter(Boolean);
  return (
    <section className={`assistant-error-card is-${error.kind}`} role="alert">
      <div className="assistant-error-text">
        <strong>{error.title}</strong>
        <p>{error.hint}</p>
        {error.detail ? <small>{error.detail}</small> : null}
      </div>
      {buttons.length ? (
        <footer>
          {buttons.map((button, index) => (
            <button key={button.key} type="button" className={index === 0 ? "is-primary" : ""} onClick={button.run}>
              <i className={`bi ${button.icon}`} aria-hidden="true" />{button.label}
            </button>
          ))}
        </footer>
      ) : null}
    </section>
  );
}

// 点踩之后问一句哪里不满意：选原因、可补一句话，提交后进质量闭环。
const FEEDBACK_REASONS = [
  { id: "off_topic", label: "答非所问" },
  { id: "wrong", label: "内容有误" },
  { id: "ignored", label: "没按我的要求" },
  { id: "too_long", label: "太啰嗦" },
  { id: "bad_image", label: "图片不满意", images: true },
  { id: "other", label: "其他" },
];

function AssistantFeedbackReasons({ message, onSubmit, onDone }) {
  const [picked, setPicked] = useState(() => new Set());
  const [note, setNote] = useState("");
  const [state, setState] = useState("asking");
  const reasons = FEEDBACK_REASONS.filter((reason) => !reason.images || message.images?.length);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    if (state !== "sent") return undefined;
    const timer = window.setTimeout(() => doneRef.current?.(), 2400);
    return () => window.clearTimeout(timer);
  }, [state]);
  if (state === "sent") {
    return <p className="assistant-feedback-thanks" role="status"><i className="bi bi-check2-circle" aria-hidden="true" />谢谢，已记下，会用来改进回答</p>;
  }
  const toggle = (id) => setPicked((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const submit = async () => {
    setState("sending");
    const ok = await onSubmit([...picked], note.trim());
    setState(ok ? "sent" : "asking");
  };
  return (
    <section className="assistant-feedback-reasons" aria-label="点踩原因">
      <header>
        <strong>哪里不满意？</strong>
        <button type="button" className="assistant-feedback-skip" aria-label="跳过" title="跳过" onClick={onDone}><i className="bi bi-x-lg" aria-hidden="true" /></button>
      </header>
      <div className="assistant-feedback-chips" role="group" aria-label="原因，可多选">
        {reasons.map((reason) => (
          <button key={reason.id} type="button" aria-pressed={picked.has(reason.id)} className={picked.has(reason.id) ? "is-active" : ""} onClick={() => toggle(reason.id)}>
            {picked.has(reason.id) ? <i className="bi bi-check2" aria-hidden="true" /> : null}{reason.label}
          </button>
        ))}
      </div>
      <textarea rows={2} maxLength={200} aria-label="补充说明" placeholder="还想说点什么（可选）" value={note} onChange={(event) => setNote(event.target.value)} />
      <footer>
        <small>只用于改进回答质量</small>
        <button type="button" className="assistant-feedback-submit" disabled={state === "sending" || (!picked.size && !note.trim())} onClick={() => void submit()}>
          {state === "sending" ? "提交中…" : "提交"}
        </button>
      </footer>
    </section>
  );
}

function closestNavigatorTurn(offsets, target, fallback = "") {
  if (!offsets.length) return fallback;
  let low = 0;
  let high = offsets.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle].top < target) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return offsets[0].turnId || fallback;
  if (low === offsets.length) return offsets[offsets.length - 1].turnId || fallback;
  const previous = offsets[low - 1];
  const next = offsets[low];
  return (target - previous.top <= next.top - target ? previous : next).turnId || fallback;
}

function ConversationMinimap({ items, activeSetterRef, onScrollToMessage }) {
  const [activeMessageId, setActiveMessageId] = useState("");
  const activeIndex = items.findIndex((item) => item.id === activeMessageId);

  useLayoutEffect(() => {
    const setActive = (messageId) => setActiveMessageId((current) => current === messageId ? current : messageId);
    activeSetterRef.current = setActive;
    return () => {
      if (activeSetterRef.current === setActive) activeSetterRef.current = () => {};
    };
  }, [activeSetterRef]);

  useEffect(() => {
    setActiveMessageId((current) => items.some((item) => item.id === current) ? current : items[0]?.id || "");
  }, [items]);

  if (!items.length) return null;
  return (
    <nav className="conversation-minimap" aria-label="对话位置导航">
      {items.map((item, index) => {
        const isActive = item.id === activeMessageId;
        const isMajor = (index + 1) % 5 === 0 && index !== activeIndex;
        const position = activeIndex >= 0 && index < activeIndex
          ? "is-past"
          : activeIndex >= 0 && index > activeIndex
            ? "is-ahead"
            : "";
        return (
          <button
            key={item.id}
            type="button"
            className={[isActive ? "active" : "", position, isMajor ? "is-major" : ""].filter(Boolean).join(" ")}
            aria-label={`跳转到问题：${item.preview}`}
            onClick={(event) => {
              const tick = event.currentTarget;
              tick.classList.remove("is-clicked");
              void tick.offsetWidth;
              tick.classList.add("is-clicked");
              window.setTimeout(() => tick.classList.remove("is-clicked"), 320);
              onScrollToMessage(item.id, "auto");
            }}
          >
            <i />
            <span className="conversation-minimap-preview">
              <small><b>问</b>{item.time}</small>
              <strong>{item.preview}</strong>
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function AssistantMessageCorrections({ message, isLastAssistant, generating, proposalExecuted, autoApproved, onCorrection }) {
  const actions = onCorrection ? assistantCorrectionActions(message, { isLastAssistant, generating, proposalExecuted, autoApproved }) : [];
  if (!actions.length) return null;
  return (
    <div className="message-corrections" role="group" aria-label="这一轮不是想要的">
      <span>不是想要的？</span>
      {actions.map((action) => {
        const item = ASSISTANT_CORRECTIONS[action];
        return <button key={action} type="button" onClick={() => onCorrection(action)}><i className={`bi ${item.icon}`} aria-hidden="true" />{item.label}</button>;
      })}
    </div>
  );
}

// 回复下面的追问建议（最多 3 条）。旧回复只有一条 nextPrompt。
function assistantFollowUps(message) {
  const list = Array.isArray(message?.followUps) && message.followUps.length ? message.followUps : message?.nextPrompt ? [message.nextPrompt] : [];
  return [...new Set(list.map((item) => String(item || "").trim()).filter(Boolean))].slice(0, 3);
}

function AssistantFollowUps({ items, agent, onPick }) {
  if (!items.length) return null;
  return (
    <div className="assistant-followups" role="group" aria-label="追问建议">
      <span className="assistant-followups-label">{agent ? "下一步" : "接着问"}</span>
      {items.map((item) => (
        <button key={item} type="button" title="点击直接发送" onClick={() => onPick(item)}>
          <span>{item}</span>
          <i className="bi bi-arrow-up-right" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function AssistantMessageRow({ message: liveMessage, editSources = [], turnId, showDate, expanded, copied, generating, feedbackBusy, isLastAssistant, isLastUser, editing, editingDraft, moreOpen, loadedImages, failedImages, imageRetryVersions, imageModels, sourceProposal, proposalExecuted, attachedReferences, autoApprove = false, autoApproveBudgetCents = 0, autoApproved = false, searchHit = false, searchCurrent = false, searchQuery = "", toolActionBusyId = "", maxMessageCharacters = MAX_ASSISTANT_MESSAGE_CHARACTERS, onToolAction, onToggleStatus, onCopy, onFeedback, onQuote, onOpenImage, onImageLoad, onImageError, onImageRetry, onUseReference, onStartEdit, onEditDraft, onCancelEdit, onSubmitEdit, onRetry, onToggleMore, onDownloadMarkdown, onDelete, onProposalChange, onProposalDismiss, onProposalRestore, onProposalApprove, onReopenProposal, onCorrection, onFollowUp, onEditPrompt, onGenerateMissing, askFeedbackReasons = false, onFeedbackReasons, onDismissFeedbackReasons }) {
  // 重新生成过的回复可以切回之前的版本看；新版本到来时回到最新一版。
  const versions = liveMessage.role === "assistant" ? assistantMessageVersions(liveMessage) : [];
  const [versionIndex, setVersionIndex] = useState(-1);
  useEffect(() => { setVersionIndex(-1); }, [liveMessage.id, versions.length]);
  const message = versionIndex >= 0 && versions[versionIndex] ? assistantMessageVersion(liveMessage, versions[versionIndex]) : liveMessage;
  const versionTotal = versions.length + 1;
  const versionNumber = versionIndex >= 0 ? versionIndex + 1 : versionTotal;
  const showVersion = (number) => setVersionIndex(number >= versionTotal ? -1 : number - 1);
  const status = message.role === "assistant" ? messageStatus(message) : null;
  const contextUsage = normalizeAssistantContext(message.context);
  const usage = normalizeAssistantUsage(message);
  const imageModelLabel = assistantModelLabel(message.model, imageModels);
  const showImageStage = message.pending && message.kind === "image";
  const userReferenceImages = message.role === "user" ? uniqueReferenceImages(message.referenceImages) : [];
  const userBubbleEmpty = message.role === "user" && !message.content && !message.error;
  const errorKind = message.role === "assistant" && !message.pending ? assistantErrorKind(message) : null;
  return (
    <div className="message-turn">
      {showDate && formatMessageDate(message.createdAt) ? (
        <h2 className="message-date-divider">
          <time dateTime={messageDateTime(message.createdAt)}>{formatMessageDate(message.createdAt)}</time>
        </h2>
      ) : null}
      {message.kind === "context-divider" ? <div className="assistant-context-divider"><span /><p><i className="bi bi-eraser" aria-hidden="true" /> 已从这里开始新的上下文</p><span /></div> : <article className={`message message--${message.role}${searchHit ? " is-search-hit" : ""}${searchCurrent ? " is-search-current" : ""}`} data-message-id={message.id} data-turn-id={turnId || undefined}>
        {status && !showImageStage ? <AssistantMessageStatus message={message} status={status} contextUsage={contextUsage} expanded={expanded} onToggle={onToggleStatus} hideErrorDetail={Boolean(errorKind)} /> : null}
        {message.role === "user" && (message.quoted || userReferenceImages.length > 0 || message.attachments?.length > 0) ? <div className="user-message-context">
          {message.quoted && <div className="sent-quote"><i className="bi bi-reply" aria-hidden="true" /><span><b>{message.quoted.kind}</b>{message.quoted.content}</span></div>}
          {userReferenceImages.length > 0 && <div className="sent-reference-images">{userReferenceImages.map((image, index, images) => <button key={image.id || image.fileKey || index} type="button" title="查看参考图" onClick={() => onOpenImage(image, index, images)}><AssistantPreviewImage image={image} alt={image.name || "参考图"} /></button>)}</div>}
          {message.attachments?.length > 0 && <div className="assistant-document-chips">{message.attachments.map((item) => <span key={item.id} className="assistant-document-chip"><i className={`bi ${documentIcon(item)}`} /><span><strong>{item.name}</strong><small>{formatDocumentSize(item.sizeBytes)} · {item.pageCount ? `${item.pageCount} 页` : "文档"}</small></span></span>)}</div>}
        </div> : null}
        {message.role === "user" && !editing && <div className="user-message-actions" aria-label="用户消息操作"><button type="button" title={copied ? "已复制" : "复制问题"} aria-label={copied ? "已复制" : "复制问题"} className={copied ? "is-copied" : ""} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button>{isLastUser && <button type="button" title="编辑问题" aria-label="编辑问题" disabled={generating} onClick={() => onStartEdit(message)}><i className="bi bi-pencil" /></button>}{isLastUser && <button type="button" title="重试" aria-label="重试" disabled={generating} onClick={() => onRetry(liveMessage)}><RegenerateIcon /></button>}</div>}
        {message.role === "user" && editing ? <div className="user-message-editor"><textarea autoFocus rows={3} aria-label="编辑问题" value={editingDraft} onChange={(event) => onEditDraft(event.target.value)} maxLength={maxMessageCharacters} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmitEdit(message); } }} /><footer><span>{assistantCharacterCount(editingDraft.trim()).toLocaleString("zh-CN")} / {maxMessageCharacters.toLocaleString("zh-CN")}</span><button type="button" onClick={onCancelEdit}>取消</button><button className="is-primary" type="button" disabled={!editingDraft.trim() || assistantCharacterCount(editingDraft.trim()) > maxMessageCharacters || generating} onClick={() => onSubmitEdit(message)}><i className="bi bi-arrow-up" /><span>发送</span></button></footer></div> : userBubbleEmpty ? null : <div className={`message-content${message.error ? " has-error" : ""}`}>
          {showImageStage ? <ImageGenerationStage message={message} imageModelLabel={imageModelLabel} imageModels={imageModels} loadedImages={loadedImages} onOpenImage={onOpenImage} onImageLoad={onImageLoad} /> : <>
            {message.role === "assistant" && <AssistantPlan steps={message.plan} />}
            {message.role === "assistant" && message.kind === "proposal" && message.proposal && <AgentProposal message={message} imageModels={imageModels} generating={generating} executed={proposalExecuted} attachedReferences={attachedReferences} autoApprove={autoApprove} autoApproveBudgetCents={autoApproveBudgetCents} autoApproved={autoApproved} maxMessageCharacters={maxMessageCharacters} onChange={onProposalChange} onDismiss={onProposalDismiss} onRestore={onProposalRestore} onApprove={onProposalApprove} onOpenImage={onOpenImage} />}
            {message.role === "assistant" && message.kind !== "proposal" && message.content && message.content !== message.error ? <AssistantMarkdown content={message.content} streaming={message.pending} highlightQuery={searchHit ? searchQuery : ""} sources={assistantWebSources(message.webSearches)} /> : message.role !== "assistant" && message.content && message.content !== message.error ? <p>{searchHit ? highlightSearchNodes(message.content, searchQuery) : message.content}</p> : null}
            {message.role === "assistant" && <AssistantDataViews views={message.dataViews} messageId={message.id} />}
            {errorKind ? <AssistantErrorCard error={errorKind} canRetry={isLastAssistant && !generating} onRetry={() => onRetry(liveMessage)} onEditPrompt={isLastAssistant && !generating ? onEditPrompt : undefined} /> : null}
            {message.role === "assistant" && message.proactive ? <AssistantProactiveNote kind={message.proactive} /> : null}
            {message.role === "assistant" && <AssistantWebSources searches={message.webSearches} />}
            {message.role === "assistant" && <AssistantArtifacts items={message.artifacts} />}
            {message.role === "assistant" && <AssistantToolActions actions={message.toolActions} busyId={toolActionBusyId} onExecute={(action) => onToolAction?.(message, action)} />}
            {message.role === "assistant" ? <AssistantVideoResults videos={message.videos} /> : null}
            {message.images?.length > 0 && <GeneratedImageGrid message={message} editSources={message.isEarlierVersion ? [] : editSources} imageModels={imageModels} loadedImages={loadedImages} failedImages={failedImages} imageRetryVersions={imageRetryVersions} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageError={onImageError} onImageRetry={onImageRetry} onUseReference={onUseReference} canGenerateMissing={isLastAssistant && !generating && !message.isEarlierVersion} onGenerateMissing={onGenerateMissing} />}
          </>}
        </div>}
        {message.role === "assistant" && !message.pending && <><p className="message-meta">以上内容由 AI 生成{usage?.durationMs ? <b className="message-meta-duration">{formatDurationMs(usage.durationMs)}</b> : null}</p><div className="message-actions">{sourceProposal && <button className="source-proposal-button" type="button" title="回到生成这组图片的方案" onClick={onReopenProposal}><i className="bi bi-sliders" /><span>编辑方案</span></button>}{versions.length ? <span className="message-version-switch" role="group" aria-label="回复版本"><button type="button" title="上一版" aria-label="上一版" disabled={versionNumber <= 1} onClick={() => showVersion(versionNumber - 1)}><i className="bi bi-chevron-left" /></button><span aria-live="polite">{versionNumber}/{versionTotal}</span><button type="button" title="下一版" aria-label="下一版" disabled={versionNumber >= versionTotal} onClick={() => showVersion(versionNumber + 1)}><i className="bi bi-chevron-right" /></button></span> : null}<button className="regenerate-button" type="button" title="重新生成" disabled={generating || !isLastAssistant} onClick={() => onRetry(liveMessage)}><RegenerateIcon /><span>重新生成</span></button><button className={`copy-message-button${copied ? " is-copied" : ""}`} type="button" title={copied ? "已复制" : "复制回复"} aria-label={copied ? "已复制" : "复制回复"} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button><AssistantMessageFeedbackActions message={message} busy={feedbackBusy} onFeedback={onFeedback} /><button type="button" title="引用" aria-label="引用" onClick={() => onQuote(message)}><i className="bi bi-quote" /></button><button type="button" title="更多操作" aria-label="更多操作" onClick={(event) => { event.stopPropagation(); onToggleMore(message.id); }}><i className="bi bi-three-dots" /></button>{moreOpen && <div className="message-more-menu" onClick={(event) => event.stopPropagation()}>{message.kind !== "image" && <button type="button" onClick={() => onDownloadMarkdown(message)}><i className="bi bi-filetype-md" /><span>下载 Markdown</span></button>}<button className="is-danger" type="button" onClick={() => onDelete(message.id)}><i className="bi bi-trash3" /><span>删除</span></button></div>}</div>{askFeedbackReasons && message.feedback === "negative" && onFeedbackReasons ? <AssistantFeedbackReasons message={message} onSubmit={onFeedbackReasons} onDone={onDismissFeedbackReasons} /> : null}<AssistantMessageCorrections message={message} isLastAssistant={isLastAssistant} generating={generating} proposalExecuted={proposalExecuted} autoApproved={autoApproved} onCorrection={onCorrection} />{onFollowUp && isLastAssistant && !generating && message.status === "complete" ? <AssistantFollowUps items={assistantFollowUps(message)} agent={message.requestedMode === "agent"} onPick={onFollowUp} /> : null}</>}
      </article>}
    </div>
  );
}

export {
  AssistantFollowUpQueue,
  AssistantMessageRow,
  ConversationMinimap,
  closestNavigatorTurn,
};
