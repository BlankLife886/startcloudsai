import { useEffect, useRef, useState } from "react";
import "@legacy/components/layout/LocaleSwitcher.vue?react-style";

const options = [
  { value: "zh-CN", short: "简", label: "简体中文" },
  { value: "zh-TW", short: "繁", label: "繁體中文" },
  { value: "en", short: "EN", label: "English" },
];

export function LocaleSwitcher() {
  const rootRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [locale, setLocale] = useState(() => localStorage.getItem("starclouds-locale") || "zh-CN");
  const current = options.find((option) => option.value === locale) || options[0];

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function select(next) {
    setLocale(next);
    localStorage.setItem("starclouds-locale", next);
    setOpen(false);
  }

  return (
    <div ref={rootRef} className={`locale-switcher nav-locale-switch${open ? " is-open" : ""}`}>
      <button type="button" className="locale-switcher__trigger" title="语言 / Language / 語言" aria-label="语言 / Language / 語言" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        <span className="locale-switcher__face" aria-hidden="true">{current.short}</span>
      </button>
      {open && (
        <ul className="locale-switcher__menu" role="listbox" aria-label="语言 / Language / 語言">
          {options.map((option) => (
            <li key={option.value} role="option" className={`locale-switcher__option${option.value === locale ? " is-active" : ""}`} aria-selected={option.value === locale} tabIndex={-1} onClick={() => select(option.value)}>
              <span className="locale-switcher__badge">{option.short}</span>
              <span className="locale-switcher__label">{option.label}</span>
              <i className={`bi bi-check2 locale-switcher__check${option.value === locale ? " is-visible" : ""}`} aria-hidden="true" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
