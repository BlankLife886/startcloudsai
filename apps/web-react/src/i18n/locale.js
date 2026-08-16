export const LOCALE_STORAGE_KEY = "starclouds-locale";

export const LOCALE_OPTIONS = Object.freeze([
  Object.freeze({ value: "zh-CN", short: "简", label: "简体中文" }),
  Object.freeze({ value: "zh-TW", short: "繁", label: "繁體中文" }),
  Object.freeze({ value: "en", short: "EN", label: "English" }),
]);

export function normalizeLocale(value) {
  const locale = String(value || "").trim().toLowerCase();
  if (locale === "en" || locale.startsWith("en-")) return "en";
  if (["zh-tw", "zh-hk", "zh-mo", "zh-hant"].includes(locale)) return "zh-TW";
  return "zh-CN";
}

export function readLocale() {
  if (typeof localStorage !== "undefined") {
    try {
      const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
      if (stored) return normalizeLocale(stored);
    } catch {
      // Storage may be unavailable in privacy-restricted browser contexts.
    }
  }
  return normalizeLocale(typeof navigator !== "undefined" ? navigator.language : "zh-CN");
}

export function persistLocale(value) {
  const locale = normalizeLocale(value);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // The in-memory locale still works when persistent storage is unavailable.
    }
  }
  return locale;
}

export function applyLocaleToDocument(value) {
  const locale = normalizeLocale(value);
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
  }
  return locale;
}

