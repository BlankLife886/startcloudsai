import { useCallback, useEffect, useMemo, useState } from "react";
import { getUsageStats } from "@react/legacy-modules/services/meApi.js";
import { buildUsageModel } from "./usageStats.js";

function browserTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

/**
 * 个人中心「创作数据」的共享状态：底部统计卡和下方图表共用一次请求，
 * 当前指标 / 周期也放在这里，点统计卡可以直接切到对应图表。
 */
export function useProfileUsage() {
  const timezone = useMemo(browserTimezone, []);
  const [state, setState] = useState({ loading: true, error: "", stats: null });
  const [reloadKey, setReloadKey] = useState(0);
  const [metric, setMetric] = useState("images");
  const [range, setRange] = useState("day");

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, loading: true, error: "" }));
    getUsageStats({ tz: timezone, signal: controller.signal })
      .then((stats) => setState({ loading: false, error: "", stats }))
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ loading: false, error: error?.message || "创作数据读取失败", stats: null });
      });
    return () => controller.abort();
  }, [timezone, reloadKey]);

  const model = useMemo(() => buildUsageModel(state.stats), [state.stats]);
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return {
    timezone,
    loading: state.loading,
    error: state.error,
    ready: Boolean(state.stats),
    model,
    reload,
    metric,
    setMetric,
    range,
    setRange,
  };
}
