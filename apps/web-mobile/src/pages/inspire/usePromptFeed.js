import { useCallback, useEffect, useRef, useState } from "react";
import { Toast } from "@mobile/components/overlay/index.js";
import {
  clearPromptsCache,
  listPromptCategories,
  listPrompts,
  recordPromptEngagement,
} from "@react/legacy-modules/services/promptsApi.js";
import { resolveLocalizedPrompt } from "@react/legacy-modules/services/promptLibrary.js";

const PAGE_SIZE = 20;

// 固定入口在前，后台配置的分类在后。
export const FIXED_CHANNELS = [
  { key: "all", label: "推荐" },
  { key: "today", label: "24小时最新" },
  { key: "favorites", label: "我的收藏", needsLogin: true },
];

export const SORT_OPTIONS = [
  { key: "recommended", label: "智能推荐" },
  { key: "favorites", label: "收藏最多" },
  { key: "likes", label: "点赞最多" },
  { key: "usage", label: "使用最多" },
];

function queryFor(channel, sort, search) {
  const fixed = channel === "all" || channel === "today" || channel === "favorites";
  return {
    type: "t2i",
    category: fixed ? "" : channel,
    scope: channel === "favorites" ? "favorites" : channel === "today" ? "today" : "",
    sort: channel === "today" ? "latest" : sort,
    search,
    limit: PAGE_SIZE,
  };
}

function toItem(raw) {
  return { ...raw, prompt: resolveLocalizedPrompt(raw.prompt) };
}

/** 灵感流：分类 / 排序 / 搜索下的 cursor 分页，以及点赞、收藏、使用的乐观更新。 */
export function usePromptFeed({ authenticated }) {
  const [channels, setChannels] = useState(FIXED_CHANNELS);
  const [channel, setChannel] = useState("all");
  const [sort, setSort] = useState("recommended");
  const [search, setSearch] = useState("");
  const [items, setItems] = useState([]);
  const [cursor, setCursor] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const requestRef = useRef(0);

  useEffect(() => {
    listPromptCategories({ type: "t2i" })
      .then((categories) => setChannels([
        ...FIXED_CHANNELS,
        ...categories.sort((left, right) => left.sort - right.sort).map((item) => ({ key: item.key, label: item.label })),
      ]))
      .catch(() => null);
  }, []);

  const load = useCallback(async ({ append = false, fresh = false } = {}) => {
    if (channel === "favorites" && !authenticated) {
      setItems([]);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const request = ++requestRef.current;
    if (fresh) clearPromptsCache();
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const result = await listPrompts({ ...queryFor(channel, sort, search), cursor: append ? cursor : "" });
      if (request !== requestRef.current) return;
      const incoming = result.items.map(toItem);
      setItems((current) => {
        if (!append) return incoming;
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...incoming.filter((item) => !seen.has(item.id))];
      });
      setCursor(result.nextCursor || "");
      setHasMore(Boolean(result.nextCursor));
    } catch (caught) {
      if (request === requestRef.current) setError(caught?.message || "灵感读取失败");
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [authenticated, channel, cursor, search, sort]);

  // 切换分类、排序或搜索词时从第一页重新读取。
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, sort, search, authenticated]);

  const patchItem = useCallback((id, patch) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...(typeof patch === "function" ? patch(item) : patch) } : item)));
  }, []);

  const toggle = useCallback(async (item, action) => {
    const field = action === "like" ? "liked" : "favorited";
    const countField = action === "like" ? "likeCount" : "favoriteCount";
    const previous = item[field] === true;
    const flip = (on) => (entry) => ({
      [field]: on,
      [countField]: Math.max(0, Number(entry[countField] || 0) + (on ? 1 : -1)),
    });
    patchItem(item.id, flip(!previous));
    try {
      const result = await recordPromptEngagement(item.id, action, !previous);
      patchItem(item.id, result || {});
      if (action === "favorite" && previous && channel === "favorites") {
        setItems((current) => current.filter((entry) => entry.id !== item.id));
      }
      return !previous;
    } catch {
      patchItem(item.id, flip(previous));
      Toast.show({ icon: "fail", content: "操作失败，请稍后重试" });
      return previous;
    }
  }, [channel, patchItem]);

  const markUsed = useCallback((item) => {
    patchItem(item.id, (entry) => ({ useCount: Number(entry.useCount || 0) + 1 }));
    void recordPromptEngagement(item.id, "use").then((result) => patchItem(item.id, result || {})).catch(() => undefined);
  }, [patchItem]);

  return {
    channels,
    channel,
    setChannel,
    sort,
    setSort,
    search,
    setSearch,
    items,
    hasMore,
    loading,
    loadingMore,
    error,
    refresh: () => load({ fresh: true }),
    loadMore: () => (hasMore && !loadingMore ? load({ append: true }) : Promise.resolve()),
    toggle,
    markUsed,
  };
}
