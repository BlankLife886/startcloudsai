import { useEffect, useRef, useState } from "react";
import { PageEntryLink as Link } from "../page-control/PageEntryLink.jsx";
import { listUserAssets } from "@react/legacy-modules/services/meApi.js";
import { isAuthenticatedAiMediaUrl } from "@react/legacy-modules/services/authenticatedMedia.js";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import {
  DRESSUP_GROUPS,
  DRESSUP_PRESETS,
  dressupCategory,
  dressupGroupOf,
  dressupSlotLock,
  dressupSlotSummary,
  dressupUsage,
  emptyDressupSlot,
  isDressupSlotFilled,
  isWearingLook,
  selectedDressupSlots,
} from "./profileStudioDressup.js";
import "./ProfileDressupStudio.css";

const DRESSUP_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// 光点落在立绘取景框里的大致位置（百分比）。立绘都是 2:3 全身站姿，位置足够稳定。
const HOTSPOTS = {
  head: { top: 12, left: 50 },
  acc: { top: 27, left: 58 },
  wear: { top: 45, left: 45 },
  prop: { top: 55, left: 66 },
  fx: { top: 30, left: 30 },
};

// 星点位置用固定种子生成，避免每次渲染跳动。
const STARS = Array.from({ length: 110 }, (_, index) => {
  const seed = Math.sin(index * 12.9898) * 43758.5453;
  const rand = (offset) => {
    const value = Math.sin(seed + offset) * 10000;
    return value - Math.floor(value);
  };
  return {
    left: `${(rand(1) * 100).toFixed(2)}%`,
    top: `${(rand(2) * 100).toFixed(2)}%`,
    size: rand(3) > 0.9 ? 2 : 1,
    delay: `${(rand(4) * 6).toFixed(2)}s`,
    layer: index % 3,
  };
});

function DressupMedia({ src, alt = "", fallbackSrc = "", eager = false }) {
  if (!src) return null;
  if (isAuthenticatedAiMediaUrl(src) || isAuthenticatedAiMediaUrl(fallbackSrc)) {
    return (
      <AuthenticatedImage
        src={src}
        fallbackSrc={fallbackSrc}
        alt={alt}
        loading={eager ? "eager" : undefined}
        keepLoaded={eager}
      />
    );
  }
  return <img src={src} alt={alt} />;
}

function formatLookDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

// 光束里缓慢上浮的尘粒，位置用固定种子，避免每次渲染跳动
const DUST = Array.from({ length: 26 }, (_, index) => {
  const rand = (offset) => {
    const value = Math.sin(index * 78.233 + offset) * 43758.5453;
    return value - Math.floor(value);
  };
  return {
    left: `${(38 + rand(1) * 24).toFixed(2)}%`,
    top: `${(10 + rand(2) * 70).toFixed(2)}%`,
    size: rand(3) > 0.7 ? 2 : 1,
    duration: `${(14 + rand(4) * 16).toFixed(1)}s`,
    delay: `${(-rand(5) * 20).toFixed(1)}s`,
  };
});

function StageDecor() {
  return (
    <div className="pp-ds-decor" aria-hidden="true">
      <div className="pp-ds-nebula" />
      {[0, 1, 2].map((layer) => (
        <div key={layer} className={`pp-ds-starfield is-l${layer}`}>
          {STARS.filter((star) => star.layer === layer).map((star, index) => (
            <i
              key={index}
              style={{ left: star.left, top: star.top, width: star.size, height: star.size, animationDelay: star.delay }}
            />
          ))}
        </div>
      ))}
      <div className="pp-ds-beam" />
      <div className="pp-ds-dust">
        {DUST.map((dot, index) => (
          <i
            key={index}
            style={{
              left: dot.left,
              top: dot.top,
              width: dot.size,
              height: dot.size,
              animationDuration: dot.duration,
              animationDelay: dot.delay,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function WardrobeStrip({ items, currentFigureUrl, busy, onWear, onRemove }) {
  const lastBefore = items.find((item) => item.kind === "before");
  const wearingBefore = lastBefore && isWearingLook(lastBefore, currentFigureUrl);
  if (!items.length) {
    return (
      <p className="pp-ds-drawer__empty">
        衣橱是空的。每次换上的造型都会收进这里，之后可以一键换回；只保存在这台设备上。
      </p>
    );
  }
  return (
    <>
      {lastBefore && !wearingBefore ? (
        <button type="button" className="pp-ds-drawer__undo" disabled={busy} onClick={() => onWear(lastBefore)}>
          撤销上次换装
        </button>
      ) : null}
      <ul className="pp-ds-strip">
        {items.map((item) => {
          const wearing = isWearingLook(item, currentFigureUrl);
          const title = item.kind === "before" ? "换装前" : item.labels?.length ? item.labels.join(" · ") : "装扮";
          return (
            <li key={item.id} className={wearing ? "is-wearing" : ""}>
              <button
                type="button"
                className="pp-ds-strip__look"
                disabled={busy || wearing}
                title={wearing ? "正在穿着" : "穿上这套"}
                onClick={() => onWear(item)}
              >
                <DressupMedia src={item.url} alt={title} />
              </button>
              <b>{wearing ? "穿着中" : title}</b>
              <small>{formatLookDate(item.createdAt)}</small>
              <button
                type="button"
                className="pp-ds-strip__remove"
                aria-label="从衣橱删除"
                disabled={busy}
                onClick={() => onRemove(item)}
              >
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}

export function ProfileDressupStudio({
  open,
  busy,
  busyKind = "",
  onDismissNote,
  isDark,
  baseSrc,
  baseFallbackSrc,
  baseIsDraft,
  previewSrc,
  note,
  selection,
  categoryId,
  maxReferenceImages,
  wardrobe,
  currentFigureUrl,
  toAssetSourceUrl,
  onCategory,
  onSlotChange,
  onClearSlot,
  onReset,
  onApplyPreset,
  onClose,
  onConfirm,
  onUsePreview,
  onUseBase,
  onDiscardPreview,
  onRetry,
  onContinue,
  onWear,
  onRemoveLook,
  closeLocked,
}) {
  const fileInputRef = useRef(null);
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  // 滚轮缩放：以光标所在位置为中心放大，1 = 全身
  const [zoom, setZoom] = useState({ scale: 1, ox: 50, oy: 8 });
  const zoomed = zoom.scale > 1.02;
  // 按住「看原图」时临时显示换装前的形象
  const [peek, setPeek] = useState(false);
  const peekHoldRef = useRef({ timer: 0, holding: false, skipClick: false });
  // 编辑卡片默认展开，打开工作台就能直接开始换
  const [openGroup, setOpenGroup] = useState("head");
  const [drawer, setDrawer] = useState("");
  const [assetOpen, setAssetOpen] = useState(false);
  const [assets, setAssets] = useState({ loading: false, items: [], nextCursor: "", error: "" });
  const active = dressupCategory(categoryId) || dressupCategory("hair");
  const activeGroup = dressupGroupOf(active.id);
  const slot = selection[active.id] || emptyDressupSlot();
  const picked = selectedDressupSlots(selection);
  const usage = dressupUsage(selection, maxReferenceImages);
  const lock = dressupSlotLock(selection, active.id, maxReferenceImages);
  const filled = isDressupSlotFilled(slot);
  const editing = !previewSrc && !busy;
  const comparing = Boolean(previewSrc) && !busy;
  // 保存形象（换衣橱、使用这张）也会占用 busy，但不是生成，不显示扫描光带
  const generating = busy && busyKind !== "upload";
  const looks = wardrobe.filter((item) => item.kind !== "before");
  const lastLook = looks[0];

  useEffect(() => {
    if (!open) {
      setAssetOpen(false);
      setDrawer("");
    } else {
      setOpenGroup(dressupGroupOf(active.id).id);
    }
  }, [open]);

  useEffect(() => {
    if (previewSrc || busy) {
      setOpenGroup("");
      setDrawer("");
    }
  }, [previewSrc, busy]);

  useEffect(() => {
    setPeek(false);
  }, [previewSrc]);

  // 空格按住看原图，松开回到新造型
  useEffect(() => {
    if (!open || !comparing) return undefined;
    const typing = (event) => /^(TEXTAREA|INPUT|SELECT)$/.test(event.target?.tagName || "");
    // 预览状态下空格统一当「按住看原图」；拦掉默认行为，免得焦点在按钮上时被当成一次点击
    const down = (event) => {
      if (event.code === "Space" && !typing(event)) {
        event.preventDefault();
        setPeek(true);
      }
    };
    const up = (event) => {
      if (event.code !== "Space") return;
      if (!typing(event)) event.preventDefault();
      setPeek(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", up);
    };
  }, [open, comparing]);

  useEffect(() => {
    if (!assetOpen) return undefined;
    let cancelled = false;
    setAssets((current) => ({ ...current, loading: true, error: "" }));
    listUserAssets({ limit: 48, groupId: "all" })
      .then((result) => {
        if (cancelled) return;
        setAssets({ loading: false, items: result.items || [], nextCursor: result.nextCursor || "", error: "" });
      })
      .catch((error) => {
        if (cancelled) return;
        setAssets({ loading: false, items: [], nextCursor: "", error: error?.message || "素材库读取失败" });
      });
    return () => {
      cancelled = true;
    };
  }, [assetOpen]);

  // 全屏弹层本身不滚动，直接用 React 的 onWheel；卡片、抽屉里的滚动保持原样
  const onStageWheel = (event) => {
    if (event.target.closest?.(".pp-ds-pop, .pp-ds-drawer, .pp-dressup__assets")) return;
    const frame = frameRef.current?.getBoundingClientRect();
    const { deltaY, clientX, clientY } = event;
    setZoom((current) => {
      const scale = Math.min(3, Math.max(1, current.scale * Math.exp(-deltaY * 0.0015)));
      if (scale <= 1.02) return { scale: 1, ox: 50, oy: 8 };
      if (current.scale > 1.02 || !frame) return { ...current, scale };
      // 刚开始放大时，以光标位置为缩放中心
      const ox = Math.min(100, Math.max(0, ((clientX - frame.left) / frame.width) * 100));
      // 纵向中心限制在上半身，放大后头部不会被推出画面
      const oy = Math.min(45, Math.max(0, ((clientY - frame.top) / frame.height) * 100));
      return { scale, ox, oy };
    });
  };

  useEffect(() => {
    if (!open) setZoom({ scale: 1, ox: 50, oy: 8 });
  }, [open]);

  const openHotspot = (group) => {
    setDrawer("");
    setOpenGroup(group.id);
    if (dressupGroupOf(active.id).id !== group.id) {
      const firstFilled = group.items.find((id) => isDressupSlotFilled(selection[id]));
      onCategory(firstFilled || group.items[0]);
    }
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      const typing = /^(TEXTAREA|INPUT|SELECT)$/.test(event.target?.tagName || "");
      if (event.key === "Escape" && (openGroup || drawer)) {
        event.stopPropagation();
        setOpenGroup("");
        setDrawer("");
        return;
      }
      if (typing || !editing || event.metaKey || event.ctrlKey || event.altKey) return;
      const group = DRESSUP_GROUPS[Number(event.key) - 1];
      if (group) {
        event.preventDefault();
        openHotspot(group);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const toggleDrawer = (value) => {
    setOpenGroup("");
    setDrawer((current) => (current === value ? "" : value));
  };

  const pickFile = (file) => {
    if (!editing || lock.imageLocked || !file) return;
    if (!file.type?.startsWith("image/")) return;
    if (file.size > DRESSUP_IMAGE_MAX_BYTES) return;
    onSlotChange(active.id, { file, previewUrl: URL.createObjectURL(file), sourceUrl: "" });
  };

  const pickAsset = (asset) => {
    if (lock.imageLocked) return;
    const url = toAssetSourceUrl(asset.url);
    if (!url) return;
    onSlotChange(active.id, {
      file: null,
      previewUrl: String(asset.thumbnailUrl || asset.url || url).trim(),
      sourceUrl: url,
    });
    setAssetOpen(false);
  };

  const loadMoreAssets = async () => {
    if (!assets.nextCursor || assets.loading) return;
    setAssets((current) => ({ ...current, loading: true }));
    try {
      const result = await listUserAssets({ limit: 48, groupId: "all", cursor: assets.nextCursor });
      setAssets((current) => ({
        loading: false,
        items: [...current.items, ...(result.items || [])],
        nextCursor: result.nextCursor || "",
        error: "",
      }));
    } catch (error) {
      setAssets((current) => ({ ...current, loading: false, error: error?.message || "素材库读取失败" }));
    }
  };

  const title = {
    main: "星空换装间",
    sub: previewSrc
      ? "新造型已就绪"
      : baseIsDraft
        ? "在上一轮结果上继续"
        : lastLook
          ? `已换装 ${looks.length} 次 · 最近 ${lastLook.labels?.join("、") || "装扮"}`
          : "描述想换的样子，或上传参考图",
  };

  const popGroup = DRESSUP_GROUPS.find((group) => group.id === openGroup);

  return (
    <DialogMotion
      open={open}
      layerClassName={`pp-dressup-layer${isDark ? " is-dark" : ""}`}
      panelClassName="pp-dressup"
      variant="detail"
      ariaLabelledby="pp-dressup-title"
      closeDisabled={busy || closeLocked}
      onClose={onClose}
    >
      <div
        ref={stageRef}
        className={`pp-ds${zoomed ? " is-zoomed" : ""}${busy ? " is-busy" : ""}${comparing ? " is-compare" : ""}${drawer ? " has-drawer" : ""}${popGroup && editing ? " has-pop" : ""}`}
        data-dialog-motion-item
        onWheel={onStageWheel}
        onDoubleClick={(event) => {
          if (!event.target.closest?.(".pp-ds-pop, .pp-ds-drawer, .pp-ds-dock, .pp-ds-top")) {
            setZoom({ scale: 1, ox: 50, oy: 8 });
          }
        }}
      >
        <div className="pp-ds-bg" aria-hidden="true">
          <div className="pp-ds-bg__spot" />
        </div>
        <StageDecor />
        <div className="pp-ds-floor" aria-hidden="true" />
        <div className="pp-ds-haze" aria-hidden="true" />

        <div
          ref={frameRef}
          className="pp-ds-frame"
          style={{ "--ds-zoom": zoom.scale, "--ds-ox": `${zoom.ox}%`, "--ds-oy": `${zoom.oy}%` }}
        >
          {zoomed ? null : (
            <div className="pp-ds-reflect" aria-hidden="true">
              <DressupMedia src={previewSrc && !comparing ? previewSrc : baseSrc} fallbackSrc={baseFallbackSrc} alt="" />
            </div>
          )}
          <div className="pp-ds-figure">
            <DressupMedia src={baseSrc} fallbackSrc={baseFallbackSrc} alt={baseIsDraft ? "上一轮结果" : "当前立绘"} eager />
          </div>
          {previewSrc ? (
            <div className={`pp-ds-figure is-after${peek && comparing ? " is-hidden" : ""}`}>
              <DressupMedia src={previewSrc} alt="装扮结果" eager />
            </div>
          ) : null}
          {comparing && peek ? <span className="pp-ds-peek-tag">原图</span> : null}

          {editing && !zoomed ? (
            <nav className="pp-ds-spots" aria-label="身上的部位光点">
              {DRESSUP_GROUPS.map((group, index) => {
                const count = group.items.filter((id) => isDressupSlotFilled(selection[id])).length;
                const spot = HOTSPOTS[group.id];
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={`pp-ds-spot${openGroup === group.id ? " is-open" : ""}${count ? " is-filled" : ""}${spot.left > 55 ? " is-right" : ""}`}
                    style={{ top: `${spot.top}%`, left: `${spot.left}%` }}
                    aria-expanded={openGroup === group.id}
                    onClick={() => openHotspot(group)}
                  >
                    <i aria-hidden="true" />
                    <span>
                      <kbd aria-hidden="true">{index + 1}</kbd>
                      {group.label}
                      {count ? <sup>{count}</sup> : null}
                    </span>
                  </button>
                );
              })}
            </nav>
          ) : null}

        </div>

        {popGroup && editing ? (
          <section className="pp-ds-pop" aria-label={`${popGroup.label}装扮`}>
            <nav className="pp-ds-pop__groups" aria-label="部位分组">
              {DRESSUP_GROUPS.map((group) => {
                const count = group.items.filter((id) => isDressupSlotFilled(selection[id])).length;
                return (
                  <button
                    key={group.id}
                    type="button"
                    className={group.id === popGroup.id ? "is-on" : ""}
                    onClick={() => openHotspot(group)}
                  >
                    {group.label}
                    {count ? <sup>{count}</sup> : null}
                  </button>
                );
              })}
            </nav>
            <header>
              <nav aria-label={`${popGroup.label}部位`}>
                {popGroup.items.map((id) => {
                  const category = dressupCategory(id);
                  const current = selection[id] || emptyDressupSlot();
                  const partLock = dressupSlotLock(selection, id, maxReferenceImages);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`${id === active.id ? "is-on" : ""}${isDressupSlotFilled(current) ? " is-filled" : ""}${partLock.locked ? " is-locked" : ""}`}
                      title={partLock.locked ? partLock.reason : category.hint}
                      onClick={() => onCategory(id)}
                    >
                      {category.label}
                    </button>
                  );
                })}
              </nav>
              <button type="button" className="pp-ds-pop__close" aria-label="收起" onClick={() => setOpenGroup("")}>
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            </header>
            <p className={`pp-ds-pop__hint${lock.reason ? " is-warn" : ""}`}>{lock.reason || active.hint}</p>
            {lock.locked ? null : (
              <textarea
                key={active.id}
                value={slot.text}
                placeholder={active.placeholder}
                aria-label={`描述想换的${active.label}`}
                rows={3}
                autoFocus
                onChange={(event) => onSlotChange(active.id, { text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.stopPropagation();
                    setOpenGroup("");
                  }
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && picked.length) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  pickFile(event.dataTransfer.files?.[0]);
                }}
              />
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={(event) => {
                pickFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {lock.locked ? null : (
              <footer>
                {slot.previewUrl ? (
                  <span className="pp-ds-ref">
                    <DressupMedia src={slot.previewUrl} fallbackSrc={slot.sourceUrl} alt={`${active.label}参考图`} />
                    <button
                      type="button"
                      aria-label="移除参考图"
                      onClick={() => onSlotChange(active.id, { file: null, previewUrl: "", sourceUrl: "" })}
                    >
                      <i className="bi bi-x" aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
                {lock.imageLocked ? null : (
                  <>
                    <button type="button" aria-label="上传参考图" onClick={() => fileInputRef.current?.click()}>
                      {slot.previewUrl ? "换图" : "+ 参考图"}
                    </button>
                    <button type="button" onClick={() => setAssetOpen(true)}>
                      我的资产
                    </button>
                  </>
                )}
                {filled ? (
                  <button type="button" className="is-end" onClick={() => onClearSlot(active.id)}>
                    还原
                  </button>
                ) : null}
              </footer>
            )}
          </section>
        ) : null}

        {busy ? (
          <div className={`pp-ds-busy${generating ? "" : " is-saving"}`} role="status">
            {generating ? <span className="pp-ds-busy__beam" aria-hidden="true" /> : null}
            <em>{note || (generating ? "正在换装…" : "正在保存…")}</em>
          </div>
        ) : null}

        {!busy && !previewSrc && note ? (
          <div className="pp-ds-notice" role="alert">
            <i className="bi bi-exclamation-circle" aria-hidden="true" />
            <span>{note}</span>
            {onDismissNote ? (
              <button type="button" aria-label="关闭提示" onClick={onDismissNote}>
                <i className="bi bi-x" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}

        <header className="pp-ds-top">
          <div className="pp-ds-title">
            <h2 id="pp-dressup-title" className="pp-ds-sr">
              换装工作台
            </h2>
            <p className="pp-ds-title__over">STARCLOUDS · FITTING ROOM</p>
            <p className="pp-ds-title__main">{title.main}</p>
            <p className="pp-ds-title__sub">{title.sub}</p>
          </div>
          <div className="pp-ds-top__tools">
            <div
              className="pp-ds-seg"
              role="radiogroup"
              aria-label="取景"
              data-active={!zoomed ? "0" : Math.abs(zoom.scale - 1.7) < 0.02 ? "1" : "none"}
            >
              <span className="pp-ds-seg__thumb" aria-hidden="true" />
              {[
                ["全身", { scale: 1, ox: 50, oy: 8 }],
                ["半身", { scale: 1.7, ox: 50, oy: 8 }],
              ].map(([label, preset]) => {
                const on = label === "全身" ? !zoomed : Math.abs(zoom.scale - 1.7) < 0.02;
                return (
                  <button
                    key={label}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className={on ? "is-on" : ""}
                    onClick={() => setZoom(preset)}
                  >
                    {label}
                  </button>
                );
              })}
              <span className="pp-ds-seg__zoom" title="滚轮缩放，双击还原">
                {Math.round(zoom.scale * 100)}%
              </span>
            </div>
            <button
              type="button"
              className="pp-ds-close"
              aria-label="关闭装扮"
              disabled={busy || closeLocked}
              onClick={onClose}
            >
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          </div>
        </header>

        {drawer ? (
          <section className="pp-ds-drawer" aria-label={drawer === "closet" ? "衣橱" : "整套灵感"}>
            {drawer === "closet" ? (
              <WardrobeStrip
                items={wardrobe}
                currentFigureUrl={currentFigureUrl}
                busy={busy}
                onWear={onWear}
                onRemove={onRemoveLook}
              />
            ) : (
              <ul className="pp-ds-strip is-looks">
                {DRESSUP_PRESETS.map((preset) => (
                  <li key={preset.id}>
                    <button
                      type="button"
                      className="pp-ds-strip__preset"
                      onClick={() => {
                        onApplyPreset(preset);
                        setDrawer("");
                      }}
                    >
                      <b>{preset.label}</b>
                      <small>
                        {Object.keys(preset.slots)
                          .map((id) => dressupCategory(id)?.label)
                          .join(" · ")}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        <footer className="pp-ds-dock" aria-live="polite">
          {previewSrc ? (
            <>
              <button
                type="button"
                className={`is-text pp-ds-peek${peek ? " is-on" : ""}`}
                aria-pressed={peek}
                title="点击切换原图 / 新造型；按住或按住空格可临时查看原图"
                onPointerDown={() => {
                  clearTimeout(peekHoldRef.current.timer);
                  peekHoldRef.current.timer = setTimeout(() => {
                    peekHoldRef.current.holding = true;
                    setPeek(true);
                  }, 220);
                }}
                onPointerUp={() => {
                  clearTimeout(peekHoldRef.current.timer);
                  if (peekHoldRef.current.holding) {
                    peekHoldRef.current.holding = false;
                    peekHoldRef.current.skipClick = true;
                    setPeek(false);
                  }
                }}
                onPointerLeave={() => {
                  clearTimeout(peekHoldRef.current.timer);
                  if (peekHoldRef.current.holding) {
                    peekHoldRef.current.holding = false;
                    peekHoldRef.current.skipClick = true;
                    setPeek(false);
                  }
                }}
                onClick={() => {
                  // 长按结束会紧跟一次 click，忽略它；普通点击则切换
                  if (peekHoldRef.current.skipClick) {
                    peekHoldRef.current.skipClick = false;
                    return;
                  }
                  setPeek((value) => !value);
                }}
              >
                <i className={`bi ${peek ? "bi-stars" : "bi-eye"}`} aria-hidden="true" />
                {peek ? "看新造型" : "看原图"}
              </button>
              <span className="pp-ds-dock__sep" aria-hidden="true" />
              <button type="button" className="is-text" disabled={busy} onClick={onDiscardPreview}>
                放弃
              </button>
              <button type="button" className="is-text" disabled={busy} onClick={onRetry}>
                重新生成
              </button>
              <button type="button" className="is-text" disabled={busy} onClick={onContinue}>
                在此基础上继续
              </button>
              <button type="button" className="is-primary" disabled={busy} onClick={onUsePreview}>
                <i className="bi bi-check2" aria-hidden="true" />
                使用这张
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`is-text${drawer === "closet" ? " is-on" : ""}`}
                disabled={busy}
                aria-pressed={drawer === "closet"}
                onClick={() => toggleDrawer("closet")}
              >
                <i className="bi bi-archive" aria-hidden="true" />
                衣橱{wardrobe.length ? <sup>{wardrobe.length}</sup> : null}
              </button>
              <button
                type="button"
                className={`is-text${drawer === "looks" ? " is-on" : ""}`}
                disabled={busy}
                aria-pressed={drawer === "looks"}
                onClick={() => toggleDrawer("looks")}
              >
                <i className="bi bi-stars" aria-hidden="true" />
                灵感
              </button>
              {!openGroup ? (
                <button type="button" className="is-text" disabled={busy} onClick={() => openHotspot(activeGroup)}>
                  <i className="bi bi-sliders2" aria-hidden="true" />
                  编辑部位
                </button>
              ) : null}
              <span className="pp-ds-dock__sep" aria-hidden="true" />
              {picked.length ? (
                <ul className="pp-ds-worn" aria-label="已装配部位">
                  {picked.map(({ category, slot: item }) => (
                    <li key={category.id}>
                      <button
                        type="button"
                        title={dressupSlotSummary(item)}
                        disabled={busy}
                        onClick={() => {
                          setDrawer("");
                          setOpenGroup(dressupGroupOf(category.id).id);
                          onCategory(category.id);
                        }}
                      >
                        {category.label}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="pp-ds-meter">
                <span className={usage.parts >= usage.partLimit ? "is-full" : ""}>
                  部位 {usage.parts}/{usage.partLimit}
                </span>
                <span className={usage.images >= usage.imageLimit ? "is-full" : ""}>
                  参考图 {usage.images}/{usage.imageLimit}
                </span>
              </p>
              {picked.length ? (
                <button type="button" className="is-text" disabled={busy} onClick={onReset}>
                  清空
                </button>
              ) : null}
              {baseIsDraft ? (
                <button type="button" className="is-text" disabled={busy} onClick={onUseBase}>
                  使用上一轮结果
                </button>
              ) : null}
              <button
                type="button"
                className="is-primary"
                disabled={busy || !picked.length}
                title="⌘/Ctrl + Enter"
                onClick={onConfirm}
              >
                <i className="bi bi-magic" aria-hidden="true" />
                {busy ? "换装中…" : "生成装扮"}
              </button>
            </>
          )}
        </footer>
        <div className="pp-ds-grain" aria-hidden="true" />
      </div>

      {assetOpen ? (
        <div className="pp-dressup__assets" role="dialog" aria-label="从我的资产选择">
          <header>
            <div>
              <p>我的资产</p>
              <strong>选择一张作为{active.label}参考图</strong>
            </div>
            <button type="button" aria-label="关闭资产选择" onClick={() => setAssetOpen(false)}>
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          </header>
          <div className="pp-dressup__assets-body">
            {assets.loading && !assets.items.length ? (
              <p>正在读取资产…</p>
            ) : assets.error && !assets.items.length ? (
              <p>{assets.error}</p>
            ) : assets.items.length ? (
              <div className="pp-dressup__assets-grid">
                {assets.items.map((asset) => (
                  <button key={asset.id} type="button" disabled={busy} onClick={() => pickAsset(asset)}>
                    <DressupMedia src={asset.thumbnailUrl || asset.url} fallbackSrc={asset.url} alt={asset.title || "个人素材"} />
                    <span>{asset.title || "未命名素材"}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="pp-dressup__assets-empty">
                <p>还没有资产</p>
                <Link to="/assets">去素材库上传</Link>
              </div>
            )}
          </div>
          {assets.nextCursor ? (
            <footer>
              <button type="button" disabled={assets.loading} onClick={() => void loadMoreAssets()}>
                {assets.loading ? "加载中…" : "加载更多"}
              </button>
            </footer>
          ) : null}
        </div>
      ) : null}
    </DialogMotion>
  );
}
