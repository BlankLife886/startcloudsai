import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import "./assistant-auto-approve.css";
import { conversationTitle } from "./domain/assistantMessages.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import { DialogMotion } from "../../components/motion/DialogMotion.jsx";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import copyToClipboard from "copy-to-clipboard";
import notificationService from "@react/legacy-modules/services/notification.js";
import { AssistantImageStudio } from "./AssistantImageStudio.jsx";
import { isCatalogModelMaintenance } from "../../components/common/ModelCatalogIcon.jsx";
import {
  downloadAssistantImage,
  formatContextTokens,
  formatConversationRelativeTime,
  formatDocumentSize,
  imageThumbUrl,
  imageUrl,
  normalizeAssistantContext,
  preferenceMotionDisabled,
  sameAssetReference,
} from "./assistantWorkspaceCore.jsx";


// 文件的类型色：PDF 红、表格绿、演示橙、文档蓝、设计稿紫，其余灰。
function assetFileTone(file = {}) {
  const type = String(file.contentType || file.format || "").toLowerCase();
  if (type.includes("pdf")) return "pdf";
  if (type.includes("spreadsheet") || type.includes("csv") || type.includes("xls")) return "sheet";
  if (type.includes("presentation") || type.includes("ppt")) return "slides";
  if (type.includes("wordprocessing") || type.includes("doc")) return "doc";
  if (type.includes("photoshop") || type.includes("psd")) return "design";
  return "text";
}

function assetFileBadge(file = {}) {
  const name = String(file.label || "");
  const ext = name.includes(".") ? name.split(".").pop() : String(file.format || "");
  return (ext || "文件").slice(0, 4).toUpperCase();
}

function AssetLibraryFileRow({ file, picked, capped, blocked, onPick }) {
  const isOutput = file.source === "output";
  const title = isOutput
    ? `下载 ${file.label}`
    : picked
      ? `移除 ${file.label}`
      : blocked
        ? "图片生成模式仅支持图片附件"
        : capped
          ? "文档已达上限"
          : `添加 ${file.label} 到附件`;
  return (
    <button
      type="button"
      className={`asset-file-row${picked ? " is-picked" : ""}${capped && !picked && !isOutput ? " is-capped" : ""}${blocked && !isOutput ? " is-blocked" : ""}`}
      data-tone={assetFileTone(file)}
      aria-pressed={isOutput ? undefined : picked}
      title={title}
      onClick={() => onPick(file)}
    >
      <span className="asset-row-badge" aria-hidden="true">{assetFileBadge(file)}</span>
      <span className="asset-row-copy">
        <strong>{file.label}</strong>
        <small>
          {isOutput
            ? `${formatDocumentSize(file.sizeBytes)} · 助手生成`
            : `${formatDocumentSize(file.sizeBytes)}${file.pageCount ? ` · ${file.pageCount} 页` : ""} · 我上传的`}
        </small>
      </span>
      <span className="asset-row-action" aria-hidden="true">
        <LineIcon name={isOutput ? "download" : picked ? "check" : "plus"} size={16} />
      </span>
    </button>
  );
}

function AssetLibraryLinkRow({ link }) {
  const details = [
    link.conversationTitle,
    link.occurrences > 1 ? `出现 ${link.occurrences} 次` : "",
  ].filter(Boolean).join(" · ");
  const host = String(link.host || "").replace(/^www\./, "");
  return (
    <a className="asset-file-row asset-link-row" href={link.url} target="_blank" rel="noopener noreferrer" title={`打开 ${link.label}`} data-tone="link">
      <span className="asset-row-badge" aria-hidden="true">{(host[0] || "链").toUpperCase()}</span>
      <span className="asset-row-copy">
        <strong>{link.label}</strong>
        <small>{[String(link.label || "").replace(/^www\./, "") === host ? "" : host, details].filter(Boolean).join(" · ")}</small>
      </span>
      <span className="asset-row-action" aria-hidden="true"><LineIcon name="external" size={16} /></span>
    </a>
  );
}

function AssetLibraryTile({ asset, onPick, picked, capped, order = 0 }) {
  return (
    <button type="button" className={`${picked ? "is-picked" : ""}${capped && !picked ? " is-capped" : ""}`.trim()} aria-pressed={picked} title={picked ? `移除 ${asset.label}` : capped ? `参考图已达上限` : `添加 ${asset.label} 到参考图`} onClick={() => onPick(asset)}>
      <AssistantPreviewImage src={asset.thumbUrl || asset.dataUrl} fallbackSrc={asset.dataUrl} alt="" width="160" height="160" loading="lazy" />
      <span className="asset-image-action" aria-hidden="true">{picked && order ? <b>{order}</b> : <LineIcon name={picked ? "check" : "plus"} size={15} />}</span>
    </button>
  );
}

// 聊天气泡内的小图：优先服务端缩略图，老消息没有则回退原图

function AssistantPreviewImage({ image, src = "", fallbackSrc = "", ...props }) {
  if (image?.deleted || image?.deletedByHistory) {
    return (
      <span className="assistant-deleted-image-placeholder" role="img" aria-label="该图片已被删除">
        <i className="bi bi-image-alt" aria-hidden="true" />
        <span>{image.deletionMessage || "该图片已被删除"}</span>
      </span>
    );
  }
  const source = src || imageThumbUrl(image);
  const original = fallbackSrc || imageUrl(image);
  return (
    <AuthenticatedImage
      {...props}
      className="assistant-preview-image"
      src={source}
      fallbackSrc={original && original !== source ? original : ""}
      retryCount={3}
    />
  );
}


function AssistantImageViewer({
  value,
  messages = [],
  models = [],
  currentModel = "",
  busy = false,
  dark = false,
  onClose,
  onEdit,
  onUseReference,
  onFavorite,
  onPublish,
  onDelete,
}) {
  if (!value?.item || !imageUrl(value.item)) return null;
  const copyPrompt = async (_item, meta) => {
    const prompt = String(meta?.prompt || "").trim();
    if (!prompt) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(prompt);
      else if (!copyToClipboard(prompt)) throw new Error("复制失败");
      notificationService.success("提示词已复制");
    } catch {
      if (copyToClipboard(prompt)) notificationService.success("提示词已复制");
      else notificationService.error("复制提示词失败");
    }
  };
  const download = async (item) => {
    try {
      await downloadAssistantImage(item, Math.max(0, value.gallery?.indexOf(item) ?? 0));
    } catch (error) {
      if (!error?.downloadNotificationShown) notificationService.error(error?.message || "图片下载失败");
      // 让编辑器里的下载按钮退回原状，而不是显示“已完成”。
      throw error;
    }
  };
  return (
    <AssistantImageStudio
      value={value}
      messages={messages}
      imageModels={models}
      currentModel={currentModel}
      busy={busy}
      dark={dark}
      onClose={onClose}
      onEdit={onEdit}
      onDownload={download}
      onCopyPrompt={copyPrompt}
      onUseReference={onUseReference ? (item) => onUseReference(item) : undefined}
      onFavorite={onFavorite}
      onPublish={onPublish}
      onDelete={onDelete}
    />
  );
}


function ContextMeterIcon({ percent }) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  const radius = 5.25;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg className="assistant-context-meter-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle className="is-track" cx="8" cy="8" r={radius} />
      <circle
        className="is-value"
        cx="8"
        cy="8"
        r={radius}
        strokeDasharray={`${(value / 100) * circumference} ${circumference}`}
      />
    </svg>
  );
}

function assistantContextMeterTitle(context) {
  const usage = normalizeAssistantContext(context);
  if (!usage) return "完成一次回答后显示上下文占用";
  return `本轮估算 ${formatContextTokens(usage.estimatedInputTokens)} / ${formatContextTokens(usage.inputBudgetTokens)} tokens${usage.compactedMessages ? `，已压缩 ${usage.compactedMessages} 条消息` : ""}`;
}

function AssistantContextMeter({ context }) {
  const usage = normalizeAssistantContext(context);
  if (!usage) {
    return (
      <span className="assistant-context-meter is-empty">
        <ContextMeterIcon percent={0} />
        <strong>--</strong>
      </span>
    );
  }
  return (
    <span className={`assistant-context-meter${usage.usagePercent >= 80 ? " is-high" : usage.compactedMessages ? " is-compacted" : ""}`}>
      <ContextMeterIcon percent={usage.usagePercent} />
      <strong>{usage.usagePercent}%</strong>
    </span>
  );
}


function NewChatIcon() {
  return <span className="new-chat-icon" aria-hidden="true" />;
}


function PreferenceSegment({ className = "", columns, value, items, onChange, layout = "track" }) {
  const rootRef = useRef(null);
  const thumbRef = useRef(null);
  const readyRef = useRef(false);
  const itemKey = items.map((item) => String(item.id)).join("|");
  const isWrap = layout === "wrap";

  const syncThumb = useCallback((animate) => {
    const root = rootRef.current;
    const thumb = thumbRef.current;
    const active = root?.querySelector("button.active");
    if (!root || !thumb || !active) return;
    const rootBox = root.getBoundingClientRect();
    const box = active.getBoundingClientRect();
    const shouldAnimate = animate && readyRef.current && !preferenceMotionDisabled();
    thumb.style.transition = shouldAnimate ? "" : "none";
    thumb.style.width = `${Math.round(box.width)}px`;
    thumb.style.height = `${Math.round(box.height)}px`;
    thumb.style.transform = `translate3d(${Math.round(box.left - rootBox.left)}px, ${Math.round(box.top - rootBox.top)}px, 0)`;
    thumb.style.opacity = "1";
    root.classList.add("is-ready");
    readyRef.current = true;
  }, []);

  useLayoutEffect(() => {
    readyRef.current = false;
    syncThumb(false);
  }, [columns, itemKey, layout, syncThumb]);

  useLayoutEffect(() => {
    syncThumb(true);
  }, [syncThumb, value]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => syncThumb(false));
    observer.observe(root);
    return () => observer.disconnect();
  }, [syncThumb]);

  return (
    <div
      ref={rootRef}
      className={`preferences-seg ${isWrap ? "is-wrap" : "is-track"} ${className}`.trim()}
      style={columns != null ? { "--assistant-option-columns": columns } : undefined}
    >
      {isWrap ? null : <span className="pref-thumb" ref={thumbRef} aria-hidden="true" />}
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={value === item.id ? "active" : ""}
          aria-pressed={value === item.id}
          onPointerDown={(event) => {
            event.preventDefault();
            onChange(item.id);
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function ModelMenuPrice({ model, perImage, unitSuffix }) {
  if (isCatalogModelMaintenance(model)) return null;
  const price = resolveModelPointPricing(model);
  if (!price.configured) return <span className="model-menu-price is-empty">未定价</span>;
  const suffix = unitSuffix ?? (perImage ? "/张" : "");
  if (price.hasDiscount) {
    return (
      <span className="model-menu-price has-discount">
        <strong>折扣 {price.discount} 积分{suffix}</strong>
        <del>{price.standard} 积分{suffix}</del>
      </span>
    );
  }
  return (
    <span className="model-menu-price">
      <strong>{price.effective === 0 ? "免费" : `${price.effective} 积分${suffix}`}</strong>
    </span>
  );
}

function AssistantCostDialog({ payload, light, onCancel, onConfirm }) {
  const [skip, setSkip] = useState(false);
  if (!payload) return null;
  const total = Math.max(0, Number(payload.total || 0));
  const available = Number.isFinite(Number(payload.available))
    ? Math.max(0, Number(payload.available))
    : null;
  const insufficient = available != null && total > available;
  return createPortal(
    <div className={`ai-cost-confirm-layer is-elevated${light ? " is-light" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="ai-cost-confirm-panel is-credits" role="dialog" aria-modal="true" aria-labelledby="assistant-cost-title">
        <header className="ai-cost-confirm-head">
          <span className="ai-cost-confirm-icon"><i className="bi bi-coin" /></span>
          <div className="ai-cost-confirm-titles"><span className="ai-cost-confirm-eyebrow">{payload.featureLabel}</span><h5 id="assistant-cost-title">{payload.title}</h5></div>
          <button type="button" className="ai-cost-confirm-close" aria-label="关闭费用确认" onClick={onCancel}><i className="bi bi-x-lg" /></button>
        </header>
        <p className="ai-cost-confirm-summary">{payload.summary}</p>
        <div className="ai-cost-confirm-card">
          <div className="ai-cost-confirm-total"><div className="ai-cost-confirm-total__copy"><span>本次预计</span><small>{payload.unit} 积分 / {payload.unitLabel} × {payload.count} {payload.unitLabel}</small></div><strong>{total.toLocaleString("zh-CN")} 积分</strong></div>
          <div className="ai-cost-confirm-balance"><div><span>当前可用</span><strong>{available == null ? "读取中" : `${available.toLocaleString("zh-CN")} 积分`}</strong></div><i className="bi bi-arrow-right" /><div className={insufficient ? "danger" : ""}><span>预留后余额</span><strong>{available == null ? "待计算" : insufficient ? "余额不足" : `${Math.max(0, available - total).toLocaleString("zh-CN")} 积分`}</strong></div></div>
        </div>
        {insufficient ? <p className="ai-cost-confirm-warn is-danger"><i className="bi bi-exclamation-circle" />钱包余额不足，请充值后再提交任务。</p> : null}
        <footer className="ai-cost-confirm-footer">
          <label className="ai-cost-confirm-preference"><input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} /><span>不再每次确认</span></label>
          <div className="ai-cost-confirm-actions">
            <button type="button" className="ai-cost-confirm-btn ghost" onClick={onCancel}>取消</button>
            {insufficient ? (
              <a className="ai-cost-confirm-btn primary" href="/pricing?plan=topup">去充值</a>
            ) : (
              <button type="button" className="ai-cost-confirm-btn primary" onClick={() => onConfirm(skip)}>确认</button>
            )}
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

// 开启自动授权前必须让用户看清后果：这是把“花积分”的决定权交给 Agent。
// 关闭不需要确认，所以这个对话框只在开启方向出现。
const AUTO_APPROVE_PRESETS = [30, 60, 100, 200];

function AssistantAutoApproveDialog({ open, light, budgetCents, onCancel, onConfirm }) {
  const [budget, setBudget] = useState("");
  const [custom, setCustom] = useState(false);
  const confirmRef = useRef(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    if (!open) return undefined;
    const initial = budgetCents > 0 ? budgetCents : 60;
    setBudget(String(initial));
    setCustom(!AUTO_APPROVE_PRESETS.includes(initial));
    confirmRef.current?.focus({ preventScroll: true });
    const onKey = (event) => { if (event.key === "Escape") cancelRef.current(); };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, budgetCents]);
  if (!open) return null;
  const parsed = Math.max(0, Math.min(100000, Math.round(Number(budget) || 0)));
  const valid = parsed > 0;
  const submit = (event) => {
    event.preventDefault();
    if (valid) onConfirm(parsed);
  };
  return createPortal(
    <div className={`assistant-autoapprove-layer${light ? " is-light" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <form className="assistant-autoapprove" role="dialog" aria-modal="true" aria-labelledby="assistant-auto-approve-title" onSubmit={submit}>
        <button type="button" className="assistant-autoapprove-close" aria-label="关闭自动授权设置" onClick={onCancel}><i className="bi bi-x-lg" /></button>
        <header className="assistant-autoapprove-hero">
          <span className="assistant-autoapprove-icon" aria-hidden="true"><i className="bi bi-lightning-charge-fill" /></span>
          <h5 id="assistant-auto-approve-title">开启自动出图</h5>
          <p>Agent 判断需要出图时直接生成，不用每次停下来等你确认方案。</p>
        </header>

        <div className="assistant-autoapprove-compare" aria-hidden="true">
          <div>
            <small>现在</small>
            <span>方案卡<i className="bi bi-arrow-right" />你确认<i className="bi bi-arrow-right" />出图</span>
          </div>
          <div className="is-after">
            <small>开启后</small>
            <span><i className="bi bi-lightning-charge-fill" />直接出图</span>
          </div>
        </div>

        <fieldset className="assistant-autoapprove-budget">
          <legend>每轮自动出图上限</legend>
          <div className="assistant-autoapprove-presets">
            {AUTO_APPROVE_PRESETS.map((value) => (
              <button key={value} type="button" className={!custom && parsed === value ? "is-active" : ""} aria-pressed={!custom && parsed === value} onClick={() => { setCustom(false); setBudget(String(value)); }}>
                <b>{value}</b><small>积分</small>
              </button>
            ))}
            <label className={`assistant-autoapprove-custom${custom ? " is-active" : ""}`}>
              <input type="number" inputMode="numeric" min="1" max="100000" step="10" value={custom ? budget : ""} placeholder="自定义"
                onFocus={() => { if (!custom) { setCustom(true); setBudget(""); } }}
                onChange={(event) => { setCustom(true); setBudget(event.target.value); }} aria-label="单轮预算上限（积分）" />
              <small>积分</small>
            </label>
          </div>
          <p className={valid ? "" : "is-invalid"}>{valid ? <>一轮花费在 <b>{parsed.toLocaleString("zh-CN")} 积分</b> 以内自动生成，超过就先问你。</> : "请填一个大于 0 的额度。"}</p>
        </fieldset>

        <div className="assistant-autoapprove-still">
          <span><i className="bi bi-shield-check" aria-hidden="true" />这些情况仍会先问你</span>
          <ul>
            <li>修改或重绘已有图片</li>
            <li>一轮花费超过上限</li>
          </ul>
        </div>

        <footer>
          <button type="button" className="is-ghost" onClick={onCancel}>暂不开启</button>
          <button ref={confirmRef} type="submit" className="is-primary" disabled={!valid}><i className="bi bi-lightning-charge-fill" aria-hidden="true" />开启自动出图</button>
        </footer>
        <p className="assistant-autoapprove-foot">开启后可随时在输入框的「自动授权」按钮关闭</p>
      </form>
    </div>,
    document.body,
  );
}

function AssistantAssetLibrary({ mounted, dark, entered, tab, kind, search, files, links, images, visibleImages, documents, references, mode, maxReferences, atReferenceLimit, loading, onClose, onTabChange, onKindChange, onSearchChange, onGridScroll, onPickFile, onPickImage }) {
  if (!mounted) return null;
  const kinds = [
    { id: "image", label: "图片", icon: "image", count: images.length },
    { id: "file", label: "文件", icon: "file", count: files.length },
    { id: "link", label: "链接", icon: "link", count: links.length },
  ];
  const referenceIndex = (asset) => references.findIndex((item) => sameAssetReference(item, asset)) + 1;
  const query = search.trim();
  return createPortal(
    <div className={`asset-library-layer${dark ? " is-dark" : ""}${entered ? " is-open" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`assistant-workspace${dark ? " is-dark" : ""}`}>
        <aside className="asset-library-panel assistant-assets-panel" role="dialog" aria-modal="true" aria-label="资产库" onMouseDown={(event) => event.stopPropagation()}>
          <header className="assistant-assets-header">
            <div className="assistant-assets-title">
              <span className="assistant-assets-title-icon" aria-hidden="true"><LineIcon name="assets" size={18} /></span>
              <h2>资产库</h2>
              <button className="assistant-assets-close" type="button" title="关闭" aria-label="关闭资产库" onClick={onClose}><LineIcon name="close" size={18} /></button>
            </div>
            <div className="assistant-assets-scope" role="tablist" aria-label="资产范围">
              <button type="button" role="tab" aria-selected={tab === "session"} className={tab === "session" ? "active" : ""} onClick={() => onTabChange("session")}>会话资产</button>
              <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "active" : ""} onClick={() => onTabChange("all")}>全部资产</button>
            </div>
          </header>
          <label className="assistant-assets-search">
            <LineIcon name="search" size={16} />
            <input value={search} onChange={(event) => onSearchChange(event.target.value)} type="search" aria-label="搜索资产" placeholder={kind === "file" ? "搜索文件" : kind === "link" ? "搜索链接" : "搜索图片"} />
          </label>
          <nav className="asset-kind-tabs assistant-assets-kinds" role="tablist" aria-label="资产类型">
            {kinds.map((entry) => (
              <button key={entry.id} type="button" role="tab" data-kind={entry.id} aria-selected={kind === entry.id} className={kind === entry.id ? "active" : ""} onClick={() => onKindChange(entry.id)}>
                <LineIcon name={entry.icon} size={15} />{entry.label}<span>{entry.count}</span>
              </button>
            ))}
          </nav>
          {kind === "image" && mode !== "file" && (
            <p className="assistant-assets-hint">
              {atReferenceLimit ? `参考图已满 ${maxReferences} 张，点已选的图可以移除` : "点图片添加为参考图，再点一次移除"}
            </p>
          )}
          <div className="assistant-assets-body">
            {kind === "file" ? (
              <>
                {mode === "image" && files.some((file) => file.source !== "output") && <p className="assistant-assets-note">图片模式只能添加图片附件，切到 Agent 或问答模式才能添加文档</p>}
                <div className="asset-file-list">{files.map((file) => <AssetLibraryFileRow key={file.id} file={file} picked={file.source !== "output" && documents.some((item) => item.id === file.id)} capped={documents.length >= 8} blocked={mode === "image"} onPick={onPickFile} />)}</div>
                {!files.length && <AssetsEmpty icon={query ? "search" : "file"} title={query ? "没有找到相关的文件" : "还没有文件"} text={query ? "换个关键词试试" : tab === "session" ? "这个对话里上传的文档和助手生成的文件会出现在这里" : "上传的文档和助手生成的文件会出现在这里"} />}
              </>
            ) : kind === "link" ? (
              <>
                <div className="asset-file-list">{links.map((link) => <AssetLibraryLinkRow key={link.id} link={link} />)}</div>
                {!links.length && <AssetsEmpty icon={query ? "search" : "link"} title={query ? "没有找到相关的链接" : "还没有链接"} text={query ? "换个关键词试试" : "对话里出现过的网页链接会汇总到这里"} />}
              </>
            ) : (
              <>
                <div className="asset-image-grid" onScroll={onGridScroll}>{visibleImages.map((asset) => <AssetLibraryTile key={asset.id} asset={asset} picked={references.some((item) => sameAssetReference(item, asset))} order={referenceIndex(asset)} capped={atReferenceLimit} onPick={onPickImage} />)}</div>
                {!images.length && (loading && tab !== "session"
                  ? <div className="asset-image-grid is-skeleton" aria-label="正在载入我的资产">{Array.from({ length: 9 }, (_, index) => <span key={index} />)}</div>
                  : <AssetsEmpty icon={query ? "search" : "image"} title={query ? "没有找到相关的图片" : "还没有图片"} text={query ? "换个关键词试试" : tab === "session" ? "这个对话里上传和生成的图片会出现在这里" : "上传的图片、生成的图片和收藏都会出现在这里"} />)}
              </>
            )}
          </div>
          <footer className="asset-library-footer assistant-assets-footer">
            {kind === "file" ? (
              <><span>{files.length} 个文件资产</span><small>{mode === "image" ? "图片模式不能添加文档" : `已添加 ${documents.length}/8 个文档`}</small></>
            ) : kind === "link" ? (
              <><span>{links.length} 个对话链接</span><small>点击在新窗口打开</small></>
            ) : (
              <>
                <span>{images.length} 个图片资产</span>
                <span className="assistant-assets-usage">
                  <small>参考图 {references.length}/{maxReferences}</small>
                  <span className="assistant-assets-usage-bar" aria-hidden="true"><i className={atReferenceLimit ? "is-full" : ""} style={{ width: `${Math.min(100, maxReferences ? (references.length / maxReferences) * 100 : 0)}%` }} /></span>
                </span>
              </>
            )}
          </footer>
        </aside>
      </div>
    </div>,
    document.body,
  );
}

function AssetsEmpty({ icon, title, text }) {
  return (
    <div className="assistant-assets-empty">
      <span aria-hidden="true"><LineIcon name={icon} size={24} /></span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

function AssistantSearchDialog({ open, dark, inputRef, query, groups, results, cursor, activeId, onQueryChange, onCursorChange, onOpenConversation, onStartRename, onDelete, onClose, onExited }) {
  return (
    <DialogMotion open={open} layerClassName={`assistant-dialog-layer assistant-search-layer${dark ? " is-dark" : ""}`} panelClassName="assistant-search-dialog" ariaLabel="搜索对话" initialFocusRef={inputRef} onClose={onClose} onExited={onExited}>
      <label className="assistant-search-field" data-dialog-motion-item>
        <i className="bi bi-search" aria-hidden="true" />
        <input ref={inputRef} value={query} type="search" placeholder="搜索..." aria-label="搜索对话" autoComplete="off" onChange={(event) => onQueryChange(event.target.value)} />
      </label>
      <div className="assistant-search-body" data-dialog-motion-item>
        <div className="assistant-search-pane">
          <div className="assistant-search-list">
            {groups.length ? groups.map((group) => (
              <section key={group.key} className="assistant-search-group">
                <p className="assistant-search-day">{group.key}</p>
                {group.items.map((conversation) => {
                  const index = results.indexOf(conversation);
                  const highlighted = index === cursor;
                  return (
                    <div key={conversation.id} className={`assistant-search-item${highlighted ? " is-active" : ""}${conversation.id === activeId ? " is-current" : ""}`} onMouseEnter={() => onCursorChange(index)}>
                      <button type="button" onClick={() => onOpenConversation(conversation)}>
                        <span className="assistant-search-title"><span>{conversation.title}</span>{conversation.id === activeId ? <em className="assistant-search-current">当前</em> : null}</span>
                        <small className="assistant-search-meta"><time>{formatConversationRelativeTime(conversation.updatedAt)}</time></small>
                      </button>
                      <div className="assistant-search-item-actions">
                        <button type="button" title="编辑" aria-label="编辑" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onStartRename(conversation); }}><i className="bi bi-pencil" /></button>
                        <button type="button" title="删除" aria-label="删除" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onDelete(conversation); }}><i className="bi bi-trash3" /></button>
                      </div>
                    </div>
                  );
                })}
              </section>
            )) : <p className="assistant-search-empty">{query.trim() ? "没有匹配的对话" : "暂无记录"}</p>}
          </div>
        </div>
      </div>
    </DialogMotion>
  );
}

function AssistantRenameDialog({ conversationId, dark, inputRef, draft, saving, onDraftChange, onCancel, onCommit }) {
  if (!conversationId) return null;
  return createPortal(
    <div className={`assistant-dialog-layer${dark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
      <section className="assistant-dialog assistant-rename-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-rename-title" onMouseDown={(event) => event.stopPropagation()}>
        <h2 id="assistant-rename-title">重新命名</h2>
        <input ref={inputRef} value={draft} maxLength={42} disabled={saving} aria-label="对话标题" onChange={(event) => onDraftChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void onCommit(); } }} />
        <div className="dialog-actions"><button type="button" disabled={saving} onClick={onCancel}>取消</button><button type="button" className="is-primary" disabled={saving || !draft.trim()} onClick={() => void onCommit()}>{saving ? "保存中" : "保存"}</button></div>
      </section>
    </div>,
    document.body,
  );
}

function AssistantStopDialog({ open, dark, busy, policy, onClose, onStop }) {
  if (!open) return null;
  return createPortal(<div className={`assistant-dialog-layer${dark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}><section className="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-stop-title" onMouseDown={(event) => event.stopPropagation()}><span className="dialog-icon is-danger"><i className="bi bi-stop-circle" /></span><div className="dialog-copy"><h2 id="assistant-stop-title">停止本次生成？</h2><p>{policy?.message || "任务仍在进行中，停止后将按当前实际阶段处理费用。"}</p></div><div className="dialog-actions"><button type="button" disabled={busy} onClick={onClose}>继续生成</button><button type="button" className="is-danger" disabled={busy} onClick={() => void onStop()}>{busy ? "正在停止" : policy?.upstreamSubmitted ? "放弃结果并停止" : "确认停止"}</button></div></section></div>, document.body);
}

function AssistantDeleteDialog({ target, dark, hasWork, onClose, onDelete }) {
  if (!target) return null;
  return createPortal(<div className={`assistant-dialog-layer${dark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-delete-title" onMouseDown={(event) => event.stopPropagation()}><span className="dialog-icon is-danger"><i className={`bi ${hasWork ? "bi-stop-circle" : "bi-trash3"}`} /></span><div className="dialog-copy"><h2 id="assistant-delete-title">{hasWork ? "停止任务并删除对话？" : "删除这个对话？"}</h2><p>“{target.title}”{hasWork ? "仍有正在执行或排队的任务。继续操作会先停止全部任务，再永久删除对话记录和其中生成的图片；尚未执行的排队任务会退款。" : "的对话记录和其中生成的图片会一并永久删除，无法恢复。"}{hasWork ? "" : " 已收藏到资产库的图片不受影响。"}</p></div><div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="is-danger" onClick={() => void onDelete()}>{hasWork ? "停止任务并删除" : "删除"}</button></div></section></div>, document.body);
}

// 对话菜单和已归档面板用的线条图标：24 网格、1.8 线宽、圆角端点，和图片编辑器的图标一套风格。
const LINE_ICONS = {
  rename: "M4.5 19.5 5.6 15 15.7 4.9a2.1 2.1 0 0 1 3 3L8.6 18l-4.1 1.5ZM13.8 6.8l3 3",
  pin: "M9.25 4.5h5.5l-.9 5.3 3.4 3.45H6.75l3.4-3.45-.9-5.3ZM12 13.25v6.25",
  unpin: "M9.25 4.5h5.5l-.9 5.3 3.4 3.45H6.75l3.4-3.45-.9-5.3ZM12 13.25v6.25M4.5 4.5l15 15",
  archive: "M4 6.75A1.75 1.75 0 0 1 5.75 5h12.5A1.75 1.75 0 0 1 20 6.75V8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.75ZM5.5 9v8.25A1.75 1.75 0 0 0 7.25 19h9.5a1.75 1.75 0 0 0 1.75-1.75V9M10 12.75h4",
  trash: "M4.75 7h14.5M9.5 7V5.75a1.25 1.25 0 0 1 1.25-1.25h2.5a1.25 1.25 0 0 1 1.25 1.25V7M6.75 7l.75 11.1a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4L17.25 7M10.25 10.75v5M13.75 10.75v5",
  restore: "M4.75 12a7.25 7.25 0 1 0 2.13-5.13M4.75 4.75v3.5h3.5",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  search: "M10.75 17.5a6.75 6.75 0 1 0 0-13.5 6.75 6.75 0 0 0 0 13.5ZM19.5 19.5l-3.9-3.9",
  clock: "M12 19.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15ZM12 8v4.25l2.75 1.75",
  // 侧栏
  sidebar: "M4.5 6.75A2.25 2.25 0 0 1 6.75 4.5h10.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25V6.75ZM9.75 4.5v15",
  compose: "M11.5 4.75H6.75a2 2 0 0 0-2 2v10.5a2 2 0 0 0 2 2h10.5a2 2 0 0 0 2-2V12.5M17.3 4.2a1.7 1.7 0 0 1 2.45 2.4L12.4 14 9.25 14.75 10 11.6l7.3-7.4Z",
  assets: "M5.75 4.5h3.5A1.25 1.25 0 0 1 10.5 5.75v3.5a1.25 1.25 0 0 1-1.25 1.25h-3.5A1.25 1.25 0 0 1 4.5 9.25v-3.5A1.25 1.25 0 0 1 5.75 4.5ZM14.75 4.5h3.5a1.25 1.25 0 0 1 1.25 1.25v3.5a1.25 1.25 0 0 1-1.25 1.25h-3.5a1.25 1.25 0 0 1-1.25-1.25v-3.5a1.25 1.25 0 0 1 1.25-1.25ZM5.75 13.5h3.5a1.25 1.25 0 0 1 1.25 1.25v3.5a1.25 1.25 0 0 1-1.25 1.25h-3.5a1.25 1.25 0 0 1-1.25-1.25v-3.5a1.25 1.25 0 0 1 1.25-1.25ZM14.75 13.5h3.5a1.25 1.25 0 0 1 1.25 1.25v3.5a1.25 1.25 0 0 1-1.25 1.25h-3.5a1.25 1.25 0 0 1-1.25-1.25v-3.5a1.25 1.25 0 0 1 1.25-1.25Z",
  memory: "M7 4.5h10a1.5 1.5 0 0 1 1.5 1.5v14l-6.5-4-6.5 4V6A1.5 1.5 0 0 1 7 4.5Z",
  history: "M4.75 12a7.25 7.25 0 1 0 2.13-5.13M4.75 4.75v3.5h3.5M12 8.5v3.75l2.5 1.5",
  // 资产库
  image: "M6.25 4.5h11.5a1.75 1.75 0 0 1 1.75 1.75v11.5a1.75 1.75 0 0 1-1.75 1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V6.25A1.75 1.75 0 0 1 6.25 4.5ZM4.5 15.5l4-4 3.5 3.5 2.25-2.25 5.25 5.25M15 9.25h.01",
  file: "M13.5 4.5H7.25A1.75 1.75 0 0 0 5.5 6.25v11.5c0 .97.78 1.75 1.75 1.75h9.5a1.75 1.75 0 0 0 1.75-1.75V9.5l-5-5ZM13.5 4.5v5h5M9 13h6M9 16h4",
  link: "M10.5 13.5a3.5 3.5 0 0 0 5 0l2.75-2.75a3.54 3.54 0 0 0-5-5L12 6.5M13.5 10.5a3.5 3.5 0 0 0-5 0l-2.75 2.75a3.54 3.54 0 0 0 5 5L12 17.5",
  plus: "M12 5.5v13M5.5 12h13",
  check: "M5.5 12.5l4 4 9-9",
  download: "M12 4.5v10M7.75 10.75 12 15l4.25-4.25M5 19.5h14",
  external: "M13.5 5h5.5v5.5M19 5l-7.5 7.5M17 13.5v4A1.5 1.5 0 0 1 15.5 19h-9A1.5 1.5 0 0 1 5 17.5v-9A1.5 1.5 0 0 1 6.5 7h4",
};

function LineIcon({ name, size = 18 }) {
  return (
    <svg className="line-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={LINE_ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// 归档时间：今天 19:06 / 昨天 19:06 / 10月4日 19:06
function archivedWhen(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(date)) / 86400000);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const day = days === 0 ? "今天" : days === 1 ? "昨天" : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${day} ${time}`;
}

// 侧栏底部：对话保留数和今天新建数（“已归档”入口在上方导航里，资产库下面）。
function AssistantConversationUsage({ quota }) {
  if (!quota) return null;
  const nearLimit = quota.limit > 0 && quota.used >= quota.limit;
  const dailyFull = quota.dailyLimit > 0 && quota.createdToday >= quota.dailyLimit;
  const title = [
    `已保留 ${quota.used} / ${quota.limit} 个对话${quota.planBonus ? `（含会员追加 ${quota.planBonus} 个）` : ""}，超出时自动归档最久没用的对话，置顶的不会被归档`,
    quota.dailyLimit > 0 ? `今天已新建 ${quota.createdToday} / ${quota.dailyLimit} 个` : "",
    `归档的对话 ${quota.archiveDays} 天后连同图片一起删除`,
  ].filter(Boolean).join("\n");
  return (
    <div className="sidebar-usage" title={title}>
      <div className="sidebar-usage-row">
        <span className={nearLimit ? "is-full" : ""}>对话 {quota.used}/{quota.limit}</span>
        {quota.dailyLimit > 0 && <span className={dailyFull ? "is-full" : ""}>今日新建 {quota.createdToday}/{quota.dailyLimit}</span>}
      </div>
      <span className="sidebar-usage-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, quota.limit ? (quota.used / quota.limit) * 100 : 0)}%` }} className={nearLimit ? "is-full" : ""} /></span>
    </div>
  );
}

function archivedRemaining(deleteAt) {
  const left = new Date(deleteAt).getTime() - Date.now();
  if (!Number.isFinite(left)) return "";
  if (left <= 0) return "即将删除";
  const days = Math.floor(left / 86400000);
  if (days >= 1) return `${days} 天后删除`;
  return `${Math.max(1, Math.ceil(left / 3600000))} 小时后删除`;
}

// 已归档的对话：一张简洁的表格——对话、归档时间、剩余天数，恢复和删除一直显示在每一行。
function AssistantArchivedDialog({ open, dark, items, loading, busyId, quota, onClose, onRestore, onDelete }) {
  const [query, setQuery] = useState("");
  useEffect(() => { if (!open) setQuery(""); }, [open]);
  if (!open) return null;
  const days = quota?.archiveDays || 7;
  const needle = query.trim().toLowerCase();
  const visible = needle ? items.filter((item) => String(item.title || "").toLowerCase().includes(needle)) : items;
  return createPortal(
    <div className={`assistant-dialog-layer${dark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="assistant-dialog assistant-archived-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-archived-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="assistant-archived-head">
          <div className="assistant-archived-heading">
            <h2 id="assistant-archived-title">已归档的对话</h2>
            <p>归档 {days} 天后，对话连同其中生成的图片会自动删除。恢复后回到历史列表顶部。</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><LineIcon name="close" size={18} /></button>
        </header>
        {items.length > 0 && (
          <div className="assistant-archived-tools">
            <label className="assistant-archived-search">
              <LineIcon name="search" size={16} />
              <input type="search" value={query} placeholder="搜索已归档的对话" aria-label="搜索已归档对话" onChange={(event) => setQuery(event.target.value)} />
            </label>
            <span className="assistant-archived-count">{needle ? `${visible.length} / ${items.length}` : `共 ${items.length} 个`}</span>
          </div>
        )}
        <div className="assistant-archived-table" role="table" aria-label="已归档的对话">
          {(loading || visible.length > 0) && (
            <div className="assistant-archived-columns" role="row">
              <span role="columnheader">对话</span>
              <span role="columnheader">归档时间</span>
              <span role="columnheader">剩余</span>
              <span role="columnheader" className="is-actions">操作</span>
            </div>
          )}
          <div className="assistant-archived-list" role="rowgroup">
            {loading ? (
              [0, 1, 2, 3].map((index) => <div key={index} className="assistant-archived-row is-skeleton" aria-hidden="true"><b /><b /><b /><b /></div>)
            ) : visible.length ? visible.map((item) => {
              const remaining = item.deleteAt ? archivedRemaining(item.deleteAt).replace("后删除", "") : "";
              const soon = item.deleteAt && new Date(item.deleteAt).getTime() - Date.now() < 86400000;
              const working = busyId === item.id;
              return (
                <div key={item.id} className={`assistant-archived-row${working ? " is-working" : ""}`} role="row">
                  <span className="assistant-archived-title" role="cell" title={item.title}>{item.title}</span>
                  <span className="assistant-archived-when" role="cell">{item.archivedAt ? archivedWhen(item.archivedAt) : "—"}</span>
                  <span className={`assistant-archived-left${soon ? " is-soon" : ""}`} role="cell">{remaining || "—"}</span>
                  <span className="assistant-archived-actions" role="cell">
                    <button type="button" className="is-restore" disabled={working} onClick={() => onRestore(item)}>
                      <LineIcon name="restore" size={15} />{working ? "恢复中" : "恢复"}
                    </button>
                    <button type="button" className="is-danger" aria-label={`删除「${item.title}」`} title="永久删除" disabled={working} onClick={() => onDelete(item)}>
                      <LineIcon name="trash" size={16} />
                    </button>
                  </span>
                </div>
              );
            }) : (
              <div className="assistant-archived-empty">
                <span aria-hidden="true"><LineIcon name={needle ? "search" : "archive"} size={24} /></span>
                <strong>{needle ? "没有找到相关的对话" : "没有已归档的对话"}</strong>
                <p>{needle ? "换个关键词试试" : "在历史列表里点对话的“更多 → 归档”，或者对话数满额时会自动归档最久没用的对话"}</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export {
  LineIcon,
  AssistantArchivedDialog,
  AssistantConversationUsage,
  AssetLibraryFileRow,
  AssetLibraryLinkRow,
  AssetLibraryTile,
  AssistantContextMeter,
  AssistantAutoApproveDialog,
  AssistantCostDialog,
  AssistantAssetLibrary,
  AssistantDeleteDialog,
  AssistantImageViewer,
  AssistantPreviewImage,
  AssistantRenameDialog,
  AssistantSearchDialog,
  AssistantStopDialog,
  ModelMenuPrice,
  NewChatIcon,
  PreferenceSegment,
  assistantContextMeterTitle,
};
