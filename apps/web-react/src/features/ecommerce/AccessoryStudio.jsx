import { useEffect, useState } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import "./AccessoryStudio.css";

function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return value >= 100 ? String(value) : String(value).padStart(2, "0");
}

function groupAccessoryHistory(history) {
  const groups = [];
  const seen = new Map();
  for (const row of history || []) {
    const id = String(row.groupId || row.task?.id || row.url || "");
    if (!id) continue;
    let group = seen.get(id);
    if (!group) {
      group = { id, rows: [] };
      seen.set(id, group);
      groups.push(group);
    }
    const index = Number(row.index || 0);
    if (!group.rows.some((item) => Number(item.index || 0) === index)) {
      group.rows.push(row);
    }
  }
  for (const group of groups) {
    group.rows.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  }
  return groups;
}

const REFERENCE_SLOTS = [
  { role: "product", label: "饰品", required: true, icon: "bi-gem" },
  { role: "model", label: "模特", required: false, icon: "bi-person" },
  { role: "scene", label: "场景", required: false, icon: "bi-image" },
];

function ReferenceGrid({
  references = [],
  running,
  onUpload,
  onUploadSlot,
  onRemove,
  onPreview,
  onDropSlot,
  sceneIgnoredWithoutModel = false,
}) {
  function requestUpload(role) {
    if (onUploadSlot) onUploadSlot(role);
    else onUpload?.();
  }

  function handleSlotDrop(role, event) {
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (!files?.length) return;
    if (onDropSlot) onDropSlot(role, files);
    else onUploadSlot?.(role);
  }

  return (
    <div className="accessory-references" aria-label="饰品穿戴参考图">
      {REFERENCE_SLOTS.map((slot, index) => {
        const item = references[index];
        return item?.url ? (
          <figure
            key={`${slot.role}-${item.url}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleSlotDrop(slot.role, event)}
          >
            <button
              type="button"
              className="accessory-reference__preview"
              aria-label={`查看${slot.label}参考图`}
              onClick={() => onPreview?.(item.url)}
            >
              <img src={item.url} alt={`${slot.label}参考图`} />
            </button>
            <figcaption>
              <span>{slot.label}</span>
              <small>{slot.required ? "必填" : "可选"}</small>
            </figcaption>
            <button
              type="button"
              className="accessory-reference__remove"
              aria-label={`移除${slot.label}参考图`}
              disabled={running}
              onClick={() => onRemove?.(slot.role, index)}
            >
              <i className="bi bi-x-lg" />
            </button>
          </figure>
        ) : (
          <button
            key={slot.role}
            type="button"
            className="accessory-reference__empty"
            aria-label={`上传${slot.label}参考图`}
            disabled={running}
            onClick={() => requestUpload(slot.role)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => handleSlotDrop(slot.role, event)}
          >
            <i className={`bi ${slot.icon}`} />
            <strong>{slot.label}</strong>
            <small>{slot.required ? "必填" : "可选"}</small>
          </button>
        );
      })}
      {sceneIgnoredWithoutModel ? (
        <p className="accessory-reference-hint" role="status">
          已上传场景但缺少模特：生成时不会使用场景图，避免角色错位。
        </p>
      ) : null}
    </div>
  );
}

export function AccessoryStudio({
  references = [],
  aspectRatio,
  resultUrl = "",
  history = [],
  packOptions = [],
  running,
  failed,
  failMessage = "",
  notice = "",
  elapsedSeconds = 0,
  generateDisabled,
  generateHint = "",
  onGenerate,
  onCancel,
  onUpload,
  onUploadSlot,
  onRemoveReference,
  onDrop,
  onDropSlot,
  sceneIgnoredWithoutModel = false,
  onSelectHistory,
  onPreview,
  onResultPreview,
  onMaskEdit,
  onDownload,
  actionBusy = false,
  onSaveAsset,
  onDownloadPack,
  cancelling,
}) {
  const [runSeconds, setRunSeconds] = useState(0);

  useEffect(() => {
    if (!running) return undefined;
    setRunSeconds(0);
    const started = Date.now();
    const timer = window.setInterval(() => {
      setRunSeconds(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [running]);

  const waitSeconds = running ? runSeconds : elapsedSeconds;
  const ratio = String(aspectRatio || "4:5");
  const ratioValue = ratio.replace(":", " / ");
  const historyGroups = groupAccessoryHistory(history);
  const activeGroup =
    historyGroups.find((group) =>
      group.rows.some((row) => row.url === resultUrl),
    ) || historyGroups[0];
  const activeRows = activeGroup?.rows || [];
  const displayRow =
    activeRows.find((row) => row.url === resultUrl) || activeRows[0] || null;
  const displayUrl = resultUrl || displayRow?.url || "";
  // 主舞台大图优先展示图（服务端压缩大图），404 回退原图
  const stageDisplayUrl =
    (history || []).find((row) => row.url === displayUrl)?.display || "";

  function handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length) onDrop?.(files);
  }

  return (
    <div className="accessory-studio" aria-label="饰品商业出图工作台">
      <section
        className="accessory-output"
        aria-label="饰品生成结果"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <div
          className={`accessory-workbench${displayUrl ? " has-result" : ""}`}
          aria-label="饰品画布输入"
        >
          <aside
            className="accessory-workbench__panel accessory-workbench__panel--left"
            aria-label="饰品参考图"
          >
            <div className="accessory-section accessory-canvas-reference">
              <ReferenceGrid
                references={references}
                running={running}
                onUpload={onUpload}
                onUploadSlot={onUploadSlot}
                onRemove={onRemoveReference}
                onPreview={onPreview}
                onDropSlot={onDropSlot}
                sceneIgnoredWithoutModel={sceneIgnoredWithoutModel}
              />
              {notice ? (
                <p className="accessory-notice" role="status">
                  {notice}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              className={`accessory-submit${running ? " is-running" : ""}${failed ? " is-failed" : ""}`}
              disabled={running ? cancelling : generateDisabled}
              title={!running && generateDisabled ? generateHint : undefined}
              onClick={running ? onCancel : onGenerate}
            >
              <i
                className={`bi ${running ? "bi-stop-fill" : failed ? "bi-arrow-clockwise" : "bi-stars"}`}
              />
              {running
                ? cancelling
                  ? "正在停止"
                  : "停止生成"
                : failed
                  ? "重新生成"
                  : "生成饰品商业图"}
            </button>
          </aside>

          <main className="accessory-workbench__canvas">
            <div
              className="accessory-current-set"
              style={{ "--accessory-ratio": ratioValue }}
            >
              <div
                className={`accessory-frame${displayUrl ? " has-image" : ""}`}
                style={{ "--accessory-ratio": ratioValue }}
                data-ratio={ratio}
              >
                {displayUrl ? (
                  <button
                    type="button"
                    className="accessory-frame__shot"
                    aria-label="查看饰品生成结果"
                    aria-pressed="true"
                    onClick={(event) => {
                      onSelectHistory?.(displayUrl);
                      onResultPreview?.(event, {
                        url: displayUrl,
                        alt: "饰品生成结果",
                        title: "饰品生成结果",
                      });
                    }}
                  >
                    <AuthenticatedImage
                      src={stageDisplayUrl || displayUrl}
                      fallbackSrc={displayUrl}
                      alt="饰品生成结果"
                    />
                  </button>
                ) : (
                  <div className="accessory-frame__empty">
                    <i
                      className={`bi ${running ? "bi-stars" : failed ? "bi-exclamation-triangle" : "bi-gem"}`}
                    />
                    <strong>
                      {running
                        ? "正在生成商业母版"
                        : failed
                          ? "本次生成未完成"
                          : "还没有结果"}
                    </strong>
                    <span>
                      {running
                        ? `已等待 ${formatSeconds(waitSeconds)} 秒`
                        : failed
                          ? failMessage || "调整参考图或参数后重新生成"
                          : references.length
                            ? generateHint
                            : "上传饰品图后开始配置"}
                    </span>
                  </div>
                )}
                {running ? (
                  <span className="accessory-frame__elapsed">
                    {formatSeconds(waitSeconds)}s
                  </span>
                ) : null}
                {displayUrl ? (
                  <div
                    className="accessory-frame__actions"
                    aria-label="饰品结果操作"
                  >
                    <button
                      type="button"
                      disabled={!onMaskEdit || running}
                      onClick={onMaskEdit}
                    >
                      <i className="bi bi-brush" />
                      局部修正
                    </button>
                    <button
                      type="button"
                      disabled={!onDownload}
                      onClick={onDownload}
                    >
                      <i className="bi bi-download" />
                      下载
                    </button>
                    <button
                      type="button"
                      disabled={!onSaveAsset || actionBusy}
                      onClick={onSaveAsset}
                    >
                      <i className="bi bi-collection" />
                      存入素材库
                    </button>
                    {activeRows.length > 1 ? (
                      <button
                        type="button"
                        disabled={!onDownloadPack || actionBusy}
                        onClick={onDownloadPack}
                      >
                        <i className="bi bi-file-earmark-zip" />
                        下载套图
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {activeRows.length > 1 ? (
                <div
                  className="accessory-current-set__thumbs"
                  role="list"
                  aria-label="本次饰品套图"
                >
                  {activeRows.map((row, index) => {
                    const spec = row?.task?.params?.accessorySpec || {};
                    const label = spec.shotLabel || `第 ${index + 1} 张`;
                    return (
                      <button
                        key={row.url}
                        type="button"
                        role="listitem"
                        className={`accessory-current-set__thumb${row.url === displayUrl ? " is-active" : ""}`}
                        aria-label={label}
                        aria-pressed={row.url === displayUrl}
                        onClick={() => onSelectHistory?.(row.url)}
                      >
                        <AuthenticatedImage
                          src={row.preview || row.url}
                          alt=""
                        />
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </main>

          <aside className="accessory-history" aria-label="饰品生成历史">
            <p className="accessory-history__label">历史</p>
            {historyGroups.length ? (
              <div className="accessory-history__list" role="list">
                {historyGroups.map((group) => {
                  const cover = group.rows[0];
                  const count = Math.max(
                    group.rows.length,
                    Number(cover?.groupSize) || 0,
                  );
                  const active = group === activeGroup;
                  const mosaic = count > 1 ? group.rows.slice(0, 4) : [];
                  const spec = cover?.task?.params?.accessorySpec || {};
                  const packLabel =
                    packOptions.find((item) => item.id === spec.pack)?.label ||
                    "饰品穿戴";
                  return (
                    <button
                      key={group.id}
                      type="button"
                      role="listitem"
                      className={`accessory-history__item${active ? " is-active" : ""}`}
                      disabled={running}
                      aria-label={`${packLabel}${count > 1 ? `，共 ${count} 张` : ""}`}
                      aria-pressed={active}
                      onClick={() => {
                        const current = group.rows.find(
                          (row) => row.url === displayUrl,
                        );
                        onSelectHistory?.(current?.url || cover?.url);
                      }}
                    >
                      <span
                        className="accessory-history__shot"
                        style={{
                          "--accessory-history-ratio": String(
                            cover?.aspectRatio || spec.aspectRatio || "4:5",
                          ).replace(":", " / "),
                        }}
                      >
                        {mosaic.length ? (
                          <span
                            className="accessory-history__mosaic"
                            data-count={Math.min(4, mosaic.length)}
                          >
                            {mosaic.map((row) => (
                              <AuthenticatedImage
                                key={row.url}
                                src={row.preview || row.url}
                                alt=""
                              />
                            ))}
                          </span>
                        ) : (
                          <AuthenticatedImage
                            src={cover?.preview || cover?.url}
                            alt=""
                          />
                        )}
                        {count > 1 ? (
                          <span className="accessory-history__count">
                            {count}
                          </span>
                        ) : null}
                      </span>
                      <span className="accessory-history__meta">
                        <strong>{packLabel}</strong>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="accessory-history__empty">
                <i className="bi bi-clock-history" />
                <span>暂无记录</span>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
