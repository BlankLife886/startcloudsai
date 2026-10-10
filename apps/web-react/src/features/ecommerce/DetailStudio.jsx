import { useEffect, useMemo, useRef, useState } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { RegenerateIcon } from "../../components/common/RegenerateIcon.jsx";
import { CommerceSelect } from "./CommerceSelect.jsx";
import {
  APLUS_CATEGORIES,
  APLUS_MARKETPLACES,
  APLUS_TIERS,
  aplusCategoryById,
  searchAplusCategories,
} from "./aplus/amazonAplus.js";
import { DETAIL_NOTE_MAX } from "./aplus/detailPage.js";
import { HandheldGeneratingStage, HandheldRefCard } from "./HandheldStudio.jsx";
import {
  TypePicker,
  WorkbenchGuides,
  WorkbenchHistory,
  formatSeconds,
  groupHistory,
  ratioVar,
} from "./workbench/CommerceWorkbench.jsx";
import "./HandheldStudio.css";
import "./workbench/CommerceWorkbench.css";
import "./DetailStudio.css";

function isDirectPreviewUrl(src = "") {
  return /^(blob:|data:)/i.test(String(src));
}

function ProductThumb({ src, alt }) {
  if (isDirectPreviewUrl(src)) {
    return <img src={src} alt={alt} draggable="false" />;
  }
  return (
    <AuthenticatedImage src={src} alt={alt} loading="eager" keepLoaded />
  );
}

const ACTIVE_MODULE_STATUS = new Set(["running", "waiting_provider"]);
const FAILED_MODULE_STATUS = new Set(["failed", "canceled", "cancelled"]);

function secondsSince(timestamp, now) {
  const started = Date.parse(timestamp || "");
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

// 补充参考卡：模特 / 细节 / 证书等事实依据，最多 3 张，沿用 handheld-ref-card 外观
function ExtraReferenceCard({
  items = [],
  limit = 0,
  max = 3,
  running,
  onUpload,
  onRemove,
  onPreview,
  onDrop,
}) {
  const hasItems = items.length > 0;
  const canAdd = !running && limit > 0 && items.length < limit;
  return (
    <div
      className={`handheld-ref-card workbench-slot workbench-slot--left detail-extras${hasItems ? " has-file" : " is-empty"}`}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const files = event.dataTransfer?.files;
        if (files?.length && !running) onDrop?.(files);
      }}
    >
      <span className="handheld-ref-card__tag">
        补充参考 · 可选
        {hasItems ? (
          <small>
            {items.length}/{max}
          </small>
        ) : null}
      </span>
      {hasItems ? (
        <div className="detail-extras__grid" data-count={items.length}>
          {items.map((item, index) => (
            <span key={`${item.url}-${index}`} className="detail-extras__item">
              <button
                type="button"
                className="detail-extras__shot"
                aria-label={`查看补充参考图 ${index + 1}`}
                onClick={() => onPreview?.(item.url)}
              >
                <ProductThumb src={item.url} alt={`补充参考图 ${index + 1}`} />
              </button>
              <button
                type="button"
                className="workbench-angles__remove"
                aria-label={`移除补充参考图 ${index + 1}`}
                disabled={running}
                onClick={() => onRemove?.(index)}
              >
                <i className="bi bi-x" />
              </button>
            </span>
          ))}
          {canAdd ? (
            <button
              type="button"
              className="detail-extras__add"
              aria-label="继续添加补充参考图"
              onClick={onUpload}
            >
              <i className="bi bi-plus-lg" />
            </button>
          ) : null}
        </div>
      ) : (
        <button
          type="button"
          className="handheld-ref-card__hit is-upload"
          aria-label="上传补充参考图"
          disabled={running || limit <= 0}
          title={limit <= 0 ? "商品图与补充参考图合计最多 6 张" : undefined}
          onClick={onUpload}
        >
          <i className="bi bi-paperclip" />
          <span>模特 / 细节 / 证书</span>
          <small>{limit <= 0 ? "参考图已满" : `最多 ${max} 张`}</small>
        </button>
      )}
      {hasItems ? (
        <div
          className="handheld-ref-card__actions"
          role="group"
          aria-label="补充参考图操作"
        >
          <button
            type="button"
            disabled={!canAdd}
            aria-label="添加补充参考图"
            onClick={onUpload}
          >
            <i className="bi bi-cloud-arrow-up" />
            上传
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function DetailStudio({
  previews = [],
  maxProductFiles = 6,
  extraSlots = [],
  maxExtraFiles = 3,
  onUploadExtra,
  onDropExtraFiles,
  onRemoveExtraFile,
  directions = [],
  customDirections = [],
  maxCustomDirections = 4,
  selectedDirectionIds = [],
  onToggleDirection,
  onAddCustomDirection,
  onRemoveCustomDirection,
  note = "",
  onChangeNote,
  ratio = "3:4",
  ratioOptions = [],
  onChangeRatio,
  resolution = "",
  resolutionOptions = [],
  onChangeResolution,
  platform = "",
  language = "",
  amazon = {},
  category = {},
  plan = {},
  blueprints = [],
  resultUrl = "",
  history = [],
  // 本轮每个版块的实时状态（来自任务列表）：{ url, display, status, startedAt, error }
  moduleStates = [],
  // 本轮任务的创建时间：刷新页面后计时从这里续接，而不是从 0 重新开始
  runStartedAt = "",
  running,
  failed,
  failMessage = "",
  elapsedSeconds = 0,
  generationStageLabel = "正在生成",
  generateDisabled,
  generateHint = "",
  shotCount = 1,
  costLabel = "",
  generateLabel = "一键生成",
  onGenerate,
  onCancel,
  onUpload,
  onRemoveFile,
  onDropFiles,
  onSelectHistory,
  onPreview,
  onResultPreview,
  onMaskEdit,
  onDownload,
  onExport,
  actionBusy = false,
  onSaveAsset,
  cancelling,
  showcaseSrc = "",
  showcaseAlt = "详情页案例预览",
  revision,
}) {
  const rootRef = useRef(null);
  const runOriginRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [categoryQuery, setCategoryQuery] = useState("");
  const [customDraft, setCustomDraft] = useState("");
  // 用户在缩略图条里点选的版块（没有成图的版块也能点开看策划文案）
  const [pickedIndex, setPickedIndex] = useState(-1);

  // 本轮起点优先取任务创建时间：刷新 / 重进页面后计时续接，不会归零
  const runStartedMs = useMemo(() => {
    const fromProp = Date.parse(runStartedAt || "");
    const fromModules = moduleStates
      .map((item) => Date.parse(item?.startedAt || ""))
      .filter(Number.isFinite);
    const candidates = [fromProp, ...fromModules].filter(Number.isFinite);
    return candidates.length ? Math.min(...candidates) : 0;
  }, [runStartedAt, moduleStates]);

  useEffect(() => {
    if (!running) {
      runOriginRef.current = 0;
      return undefined;
    }
    if (runStartedMs) {
      runOriginRef.current = runStartedMs;
    } else if (!runOriginRef.current) {
      runOriginRef.current = Date.now();
    }
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [running, runStartedMs]);

  const runSeconds =
    running && runOriginRef.current
      ? Math.max(0, Math.floor((now - runOriginRef.current) / 1000))
      : 0;

  const waitSeconds = running ? runSeconds : elapsedSeconds;
  const historyGroups = groupHistory(history);
  const activeGroup =
    historyGroups.find((group) =>
      group.rows.some((row) => row.url === resultUrl),
    ) || historyGroups[0];
  const stacked = useMemo(() => {
    const rows = activeGroup?.rows || [];
    const rowAt = (index) =>
      rows.find((row) => Number(row.index || 0) === index) || null;
    const total = Math.max(blueprints.length, running ? moduleStates.length : 0);
    if (total) {
      return Array.from({ length: total }, (_, index) => ({
        shot: blueprints[index] || {
          id: `module-${index}`,
          label: `版块 ${index + 1}`,
          aspectRatio: ratio,
        },
        row: rowAt(index),
        state: moduleStates[index] || null,
      }));
    }
    return rows.map((row, index) => ({
      shot: {
        id: `row-${index}`,
        label: `版块 ${index + 1}`,
        aspectRatio: row.aspectRatio || "3:4",
      },
      row,
      state: moduleStates[index] || null,
    }));
  }, [activeGroup, blueprints, moduleStates, running, ratio]);
  const moduleUrl = (item) =>
    item.row?.url || (running ? item.state?.url || "" : "");
  const hasAnyShot = stacked.some((item) => moduleUrl(item));
  const doneCount = stacked.filter((item) => moduleUrl(item)).length;
  const moduleStatus = (item) => String(item.state?.status || "").toLowerCase();
  const anyModuleActive = stacked.some(
    (item) => !moduleUrl(item) && ACTIVE_MODULE_STATUS.has(moduleStatus(item)),
  );
  const firstPendingIndex = stacked.findIndex(
    (item) => !moduleUrl(item) && !FAILED_MODULE_STATUS.has(moduleStatus(item)),
  );
  // 每个版块的展示态：舞台、缩略图条、右侧“本次出图”清单共用同一份
  const modules = stacked.map((item, index) => {
    const url = moduleUrl(item);
    const status = moduleStatus(item);
    const failedModule =
      !url && (Boolean(item.row?.failed) || FAILED_MODULE_STATUS.has(status));
    // 任务列表还没同步到状态时，把第一个待出的版块视为正在生成
    const active =
      !url &&
      running &&
      !failedModule &&
      (ACTIVE_MODULE_STATUS.has(status) ||
        (!anyModuleActive && index === firstPendingIndex));
    const queued = !url && running && !active && !failedModule;
    const seconds = active
      ? item.state?.startedAt
        ? secondsSince(item.state.startedAt, now)
        : runSeconds
      : 0;
    return {
      ...item,
      index,
      url,
      display: item.row?.display || item.state?.display || url,
      active,
      queued,
      failed: failedModule,
      seconds,
      error: item.state?.error || "",
    };
  });
  const planItemClass = (index) => {
    const module = modules[index];
    if (!module) return "";
    if (module.url) return "is-done";
    if (module.failed) return "is-failed";
    if (module.active) return "is-running";
    return "";
  };
  // 舞台展示哪个版块：用户点选 > 当前选中的成图 > 正在生成的 > 第一张成图 > 第一个待出
  // （点选有成图的版块会同步切换 resultUrl，随后清掉点选，回到跟随成图）
  useEffect(() => {
    setPickedIndex(-1);
  }, [resultUrl, running]);
  const displayModule =
    (pickedIndex >= 0 && modules[pickedIndex]) ||
    (resultUrl && modules.find((module) => module.url === resultUrl)) ||
    modules.find((module) => module.active) ||
    modules.find((module) => module.url) ||
    modules.find((module) => !module.failed) ||
    modules[0] ||
    null;
  const displayUrl = displayModule?.url || "";
  const hasImage = hasAnyShot && !running && !failed;
  const planned = Boolean(plan.planned);
  const planItems = useMemo(
    () => new Map((plan.data?.items || []).map((item) => [item.id, item])),
    [plan.data],
  );
  const selectedCount = selectedDirectionIds.length;
  const totalDirections = directions.length + customDirections.length;
  const categoryOptions = searchAplusCategories(categoryQuery);
  const amazonActive = Boolean(amazon.active);
  const productLimit = Math.max(0, maxProductFiles - extraSlots.length);
  const extraLimit = Math.max(
    0,
    Math.min(maxExtraFiles, maxProductFiles - previews.length),
  );
  const customTrimmed = customDraft.trim();
  const customFull = customDirections.length >= maxCustomDirections;
  const canAddCustom = customTrimmed.length > 0 && !customFull && !running;
  // 画框比例跟着当前展示的版块走：Amazon 用官方模块像素，其他平台用所选画幅
  const displaySpec = displayModule?.shot?.aplusSpec;
  const displayRatio = displaySpec
    ? `${displaySpec.width}:${displaySpec.height}`
    : displayModule?.shot?.aspectRatio || ratio;
  const [ratioW, ratioH] = displayRatio.split(":").map((value) => Number(value));
  const frameStyle = {
    "--commerce-shot-ratio": ratioVar(displayRatio),
    "--ratio-w": ratioW > 0 ? ratioW : 1,
    "--ratio-h": ratioH > 0 ? ratioH : 1,
  };
  const displaySizeLabel = displaySpec
    ? `${displaySpec.width}×${displaySpec.height}`
    : displayRatio;
  const platformTitle = amazonActive
    ? `${amazon.marketplaceLabel || "Amazon"} A+`
    : `${platform || "通用"} 详情页`;
  const hasProduct = Boolean(previews[0]);
  const angleItems = previews.slice(1);
  const displayShotCount = blueprints.length || shotCount;
  const pickerOptions = useMemo(
    () => [
      ...directions.map((item) => ({
        id: item.value,
        label: item.label,
        hint: item.hint,
      })),
      ...customDirections.map((item) => ({
        id: item.value,
        label: item.label,
        hint: "自定义方向",
        custom: true,
      })),
    ],
    [directions, customDirections],
  );
  const guideRevision = [
    previews.map((item) => item.url).join("|"),
    extraSlots.map((item) => item.url).join("|"),
    displayRatio,
    ratio,
    resolution,
    selectedDirectionIds.join("|"),
    customDirections.map((item) => item.value).join("|"),
    note.length > 0,
    amazonActive,
    planned,
    plan.planning,
    hasAnyShot,
    running,
    blueprints.length,
  ].join("::");

  function handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length && !running) onDropFiles?.(files);
  }
  function submitCustom() {
    if (!canAddCustom) return;
    onAddCustomDirection?.(customTrimmed);
    setCustomDraft("");
  }
  function selectAllDirections() {
    for (const item of pickerOptions) {
      if (!selectedDirectionIds.includes(item.id)) onToggleDirection?.(item.id);
    }
  }
  function clearDirections() {
    for (const id of selectedDirectionIds) onToggleDirection?.(id);
  }

  const emptySteps = [
    { label: "上传商品多角度图", done: hasProduct },
    { label: "勾选出图方向，补充品类与描述", done: hasProduct && selectedCount > 0 },
    {
      label: plan.autoGenerate ? "AI 策划文案后自动生成长图" : "AI 策划文案，确认后生成",
      done: planned,
    },
  ];

  return (
    <div
      className="commerce-workbench is-detail detail-studio"
      aria-label="AI 详情页工作台"
    >
      <section
        ref={rootRef}
        className={`workbench-output handheld-out detail-output has-right-slots${running ? " is-running" : ""}`}
        aria-label="详情页画布"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <WorkbenchGuides
          rootRef={rootRef}
          revision={guideRevision}
          running={running}
        />

        <div
          className="handheld-board handheld-board--top workbench-board"
          aria-label="画布输入"
        >
          <div className="handheld-board__refs workbench-refs">
            <HandheldRefCard
              className="workbench-slot workbench-slot--left handheld-product handheld-product--canvas detail-product"
              tag={hasProduct ? `商品图 · ${previews.length}/${productLimit}` : "商品图"}
              image={previews[0]?.url || ""}
              emptyIcon="bi-box-seam"
              emptyLabel="拖拽或点击"
              emptyAria="上传商品图"
              previewAria="查看商品图"
              previewAlt="商品图"
              previewTitle="商品图"
              groupAria="商品图操作"
              uploadAria="添加商品图"
              clearAria="清空商品图"
              showMore={false}
              showClear
              disabled={running}
              onPreview={(event, payload) => onPreview?.(payload.url)}
              onUpload={onUpload}
              onClear={() => onRemoveFile?.(0)}
              onDrop={(files) => onDropFiles?.(files)}
            />
            <ExtraReferenceCard
              items={extraSlots}
              limit={extraLimit}
              max={maxExtraFiles}
              running={running}
              onUpload={onUploadExtra}
              onRemove={onRemoveExtraFile}
              onPreview={onPreview}
              onDrop={onDropExtraFiles}
            />
            {hasProduct ? (
              <div className="workbench-angles" aria-label="更多角度">
                <span className="workbench-angles__label">
                  <i className="bi bi-collection" />
                  多角度
                  <small>
                    {previews.length}/{productLimit}
                  </small>
                </span>
                <div className="workbench-angles__list" role="list">
                  {angleItems.map((item, offset) => {
                    const index = offset + 1;
                    return (
                      <span
                        key={`${item.url}-${index}`}
                        className="workbench-angles__item"
                        role="listitem"
                      >
                        <button
                          type="button"
                          className="workbench-angles__shot"
                          aria-label={`查看商品图 ${index + 1}`}
                          onClick={() => onPreview?.(item.url)}
                        >
                          <ProductThumb src={item.url} alt="" />
                        </button>
                        <button
                          type="button"
                          className="workbench-angles__remove"
                          aria-label={`移除商品图 ${index + 1}`}
                          disabled={running}
                          onClick={() => onRemoveFile?.(index)}
                        >
                          <i className="bi bi-x" />
                        </button>
                      </span>
                    );
                  })}
                  {previews.length < productLimit ? (
                    <button
                      type="button"
                      className="workbench-angles__add"
                      aria-label="添加更多角度"
                      disabled={running}
                      onClick={onUpload}
                    >
                      <i className="bi bi-plus-lg" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="handheld-brief handheld-brief--canvas workbench-brief">
            <div className="handheld-platform">
              <div className="handheld-brief__head">
                <span className="handheld-brief__kicker">投放到</span>
                <span className="handheld-brief__meta">
                  {platformTitle} · {language || "简体中文"}
                </span>
              </div>
              {amazonActive ? (
                <div className="detail-official" role="note">
                  <i className="bi bi-lock-fill" aria-hidden="true" />
                  <div>
                    <strong>A+ 官方尺寸</strong>
                    <small>
                      每个模块按 {amazon.tier === "premium" ? "Premium" : "基础版"}
                      官方像素输出
                    </small>
                  </div>
                </div>
              ) : (
                <div
                  className="handheld-channels detail-channels"
                  role="radiogroup"
                  aria-label="选择详情页画幅"
                >
                  {ratioOptions.map((item) => {
                    const active = ratio === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        aria-label={item.label}
                        title={item.label}
                        className={active ? "is-active" : ""}
                        disabled={running}
                        onClick={() => onChangeRatio?.(item.value)}
                      >
                        <span
                          className="handheld-channels__frame"
                          style={{ "--channel-ratio": ratioVar(item.value) }}
                          aria-hidden="true"
                        />
                        <span className="handheld-channels__name">
                          {item.value}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="handheld-pack workbench-pack">
              <TypePicker
                running={running}
                picker={{
                  label: "出图方向",
                  meta: `已选 ${selectedCount}/${totalDirections}`,
                  options: pickerOptions,
                  values: selectedDirectionIds,
                  visibleLimit: 6,
                  onToggle: onToggleDirection,
                  onSelectAll: selectAllDirections,
                  onClear: clearDirections,
                  onRemove: onRemoveCustomDirection,
                  customNoun: "自定义方向",
                  footer: (
                    <form
                      className="detail-custom"
                      data-click-guard="repeat"
                      onSubmit={(event) => {
                        event.preventDefault();
                        submitCustom();
                      }}
                    >
                      <span className="workbench-picks__label">
                        自定义方向
                        <small>
                          {customDirections.length}/{maxCustomDirections}
                        </small>
                      </span>
                      <div className="detail-custom__row">
                        <input
                          value={customDraft}
                          maxLength={30}
                          aria-label="自定义出图方向"
                          placeholder={
                            customFull
                              ? `自定义方向最多 ${maxCustomDirections} 个`
                              : "例如：特定圣诞礼盒展示图"
                          }
                          disabled={running || customFull}
                          onChange={(event) => setCustomDraft(event.target.value)}
                        />
                        <button type="submit" disabled={!canAddCustom}>
                          <i className="bi bi-plus-lg" />
                          添加
                        </button>
                      </div>
                    </form>
                  ),
                }}
              />

              <div className="detail-brief">
                <div className="detail-brief__row">
                  <label className="detail-brief__field">
                    <span className="workbench-picks__label">品类</span>
                    <input
                      className="handheld-input"
                      value={categoryQuery || category.label || ""}
                      onChange={(event) => {
                        setCategoryQuery(event.target.value);
                        const match = aplusCategoryById(event.target.value);
                        if (match && match.id !== "generic") {
                          category.onChange?.(match.id);
                        } else {
                          const labeled = APLUS_CATEGORIES.find(
                            (item) => item.label === event.target.value,
                          );
                          if (labeled) category.onChange?.(labeled.id);
                        }
                      }}
                      list="detail-aplus-categories"
                      placeholder="灯泡、3C、家居…"
                      aria-label="商品品类"
                      disabled={running}
                    />
                    <datalist id="detail-aplus-categories">
                      {categoryOptions.map((item) => (
                        <option key={item.id} value={item.label} />
                      ))}
                    </datalist>
                  </label>
                  {resolutionOptions.length ? (
                    <div className="workbench-picks detail-brief__field" aria-label="清晰度">
                      <span className="workbench-picks__label">清晰度</span>
                      <div
                        className="handheld-picks"
                        role="radiogroup"
                        aria-label="选择清晰度"
                      >
                        {resolutionOptions.map((item) => (
                          <button
                            key={item}
                            type="button"
                            role="radio"
                            aria-checked={resolution === item}
                            className={resolution === item ? "is-active" : ""}
                            disabled={running}
                            onClick={() => onChangeResolution?.(item)}
                          >
                            {item}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <label className="workbench-note detail-note">
                  <span className="workbench-note__head">
                    <span className="workbench-picks__label">
                      补充描述
                      <small>（选填）</small>
                    </span>
                    <small className="workbench-note__count detail-note__count">
                      {note.length}/{DETAIL_NOTE_MAX}
                    </small>
                  </span>
                  <textarea
                    rows={2}
                    value={note}
                    maxLength={DETAIL_NOTE_MAX}
                    aria-label="补充描述（选填）"
                    onChange={(event) => onChangeNote?.(event.target.value)}
                    placeholder="适用人群、期望场景、具体参数、必须出现或禁止出现的元素…"
                    disabled={running}
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        <div
          className="handheld-shots detail-shots"
          data-count={1}
          data-ratio={displayRatio}
          style={frameStyle}
        >
          <div
            className={`handheld-shot-stage${modules.length > 1 ? " has-thumbs" : ""}`}
          >
            <div
              className={`handheld-frame detail-frame${hasImage ? " has-image" : ""}${running ? " is-running" : ""}${failed && !hasAnyShot ? " is-failed" : ""}${planned ? " is-planned" : ""}${displayUrl ? " is-selected" : ""}`}
              data-ratio={displayRatio}
              style={frameStyle}
            >
              <header className="detail-frame__head">
                <div className="detail-frame__title">
                  <em>{platformTitle}</em>
                  <span>
                    {displayShotCount} 个版块 · {language || "简体中文"}
                    {amazonActive ? " · 官方尺寸" : ` · ${ratio}`}
                    {resolution ? ` · ${resolution}` : ""}
                    {hasImage && waitSeconds > 0 ? (
                      <b aria-label={`生成耗时 ${waitSeconds} 秒`}>
                        {" "}
                        · 耗时 {formatSeconds(waitSeconds)}秒
                      </b>
                    ) : null}
                  </span>
                </div>
                {displayModule && (hasAnyShot || running || planned) ? (
                  <span className="detail-frame__module" aria-label="当前版块">
                    <b>
                      {displaySpec?.pepcf ||
                        String(displayModule.index + 1).padStart(2, "0")}
                    </b>
                    <strong>{displayModule.shot.label}</strong>
                    <small>{displaySizeLabel}</small>
                  </span>
                ) : null}
              </header>

              <div className="detail-frame__stage">
                {displayModule && displayUrl ? (
                  <button
                    type="button"
                    className="detail-page__shot"
                    aria-label={`查看${displayModule.shot.label}`}
                    aria-pressed="true"
                    disabled={running}
                    onClick={(event) => {
                      onSelectHistory?.(displayUrl);
                      onResultPreview?.(event, {
                        url: displayUrl,
                        alt: displayModule.shot.label,
                        title: displayModule.shot.headline || displayModule.shot.label,
                      });
                    }}
                  >
                    <AuthenticatedImage
                      src={displayModule.display || displayUrl}
                      fallbackSrc={displayUrl}
                      alt={displayModule.shot.headline || displayModule.shot.label}
                    />
                  </button>
                ) : displayModule && running && displayModule.active ? (
                  <HandheldGeneratingStage
                    productUrl={previews[0]?.url || ""}
                    sceneImage={extraSlots[0]?.url || ""}
                    label={displayModule.shot.label}
                    seconds={displayModule.seconds}
                    generationStageLabel={generationStageLabel}
                  />
                ) : displayModule && running ? (
                  <div className="detail-aplus__slot is-queued" role="status">
                    <strong>{displayModule.shot.headline || displayModule.shot.label}</strong>
                    <span>
                      排队中 · 已完成 {doneCount}/{modules.length}
                    </span>
                  </div>
                ) : displayModule && displayModule.failed ? (
                  <div className="detail-aplus__slot is-failed" role="alert">
                    <strong>该版块未生成</strong>
                    <span>{displayModule.error || failMessage || "可重新生成本轮"}</span>
                  </div>
                ) : failed && !hasAnyShot ? (
                  <div className="handheld-frame__status" role="alert">
                    <strong>本次生成未完成</strong>
                    <span>{failMessage || "调整参考图或出图方向后重新生成"}</span>
                  </div>
                ) : displayModule && (planned || hasAnyShot) ? (
                  <div className="detail-aplus__slot is-planned">
                    <strong>{displayModule.shot.headline || "待生成"}</strong>
                    <span>
                      {displayModule.shot.subline ||
                        planItems.get(displayModule.shot.id)?.direction ||
                        "生成后在此展示该版块"}
                    </span>
                  </div>
                ) : (
                  <div className="handheld-frame__status workbench-empty detail-empty">
                    {showcaseSrc ? (
                      <img
                        className="detail-frame__demo"
                        src={showcaseSrc}
                        alt={showcaseAlt}
                        aria-hidden="true"
                      />
                    ) : null}
                    <strong>还没有详情页版块图</strong>
                    <ol className="workbench-empty__steps">
                      {emptySteps.map((step, index) => (
                        <li key={step.label} className={step.done ? "is-done" : ""}>
                          <b>
                            {step.done ? (
                              <i className="bi bi-check-lg" />
                            ) : (
                              String(index + 1).padStart(2, "0")
                            )}
                          </b>
                          <span>{step.label}</span>
                        </li>
                      ))}
                    </ol>
                    <span>
                      {hasProduct
                        ? generateHint || "生成后按顺序拼接成详情长图"
                        : "上传商品图后开始配置"}
                    </span>
                  </div>
                )}
              </div>

              {running ? (
                <span className="workbench-frame__progress detail-frame__progress" role="status">
                  <i className="handheld-frame__thumb-spin" aria-hidden="true" />
                  {generationStageLabel} · {doneCount}/{modules.length} · {formatSeconds(waitSeconds)}s
                </span>
              ) : null}
              {revision?.available && revision.open && !running ? (
                <div
                  className="workbench-revision"
                  role="dialog"
                  aria-label="继续调整当前成品"
                >
                  <header>
                    <div>
                      <small>连续优化 · 当前 V{revision.version || 1}</small>
                      <strong>只描述这一轮要改的内容</strong>
                    </div>
                    <button
                      type="button"
                      aria-label="收起连续优化"
                      onClick={revision.onToggle}
                    >
                      <i className="bi bi-x-lg" />
                    </button>
                  </header>
                  <label className="workbench-revision__field">
                    <span>调整方向</span>
                    <CommerceSelect
                      value={revision.direction}
                      options={revision.directionOptions || []}
                      onChange={revision.onChangeDirection}
                      ariaLabel="选择调整方向"
                      menuMinWidth={200}
                    />
                  </label>
                  <label className="workbench-revision__field workbench-revision__field--brief">
                    <span>本轮只修改</span>
                    <textarea
                      value={revision.brief || ""}
                      onChange={(event) =>
                        revision.onChangeBrief?.(event.target.value)
                      }
                      placeholder="例如：商品再放大 15%，背景改为浅灰影棚，其他内容保持不变"
                    />
                    <small>{String(revision.brief || "").length}/600</small>
                  </label>
                  <footer>
                    <span>
                      <i className="bi bi-shield-check" />
                      上一版本会保留
                    </span>
                    <button
                      type="button"
                      disabled={String(revision.brief || "").trim().length < 4}
                      onClick={revision.onSubmit}
                    >
                      <i className="bi bi-arrow-repeat" />
                      生成 V{Number(revision.version || 1) + 1}
                    </button>
                  </footer>
                </div>
              ) : null}

              <div className="handheld-actions">
                <button
                  type="button"
                  className={`handheld-submit handheld-submit--frame detail-generate${running ? " is-running" : ""}${failed && !hasAnyShot ? " is-failed" : ""}${plan.planning && !running ? " is-planning" : ""}`}
                  disabled={running ? cancelling : generateDisabled || plan.planning}
                  title={!running && generateDisabled ? generateHint : undefined}
                  aria-label={
                    running
                      ? cancelling
                        ? "正在停止"
                        : "停止生成"
                      : plan.planning
                        ? "AI 正在策划"
                        : failed && !hasAnyShot
                          ? `重新生成（${shotCount}张）`
                          : generateLabel
                  }
                  onClick={running ? onCancel : onGenerate}
                >
                  {running || plan.planning ? (
                    <span className="handheld-submit__spinner" aria-hidden="true" />
                  ) : failed && !hasAnyShot ? (
                    <RegenerateIcon />
                  ) : planned ? (
                    <i className="bi bi-layout-text-window-reverse" aria-hidden="true" />
                  ) : (
                    <i className="bi bi-stars" aria-hidden="true" />
                  )}
                  <span>
                    {running
                      ? cancelling
                        ? "停止中"
                        : "停止"
                      : plan.planning
                        ? "AI 正在策划"
                        : failed && !hasAnyShot
                          ? "重新生成"
                          : generateLabel}
                  </span>
                  <small>
                    {running
                      ? cancelling
                        ? "正在停止"
                        : generationStageLabel
                      : plan.planning
                        ? "分析痛点与版块文案"
                        : planned || plan.autoGenerate
                          ? `${shotCount}张${costLabel ? ` · ${costLabel}` : ""}`
                          : `策划 ${shotCount} 个版块 · 不计费`}
                  </small>
                </button>
                {hasImage ? (
                  <span className="workbench-frame__actions" aria-label="结果操作">
                    {revision?.available ? (
                      <button
                        type="button"
                        className={revision.open ? "is-active" : ""}
                        aria-expanded={Boolean(revision.open)}
                        onClick={revision.onToggle}
                      >
                        <i className="bi bi-sliders2" />
                        连续优化
                      </button>
                    ) : null}
                    <button type="button" disabled={!onMaskEdit} onClick={onMaskEdit}>
                      局部修正
                    </button>
                    <button type="button" disabled={!onDownload} onClick={onDownload}>
                      下载
                    </button>
                    <button
                      type="button"
                      disabled={!onExport || actionBusy}
                      onClick={onExport}
                    >
                      导出图片+文案
                    </button>
                    {onSaveAsset ? (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={onSaveAsset}
                      >
                        存入素材库
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
            {modules.length > 1 ? (
              <div
                className="handheld-frame__thumbs detail-frame__thumbs"
                role="list"
                aria-label="本次版块"
              >
                {modules.map((module) => {
                  const thumbActive = module === displayModule;
                  const thumbPending = module.active || module.queued;
                  const thumbLabel = module.shot.label || `第 ${module.index + 1} 张`;
                  return (
                    <button
                      key={module.shot.id || `thumb-${module.index}`}
                      type="button"
                      role="listitem"
                      className={`handheld-frame__thumb${thumbActive ? " is-active" : ""}${thumbPending ? " is-pending" : ""}${module.failed ? " is-failed" : ""}${module.active ? " is-running" : ""}`}
                      disabled={running && !module.url}
                      aria-label={
                        module.failed
                          ? `${thumbLabel}（未生成）`
                          : module.active
                            ? `${thumbLabel}（生成中）`
                            : module.queued
                              ? `${thumbLabel}（排队中）`
                              : thumbLabel
                      }
                      aria-pressed={thumbActive}
                      title={`${thumbLabel} · ${
                        module.shot.aplusSpec
                          ? `${module.shot.aplusSpec.width}×${module.shot.aplusSpec.height}`
                          : module.shot.aspectRatio || ratio
                      }`}
                      onClick={() => {
                        setPickedIndex(module.index);
                        if (module.url) onSelectHistory?.(module.url);
                      }}
                    >
                      {module.url ? (
                        <AuthenticatedImage
                          src={module.row?.preview || module.display || module.url}
                          alt=""
                        />
                      ) : module.failed ? (
                        <span className="handheld-frame__thumb-failed">
                          <i className="bi bi-exclamation-lg" aria-hidden="true" />
                          <small>未生成</small>
                        </span>
                      ) : module.active ? (
                        <span className="handheld-frame__thumb-pending">
                          <i className="handheld-frame__thumb-spin" aria-hidden="true" />
                          <small>{formatSeconds(module.seconds)}s</small>
                        </span>
                      ) : module.queued ? (
                        <span className="handheld-frame__thumb-empty is-queued">
                          {String(module.index + 1).padStart(2, "0")}
                          <small>排队</small>
                        </span>
                      ) : (
                        <span className="handheld-frame__thumb-empty">
                          {String(module.index + 1).padStart(2, "0")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="handheld-ref-stack workbench-stack detail-stack">
          {amazonActive ? (
            <div
              className="workbench-plan detail-amazon"
              aria-label="Amazon A+ 高级选项"
            >
              <span className="handheld-ref-card__tag">
                <i className="bi bi-amazon" aria-hidden="true" />
                Amazon A+
              </span>
              <div className="detail-amazon__fields">
                <label>
                  <span>目标站</span>
                  <CommerceSelect
                    value={amazon.marketplaceId}
                    options={APLUS_MARKETPLACES.map((item) => ({
                      value: item.id,
                      label: item.label,
                    }))}
                    onChange={amazon.onChangeMarketplace}
                    ariaLabel="选择亚马逊站点"
                    disabled={running}
                  />
                </label>
                <label>
                  <span>档位</span>
                  <CommerceSelect
                    value={amazon.tier}
                    options={APLUS_TIERS.map((item) => ({
                      value: item.id,
                      label: item.label,
                    }))}
                    onChange={amazon.onChangeTier}
                    ariaLabel="选择 A+ 档位"
                    disabled={running}
                  />
                </label>
                <label>
                  <span>ASIN</span>
                  <input
                    value={amazon.asin || ""}
                    onChange={(event) => amazon.onChangeAsin?.(event.target.value)}
                    placeholder="可选"
                    aria-label="ASIN"
                    disabled={running}
                  />
                </label>
                <label>
                  <span>竞品 ASIN</span>
                  <input
                    value={amazon.competitorAsin || ""}
                    onChange={(event) =>
                      amazon.onChangeCompetitorAsin?.(event.target.value)
                    }
                    placeholder="可选"
                    aria-label="竞品 ASIN"
                    disabled={running}
                  />
                </label>
              </div>
              <label className="detail-check">
                <input
                  type="checkbox"
                  checked={Boolean(amazon.disclosure)}
                  disabled={running}
                  onChange={(event) =>
                    amazon.onChangeDisclosure?.(event.target.checked)
                  }
                />
                <span>Seller Central 手动勾选 AI Disclosure</span>
              </label>
              {amazon.batchText !== undefined ? (
                <details className="detail-amazon__batch">
                  <summary>批量 ASIN</summary>
                  <textarea
                    rows={2}
                    value={amazon.batchText || ""}
                    onChange={(event) =>
                      amazon.onChangeBatchText?.(event.target.value)
                    }
                    placeholder="每行一个，最多 100 个"
                    aria-label="批量 ASIN"
                    disabled={running}
                  />
                </details>
              ) : null}
              <small>
                {amazon.tier === "premium" ? "Premium 最多 7 个模块" : "基础版最多 5 个模块"}
                ，多勾选的方向按顺序截断
              </small>
            </div>
          ) : null}

          <div
            className={`workbench-plan detail-plan${planned ? " is-planned" : ""}`}
            aria-label="本次出图结构"
          >
            <span className="handheld-ref-card__tag">
              {planned ? "策划方案" : "本次出图"}
            </span>
            {planned && plan.onClear && !running ? (
              <button
                type="button"
                className="workbench-plan__clear detail-plan__clear"
                aria-label="清除策划方案"
                title="清除策划方案，回到未策划状态"
                disabled={plan.planning}
                onClick={plan.onClear}
              >
                <i className="bi bi-x-lg" />
                <span>清除</span>
              </button>
            ) : null}
            <button
              type="button"
              className={`detail-plan__run${plan.planning ? " is-busy" : ""}${planned ? " is-done" : ""}`}
              disabled={running || plan.planning || Boolean(plan.planDisabled)}
              title={plan.planHint || undefined}
              onClick={plan.onPlan}
            >
              {plan.planning ? (
                <>
                  <span className="handheld-submit__spinner" aria-hidden="true" />
                  正在分析痛点与版块
                </>
              ) : planned ? (
                <>
                  <i className="bi bi-arrow-repeat" />
                  重新策划
                </>
              ) : (
                <>
                  <i className="bi bi-stars" />
                  AI 智能策划
                </>
              )}
            </button>
            <label className="detail-check detail-plan__auto">
              <input
                type="checkbox"
                checked={Boolean(plan.autoGenerate)}
                disabled={running || plan.planning}
                onChange={() => plan.onToggleAutoGenerate?.()}
              />
              <span>策划完毕后自动直接生成</span>
            </label>
            {plan.error ? (
              <p className="workbench-plan__status is-error" role="alert">
                {plan.error}
              </p>
            ) : null}
            {planned ? (
              <div className="detail-plan__result">
                {plan.data?.painPoints?.length ? (
                  <div className="detail-plan__pains">
                    <span className="workbench-picks__label">买家痛点</span>
                    <ul>
                      {plan.data.painPoints.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {plan.data?.summary ? (
                  <p className="workbench-plan__summary">{plan.data.summary}</p>
                ) : null}
                <ol>
                  {blueprints.map((shot, index) => {
                    return (
                      <li key={shot.id || index} className={planItemClass(index)}>
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        <span>
                          {shot.label}
                          {shot.headline ? (
                            <em className="workbench-plan__copy">
                              {shot.headline}
                              {shot.subline ? <small>{shot.subline}</small> : null}
                            </em>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : (
              <>
                <ol>
                  {blueprints.map((shot, index) => {
                    return (
                      <li key={shot.id || index} className={planItemClass(index)}>
                        <b>{String(index + 1).padStart(2, "0")}</b>
                        <span>{shot.label}</span>
                      </li>
                    );
                  })}
                </ol>
                <small>
                  {blueprints.length
                    ? plan.autoGenerate
                      ? "AI 先写痛点与文案，再自动出图"
                      : "先策划文案，确认后再生成"
                    : "勾选出图方向后在此预览"}
                </small>
              </>
            )}
          </div>
        </div>

        <WorkbenchHistory
          label="A+ 详情"
          groups={historyGroups}
          activeGroup={activeGroup}
          displayUrl={resultUrl}
          fallbackRatio="3:4"
          running={running}
          onSelectHistory={onSelectHistory}
        />
      </section>
    </div>
  );
}
