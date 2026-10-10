import { useEffect, useMemo, useRef, useState } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { DialogMotion } from "../../components/motion/DialogMotion.jsx";
import { CommerceSelect } from "./CommerceSelect.jsx";
import { HandheldRefCard } from "./HandheldStudio.jsx";
import {
  LISTING_IMAGE_TYPES,
  LISTING_LANGUAGE_OPTIONS,
  LISTING_MARKET_OPTIONS,
  LISTING_MAX_CUSTOM_TYPES,
  LISTING_MAX_PER_TYPE,
  LISTING_MAX_SHOTS,
  LISTING_NOTE_MAX,
  LISTING_PLAN_MODES,
  LISTING_PLATFORM_OPTIONS,
  LISTING_PRODUCT_INFO_MAX,
  LISTING_PRODUCT_INFO_PLACEHOLDER,
  LISTING_RUN_MODES,
  LISTING_SMART_MAX_DETAIL,
  LISTING_SMART_MAX_MAIN,
  LISTING_STYLE_OPTIONS,
  LISTING_TEMPLATE_CATEGORIES,
  LISTING_TYPE_GROUPS,
  listingResolveType,
  listingRunModeAllowed,
  listingTemplateById,
  listingTemplateCount,
  listingTemplatesFor,
  listingTypeById,
  searchListingTemplates,
} from "./listing/listingCatalog.js";
import {
  WorkbenchHistory,
  formatSeconds,
  groupHistory,
  ratioVar,
} from "./workbench/CommerceWorkbench.jsx";
import "./HandheldStudio.css";
import "./workbench/CommerceWorkbench.css";
import "./ListingStudio.css";

const ACTIVE_STATUS = new Set(["running", "waiting_provider"]);
const FAILED_STATUS = new Set(["failed", "canceled", "cancelled"]);

function secondsSince(timestamp, now) {
  const started = Date.parse(timestamp || "");
  if (!Number.isFinite(started)) return 0;
  return Math.max(0, Math.floor((now - started) / 1000));
}

function roleLabel(role) {
  return role === "main" ? "主图" : "详情";
}

// 「请选择或输入」：点开给常用选项，也可以直接输入任意值
function ComboField({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
  maxLength = 40,
}) {
  const [open, setOpen] = useState(false);
  const text = String(value || "");
  const listed = options.map((item) =>
    typeof item === "string" ? item : item.label,
  );
  const filtered =
    text && !listed.includes(text)
      ? listed.filter((item) => item.toLowerCase().includes(text.toLowerCase()))
      : listed;
  return (
    <label className={`listing-combo${open ? " is-open" : ""}`}>
      <span className="listing-combo__label">{label}</span>
      <span className="listing-combo__control">
        <input
          value={text}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          aria-label={label}
          aria-expanded={open}
          role="combobox"
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpen(false);
          }}
          onChange={(event) => {
            onChange?.(event.target.value);
            setOpen(true);
          }}
        />
        {text && !disabled ? (
          <button
            type="button"
            className="listing-combo__clear"
            aria-label={`清空${label}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onChange?.("")}
          >
            <i className="bi bi-x" aria-hidden="true" />
          </button>
        ) : (
          <i
            className="bi bi-chevron-down listing-combo__chevron"
            aria-hidden="true"
          />
        )}
      </span>
      {open && filtered.length && !disabled ? (
        <span
          className="listing-combo__menu"
          role="listbox"
          aria-label={`${label}选项`}
        >
          {filtered.map((item) => (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={item === text}
              className={item === text ? "is-active" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange?.(item);
                setOpen(false);
              }}
            >
              {item}
            </button>
          ))}
        </span>
      ) : null}
    </label>
  );
}

function Stepper({ label, icon, value, min, max, onChange, disabled, hint }) {
  return (
    <div className="listing-stepper">
      <span className="listing-stepper__icon" aria-hidden="true">
        <i className={`bi ${icon}`} aria-hidden="true" />
      </span>
      <span className="listing-stepper__copy">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span
        className="listing-stepper__control"
        role="group"
        aria-label={label}
      >
        <button
          type="button"
          aria-label={`减少${label}`}
          disabled={disabled || value <= min}
          onClick={() => onChange?.(value - 1)}
        >
          <i className="bi bi-dash" aria-hidden="true" />
        </button>
        <output aria-live="polite">{value}</output>
        <button
          type="button"
          aria-label={`增加${label}`}
          disabled={disabled || value >= max}
          onClick={() => onChange?.(value + 1)}
        >
          <i className="bi bi-plus" aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function Card({ title, icon, extra, children, className = "" }) {
  return (
    <section className={`listing-card ${className}`}>
      <header className="listing-card__head">
        <span className="listing-card__title">
          {icon ? <i className={`bi ${icon}`} aria-hidden="true" /> : null}
          {title}
        </span>
        {extra}
      </header>
      {children}
    </section>
  );
}

// ---------- 出图类型库 ----------

function TypeLibraryDialog({
  open,
  onClose,
  selectedIds,
  totalShots,
  onToggle,
  customTypes,
  onAddCustom,
  onRemoveCustom,
  savedTemplates,
  onApplySaved,
  onRemoveSaved,
  onSaveCurrent,
  canSaveCurrent,
}) {
  const [tab, setTab] = useState("types");
  const [expanded, setExpanded] = useState({});
  const [customLabel, setCustomLabel] = useState("");
  const [customBrief, setCustomBrief] = useState("");
  const [customRole, setCustomRole] = useState("detail");
  const [saveName, setSaveName] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  useEffect(() => {
    if (!open) return;
    setTab("types");
    setSaveNotice("");
  }, [open]);
  const selected = new Set(selectedIds);
  const full = totalShots >= LISTING_MAX_SHOTS;
  const customFull = customTypes.length >= LISTING_MAX_CUSTOM_TYPES;
  const canAddCustom = customLabel.trim().length > 0 && !customFull;

  function submitCustom(event) {
    event.preventDefault();
    if (!canAddCustom) return;
    onAddCustom?.({
      label: customLabel.trim(),
      direction: customBrief.trim(),
      role: customRole,
    });
    setCustomLabel("");
    setCustomBrief("");
  }

  return (
    <DialogMotion
      open={open}
      layerClassName="listing-dialog-layer"
      panelClassName="listing-dialog listing-types-dialog"
      ariaLabel="添加出图类型"
      onClose={onClose}
    >
      <header className="listing-dialog__head" data-dialog-motion-item>
        <div
          className="listing-dialog__tabs"
          role="tablist"
          aria-label="出图类型来源"
        >
          {[
            ["types", "推荐类型"],
            [
              "mine",
              `我的模板${savedTemplates.length ? ` (${savedTemplates.length})` : ""}`,
            ],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={tab === id ? "is-active" : ""}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="listing-dialog__meta">
          已选 {totalShots}/{LISTING_MAX_SHOTS} 张
        </span>
        <button
          type="button"
          className="listing-dialog__close"
          aria-label="关闭"
          onClick={onClose}
        >
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </header>

      <div className="listing-dialog__body" data-dialog-motion-item>
        {tab === "types" ? (
          <>
            <form className="listing-custom" onSubmit={submitCustom}>
              <span className="listing-section-label">
                自定义出图方向
                <small>
                  {customTypes.length}/{LISTING_MAX_CUSTOM_TYPES}
                </small>
              </span>
              <div className="listing-custom__row">
                <input
                  value={customLabel}
                  maxLength={30}
                  aria-label="自定义方向标题"
                  placeholder={
                    customFull
                      ? `最多 ${LISTING_MAX_CUSTOM_TYPES} 个自定义方向`
                      : "主标题，例如：极光流光色彩美学"
                  }
                  disabled={customFull}
                  onChange={(event) => setCustomLabel(event.target.value)}
                />
                <span
                  className="listing-segment listing-segment--mini"
                  role="radiogroup"
                  aria-label="用作主图还是详情页"
                >
                  {[
                    ["main", "主图"],
                    ["detail", "详情页"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="radio"
                      aria-checked={customRole === id}
                      className={customRole === id ? "is-active" : ""}
                      onClick={() => setCustomRole(id)}
                    >
                      {label}
                    </button>
                  ))}
                </span>
                <button
                  type="submit"
                  className="listing-button is-primary"
                  disabled={!canAddCustom}
                >
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                  添加
                </button>
              </div>
              <textarea
                rows={2}
                value={customBrief}
                maxLength={300}
                aria-label="自定义方向策划要求"
                placeholder="策划要求（选填）：描述这张图想要的画面、构图或文案重点"
                disabled={customFull}
                onChange={(event) => setCustomBrief(event.target.value)}
              />
              {customTypes.length ? (
                <div
                  className="listing-chips"
                  role="list"
                  aria-label="已添加的自定义方向"
                >
                  {customTypes.map((item) => (
                    <span
                      key={item.id}
                      role="listitem"
                      className={`listing-chip${selected.has(item.id) ? " is-active" : ""}`}
                    >
                      <button
                        type="button"
                        aria-pressed={selected.has(item.id)}
                        disabled={!selected.has(item.id) && full}
                        onClick={() => onToggle?.(item.id)}
                      >
                        <em>{roleLabel(item.role)}</em>
                        {item.label}
                      </button>
                      <button
                        type="button"
                        className="listing-chip__remove"
                        aria-label={`删除自定义方向 ${item.label}`}
                        onClick={() => onRemoveCustom?.(item.id)}
                      >
                        <i className="bi bi-x" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </form>

            {LISTING_TYPE_GROUPS.map((group) => {
              const items = LISTING_IMAGE_TYPES.filter(
                (item) => item.group === group.id,
              );
              const showAll =
                expanded[group.id] || items.length <= group.visibleLimit;
              // 收起时仍展示已选中的类型，避免选中项藏在「更多」里
              const visible = showAll
                ? items
                : items.filter(
                    (item, index) =>
                      index < group.visibleLimit || selected.has(item.id),
                  );
              return (
                <section
                  key={group.id}
                  className="listing-type-group"
                  aria-label={group.label}
                >
                  <span className="listing-section-label">
                    {group.label}
                    <small>{group.hint}</small>
                  </span>
                  <div className="listing-type-grid">
                    {visible.map((item) => {
                      const active = selected.has(item.id);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`listing-type${active ? " is-active" : ""}`}
                          aria-pressed={active}
                          disabled={!active && full}
                          onClick={() => onToggle?.(item.id)}
                        >
                          <i className={`bi ${item.icon}`} aria-hidden="true" />
                          <span>
                            <strong>{item.label}</strong>
                            <small>{item.hint}</small>
                          </span>
                          {active ? (
                            <i
                              className="bi bi-check-circle-fill listing-type__check"
                              aria-hidden="true"
                            />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  {items.length > group.visibleLimit &&
                  (showAll || visible.length < items.length) ? (
                    <button
                      type="button"
                      className="listing-more"
                      aria-expanded={showAll}
                      onClick={() =>
                        setExpanded((current) => ({
                          ...current,
                          [group.id]: !showAll,
                        }))
                      }
                    >
                      {showAll
                        ? "收起"
                        : `更多 ${items.length - visible.length} 种`}
                      <i
                        className={`bi bi-chevron-${showAll ? "up" : "down"}`}
                        aria-hidden="true"
                      />
                    </button>
                  ) : null}
                </section>
              );
            })}
          </>
        ) : (
          <div className="listing-mine">
            <form
              className="listing-custom__row"
              onSubmit={(event) => {
                event.preventDefault();
                if (onSaveCurrent?.(saveName)) {
                  setSaveNotice(`已保存「${saveName.trim()}」`);
                  setSaveName("");
                }
              }}
            >
              <input
                value={saveName}
                maxLength={24}
                aria-label="模板名称"
                placeholder={
                  canSaveCurrent
                    ? "把当前组合保存为模板，输入名称"
                    : "先勾选出图类型，再保存为模板"
                }
                disabled={!canSaveCurrent}
                onChange={(event) => setSaveName(event.target.value)}
              />
              <button
                type="submit"
                className="listing-button is-primary"
                disabled={!canSaveCurrent || !saveName.trim()}
              >
                <i className="bi bi-bookmark-plus" aria-hidden="true" />
                保存当前组合
              </button>
            </form>
            {saveNotice ? (
              <p className="listing-note-line">{saveNotice}</p>
            ) : null}
            {savedTemplates.length ? (
              <ul className="listing-saved">
                {savedTemplates.map((item) => {
                  const count = item.freeItems.reduce(
                    (sum, entry) => sum + entry.count,
                    0,
                  );
                  return (
                    <li key={item.id}>
                      <span>
                        <strong>{item.name}</strong>
                        <small>
                          共 {count} 张 ·{" "}
                          {item.freeItems
                            .map(
                              (entry) =>
                                listingResolveType(entry.id, item.customTypes)
                                  ?.label,
                            )
                            .filter(Boolean)
                            .join("、")}
                        </small>
                      </span>
                      <button
                        type="button"
                        className="listing-button"
                        onClick={() => {
                          onApplySaved?.(item.id);
                          onClose?.();
                        }}
                      >
                        使用该模板
                      </button>
                      <button
                        type="button"
                        className="listing-icon-button"
                        aria-label={`删除模板 ${item.name}`}
                        onClick={() => onRemoveSaved?.(item.id)}
                      >
                        <i className="bi bi-trash3" aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="listing-empty-line">
                还没有保存的模板。常用的出图组合保存后，下次一键套用。
              </p>
            )}
          </div>
        )}
      </div>

      <footer className="listing-dialog__foot" data-dialog-motion-item>
        <span>
          {full
            ? `一套最多 ${LISTING_MAX_SHOTS} 张，已达上限`
            : "点击卡片即可选中或取消，张数可在外面调整"}
        </span>
        <button
          type="button"
          className="listing-button is-primary"
          onClick={onClose}
        >
          完成选择
        </button>
      </footer>
    </DialogMotion>
  );
}

// ---------- 品类模板库 ----------

function TemplateLibraryDialog({ open, onClose, selectedIds, onToggle }) {
  const [categoryId, setCategoryId] = useState(
    LISTING_TEMPLATE_CATEGORIES[0].id,
  );
  const [subIndex, setSubIndex] = useState(-1);
  const [query, setQuery] = useState("");
  const category = LISTING_TEMPLATE_CATEGORIES.find(
    (item) => item.id === categoryId,
  );
  const templates = useMemo(() => {
    if (query.trim()) return searchListingTemplates(query);
    if (!category) return [];
    if (subIndex >= 0) return listingTemplatesFor(category.id, subIndex);
    return category.subs.flatMap((_, index) =>
      listingTemplatesFor(category.id, index),
    );
  }, [category, subIndex, query]);
  const selected = new Set(selectedIds);
  const selectedShots = selectedIds.reduce(
    (sum, id) => sum + (listingTemplateById(id)?.shots.length || 0),
    0,
  );

  return (
    <DialogMotion
      open={open}
      layerClassName="listing-dialog-layer"
      panelClassName="listing-dialog listing-templates-dialog"
      ariaLabel="选择品类套图模板"
      onClose={onClose}
    >
      <header className="listing-dialog__head" data-dialog-motion-item>
        <div className="listing-dialog__title">
          <strong>选择品类套图模板</strong>
          <small>按商品品类挑选行业高转化的成套出图分镜</small>
        </div>
        <label className="listing-search">
          <i className="bi bi-search" aria-hidden="true" />
          <input
            value={query}
            placeholder="搜索品类或模板，如：连衣裙、耳机"
            aria-label="搜索模板"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="listing-dialog__close"
          aria-label="关闭"
          onClick={onClose}
        >
          <i className="bi bi-x-lg" aria-hidden="true" />
        </button>
      </header>

      <div className="listing-templates" data-dialog-motion-item>
        <nav className="listing-templates__cats" aria-label="一级品类">
          {LISTING_TEMPLATE_CATEGORIES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={item.id === categoryId && !query.trim()}
              className={
                item.id === categoryId && !query.trim() ? "is-active" : ""
              }
              onClick={() => {
                setCategoryId(item.id);
                setSubIndex(-1);
                setQuery("");
              }}
            >
              <span>{item.label}</span>
              <small>{listingTemplateCount(item.id)}</small>
            </button>
          ))}
        </nav>
        <div className="listing-templates__main">
          {!query.trim() && category ? (
            <div
              className="listing-chips listing-templates__subs"
              role="group"
              aria-label="二级品类"
            >
              <span
                className={`listing-chip${subIndex < 0 ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  aria-pressed={subIndex < 0}
                  onClick={() => setSubIndex(-1)}
                >
                  全部
                </button>
              </span>
              {category.subs.map((sub, index) => (
                <span
                  key={sub}
                  className={`listing-chip${subIndex === index ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    aria-pressed={subIndex === index}
                    onClick={() => setSubIndex(index)}
                  >
                    {sub}
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {templates.length ? (
            <div className="listing-template-grid">
              {templates.map((template) => {
                const active = selected.has(template.id);
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={`listing-template${active ? " is-active" : ""}`}
                    aria-pressed={active}
                    onClick={() => onToggle?.(template.id)}
                  >
                    <span className="listing-template__head">
                      <em>{template.subLabel}</em>
                      <strong>{template.name}</strong>
                      <small>{template.shots.length} 张成套</small>
                    </span>
                    <span className="listing-template__desc">
                      {template.description}
                    </span>
                    <ol className="listing-template__shots">
                      {template.shots.map((item, index) => (
                        <li key={`${item.label}-${index}`}>
                          <b>{roleLabel(listingTypeById(item.type)?.role)}</b>
                          {item.label}
                        </li>
                      ))}
                    </ol>
                    <span className="listing-template__pick">
                      <i
                        className={`bi ${active ? "bi-check-circle-fill" : "bi-plus-circle"}`}
                        aria-hidden="true"
                      />
                      {active ? "已添加" : "添加"}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="listing-empty-line">
              没有找到匹配的模板，换个关键词试试。
            </p>
          )}
        </div>
      </div>

      <footer className="listing-dialog__foot" data-dialog-motion-item>
        <span>
          可多选组合成套出图 · 已选 {selectedIds.length} 个模板，共{" "}
          {selectedShots} 张
          {selectedShots > LISTING_MAX_SHOTS
            ? `（超出部分只取前 ${LISTING_MAX_SHOTS} 张）`
            : ""}
        </span>
        <button
          type="button"
          className="listing-button is-primary"
          onClick={onClose}
        >
          确定选择
        </button>
      </footer>
    </DialogMotion>
  );
}

// ---------- 策划方案（逐步确认时可修改） ----------

function PlanItem({
  shot,
  index,
  status,
  editable,
  running,
  onEdit,
  onRemove,
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className={`listing-plan__item ${status}${open ? " is-open" : ""}`}>
      <div className="listing-plan__row">
        <b>{String(index + 1).padStart(2, "0")}</b>
        <span className="listing-plan__copy">
          <span className="listing-plan__label">
            <em className={`listing-role is-${shot.role}`}>
              {roleLabel(shot.role)}
            </em>
            {shot.label}
          </span>
          {shot.headline ? (
            <strong>
              {shot.headline}
              {shot.subline ? <small>{shot.subline}</small> : null}
            </strong>
          ) : null}
        </span>
        {editable ? (
          <span className="listing-plan__tools">
            <button
              type="button"
              className="listing-icon-button"
              aria-label={`${open ? "收起" : "修改"}第 ${index + 1} 张策划`}
              aria-expanded={open}
              disabled={running}
              onClick={() => setOpen((value) => !value)}
            >
              <i
                className={`bi ${open ? "bi-chevron-up" : "bi-pencil"}`}
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              className="listing-icon-button"
              aria-label={`从本套移除第 ${index + 1} 张`}
              disabled={running}
              onClick={() => onRemove?.(shot.id)}
            >
              <i className="bi bi-x-lg" aria-hidden="true" />
            </button>
          </span>
        ) : null}
      </div>
      {editable && open ? (
        <div className="listing-plan__edit">
          <label>
            <span>主标题</span>
            <input
              value={shot.headline || ""}
              maxLength={24}
              placeholder="留空则画面不放标题"
              onChange={(event) =>
                onEdit?.(shot.id, { headline: event.target.value })
              }
            />
          </label>
          <label>
            <span>副文案</span>
            <input
              value={shot.subline || ""}
              maxLength={40}
              placeholder="可选"
              onChange={(event) =>
                onEdit?.(shot.id, { subline: event.target.value })
              }
            />
          </label>
          <label>
            <span>画面方向</span>
            <textarea
              rows={3}
              value={shot.plannedDirection || ""}
              maxLength={200}
              placeholder="主体位置、场景、光线、要放大的细节…"
              onChange={(event) =>
                onEdit?.(shot.id, { direction: event.target.value })
              }
            />
          </label>
        </div>
      ) : null}
    </li>
  );
}

export function ListingStudio({
  previews = [],
  maxFiles = 6,
  running = false,
  cancelling = false,
  onUpload,
  onRemoveFile,
  onDropFiles,
  onPreview,
  productName = "",
  onChangeProductName,
  productInfo = "",
  onChangeProductInfo,
  onAiWrite,
  platform = "",
  onChangePlatform,
  market = "",
  onChangeMarket,
  language = "",
  onChangeLanguage,
  style = "",
  onChangeStyle,
  config,
  actions,
  savedTemplates = [],
  ratioOptions = [],
  resolution = "",
  resolutionOptions = [],
  onChangeResolution,
  note = "",
  onChangeNote,
  plan = {},
  blueprints = [],
  moduleStates = [],
  runStartedAt = "",
  history = [],
  resultUrl = "",
  generate = {},
  costLabel = "",
  generationStageLabel = "正在生成",
  failed = false,
  failMessage = "",
  onCancel,
  onSelectHistory,
  onResultPreview,
  onDownload,
  onDownloadAll,
  onMaskEdit,
  onSaveAsset,
  actionBusy = false,
  revision = { available: false },
  notice = "",
}) {
  const [typesOpen, setTypesOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const runOriginRef = useRef(0);

  // 支持直接粘贴商品图（输入框里粘贴文字时不拦截）
  const dropRef = useRef(onDropFiles);
  dropRef.current = onDropFiles;
  useEffect(() => {
    if (running) return undefined;
    const onPaste = (event) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      const files = Array.from(event.clipboardData?.files || []).filter(
        (file) => String(file.type || "").startsWith("image/"),
      );
      if (!files.length) return;
      event.preventDefault();
      dropRef.current?.(files);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [running]);

  const runStartedMs = useMemo(() => {
    const values = [
      Date.parse(runStartedAt || ""),
      ...moduleStates.map((item) => Date.parse(item?.startedAt || "")),
    ].filter(Number.isFinite);
    return values.length ? Math.min(...values) : 0;
  }, [runStartedAt, moduleStates]);

  useEffect(() => {
    if (!running) {
      runOriginRef.current = 0;
      return undefined;
    }
    runOriginRef.current = runStartedMs || runOriginRef.current || Date.now();
    const tick = () => setNow(Date.now());
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [running, runStartedMs]);
  const runSeconds =
    running && runOriginRef.current
      ? Math.max(0, Math.floor((now - runOriginRef.current) / 1000))
      : 0;

  const historyGroups = groupHistory(history);
  const activeGroup =
    historyGroups.find((group) =>
      group.rows.some((row) => row.url === resultUrl),
    ) ||
    historyGroups[0] ||
    null;
  // 正在出图时按本轮 blueprint 排；否则展示选中的那一组历史成片（没有历史就展示本次规划）
  const viewingHistory = !running && activeGroup && activeGroup.rows.length > 0;
  const tiles = useMemo(() => {
    if (viewingHistory) {
      const size = Math.max(
        activeGroup.rows.length,
        Number(activeGroup.rows[0]?.groupSize) || 0,
      );
      return Array.from({ length: size }, (_, index) => {
        const row =
          activeGroup.rows.find((item) => Number(item.index || 0) === index) ||
          null;
        const label =
          String(row?.task?.params?.viewLabel || "")
            .split(" · ")
            .pop() ||
          blueprints[index]?.label ||
          `第 ${index + 1} 张`;
        return {
          key: `h-${index}`,
          label,
          role: "",
          aspectRatio:
            row?.aspectRatio || blueprints[index]?.aspectRatio || "1:1",
          url: row?.url || "",
          display: row?.display || row?.url || "",
          preview: row?.preview || row?.url || "",
          status: row ? "is-done" : "is-missing",
          seconds: 0,
          error: "",
        };
      });
    }
    let firstPending = -1;
    const anyActive = moduleStates.some(
      (item) =>
        !item?.url &&
        ACTIVE_STATUS.has(String(item?.status || "").toLowerCase()),
    );
    return blueprints.map((shot, index) => {
      const state = moduleStates[index] || null;
      const url = running ? state?.url || "" : "";
      const status = String(state?.status || "").toLowerCase();
      const failedTile = !url && FAILED_STATUS.has(status);
      let active = running && !url && !failedTile && ACTIVE_STATUS.has(status);
      if (running && !url && !failedTile && !anyActive && firstPending < 0) {
        firstPending = index;
        active = true;
      }
      return {
        key: shot.id || `s-${index}`,
        label: shot.label,
        role: shot.role,
        headline: shot.headline,
        aspectRatio: shot.aspectRatio || "1:1",
        url,
        display: state?.display || url,
        preview: url,
        status: url
          ? "is-done"
          : failedTile
            ? "is-failed"
            : active
              ? "is-running"
              : running
                ? "is-queued"
                : "is-planned",
        seconds: active
          ? state?.startedAt
            ? secondsSince(state.startedAt, now)
            : runSeconds
          : 0,
        error: state?.error || "",
      };
    });
  }, [
    viewingHistory,
    activeGroup,
    blueprints,
    moduleStates,
    running,
    now,
    runSeconds,
  ]);
  const doneCount = tiles.filter((tile) => tile.url).length;
  const planned = Boolean(plan.data?.items?.length);
  const planItemsById = useMemo(
    () => new Map((plan.data?.items || []).map((item) => [item.id, item])),
    [plan.data],
  );
  const statusByIndex = (index) => {
    if (!running) return "";
    return tiles[index]?.status || "";
  };

  const {
    planMode,
    runMode,
    freeItems,
    customTypes,
    smart,
    templateIds,
    mainRatio,
    detailRatio,
  } = config;
  const freeTotal = freeItems.reduce((sum, item) => sum + item.count, 0);
  const hasProduct = previews.length > 0;
  const mainCount = blueprints.filter((shot) => shot.role === "main").length;
  const detailCount = blueprints.length - mainCount;
  const runOption =
    LISTING_RUN_MODES.find((item) => item.id === runMode) ||
    LISTING_RUN_MODES[0];

  function handleDrop(event) {
    event.preventDefault();
    const files = event.dataTransfer?.files;
    if (files?.length && !running) onDropFiles?.(files);
  }

  const ratioSelect = (label, value, key) => (
    <label className="listing-inline-field">
      <span>{label}</span>
      <CommerceSelect
        value={value}
        options={ratioOptions}
        onChange={(next) => actions.patch({ [key]: next })}
        ariaLabel={`${label}画幅`}
        disabled={running}
        menuMinWidth={140}
      />
    </label>
  );

  return (
    <div
      className="commerce-workbench is-listing listing-studio"
      aria-label="商品套图工作台"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ---------- 左：策划输入 ---------- */}
      <section className="listing-studio__config" aria-label="套图设置">
        <Card
          title={
            <>
              上传产品图<b className="listing-required">*</b>
            </>
          }
          icon="bi-box-seam"
          extra={
            <small className="listing-card__meta">
              {previews.length}/{maxFiles}
            </small>
          }
        >
          <div className={`listing-upload${hasProduct ? "" : " is-empty"}`}>
            <HandheldRefCard
              className="listing-upload__main"
              tag={hasProduct ? "主图" : "商品图"}
              image={previews[0]?.url || ""}
              emptyIcon="bi-cloud-arrow-up"
              emptyLabel="点击或拖拽上传"
              emptyAria="上传商品图"
              previewAria="查看商品图"
              previewAlt="商品图"
              previewTitle="商品图"
              groupAria="商品图操作"
              uploadAria="添加商品图"
              clearAria="移除商品图"
              showMore={false}
              showClear
              disabled={running}
              onPreview={(event, payload) => onPreview?.(payload.url)}
              onUpload={onUpload}
              onClear={() => onRemoveFile?.(0)}
              onDrop={(files) => onDropFiles?.(files)}
            />
            <div
              className="listing-upload__angles"
              role="list"
              aria-label="更多角度"
            >
              {previews.slice(1).map((item, offset) => (
                <span
                  key={`${item.url}-${offset}`}
                  role="listitem"
                  className="listing-upload__angle"
                >
                  <button
                    type="button"
                    aria-label={`查看商品图 ${offset + 2}`}
                    onClick={() => onPreview?.(item.url)}
                  >
                    {/^(blob:|data:)/i.test(item.url) ? (
                      <img src={item.url} alt="" draggable="false" />
                    ) : (
                      <AuthenticatedImage src={item.url} alt="" keepLoaded />
                    )}
                  </button>
                  <button
                    type="button"
                    className="listing-upload__remove"
                    aria-label={`移除商品图 ${offset + 2}`}
                    disabled={running}
                    onClick={() => onRemoveFile?.(offset + 1)}
                  >
                    <i className="bi bi-x" aria-hidden="true" />
                  </button>
                </span>
              ))}
              {hasProduct && previews.length < maxFiles ? (
                <button
                  type="button"
                  className="listing-upload__add"
                  aria-label="添加更多角度"
                  disabled={running}
                  onClick={onUpload}
                >
                  <i className="bi bi-plus-lg" aria-hidden="true" />
                  <small>多角度</small>
                </button>
              ) : null}
            </div>
          </div>
          <p className="listing-hint is-warn">
            <i className="bi bi-exclamation-triangle" aria-hidden="true" />
            <span>
              请上传<strong>同一产品 / 整套产品</strong>
              的图片，可多张不同角度或细节图；主体清晰的白底图效果更佳。支持拖拽与粘贴。
            </span>
          </p>
        </Card>

        <Card
          title="产品信息与市场"
          icon="bi-lightning-charge"
          extra={
            <button
              type="button"
              className="listing-button is-soft"
              disabled={running || !hasProduct}
              title={hasProduct ? "根据商品图识别名称与卖点" : "先上传商品图"}
              onClick={onAiWrite}
            >
              <i className="bi bi-stars" aria-hidden="true" />
              AI 帮写
            </button>
          }
        >
          <input
            className="listing-input"
            value={productName}
            maxLength={60}
            aria-label="商品名称"
            placeholder="商品名称（选填，不填由 AI 识别）"
            disabled={running}
            onChange={(event) => onChangeProductName?.(event.target.value)}
          />
          <label className="listing-textarea">
            <textarea
              rows={5}
              value={productInfo}
              maxLength={LISTING_PRODUCT_INFO_MAX}
              aria-label="产品信息"
              placeholder={LISTING_PRODUCT_INFO_PLACEHOLDER}
              disabled={running}
              onChange={(event) => onChangeProductInfo?.(event.target.value)}
            />
            <small>
              {productInfo.length} / {LISTING_PRODUCT_INFO_MAX}
            </small>
          </label>
          <div className="listing-combos">
            <ComboField
              label="电商平台"
              value={platform}
              options={LISTING_PLATFORM_OPTIONS}
              onChange={onChangePlatform}
              placeholder="请选择或输入电商平台"
              disabled={running}
            />
            <ComboField
              label="目标市场"
              value={market}
              options={LISTING_MARKET_OPTIONS}
              onChange={onChangeMarket}
              placeholder="请选择或输入目标市场"
              disabled={running}
            />
            <ComboField
              label="文案语种"
              value={language}
              options={LISTING_LANGUAGE_OPTIONS}
              onChange={onChangeLanguage}
              placeholder="请选择或输入文案语种"
              disabled={running}
            />
            <ComboField
              label="视觉风格"
              value={style}
              options={LISTING_STYLE_OPTIONS}
              onChange={onChangeStyle}
              placeholder="请选择或输入视觉风格"
              disabled={running}
            />
          </div>
        </Card>

        <Card title="出图规划方向" icon="bi-grid-1x2">
          <div
            className="listing-segment"
            role="tablist"
            aria-label="出图规划方向"
          >
            {LISTING_PLAN_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={planMode === item.id}
                className={planMode === item.id ? "is-active" : ""}
                disabled={running}
                title={item.hint}
                onClick={() => actions.setPlanMode(item.id)}
              >
                <i className={`bi ${item.icon}`} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>

          <div className="listing-inline-fields">
            {ratioSelect("主图", mainRatio, "mainRatio")}
            {ratioSelect("详情页", detailRatio, "detailRatio")}
            {resolutionOptions.length ? (
              <label className="listing-inline-field">
                <span>分辨率</span>
                <CommerceSelect
                  value={resolution}
                  options={resolutionOptions.map((item) => ({
                    value: item,
                    label: item,
                  }))}
                  onChange={onChangeResolution}
                  ariaLabel="分辨率"
                  disabled={running}
                  menuMinWidth={100}
                />
              </label>
            ) : null}
          </div>

          {planMode === "smart" ? (
            <div className="listing-smart">
              <Stepper
                label="主图数量"
                hint="首图、白底与卖点主图"
                icon="bi-bag"
                value={smart.main}
                min={0}
                max={Math.min(
                  LISTING_SMART_MAX_MAIN,
                  LISTING_MAX_SHOTS - smart.detail,
                )}
                disabled={running}
                onChange={(value) => actions.setSmartCount("main", value)}
              />
              <Stepper
                label="详情页数量"
                hint="卖点、场景、细节与信任"
                icon="bi-layout-text-window"
                value={smart.detail}
                min={0}
                max={Math.min(
                  LISTING_SMART_MAX_DETAIL,
                  LISTING_MAX_SHOTS - smart.main,
                )}
                disabled={running}
                onChange={(value) => actions.setSmartCount("detail", value)}
              />
              <p className="listing-hint">
                <i className="bi bi-magic" aria-hidden="true" />
                AI 根据商品图与产品信息推导卖点，从 {
                  LISTING_IMAGE_TYPES.length
                }{" "}
                种出图类型里挑选并排好转化顺序。建议主图 2-4 张。
              </p>
            </div>
          ) : planMode === "free" ? (
            <div className="listing-free">
              {freeItems.length ? (
                <ul className="listing-selected" aria-label="已选出图类型">
                  {freeItems.map((item, index) => {
                    const type = listingResolveType(item.id, customTypes);
                    if (!type) return null;
                    return (
                      <li key={item.id}>
                        <em className={`listing-role is-${type.role}`}>
                          {roleLabel(type.role)}
                        </em>
                        <span className="listing-selected__label">
                          <i className={`bi ${type.icon}`} aria-hidden="true" />
                          {type.label}
                        </span>
                        <span className="listing-selected__tools">
                          <button
                            type="button"
                            className="listing-icon-button"
                            aria-label={`上移 ${type.label}`}
                            disabled={running || index === 0}
                            onClick={() => actions.moveType(item.id, -1)}
                          >
                            <i className="bi bi-arrow-up" aria-hidden="true" />
                          </button>
                          <span
                            className="listing-count"
                            role="group"
                            aria-label={`${type.label}张数`}
                          >
                            <button
                              type="button"
                              aria-label={`减少 ${type.label}`}
                              disabled={running}
                              onClick={() => actions.stepTypeCount(item.id, -1)}
                            >
                              <i className="bi bi-dash" aria-hidden="true" />
                            </button>
                            <output>×{item.count}</output>
                            <button
                              type="button"
                              aria-label={`增加 ${type.label}`}
                              disabled={
                                running ||
                                item.count >= LISTING_MAX_PER_TYPE ||
                                freeTotal >= LISTING_MAX_SHOTS
                              }
                              onClick={() => actions.stepTypeCount(item.id, 1)}
                            >
                              <i className="bi bi-plus" aria-hidden="true" />
                            </button>
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
              <button
                type="button"
                className="listing-add"
                disabled={running}
                onClick={() => setTypesOpen(true)}
              >
                <i className="bi bi-plus-square-dotted" aria-hidden="true" />
                <span>
                  <strong>添加出图类型或自定义</strong>
                  <small>
                    {freeItems.length
                      ? `已选 ${freeItems.length} 种 · 共 ${freeTotal}/${LISTING_MAX_SHOTS} 张`
                      : `${LISTING_IMAGE_TYPES.length} 种推荐类型 · 支持自定义方向与保存模板`}
                  </small>
                </span>
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="listing-template-pick">
              {templateIds.length ? (
                <ul className="listing-selected" aria-label="已选模板">
                  {templateIds.map((id) => {
                    const template = listingTemplateById(id);
                    if (!template) return null;
                    return (
                      <li key={id}>
                        <em className="listing-role is-template">
                          {template.subLabel}
                        </em>
                        <span className="listing-selected__label">
                          {template.name}
                          <small>{template.shots.length} 张</small>
                        </span>
                        <button
                          type="button"
                          className="listing-icon-button"
                          aria-label={`移除模板 ${template.name}`}
                          disabled={running}
                          onClick={() => actions.toggleTemplate(id)}
                        >
                          <i className="bi bi-x-lg" aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="listing-hint">
                  <i className="bi bi-collection" aria-hidden="true" />
                  精选 {LISTING_TEMPLATE_CATEGORIES.length}{" "}
                  个行业的高转化分镜结构，AI 依据选定模板策划整套出图。
                </p>
              )}
              <button
                type="button"
                className="listing-add"
                disabled={running}
                onClick={() => setTemplatesOpen(true)}
              >
                <i className="bi bi-collection" aria-hidden="true" />
                <span>
                  <strong>
                    {templateIds.length
                      ? "继续挑选 / 更换模板"
                      : "打开模板库挑选"}
                  </strong>
                  <small>
                    美妆、服饰、数码、家居等行业成套分镜，可多选组合
                  </small>
                </span>
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </button>
            </div>
          )}
        </Card>

        <Card
          title={
            <>
              补充描述<small className="listing-optional">（选填）</small>
            </>
          }
          icon="bi-chat-left-text"
          extra={
            <button
              type="button"
              role="switch"
              aria-checked={Boolean(config.noteOpen)}
              aria-label="补充描述"
              className={`listing-switch${config.noteOpen ? " is-on" : ""}`}
              disabled={running}
              onClick={() => actions.patch({ noteOpen: !config.noteOpen })}
            >
              <b />
            </button>
          }
        >
          {config.noteOpen ? (
            <label className="listing-textarea">
              <textarea
                rows={3}
                value={note}
                maxLength={LISTING_NOTE_MAX}
                aria-label="补充描述"
                placeholder="可补充场景、画面重点、风格限制或其他特殊要求…"
                disabled={running}
                onChange={(event) => onChangeNote?.(event.target.value)}
              />
              <small>
                {note.length} / {LISTING_NOTE_MAX}
              </small>
            </label>
          ) : null}
        </Card>
      </section>

      {/* ---------- 中：套图平铺 ---------- */}
      <section className="listing-studio__stage" aria-label="套图结果">
        <header className="listing-stage__head">
          <div>
            <strong>
              {viewingHistory
                ? "创作结果"
                : planned
                  ? "策划方案预览"
                  : "本次出图"}
            </strong>
            <small>
              {viewingHistory
                ? `${doneCount} 张成片 · 点击查看大图`
                : blueprints.length
                  ? `主图 ${mainCount} 张（${mainRatio}） · 详情页 ${detailCount} 张（${detailRatio}）${resolution ? ` · ${resolution}` : ""}`
                  : "上传商品图并规划出图后在这里平铺展示"}
            </small>
          </div>
          {viewingHistory && doneCount ? (
            <span
              className="listing-stage__actions"
              role="group"
              aria-label="结果操作"
            >
              {revision?.available ? (
                <button
                  type="button"
                  className={`listing-button${revision.open ? " is-soft" : ""}`}
                  aria-expanded={Boolean(revision.open)}
                  onClick={revision.onToggle}
                >
                  <i className="bi bi-sliders2" aria-hidden="true" />
                  连续优化
                </button>
              ) : null}
              <button
                type="button"
                className="listing-button"
                disabled={!onMaskEdit}
                onClick={onMaskEdit}
              >
                局部修正
              </button>
              <button
                type="button"
                className="listing-button"
                disabled={!onDownload}
                onClick={onDownload}
              >
                下载
              </button>
              {onSaveAsset ? (
                <button
                  type="button"
                  className="listing-button"
                  disabled={actionBusy}
                  onClick={onSaveAsset}
                >
                  存入素材库
                </button>
              ) : null}
              <button
                type="button"
                className="listing-button is-soft"
                disabled={!onDownloadAll || actionBusy}
                onClick={onDownloadAll}
              >
                <i className="bi bi-file-earmark-zip" aria-hidden="true" />
                下载套图
              </button>
            </span>
          ) : running ? (
            <span className="listing-stage__progress" role="status">
              <i className="handheld-frame__thumb-spin" aria-hidden="true" />
              {generationStageLabel} · {doneCount}/{tiles.length} ·{" "}
              {formatSeconds(runSeconds)}s
            </span>
          ) : null}
        </header>

        {notice ? (
          <p className="listing-stage__notice" role="status">
            {notice}
          </p>
        ) : null}

        {revision?.available && revision.open && viewingHistory ? (
          <div
            className="workbench-revision listing-revision"
            role="dialog"
            aria-label="继续调整当前成品"
          >
            <header>
              <div>
                <small>连续优化 · 当前 V{revision.version || 1}</small>
                <strong>只描述这一轮要改的内容（作用于选中的那张）</strong>
              </div>
              <button
                type="button"
                aria-label="收起连续优化"
                onClick={revision.onToggle}
              >
                <i className="bi bi-x-lg" aria-hidden="true" />
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
                placeholder="例如：标题换成白色，商品再放大 15%，其他内容保持不变"
              />
              <small>{String(revision.brief || "").length}/600</small>
            </label>
            <footer>
              <span>
                <i className="bi bi-shield-check" aria-hidden="true" />
                上一版本会保留
              </span>
              <button
                type="button"
                disabled={String(revision.brief || "").trim().length < 4}
                onClick={revision.onSubmit}
              >
                <i className="bi bi-arrow-repeat" aria-hidden="true" />
                生成 V{Number(revision.version || 1) + 1}
                {revision.price ? ` · ${revision.price}` : ""}
              </button>
            </footer>
          </div>
        ) : null}

        {tiles.length && (hasProduct || viewingHistory || running) ? (
          <div className="listing-tiles" role="list">
            {tiles.map((tile, index) => (
              <div
                key={tile.key}
                role="listitem"
                className={`listing-tile ${tile.status}${tile.url && tile.url === resultUrl ? " is-selected" : ""}`}
                style={{ "--listing-tile-ratio": ratioVar(tile.aspectRatio) }}
              >
                <div className="listing-tile__frame">
                  {tile.url ? (
                    <button
                      type="button"
                      className="listing-tile__shot"
                      aria-label={
                        tile.url === resultUrl
                          ? `查看 ${tile.label} 大图`
                          : `选中 ${tile.label}`
                      }
                      aria-pressed={tile.url === resultUrl}
                      title={
                        tile.url === resultUrl
                          ? "再次点击查看大图"
                          : "点击选中，再次点击查看大图"
                      }
                      onClick={(event) => {
                        // 第一次点选中（连续优化 / 局部修正 / 下载作用于选中的那张），再点看大图
                        if (tile.url !== resultUrl) {
                          onSelectHistory?.(tile.url);
                          return;
                        }
                        onResultPreview?.(event, {
                          url: tile.url,
                          alt: tile.label,
                          title: tile.label,
                        });
                      }}
                    >
                      <AuthenticatedImage
                        src={tile.preview || tile.url}
                        fallbackSrc={tile.url}
                        alt={tile.label}
                      />
                    </button>
                  ) : tile.status === "is-running" ? (
                    <span className="listing-tile__state">
                      <i
                        className="handheld-frame__thumb-spin"
                        aria-hidden="true"
                      />
                      <small>生成中 {formatSeconds(tile.seconds)}s</small>
                    </span>
                  ) : tile.status === "is-queued" ? (
                    <span className="listing-tile__state">
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <small>排队中</small>
                    </span>
                  ) : tile.status === "is-failed" ? (
                    <span
                      className="listing-tile__state is-error"
                      title={tile.error || failMessage}
                    >
                      <i
                        className="bi bi-exclamation-circle"
                        aria-hidden="true"
                      />
                      <small>未生成</small>
                    </span>
                  ) : tile.status === "is-missing" ? (
                    <span className="listing-tile__state">
                      <i className="bi bi-dash-circle" aria-hidden="true" />
                      <small>未生成</small>
                    </span>
                  ) : (
                    <span className="listing-tile__state is-planned">
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      {tile.headline ? <strong>{tile.headline}</strong> : null}
                      <small>{tile.aspectRatio}</small>
                    </span>
                  )}
                </div>
                <span className="listing-tile__meta">
                  {tile.role ? (
                    <em className={`listing-role is-${tile.role}`}>
                      {roleLabel(tile.role)}
                    </em>
                  ) : null}
                  <span>{tile.label}</span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="listing-intro">
            <strong>AI 电商套图</strong>
            <p>
              上传一张商品图，批量生成主图、白底图、场景图、卖点图与详情页，一次出齐一整套上架视觉。
            </p>
            <ol className="listing-intro__steps">
              {[
                ["上传产品原图", "商品主图加多角度 / 细节图", hasProduct],
                ["AI 智能组图", "推导卖点并匹配每张图的画面方向", planned],
                ["一键平铺生成", "按主图 + 详情页出整套商用图", false],
              ].map(([title, sub, done], index) => (
                <li key={title} className={done ? "is-done" : ""}>
                  <b>
                    {done ? (
                      <i className="bi bi-check-lg" aria-hidden="true" />
                    ) : (
                      index + 1
                    )}
                  </b>
                  <span>
                    <strong>{title}</strong>
                    <small>{sub}</small>
                  </span>
                </li>
              ))}
            </ol>
            <div className="listing-intro__groups">
              <section>
                <span>
                  <b>主图模块组</b>
                  <small>提升曝光与点击</small>
                </span>
                <p>建议 2-4 张：首图视觉、白底合规、卖点主图与日常场景主图。</p>
                <div className="listing-chips">
                  {["产品白底图", "场景主图", "卖点主图", "细节特写"].map(
                    (item) => (
                      <span key={item} className="listing-chip is-static">
                        {item}
                      </span>
                    ),
                  )}
                </div>
              </section>
              <section>
                <span>
                  <b>详情页模块组</b>
                  <small>深度转化与说服</small>
                </span>
                <p>
                  首屏海报、痛点与卖点、场景代入、细节工艺、规格参数与信任保障全套构图。
                </p>
                <div className="listing-chips">
                  {[
                    "首屏视觉图",
                    "核心卖点图",
                    "产品场景展示图",
                    "规格参数图",
                    "售后保障服务图",
                  ].map((item) => (
                    <span key={item} className="listing-chip is-static">
                      {item}
                    </span>
                  ))}
                </div>
              </section>
            </div>
            <small className="listing-intro__foot">
              适配淘宝 / 天猫、京东、拼多多、抖音、小红书、Amazon、Temu、TikTok
              等平台
            </small>
          </div>
        )}

        {failed && !running ? (
          <p className="listing-stage__error" role="alert">
            <i className="bi bi-exclamation-triangle" aria-hidden="true" />
            {failMessage || "本次生成未完成，可调整后重新生成"}
          </p>
        ) : null}

        <footer className="listing-launch">
          <div
            className="listing-segment listing-launch__modes"
            role="radiogroup"
            aria-label="出图方式"
          >
            {LISTING_RUN_MODES.map((item) => {
              const allowed = listingRunModeAllowed(item.id, planMode);
              if (!allowed) return null;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={runMode === item.id}
                  className={runMode === item.id ? "is-active" : ""}
                  disabled={running}
                  onClick={() => actions.patch({ runMode: item.id })}
                >
                  <i className={`bi ${item.icon}`} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="listing-launch__hint">
            <span>{runOption.hint}</span>
            <span className="listing-launch__cost">
              预计消耗 <b>{costLabel || "—"}</b>
            </span>
          </p>
          <button
            type="button"
            className={`listing-launch__go${running ? " is-running" : ""}${plan.planning ? " is-planning" : ""}`}
            disabled={running ? cancelling : generate.disabled || plan.planning}
            title={!running && generate.disabled ? generate.hint : undefined}
            onClick={running ? onCancel : generate.onClick}
          >
            {running || plan.planning ? (
              <span className="handheld-submit__spinner" aria-hidden="true" />
            ) : (
              <i className="bi bi-stars" aria-hidden="true" />
            )}
            <span>
              {running
                ? cancelling
                  ? "停止中"
                  : "停止生成"
                : plan.planning
                  ? "AI 正在策划整套方案"
                  : generate.label}
            </span>
          </button>
          {!running && generate.disabled && generate.hint ? (
            <small className="listing-launch__reason">{generate.hint}</small>
          ) : null}
        </footer>
      </section>

      {/* ---------- 右：策划方案 ---------- */}
      <aside
        className={`listing-studio__plan${planned ? " is-planned" : ""}`}
        aria-label="策划方案"
      >
        <header className="listing-plan__head">
          <span className="listing-card__title">
            <i className="bi bi-journal-richtext" aria-hidden="true" />
            策划方案
          </span>
          {planned && !running ? (
            <button
              type="button"
              className="listing-link"
              disabled={plan.planning}
              onClick={plan.onClear}
            >
              清除
            </button>
          ) : null}
        </header>
        {planMode !== "free" || runMode !== "fast" ? (
          <button
            type="button"
            className={`listing-button listing-plan__run${planned ? "" : " is-soft"}`}
            disabled={running || plan.planning || Boolean(plan.planDisabled)}
            title={plan.planHint || undefined}
            onClick={plan.onPlan}
          >
            {plan.planning ? (
              <>
                <span className="handheld-submit__spinner" aria-hidden="true" />
                正在策划
              </>
            ) : planned ? (
              <>
                <i className="bi bi-arrow-repeat" aria-hidden="true" />
                重新策划
              </>
            ) : (
              <>
                <i className="bi bi-stars" aria-hidden="true" />
                只策划，不出图
              </>
            )}
          </button>
        ) : null}
        {plan.error ? (
          <p className="listing-plan__error" role="alert">
            {plan.error}
          </p>
        ) : null}
        {plan.data?.summary ? (
          <p className="listing-plan__summary">{plan.data.summary}</p>
        ) : null}
        {blueprints.length ? (
          <ol className="listing-plan__list">
            {blueprints.map((shot, index) => (
              <PlanItem
                key={shot.id}
                shot={shot}
                index={index}
                status={statusByIndex(index)}
                editable={planned && planItemsById.has(shot.id)}
                running={running}
                onEdit={plan.onEditItem}
                onRemove={plan.onRemoveItem}
              />
            ))}
          </ol>
        ) : (
          <p className="listing-empty-line">
            {planMode === "template"
              ? "挑选品类模板后在此预览分镜"
              : "勾选出图类型后在此预览"}
          </p>
        )}
        {planned && plan.removedCount ? (
          <button
            type="button"
            className="listing-link"
            disabled={running}
            onClick={plan.onRestore}
          >
            恢复已移除的 {plan.removedCount} 张
          </button>
        ) : null}
        <small className="listing-plan__foot">
          {planned
            ? runMode === "confirm"
              ? "可逐张修改标题、副文案与画面方向，确认后生成"
              : "将按此方案出图，可展开任意一张修改"
            : runMode === "fast"
              ? "极速出图不策划文案，直接按类型预置方向出图"
              : "AI 先为每张图写好标题与构图，不扣积分"}
        </small>
      </aside>

      <WorkbenchHistory
        label="商品套图"
        groups={historyGroups}
        activeGroup={activeGroup}
        displayUrl={resultUrl}
        fallbackRatio={mainRatio}
        running={running}
        onSelectHistory={onSelectHistory}
      />

      <TypeLibraryDialog
        open={typesOpen}
        onClose={() => setTypesOpen(false)}
        selectedIds={freeItems.map((item) => item.id)}
        totalShots={freeTotal}
        onToggle={actions.toggleType}
        customTypes={customTypes}
        onAddCustom={actions.addCustomType}
        onRemoveCustom={actions.removeCustomType}
        savedTemplates={savedTemplates}
        onApplySaved={actions.applySaved}
        onRemoveSaved={actions.removeSaved}
        onSaveCurrent={actions.saveTemplate}
        canSaveCurrent={freeItems.length > 0}
      />
      <TemplateLibraryDialog
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        selectedIds={templateIds}
        onToggle={actions.toggleTemplate}
      />
    </div>
  );
}
