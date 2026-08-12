import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeLossyImageFile,
  COMPRESS_MODE_OPTIONS,
  compressImageFile,
  downloadBlob,
  downloadBlobsAsZip,
  formatBytes,
  ICON_TARGET_BYTES,
  INTENSITY_OPTIONS,
  isAcceptedImageFile,
  isIconMaxEdge,
  LOSSY_FORMAT_OPTIONS,
  makePreviewDataUrl,
  MAX_EDGE_OPTIONS,
  MAX_FILE_BYTES,
  outputFilename,
  savingsPercent,
  terminateCompressWorker,
} from "@react/legacy-modules/features/image-compress/compressEngine.js";
import {
  clearCompressHistory,
  loadCompressHistory,
  loadCompressResultBlob,
  prependCompressHistory,
  saveCompressResultBlob,
} from "@react/legacy-modules/features/image-compress/compressHistory.js";
import "@react/legacy-styles/generated/views/ImageCompressView.css";

function Icon({ name, className = "" }) {
  return <i className={`bi bi-${name}${className ? ` ${className}` : ""}`} aria-hidden="true" />;
}

function createItem(file, format) {
  return {
    id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    name: file.name || `paste-${Date.now()}.png`,
    sourceUrl: URL.createObjectURL(file),
    resultUrl: "",
    resultBlob: null,
    status: "queued",
    error: "",
    width: 0,
    height: 0,
    beforeBytes: file.size,
    afterBytes: 0,
    keptOriginal: false,
    resized: false,
    format,
    variants: [],
    selectedVariantId: "",
    recommendedVariantId: "",
    progressLabel: "",
    appliedSettings: "",
  };
}

function revokeItemUrls(item) {
  if (item?.sourceUrl?.startsWith("blob:")) URL.revokeObjectURL(item.sourceUrl);
  if (item?.resultUrl?.startsWith("blob:")) URL.revokeObjectURL(item.resultUrl);
}

function clearItemResult(item) {
  if (item.resultUrl?.startsWith("blob:")) URL.revokeObjectURL(item.resultUrl);
  item.resultUrl = "";
  item.resultBlob = null;
  item.afterBytes = 0;
  item.keptOriginal = false;
  item.resized = false;
  item.variants = [];
  item.selectedVariantId = "";
  item.recommendedVariantId = "";
  item.progressLabel = "";
}

function statusLabel(item) {
  if (item.status === "queued") return "等待压缩";
  if (item.status === "compressing") return item.progressLabel || "压缩中";
  if (item.status === "failed") return "失败";
  if (item.keptOriginal) return "已是较优";
  if (item.selectedVariantId && item.selectedVariantId === item.recommendedVariantId) return "推荐档";
  return "已完成";
}

function formatHistoryTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ImageCompressView() {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [compressMode, setCompressMode] = useState("lossy");
  const [outputFormat, setOutputFormat] = useState("webp");
  const [maxEdge, setMaxEdge] = useState(0);
  const [intensity, setIntensity] = useState("balanced");
  const [keepIfLarger, setKeepIfLarger] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [zipBusy, setZipBusy] = useState(false);
  const [historyItems, setHistoryItems] = useState(() => loadCompressHistory());
  const [historyFocus, setHistoryFocus] = useState(null);
  const fileInputRef = useRef(null);
  const itemsRef = useRef(items);
  const mountedRef = useRef(true);
  const runTokenRef = useRef(0);
  const runControllerRef = useRef(null);
  itemsRef.current = items;

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) || null,
    [items, selectedId],
  );
  const doneItems = useMemo(
    () => items.filter((item) => item.status === "done" && item.resultBlob),
    [items],
  );
  const recentHistory = historyItems.slice(0, 5);
  const totalBefore = doneItems.reduce((sum, item) => sum + (item.beforeBytes || 0), 0);
  const totalAfter = doneItems.reduce((sum, item) => sum + (item.afterBytes || 0), 0);
  const totalRatio = savingsPercent(totalBefore, totalAfter);
  const pendingCount = items.filter(
    (item) => item.status === "queued" || item.status === "compressing",
  ).length;
  const isLossyMode = compressMode === "lossy";
  const iconBudgetActive = isLossyMode && isIconMaxEdge(maxEdge);
  const settingsFingerprint = `${compressMode}|${outputFormat}|${maxEdge}|${intensity}|${keepIfLarger ? 1 : 0}`;
  const settingsDirty = items.some(
    (item) =>
      (item.status === "done" || item.status === "failed") &&
      item.appliedSettings &&
      item.appliedSettings !== settingsFingerprint,
  );
  const totalSavedLabel = doneItems.length
    ? `已节省 ${formatBytes(Math.max(0, totalBefore - totalAfter))}（${totalRatio}%）`
    : "尚未压缩";

  const refreshItems = useCallback(() => {
    if (!mountedRef.current) return;
    setItems([...itemsRef.current]);
  }, []);

  const clearHistoryFocus = useCallback(() => {
    setHistoryFocus((current) => {
      if (current?.resultUrl?.startsWith("blob:")) URL.revokeObjectURL(current.resultUrl);
      return null;
    });
  }, []);

  const addFiles = useCallback(
    (fileList) => {
      const valid = Array.from(fileList || []).filter(
        (file) => isAcceptedImageFile(file) && file.size <= MAX_FILE_BYTES,
      );
      if (!valid.length) return;
      const added = valid.map((file) => createItem(file, outputFormat));
      setItems((current) => {
        const next = [...current, ...added];
        itemsRef.current = next;
        return next;
      });
      setSelectedId((current) => current || added[0].id);
      clearHistoryFocus();
    },
    [clearHistoryFocus, outputFormat],
  );

  useEffect(() => {
    const onPaste = (event) => {
      if (compressing) return;
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const files = Array.from(event.clipboardData?.items || [])
        .filter((item) => item.kind === "file" && item.type?.startsWith("image/"))
        .map((item) => item.getAsFile())
        .filter(Boolean);
      if (!files.length) return;
      event.preventDefault();
      addFiles(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles, compressing]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runTokenRef.current += 1;
      runControllerRef.current?.abort();
      terminateCompressWorker();
      itemsRef.current.forEach(revokeItemUrls);
    };
  }, []);

  const removeItem = (id) => {
    const index = itemsRef.current.findIndex((item) => item.id === id);
    if (index < 0) return;
    const removed = itemsRef.current[index];
    revokeItemUrls(removed);
    const next = itemsRef.current.filter((item) => item.id !== id);
    itemsRef.current = next;
    setItems(next);
    if (selectedId === id) setSelectedId(next[index]?.id || next[index - 1]?.id || "");
  };

  const clearQueue = () => {
    if (compressing) return;
    itemsRef.current.forEach(revokeItemUrls);
    itemsRef.current = [];
    setItems([]);
    setSelectedId("");
    clearHistoryFocus();
  };

  const clearDone = () => {
    if (compressing) return;
    const remain = itemsRef.current.filter((item) => {
      if (item.status !== "done") return true;
      revokeItemUrls(item);
      return false;
    });
    itemsRef.current = remain;
    setItems(remain);
    if (!remain.some((item) => item.id === selectedId)) setSelectedId(remain[0]?.id || "");
  };

  const applyVariant = (item, variant) => {
    if (item.resultUrl?.startsWith("blob:")) URL.revokeObjectURL(item.resultUrl);
    item.resultBlob = variant.blob;
    item.resultUrl = URL.createObjectURL(variant.blob);
    item.afterBytes = variant.bytes;
    item.format = variant.format;
    item.selectedVariantId = variant.id;
    item.keptOriginal = false;
  };

  const compressOne = async (item, token, controller) => {
    item.status = "compressing";
    item.error = "";
    item.progressLabel = isLossyMode ? "分析中…" : "";
    clearItemResult(item);
    refreshItems();
    try {
      let result;
      if (isLossyMode) {
        const analyzed = await analyzeLossyImageFile(item.file, {
          format: outputFormat,
          maxEdge,
          signal: controller.signal,
          onProgress(done, total) {
            if (token !== runTokenRef.current) return;
            item.progressLabel = `分析 ${done}/${total}`;
            refreshItems();
          },
        });
        if (token !== runTokenRef.current) return;
        item.beforeBytes = analyzed.beforeBytes;
        item.width = analyzed.width;
        item.height = analyzed.height;
        item.resized = analyzed.resized;
        item.variants = analyzed.variants;
        item.recommendedVariantId = analyzed.recommended?.id || "";
        const pick = analyzed.recommended || analyzed.variants[0];
        if (!pick) throw new Error("未生成可用压缩结果");
        applyVariant(item, pick);
        result = {
          blob: pick.blob,
          format: pick.format,
          beforeBytes: analyzed.beforeBytes,
          afterBytes: pick.bytes,
          width: analyzed.width,
          height: analyzed.height,
          keptOriginal: false,
        };
      } else {
        result = await compressImageFile(item.file, {
          format: outputFormat === "png" ? "png" : "webp",
          keepIfLarger,
          maxEdge,
          intensity,
          signal: controller.signal,
        });
        if (token !== runTokenRef.current) return;
        item.resultBlob = result.blob;
        item.resultUrl = URL.createObjectURL(result.blob);
        item.beforeBytes = result.beforeBytes;
        item.afterBytes = result.afterBytes;
        item.width = result.width;
        item.height = result.height;
        item.keptOriginal = result.keptOriginal;
        item.resized = result.resized;
        item.format = result.format;
      }
      item.status = "done";
      item.progressLabel = "";
      item.appliedSettings = settingsFingerprint;
      refreshItems();

      const previewDataUrl = await makePreviewDataUrl(result.blob).catch(() => "");
      if (token !== runTokenRef.current) return;
      const historyId = `${item.id}-${Date.now()}`;
      await saveCompressResultBlob(historyId, result.blob);
      if (token !== runTokenRef.current) return;
      setHistoryItems((current) =>
        prependCompressHistory(
          {
            id: historyId,
            sourceItemId: item.id,
            name: outputFilename(item.name, result.format),
            format: result.format,
            beforeBytes: result.beforeBytes,
            afterBytes: result.afterBytes,
            width: result.width,
            height: result.height,
            keptOriginal: result.keptOriginal,
            createdAt: new Date().toISOString(),
            previewDataUrl,
          },
          current,
        ),
      );
    } catch (error) {
      if (error?.name === "AbortError" || token !== runTokenRef.current) return;
      item.status = "failed";
      item.progressLabel = "";
      item.appliedSettings = settingsFingerprint;
      item.error = error?.message || "压缩失败";
      refreshItems();
    }
  };

  const compressAll = async () => {
    if (compressing || !itemsRef.current.length) return;
    const targets = itemsRef.current.filter(
      (item) =>
        item.status === "queued" ||
        item.status === "failed" ||
        (item.status === "done" && item.appliedSettings !== settingsFingerprint),
    );
    if (!targets.length) return;
    const token = ++runTokenRef.current;
    const controller = new AbortController();
    runControllerRef.current = controller;
    setCompressing(true);
    try {
      for (const item of targets) {
        if (token !== runTokenRef.current) break;
        setSelectedId(item.id);
        clearHistoryFocus();
        await compressOne(item, token, controller);
      }
    } finally {
      if (mountedRef.current && token === runTokenRef.current) setCompressing(false);
      if (runControllerRef.current === controller) runControllerRef.current = null;
    }
  };

  const selectVariant = (variantId) => {
    if (!selected?.variants?.length) return;
    const variant = selected.variants.find((entry) => entry.id === variantId);
    if (!variant) return;
    applyVariant(selected, variant);
    refreshItems();
  };

  const openRecentEntry = async (entry) => {
    if (!entry?.id || compressing) return;
    const live = itemsRef.current.find(
      (item) => item.id === entry.sourceItemId && item.status === "done" && item.resultBlob,
    );
    if (live) {
      clearHistoryFocus();
      setSelectedId(live.id);
      return;
    }
    const blob = await loadCompressResultBlob(entry.id);
    if (!mountedRef.current) return;
    clearHistoryFocus();
    setSelectedId("");
    setHistoryFocus({
      entry,
      resultBlob: blob,
      resultUrl: blob ? URL.createObjectURL(blob) : entry.previewDataUrl || "",
      previewOnly: !blob,
    });
  };

  const downloadDone = async () => {
    if (!doneItems.length || zipBusy) return;
    setZipBusy(true);
    try {
      await downloadBlobsAsZip(
        doneItems.map((item) => ({ blob: item.resultBlob, name: item.name, format: item.format })),
        `image-compress-${new Date().toISOString().slice(0, 10)}.zip`,
      );
    } finally {
      if (mountedRef.current) setZipBusy(false);
    }
  };

  return (
    <main className={`ic${compressing ? " is-busy" : ""}`}>
      <div className="ic-glow" aria-hidden="true" />
      <header className="ic-header">
        <div className="ic-header__copy">
          <span className="ic-kicker"><Icon name="arrows-collapse" />图片工具</span>
          <h1>图片压缩</h1>
          <p>本地智能有损 / 无损压缩。需要透明底时可在本页直接抠图，再继续压缩，无需跳转。</p>
          <div className="ic-meta">
            <span className="ic-chip"><Icon name="shield-check" />本地压缩</span>
            <span className="ic-chip"><Icon name="scissors" />本页抠图</span>
            <span className="ic-chip"><Icon name="images" />支持批量</span>
            <span className="ic-chip"><Icon name="clipboard-check" />支持粘贴截图</span>
            <span className="ic-chip"><Icon name="hdd" />最大 30MB / 张</span>
            <span className="ic-chip"><Icon name="app" />图标可压到约 4–10KB</span>
          </div>
        </div>
        <aside className="ic-summary" aria-live="polite">
          <small>压缩大小</small>
          <div className="ic-summary__sizes"><div><em>压缩前</em><strong>{doneItems.length ? formatBytes(totalBefore) : "—"}</strong></div><span className="ic-summary__arrow">→</span><div><em>压缩后</em><strong>{doneItems.length ? formatBytes(totalAfter) : "—"}</strong></div><div className="ic-summary__saved"><em>节省</em><strong>{doneItems.length ? `${totalRatio}%` : "—"}</strong></div></div>
          <p>{totalSavedLabel} · 队列 {items.length} 张 · 完成 {doneItems.length} 张{pendingCount ? ` · 进行中 ${pendingCount}` : ""}</p>
        </aside>
      </header>

      <section className="ic-toolbar" aria-label="压缩设置">
        <div className="ic-formats" role="group" aria-label="压缩模式">{COMPRESS_MODE_OPTIONS.map((option) => <button key={option.value} type="button" className={`ic-seg${compressMode === option.value ? " is-active" : ""}`} disabled={compressing} onClick={() => { setCompressMode(option.value); if (option.value === "lossless" && !["webp", "png"].includes(outputFormat)) setOutputFormat("webp"); }}>{option.label}</button>)}</div>
        <div className="ic-formats" role="group" aria-label="输出格式">{(isLossyMode ? LOSSY_FORMAT_OPTIONS : [{ value: "webp", label: "WebP 无损" }, { value: "png", label: "PNG 优化" }]).map((option) => <button key={option.value} type="button" className={`ic-seg${outputFormat === option.value ? " is-active" : ""}`} disabled={compressing} onClick={() => setOutputFormat(option.value)}>{option.label}</button>)}</div>
        <label className="ic-field"><span>输出尺寸</span><select value={maxEdge} disabled={compressing} aria-label="输出尺寸" onChange={(event) => setMaxEdge(Number(event.target.value))}>{MAX_EDGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <button type="button" className={`ic-seg${iconBudgetActive ? " is-active" : ""}`} disabled={compressing} title="缩放图标并优先压到约 4–10KB（WebP 有损）" onClick={() => { setCompressMode("lossy"); setOutputFormat("webp"); setMaxEdge(256); setKeepIfLarger(false); }}>图标 4–10KB</button>
        {iconBudgetActive && <span className="ic-budget-hint">目标 {Math.round(ICON_TARGET_BYTES.min / 1024)}–{Math.round(ICON_TARGET_BYTES.max / 1024)}KB</span>}
        {!isLossyMode && <label className="ic-field"><span>压缩强度</span><select value={intensity} disabled={compressing} aria-label="压缩强度" onChange={(event) => setIntensity(event.target.value)}>{INTENSITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
        {!isLossyMode && <label className="ic-check"><input checked={keepIfLarger} type="checkbox" disabled={compressing} onChange={(event) => setKeepIfLarger(event.target.checked)} />仅在更小时替换</label>}
        <div className="ic-toolbar__spacer" />
        <button type="button" className="ic-ghost" disabled={compressing || !items.length} onClick={clearQueue}>清空队列</button>
      </section>

      <section className="ic-workspace" aria-label="图片压缩工作区">
        <div className={`ic-pane ic-queue${dragging ? " is-dragging" : ""}`} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }}>
          <div className="ic-pane__head"><strong>压缩队列</strong><span>{items.length ? `${items.length} 张` : "可拖入多张"}</span><button type="button" className="ic-ghost" onClick={() => fileInputRef.current?.click()}><Icon name="plus-lg" />添加图片</button></div>
          {!items.length ? <button type="button" className="ic-dropzone" onClick={() => fileInputRef.current?.click()}><span className="ic-dropzone__icon"><Icon name="cloud-arrow-up" /></span><strong>添加要压缩的图片</strong><span>点击选择、拖入文件，或按 Ctrl/⌘ + V 粘贴截图</span></button> : <div className="ic-list" role="list">{items.map((item) => <div key={item.id} className={`ic-row${selectedId === item.id ? " is-active" : ""}${item.status === "done" ? " is-done" : ""}${item.status === "failed" ? " is-failed" : ""}${item.status === "compressing" ? " is-busy" : ""}`} role="listitem" onClick={() => { clearHistoryFocus(); setSelectedId(item.id); }}><span className="ic-row__thumb"><img src={item.resultUrl || item.sourceUrl} alt={item.name} /></span><span className="ic-row__body"><strong>{item.name}</strong><small>{statusLabel(item)} · {formatBytes(item.beforeBytes)}{item.status === "done" ? ` → ${formatBytes(item.afterBytes)}（${savingsPercent(item.beforeBytes, item.afterBytes)}%）` : ""}</small>{item.error && <small className="is-error">{item.error}</small>}</span><span className="ic-row__actions"><button type="button" className="ic-icon" title="下载" disabled={item.status !== "done"} onClick={(event) => { event.stopPropagation(); if (item.resultBlob) downloadBlob(item.resultBlob, outputFilename(item.name, item.format)); }}><Icon name="download" /></button><button type="button" className="ic-icon" title="移除" disabled={compressing && item.status === "compressing"} onClick={(event) => { event.stopPropagation(); removeItem(item.id); }}><Icon name="x-lg" /></button></span></div>)}</div>}
        </div>

        <div className="ic-pane ic-compare">
          <div className="ic-pane__head"><strong>前后对比</strong><span>{historyFocus ? `历史 · ${historyFocus.entry.name} · ${formatBytes(historyFocus.entry.beforeBytes)} → ${formatBytes(historyFocus.entry.afterBytes)}` : selected ? (selected.width ? `${selected.width}×${selected.height}${selected.status === "done" ? ` · ${formatBytes(selected.beforeBytes)} → ${formatBytes(selected.afterBytes)}` : ""}` : "选择队列中的图片") : "选择队列或右侧最近记录"}</span>{historyFocus?.resultBlob && <button type="button" className="ic-ghost" onClick={() => downloadBlob(historyFocus.resultBlob, historyFocus.entry.name)}><Icon name="download" />下载</button>}</div>
          {historyFocus ? <div className="ic-compare__body"><div className="ic-compare__grid is-history"><figure className="ic-frame"><figcaption>{historyFocus.previewOnly ? "缩略预览" : "压缩结果"} · {formatBytes(historyFocus.entry.afterBytes)}</figcaption><div className="ic-frame__media is-checker"><img src={historyFocus.resultUrl} alt={historyFocus.entry.name} /></div></figure><figure className="ic-frame"><figcaption>记录信息</figcaption><div className="ic-frame__media ic-history-detail"><strong>{historyFocus.entry.name}</strong><p>{formatHistoryTime(historyFocus.entry.createdAt)} · 节省 {savingsPercent(historyFocus.entry.beforeBytes, historyFocus.entry.afterBytes)}%</p><p>{formatBytes(historyFocus.entry.beforeBytes)} → {formatBytes(historyFocus.entry.afterBytes)}</p>{historyFocus.previewOnly ? <p className="is-muted">完整文件未保存，仅缩略图</p> : <button type="button" className="ic-btn is-secondary" onClick={() => downloadBlob(historyFocus.resultBlob, historyFocus.entry.name)}>下载此结果</button>}</div></figure></div></div> : selected ? <div className="ic-compare__body"><div className="ic-linkbar"><div className="ic-linkbar__copy"><strong><Icon name="scissors" />需要透明底？</strong><span>背景移除工具暂未开放</span></div><button type="button" className="ic-btn is-secondary" disabled><Icon name="person-bounding-box" />本页移除背景</button></div><div className="ic-compare__grid"><figure className="ic-frame"><figcaption>原图 · {formatBytes(selected.beforeBytes)}</figcaption><div className="ic-frame__media is-checker"><img src={selected.sourceUrl} alt="压缩前原图" /></div></figure><figure className="ic-frame"><figcaption>结果 · {selected.status === "done" ? `${formatBytes(selected.afterBytes)}${selected.keptOriginal ? " · 已是较优" : ""}` : statusLabel(selected)}</figcaption><div className="ic-frame__media is-checker">{selected.resultUrl ? <img src={selected.resultUrl} alt="压缩后结果" /> : <div className="ic-frame__empty"><Icon name="hourglass-split" /><p>{selected.status === "failed" ? selected.error || "压缩失败" : "压缩后显示在这里"}</p></div>}</div></figure></div>{selected.variants.length > 0 && <div className="ic-ladder"><div className="ic-ladder__head"><strong>压缩档位</strong><span>点击切换预览与下载；绿色为推荐</span></div><div className="ic-ladder__table-wrap"><table className="ic-ladder__table"><thead><tr><th>档位</th><th>体积</th><th>节省</th><th>RMSE</th><th>最大误差</th></tr></thead><tbody>{selected.variants.map((variant) => <tr key={variant.id} className={`${selected.selectedVariantId === variant.id ? "is-active " : ""}${selected.recommendedVariantId === variant.id ? "is-recommended" : ""}`} onClick={() => selectVariant(variant.id)}><td>{variant.label}{selected.recommendedVariantId === variant.id && <em>推荐</em>}</td><td>{formatBytes(variant.bytes)}</td><td>{variant.savings}%</td><td>{variant.rmse}</td><td>{variant.maxError}</td></tr>)}</tbody></table></div></div>}</div> : <div className="ic-compare__empty"><Icon name="columns-gap" /><strong>还没有选中图片</strong><p>添加图片，或点击右侧最近记录查看结果</p></div>}
        </div>

        <aside className="ic-pane ic-recent" aria-label="最近压缩"><div className="ic-pane__head"><strong>最近 5 张</strong><span>{recentHistory.length ? `${recentHistory.length} 条` : "本地保存"}</span><button type="button" className="ic-ghost" disabled={!recentHistory.length} onClick={async () => { clearHistoryFocus(); await clearCompressHistory(); setHistoryItems([]); }}>清空</button></div>{!recentHistory.length ? <div className="ic-recent__empty"><Icon name="clock-history" /><strong>暂无记录</strong><p>压缩完成后会保存在本地，点击可回看</p></div> : <div className="ic-recent__list">{recentHistory.map((entry) => <button key={entry.id} type="button" className={`ic-recent__card${historyFocus?.entry?.id === entry.id || selected?.id === entry.sourceItemId ? " is-active" : ""}`} onClick={() => openRecentEntry(entry)}><span className="ic-recent__thumb is-checker">{entry.previewDataUrl ? <img src={entry.previewDataUrl} alt="" /> : <Icon name="image" />}</span><span className="ic-recent__meta"><strong>{entry.name}</strong><small>{formatHistoryTime(entry.createdAt)} · {formatBytes(entry.beforeBytes)} → {formatBytes(entry.afterBytes)}（{savingsPercent(entry.beforeBytes, entry.afterBytes)}%）</small></span></button>)}</div>}</aside>
      </section>

      <footer className="ic-actions"><div className="ic-actions__hint">{!items.length ? "支持拖入与粘贴截图；压缩在本地完成，抠图可在本页联动" : compressing ? "正在压缩，请保持页面打开…" : settingsDirty ? "设置已更改，点击「开始压缩」可按新设置重新处理" : doneItems.length ? `${totalSavedLabel}；单张直接下载，多张才打包 ZIP` : isLossyMode ? "选择格式后点击「开始压缩」，将生成多档并自动推荐" : "选择输出格式后点击「开始压缩」"}</div><div className="ic-actions__btns"><button type="button" className="ic-btn is-ghost" disabled={compressing || !doneItems.length} onClick={clearDone}>清空已完成</button><button type="button" className="ic-btn is-secondary" disabled><Icon name="scissors" />本页抠图</button><button type="button" className="ic-btn is-secondary" disabled={!doneItems.length || zipBusy} onClick={downloadDone}><Icon name={doneItems.length > 1 ? "file-earmark-zip" : "download"} />{zipBusy ? (doneItems.length > 1 ? "打包中…" : "下载中…") : doneItems.length > 1 ? `下载 ZIP（${doneItems.length}）` : "下载图片"}</button><button type="button" className="ic-btn is-primary" disabled={compressing || !items.length} onClick={compressAll}><Icon name={compressing ? "arrow-repeat" : "lightning-charge"} className={compressing ? "ic-spin" : ""} />{compressing ? "压缩中…" : "开始压缩"}</button></div></footer>
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => { addFiles(event.target.files); event.target.value = ""; }} />
    </main>
  );
}
