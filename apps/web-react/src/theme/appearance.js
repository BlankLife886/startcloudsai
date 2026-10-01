export const APPEARANCE_STORAGE_KEY = "walleven-color-scheme";
export const LEGACY_APPEARANCE_STORAGE_KEY = "starclouds-appearance";

export function normalizeAppearance(value) {
  return String(value || "").toLowerCase() === "dark" ? "dark" : "light";
}

export function readAppearance() {
  if (typeof localStorage === "undefined") return "light";
  try {
    return normalizeAppearance(
      localStorage.getItem(APPEARANCE_STORAGE_KEY) ||
        localStorage.getItem(LEGACY_APPEARANCE_STORAGE_KEY),
    );
  } catch {
    return "light";
  }
}

export function applyAppearance(value) {
  const appearance = normalizeAppearance(value);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("color-scheme-dark", appearance === "dark");
    root.classList.toggle("dark", appearance === "dark");
    root.dataset.colorScheme = appearance;
    root.style.colorScheme = appearance;
  }
  return appearance;
}

export function setAppearance(value) {
  const appearance = applyAppearance(value);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, appearance);
      localStorage.setItem(LEGACY_APPEARANCE_STORAGE_KEY, appearance);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }
  return appearance;
}

