import { useEffect, useState } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { RegenerateIcon } from "../../components/common/RegenerateIcon.jsx";
import { CommerceSelect } from "./CommerceSelect.jsx";
import { accessoryShotBlueprints } from "./accessory/accessoryCommerce.js";
import {
  HandheldGeneratingStage,
  HandheldRefCard,
} from "./HandheldStudio.jsx";
import "./HandheldStudio.css";
import "./AccessoryStudio.css";

function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return value >= 100 ? String(value) : String(value).padStart(2, "0");
}

function channelRatioVar(ratio) {
  const [w, h] = String(ratio || "4:5").split(":");
  return `${w || 4} / ${h || 5}`;
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

const ACCESSORY_RATIO_CHANNELS = [
  { id: "1:1", label: "方图", ratio: "1:1", hint: "货架主图" },
  { id: "3:4", label: "详情", ratio: "3:4", hint: "详情页配图" },
  { id: "4:5", label: "竖图", ratio: "4:5", hint: "通用竖构图" },
  { id: "9:16", label: "竖屏", ratio: "9:16", hint: "信息流投放" },
];

export function AccessoryStudio({
  references = [],
  aspectRatio,
  ratioStyle,
  onChangeRatio,
  resultUrl = "",
  history = [],
  pack,
  packOptions = [],
  onChangePack,
  crop,
  cropOptions = [],
  onChangeCrop,
  running,
  failed,
  failMessage = "",
  notice = "",
  elapsedSeconds = 0,
  generationStageLabel = "正在生成",
  generateDisabled,
  generateHint = "",
  shotCount = 1,
  costLabel = "",
  onGenerate,
  onCancel,
  onUploadSlot,
  onRemoveReference,
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
  const product = references[0] || null;
  const model = references[1] || null;
  const scene = references[2] || null;

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
  const posterRatio = String(aspectRatio || "4:5");
  const frameStyle = ratioStyle || {
    "--commerce-shot-ratio": posterRatio.replace(":", " / "),
  };
  const historyGroups = groupAccessoryHistory(history);
  const selectedPack =
    packOptions.find((item) => item.id === pack) || packOptions[0];
  const selectedChannel =
    ACCESSORY_RATIO_CHANNELS.find((item) => item.id === posterRatio) ||
    ACCESSORY_RATIO_CHANNELS[2];
  const planned = accessoryShotBlueprints(selectedPack?.id || pack);
  const activeGroup =
    historyGroups.find((group) =>
      group.rows.some((row) => row.url === resultUrl),
    ) || historyGroups[0];
  const activeRows = activeGroup?.rows || [];
  const plannedShots = planned.map((shot, index) => {
    const row = activeRows[index];
    const url = row?.url || (index === 0 && !activeRows.length ? resultUrl : "");
    return {
      id: shot.id || `${selectedPack?.id || "shot"}-${index}`,
      label: shot.label || `第 ${index + 1} 张`,
      url,
      preview: row?.preview || url,
      running: Boolean(running && !url),
      failed: Boolean(failed && !url && index === 0),
    };
  });
  const displayShot =
    plannedShots.find((item) => item.url && item.url === resultUrl) ||
    plannedShots.find((item) => item.url) ||
    plannedShots.find((item) => item.running) ||
    plannedShots[0];
  const displayUrl = resultUrl || displayShot?.url || "";
  const stageDisplayUrl =
    (history || []).find((row) => row.url === displayUrl)?.display || "";
  const packThumbs = plannedShots.length > 1 ? plannedShots : [];
  const hasImage = Boolean(displayUrl) && !running && !displayShot?.failed;

  function previewReference(event, payload) {
    const url = payload?.url;
    if (url) onPreview?.(url);
  }

  function uploadRole(role) {
    onUploadSlot?.(role);
  }

  function dropRole(role) {
    return (files) => onDropSlot?.(role, files);
  }

  const cropOverlay = (
    <div className="handheld-ref-card__crop">
      <CommerceSelect
        value={crop}
        options={cropOptions.map((item) => ({
          value: item.id,
          label: item.label,
        }))}
        onChange={onChangeCrop}
        ariaLabel="选择出镜范围"
        menuMinWidth={168}
        disabled={running}
      />
    </div>
  );

  return (
    <div className="accessory-studio" aria-label="饰品商业出图工作台">
      <section
        className={`accessory-output handheld-out${running ? " is-running" : ""}`}
        aria-label="饰品生成结果"
      >
        {notice || sceneIgnoredWithoutModel ? (
          <p className="handheld-pane__notice" role="status">
            {sceneIgnoredWithoutModel
              ? "已上传场景但缺少模特：生成时不会使用场景图，避免角色错位。"
              : notice}
          </p>
        ) : null}

        <div
          className="handheld-board handheld-board--top"
          aria-label="饰品画布输入"
        >
          <div className="handheld-board__refs">
            <HandheldRefCard
              className="handheld-product handheld-product--canvas"
              tag="饰品"
              image={product?.url || ""}
              emptyIcon="bi-gem"
              emptyLabel="拖拽或点击"
              emptyAria="上传饰品参考图"
              previewAria="查看饰品参考图"
              previewAlt="饰品参考图"
              previewTitle="饰品"
              groupAria="饰品图操作"
              uploadAria="上传饰品图"
              showMore={false}
              showClear
              clearAria="清空饰品参考图"
              disabled={running}
              onPreview={previewReference}
              onUpload={() => uploadRole("product")}
              onClear={() => onRemoveReference?.("product")}
              onDrop={dropRole("product")}
            />
            <HandheldRefCard
              className="handheld-scene handheld-scene--canvas"
              tag="场景"
              image={scene?.url || ""}
              emptyIcon="bi-image"
              emptyLabel="选择场景"
              emptyAria="上传场景参考图"
              previewAria="查看场景参考图"
              previewAlt="场景参考图"
              previewTitle="场景"
              groupAria="场景图操作"
              uploadAria="上传场景图"
              clearAria="清空场景参考图"
              showMore={false}
              showClear
              disabled={running}
              onPreview={previewReference}
              onUpload={() => uploadRole("scene")}
              onClear={() => onRemoveReference?.("scene")}
              onDrop={dropRole("scene")}
            />
          </div>
          <div className="handheld-brief handheld-brief--canvas">
            <div className="handheld-platform">
              <div className="handheld-brief__head">
                <span className="handheld-brief__kicker">投放到</span>
                {selectedChannel ? (
                  <span className="handheld-brief__meta">
                    {selectedChannel.hint}
                  </span>
                ) : null}
              </div>
              <div
                className="handheld-channels"
                role="radiogroup"
                aria-label="选择投放比例"
              >
                {ACCESSORY_RATIO_CHANNELS.map((item) => {
                  const active = posterRatio === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      aria-label={item.label}
                      title={item.hint}
                      className={active ? "is-active" : ""}
                      disabled={running}
                      onClick={() => onChangeRatio?.(item.id)}
                    >
                      <span
                        className="handheld-channels__frame"
                        style={{
                          "--channel-ratio": channelRatioVar(item.ratio),
                        }}
                        aria-hidden="true"
                      />
                      <span className="handheld-channels__name">
                        {item.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="handheld-pack">
              <div
                className="handheld-packs"
                role="radiogroup"
                aria-label="选择出图任务"
              >
                {packOptions.map((item) => {
                  const active = (selectedPack?.id || pack) === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      className={active ? "is-active" : ""}
                      disabled={running}
                      onClick={() => onChangePack?.(item.id)}
                    >
                      <strong>{item.label}</strong>
                      <em>
                        {item.countLabel || `${item.shotIds?.length || 1}张`}
                      </em>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="handheld-ref-stack">
          <div className="handheld-crop handheld-crop--canvas">
            <HandheldRefCard
              className="handheld-model"
              tag="模特"
              overlay={cropOverlay}
              image={model?.url || ""}
              emptyIcon="bi-person"
              emptyLabel="选择模特"
              emptyAria="上传模特参考图"
              previewAria="查看模特参考图"
              previewAlt="模特参考图"
              previewTitle="模特"
              groupAria="模特图操作"
              uploadAria="上传模特图"
              clearAria="清空模特参考图"
              showMore={false}
              showClear
              disabled={running}
              onPreview={previewReference}
              onUpload={() => uploadRole("model")}
              onClear={() => onRemoveReference?.("model")}
              onDrop={dropRole("model")}
            />
          </div>
        </div>

        <div
          className="handheld-shots"
          data-count={1}
          data-ratio={posterRatio}
          style={frameStyle}
        >
          <div
            className={`handheld-shot-stage${packThumbs.length ? " has-thumbs" : ""}`}
          >
            <div
              className={`handheld-frame${hasImage ? " has-image" : ""}${running ? " is-running" : ""}${failed && !displayUrl ? " is-failed" : ""}${displayUrl ? " is-selected" : ""}`}
              data-ratio={posterRatio}
              style={frameStyle}
            >
              {running ? (
                <HandheldGeneratingStage
                  productUrl={product?.url || ""}
                  sceneImage={scene?.url || ""}
                  label={displayShot?.label || "饰品商业图"}
                  seconds={waitSeconds}
                  generationStageLabel={generationStageLabel}
                />
              ) : failed && !displayUrl ? (
                <div className="handheld-frame__status" role="alert">
                  <strong>本次生成未完成</strong>
                  <span>{failMessage || "调整参考图或参数后重新生成"}</span>
                </div>
              ) : displayUrl ? (
                <button
                  type="button"
                  className="handheld-frame__shot"
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
                <div className="handheld-frame__status">
                  <strong>还没有结果</strong>
                  <span>
                    {references.some((item) => item?.url)
                      ? generateHint || "配置完成后点生成"
                      : "上传饰品图后开始配置"}
                  </span>
                </div>
              )}
              {displayShot?.label ? (
                <small className="handheld-frame__label">
                  {displayShot.label}
                </small>
              ) : null}
              {displayUrl && !running && waitSeconds > 0 ? (
                <span
                  className="handheld-frame__elapsed"
                  aria-label={`生成耗时 ${waitSeconds} 秒`}
                >
                  {formatSeconds(waitSeconds)}秒
                </span>
              ) : null}
              <div className="handheld-actions">
                <button
                  type="button"
                  className={`handheld-submit handheld-submit--frame${running ? " is-running" : ""}${failed ? " is-failed" : ""}`}
                  disabled={running ? cancelling : generateDisabled}
                  title={!running && generateDisabled ? generateHint : undefined}
                  aria-label={
                    running
                      ? cancelling
                        ? "正在停止"
                        : "停止生成"
                      : failed
                        ? `重试生成饰品图（${shotCount}张）`
                        : `生成饰品商业图（${shotCount}张）`
                  }
                  onClick={running ? onCancel : onGenerate}
                >
                  {running ? (
                    <span
                      className="handheld-submit__spinner"
                      aria-hidden="true"
                    />
                  ) : failed ? (
                    <RegenerateIcon />
                  ) : (
                    <i className="bi bi-stars" aria-hidden="true" />
                  )}
                  <span>
                    {running
                      ? cancelling
                        ? "停止中"
                        : "停止"
                      : failed
                        ? "重试"
                        : "生成"}
                  </span>
                  <small>
                    {running
                      ? cancelling
                        ? "正在停止"
                        : generationStageLabel
                      : `${shotCount}张${costLabel ? ` · ${costLabel}` : ""}`}
                  </small>
                </button>
                {displayUrl && !running ? (
                  <span
                    className="accessory-frame__actions"
                    aria-label="饰品结果操作"
                  >
                    <button
                      type="button"
                      disabled={!onMaskEdit}
                      onClick={onMaskEdit}
                    >
                      局部修正
                    </button>
                    <button
                      type="button"
                      disabled={!onDownload}
                      onClick={onDownload}
                    >
                      下载
                    </button>
                    <button
                      type="button"
                      disabled={!onSaveAsset || actionBusy}
                      onClick={onSaveAsset}
                    >
                      存入素材库
                    </button>
                    {activeRows.length > 1 ? (
                      <button
                        type="button"
                        disabled={!onDownloadPack || actionBusy}
                        onClick={onDownloadPack}
                      >
                        下载套图
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
            {packThumbs.length ? (
              <div
                className="handheld-frame__thumbs"
                role="list"
                aria-label="本次饰品套图"
              >
                {packThumbs.map((item, thumbIndex) => {
                  const thumbActive =
                    (item.url && item.url === displayUrl) ||
                    (!item.url && item === displayShot);
                  const thumbPending =
                    !item.url && !item.failed && (item.running || running);
                  const thumbFailed = Boolean(item.failed) && !item.running;
                  return (
                    <button
                      key={item.id || `thumb-${thumbIndex}`}
                      type="button"
                      role="listitem"
                      className={`handheld-frame__thumb${thumbActive ? " is-active" : ""}${thumbPending ? " is-pending" : ""}${thumbFailed ? " is-failed" : ""}`}
                      disabled={thumbPending || (!item.url && !thumbFailed)}
                      aria-label={item.label || `第 ${thumbIndex + 1} 张`}
                      aria-pressed={thumbActive}
                      onClick={() => {
                        if (item.url) onSelectHistory?.(item.url);
                      }}
                    >
                      {item.url ? (
                        <AuthenticatedImage
                          src={item.preview || item.url}
                          alt=""
                        />
                      ) : thumbFailed ? (
                        <span className="handheld-frame__thumb-failed">
                          <RegenerateIcon />
                          <small>重试</small>
                        </span>
                      ) : thumbPending ? (
                        <span className="handheld-frame__thumb-pending">
                          <i
                            className="handheld-frame__thumb-spin"
                            aria-hidden="true"
                          />
                        </span>
                      ) : (
                        <span className="handheld-frame__thumb-empty">
                          {String(thumbIndex + 1).padStart(2, "0")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <aside className="handheld-history" aria-label="饰品生成历史">
          <p className="handheld-history__label">历史</p>
          {historyGroups.length ? (
            <div className="handheld-history__list" role="list">
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
                    className={`handheld-history__item${count > 1 ? " is-set" : ""}${active ? " is-active" : ""}`}
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
                      className="handheld-history__shot"
                      style={{
                        "--handheld-history-ratio": channelRatioVar(
                          cover?.aspectRatio || spec.aspectRatio || "4:5",
                        ),
                      }}
                    >
                      {mosaic.length ? (
                        <span
                          className="handheld-history__mosaic"
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
                        <span className="handheld-history__count">{count}</span>
                      ) : null}
                    </span>
                    <span className="handheld-history__meta">
                      <strong>{packLabel}</strong>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="handheld-history__empty">
              <i className="bi bi-clock-history" />
              <span>暂无记录</span>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
