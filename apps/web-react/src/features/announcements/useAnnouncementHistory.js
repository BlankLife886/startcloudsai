import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getAnnouncementHistory } from "../../legacy-modules/services/metaApi.js";
import { useLiveAnnouncements } from "./useLiveAnnouncements.js";

export function announcementPublishedAt(item) {
  const time = Date.parse(item?.startsAt || "") || Date.parse(item?.createdAt || "");
  return Number.isFinite(time) ? time : 0;
}

/** 公告中心数据：历史记录（含已结束）+ 实时生效列表，实时列表变化时重新拉一次历史。 */
export function useAnnouncementHistory() {
  const live = useLiveAnnouncements();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const controllerRef = useRef(null);

  const load = useCallback(async () => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    try {
      const items = await getAnnouncementHistory({ signal: controller.signal });
      if (controller.signal.aborted) return;
      setHistory(items.filter((item) => item && typeof item === "object" && item.id));
      setError("");
    } catch (err) {
      if (!controller.signal.aborted) setError(err?.message || "公告记录读取失败");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [live.items, load]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const items = useMemo(() => {
    const byId = new Map(history.map((item) => [item.id, item]));
    for (const item of live.items) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => announcementPublishedAt(b) - announcementPublishedAt(a));
  }, [history, live.items]);

  const refresh = useCallback(() => {
    void live.refresh();
    return load();
  }, [live, load]);

  return {
    items,
    loading: loading && !items.length,
    refreshing: loading || live.loading,
    error: items.length ? "" : error || live.error,
    refresh,
  };
}
