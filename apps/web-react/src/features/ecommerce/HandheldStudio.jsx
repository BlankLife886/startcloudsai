import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { useIsDark } from "../../hooks/useIsDark.js";
import { DialogMotion } from "../../components/motion/DialogMotion.jsx";
import { CommerceSelect } from "./CommerceSelect.jsx";
import { handheldShotBlueprints } from "./ecommerceTools.js";
import "./HandheldStudio.css";

gsap.registerPlugin(useGSAP);

function handheldOverlayRoot() {
  const id = "react-ecommerce-overlay-root";
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    document.body.appendChild(root);
  }
  return root;
}

function handheldAnimationsDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

function formatSeconds(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  return value >= 100 ? String(value) : String(value).padStart(2, "0");
}

function groupHandheldHistory(history) {
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

function TuneField({ label, children }) {
  return (
    <div className="handheld-tune__field">
      <span>{label}</span>
      {children}
    </div>
  );
}

export function HandheldTunePopover({
  style,
  styleOptions = [],
  onChangeStyle,
  lens,
  lensOptions = [],
  onChangeLens,
  camera,
  cameraOptions = [],
  onChangeCamera,
  depth,
  depthOptions = [],
  onChangeDepth,
  light,
  lightOptions = [],
  onChangeLight,
  focus,
  focusOptions = [],
  onChangeFocus,
  materialInteraction,
  materialInteractionOptions = [],
  onChangeMaterialInteraction,
  architecture,
  architectureOptions = [],
  onChangeArchitecture,
  photoPreset = "",
  photoPresetOptions = [],
  onChangePhotoPreset,
  disabled = false,
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const hasSelection = [
    style,
    lens,
    camera,
    depth,
    light,
    focus,
    materialInteraction,
    architecture,
    photoPreset,
  ].some((value) => String(value || "").trim());

  function positionMenu() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const padding = 10;
    const width = Math.min(400, window.innerWidth - padding * 2);
    const maxHeight = Math.min(600, window.innerHeight - padding * 2);
    const below = window.innerHeight - rect.bottom - padding;
    const placeAbove = below < 240 && rect.top > below;
    setMenuStyle({
      left: Math.min(
        Math.max(padding, rect.right - 72),
        window.innerWidth - width - padding,
      ),
      top: placeAbove
        ? Math.max(padding, rect.top - maxHeight - gap)
        : rect.bottom + gap,
      width,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const closeOutside = (event) => {
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="commerce-header__tune">
      <button
        ref={triggerRef}
        type="button"
        className={`commerce-header__tune-trigger${hasSelection ? "" : " is-placeholder"}${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="画面方案"
        onClick={() => setOpen((current) => !current)}
      >
        <span>画面方案</span>
        <i className="bi bi-chevron-down" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="handheld-tune-menu"
              style={menuStyle}
              role="dialog"
              aria-label="画面方案选项"
            >
              <div
                className="handheld-presets"
                role="radiogroup"
                aria-label="选择画面方案"
              >
                {photoPresetOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={photoPreset === item.id}
                    className={photoPreset === item.id ? "is-active" : ""}
                    disabled={disabled}
                    onPointerUp={(event) => {
                      event.preventDefault();
                      onChangePhotoPreset?.(
                        photoPreset === item.id ? "" : item.id,
                      );
                    }}
                    onClick={(event) => {
                      if (event.detail !== 0) return;
                      onChangePhotoPreset?.(
                        photoPreset === item.id ? "" : item.id,
                      );
                    }}
                  >
                    <i className={`bi ${item.icon}`} />
                    <span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </span>
                  </button>
                ))}
              </div>
              <TuneField label="风格">
                <ChipGroup
                  label="选择视觉风格"
                  value={style}
                  options={styleOptions}
                  onChange={onChangeStyle}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="焦段">
                <ChipGroup
                  label="选择镜头"
                  value={lens}
                  options={lensOptions}
                  onChange={onChangeLens}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="机位">
                <ChipGroup
                  label="选择机位"
                  value={camera}
                  options={cameraOptions}
                  onChange={onChangeCamera}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="景深">
                <ChipGroup
                  label="选择景深与距离"
                  value={depth}
                  options={depthOptions}
                  onChange={onChangeDepth}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="光影">
                <ChipGroup
                  label="选择光影"
                  value={light}
                  options={lightOptions}
                  onChange={onChangeLight}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="焦点">
                <ChipGroup
                  label="选择视觉焦点"
                  value={focus}
                  options={focusOptions}
                  onChange={onChangeFocus}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="材质交互">
                <ChipGroup
                  label="选择材质交互"
                  value={materialInteraction}
                  options={materialInteractionOptions}
                  onChange={onChangeMaterialInteraction}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="生成方式">
                <ChipGroup
                  label="选择生成方式"
                  value={architecture}
                  options={architectureOptions}
                  onChange={onChangeArchitecture}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function HandheldProductPopover({
  category,
  categoryOptions = [],
  onChangeCategory,
  packState,
  packStateOptions = [],
  onChangePackState,
  productName = "",
  onChangeProductName,
  sku = "",
  onChangeSku,
  sellingPoints = "",
  onChangeSellingPoints,
  disabled = false,
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const hasSelection = [
    category,
    packState,
    productName,
    sku,
    sellingPoints,
  ].some((value) => String(value || "").trim());

  function positionMenu() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const padding = 10;
    const width = Math.min(400, window.innerWidth - padding * 2);
    const maxHeight = Math.min(600, window.innerHeight - padding * 2);
    const below = window.innerHeight - rect.bottom - padding;
    const placeAbove = below < 240 && rect.top > below;
    setMenuStyle({
      left: Math.min(
        Math.max(padding, rect.right - 72),
        window.innerWidth - width - padding,
      ),
      top: placeAbove
        ? Math.max(padding, rect.top - maxHeight - gap)
        : rect.bottom + gap,
      width,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const closeOutside = (event) => {
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="commerce-header__tune">
      <button
        ref={triggerRef}
        type="button"
        className={`commerce-header__tune-trigger${hasSelection ? "" : " is-placeholder"}${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="商品信息"
        onClick={() => setOpen((current) => !current)}
      >
        <span>商品信息</span>
        <i className="bi bi-chevron-down" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="handheld-tune-menu handheld-product-menu"
              style={menuStyle}
              role="dialog"
              aria-label="商品信息选项"
            >
              <TuneField label="品类">
                <ChipGroup
                  label="选择商品品类"
                  value={category}
                  options={categoryOptions}
                  onChange={onChangeCategory}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="包装">
                <ChipGroup
                  label="选择包装状态"
                  value={packState}
                  options={packStateOptions}
                  onChange={onChangePackState}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="商品名">
                <input
                  className="handheld-input"
                  value={productName}
                  onChange={(event) => onChangeProductName?.(event.target.value)}
                  placeholder="例如：玫瑰金无线耳机"
                  disabled={disabled}
                  aria-label="商品名"
                />
              </TuneField>
              <TuneField label="货号">
                <input
                  className="handheld-input"
                  value={sku}
                  onChange={(event) => onChangeSku?.(event.target.value)}
                  placeholder="SKU / 色号"
                  disabled={disabled}
                  aria-label="货号"
                />
              </TuneField>
              <TuneField label="卖点与要求">
                <textarea
                  className="handheld-input handheld-input--area"
                  rows={2}
                  value={sellingPoints}
                  onChange={(event) =>
                    onChangeSellingPoints?.(event.target.value)
                  }
                  placeholder="必须露出 Logo、不能挡色号…"
                  disabled={disabled}
                  aria-label="卖点与要求"
                />
              </TuneField>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export function HandheldPosePopover({
  pose,
  poseOptions = [],
  onChangePose,
  hand,
  handOptions = [],
  onChangeHand,
  disabled = false,
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState({});
  const hasSelection = [pose, hand].some((value) =>
    String(value || "").trim(),
  );

  function positionMenu() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 8;
    const padding = 10;
    const width = Math.min(400, window.innerWidth - padding * 2);
    const maxHeight = Math.min(600, window.innerHeight - padding * 2);
    const below = window.innerHeight - rect.bottom - padding;
    const placeAbove = below < 240 && rect.top > below;
    setMenuStyle({
      left: Math.min(
        Math.max(padding, rect.right - 72),
        window.innerWidth - width - padding,
      ),
      top: placeAbove
        ? Math.max(padding, rect.top - maxHeight - gap)
        : rect.bottom + gap,
      width,
      maxHeight,
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const closeOutside = (event) => {
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOutside, true);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOutside, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="commerce-header__tune">
      <button
        ref={triggerRef}
        type="button"
        className={`commerce-header__tune-trigger${hasSelection ? "" : " is-placeholder"}${open ? " is-open" : ""}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="握持姿势"
        onClick={() => setOpen((current) => !current)}
      >
        <span>握持姿势</span>
        <i className="bi bi-chevron-down" aria-hidden="true" />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              className="handheld-tune-menu"
              style={menuStyle}
              role="dialog"
              aria-label="握持姿势选项"
            >
              <TuneField label="姿势">
                <ChipGroup
                  label="选择握持姿势"
                  value={pose}
                  options={poseOptions}
                  onChange={onChangePose}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
              <TuneField label="左右手">
                <ChipGroup
                  label="选择左右手"
                  value={hand}
                  options={handOptions}
                  onChange={onChangeHand}
                  disabled={disabled}
                  allowEmpty
                />
              </TuneField>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

const PLATFORM_SHORT = {
  taobao: "淘宝",
  detail: "配图",
  xhs: "小红书",
  douyin: "抖音",
  amazon: "Amazon",
  shop: "独立站",
};

function ChipGroup({
  label,
  value,
  options,
  onChange,
  disabled,
  allowEmpty = false,
  nameKey = "id",
}) {
  return (
    <div className="handheld-picks" role="radiogroup" aria-label={label}>
      {options.map((item) => {
        const id = item[nameKey] ?? item.value;
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            className={active ? "is-active" : ""}
            disabled={disabled}
            onPointerUp={
              allowEmpty
                ? (event) => {
                    event.preventDefault();
                    onChange?.(active ? "" : id);
                  }
                : undefined
            }
            onClick={(event) => {
              if (allowEmpty && event.detail !== 0) return;
              onChange?.(active && allowEmpty ? "" : id);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function channelRatioVar(ratio) {
  const [w, h] = String(ratio || "4:5").split(":");
  return `${w || 4} / ${h || 5}`;
}

function HandheldPromptDialog({ open, prompt = "", onClose, onApply }) {
  const textareaRef = useRef(null);
  const [draft, setDraft] = useState(prompt);

  useEffect(() => {
    if (!open) return;
    setDraft(prompt);
    const frame = window.requestAnimationFrame(() => {
      textareaRef.current?.setSelectionRange(0, 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, prompt]);

  return (
    <DialogMotion
      open={open}
      layerClassName="handheld-prompt-dialog"
      panelClassName="handheld-prompt-dialog__panel"
      ariaLabelledby="handheld-prompt-dialog-title"
      initialFocusRef={textareaRef}
      onClose={onClose}
    >
      <header data-dialog-motion-item>
        <div>
          <small>完整出图规则</small>
          <h2 id="handheld-prompt-dialog-title">说明修改</h2>
        </div>
        <button type="button" aria-label="关闭说明修改" onClick={onClose}>
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </header>
      <textarea
        ref={textareaRef}
        data-dialog-motion-item
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        aria-label="完整出图规则"
        spellCheck={false}
      />
      <footer data-dialog-motion-item>
        <span>{draft.length} 字符</span>
        <div>
          <button type="button" onClick={onClose}>
            暂不修改
          </button>
          <button
            type="button"
            className="is-primary"
            disabled={!draft.trim()}
            onClick={() => onApply?.(draft.trim())}
          >
            应用规则
          </button>
        </div>
      </footer>
    </DialogMotion>
  );
}

function guideBox(root, selector) {
  const el = root.querySelector(selector);
  if (!el) return null;
  const rootBox = root.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  return {
    cx: Math.round(box.left - rootBox.left + box.width / 2),
    cy: Math.round(box.top - rootBox.top + box.height / 2),
    top: Math.round(box.top - rootBox.top),
    right: Math.round(box.left - rootBox.left + box.width),
    bottom: Math.round(box.top - rootBox.top + box.height),
    left: Math.round(box.left - rootBox.left),
  };
}

function guideLine(from, to) {
  return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
}

function guidePath(points) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}

function handheldEarliestStartedAt(shots = []) {
  const timestamps = shots
    .filter((shot) => shot?.running)
    .map((shot) => Date.parse(shot?.startedAt || ""))
    .filter(Number.isFinite);
  return timestamps.length ? Math.min(...timestamps) : 0;
}

export function HandheldGeneratingStage({
  productUrl = "",
  sceneImage = "",
  label = "",
  seconds = 0,
  generationStageLabel = "正在生成",
}) {
  const rootRef = useRef(null);
  const frame = productUrl || sceneImage;

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return undefined;
      const blobs = root.querySelectorAll(".handheld-generating__blob");
      const reduced = handheldAnimationsDisabled();

      gsap.set(blobs[0], { yPercent: -8, scale: 1, autoAlpha: 0.9 });
      gsap.set(blobs[1], { yPercent: 10, scale: 1.05, autoAlpha: 0.7 });
      gsap.set(blobs[2], { yPercent: 4, scale: 0.92, autoAlpha: 0.55 });
      if (reduced) return undefined;

      gsap.to(blobs[0], {
        yPercent: 10,
        scale: 1.18,
        duration: 7.5,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
      gsap.to(blobs[1], {
        yPercent: -12,
        scale: 0.9,
        duration: 9.2,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
      gsap.to(blobs[2], {
        yPercent: -6,
        scale: 1.12,
        autoAlpha: 0.8,
        duration: 6.4,
        ease: "sine.inOut",
        yoyo: true,
        repeat: -1,
      });
      return undefined;
    },
    { scope: rootRef, dependencies: [frame], revertOnUpdate: true },
  );

  return (
    <div
      ref={rootRef}
      className="handheld-generating"
      role="status"
      aria-live="polite"
      aria-label={
        label
          ? `${generationStageLabel}${label}，已等待 ${formatSeconds(seconds)} 秒`
          : `${generationStageLabel}，已等待 ${formatSeconds(seconds)} 秒`
      }
    >
      <div className="handheld-generating__mesh" aria-hidden="true">
        <span className="handheld-generating__blob is-a" />
        <span className="handheld-generating__blob is-b" />
        <span className="handheld-generating__blob is-c" />
      </div>
      <div className="handheld-generating__copy">
        <strong key={seconds}>{formatSeconds(seconds)}</strong>
      </div>
    </div>
  );
}

function HandheldFlowGuides({ rootRef, revision, running = false }) {
  const svgRef = useRef(null);
  const [paths, setPaths] = useState([]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;

    const update = () => {
      const product = guideBox(root, ".handheld-product");
      const scene = guideBox(root, ".handheld-scene");
      const platform = guideBox(root, ".handheld-platform");
      const pack = guideBox(root, ".handheld-pack");
      const result = guideBox(root, ".handheld-frame");
      const channel = guideBox(root, ".handheld-channels > button.is-active");
      const job = guideBox(root, ".handheld-packs > button.is-active");
      const refSource =
        guideBox(root, ".handheld-crop") ||
        guideBox(root, ".handheld-layout");
      if (!product || !scene || !platform || !pack || !result) {
        setPaths((current) => (current.length ? [] : current));
        return;
      }
      const fromX = channel?.cx ?? platform.cx;
      const toX = job?.cx ?? pack.cx;
      const midY = (platform.bottom + pack.top) / 2;
      const packY = pack.cy;
      const resultX =
        result.left > pack.right + 24 ? result.left : pack.right + 48;
      const arrowSize = 9;
      const channelToJob =
        Math.abs(fromX - toX) < 3
          ? guideLine(
              { x: fromX, y: platform.bottom },
              { x: toX, y: pack.top },
            )
          : guidePath([
              { x: fromX, y: platform.bottom },
              { x: fromX, y: midY },
              { x: toX, y: midY },
              { x: toX, y: pack.top },
            ]);
      const next = [
        {
          d: guideLine(
            { x: product.cx, y: product.bottom },
            { x: product.cx, y: platform.top },
          ),
        },
        {
          d: guideLine(
            { x: scene.cx, y: scene.bottom },
            { x: scene.cx, y: platform.top },
          ),
        },
        { d: channelToJob },
        {
          d: guideLine(
            { x: pack.right, y: packY },
            { x: resultX - arrowSize, y: packY },
          ),
          arrow: { x: resultX, y: packY },
        },
      ];
      if (refSource && refSource.left > result.right + 4) {
        const refY = refSource.cy;
        const resultRightX =
          refSource.left > result.right + 24
            ? result.right
            : refSource.left - 48;
        next.push({
          d: guideLine(
            { x: refSource.left, y: refY },
            { x: resultRightX + arrowSize, y: refY },
          ),
          arrow: { x: resultRightX, y: refY, dir: "left" },
        });
      }
      setPaths((current) =>
        current.length === next.length &&
        current.every((item, index) => item.d === next[index].d)
          ? current
          : next,
      );
    };

    update();
    const frame = window.requestAnimationFrame(update);
    const observer = new ResizeObserver(update);
    observer.observe(root);
    for (const node of root.querySelectorAll(
      ".handheld-product, .handheld-scene, .handheld-platform, .handheld-pack, .handheld-frame, .handheld-crop, .handheld-layout",
    )) {
      observer.observe(node);
    }
    window.addEventListener("resize", update);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [rootRef, revision]);

  const pathKey = paths.map((item) => item.d).join("|");
  useGSAP(
    () => {
      const svg = svgRef.current;
      if (!svg || !pathKey) return undefined;
      const lines = svg.querySelectorAll(".handheld-guides__line");
      const flows = svg.querySelectorAll(".handheld-guides__flow");
      if (!running || handheldAnimationsDisabled()) {
        gsap.set(lines, { strokeDashoffset: 0 });
        gsap.set(flows, { autoAlpha: 0, strokeDashoffset: 0 });
        return undefined;
      }
      gsap.set(flows, { autoAlpha: 1 });
      gsap.to(lines, {
        strokeDashoffset: -24,
        duration: 0.9,
        ease: "none",
        repeat: -1,
      });
      gsap.to(flows, {
        strokeDashoffset: -36,
        duration: 0.72,
        ease: "none",
        repeat: -1,
      });
      return undefined;
    },
    {
      dependencies: [running, pathKey],
      scope: svgRef,
      revertOnUpdate: true,
    },
  );

  if (!paths.length) return null;
  return (
    <svg
      ref={svgRef}
      className={`handheld-guides${running ? " is-running" : ""}`}
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

export function HandheldRefCard({
  className = "",
  tag,
  image = "",
  emptyIcon = "bi-image",
  emptyLabel,
  emptyAria,
  previewAria,
  previewAlt,
  previewTitle,
  groupAria,
  uploadAria,
  clearAria,
  moreAria,
  popupTitle,
  popupHint,
  popupTitleId,
  popupKind = "",
  closeScrimLabel,
  catalog = [],
  featured,
  source = "",
  disabled = false,
  onPreview,
  onUpload,
  onClear,
  onSelect,
  onDrop,
  showMore = true,
  showClear = true,
  overlay = null,
}) {
  const isDark = useIsDark();
  const popupRootRef = useRef(null);
  const popupPanelRef = useRef(null);
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupRendered, setPopupRendered] = useState(false);
  const hasImage = Boolean(image);

  const closePopup = useCallback(() => {
    setPopupOpen(false);
  }, []);
  const openPopup = useCallback(() => {
    setPopupRendered(true);
    setPopupOpen(true);
  }, []);

  useEffect(() => {
    if (!popupRendered) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") closePopup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popupRendered, closePopup]);

  useEffect(() => {
    if (disabled) closePopup();
  }, [disabled, closePopup]);

  useGSAP(
    (context, contextSafe) => {
      if (!popupRendered) return undefined;
      const panel = popupPanelRef.current;
      const scrim = popupRootRef.current?.querySelector(
        ".tryon-model-popup__scrim",
      );
      if (!panel) return undefined;
      const reduced = handheldAnimationsDisabled();
      gsap.killTweensOf([panel, scrim]);
      if (popupOpen) {
        if (reduced) {
          gsap.set(panel, { autoAlpha: 1, y: 0, scale: 1 });
          if (scrim) gsap.set(scrim, { autoAlpha: 1 });
          return undefined;
        }
        if (scrim) {
          gsap.fromTo(
            scrim,
            { autoAlpha: 0 },
            { autoAlpha: 1, duration: 0.16, ease: "power2.out" },
          );
        }
        gsap.fromTo(
          panel,
          { autoAlpha: 0, y: 12, scale: 0.96 },
          {
            autoAlpha: 1,
            y: 0,
            scale: 1,
            duration: 0.26,
            ease: "power3.out",
          },
        );
        return undefined;
      }
      if (reduced) {
        setPopupRendered(false);
        return undefined;
      }
      const finishClose = (contextSafe || ((callback) => callback))(() => {
        setPopupRendered(false);
      });
      if (scrim) {
        gsap.to(scrim, { autoAlpha: 0, duration: 0.14, ease: "power2.in" });
      }
      gsap.to(panel, {
        autoAlpha: 0,
        y: 8,
        scale: 0.98,
        duration: 0.18,
        ease: "power2.in",
        onComplete: finishClose,
      });
      return undefined;
    },
    {
      dependencies: [popupOpen, popupRendered],
      revertOnUpdate: false,
      scope: popupRootRef,
    },
  );

  function handleDragOver(event) {
    if (!onDrop) return;
    event.preventDefault();
    event.stopPropagation();
  }
  function handleDrop(event) {
    if (!onDrop) return;
    event.preventDefault();
    event.stopPropagation();
    const files = event.dataTransfer?.files;
    if (files?.length) onDrop(files);
  }

  return (
    <div
      className={`handheld-ref-card${hasImage ? "" : " is-empty"}${hasImage ? " has-file" : ""}${className ? ` ${className}` : ""}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {overlay}
      <span className="handheld-ref-card__tag">{tag}</span>
      {hasImage ? (
        <button
          type="button"
          className="handheld-ref-card__hit"
          aria-label={previewAria}
          onClick={(event) =>
            onPreview?.(event, {
              url: image,
              alt: previewAlt || tag,
              title: previewTitle || tag,
            })
          }
        >
          <img src={image} alt={previewAlt || tag} />
        </button>
      ) : (
        <button
          type="button"
          className="handheld-ref-card__hit is-upload"
          aria-label={emptyAria || uploadAria}
          disabled={disabled}
          onClick={onUpload}
        >
          <i className={`bi ${emptyIcon}`} />
          <span>{emptyLabel}</span>
        </button>
      )}
      <div className="handheld-ref-card__actions" role="group" aria-label={groupAria}>
        {showMore ? (
          <button
            type="button"
            className={popupOpen ? "is-active" : ""}
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={popupOpen}
            aria-label={moreAria}
            onClick={() => {
              if (popupOpen) closePopup();
              else openPopup();
            }}
          >
            <i className="bi bi-grid" />
            更多
          </button>
        ) : null}
        {showClear ? (
          <button
            type="button"
            disabled={disabled || !hasImage}
            aria-label={clearAria}
            onClick={onClear}
          >
            <i className="bi bi-eraser" />
            清空
          </button>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          aria-label={uploadAria}
          onClick={onUpload}
        >
          <i className="bi bi-cloud-arrow-up" />
          上传
        </button>
      </div>
      {popupRendered
        ? createPortal(
            <div
              ref={popupRootRef}
              className={`tryon-model-popup-root${isDark ? "" : " is-light"}${popupOpen ? " is-open" : " is-closing"}`}
            >
              <button
                type="button"
                className="tryon-model-popup__scrim"
                aria-label={closeScrimLabel}
                onClick={closePopup}
              />
              <section
                ref={popupPanelRef}
                className={`tryon-model-popup${popupKind ? ` is-${popupKind}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={popupTitleId}
              >
                <header className="tryon-model-popup__head">
                  <div>
                    <strong id={popupTitleId}>{popupTitle}</strong>
                    <small>{popupHint}</small>
                  </div>
                  <button type="button" aria-label="关闭" onClick={closePopup}>
                    <i className="bi bi-x-lg" />
                  </button>
                </header>
                {catalog.length ? (
                  <div className="tryon-model-popup__grid">
                    {catalog.map((option) => {
                      const selected =
                        hasImage &&
                        source !== "upload" &&
                        featured?.id === option.id;
                      return (
                        <article
                          key={option.id}
                          className={`tryon-model-popup__card${selected ? " is-active" : ""}`}
                        >
                          <button
                            type="button"
                            className="tryon-model-popup__hit"
                            aria-label={option.label}
                            onClick={() => {
                              onSelect?.(option);
                              closePopup();
                            }}
                          >
                            <span className="tryon-model-popup__media">
                              <img src={option.image} alt="" />
                              <span className="tryon-model-popup__name">{option.label}</span>
                            </span>
                          </button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="handheld-ref-popup__empty">暂无模板，请直接上传</p>
                )}
              </section>
            </div>,
            handheldOverlayRoot(),
          )
        : null}
    </div>
  );
}

function annotationDraft(items = []) {
  return (Array.isArray(items) ? items : []).slice(0, 12).map((item, index) => ({
    id: String(item?.id || `annotation-${index + 1}`),
    x: Math.min(1, Math.max(0, Number(item?.x) || 0)),
    y: Math.min(1, Math.max(0, Number(item?.y) || 0)),
    text: String(item?.text || "").slice(0, 240),
    enabled: item?.enabled !== false,
  }));
}

function HandheldAnnotationDialog({
  open,
  image,
  annotations,
  onApply,
  onClose,
}) {
  const [draft, setDraft] = useState([]);
  const [activeId, setActiveId] = useState("");
  const imageWrapRef = useRef(null);
  const dragRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const next = annotationDraft(annotations);
    setDraft(next);
    setActiveId(next[0]?.id || "");
  }, [open, annotations]);

  function positionFromEvent(event) {
    const rect = imageWrapRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  }

  function updateAnnotation(id, patch) {
    setDraft((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function addAnnotation(event) {
    if (draft.length >= 12) return;
    const position = positionFromEvent(event);
    if (!position) return;
    const id = `annotation-${Date.now()}-${draft.length + 1}`;
    setDraft((current) => [
      ...current,
      { id, ...position, text: "", enabled: true },
    ]);
    setActiveId(id);
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-annotation-input="${id}"]`)?.focus();
    });
  }

  function beginDrag(event, id) {
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = { id, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setActiveId(id);
  }

  function dragAnnotation(event) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const position = positionFromEvent(event);
    if (position) updateAnnotation(dragRef.current.id, position);
  }

  function endDrag(event) {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }

  const selectedCount = draft.filter(
    (item) => item.enabled && item.text.trim(),
  ).length;

  return (
    <DialogMotion
      open={open}
      variant="detail"
      layerClassName="handheld-annotation-dialog"
      panelClassName="handheld-annotation-dialog__panel"
      ariaLabelledby="handheld-annotation-title"
      onClose={onClose}
    >
      <header data-dialog-motion-item>
        <div>
          <small>商品图空间说明</small>
          <h2 id="handheld-annotation-title">图片标注</h2>
        </div>
        <span>{selectedCount} 条生效</span>
        <button type="button" aria-label="关闭" onClick={onClose}>
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </header>
      <div className="handheld-annotation-dialog__body" data-dialog-motion-item>
        <div className="handheld-annotation-canvas">
          <div
            ref={imageWrapRef}
            className="handheld-annotation-canvas__image"
            onPointerDown={addAnnotation}
            onPointerMove={dragAnnotation}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {image ? (
              <img src={image} alt="待标注商品图" draggable="false" />
            ) : (
              <div className="handheld-annotation-canvas__empty">
                先上传商品图
              </div>
            )}
            <div className="handheld-annotation-canvas__surface">
              {draft.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  className={`${activeId === item.id ? "is-active" : ""}${item.enabled ? "" : " is-disabled"}`}
                  style={{ left: `${item.x * 100}%`, top: `${item.y * 100}%` }}
                  aria-label={`标注 ${index + 1}，拖动调整位置`}
                  onPointerDown={(event) => beginDrag(event, item.id)}
                >
                  {index + 1}
                </button>
              ))}
            </div>
          </div>
          <p>
            <i className="bi bi-cursor-fill" aria-hidden="true" />
            点击图片添加标记，拖动标记调整位置
          </p>
        </div>
        <div className="handheld-annotation-list">
          {draft.length ? (
            draft.map((item, index) => (
              <article
                key={item.id}
                className={`${activeId === item.id ? "is-active" : ""}${item.enabled ? "" : " is-off"}`}
                onClick={() => setActiveId(item.id)}
              >
                <header>
                  <label className="handheld-annotation-list__toggle">
                    <input
                      type="checkbox"
                      checked={item.enabled}
                      onChange={(event) =>
                        updateAnnotation(item.id, {
                          enabled: event.target.checked,
                        })
                      }
                    />
                    <span>{index + 1}</span>
                  </label>
                  <small>
                    {Math.round(item.x * 100)}% · {Math.round(item.y * 100)}%
                  </small>
                  <em>{item.text.length}/240</em>
                  <button
                    type="button"
                    aria-label={`删除标注 ${index + 1}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      setDraft((current) =>
                        current.filter((entry) => entry.id !== item.id),
                      );
                    }}
                  >
                    <i className="bi bi-x-lg" aria-hidden="true" />
                  </button>
                </header>
                <textarea
                  data-annotation-input={item.id}
                  value={item.text}
                  maxLength={240}
                  rows={2}
                  placeholder="这个位置要保留、替换或新增什么"
                  onFocus={() => setActiveId(item.id)}
                  onChange={(event) =>
                    updateAnnotation(item.id, { text: event.target.value })
                  }
                />
              </article>
            ))
          ) : (
            <div className="handheld-annotation-list__empty">
              <i className="bi bi-geo-alt" aria-hidden="true" />
              <span>在图片上点击一个需要说明的位置</span>
            </div>
          )}
        </div>
      </div>
      <footer data-dialog-motion-item>
        <span>
          {draft.length >= 12
            ? "最多 12 条标注"
            : "仅勾选且已填写的标注会进入出图规则"}
        </span>
        <div>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={() => {
              onApply?.(
                draft
                  .filter((item) => item.text.trim())
                  .map((item) => ({ ...item, text: item.text.trim() })),
              );
              onClose?.();
            }}
          >
            应用标注
          </button>
        </div>
      </footer>
    </DialogMotion>
  );
}

export function HandheldStudio({
  product,
  layout,
  modelImage,
  modelCatalog,
  featuredModel,
  modelSource,
  handCatalog = [],
  featuredHand,
  onSelectHand,
  sceneImage,
  sceneCatalog,
  featuredScene,
  sceneSource,
  crop,
  cropOptions = [],
  onChangeCrop,
  pack,
  packOptions = [],
  onChangePack,
  platform,
  platformOptions = [],
  onChangePlatform,
  aspectRatio,
  ratioStyle,
  resultUrl,
  shots = [],
  history = [],
  shotLabels = [],
  running,
  failed,
  failCancelled = false,
  failMessage = "",
  elapsedSeconds = 0,
  generationStageLabel = "正在生成",
  generateDisabled,
  generateHint,
  shotCount = 1,
  costLabel = "",
  onGenerate,
  onSelectHistory,
  onPreview,
  onUploadProduct,
  onUploadModel,
  onUploadScene,
  onUploadLayout,
  onClearLayout,
  onClearModel,
  onClearScene,
  onSelectModel,
  onSelectScene,
  onDropProduct,
  onMaskEdit,
  actionBusy = false,
  onSaveAsset,
  onChangePrompt,
  annotations = [],
  onChangeAnnotations,
  onRetryShot,
  needsPerson = false,
  uploadNotice = "",
}) {
  const [runSeconds, setRunSeconds] = useState(0);
  const [promptEditor, setPromptEditor] = useState(null);
  const [annotationOpen, setAnnotationOpen] = useState(false);
  const outRef = useRef(null);
  const runOriginRef = useRef(0);
  const taskStartedAt = handheldEarliestStartedAt(shots);

  useEffect(() => {
    if (!running) {
      runOriginRef.current = 0;
      setRunSeconds(0);
      return undefined;
    }
    if (taskStartedAt) {
      if (!runOriginRef.current || taskStartedAt < runOriginRef.current) {
        runOriginRef.current = taskStartedAt;
      }
    } else if (!runOriginRef.current) {
      runOriginRef.current = Date.now();
    }
    const origin = runOriginRef.current;
    const tick = () => {
      setRunSeconds(Math.max(0, Math.floor((Date.now() - origin) / 1000)));
    };
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [running, taskStartedAt]);

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
  const historyGroups = groupHandheldHistory(history);
  const waitSeconds = running ? runSeconds : elapsedSeconds;
  const posterRatio = String(aspectRatio || "4:5");
  const selectedPack = packOptions.find((item) => item.id === pack) || packOptions[0];
  const selectedPlatform =
    platformOptions.find((item) => item.id === platform) || platformOptions[0];
  const packShots = handheldShotBlueprints(selectedPack?.id || pack).map(
    (item) => item.label,
  );
  const plannedShots = (
    shots.length
      ? shots
      : packShots.map((label, index) => ({
          id: `${selectedPack?.id || "shot"}-${index}`,
          label,
          url: index === 0 ? resultUrl : "",
        }))
  ).slice(0, Math.max(1, shotCount, packShots.length, shots.length));
  const displayShot =
    plannedShots.find((item) => item.url && item.url === resultUrl) ||
    plannedShots.find((item) => item.url && !item.failed) ||
    plannedShots.find((item) => item.running) ||
    plannedShots.find((item) => !item.url && !item.failed) ||
    plannedShots[0];
  const canvasShots = displayShot ? [displayShot] : [];
  // 原图 URL → 展示图 URL（服务端压缩大图）；主舞台大图用，404 回退原图
  const displayByUrl = new Map(
    (history || []).map((row) => [row.url, row.display || ""]),
  );
  const hasAnyResult = plannedShots.some((item) => item.url);
  const packThumbs = plannedShots.length > 1 ? plannedShots : [];

  return (
    <div className="handheld-studio" aria-label="手持商品工作台">
      <section
        ref={outRef}
        className={`handheld-out${running ? " is-running" : ""}`}
        aria-label="手持商品结果"
      >
        <HandheldFlowGuides
          rootRef={outRef}
          running={running}
          revision={`${posterRatio}-${pack}-${platform}-${shotCount}-${hasAnyResult ? 1 : 0}`}
        />
        {uploadNotice ? (
          <p
            className="handheld-pane__notice"
            role="status"
          >
            {uploadNotice}
          </p>
        ) : null}
        <div className="handheld-board handheld-board--top">
        <div className="handheld-board__refs">
        <HandheldRefCard
          className="handheld-product handheld-product--canvas"
          tag="商品图"
          image={product?.url || ""}
          emptyIcon="bi-image"
          emptyLabel="拖拽或点击"
          emptyAria="选择商品图片"
          previewAria="查看商品大图"
          previewAlt="商品参考图"
          previewTitle="商品"
          groupAria="商品图操作"
          uploadAria="上传商品图"
          showMore={false}
          showClear={false}
          overlay={
            <div className="handheld-ref-card__annotation">
              <button
                type="button"
                disabled={running || !product?.url}
                aria-haspopup="dialog"
                aria-label="编辑商品图片标注"
                title="图片标注"
                onClick={() => setAnnotationOpen(true)}
              >
                <i className="bi bi-geo-alt" aria-hidden="true" />
                <span>标注{annotations.length ? ` ${annotations.length}` : ""}</span>
              </button>
            </div>
          }
          disabled={running}
          onPreview={onPreview}
          onUpload={onUploadProduct}
          onDrop={onDropProduct}
        />
          <HandheldRefCard
            className="handheld-scene handheld-scene--canvas"
            tag="场景"
            image={sceneImage}
            emptyIcon="bi-image"
            emptyLabel="选择场景"
            emptyAria="选择场景图片"
            previewAria="查看场景"
            previewAlt={featuredScene?.label || "场景"}
            previewTitle="场景"
            groupAria="选择场景"
            uploadAria="上传场景"
            clearAria="清空场景"
            moreAria="更多手持场景"
            popupTitle="选择场景"
            popupHint="场景只提供环境和光线，不会带入原图里的人或货"
            popupTitleId="handheld-scene-popup-title"
            popupKind="scene"
            closeScrimLabel="关闭场景选择"
            catalog={sceneCatalog}
            featured={featuredScene}
            source={sceneSource}
            disabled={running}
            onPreview={onPreview}
            onUpload={onUploadScene}
            onClear={onClearScene}
            onSelect={onSelectScene}
          />
        </div>
        <div className="handheld-brief handheld-brief--canvas">
          <div className="handheld-platform">
            <div className="handheld-brief__head">
              <span className="handheld-brief__kicker">投放到</span>
              {selectedPlatform ? (
                <span className="handheld-brief__meta">
                  {selectedPlatform.hint || selectedPlatform.label}
                </span>
              ) : null}
            </div>
            <div
              className="handheld-channels"
              role="radiogroup"
              aria-label="选择投放渠道"
            >
              {platformOptions.map((item) => {
                const active = platform === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={item.label}
                    title={item.label}
                    className={active ? "is-active" : ""}
                    disabled={running}
                    onClick={() => onChangePlatform?.(item.id)}
                  >
                    <span
                      className="handheld-channels__frame"
                      style={{
                        "--channel-ratio": channelRatioVar(item.ratio),
                      }}
                      aria-hidden="true"
                    />
                    <span className="handheld-channels__name">
                      {PLATFORM_SHORT[item.id] || item.label}
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
                const active = pack === item.id;
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
                    <em>{item.countLabel || `${item.shotIds?.length || 1}张`}</em>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        </div>
        <div className="handheld-ref-stack">
          <HandheldRefCard
            className="handheld-layout handheld-layout--canvas"
            tag="构图参考"
            image={layout?.url || ""}
            emptyIcon="bi-layout-wtf"
            emptyLabel="只借构图"
            emptyAria="选择构图参考"
            previewAria="查看构图参考"
            previewAlt="构图参考"
            previewTitle="构图参考"
            groupAria="构图参考操作"
            uploadAria="上传构图参考"
            showMore={false}
            showClear
            clearAria="清空构图参考"
            disabled={running}
            onPreview={onPreview}
            onUpload={onUploadLayout}
            onClear={onClearLayout}
          />
          <div className="handheld-crop handheld-crop--canvas">
            {needsPerson ? (
              <HandheldRefCard
                className="handheld-model"
                tag="模特模板"
                overlay={cropOverlay}
                image={modelImage}
                emptyIcon="bi-person"
                emptyLabel="选择模特"
                emptyAria="选择模特图片"
                previewAria="查看模特模板"
                previewAlt={featuredModel?.label || "模特模板"}
                previewTitle="模特模板"
                groupAria="选择模特模板"
                uploadAria="上传模特模板"
                clearAria="清空模特模板"
                moreAria="更多模特模板"
                popupTitle="选择模特模板"
                popupHint="半身或全身出镜时使用"
                popupTitleId="handheld-model-popup-title"
                popupKind="model"
                closeScrimLabel="关闭模特模板选择"
                catalog={modelCatalog}
                featured={featuredModel}
                source={modelSource}
                disabled={running}
                onPreview={onPreview}
                onUpload={onUploadModel}
                onClear={onClearModel}
                onSelect={onSelectModel}
              />
            ) : (
              <HandheldRefCard
                className="handheld-hand"
                tag="手指图"
                overlay={cropOverlay}
                image={modelImage}
                emptyIcon="bi-hand-index"
                emptyLabel="选择手指图"
                emptyAria="选择手指图片"
                previewAria="查看手指图"
                previewAlt={featuredHand?.label || "手指图"}
                previewTitle="手指图"
                groupAria="选择手指图"
                uploadAria="上传手指图"
                clearAria="清空手指图"
                moreAria="更多手指图"
                popupTitle="选择手指图"
                popupHint="只选手、腕和肤色，不要用人像代替"
                popupTitleId="handheld-hand-popup-title"
                popupKind="hand"
                closeScrimLabel="关闭手指图选择"
                catalog={handCatalog}
                featured={featuredHand}
                source={modelSource}
                disabled={running}
                onPreview={onPreview}
                onUpload={onUploadModel}
                onClear={onClearModel}
                onSelect={onSelectHand}
              />
            )}
          </div>
        </div>
        <div
          className="handheld-shots"
          data-count={canvasShots.length}
          data-ratio={posterRatio}
          style={ratioStyle}
        >
          {canvasShots.map((shot, index) => {
            const planIndex = Math.max(0, plannedShots.indexOf(shot));
            const selected = Boolean(shot.url) && shot.url === resultUrl;
            const shotRunning = Boolean(shot.running) || (running && !shot.url && !shot.failed);
            const shotFailed = Boolean(shot.failed) || (failed && !shot.url && canvasShots.length === 1);
            const shotElapsed = Number(shot.elapsedSeconds) || (shot.url ? waitSeconds : 0);
            return (
              <div
                key={shot.id || `${selectedPack?.id || "shot"}-${index}`}
                className={`handheld-shot-stage${packThumbs.length ? " has-thumbs" : ""}`}
              >
              <div
                className={`handheld-frame${shot.url && !shotRunning ? " has-image" : ""}${shotRunning ? " is-running" : ""}${shotFailed ? " is-failed" : ""}${selected ? " is-selected" : ""}`}
                data-ratio={posterRatio}
                style={ratioStyle}
              >
                {shotRunning ? (
                  <HandheldGeneratingStage
                    productUrl={product?.url || ""}
                    sceneImage={sceneImage}
                    label={shot.label || `第 ${index + 1} 张`}
                    seconds={waitSeconds}
                    generationStageLabel={generationStageLabel}
                  />
                ) : shotFailed ? (
                  <div className="handheld-frame__status" role="alert">
                    <strong>{failCancelled ? "已停止生成" : "生成失败"}</strong>
                    <span>{shot.error || failMessage || "请稍后重试"}</span>
                  </div>
                ) : shot.url ? (
                  <button
                    type="button"
                    className="handheld-frame__shot"
                    aria-label={`查看${shot.label || "生成结果"}`}
                    aria-pressed={selected}
                    onClick={(event) => {
                      onSelectHistory?.(shot.url);
                      if (canvasShots.length === 1) {
                        onPreview?.(event, {
                          url: shot.url,
                          alt: shot.label || "手持商品生成结果",
                          title: shot.label || "生成结果",
                        });
                      }
                    }}
                    onDoubleClick={(event) =>
                      onPreview?.(event, {
                        url: shot.url,
                        alt: shot.label || "手持商品生成结果",
                        title: shot.label || "生成结果",
                      })
                    }
                  >
                    <AuthenticatedImage
                      src={displayByUrl.get(shot.url) || shot.url}
                      fallbackSrc={shot.url}
                      alt={shot.label || "手持商品生成结果"}
                      loading="eager"
                      maxDimension={1600}
                    />
                  </button>
                ) : (
                  <div className="handheld-frame__status">
                    <strong>
                      {!hasAnyResult && index === 0
                        ? "还没有结果"
                        : shot.label || `第 ${index + 1} 张`}
                    </strong>
                    <span>
                      {shot.label
                        ? `${String(index + 1).padStart(2, "0")} · ${shot.label}`
                        : "上传商品后点生成"}
                    </span>
                  </div>
                )}
                {shot.label ? (
                  <small className="handheld-frame__label">{shot.label}</small>
                ) : null}
                {shot.url && !shotRunning && shotElapsed > 0 ? (
                  <span
                    className="handheld-frame__elapsed"
                    aria-label={`生成耗时 ${shotElapsed} 秒`}
                  >
                    {formatSeconds(shotElapsed)}秒
                  </span>
                ) : null}
                <div className="handheld-actions">
                    <button
                      type="button"
                      className={`handheld-submit handheld-submit--frame${running ? " is-running" : ""}${failed ? " is-failed" : ""}`}
                      disabled={running || generateDisabled}
                      title={generateHint}
                      aria-label={
                        running
                          ? "正在生成"
                          : failed
                            ? `重试生成手持图（${shotCount}张）`
                            : `生成手持商品图（${shotCount}张）`
                      }
                      onClick={onGenerate}
                    >
                      {running ? (
                        <span className="handheld-submit__spinner" aria-hidden="true" />
                      ) : (
                        <i
                          className={`bi ${failed ? "bi-arrow-clockwise" : "bi-stars"}`}
                          aria-hidden="true"
                        />
                      )}
                      <span>{running ? "生成中" : failed ? "重试" : "生成"}</span>
                      <small>
                        {running
                          ? generationStageLabel
                          : `${shotCount}张${costLabel ? ` · ${costLabel}` : ""}`}
                      </small>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPromptEditor({
                          shotId: shot.id || `shot-${planIndex}`,
                          index: planIndex,
                          basePrompt: shot.basePrompt || shot.prompt || "",
                          prompt: shot.prompt || "",
                        })
                      }
                      disabled={!shot.prompt || running}
                    >
                      <i className="bi bi-pencil-square" aria-hidden="true" />
                      说明修改
                    </button>
                  {shot.url && !shotRunning ? (
                    <>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectHistory?.(shot.url);
                        onMaskEdit?.(shot.url);
                      }}
                      disabled={!onMaskEdit}
                    >
                      局部重绘
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onSelectHistory?.(shot.url);
                        onSaveAsset?.(shot.url);
                      }}
                      disabled={!onSaveAsset || actionBusy}
                    >
                      存入素材库
                    </button>
                    </>
                  ) : null}
                </div>
              </div>
                {packThumbs.length ? (
                  <div className="handheld-frame__thumbs" role="list" aria-label="本次套图">
                    {packThumbs.map((item, thumbIndex) => {
                      const thumbActive =
                        (item.url && item.url === resultUrl) ||
                        (!item.url && item === displayShot);
                      const thumbPending =
                        !item.url &&
                        !item.failed &&
                        (item.running || running);
                      const thumbFailed = Boolean(item.failed) && !item.running;
                      return (
                        <button
                          key={item.id || `thumb-${thumbIndex}`}
                          type="button"
                          role="listitem"
                          className={`handheld-frame__thumb${thumbActive ? " is-active" : ""}${thumbPending ? " is-pending" : ""}${thumbFailed ? " is-failed" : ""}`}
                          disabled={
                            thumbPending ||
                            (!item.url && !thumbFailed) ||
                            (thumbFailed && !onRetryShot)
                          }
                          aria-label={
                            thumbFailed
                              ? `重试${item.label || `第 ${thumbIndex + 1} 张`}`
                              : thumbPending
                                ? `${item.label || `第 ${thumbIndex + 1} 张`}生成中`
                                : item.label || `第 ${thumbIndex + 1} 张`
                          }
                          aria-pressed={thumbActive}
                          onClick={() => {
                            if (item.url) onSelectHistory?.(item.url);
                            else if (thumbFailed) onRetryShot?.(thumbIndex);
                          }}
                        >
                          {item.url ? (
                            <AuthenticatedImage
                              src={item.preview || item.url}
                              alt=""
                              loading="eager"
                              maxDimension={360}
                            />
                          ) : thumbFailed ? (
                            <span className="handheld-frame__thumb-failed">
                              <i
                                className="bi bi-arrow-clockwise"
                                aria-hidden="true"
                              />
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
            );
          })}
        </div>
        <aside className="handheld-history" aria-label="手持生成历史">
          <p className="handheld-history__label">历史</p>
          {historyGroups.length ? (
            <div className="handheld-history__list" role="list">
              {historyGroups.map((group) => {
                const cover = group.rows[0];
                const count = Math.max(
                  group.rows.length,
                  Number(cover?.groupSize) || 0,
                );
                const active = group.rows.some((row) => row.url === resultUrl);
                const mosaic = count > 1 ? group.rows.slice(0, 4) : [];
                const spec =
                  cover?.task?.params?.handheldSpec &&
                  typeof cover.task.params.handheldSpec === "object"
                    ? cover.task.params.handheldSpec
                    : {};
                const packLabel =
                  packOptions.find((item) => item.id === spec.pack)?.label || "";
                const platformLabel =
                  platformOptions.find((item) => item.id === spec.platform)
                    ?.label || "";
                return (
                  <button
                    key={group.id}
                    type="button"
                    role="listitem"
                    className={`handheld-history__item${count > 1 ? " is-set" : ""}${active ? " is-active" : ""}`}
                    disabled={running}
                    aria-label={
                      [
                        packLabel,
                        count > 1 ? `共 ${count} 张` : "",
                        platformLabel,
                      ]
                        .filter(Boolean)
                        .join("，") ||
                      cover?.viewLabel ||
                      cover?.label ||
                      "查看历史生成图"
                    }
                    aria-pressed={active}
                    onClick={() => {
                      const current = group.rows.find(
                        (row) => row.url === resultUrl,
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
                              loading="eager"
                              maxDimension={360}
                            />
                          ))}
                        </span>
                      ) : (
                        <AuthenticatedImage
                          src={cover?.preview || cover?.url}
                          alt=""
                          loading="eager"
                          maxDimension={720}
                        />
                      )}
                      {count > 1 ? (
                        <span className="handheld-history__count">{count}</span>
                      ) : null}
                    </span>
                    {packLabel || platformLabel ? (
                      <span className="handheld-history__meta">
                        <strong>{packLabel || "手持商品"}</strong>
                        {platformLabel ? <small>{platformLabel}</small> : null}
                      </span>
                    ) : null}
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
        <HandheldPromptDialog
          open={Boolean(promptEditor)}
          prompt={promptEditor?.prompt || ""}
          onClose={() => setPromptEditor(null)}
          onApply={(nextPrompt) => {
            onChangePrompt?.({ ...promptEditor, prompt: nextPrompt });
            setPromptEditor(null);
          }}
        />
        <HandheldAnnotationDialog
          open={annotationOpen}
          image={product?.url || ""}
          annotations={annotations}
          onApply={onChangeAnnotations}
          onClose={() => setAnnotationOpen(false)}
        />
      </section>
    </div>
  );
}
