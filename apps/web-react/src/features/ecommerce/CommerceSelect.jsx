import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@react/legacy-styles/generated/features/ecommerce/CommerceSelect.css";
import "./CommerceSelect.override.css";
import { useLocale } from "../../i18n/index.js";
import { ModelCatalogIcon, ModelMaintenanceBadge, isCatalogModelMaintenance } from "../../components/common/ModelCatalogIcon.jsx";
import { resolveModelPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";

function CommerceSelectPrice({ model, hint }) {
  if (model && !isCatalogModelMaintenance(model)) {
    const price = resolveModelPointPricing(model);
    if (price.hasDiscount) {
      return (
        <span className="commerce-select-price has-discount">
          <strong>折扣 {price.discount} 积分/张</strong>
          <del>{price.standard} 积分/张</del>
        </span>
      );
    }
    if (price.configured) {
      return (
        <small className="commerce-select-hint">
          {price.effective === 0 ? "免费" : `${price.effective} 积分/张`}
        </small>
      );
    }
  }
  return hint ? <small className="commerce-select-hint">{hint}</small> : null;
}

export function CommerceSelect({
  value,
  options = [],
  onChange,
  disabled = false,
  placeholder = "请选择",
  ariaLabel = "选择选项",
  menuMinWidth = 0,
  treatEmptyAsPlaceholder = false,
}) {
  const { t } = useLocale();
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [style, setStyle] = useState({});
  const normalized = useMemo(
    () =>
      options.map((item) =>
        item && typeof item === "object"
          ? {
              value: item.value,
              label: t(String(item.label ?? item.value ?? "")),
              hint: isCatalogModelMaintenance(item.model) ? "" : String(item.hint || "").trim(),
              model: item.model,
              hasPrice: Boolean(item.model && !isCatalogModelMaintenance(item.model) && resolveModelPointPricing(item.model).configured),
              disabled: item.disabled === true,
            }
          : { value: item, label: t(String(item ?? "")), hint: "" },
      ),
    [options, t],
  );
  const selectedIndex = normalized.findIndex((item) => item.value === value);
  const selected = normalized[selectedIndex] || null;
  const isPlaceholder =
    !selected || (treatEmptyAsPlaceholder && String(selected.value || "") === "");

  function positionMenu() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const gap = 7;
    const padding = 10;
    const estimated = Math.min(normalized.length * 36 + 10, 264);
    const below = window.innerHeight - rect.bottom - padding;
    const above = rect.top - padding;
    const placeAbove = below < Math.min(estimated, 180) && above > below;
    const maxHeight = Math.max(
      110,
      Math.min(264, (placeAbove ? above : below) - gap),
    );
    const availableWidth = Math.max(160, window.innerWidth - padding * 2);
    const hasModels = normalized.some((item) => item.model);
    const hasHint = normalized.some((item) => item.hint || item.hasPrice);
    const requested = Number(menuMinWidth) || 0;
    const floor = hasModels ? Math.max(requested, 360) : requested > 0 ? requested : hasHint ? 220 : 160;
    const menuWidth = Math.min(availableWidth, Math.max(rect.width, floor));
    setStyle({
      left: Math.min(
        Math.max(padding, rect.left),
        Math.max(padding, window.innerWidth - menuWidth - padding),
      ),
      top: placeAbove
        ? Math.max(padding, rect.top - Math.min(estimated, maxHeight) - gap)
        : rect.bottom + gap,
      width: menuWidth,
      maxHeight,
      transformOrigin: placeAbove ? "bottom center" : "top center",
    });
  }

  useEffect(() => {
    if (!open) return undefined;
    positionMenu();
    const closeOutside = (event) => {
      if (
        !triggerRef.current?.contains(event.target) &&
        !menuRef.current?.contains(event.target)
      )
        setOpen(false);
    };
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOutside, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOutside, true);
    };
  }, [open, normalized.length]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  function openMenu() {
    if (disabled || !normalized.length) return;
    const firstEnabled = normalized.findIndex((item) => !item.disabled);
    setActiveIndex(selectedIndex >= 0 && !normalized[selectedIndex]?.disabled ? selectedIndex : firstEnabled);
    setOpen(true);
  }

  function choose(option) {
    if (option.disabled) return;
    onChange?.(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function move(delta) {
    setActiveIndex((current) => {
      if (!normalized.some((item) => !item.disabled)) return -1;
      let next = current;
      do next = (next + delta + normalized.length) % normalized.length;
      while (normalized[next]?.disabled);
      return next;
    });
  }

  function onKeyDown(event) {
    if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!open) openMenu();
      else move(event.key === "ArrowDown" ? 1 : -1);
    } else if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!open) openMenu();
      else if (activeIndex >= 0) choose(normalized[activeIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`commerce-select-trigger${open ? " is-open" : ""}${isPlaceholder ? " is-placeholder" : ""}`}
        disabled={disabled}
        aria-label={t(ariaLabel)}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        {selected?.model ? <ModelCatalogIcon model={selected.model} size="sm" /> : null}
        <span>{selected?.label || t(placeholder)}</span>
        <i className="bi bi-chevron-down" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="commerce-select-menu commerce-select-pop-enter-active"
            style={style}
            role="listbox"
            aria-label={t(ariaLabel)}
            tabIndex={-1}
            onKeyDown={onKeyDown}
          >
            {normalized.map((option, index) => (
              <button
                key={`${String(option.value)}-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                title={option.disabled ? t("模型维护中，暂不可选择") : undefined}
                className={`${option.value === value ? "selected " : ""}${index === activeIndex ? "active" : ""}${option.hint || option.hasPrice ? " has-hint" : ""}`}
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                {option.model ? <ModelCatalogIcon model={option.model} size="sm" /> : null}
                <span>{option.label}</span>
                {option.hint || option.model ? (
                  <span className="commerce-select-aside">
                    {option.model ? <ModelMaintenanceBadge model={option.model} /> : null}
                    <CommerceSelectPrice model={option.model} hint={option.hint} />
                  </span>
                ) : null}
                {option.value === value && (
                  <i className="bi bi-check2" aria-hidden="true" />
                )}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
