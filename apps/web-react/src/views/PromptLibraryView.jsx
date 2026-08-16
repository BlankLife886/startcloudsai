import {
  useCallback,
  useEffect,
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
  const rootRef = useRef(null);
  const requestIdRef = useRef(0);
  const loadSentinelRef = useRef(null);
  const previewPanelRef = useRef(null);
  const previewInertiaCleanupRef = useRef(null);
  const [previewMotionPresent, setPreviewMotionPresent] = useState(false);

  const stopPreviewInertiaGuard = useCallback(() => {
    previewInertiaCleanupRef.current?.();
    previewInertiaCleanupRef.current = null;
  }, []);

  const startPreviewInertiaGuard = useCallback(
    (duration = 0, { allowPreviewScroll = false } = {}) => {
      stopPreviewInertiaGuard();
      const shouldBlock = (event) => {
        if (!allowPreviewScroll) return true;
        const scroller =
          event.target?.closest?.(".ch-preview__media") ||
          event.target?.closest?.(".ch-preview__mid");
        if (!scroller) return true;
        if (event.type === "touchmove") return false;
        const { scrollTop, scrollHeight, clientHeight } = scroller;
        const delta = Number(event.deltaY) || 0;
        if (scrollHeight <= clientHeight + 1) return true;
        const atTop = scrollTop <= 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight - 1;
        return (atTop && delta < 0) || (atBottom && delta > 0);
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
    bodyHeight: 178,
    minColumnWidth: 260,
    maxColumns: 12,
    overscan: 960,
    getAspect: getEntryAspect,
  });

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

  useGSAP(
    () => {
      if (!contentRevision || loading) return undefined;
      const root = rootRef.current;
      if (!root) return undefined;
      let firstFrame = 0;
      let secondFrame = 0;
      let animation;
      const reveal = () => {
        const container = root.querySelector(".ch-prompt-masonry");
        const cards = gsap.utils.toArray(".ch-prompt-masonry__item", container || root);
        if (!container || !cards.length) return;
        container.dataset.promptFeedState = "entering";
        if (motionDisabled()) {
          gsap.set(cards, { clearProps: "opacity,visibility" });
          container.dataset.promptFeedState = "entered";
          return;
        }
        animation = gsap.fromTo(
          cards,
          { autoAlpha: 0 },
          {
            autoAlpha: 1,
            duration: 0.34,
            stagger: 0.035,
            ease: "power2.out",
            clearProps: "opacity,visibility",
            onComplete: () => {
              container.dataset.promptFeedState = "entered";
            },
          },
        );
      };
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(reveal);
      });
      return () => {
        window.cancelAnimationFrame(firstFrame);
        window.cancelAnimationFrame(secondFrame);
        animation?.kill();
      };
    },
    { dependencies: [contentRevision, loading], scope: rootRef },
  );

  const revealPromptImage = useCallback((event, key) => {
    masonry.measureFromEvent(key, event);
    const image = event.currentTarget;
    image.classList.add("is-loaded");
    gsap.killTweensOf(image);
    if (motionDisabled()) {
      gsap.set(image, { autoAlpha: 1, clearProps: "transform" });
      return;
    }
    gsap.fromTo(
      image,
      { autoAlpha: 0, scale: 1.015 },
      {
        autoAlpha: 1,
        scale: 1,
        duration: 0.38,
        ease: "power2.out",
        clearProps: "opacity,visibility,transform",
      },
    );
  }, [masonry]);

  const activeTypeLabel =
    PROMPT_TASK_TYPES.find((item) => item.id === activeType)?.label || "文生图";
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
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      setBodyScrollLock(PREVIEW_SCROLL_LOCK, false);
    };
  }, [
    closePreview,
    hasPreviewNext,
    hasPreviewPrev,
    preview,
    previewMotionPresent,
    previewIndex,
    showPreviewAt,
    startPreviewInertiaGuard,
  ]);

  async function copyPrompt(item) {
    const prompt = String(item?.prompt || "").trim();
    if (!prompt) {
      notificationService.info("没有可复制的提示词");
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      notificationService.success("提示词已复制");
    } catch {
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
        <div className="ch-sticky-bar" data-prompt-page-motion>
          <div className="ch-toolbar">
            <label className="ch-search">
              <i className="bi bi-search" aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                type="search"
                placeholder="搜索标题、提示词或标签"
              />
            </label>
          </div>
          <div className="ch-chips" aria-label="工作台">
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
          <div className="ch-chips" aria-label="分类">
            {categoryMeta.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`ch-chip${activeCategory === category.id ? " is-active" : ""}`}
                onClick={() => setActiveCategory(category.id)}
              >
                {category.label}
              </button>
            ))}
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
              {masonry.visibleItems.map((entry) => (
                <article
                  key={entry.key}
                  className="ch-card ch-prompt-masonry__item"
                  style={{
                    width: `${entry.width}px`,
                    height: `${entry.height}px`,
                    transform: `translate3d(${entry.left}px, ${entry.top}px, 0)`,
                  }}
                >
                  <button
                    type="button"
                    className="ch-card__media ch-prompt-card__media"
                    style={{ height: `${entry.mediaHeight}px` }}
                    onClick={() => openPreview(entry.item)}
                  >
                    {entry.cover ? (
                      <img
                        className="ch-prompt-card__image"
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
                        decoding="async"
                        width={Math.max(1, Math.round(entry.width))}
                        height={Math.max(1, entry.mediaHeight)}
                        onLoad={(event) => revealPromptImage(event, entry.key)}
                        onError={(event) => revealPromptImage(event, entry.key)}
                      />
                    ) : (
                      <div className="ch-card__placeholder">
                        <i className="bi bi-quote" aria-hidden="true" />
                        {entry.item.title || "灵感"}
                      </div>
                    )}
                  </button>
                  <div className="ch-card__body">
                    <div className="ch-card__meta">
                      <span className="ch-pill">
                        {entry.item.category || activeTypeLabel}
                      </span>
                      {entry.item.useCount ? (
                        <span className="ch-pill">
                          <i className="bi bi-lightning-charge" aria-hidden="true" />
                          {entry.item.useCount}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="ch-card__title">
                      {entry.item.title || entry.item.label || "未命名灵感"}
                    </h3>
                    <p className="ch-card__prompt" data-no-translate>
                      {entry.item.prompt}
                    </p>
                    <div className="ch-card__actions">
                      <button
                        type="button"
                        className="is-primary"
                        onClick={() => void usePrompt(entry.item)}
                      >
                        去做图
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyPrompt(entry.item)}
                      >
                        复制
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleFavorite(entry.item)}
                      >
                        {entry.item.favorited ? "已收藏" : "收藏"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
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
