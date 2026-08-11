import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "@legacy/features/ecommerce/CommerceSelect.vue?react-style";

export function CommerceSelect({
  value,
  options = [],
  onChange,
  disabled = false,
  placeholder = "请选择",
  ariaLabel = "选择选项",
}) {
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [style, setStyle] = useState({});
  const normalized = useMemo(
    () =>
      options.map((item) =>
        item && typeof item === "object"
          ? { value: item.value, label: String(item.label ?? item.value ?? "") }
          : { value: item, label: String(item ?? "") },
      ),
    [options],
  );
  const selectedIndex = normalized.findIndex((item) => item.value === value);
  const selected = normalized[selectedIndex] || null;

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
    setStyle({
      left: Math.min(rect.left, window.innerWidth - rect.width - padding),
      top: placeAbove
        ? Math.max(padding, rect.top - Math.min(estimated, maxHeight) - gap)
        : rect.bottom + gap,
      width: rect.width,
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
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }

  function choose(option) {
    onChange?.(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function move(delta) {
    setActiveIndex(
      (current) => (current + delta + normalized.length) % normalized.length,
    );
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
        className={`commerce-select-trigger${open ? " is-open" : ""}${selected ? "" : " is-placeholder"}`}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
      >
        <span>{selected?.label || placeholder}</span>
        <i className="bi bi-chevron-down" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="commerce-select-menu commerce-select-pop-enter-active"
            style={style}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={onKeyDown}
          >
            {normalized.map((option, index) => (
              <button
                key={`${String(option.value)}-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`${option.value === value ? "selected " : ""}${index === activeIndex ? "active" : ""}`}
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option)}
              >
                <span>{option.label}</span>
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
