const DEFAULT_ENTRY_LIMIT = 50_000;
const DEFAULT_CHECK_INTERVAL_MS = 30_000;

export function installDevPerformanceEntryGuard({
  entryLimit = DEFAULT_ENTRY_LIMIT,
  checkIntervalMs = DEFAULT_CHECK_INTERVAL_MS,
  performanceApi = globalThis.performance,
  timerApi = globalThis,
} = {}) {
  if (
    !performanceApi ||
    typeof performanceApi.getEntriesByType !== "function" ||
    typeof performanceApi.clearMeasures !== "function" ||
    typeof timerApi.setInterval !== "function" ||
    typeof timerApi.clearInterval !== "function"
  ) {
    return () => {};
  }

  const trimEntries = () => {
    if (performanceApi.getEntriesByType("measure").length < entryLimit) return false;
    performanceApi.clearMeasures();
    performanceApi.clearMarks?.();
    return true;
  };

  trimEntries();
  const timer = timerApi.setInterval(trimEntries, checkIntervalMs);
  return () => timerApi.clearInterval(timer);
}
