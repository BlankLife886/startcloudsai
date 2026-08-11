import { useCallback, useEffect, useRef, useState } from "react";
import { getGrowthPrograms } from "@legacy/services/growthApi.js";

export function useGrowthPrograms({ auto = true } = {}) {
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(auto);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await getGrowthPrograms({ signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return null;
      setData(result);
      return result;
    } catch (requestError) {
      if (requestError?.name === "AbortError") return null;
      if (mountedRef.current) {
        setError(requestError?.message || "创作激励数据读取失败");
      }
      return null;
    } finally {
      if (mountedRef.current && controllerRef.current === controller) {
        controllerRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (auto) void reload();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [auto, reload]);

  return { data, setData, loading, error, reload, mountedRef };
}
