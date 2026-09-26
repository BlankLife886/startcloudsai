import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { useVirtualMasonryFeed } from "../features/prompts/useVirtualMasonryFeed.js";
import {
  listPromptCategories,
  listPromptLibrary,
  recordPromptEngagement,
} from "@react/legacy-modules/services/promptLibrary.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import {
  PROMPT_TASK_TYPES,
  stashPendingPrompt,
  studioRouteForTaskType,
} from "@react/legacy-modules/features/creator-hub/studioTools.js";
import { setBodyScrollLock } from "@react/legacy-modules/utils/bodyScrollLock.js";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import "@react/legacy-static/features/creator-hub/creator-hub.css";

gsap.registerPlugin(useGSAP);

const PREVIEW_SCROLL_LOCK = "prompt-library-preview";
const SCOPE_CATEGORIES = [
  { id: "all", label: "全部" },
  { id: "today", label: "今日最新", scope: "today" },
  { id: "favorites", label: "我的收藏", scope: "favorites" },
];

function categoryId(category) {
  return String(category?.key || category?.id || "");
}

function motionDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

export function PromptLibraryView() {
  const navigate = useNavigate();
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const [items, setItems] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState("t2i");
  const [activeCategory, setActiveCategory] = useState("all");
  const [preview, setPreview] = useState(null);
  const [contentRevision, setContentRevision] = useState(0);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const categoryMenuRef = useRef(null);
  const searchContainerRef = useRef(null);
  const searchInputRef = useRef(null);
  const rootRef = useRef(null);
  const requestIdRef = useRef(0);
  const loadSentinelRef = useRef(null);
  const previewPanelRef = useRef(null);
  const previewInertiaCleanupRef = useRef(null);
  const loadedCoverKeysRef = useRef(new Set());
  const [previewMotionPresent, setPreviewMotionPresent] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const copiedTimeoutRef = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (
        categoryMenuRef.current &&
        !categoryMenuRef.current.contains(event.target)
      ) {
        setCategoryMenuOpen(false);
      }
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target)
      ) {
        if (!search.trim()) {
          setSearchExpanded(false);
        }
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [search]);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, []);

  const stopPreviewInertiaGuard = useCallback(() => {
    previewInertiaCleanupRef.current?.();
    previewInertiaCleanupRef.current = null;
  }, []);

  const startPreviewInertiaGuard = useCallback(
    (duration = 0, { allowPreviewScroll = false } = {}) => {
      stopPreviewInertiaGuard();
      const shouldBlock = (event) => {
        if (!allowPreviewScroll) return true;
        const panel = previewPanelRef.current;
        let element =
          typeof Element !== "undefined" && event.target instanceof Element
            ? event.target
            : null;
        if (!element || !panel?.contains(element)) return true;
        if (event.type === "touchmove") return false;
        const delta = Number(event.deltaY) || 0;
        while (element && panel?.contains(element)) {
          if (
            element.matches(
              ".ch-preview__media, .ch-preview__mid, .ch-preview",
            ) &&
            element.scrollHeight > element.clientHeight + 1
          ) {
            const { scrollTop, scrollHeight, clientHeight } = element;
            const atTop = scrollTop <= 0;
            const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
            if (!((atTop && delta < 0) || (atBottom && delta > 0))) {
              return false;
            }
          }
          if (element === panel) break;
          element = element.parentElement;
        }
        return true;
      };
      const blockOverscroll = (event) => {
        if (shouldBlock(event)) event.preventDefault();
      };
      document.addEventListener("wheel", blockOverscroll, {
        passive: false,
        capture: true,
      });
      document.addEventListener("touchmove", blockOverscroll, {
        passive: false,
        capture: true,
      });
      const timer = duration
        ? window.setTimeout(() => stopPreviewInertiaGuard(), duration)
        : 0;
      previewInertiaCleanupRef.current = () => {
        if (timer) window.clearTimeout(timer);
        document.removeEventListener("wheel", blockOverscroll, { capture: true });
        document.removeEventListener("touchmove", blockOverscroll, {
          capture: true,
        });
      };
    },
    [stopPreviewInertiaGuard],
  );

  const categoryMeta = useMemo(() => {
    const scopeIds = new Set(SCOPE_CATEGORIES.map((item) => item.id));
    return [
      ...SCOPE_CATEGORIES.filter(
        (item) => item.scope !== "favorites" || auth.isAuthenticated,
      ),
      ...categories
        .filter((item) => !scopeIds.has(categoryId(item)))
        .map((item) => ({ ...item, id: categoryId(item) })),
    ];
  }, [auth.isAuthenticated, categories]);

  useEffect(() => {
    if (!categoryMeta.some((item) => item.id === activeCategory)) {
      setActiveCategory("all");
    }
  }, [activeCategory, categoryMeta]);

  const activeScope =
    SCOPE_CATEGORIES.find((item) => item.id === activeCategory)?.scope || "";
  const categoryParam = activeScope || activeCategory === "all" ? "" : activeCategory;

  useEffect(() => {
    let disposed = false;
    listPromptCategories({ type: activeType })
      .then((rows) => {
        if (!disposed) setCategories(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!disposed) setCategories([]);
      });
    return () => {
      disposed = true;
    };
  }, [activeType]);

  const loadPrompts = useCallback(
    async ({ reset = true } = {}) => {
      if (!reset && (loading || loadingMore || !hasMore)) return;
      const requestId = reset ? ++requestIdRef.current : requestIdRef.current;
      const nextPage = reset ? 1 : page + 1;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const response = await listPromptLibrary(activeType, {
          pageNumber: nextPage,
          pageSize: 24,
          category: categoryParam,
          scope: activeScope,
        });
        if (requestId !== requestIdRef.current) return;
        setItems((current) =>
          reset ? response.items || [] : [...current, ...(response.items || [])],
        );
        if (reset) setContentRevision((current) => current + 1);
        setPage(nextPage);
        setHasMore(Boolean(response.hasMore));
      } catch (error) {
        if (reset) setItems([]);
        notificationService.error(error?.message || "提示词读取失败");
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    }, [activeScope, activeType, categoryParam, hasMore, loading, loadingMore, page]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    void loadPrompts({ reset: true });
    // Reset loads are intentionally keyed only by the selected server filters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeType, activeCategory]);

  useEffect(() => {
    const sentinel = loadSentinelRef.current;
    if (!sentinel || !hasMore || typeof IntersectionObserver === "undefined") {
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadPrompts({ reset: false });
        }
      },
      { root: null, rootMargin: "1200px 0px", threshold: 0 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadPrompts]);

  useEffect(() => {
    document.documentElement.classList.add("creator-hub-sticky-page");
    return () => {
      document.documentElement.classList.remove("creator-hub-sticky-page");
      stopPreviewInertiaGuard();
      setBodyScrollLock(PREVIEW_SCROLL_LOCK, false);
    };
  }, [stopPreviewInertiaGuard]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) =>
      `${item.title || ""} ${item.prompt || ""} ${(item.tags || []).join(" ")}`
        .toLowerCase()
        .includes(query),
    );
  }, [items, search]);

  const masonryItems = useMemo(
    () =>
      filteredItems.map((item, index) => ({
        key: String(item.id || index),
        item,
        index,
        aspect:
          Number(item.coverWidth) > 0 && Number(item.coverHeight) > 0
            ? `${item.coverWidth} / ${item.coverHeight}`
            : "3 / 4",
        cover: item.coverUrl || item.imageUrl || "",
      })),
    [filteredItems],
  );
  const getEntryAspect = useCallback((entry) => entry.aspect, []);
  const masonry = useVirtualMasonryFeed({
    items: masonryItems,
    fallbackAspect: 3 / 4,
    bodyHeight: 0,
    borderWidth: 0,
    minColumnWidth: 260,
    maxColumns: 12,
    overscan: 960,
    getAspect: getEntryAspect,
  });

  useLayoutEffect(() => {
    const root = masonry.containerRef.current;
    if (!root) return undefined;
    const align = () => {
      const dpr = window.devicePixelRatio || 1;
      for (const card of root.querySelectorAll(".ch-prompt-masonry__item")) {
        const rect = card.getBoundingClientRect();
        const left = Math.round(rect.left * dpr) / dpr;
        const top = Math.round(rect.top * dpr) / dpr;
        const right = Math.round(rect.right * dpr) / dpr;
        const bottom = Math.round(rect.bottom * dpr) / dpr;
        const dx = left - rect.left;
        const dy = top - rect.top;
        const width = right - left;
        const height = bottom - top;
        if (
          Math.abs(dx) < 0.01 &&
          Math.abs(dy) < 0.01 &&
          Math.abs(width - rect.width) < 0.01 &&
          Math.abs(height - rect.height) < 0.01
        ) {
          continue;
        }
        card.style.left = `${(parseFloat(card.style.left) || 0) + dx}px`;
        card.style.top = `${(parseFloat(card.style.top) || 0) + dy}px`;
        card.style.width = `${width}px`;
        card.style.height = `${height}px`;
      }
    };
    align();
    window.addEventListener("resize", align);
    window.addEventListener("scrollend", align);
    return () => {
      window.removeEventListener("resize", align);
      window.removeEventListener("scrollend", align);
    };
  }, [masonry.containerRef, masonry.totalHeight, masonry.visibleItems]);

  useGSAP(
    () => {
      const root = rootRef.current;
      if (!root) return undefined;
      const targets = gsap.utils.toArray("[data-prompt-page-motion]", root);
      root.dataset.promptMotionState = "entering";
      if (motionDisabled()) {
        gsap.set(targets, { clearProps: "opacity,visibility,transform" });
        root.dataset.promptMotionState = "entered";
        return undefined;
      }
      const timeline = gsap.timeline({
        defaults: { ease: "power2.out" },
        onComplete: () => {
          root.dataset.promptMotionState = "entered";
        },
      });
      timeline.fromTo(
        targets,
        { autoAlpha: 0, y: 12 },
        { autoAlpha: 1, y: 0, duration: 0.42, stagger: 0.07, clearProps: "transform" },
      );
      return () => timeline.kill();
    },
    { scope: rootRef },
  );

  useLayoutEffect(() => {
    if (!contentRevision || loading) return;
    const container = rootRef.current?.querySelector(".ch-prompt-masonry");
    if (container) container.dataset.promptFeedState = "entered";
  }, [contentRevision, loading]);

  const revealPromptImage = useCallback((event, key, hasServerAspect) => {
    const image = event.currentTarget;
    const alreadyLoaded = loadedCoverKeysRef.current.has(key);
    loadedCoverKeysRef.current.add(key);
    if (!alreadyLoaded && !hasServerAspect) masonry.measureFromEvent(key, event);
    (image.closest(".authenticated-image") || image).classList.add("is-loaded");
    gsap.killTweensOf(image);
    gsap.set(image, { autoAlpha: 1, clearProps: "transform" });
  }, [masonry]);

  const activeTypeLabel =
    PROMPT_TASK_TYPES.find((item) => item.id === activeType)?.label || "文生图";
  const activeCategoryLabel =
    categoryMeta.find((item) => item.id === activeCategory)?.label || "全部";
  const previewIndex = preview
    ? filteredItems.findIndex((item) => String(item.id) === String(preview.id))
    : -1;
  const hasPreviewPrev = previewIndex > 0;
  const hasPreviewNext =
    previewIndex >= 0 && previewIndex < filteredItems.length - 1;

  const openPreview = useCallback(
    (item) => {
      stopPreviewInertiaGuard();
      setPreviewMotionPresent(true);
      setPreview(item);
    },
    [stopPreviewInertiaGuard],
  );
  const closePreview = useCallback(() => {
    const root = previewPanelRef.current;
    for (const element of [
      root?.querySelector(".ch-preview__media"),
      root?.querySelector(".ch-preview__mid"),
    ]) {
      if (!element) continue;
      element.style.overflow = "hidden";
      element.scrollTop = element.scrollTop;
    }
    setPreview(null);
    startPreviewInertiaGuard(450, { allowPreviewScroll: false });
  }, [startPreviewInertiaGuard]);
  const showPreviewAt = useCallback(
    (index) => {
      const item = filteredItems[index];
      if (!item) return;
      setPreview(item);
      requestAnimationFrame(() => {
        const root = previewPanelRef.current;
        const media = root?.querySelector(".ch-preview__media");
        const mid = root?.querySelector(".ch-preview__mid");
        if (media) media.scrollTop = 0;
        if (mid) mid.scrollTop = 0;
      });
    },
    [filteredItems],
  );

  useEffect(() => {
    if (!previewMotionPresent) return undefined;
    setBodyScrollLock(PREVIEW_SCROLL_LOCK, true, { freezeViewport: false });
    startPreviewInertiaGuard(0, { allowPreviewScroll: true });
    return () => {
      stopPreviewInertiaGuard();
      setBodyScrollLock(PREVIEW_SCROLL_LOCK, false);
    };
  }, [
    previewMotionPresent,
    startPreviewInertiaGuard,
    stopPreviewInertiaGuard,
  ]);

  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "ArrowLeft" && hasPreviewPrev) {
        event.preventDefault();
        showPreviewAt(previewIndex - 1);
      } else if (event.key === "ArrowRight" && hasPreviewNext) {
        event.preventDefault();
        showPreviewAt(previewIndex + 1);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [
    hasPreviewNext,
    hasPreviewPrev,
    preview,
    previewIndex,
    showPreviewAt,
  ]);

  async function copyPrompt(item) {
    const prompt = String(item?.prompt || "").trim();
    if (!prompt) {
      notificationService.info("没有可复制的提示词");
      return;
    }
    let copied = false;
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(prompt);
        copied = true;
      } catch {
        // Fallback to execCommand below
      }
    }
    if (!copied) {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = prompt;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        copied = document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        copied = false;
      }
    }
    if (copied) {
      setCopiedId(item.id);
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
      copiedTimeoutRef.current = setTimeout(() => {
        setCopiedId((current) => (current === item.id ? null : current));
      }, 1800);
      notificationService.success("提示词已复制");
    } else {
      notificationService.error("复制失败，请手动选择文本");
    }
  }

  async function toggleFavorite(item) {
    if (!auth.isAuthenticated) {
      requestAuth({ featureLabel: "提示词收藏" });
      return;
    }
    if (!item?.id) return;
    const favorited = !item.favorited;
    try {
      await recordPromptEngagement(item.id, "favorite", favorited);
      const update = (entry) =>
        String(entry.id) === String(item.id)
          ? {
              ...entry,
              favorited,
              favoriteCount: Math.max(
                0,
                Number(entry.favoriteCount || 0) + (favorited ? 1 : -1),
              ),
            }
          : entry;
      setItems((current) => current.map(update));
      setPreview((current) => (current ? update(current) : current));
    } catch (error) {
      notificationService.error(error?.message || "收藏失败");
    }
  }

  async function usePrompt(item) {
    const prompt = String(item?.prompt || "").trim();
    if (!prompt) return;
    const taskType = item?.taskType || activeType || "t2i";
    stashPendingPrompt({ prompt, taskType });
    if (item?.id) {
      void recordPromptEngagement(item.id, "use", true).catch(() => null);
    }
    if (taskType === "t2i" || taskType === "infinite_canvas") {
      notificationService.success("已带到工作台");
    } else {
      try {
        await navigator.clipboard.writeText(prompt);
      } catch {
        // Navigation still succeeds when clipboard permission is unavailable.
      }
      notificationService.success("提示词已复制，请在工作台粘贴");
    }
    closePreview();
    navigate(studioRouteForTaskType(taskType));
  }

  function selectType(type) {
    if (type === activeType) return;
    setActiveType(type);
    setActiveCategory("all");
  }

  return (
    <main
      ref={rootRef}
      className="ch-page ch-page--prompts"
      data-prompt-motion-state="idle"
    >
      <div className="ch-shell">
        <div className="ch-sticky-bar">
          <div className="ch-toolbar ch-toolbar--prompts-unified" data-prompt-page-motion>
            {/* 最左边：分类选择下拉框 */}
            <div
              ref={categoryMenuRef}
              className={`ch-menu ch-menu--category${categoryMenuOpen ? " is-open" : ""}`}
            >
              <button
                type="button"
                className="ch-menu__trigger"
                aria-label="分类筛选"
                aria-expanded={categoryMenuOpen}
                onClick={() => setCategoryMenuOpen((prev) => !prev)}
              >
                <i className="bi bi-funnel ch-menu__leading-icon" aria-hidden="true" />
                <span>{activeCategoryLabel}</span>
                <i className="bi bi-chevron-down ch-menu__chevron" aria-hidden="true" />
              </button>
              {categoryMenuOpen && (
                <ul className="ch-menu__panel ch-menu__panel--categories" role="listbox">
                  {categoryMeta.map((category) => (
                    <li key={category.id} role="none">
                      <button
                        type="button"
                        className={`ch-menu__option${activeCategory === category.id ? " is-active" : ""}`}
                        onClick={() => {
                          setActiveCategory(category.id);
                          setCategoryMenuOpen(false);
                        }}
                      >
                        <span>{category.label}</span>
                        {activeCategory === category.id && (
                          <i className="bi bi-check2" aria-hidden="true" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="ch-toolbar__divider" aria-hidden="true" />

            {/* 中间：工作台类型选择（平铺胶囊，不做下拉框） */}
            <div className="ch-chips ch-chips--prompt-types" aria-label="工作台">
              {PROMPT_TASK_TYPES.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  className={`ch-chip${activeType === type.id ? " is-active" : ""}`}
                  onClick={() => selectType(type.id)}
                >
                  {type.label}
                </button>
              ))}
            </div>

            {/* 最右边：交互式搜索框（流式平滑展开，不重叠遮挡任何相邻按钮） */}
            <div
              className={`ch-prompt-search-slot${searchExpanded || search.trim() ? " is-expanded" : ""}`}
            >
              <div
                ref={searchContainerRef}
                className={`ch-prompt-search${searchExpanded || search.trim() ? " is-expanded" : ""}`}
                onClick={() => {
                  if (!searchExpanded) {
                    setSearchExpanded(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }
                }}
              >
                <button
                  type="button"
                  className="ch-prompt-search__toggle"
                  aria-label="搜索"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSearchExpanded(true);
                    requestAnimationFrame(() => searchInputRef.current?.focus());
                  }}
                >
                  <i className="bi bi-search" aria-hidden="true" />
                </button>
                <input
                  ref={searchInputRef}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onFocus={() => setSearchExpanded(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      if (search) {
                        setSearch("");
                      } else {
                        setSearchExpanded(false);
                        searchInputRef.current?.blur();
                      }
                    }
                  }}
                  type="search"
                  placeholder="搜索标题、提示词或标签"
                  aria-label="搜索标题、提示词或标签"
                  autoComplete="off"
                  spellCheck="false"
                />
                {search.trim() ? (
                  <button
                    type="button"
                    className="ch-prompt-search__clear"
                    aria-label="清空搜索"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearch("");
                      searchInputRef.current?.focus();
                    }}
                  >
                    <i className="bi bi-x-circle-fill" aria-hidden="true" />
                  </button>
                ) : searchExpanded ? (
                  <button
                    type="button"
                    className="ch-prompt-search__close"
                    aria-label="收起搜索"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearch("");
                      setSearchExpanded(false);
                    }}
                  >
                    <i className="bi bi-x-lg" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>

        <section className="ch-section" data-prompt-page-motion>
          {loading && !filteredItems.length ? (
            <div className="ch-loading">正在加载提示词…</div>
          ) : !filteredItems.length ? (
            <div className="ch-empty">
              <strong>暂无提示词</strong>
              <span>
                {activeType === "infinite_canvas"
                  ? "后台还没有投放无限画布提示词"
                  : "换个分类试试，或稍后再来看官方更新"}
              </span>
            </div>
          ) : (
            <div
              ref={masonry.containerRef}
              className="ch-prompt-masonry"
              style={{ height: `${masonry.totalHeight}px` }}
            >
              {masonry.visibleItems.map((entry) => {
                const isCopied = copiedId === entry.item.id;
                const promptSnippet = entry.item.prompt || entry.item.title || "";
                return (
                  <article
                    key={entry.key}
                    className="ch-card ch-prompt-masonry__item"
                    style={{
                      width: `${entry.width}px`,
                      height: `${entry.height}px`,
                      left: `${entry.left}px`,
                      top: `${entry.top}px`,
                    }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      className="ch-card__media ch-prompt-card__media"
                      onClick={() => openPreview(entry.item)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          openPreview(entry.item);
                        }
                      }}
                      aria-label={`${entry.item.title || "提示词"} - 查看详情`}
                    >
                      {entry.cover ? (
                        <>
                          <AuthenticatedImage
                            className={`ch-prompt-card__image${loadedCoverKeysRef.current.has(entry.key) ? " is-loaded" : ""}`}
                            src={entry.cover}
                            alt={entry.item.title || "提示词"}
                            loading={
                              entry.index < Math.max(6, masonry.columnCount * 2)
                                ? "eager"
                                : "lazy"
                            }
                            fetchPriority={
                              entry.index < Math.max(4, masonry.columnCount)
                                ? "high"
                                : "low"
                            }
                            rootMargin="720px 0px"
                            maxDimension={720}
                            retryCount={2}
                            keepLoaded
                            onLoad={(event) =>
                              revealPromptImage(
                                event,
                                entry.key,
                                Number(entry.item.coverWidth) > 0 &&
                                  Number(entry.item.coverHeight) > 0,
                              )
                            }
                          />
                          <div className="ch-prompt-card__hover-indicator" aria-hidden="true">
                            <i className="bi bi-arrows-angle-expand" />
                            <span>查看详情</span>
                          </div>
                        </>
                      ) : (
                        <div className="ch-card__placeholder ch-prompt-card__art-placeholder">
                          <div className="ch-prompt-card__art-watermark" aria-hidden="true">
                            <i className="bi bi-quote" />
                          </div>
                          <div className="ch-prompt-card__art-badge">
                            <i className="bi bi-stars" aria-hidden="true" />
                            <span>灵感提示词</span>
                          </div>
                          <div className="ch-prompt-card__art-text">
                            {promptSnippet}
                          </div>
                          <div className="ch-prompt-card__hover-indicator" aria-hidden="true">
                            <i className="bi bi-arrows-angle-expand" />
                            <span>查看详情</span>
                          </div>
                        </div>
                      )}

                      {/* 图文一体：底部渐变遮罩 + 标题 + 统计与图标操作组 */}
                      <div className="ch-prompt-card__title-scrim">
                        <div className="ch-prompt-card__scrim-content">
                          <h3
                            className="ch-card__title"
                            onClick={() => openPreview(entry.item)}
                          >
                            {entry.item.title || entry.item.label || "未命名灵感"}
                          </h3>

                          <div className="ch-prompt-card__scrim-footer">
                            <div className="ch-prompt-card__scrim-stats">
                              {entry.item.useCount ? (
                                <span className="ch-prompt-stat-pill" title={`使用 ${entry.item.useCount} 次`}>
                                  <i className="bi bi-lightning-charge-fill" aria-hidden="true" />
                                  <span>{entry.item.useCount}</span>
                                </span>
                              ) : null}
                              {entry.item.favoriteCount ? (
                                <span className="ch-prompt-stat-pill" title={`收藏 ${entry.item.favoriteCount} 次`}>
                                  <i className="bi bi-heart-fill" aria-hidden="true" />
                                  <span>{entry.item.favoriteCount}</span>
                                </span>
                              ) : null}
                            </div>

                            <div className="ch-prompt-card__actions" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                className={`ch-prompt-icon-btn ch-prompt-btn--copy${isCopied ? " is-copied" : ""}`}
                                title={isCopied ? "已复制" : "复制"}
                                aria-label={isCopied ? "已复制" : "复制"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void copyPrompt(entry.item);
                                }}
                              >
                                <i className={`bi ${isCopied ? "bi-check2" : "bi-copy"}`} aria-hidden="true" />
                                <span className="ch-prompt-icon-btn__label">{isCopied ? "已复制" : "复制"}</span>
                              </button>

                              <button
                                type="button"
                                className={`ch-prompt-icon-btn ch-prompt-btn--fav${entry.item.favorited ? " is-favorited" : ""}`}
                                title={entry.item.favorited ? "已收藏" : "收藏"}
                                aria-label={entry.item.favorited ? "已收藏" : "收藏"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void toggleFavorite(entry.item);
                                }}
                              >
                                <i className={`bi ${entry.item.favorited ? "bi-heart-fill" : "bi-heart"}`} aria-hidden="true" />
                                <span className="ch-prompt-icon-btn__label">{entry.item.favorited ? "已收藏" : "收藏"}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {hasMore || loadingMore ? (
            <div ref={loadSentinelRef} className="ch-more" aria-live="polite">
              {loadingMore ? <span className="ch-more__hint">加载中…</span> : null}
            </div>
          ) : null}
        </section>
      </div>

      <DialogMotion
        open={Boolean(preview)}
        variant="detail"
        layerClassName="ch-preview-layer"
        panelClassName="ch-preview"
        panelRef={previewPanelRef}
        ariaLabel="提示词详情"
        onClose={closePreview}
        onExited={() => setPreviewMotionPresent(false)}
        layerExtras={preview ? () => (
          <>
              <button
                type="button"
                className="ch-preview__nav is-prev"
                disabled={!hasPreviewPrev}
                aria-label="上一条"
                onClick={() => showPreviewAt(previewIndex - 1)}
              >
                <i className="bi bi-chevron-left" aria-hidden="true" />
              </button>
              <button
                type="button"
                className="ch-preview__nav is-next"
                disabled={!hasPreviewNext}
                aria-label="下一条"
                onClick={() => showPreviewAt(previewIndex + 1)}
              >
                <i className="bi bi-chevron-right" aria-hidden="true" />
              </button>
          </>
        ) : null}
      >
        {preview ? (
          <>
                <div className="ch-preview__media">
                  {preview.coverUrl || preview.imageUrl ? (
                    <img
                      src={preview.coverUrl || preview.imageUrl}
                      alt={preview.title || "提示词"}
                      loading="eager"
                      decoding="async"
                      fetchPriority="high"
                    />
                  ) : (
                    <div className="ch-preview__empty">暂无预览图</div>
                  )}
                </div>
                <aside className="ch-preview__body">
                  <div className="ch-preview__top">
                    <div className="ch-card__meta">
                      <span className="ch-pill">
                        {preview.category || activeTypeLabel}
                      </span>
                      {preview.useCount ? (
                        <span className="ch-pill">
                          <i className="bi bi-lightning-charge" aria-hidden="true" />
                          {preview.useCount}
                        </span>
                      ) : null}
                      {preview.favoriteCount ? (
                        <span className="ch-pill">
                          <i className="bi bi-heart" aria-hidden="true" />
                          {preview.favoriteCount}
                        </span>
                      ) : null}
                    </div>
                    <h2 className="ch-card__title" style={{ marginTop: 10 }}>
                      {preview.title || preview.label || "未命名灵感"}
                    </h2>
                  </div>
                  <div className="ch-preview__mid">
                    <p className="ch-preview__prompt" data-no-translate>
                      {preview.prompt || "暂无提示词"}
                    </p>
                  </div>
                  <div className="ch-preview__bottom">
                    <div className="ch-card__actions">
                      {preview.prompt ? (
                        <button
                          type="button"
                          className="is-primary"
                          onClick={() => void copyPrompt(preview)}
                        >
                          复制提示词
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void usePrompt(preview)}
                      >
                        去做图
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleFavorite(preview)}
                      >
                        {preview.favorited ? "已收藏" : "收藏"}
                      </button>
                      <button type="button" onClick={closePreview}>
                        关闭
                      </button>
                    </div>
                  </div>
                </aside>
          </>
        ) : null}
      </DialogMotion>
    </main>
  );
}
