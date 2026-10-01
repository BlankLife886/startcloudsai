const RELOAD_MARKER_KEY = "starclouds:dynamic-import-reload";

export function isDynamicImportFailure(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return (
    error?.name === "ChunkLoadError" ||
    message.includes("failed to fetch dynamically imported module") ||
    message.includes("error loading dynamically imported module") ||
    message.includes("importing a module script failed") ||
    (message.includes("/assets/") && (message.includes("404") || message.includes("load")))
  );
}

export function shouldReloadDynamicImport(error, currentLocation, previousLocation) {
  const current = String(currentLocation || "");
  return Boolean(isDynamicImportFailure(error) && current && current !== previousLocation);
}

function currentRouteKey() {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function clearReloadMarker() {
  try {
    sessionStorage.removeItem(RELOAD_MARKER_KEY);
  } catch {
    // Storage can be unavailable in private browsing; successful imports need no recovery.
  }
}

export async function importWithRecovery(importer) {
  try {
    const module = await importer();
    clearReloadMarker();
    return module;
  } catch (error) {
    if (typeof window === "undefined") throw error;
    const routeKey = currentRouteKey();
    let previous = "";
    try {
      previous = sessionStorage.getItem(RELOAD_MARKER_KEY) || "";
    } catch {
      // A reload is still preferable to leaving the application on a broken lazy route.
    }
    if (!shouldReloadDynamicImport(error, routeKey, previous)) {
      clearReloadMarker();
      throw error;
    }
    try {
      sessionStorage.setItem(RELOAD_MARKER_KEY, routeKey);
    } catch {
      // Continue with the one best-effort reload when session storage is unavailable.
    }
    window.location.reload();
    return new Promise(() => {});
  }
}
