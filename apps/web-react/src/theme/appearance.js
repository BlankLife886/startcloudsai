export const APPEARANCE_STORAGE_KEY = "walleven-color-scheme";
export const LEGACY_APPEARANCE_STORAGE_KEY = "starclouds-appearance";

// 用户选择的外观偏好：light / dark / system（跟随系统，默认）。实际生效的只有 light / dark。
export const APPEARANCE_PREFERENCES = ["light", "dark", "system"];

const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function normalizeAppearance(value) {
  return String(value || "").toLowerCase() === "dark" ? "dark" : "light";
}

export function normalizeAppearancePreference(value) {
  const preference = String(value || "").toLowerCase();
  return APPEARANCE_PREFERENCES.includes(preference) ? preference : "system";
}

function systemPrefersDark() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.(SYSTEM_DARK_QUERY).matches);
}

export function resolveAppearance(value) {
  const preference = normalizeAppearancePreference(value);
  if (preference === "system") return systemPrefersDark() ? "dark" : "light";
  return preference;
}

export function readAppearancePreference() {
  if (typeof localStorage === "undefined") return "system";
  try {
    return normalizeAppearancePreference(
      localStorage.getItem(APPEARANCE_STORAGE_KEY) ||
        localStorage.getItem(LEGACY_APPEARANCE_STORAGE_KEY),
    );
  } catch {
    return "system";
  }
}

export function readAppearance() {
  return resolveAppearance(readAppearancePreference());
}

export function applyAppearance(value) {
  const preference = normalizeAppearancePreference(value);
  const appearance = resolveAppearance(preference);
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("color-scheme-dark", appearance === "dark");
    root.classList.toggle("dark", appearance === "dark");
    root.dataset.colorScheme = appearance;
    root.dataset.colorSchemePreference = preference;
    root.style.colorScheme = appearance;
  }
  return appearance;
}

export function setAppearance(value) {
  const preference = normalizeAppearancePreference(value);
  const appearance = applyAppearance(preference);
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(APPEARANCE_STORAGE_KEY, preference);
      localStorage.setItem(LEGACY_APPEARANCE_STORAGE_KEY, preference);
    } catch {
      // Theme still applies for the current session when storage is unavailable.
    }
  }
  return appearance;
}

// 跟随系统时，系统切换亮暗要实时同步
if (typeof window !== "undefined") {
  window.matchMedia?.(SYSTEM_DARK_QUERY).addEventListener?.("change", () => {
    if (readAppearancePreference() === "system") applyAppearance("system");
  });
}
