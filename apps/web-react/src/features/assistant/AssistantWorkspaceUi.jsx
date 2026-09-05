import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { conversationTitle } from "./domain/assistantMessages.js";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import { DialogMotion } from "../../components/motion/DialogMotion.jsx";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { DownloadIcon } from "../../components/common/DownloadIcon.jsx";
import { WallevenImagePreview } from "../../components/common/WallevenImagePreview.jsx";
import {
  documentIcon,
  downloadAssistantImage,
  formatContextTokens,
  formatConversationRelativeTime,
  formatDocumentSize,
  imageAssetFromItem,
  imageDisplayUrl,
  imageThumbUrl,
  imageUrl,
  normalizeAssistantContext,
  preferenceMotionDisabled,
  sameAssetReference,
  uniqueReferenceImages,
} from "./assistantWorkspaceCore.jsx";


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
      className={`asset-file-row${picked ? " is-picked" : ""}${capped && !picked && !isOutput ? " is-capped" : ""}`}
      aria-pressed={isOutput ? undefined : picked}
      title={title}
      onClick={() => onPick(file)}
    >
      <i className={`bi ${documentIcon(file)}`} aria-hidden="true" />
      <span>
        <strong>{file.label}</strong>
        <small>
          {isOutput
            ? `${String(file.format || "file").toUpperCase()} · ${formatDocumentSize(file.sizeBytes)} · 输出`
            : `${formatDocumentSize(file.sizeBytes)}${file.pageCount ? ` · ${file.pageCount} 页` : " · 文档"}`}
        </small>
      </span>
      {isOutput ? <DownloadIcon /> : <i className={`bi ${picked ? "bi-check-lg" : "bi-plus-lg"}`} aria-hidden="true" />}
    </button>
  );
}

function AssetLibraryLinkRow({ link }) {
  const details = [
    link.host,
    link.conversationTitle,
    link.occurrences > 1 ? `出现 ${link.occurrences} 次` : "",
  ].filter(Boolean).join(" · ");
  return (
    <a className="asset-file-row asset-link-row" href={link.url} target="_blank" rel="noopener noreferrer" title={`打开 ${link.label}`}>
      <i className="bi bi-link-45deg" aria-hidden="true" />
      <span><strong>{link.label}</strong><small>{details}</small></span>
      <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
    </a>
  );
}

function AssetLibraryTile({ asset, onPick, picked, capped }) {
  return (
    <button type="button" className={`${picked ? "is-picked" : ""}${capped && !picked ? " is-capped" : ""}`.trim()} aria-pressed={picked} title={picked ? `移除 ${asset.label}` : capped ? `参考图已达上限` : `添加 ${asset.label} 到参考图`} onClick={() => onPick(asset)}>
      <AssistantPreviewImage src={asset.thumbUrl || asset.dataUrl} fallbackSrc={asset.dataUrl} alt="" width="160" height="160" loading="lazy" />
      <span className="asset-image-action"><i className={`bi ${picked ? "bi-check-lg" : "bi-plus-lg"}`} /></span>
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


function AssistantFullscreenPreview({
  value,
  actionBusy = "",
  onClose,
  onStep,
  onUseReference,
  onRegionEdit,
  onFavorite,
  onPublish,
  onDelete,
}) {
  if (!value?.item) return null;
  const item = value.item;
  const galleryItems = uniqueReferenceImages(value.gallery?.length ? value.gallery : [item]);
  const sourceUrl = imageUrl(item);
  if (!sourceUrl) return null;
  const index = Math.max(0, galleryItems.findIndex((entry) => entry === item || sameAssetReference(entry, imageAssetFromItem(item))));
  const meta = value.meta && typeof value.meta === "object" ? value.meta : {};
  const prompt = String(meta.prompt || item.revisedPrompt || item.name || "").trim();
  const title = prompt || "AI 助手图片";
  const gallery = galleryItems.map(imageUrl).filter(Boolean);
  const displaySources = Object.fromEntries(galleryItems.map((entry) => [imageUrl(entry), imageDisplayUrl(entry)]).filter(([url]) => url));
  const pending = Boolean(meta.pending);
  return (
    <WallevenImagePreview
      sourceUrl={sourceUrl}
      displaySourceUrl={imageDisplayUrl(item)}
      title={title}
      filename={`assistant-image-${index + 1}.png`}
      gallery={gallery}
      displaySources={displaySources}
      metadata={{
        id: item.id || "",
        model: meta.modelLabel || meta.model || "",
        ratio: meta.ratio || "",
        resolution: meta.resolution || meta.size || "",
        prompt,
        source: meta.messageId ? "AI 助手" : "",
      }}
      actionBusy={pending ? "pending" : actionBusy}
      regionEditBusy={actionBusy === "region-edit"}
      onUseReference={() => onUseReference?.(item)}
      onRegionEdit={(payload) => onRegionEdit?.(payload, item, meta)}
      onFavorite={item.fileKey ? () => onFavorite?.(item, meta) : undefined}
      onPublish={meta.runId ? () => onPublish?.(item, meta) : undefined}
      onDelete={meta.messageId ? () => onDelete?.(item, meta) : undefined}
      onSelect={(url) => {
        const nextIndex = gallery.indexOf(url);
        if (nextIndex >= 0) onStep(nextIndex - index);
      }}
      onClose={onClose}
      onDownload={() => downloadAssistantImage(item, index)}
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
        <footer className="ai-cost-confirm-footer">
          <label className="ai-cost-confirm-preference"><input type="checkbox" checked={skip} onChange={(event) => setSkip(event.target.checked)} /><span>不再每次确认</span></label>
          <div className="ai-cost-confirm-actions"><button type="button" className="ai-cost-confirm-btn ghost" onClick={onCancel}>取消</button><button type="button" className="ai-cost-confirm-btn primary" disabled={insufficient} onClick={() => onConfirm(skip)}>确认</button></div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function AssistantAssetLibrary({ mounted, dark, entered, tab, kind, search, files, links, images, visibleImages, documents, references, mode, maxReferences, atReferenceLimit, loading, onClose, onTabChange, onKindChange, onSearchChange, onGridScroll, onPickFile, onPickImage }) {
  if (!mounted) return null;
  return createPortal(
    <div className={`asset-library-layer${dark ? " is-dark" : ""}${entered ? " is-open" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`assistant-workspace${dark ? " is-dark" : ""}`}>
        <aside className="asset-library-panel" role="dialog" aria-modal="true" aria-label="资产库" onMouseDown={(event) => event.stopPropagation()}>
          <header className="asset-library-header">
            <div className="asset-library-heading">
              <p className="asset-library-kicker">资产库</p>
              <div className="asset-library-tabs" role="tablist" aria-label="资产范围">
                <button type="button" role="tab" aria-selected={tab === "session"} className={tab === "session" ? "active" : ""} onClick={() => onTabChange("session")}>会话资产</button>
                <button type="button" role="tab" aria-selected={tab === "all"} className={tab === "all" ? "active" : ""} onClick={() => onTabChange("all")}>全部资产</button>
              </div>
            </div>
            <button className="asset-close" type="button" title="关闭资产库" aria-label="关闭资产库" onClick={onClose}><i className="bi bi-x-lg" /></button>
          </header>
          <div className="asset-search-row">
            <label>
              <i className="bi bi-search" />
              <input value={search} onChange={(event) => onSearchChange(event.target.value)} type="text" placeholder={kind === "file" ? "搜索文件资产" : kind === "link" ? "搜索对话链接" : "搜索图片资产"} />
            </label>
          </div>
          <nav className="asset-kind-tabs" role="tablist" aria-label="资产类型">
            <button type="button" role="tab" aria-selected={kind === "image"} className={kind === "image" ? "active" : ""} onClick={() => onKindChange("image")}>图片</button>
            <button type="button" role="tab" aria-selected={kind === "file"} className={kind === "file" ? "active" : ""} onClick={() => onKindChange("file")}>文件</button>
            <button type="button" role="tab" aria-selected={kind === "link"} className={kind === "link" ? "active" : ""} onClick={() => onKindChange("link")}>链接</button>
          </nav>
          {kind === "file" ? (
            <>
              <div className="asset-file-list">{files.map((file) => <AssetLibraryFileRow key={file.id} file={file} picked={file.source !== "output" && documents.some((item) => item.id === file.id)} capped={documents.length >= 8} blocked={mode === "image"} onPick={onPickFile} />)}</div>
              {!files.length && <div className="asset-empty"><i className="bi bi-file-earmark-text" /><p>没有匹配的文件资产</p></div>}
            </>
          ) : kind === "link" ? (
            <>
              <div className="asset-file-list">{links.map((link) => <AssetLibraryLinkRow key={link.id} link={link} />)}</div>
              {!links.length && <div className="asset-empty"><i className="bi bi-link-45deg" /><p>当前范围没有对话链接</p></div>}
            </>
          ) : (
            <>
              <div className="asset-image-grid" onScroll={onGridScroll}>{visibleImages.map((asset) => <AssetLibraryTile key={asset.id} asset={asset} picked={references.some((item) => sameAssetReference(item, asset))} capped={atReferenceLimit} onPick={onPickImage} />)}</div>
              {!images.length && <div className="asset-empty"><i className="bi bi-images" /><p>{loading && tab !== "session" ? "正在载入我的资产…" : "没有匹配的图片资产"}</p></div>}
            </>
          )}
          <footer className="asset-library-footer">
            {kind === "file" ? (
              <><span>{files.length} 个文件资产</span><small>{mode === "image" ? "图片生成模式仅支持图片附件" : documents.length ? `已添加 ${documents.length}/8 个文档` : "附件可添加，输出文件可下载"}</small></>
            ) : kind === "link" ? (
              <><span>{links.length} 个对话链接</span><small>点击链接将在新窗口打开</small></>
            ) : (
              <><span>{images.length} 个图片资产</span><small>{references.length ? `已添加 ${references.length}/${maxReferences} 张参考图` : "点击即可添加为参考图"}</small></>
            )}
          </footer>
        </aside>
      </div>
    </div>,
    document.body,
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
  return createPortal(<div className={`assistant-dialog-layer${dark ? " is-dark" : ""}`} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="assistant-delete-title" onMouseDown={(event) => event.stopPropagation()}><span className="dialog-icon is-danger"><i className={`bi ${hasWork ? "bi-stop-circle" : "bi-trash3"}`} /></span><div className="dialog-copy"><h2 id="assistant-delete-title">{hasWork ? "停止任务并删除对话？" : "删除这个对话？"}</h2><p>“{target.title}”{hasWork ? "仍有正在执行或排队的任务。继续操作会先停止全部任务，再永久删除对话和已生成内容；尚未执行的排队任务会退款。" : "及其中的消息将被永久删除。"}</p></div><div className="dialog-actions"><button type="button" onClick={onClose}>取消</button><button type="button" className="is-danger" onClick={() => void onDelete()}>{hasWork ? "停止任务并删除" : "删除"}</button></div></section></div>, document.body);
}

export {
  AssetLibraryFileRow,
  AssetLibraryLinkRow,
  AssetLibraryTile,
  AssistantContextMeter,
  AssistantCostDialog,
  AssistantAssetLibrary,
  AssistantDeleteDialog,
  AssistantFullscreenPreview,
  AssistantPreviewImage,
  AssistantRenameDialog,
  AssistantSearchDialog,
  AssistantStopDialog,
  ModelMenuPrice,
  NewChatIcon,
  PreferenceSegment,
  assistantContextMeterTitle,
};
