import { useEffect, useRef, useState } from "react";
import { AuthenticatedImage } from "../../../components/AuthenticatedImage.jsx";
import { RegenerateIcon } from "../../../components/common/RegenerateIcon.jsx";
import { MentionMenu } from "../../skills/MentionMenu.jsx";
import { useMentionMenu } from "../../skills/useMentionMenu.js";
import { CommerceSelect } from "../CommerceSelect.jsx";
import { HandheldGeneratingStage, HandheldRefCard } from "../HandheldStudio.jsx";
import "../HandheldStudio.css";
import "./CommerceWorkbench.css";

export function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return value >= 100 ? String(value) : String(value).padStart(2, "0");
}

export function ratioVar(ratio, fallback = "1:1") {
  const [w, h] = String(ratio || fallback).split(":");
  return `${Number(w) > 0 ? w : 1} / ${Number(h) > 0 ? h : 1}`;
}

export function groupHistory(history) {
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

function guideBox(root, selector) {
  const el = root.querySelector(selector);
  if (!el) return null;
  const rootBox = root.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  if (!box.width || !box.height) return null;
  return {
    cx: Math.round(box.left - rootBox.left + box.width / 2),
    cy: Math.round(box.top - rootBox.top + box.height / 2),
    top: Math.round(box.top - rootBox.top),
    right: Math.round(box.left - rootBox.left + box.width),
    bottom: Math.round(box.top - rootBox.top + box.height),
    left: Math.round(box.left - rootBox.left),
  };
}

function guidePath(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

export function WorkbenchGuides({ rootRef, revision, running }) {
  const [paths, setPaths] = useState([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const update = () => {
      if (window.matchMedia("(max-width: 1024px)").matches) {
        setPaths((current) => (current.length ? [] : current));
        return;
      }
      const frame =
        guideBox(root, ".handheld-shot-stage") ||
        guideBox(root, ".handheld-frame");
      const platform = guideBox(root, ".handheld-platform");
      const pack = guideBox(root, ".handheld-pack");
      const firstBlock = platform || pack;
      const lastBlock = pack || platform;
      if (!frame) {
        setPaths((current) => (current.length ? [] : current));
        return;
      }
      const next = [];
      const arrow = 9;
      const leftCards = Array.from(
        root.querySelectorAll(".workbench-slot--left"),
      );
      for (const card of leftCards) {
        const rootBox = root.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        const cx = Math.round(box.left - rootBox.left + box.width / 2);
        const bottom = Math.round(box.top - rootBox.top + box.height);
        if (firstBlock && firstBlock.top > bottom + 12) {
          next.push({
            d: guidePath([
              { x: cx, y: bottom },
              { x: cx, y: firstBlock.top },
            ]),
          });
        }
      }
      if (platform && pack && pack.top > platform.bottom + 12) {
        const channel = guideBox(root, ".handheld-channels > button.is-active");
        const job =
          guideBox(root, ".handheld-packs > button.is-active") ||
          guideBox(root, ".handheld-picks > button.is-active");
        const fromX = channel?.cx ?? platform.cx;
        const toX = job?.cx ?? pack.cx;
        const midY = (platform.bottom + pack.top) / 2;
        next.push({
          d:
            Math.abs(fromX - toX) < 3
              ? guidePath([
                  { x: fromX, y: platform.bottom },
                  { x: toX, y: pack.top },
                ])
              : guidePath([
                  { x: fromX, y: platform.bottom },
                  { x: fromX, y: midY },
                  { x: toX, y: midY },
                  { x: toX, y: pack.top },
                ]),
        });
      }
      if (lastBlock && frame.left > lastBlock.right + 24) {
        const y = lastBlock.cy;
        next.push({
          d: guidePath([
            { x: lastBlock.right, y },
            { x: frame.left - arrow, y },
          ]),
          arrow: { x: frame.left, y },
        });
      }
      const rightCards = Array.from(
        root.querySelectorAll(".workbench-slot--right, .workbench-plan"),
      );
      for (const card of rightCards) {
        const rootBox = root.getBoundingClientRect();
        const box = card.getBoundingClientRect();
        const left = Math.round(box.left - rootBox.left);
        const cy = Math.round(box.top - rootBox.top + box.height / 2);
        if (left > frame.right + 24) {
          next.push({
            d: guidePath([
              { x: left, y: cy },
              { x: frame.right + arrow, y: cy },
            ]),
            arrow: { x: frame.right, y: cy, dir: "left" },
          });
        }
      }
      setPaths((current) =>
        current.length === next.length &&
        current.every((item, index) => item.d === next[index].d)
          ? current
          : next,
      );
    };
    update();
    const raf = window.requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(root);
    for (const node of root.querySelectorAll(
      ".workbench-slot--left, .workbench-slot--right, .workbench-plan, .handheld-platform, .handheld-pack, .handheld-frame, .handheld-shot-stage",
    )) {
      observer.observe(node);
    }
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [rootRef, revision]);

  if (!paths.length) return null;
  return (
    <svg
      className={`handheld-guides workbench-guides${running ? " is-running" : ""}`}
      aria-hidden="true"
    >
      {paths.map((item) => (
        <g key={item.d}>
          <path className="handheld-guides__line" d={item.d} />
          <path className="handheld-guides__flow" d={item.d} />
          {item.arrow ? (
            <polygon
              className="handheld-guides__arrow"
              points={
                item.arrow.dir === "left"
                  ? `${item.arrow.x},${item.arrow.y} ${item.arrow.x + 9},${item.arrow.y - 5} ${item.arrow.x + 9},${item.arrow.y + 5}`
                  : `${item.arrow.x},${item.arrow.y} ${item.arrow.x - 9},${item.arrow.y - 5} ${item.arrow.x - 9},${item.arrow.y + 5}`
              }
            />
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function SlotCard({
  slot,
  previews,
  extraSlots,
  referenceLabel,
  running,
  onUploadSlot,
  onDropSlot,
  onRemoveSlot,
  onPreviewReference,
  side,
}) {
  // key 槽位（如风格参考图）独立于商品参考序列，用 key 而不是 index 寻址
  const keyed = typeof slot.key === "string" && slot.key;
  const target = keyed ? slot.key : slot.index;
  const item = keyed
    ? extraSlots?.[slot.key] || null
    : previews[slot.index] || null;
  const locked = !keyed && !item && slot.index > previews.length;
  const previousLabel = locked ? referenceLabel(previews.length) : "";
  return (
    <HandheldRefCard
      className={`workbench-slot workbench-slot--${side}${!keyed && slot.index === 0 ? " handheld-product handheld-product--canvas" : ""}${keyed ? ` workbench-slot--${slot.key}` : ""}${locked ? " is-locked" : ""}`}
      tag={slot.required ? slot.tag : `${slot.tag} · 可选`}
      image={item?.url || ""}
      emptyIcon={locked ? "bi-lock" : slot.icon}
      emptyLabel={locked ? `先上传${previousLabel}` : slot.emptyLabel}
      emptyAria={`上传${slot.tag}`}
      previewAria={`查看${slot.tag}`}
      previewAlt={slot.tag}
      previewTitle={slot.tag}
      groupAria={`${slot.tag}操作`}
      uploadAria={`上传${slot.tag}`}
      clearAria={`清空${slot.tag}`}
      showMore={false}
      showClear
      disabled={running || locked}
      onPreview={(event, payload) => onPreviewReference?.(payload.url)}
      onUpload={() => onUploadSlot?.(target)}
      onClear={() => onRemoveSlot?.(target)}
      onDrop={locked ? undefined : (files) => onDropSlot?.(target, files)}
    />
  );
}

// 商品套图 / 详情页：出图类型多选（默认展示前几项 + “更多”弹层里全选 / 清空）
// picker.options[].custom + picker.onRemove：自定义项可删除；picker.footer 渲染在弹层底部（如自定义添加表单）
export function TypePicker({ picker, running }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const selected = new Set(picker.values || []);
  const visibleLimit = Math.max(1, Number(picker.visibleLimit) || 6);
  const visible = picker.options.filter(
    (item, index) => index < visibleLimit || selected.has(item.id),
  );
  const hiddenSelected = picker.options.filter(
    (item, index) => index >= visibleLimit && selected.has(item.id),
  ).length;
  const removeLabel = (item) =>
    `删除${picker.customNoun || "自定义"} ${item.label}`;
  const renderChip = (item) => {
    const active = selected.has(item.id);
    const chip = (
      <button
        key={item.id}
        type="button"
        role="checkbox"
        aria-checked={active}
        title={item.hint || undefined}
        className={`${active ? "is-active" : ""}${item.custom ? " is-custom" : ""}`}
        disabled={running}
        onClick={() => picker.onToggle?.(item.id)}
      >
        {item.label}
      </button>
    );
    if (!item.custom || !picker.onRemove) return chip;
    return (
      <span key={item.id} className="workbench-types__custom">
        {chip}
        <button
          type="button"
          className="workbench-types__remove"
          aria-label={removeLabel(item)}
          disabled={running}
          onClick={() => picker.onRemove?.(item.id)}
        >
          <i className="bi bi-x" />
        </button>
      </span>
    );
  };
  return (
    <div
      ref={rootRef}
      className="workbench-types"
      aria-label={picker.label}
      data-click-guard="repeat"
    >
      <div className="workbench-types__head">
        <span className="handheld-brief__kicker">{picker.label}</span>
        <span className="handheld-brief__meta">
          {picker.meta || `已选 ${selected.size} 张`}
        </span>
      </div>
      <div className="handheld-picks workbench-types__chips" role="group" aria-label={picker.label}>
        {visible.map(renderChip)}
        <button
          type="button"
          className={`workbench-types__more${open ? " is-open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          disabled={running}
          onClick={() => setOpen((value) => !value)}
        >
          更多
          {hiddenSelected ? <b>+{hiddenSelected}</b> : null}
          <i className="bi bi-chevron-down" />
        </button>
      </div>
      {open ? (
        <div className="workbench-types__popover" role="dialog" aria-label={`更多${picker.label}`}>
          <header>
            <strong>
              更多{picker.label}
              <small>（{picker.meta || `已选 ${selected.size} 张`}）</small>
            </strong>
            <span>
              <button type="button" onClick={picker.onSelectAll}>
                全选
              </button>
              <button type="button" onClick={picker.onClear}>
                清空
              </button>
              <button type="button" aria-label="关闭" onClick={() => setOpen(false)}>
                <i className="bi bi-x-lg" />
              </button>
            </span>
          </header>
          <div className="workbench-types__grid" role="group" aria-label={`全部${picker.label}`}>
            {picker.options.map((item) => {
              const active = selected.has(item.id);
              const cell = (
                <button
                  key={item.id}
                  type="button"
                  role="checkbox"
                  aria-checked={active}
                  className={`${active ? "is-active" : ""}${item.custom ? " is-custom" : ""}`}
                  onClick={() => picker.onToggle?.(item.id)}
                >
                  <i className={`bi ${active ? "bi-check-square-fill" : "bi-square"}`} />
                  <span>
                    <strong>{item.label}</strong>
                    {item.hint ? <small>{item.hint}</small> : null}
                  </span>
                </button>
              );
              if (!item.custom || !picker.onRemove) return cell;
              return (
                <span key={item.id} className="workbench-types__cell is-custom">
                  {cell}
                  <button
                    type="button"
                    className="workbench-types__remove"
                    aria-label={removeLabel(item)}
                    onClick={() => picker.onRemove?.(item.id)}
                  >
                    <i className="bi bi-x" />
                  </button>
                </span>
              );
            })}
          </div>
          {picker.footer ? (
            <div className="workbench-types__footer">{picker.footer}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function CommerceWorkbench({
  spec,
  previews = [],
  maxFiles = 6,
  referenceLabel = (index) => `角度 ${index + 1}`,
  onUploadSlot,
  onDropSlot,
  onRemoveSlot,
  onAddAngles,
  onPreviewReference,
  aspectRatio,
  ratioStyle,
  onChangeRatio,
  packValue = "",
  onChangePack,
  packOptions = null,
  picks = [],
  // 商品套图：出图类型多选
  typePicker = null,
  // 单图模块：出图数量（备选方案数）
  variants = null,
  // 细节补充（自由描述）
  note = null,
  // key 槽位（风格参考等）的当前内容：{ style: { url } }
  extraSlots = null,
  // 生成按钮旁的次级动作（如“去智能策划”）
  secondaryAction = null,
  // 策划状态：{ busy, error, active, summary, onClear }
  planState = null,
  plan = [],
  shots = [],
  resultUrl = "",
  history = [],
  running = false,
  failed = false,
  failMessage = "",
  notice = "",
  elapsedSeconds = 0,
  generationStageLabel = "正在生成",
  generateDisabled = false,
  generateHint = "",
  shotCount = 1,
  costLabel = "",
  onGenerate,
  onCancel,
  cancelling = false,
  onRetryShot,
  onSelectHistory,
  onResultPreview,
  onMaskEdit,
  onDownload,
  onSaveAsset,
  onDownloadPack,
  actionBusy = false,
  revision = { available: false },
}) {
  const rootRef = useRef(null);
  const noteRef = useRef(null);
  const briefRef = useRef(null);
  const [runSeconds, setRunSeconds] = useState(0);
  const noteMention = useMentionMenu({
    textareaRef: noteRef,
    value: note?.value || "",
    onChange: (next) => note?.onChange?.(next),
    promptType: "",
  });
  const briefMention = useMentionMenu({
    textareaRef: briefRef,
    value: revision?.brief || "",
    onChange: (next) => revision?.onChangeBrief?.(next),
    promptType: "",
  });

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
  const posterRatio = String(aspectRatio || "1:1");
  const frameStyle = ratioStyle || {
    "--commerce-shot-ratio": ratioVar(posterRatio),
  };
  const slots = spec?.slots || [];
  const leftSlots = slots.filter((slot) => slot.side !== "right");
  const rightSlots = slots.filter((slot) => slot.side === "right");
  const angleSlot = leftSlots.find((slot) => slot.angles);
  const angleItems = angleSlot ? previews.slice(1) : [];
  const channels = spec?.channels || null;
  const selectedChannel =
    channels?.find((item) => item.id === posterRatio) || null;
  const packs = packOptions || spec?.packs || [];
  const selectedPack = packs.find((item) => item.id === packValue) || null;
  const hasPacks = packs.length > 0;
  const hasPicks = picks.some((group) => group.options?.length);
  const hasTypes = Boolean(typePicker?.options?.length);
  const hasVariants = Boolean(variants);
  const hasNote = Boolean(note);
  const hasBrief = Boolean(channels) || hasPacks || hasPicks || hasTypes || hasVariants || hasNote;
  const historyGroups = groupHistory(history);
  const activeGroup =
    historyGroups.find((group) =>
      group.rows.some((row) => row.url === resultUrl),
    ) || null;
  const displayShot =
    shots.find((item) => item.url && item.url === resultUrl) ||
    shots.find((item) => item.url) ||
    shots.find((item) => item.running) ||
    shots[0] ||
    null;
  const displayUrl = resultUrl || displayShot?.url || "";
  const stageDisplayUrl =
    (history || []).find((row) => row.url === displayUrl)?.display || "";
  const thumbs = shots.length > 1 ? shots : [];
  const hasImage = Boolean(displayUrl) && !running && !(failed && !displayUrl);
  const hasRequired = slots
    .filter((slot) => slot.required)
    .every((slot) => Boolean(previews[slot.index]));
  const guideRevision = [
    previews.map((item) => item.url).join("|"),
    Object.values(extraSlots || {})
      .map((item) => item?.url || "")
      .join("|"),
    posterRatio,
    packValue,
    picks.map((group) => group.value).join("|"),
    (typePicker?.values || []).join("|"),
    variants?.value || "",
    hasNote ? String(note.value || "").length > 0 : "",
    displayUrl,
    running,
    rightSlots.length,
    plan.length,
    planState?.active ? "planned" : "",
  ].join("::");

  return (
    <div
      className={`commerce-workbench is-${spec?.id || "generic"}`}
      aria-label={`${spec?.resultLabel || "电商"}工作台`}
    >
      <section
        ref={rootRef}
        className={`workbench-output handheld-out${running ? " is-running" : ""}${rightSlots.length ? " has-right-slots" : ""}`}
        aria-label={`${spec?.resultLabel || "生成"}画布`}
      >
        {notice ? (
          <p className="handheld-pane__notice" role="status">
            {notice}
          </p>
        ) : null}
        <WorkbenchGuides
          rootRef={rootRef}
          revision={guideRevision}
          running={running}
        />

        <div
          className="handheld-board handheld-board--top workbench-board"
          aria-label="画布输入"
        >
          <div
            className={`handheld-board__refs workbench-refs${leftSlots.length === 1 ? " is-single" : ""}`}
          >
            {leftSlots.map((slot) => (
              <SlotCard
                key={slot.key || slot.index}
                slot={slot}
                side="left"
                previews={previews}
                extraSlots={extraSlots}
                referenceLabel={referenceLabel}
                running={running}
                onUploadSlot={onUploadSlot}
                onDropSlot={onDropSlot}
                onRemoveSlot={onRemoveSlot}
                onPreviewReference={onPreviewReference}
              />
            ))}
            {angleSlot && previews[0] ? (
              <div className="workbench-angles" aria-label="更多角度">
                <span className="workbench-angles__label">
                  <i className="bi bi-collection" />
                  多角度
                  <small>{previews.length}/{maxFiles}</small>
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
                          aria-label={`查看${referenceLabel(index)}`}
                          onClick={() => onPreviewReference?.(item.url)}
                        >
                          <img src={item.url} alt="" />
                        </button>
                        <button
                          type="button"
                          className="workbench-angles__remove"
                          aria-label={`移除${referenceLabel(index)}`}
                          disabled={running}
                          onClick={() => onRemoveSlot?.(index)}
                        >
                          <i className="bi bi-x" />
                        </button>
                      </span>
                    );
                  })}
                  {previews.length < maxFiles ? (
                    <button
                      type="button"
                      className="workbench-angles__add"
                      aria-label="添加更多角度"
                      disabled={running}
                      onClick={onAddAngles}
                    >
                      <i className="bi bi-plus-lg" />
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          {hasBrief ? (
            <div className="handheld-brief handheld-brief--canvas workbench-brief">
              {channels ? (
                <div className="handheld-platform">
                  <div className="handheld-brief__head">
                    <span className="handheld-brief__kicker">
                      {spec.channelKicker || "投放到"}
                    </span>
                    {selectedChannel ? (
                      <span className="handheld-brief__meta">
                        {selectedChannel.hint}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="handheld-channels"
                    role="radiogroup"
                    aria-label="选择画面比例"
                  >
                    {channels.map((item) => {
                      const active = posterRatio === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={`${item.label} ${item.ratio}`}
                          title={item.hint}
                          className={active ? "is-active" : ""}
                          disabled={running}
                          onClick={() => onChangeRatio?.(item.ratio)}
                        >
                          <span
                            className="handheld-channels__frame"
                            style={{ "--channel-ratio": ratioVar(item.ratio) }}
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
              ) : null}
              {hasPacks || hasPicks || hasVariants || hasTypes || hasNote ? (
                <div className="handheld-pack workbench-pack">
                  {hasTypes ? <TypePicker picker={typePicker} running={running} /> : null}
                  {hasVariants ? (
                    <div className="workbench-variants" aria-label="出图数量">
                      <span className="workbench-picks__label">出图数量</span>
                      {/* 步进器允许连点：关闭全局防重复点击守卫；回调用步进量而不是绝对值，避免闭包旧值 */}
                      <div
                        className="workbench-variants__stepper"
                        role="group"
                        aria-label="出图数量"
                        data-click-guard="repeat"
                      >
                        <button
                          type="button"
                          aria-label="减少出图数量"
                          disabled={running || Number(variants.value) <= Number(variants.min ?? 1)}
                          onClick={() => variants.onStep?.(-1)}
                        >
                          <i className="bi bi-dash" />
                        </button>
                        <b aria-live="polite">{variants.value}</b>
                        <button
                          type="button"
                          aria-label="增加出图数量"
                          disabled={running || Number(variants.value) >= Number(variants.max ?? 4)}
                          onClick={() => variants.onStep?.(1)}
                        >
                          <i className="bi bi-plus" />
                        </button>
                        <small>张 · 最多 {variants.max ?? 4}</small>
                      </div>
                    </div>
                  ) : null}
                  {hasPacks ? (
                    <div
                      className="handheld-packs"
                      role="radiogroup"
                      aria-label="选择出图任务"
                    >
                      {packs.map((item) => {
                        const active = (selectedPack?.id || packValue) === item.id;
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
                              {item.countLabel ||
                                (item.count
                                  ? `${item.count}张`
                                  : item.shotIds
                                    ? `${item.shotIds.length}张`
                                    : item.hint || "")}
                            </em>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                  {picks
                    .filter((group) => group.options?.length)
                    .map((group) => (
                      <div key={group.key} className="workbench-picks">
                        <span className="workbench-picks__label">
                          {group.label}
                        </span>
                        <div
                          className="handheld-picks"
                          role="radiogroup"
                          aria-label={group.label}
                        >
                          {group.options.map((option) => {
                            const id = option.id ?? option.value ?? option;
                            const label = option.label ?? option;
                            const active = group.value === id;
                            return (
                              <button
                                key={id}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                title={option.hint || undefined}
                                className={active ? "is-active" : ""}
                                disabled={running}
                                onClick={() => group.onChange?.(id)}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
              {hasNote ? (
                <label className="workbench-note">
                  <span className="workbench-note__head">
                    <span className="workbench-picks__label">
                      {note.label || "细节补充"}
                      <small>（可选）</small>
                    </span>
                    <small className="workbench-note__count">
                      {String(note.value || "").length}/{note.max || 2000}
                    </small>
                  </span>
                  <div className="mention-field">
                    <textarea
                      ref={noteRef}
                      value={note.value || ""}
                      maxLength={note.max || 2000}
                      rows={2}
                      disabled={running}
                      placeholder={
                        note.placeholder ||
                        "描述色调、构图、氛围、文案位置等细节，例如：暖色木质桌面，右上角留白放标题"
                      }
                      aria-label={note.label || "细节补充"}
                      onChange={noteMention.handleChange}
                      onClick={noteMention.handleCaretSync}
                      onKeyUp={noteMention.handleCaretSync}
                      onBlur={noteMention.handleBlur}
                      onKeyDown={noteMention.handleKeyDown}
                    />
                    <MentionMenu {...noteMention.menuProps} />
                  </div>
                </label>
              ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div
          className="handheld-shots"
          data-count={1}
          data-ratio={posterRatio}
          style={frameStyle}
        >
          <div
            className={`handheld-shot-stage${thumbs.length ? " has-thumbs" : ""}`}
          >
            <div
              className={`handheld-frame${hasImage ? " has-image" : ""}${running ? " is-running" : ""}${failed && !displayUrl ? " is-failed" : ""}${displayUrl ? " is-selected" : ""}`}
              data-ratio={posterRatio}
              style={frameStyle}
            >
              {running && !displayUrl ? (
                <HandheldGeneratingStage
                  productUrl={previews[0]?.url || ""}
                  sceneImage={previews[1]?.url || ""}
                  label={displayShot?.label || spec?.resultLabel || ""}
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
                  aria-label={`查看${spec?.resultLabel || "生成结果"}`}
                  aria-pressed="true"
                  onClick={(event) => {
                    onSelectHistory?.(displayUrl);
                    onResultPreview?.(event, {
                      url: displayUrl,
                      alt: spec?.resultLabel || "生成结果",
                      title: displayShot?.label || spec?.resultLabel || "生成结果",
                    });
                  }}
                >
                  <AuthenticatedImage
                    src={stageDisplayUrl || displayUrl}
                    fallbackSrc={displayUrl}
                    alt={spec?.resultLabel || "生成结果"}
                  />
                </button>
              ) : (
                <div className="handheld-frame__status workbench-empty">
                  <strong>{spec?.emptyTitle || "还没有结果"}</strong>
                  <ol className="workbench-empty__steps">
                    {(spec?.emptySteps || []).map((step, index) => {
                      const done =
                        index === 0 ? hasRequired : index === 1 ? hasRequired : false;
                      return (
                        <li key={step} className={done ? "is-done" : ""}>
                          <b>
                            {done ? (
                              <i className="bi bi-check-lg" />
                            ) : (
                              String(index + 1).padStart(2, "0")
                            )}
                          </b>
                          <span>{step}</span>
                        </li>
                      );
                    })}
                  </ol>
                  <span>
                    {hasRequired
                      ? generateHint || "配置完成后点生成"
                      : `上传${slots.find((slot) => slot.required && !previews[slot.index])?.tag || "参考图"}后开始配置`}
                  </span>
                </div>
              )}
              {running && displayUrl ? (
                <span className="workbench-frame__progress" role="status">
                  <i className="handheld-frame__thumb-spin" aria-hidden="true" />
                  {generationStageLabel} · {formatSeconds(waitSeconds)}s
                </span>
              ) : null}
              {displayShot?.label && (displayUrl || running) ? (
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
                    <div className="mention-field">
                      <textarea
                        ref={briefRef}
                        value={revision.brief || ""}
                        onChange={briefMention.handleChange}
                        onClick={briefMention.handleCaretSync}
                        onKeyUp={briefMention.handleCaretSync}
                        onBlur={briefMention.handleBlur}
                        onKeyDown={briefMention.handleKeyDown}
                        placeholder="例如：商品再放大 15%，背景改为浅灰影棚，其他内容保持不变"
                      />
                      <MentionMenu {...briefMention.menuProps} />
                    </div>
                    <small>{String(revision.brief || "").length}/600</small>
                  </label>
                  <footer>
                    <span>
                      <i className="bi bi-shield-check" />
                      上一版本会保留
                      {revision.price ? ` · ${revision.price}` : ""}
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
                  className={`handheld-submit handheld-submit--frame${running ? " is-running" : ""}${failed && !displayUrl ? " is-failed" : ""}`}
                  disabled={running ? cancelling : generateDisabled}
                  title={!running && generateDisabled ? generateHint : undefined}
                  aria-label={
                    running
                      ? cancelling
                        ? "正在停止"
                        : "停止生成"
                      : failed && !displayUrl
                        ? `重试生成${spec?.resultLabel || ""}（${shotCount}张）`
                        : `生成${spec?.resultLabel || ""}（${shotCount}张）`
                  }
                  onClick={running ? onCancel : onGenerate}
                >
                  {running ? (
                    <span className="handheld-submit__spinner" aria-hidden="true" />
                  ) : failed && !displayUrl ? (
                    <RegenerateIcon />
                  ) : (
                    <i className="bi bi-stars" aria-hidden="true" />
                  )}
                  <span>
                    {running
                      ? cancelling
                        ? "停止中"
                        : "停止"
                      : failed && !displayUrl
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
                {secondaryAction && !running ? (
                  <button
                    type="button"
                    className={`workbench-secondary${secondaryAction.busy ? " is-busy" : ""}${secondaryAction.active ? " is-active" : ""}`}
                    disabled={secondaryAction.disabled || secondaryAction.busy}
                    title={secondaryAction.hint || undefined}
                    aria-label={secondaryAction.ariaLabel || secondaryAction.label}
                    onClick={secondaryAction.onClick}
                  >
                    {secondaryAction.busy ? (
                      <span className="handheld-submit__spinner" aria-hidden="true" />
                    ) : (
                      <i className={`bi ${secondaryAction.icon || "bi-magic"}`} aria-hidden="true" />
                    )}
                    <span>{secondaryAction.busy ? secondaryAction.busyLabel || "策划中" : secondaryAction.label}</span>
                    {secondaryAction.sub ? <small>{secondaryAction.sub}</small> : null}
                  </button>
                ) : null}
                {displayUrl && !running ? (
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
                    {onSaveAsset ? (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={onSaveAsset}
                      >
                        存入素材库
                      </button>
                    ) : null}
                    {onDownloadPack && (activeGroup?.rows.length || 0) > 1 ? (
                      <button
                        type="button"
                        disabled={actionBusy}
                        onClick={onDownloadPack}
                      >
                        下载套图
                      </button>
                    ) : null}
                  </span>
                ) : null}
              </div>
            </div>
            {thumbs.length ? (
              <div
                className="handheld-frame__thumbs"
                role="list"
                aria-label="本次套图"
              >
                {thumbs.map((item, index) => {
                  const thumbActive =
                    (item.url && item.url === displayUrl) ||
                    (!item.url && item === displayShot);
                  const thumbPending = !item.url && !item.failed && (item.running || running);
                  const thumbFailed = Boolean(item.failed) && !item.running;
                  return (
                    <button
                      key={item.id || `thumb-${index}`}
                      type="button"
                      role="listitem"
                      className={`handheld-frame__thumb${thumbActive ? " is-active" : ""}${thumbPending ? " is-pending" : ""}${thumbFailed ? " is-failed" : ""}`}
                      disabled={thumbPending || (!item.url && !thumbFailed)}
                      aria-label={
                        thumbFailed
                          ? `重试 ${item.label || `第 ${index + 1} 张`}`
                          : item.label || `第 ${index + 1} 张`
                      }
                      aria-pressed={thumbActive}
                      title={item.label || undefined}
                      onClick={() => {
                        if (item.url) onSelectHistory?.(item.url);
                        else if (thumbFailed) onRetryShot?.(index);
                      }}
                    >
                      {item.url ? (
                        <AuthenticatedImage src={item.preview || item.url} alt="" />
                      ) : thumbFailed ? (
                        <span className="handheld-frame__thumb-failed">
                          <RegenerateIcon />
                          <small>重试</small>
                        </span>
                      ) : thumbPending ? (
                        <span className="handheld-frame__thumb-pending">
                          <i className="handheld-frame__thumb-spin" aria-hidden="true" />
                        </span>
                      ) : (
                        <span className="handheld-frame__thumb-empty">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="handheld-ref-stack workbench-stack">
          {rightSlots.map((slot) => (
            <SlotCard
              key={slot.key || slot.index}
              slot={slot}
              side="right"
              previews={previews}
              extraSlots={extraSlots}
              referenceLabel={referenceLabel}
              running={running}
              onUploadSlot={onUploadSlot}
              onDropSlot={onDropSlot}
              onRemoveSlot={onRemoveSlot}
              onPreviewReference={onPreviewReference}
            />
          ))}
          {plan.length ? (
            <div
              className={`workbench-plan${planState?.active ? " is-planned" : ""}`}
              aria-label="本次出图结构"
            >
              <span className="handheld-ref-card__tag">
                {planState?.active ? "策划方案" : "本次出图"}
              </span>
              {planState?.active && planState.onClear && !running ? (
                <button
                  type="button"
                  className="workbench-plan__clear"
                  aria-label="清除策划方案"
                  title="清除策划方案，回到智能直出"
                  onClick={planState.onClear}
                >
                  <i className="bi bi-x-lg" />
                  <span>清除</span>
                </button>
              ) : null}
              {planState?.busy ? (
                <p className="workbench-plan__status" role="status">
                  <span className="handheld-submit__spinner" aria-hidden="true" />
                  AI 正在为每张图策划文案…
                </p>
              ) : null}
              {planState?.error ? (
                <p className="workbench-plan__status is-error" role="alert">
                  {planState.error}
                </p>
              ) : null}
              {planState?.summary ? (
                <p className="workbench-plan__summary">{planState.summary}</p>
              ) : null}
              <ol>
                {plan.map((item, index) => {
                  const shot = shots[index];
                  const state = shot?.url
                    ? "is-done"
                    : shot?.failed
                      ? "is-failed"
                      : shot?.running || (running && index === 0)
                        ? "is-running"
                        : "";
                  return (
                    <li key={item.id || index} className={state}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <span>
                        {item.label}
                        {item.headline ? (
                          <em className="workbench-plan__copy">
                            {item.headline}
                            {item.subline ? <small>{item.subline}</small> : null}
                          </em>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <small>
                {plan.length > 1 ? "首张锁定系列视觉，其余并行" : "单张直出"}
              </small>
            </div>
          ) : null}
        </div>

        <WorkbenchHistory
          label={spec?.historyLabel || "生成"}
          groups={historyGroups}
          activeGroup={activeGroup}
          displayUrl={displayUrl}
          fallbackRatio={posterRatio}
          running={running}
          onSelectHistory={onSelectHistory}
        />
      </section>
    </div>
  );
}

// 右侧历史栏：各工作台共用（分组套图显示四宫格 + 张数）
export function WorkbenchHistory({
  label = "生成",
  groups = [],
  activeGroup = null,
  displayUrl = "",
  fallbackRatio = "1:1",
  running = false,
  onSelectHistory,
}) {
  return (
    <aside className="handheld-history" aria-label={`${label}历史`}>
      <p className="handheld-history__label">历史</p>
      {groups.length ? (
        <div className="handheld-history__list" role="list">
          {groups.map((group) => {
            const cover = group.rows[0];
            const count = Math.max(
              group.rows.length,
              Number(cover?.groupSize) || 0,
            );
            const active = group === activeGroup;
            const mosaic = count > 1 ? group.rows.slice(0, 4) : [];
            return (
              <button
                key={group.id}
                type="button"
                role="listitem"
                className={`handheld-history__item${count > 1 ? " is-set" : ""}${active ? " is-active" : ""}`}
                disabled={running}
                aria-label={`${label}${count > 1 ? `，共 ${count} 张` : ""}`}
                aria-pressed={active}
                onClick={() => {
                  const current = group.rows.find((row) => row.url === displayUrl);
                  onSelectHistory?.(current?.url || cover?.url);
                }}
              >
                <span
                  className="handheld-history__shot"
                  style={{
                    "--handheld-history-ratio": ratioVar(
                      cover?.aspectRatio || fallbackRatio,
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
                    <AuthenticatedImage src={cover?.preview || cover?.url} alt="" />
                  )}
                  {count > 1 ? (
                    <span className="handheld-history__count">{count}</span>
                  ) : null}
                </span>
                <span className="handheld-history__meta">
                  <strong>{label}</strong>
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
  );
}
