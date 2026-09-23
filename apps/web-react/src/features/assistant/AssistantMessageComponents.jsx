import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { formatMessageDate, generatedImageRatioLabel, messageDateTime, messageStatus, uid } from "./domain/assistantMessages.js";
import { assistantToolStepDetail, normalizeAssistantPlan, normalizeAssistantToolSteps } from "./domain/assistantToolSteps.js";
import { promptNeedsRecentVisual } from "./domain/visualContext.js";
import { assistantImageBatchLimit } from "./domain/assistantImageLimits.js";
import {
  clampImageCount,
  getModelAspectRatiosForResolution,
  imageCountOptions,
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


function GeneratedImageGrid({ message, imageModels, loadedImages, failedImages, imageRetryVersions, onOpenImage, onImageLoad, onImageError, onImageRetry, onUseReference }) {
  const meta = { ...imageGenerationMeta(message, imageModels), messageId: message.id, runId: message.runId || "", model: message.model || "", requestRatio: message.requestRatio || message.ratio || "", requestSize: message.requestSize || "", width: message.width, height: message.height, quality: message.quality || "", pending: Boolean(message.pending) };
  const imagePlanItems = Array.isArray(message.imagePlanItems) ? message.imagePlanItems : [];
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
    <div className={`generated-images${message.images.length === 1 ? " is-single" : ""}${message.images.length > 2 ? " is-many" : ""}`} style={{ "--generated-ratio": imageRatioValue(message), "--image-slot-count": message.images.length }}>
      {message.images.map((image, index) => {
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
              <button className="generated-image-preview" type="button" onClick={() => onOpenImage(image, index, message.images, meta)}>
                <AssistantPreviewImage image={image} src={retryableImageUrl(imageThumbUrl(image), imageRetryVersions[key])} alt={image.revisedPrompt || "AI 生成图片"} loading="lazy" onLoad={() => onImageLoad(message.id, index)} onError={() => onImageError(message.id, index)} />
                <i className="tile-sheen" aria-hidden="true" />
              </button>
            )}
            {loaded && !failed && !deleted && ratioLabel ? <span className="generated-image-ratio">{ratioLabel}</span> : null}
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
    </div>
  );
}


function normalizeReasoningText(text) {
  return String(text || "")
    .replace(/\*\*\s*\*\*/g, "**\n\n**")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function AssistantReasoningToggle({ text, pending, open, onToggle }) {
  if (!text) return null;
  return (
    <button
      type="button"
      className={`message-reasoning-toggle${pending ? " is-live" : ""}`}
      aria-expanded={open}
      aria-label={pending ? "在想" : "思考"}
      onClick={onToggle}
    >
      {pending ? <i className="reasoning-pulse" aria-hidden="true" /> : null}
      <span>{pending ? "在想" : "思考"}</span>
      <i className={`bi bi-chevron-down${open ? " is-open" : ""}`} aria-hidden="true" />
    </button>
  );
}

function AssistantMarkdown({ content, streaming, highlightQuery = "" }) {
  const rootRef = useRef(null);
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

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || streaming) return;
    applyThreadSearchMarks(root, highlightQuery);
  }, [content, highlightQuery, streaming]);

  useEffect(() => () => stopStream(), []);

  const handleClick = async (event) => {
    const button = event.target.closest("[data-copy-code]");
    const block = button?.closest(".assistant-code");
    const code = block?.dataset.code ?? block?.querySelector(".assistant-code-raw")?.value;
    if (!button || code == null) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const area = document.createElement("textarea");
      area.value = code;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.append(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
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

  return <div ref={rootRef} className={`assistant-markdown${streaming ? " is-streaming" : ""}`} onClick={(event) => void handleClick(event)} />;
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

function AssistantPlan({ steps }) {
  const items = useMemo(() => normalizeAssistantPlan(steps), [steps]);
  if (!items.length) return null;
  const completed = items.filter((step) => step.status === "completed").length;
  return (
    <section className="assistant-plan" aria-label="执行计划">
      <header>
        <i className="bi bi-list-check" aria-hidden="true" />
        <strong>执行计划</strong>
        <small>{completed} / {items.length}</small>
      </header>
      <ol>
        {items.map((step, index) => (
          <li key={`${index}-${step.title}`} className={`is-${step.status}`}>
            <span className="assistant-plan-mark" aria-label={PLAN_STATE_LABELS[step.status]}>
              {step.status === "completed" ? <i className="bi bi-check2" aria-hidden="true" /> : null}
              {step.status === "in_progress" ? <i className="bi bi-arrow-repeat assistant-tool-spin" aria-hidden="true" /> : null}
            </span>
            <span>{step.title}</span>
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
            <article className="assistant-tool-card is-image-results" key={action.id || actionIndex}>
              <header><span><i className="bi bi-images" /></span><div><strong>{action.title || "图片搜索结果"}</strong><small>{action.description}</small></div></header>
              <div className="assistant-tool-image-grid">
                {results.map((image, index) => (
                  <a key={image.id || image.sourceUrl || index} href={image.sourceUrl || image.imageUrl} target="_blank" rel="noreferrer" title="查看原始来源与授权">
                    <img src={image.thumbnailUrl || image.imageUrl} alt={image.title || `搜索结果 ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" />
                    <span><strong>{image.title || `图片 ${index + 1}`}</strong><small>{[image.license, image.creator].filter(Boolean).join(" · ") || "查看授权"}</small></span>
                  </a>
                ))}
              </div>
            </article>
          );
        }
        return (
          <article className={`assistant-tool-card is-${String(action.kind || "action")}`} key={action.id || actionIndex}>
            {action.previewUrl ? <a className="assistant-tool-preview" href={action.targetUrl || action.previewUrl} target="_blank" rel="noreferrer"><img src={action.previewUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /></a> : null}
            <div className="assistant-tool-card-copy">
              <span className="assistant-tool-card-icon"><i className={`bi ${action.kind === "download" ? "bi-file-earmark-zip" : action.kind === "webpage_capture" ? "bi-window-fullscreen" : action.kind === "product_import" ? "bi-bag-plus" : action.kind === "navigate" ? "bi-compass" : "bi-arrow-left-right"}`} /></span>
              <span><strong>{action.title || "AI 工具"}</strong><small>{action.description || "操作已准备"}</small></span>
            </div>
            <button type="button" disabled={busy} onClick={() => onExecute?.(action)}>
              {busy ? <i className="bi bi-arrow-repeat assistant-tool-spin" /> : action.kind === "download" ? <DownloadIcon /> : <i className="bi bi-arrow-right" />}
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
  const counts = selectedModel && assistantImageBatchLimit(selectedModel) > 0 ? imageCountOptions(selectedModel) : [];
  const referenceMode = proposalReferenceMode(proposal, referenceImages);
  const individualReferences = !independentPlan && referenceMode === "individual" && referenceImages.length > 0;
  const proposalCount = independentPlan ? planItems.length : individualReferences ? referenceImages.length : frozenProposal ? Math.max(1, Number(proposal.count) || 1) : clampImageCount(proposal.count || 1, selectedModel, 1);
  const busy = Boolean(proposal.submitting);
  const toggleMenu = (id) => setOpenMenu((current) => current === id ? "" : id);
  const promptMode = proposal.promptMode === "faithful" ? "faithful" : "enhanced";
  const referenceLabels = new Map(referenceImages.map((image, index) => [referenceImageIdentity(image), `图${index + 1}`]));
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
        items: planItems.map((item) => item.id === promptEditor.itemId ? { ...item, prompt: trimmed } : item),
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
                  onClick={() => { setOpenMenu(""); setPromptEditor({ itemId: item.id, title: item.title, value: item.prompt }); }}
                >
                  <span>{item.prompt}</span>
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
          <button type="button" className="is-secondary" disabled={busy} onClick={onDismiss}>收起</button>
          <button type="button" className="is-primary" disabled={busy || generating || !validPlan || (!independentPlan && !String(proposal.prompt || "").trim())} onClick={() => void onApprove?.()}>
            {busy ? <i className="bi bi-arrow-repeat" aria-hidden="true" /> : null}
            <span>{busy ? "正在提交" : executed ? "再生成一组" : "开始生成"}</span>
          </button>
        </footer>
      </div>
      </div>
    </div>
  );
}

function formatDebugOffset(ms) {
  const value = Math.max(0, Number(ms) || 0);
  if (value < 100) return `+${Math.round(value)}ms`;
  if (value < 10_000) return `+${(value / 1000).toFixed(1).replace(/\.0$/, "")}s`;
  return `+${Math.round(value / 1000)}s`;
}

function debugSpanElapsedMs(item, fallbackOrigin) {
  if (item && Number.isFinite(Number(item.elapsedMs))) return Math.max(0, Number(item.elapsedMs));
  return Math.max(0, (Number(item?.at) || 0) - fallbackOrigin);
}

function AssistantDebugPanel({ items, startedAt, open }) {
  const traces = Array.isArray(items) ? items : [];
  if (!open || !traces.length) return null;
  const origin = Number(startedAt) || Number(traces[0]?.at) || Date.now();
  return (
    <ol className="assistant-debug-trace" aria-label="思考流程">
      {traces.map((item, index) => {
        const elapsed = debugSpanElapsedMs(item, origin);
        const previous = index ? debugSpanElapsedMs(traces[index - 1], origin) : 0;
        const gapMs = elapsed - previous;
        const gap = gapMs >= 80 ? formatDurationMs(gapMs) : "";
        return (
          <li key={`${item.step}-${item.at}-${index}`} className={gapMs >= 3000 ? "is-slow" : undefined}>
            <time>{formatDebugOffset(elapsed)}</time>
            <span>{item.detail || item.step}</span>
            {gap ? <b>{gap}</b> : null}
          </li>
        );
      })}
    </ol>
  );
}

function AssistantMessageStatus({ message, status, contextUsage, expanded, onToggle }) {
  const pending = Boolean(message.pending);
  const progress = Math.min(92, Math.max(Number(status.progress) || 12, 12));
  const ring = 2 * Math.PI * 7;
  const usage = normalizeAssistantUsage(message);
  const elapsedMs = useElapsedMs(usageStartedAtMs(message), pending);
  const reasoning = normalizeReasoningText(message.reasoning);
  const reasoningHtml = useMemo(() => (reasoning ? renderAssistantMarkdownHtml(reasoning, { streaming: false }) : ""), [reasoning]);
  const [reasoningOpen, setReasoningOpen] = useState(Boolean(pending && reasoning));
  const toolItems = useMemo(() => normalizeAssistantToolSteps(message.toolSteps), [message.toolSteps]);
  const debugItems = Array.isArray(message.debugTrace) ? message.debugTrace : [];
  const [toolsOpen, setToolsOpen] = useState(Boolean(pending && toolItems.length));
  const [debugOpen, setDebugOpen] = useState(Boolean(pending));
  useEffect(() => {
    setReasoningOpen(Boolean(pending && reasoning));
  }, [pending, reasoning]);
  useEffect(() => {
    setToolsOpen(Boolean(pending && toolItems.length));
  }, [pending, toolItems.length]);
  useEffect(() => {
    if (pending && debugItems.length) setDebugOpen(true);
  }, [pending, debugItems.length]);
  const metrics = [];
  if (usage?.outputTokens) metrics.push({ key: "out", title: "输出 token", text: formatContextTokens(usage.outputTokens) });
  if (usage?.inputTokens) metrics.push({ key: "in", title: "输入 token", text: formatContextTokens(usage.inputTokens) });
  if (usage?.firstTokenMs) metrics.push({ key: "ttft", title: "首字耗时", text: formatDurationMs(usage.firstTokenMs) });
  return (
    <div className={`assistant-message-label is-${status.tone}${pending ? " is-live" : ""}${reasoning ? " has-reasoning" : ""}`}>
      <div className="message-status-row">
        {pending ? (
          <div className="message-status-toggle" role="status">
            <span className="message-status-spinner" aria-hidden="true">
              <svg viewBox="0 0 18 18">
                <circle className="is-track" cx="9" cy="9" r="7" />
                <circle className="is-value" cx="9" cy="9" r="7" strokeDasharray={ring} strokeDashoffset={ring * (1 - progress / 100)} />
              </svg>
            </span>
            <strong aria-live="polite"><span>{status.label}</span></strong>
          </div>
        ) : (
          <button type="button" className="message-status-toggle" aria-expanded={expanded} onClick={() => onToggle(message.id)}>
            <span className="message-status-indicator" aria-hidden="true"><i /></span>
            <strong aria-live="polite"><span>{status.label}</span></strong>
            <i className={`bi bi-chevron-down message-status-chevron${expanded ? " is-expanded" : ""}`} aria-hidden="true" />
          </button>
        )}
        {pending && usageStartedAtMs(message) ? <b className="message-status-metrics" aria-label="已用时">{formatElapsedClock(elapsedMs)}</b> : null}
        {!pending && metrics.length ? (
          <b className="message-status-metrics">
            {metrics.map((item, index) => (
              <Fragment key={item.key}>
                {index ? <i aria-hidden="true" /> : null}
                <span title={item.title}>{item.text}</span>
              </Fragment>
            ))}
          </b>
        ) : null}
        <div className="message-status-extras">
          <AssistantReasoningToggle text={reasoning} pending={pending} open={reasoningOpen} onToggle={() => setReasoningOpen((open) => !open)} />
          {toolItems.length ? (
            <button
              type="button"
              className={`message-reasoning-toggle${pending ? " is-live" : ""}`}
              aria-expanded={toolsOpen}
              aria-label="过程"
              onClick={() => setToolsOpen((open) => !open)}
            >
              <span>过程 {toolItems.length}</span>
              <i className={`bi bi-chevron-down${toolsOpen ? " is-open" : ""}`} aria-hidden="true" />
            </button>
          ) : null}
          {debugItems.length ? (
            <button
              type="button"
              className={`message-reasoning-toggle${pending ? " is-live" : ""}`}
              aria-expanded={debugOpen}
              aria-label="流程"
              onClick={() => setDebugOpen((open) => !open)}
            >
              <span>流程 {debugItems.length}</span>
              <i className={`bi bi-chevron-down${debugOpen ? " is-open" : ""}`} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>
      {reasoningOpen && reasoningHtml ? <div className="assistant-reasoning-body" dangerouslySetInnerHTML={{ __html: reasoningHtml }} /> : null}
      <AssistantDebugPanel items={debugItems} startedAt={usageStartedAtMs(message)} open={debugOpen} />
      <AssistantToolTimeline steps={message.toolSteps} pending={pending} expanded={toolsOpen} />
      {!pending && expanded ? (
        <div className="message-status-detail">
          <p>{contextUsage ? "本轮实际送进模型的上下文如下。当前问题和正在生成的回复不计入条数。" : status.detail}</p>
          {contextUsage ? (
            <div className="message-context-stats">
              <div className="message-context-stat"><b>{contextUsage.usagePercent}%</b><em>上下文</em><small>{formatContextTokens(contextUsage.estimatedInputTokens)} / {formatContextTokens(contextUsage.inputBudgetTokens)}</small></div>
              <div className="message-context-stat"><b>{contextUsage.includedMessages}</b>{" "}<em>条近期消息</em></div>
              {Number(contextUsage.totalMessages) > contextUsage.includedMessages ? <div className="message-context-stat"><b>{contextUsage.totalMessages}</b><em>条对话总计</em></div> : null}
              {contextUsage.compactedMessages > 0 ? <div className="message-context-stat"><b>{contextUsage.compactedMessages}</b>{" "}<em>条已压缩</em></div> : null}
              {contextUsage.omittedMessages > 0 ? <div className="message-context-stat"><b>{contextUsage.omittedMessages}</b><em>条未纳入</em></div> : null}
              {Number(contextUsage.droppedMessages) > 0 ? <div className="message-context-stat"><b>{contextUsage.droppedMessages}</b><em>条已丢弃</em></div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
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
  return (
    <div className="image-generation-stage">
      <div className="image-generation-summary">
        <strong>{message.prompt || "正在生成图片"}</strong>
        <span title={imageModelLabel}>{imageModelLabel}</span>
        {stageParameters.map((value) => <Fragment key={value}><i /><span>{value}</span></Fragment>)}
      </div>
      <div className={`image-dream-grid${Number(message.count || 2) === 1 ? " is-single" : ""}${Number(message.count || 2) > 2 ? " is-many" : ""}`} style={{ "--image-skeleton-ratio": imageRatioValue(message), "--image-slot-count": Number(message.count || 2) }}>
        {Array.from({ length: Number(message.count || 2) }, (_, index) => {
          const image = message.images?.[index];
          const loaded = Boolean(image && loadedImages.has(`${message.id}-${index}`));
          return (
            <div key={index} className={`image-dream-slot${image ? " is-ready" : ""}${loaded ? " is-loaded" : ""}`}>
              {image && (
                <button className="image-dream-preview" type="button" title="查看大图" onClick={() => onOpenImage(image, index, message.images, previewMeta)}>
                  <AssistantPreviewImage image={image} alt={image.revisedPrompt || "AI 生成图片"} loading="lazy" onLoad={() => onImageLoad(message.id, index)} />
                </button>
              )}
              {(!image || !loaded) && <i className="dream-slot-spinner" aria-hidden="true" />}
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

function AssistantWebSources({ searches }) {
  const sources = assistantWebSources(searches);
  if (!sources.length) return null;
  return (
    <section className="assistant-web-sources" aria-label="联网来源">
      <header><i className="bi bi-globe2" aria-hidden="true" /><strong>联网来源</strong><span>{sources.length}</span></header>
      <div>
        {sources.map((source, index) => (
          <a key={source.url} href={source.url} target="_blank" rel="noreferrer" title={source.title}>
            <b>{index + 1}</b><span><strong>{source.title}</strong><small>{source.host}</small></span><i className="bi bi-box-arrow-up-right" aria-hidden="true" />
          </a>
        ))}
      </div>
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

function AssistantMessageRow({ message, turnId, showDate, expanded, copied, generating, feedbackBusy, isLastAssistant, isLastUser, editing, editingDraft, moreOpen, loadedImages, failedImages, imageRetryVersions, imageModels, sourceProposal, proposalExecuted, attachedReferences, autoApprove = false, autoApproveBudgetCents = 0, autoApproved = false, searchHit = false, searchCurrent = false, searchQuery = "", toolActionBusyId = "", maxMessageCharacters = MAX_ASSISTANT_MESSAGE_CHARACTERS, onToolAction, onToggleStatus, onCopy, onFeedback, onQuote, onOpenImage, onImageLoad, onImageError, onImageRetry, onUseReference, onStartEdit, onEditDraft, onCancelEdit, onSubmitEdit, onRetry, onToggleMore, onDownloadMarkdown, onDelete, onProposalChange, onProposalDismiss, onProposalRestore, onProposalApprove, onReopenProposal }) {
  const status = message.role === "assistant" ? messageStatus(message) : null;
  const contextUsage = normalizeAssistantContext(message.context);
  const usage = normalizeAssistantUsage(message);
  const imageModelLabel = assistantModelLabel(message.model, imageModels);
  const showImageStage = message.pending && message.kind === "image";
  return (
    <div className="message-turn">
      {showDate && formatMessageDate(message.createdAt) ? (
        <h2 className="message-date-divider">
          <time dateTime={messageDateTime(message.createdAt)}>{formatMessageDate(message.createdAt)}</time>
        </h2>
      ) : null}
      {message.kind === "context-divider" ? <div className="assistant-context-divider"><span /><p><i className="bi bi-eraser" aria-hidden="true" /> 已从这里开始新的上下文</p><span /></div> : <article className={`message message--${message.role}${searchHit ? " is-search-hit" : ""}${searchCurrent ? " is-search-current" : ""}`} data-message-id={message.id} data-turn-id={turnId || undefined}>
        {status && !showImageStage ? <AssistantMessageStatus message={message} status={status} contextUsage={contextUsage} expanded={expanded} onToggle={onToggleStatus} /> : null}
        {message.role === "user" && !editing && <div className="user-message-actions" aria-label="用户消息操作"><button type="button" title={copied ? "已复制" : "复制问题"} aria-label={copied ? "已复制" : "复制问题"} className={copied ? "is-copied" : ""} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button>{isLastUser && <button type="button" title="编辑问题" aria-label="编辑问题" disabled={generating} onClick={() => onStartEdit(message)}><i className="bi bi-pencil" /></button>}{isLastUser && <button type="button" title="重试" aria-label="重试" disabled={generating} onClick={() => onRetry(message)}><RegenerateIcon /></button>}</div>}
        {message.role === "user" && editing ? <div className="user-message-editor"><textarea autoFocus rows={3} aria-label="编辑问题" value={editingDraft} onChange={(event) => onEditDraft(event.target.value)} maxLength={maxMessageCharacters} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); onSubmitEdit(message); } }} /><footer><span>{assistantCharacterCount(editingDraft.trim()).toLocaleString("zh-CN")} / {maxMessageCharacters.toLocaleString("zh-CN")}</span><button type="button" onClick={onCancelEdit}>取消</button><button className="is-primary" type="button" disabled={!editingDraft.trim() || assistantCharacterCount(editingDraft.trim()) > maxMessageCharacters || generating} onClick={() => onSubmitEdit(message)}><i className="bi bi-arrow-up" /><span>发送</span></button></footer></div> : <div className={`message-content${message.error ? " has-error" : ""}`}>
          {showImageStage ? <ImageGenerationStage message={message} imageModelLabel={imageModelLabel} imageModels={imageModels} loadedImages={loadedImages} onOpenImage={onOpenImage} onImageLoad={onImageLoad} /> : <>
            {message.role === "user" && message.quoted && <div className="sent-quote"><i className="bi bi-quote" /><span>[{message.quoted.kind}] {message.quoted.content}</span></div>}
            {message.role === "user" && uniqueReferenceImages(message.referenceImages).length > 0 && <div className="sent-reference-images">{uniqueReferenceImages(message.referenceImages).map((image, index, images) => <button key={image.id || image.fileKey || index} type="button" title="查看参考图" onClick={() => onOpenImage(image, index, images)}><AssistantPreviewImage image={image} alt={image.name || "参考图"} /></button>)}</div>}
            {message.role === "user" && message.attachments?.length > 0 && <div className="assistant-document-chips">{message.attachments.map((item) => <span key={item.id} className="assistant-document-chip"><i className={`bi ${documentIcon(item)}`} /><span><strong>{item.name}</strong><small>{formatDocumentSize(item.sizeBytes)} · {item.pageCount ? `${item.pageCount} 页` : "文档"}</small></span></span>)}</div>}
            {message.role === "assistant" && <AssistantPlan steps={message.plan} />}
            {message.role === "assistant" && message.kind === "proposal" && message.proposal && <AgentProposal message={message} imageModels={imageModels} generating={generating} executed={proposalExecuted} attachedReferences={attachedReferences} autoApprove={autoApprove} autoApproveBudgetCents={autoApproveBudgetCents} autoApproved={autoApproved} maxMessageCharacters={maxMessageCharacters} onChange={onProposalChange} onDismiss={onProposalDismiss} onRestore={onProposalRestore} onApprove={onProposalApprove} onOpenImage={onOpenImage} />}
            {message.role === "assistant" && message.kind !== "proposal" && message.content && message.content !== message.error ? <AssistantMarkdown content={message.content} streaming={message.pending} highlightQuery={searchHit ? searchQuery : ""} /> : message.role !== "assistant" && message.content && message.content !== message.error ? <p>{searchHit ? highlightSearchNodes(message.content, searchQuery) : message.content}</p> : null}
            {message.role === "assistant" && <AssistantWebSources searches={message.webSearches} />}
            {message.role === "assistant" && <AssistantArtifacts items={message.artifacts} />}
            {message.role === "assistant" && <AssistantToolActions actions={message.toolActions} busyId={toolActionBusyId} onExecute={(action) => onToolAction?.(message, action)} />}
            {message.images?.length > 0 && <GeneratedImageGrid message={message} imageModels={imageModels} loadedImages={loadedImages} failedImages={failedImages} imageRetryVersions={imageRetryVersions} onOpenImage={onOpenImage} onImageLoad={onImageLoad} onImageError={onImageError} onImageRetry={onImageRetry} onUseReference={onUseReference} />}
          </>}
        </div>}
        {message.role === "assistant" && !message.pending && <><p className="message-meta">以上内容由 AI 生成{usage?.durationMs ? <b className="message-meta-duration">{formatDurationMs(usage.durationMs)}</b> : null}</p><div className="message-actions">{sourceProposal && <button className="source-proposal-button" type="button" title="回到生成这组图片的方案" onClick={onReopenProposal}><i className="bi bi-sliders" /><span>编辑方案</span></button>}<button className="regenerate-button" type="button" title="重新生成" disabled={generating || !isLastAssistant} onClick={() => onRetry(message)}><RegenerateIcon /><span>重新生成</span></button><button className={`copy-message-button${copied ? " is-copied" : ""}`} type="button" title={copied ? "已复制" : "复制回复"} aria-label={copied ? "已复制" : "复制回复"} onClick={() => onCopy(message)}><i className={`bi ${copied ? "bi-check2" : "bi-copy"}`} /></button><AssistantMessageFeedbackActions message={message} busy={feedbackBusy} onFeedback={onFeedback} /><button type="button" title="引用" aria-label="引用" onClick={() => onQuote(message)}><i className="bi bi-quote" /></button><button type="button" title="更多操作" aria-label="更多操作" onClick={(event) => { event.stopPropagation(); onToggleMore(message.id); }}><i className="bi bi-three-dots" /></button>{moreOpen && <div className="message-more-menu" onClick={(event) => event.stopPropagation()}>{message.kind !== "image" && <button type="button" onClick={() => onDownloadMarkdown(message)}><i className="bi bi-filetype-md" /><span>下载 Markdown</span></button>}<button className="is-danger" type="button" onClick={() => onDelete(message.id)}><i className="bi bi-trash3" /><span>删除</span></button></div>}</div></>}
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
