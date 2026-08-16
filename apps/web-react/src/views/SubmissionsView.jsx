import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import {
  deleteMyGallerySubmission,
  listMyGallerySubmissions,
} from "@react/legacy-modules/services/meApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import { TASK_TYPE_LABELS } from "@react/legacy-modules/services/tasksApi.js";
import { setBodyScrollLock } from "@react/legacy-modules/utils/bodyScrollLock.js";
import "@react/legacy-static/features/creator-hub/creator-hub.css";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { useVirtualMasonryFeed } from "../features/prompts/useVirtualMasonryFeed.js";
import { useIsDark } from "../hooks/useIsDark.js";
import "./SubmissionsView.css";

const PREVIEW_LOCK = "submissions-preview";
const LAYOUT_KEY = "starclouds:submissions-layout";
const STATUS_LABELS = {
  pending: "审核中",
  approved: "已通过",
  rejected: "已拒绝",
  removed: "已下架",
};
const STATUS_FILTERS = [
  ["", "全部状态"],
  ["pending", "审核中"],
  ["approved", "已通过"],
  ["rejected", "已拒绝"],
  ["removed", "已下架"],
];
function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

function coverOf(submission) {
  return submission?.coverUrl || submission?.mediaUrls?.[0] || "";
}

function typeLabel(submission) {
  return TASK_TYPE_LABELS[submission?.taskType] || "创作";
}

function readStoredLayout() {
  const columns = Number(localStorage.getItem(LAYOUT_KEY) || 4);
  return [3, 4, 6, 8].includes(columns) ? columns : 4;
}

function matchesQuery(submission, query) {
  if (!query) return true;
  const haystack = [
    submission.title,
    typeLabel(submission),
    STATUS_LABELS[submission.status] || submission.status,
    submission.rejectReason,
    ...(Array.isArray(submission.tags) ? submission.tags : []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export function SubmissionsView() {
  const isDark = useIsDark();
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const cursorRef = useRef(null);
  const itemsRef = useRef([]);
  const loadedCoverKeysRef = useRef(new Set());
  const pageRef = useRef(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [statusMenu, setStatusMenu] = useState(false);
  const [gridColumns, setGridColumns] = useState(readStoredLayout);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingIds, setPendingIds] = useState(null);
  const [preview, setPreview] = useState(null);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    return items.filter(
      (item) =>
        (!statusFilter || item.status === statusFilter) &&
        matchesQuery(item, query),
    );
  }, [items, search, statusFilter]);

  const masonryItems = useMemo(
    () =>
      visibleItems.map((item, index) => ({
        key: String(item.id),
        item,
        index,
        aspect: 3 / 4,
      })),
    [visibleItems],
  );
  const masonry = useVirtualMasonryFeed({
    items: masonryItems,
    fallbackAspect: 3 / 4,
    bodyHeight: 102,
    minColumnWidth: 132,
    maxColumns: gridColumns,
    overscan: 2400,
    getAspect: () => 3 / 4,
  });

  const applyItems = useCallback((next) => {
    itemsRef.current = next;
    if (mountedRef.current) setItems(next);
  }, []);

  const applyCursor = useCallback((next) => {
    cursorRef.current = next || null;
    if (mountedRef.current) setCursor(next || null);
  }, []);

  const loadList = useCallback(
    async ({ append = false } = {}) => {
      if (append) {
        if (loadingMoreRef.current || !cursorRef.current) return;
        loadingMoreRef.current = true;
        if (mountedRef.current) setLoadingMore(true);
      } else {
        if (loadingRef.current) controllerRef.current?.abort();
        loadingRef.current = true;
        if (mountedRef.current) {
          setLoading(true);
          setError("");
        }
      }
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const result = await listMyGallerySubmissions({
          limit: 24,
          cursor: append ? cursorRef.current || "" : "",
          signal: controller.signal,
        });
        if (!mountedRef.current || controller.signal.aborted) return;
        applyItems(append ? [...itemsRef.current, ...result.items] : result.items);
        applyCursor(result.nextCursor);
        setLoaded(true);
      } catch (loadError) {
        if (loadError?.name !== "AbortError" && mountedRef.current) {
          const message = loadError?.message || "投稿列表读取失败";
          setError(message);
          if (!append) notificationService.error(message);
        }
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
          loadingRef.current = false;
          loadingMoreRef.current = false;
          if (mountedRef.current) {
            setLoading(false);
            setLoadingMore(false);
          }
        }
      }
    },
    [applyCursor, applyItems],
  );

  useEffect(() => {
    mountedRef.current = true;
    loadingRef.current = false;
    document.documentElement.classList.add("creator-hub-sticky-page");
    void loadList();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      document.documentElement.classList.remove("creator-hub-sticky-page");
      setBodyScrollLock(PREVIEW_LOCK, false);
    };
  }, [loadList]);

  const revealCover = useCallback((id, event) => {
    loadedCoverKeysRef.current.add(id);
    event.currentTarget.classList.add("is-loaded");
  }, []);

  const setLayout = (columns) => {
    setGridColumns(columns);
    localStorage.setItem(LAYOUT_KEY, String(columns));
  };

  const toggleSelected = (id) => {
    const key = String(id);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openPreview = useCallback((submission) => {
    setPreview(submission);
    setBodyScrollLock(PREVIEW_LOCK, true);
  }, []);

  const closePreview = useCallback(() => {
    setPreview(null);
    setBodyScrollLock(PREVIEW_LOCK, false);
  }, []);

  const previewIndex = preview
    ? visibleItems.findIndex((item) => String(item.id) === String(preview.id))
    : -1;

  const removeItems = async (ids) => {
    const targets = ids.map(String);
    if (!targets.length) return;
    const failed = [];
    for (const id of targets) {
      try {
        await deleteMyGallerySubmission(id);
      } catch {
        failed.push(id);
      }
    }
    if (!mountedRef.current) return;
    applyItems(itemsRef.current.filter((item) => !targets.includes(String(item.id)) || failed.includes(String(item.id))));
    setSelectedIds(new Set());
    if (preview && targets.includes(String(preview.id)) && !failed.includes(String(preview.id))) {
      closePreview();
    }
    if (failed.length) notificationService.error("部分投稿删除失败");
    else notificationService.success(targets.length > 1 ? "投稿已删除" : "投稿已删除");
  };

  const confirmDelete = async () => {
    const single = pendingDelete;
    const ids = pendingIds;
    setPendingDelete(null);
    setPendingIds(null);
    if (single) await removeItems([single.id]);
    else if (ids?.length) await removeItems(ids);
  };

  const empty = loaded && !loading && !items.length;
  const filteredEmpty = loaded && !loading && items.length && !visibleItems.length;

  return (
    <main
      ref={pageRef}
      className="ch-page ch-page--history ch-page--submissions ps-page"
    >
      <div className="ch-shell">
        <div className="ch-sticky-bar">
          <div className="ch-toolbar">
            <label className="ch-search">
              <i className="bi bi-search" aria-hidden="true" />
              <input
                value={search}
                type="search"
                placeholder="搜索标题或标签"
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div className={`ch-menu${statusMenu ? " is-open" : ""}`}>
              <button
                type="button"
                className="ch-menu__trigger"
                aria-label="状态筛选"
                aria-expanded={statusMenu}
                onClick={() => setStatusMenu(!statusMenu)}
              >
                <span>
                  {STATUS_FILTERS.find(([id]) => id === statusFilter)?.[1]}
                </span>
                <i className="bi bi-chevron-down" />
              </button>
              {statusMenu && (
                <ul className="ch-menu__panel" role="listbox">
                  {STATUS_FILTERS.map(([id, label]) => (
                    <li
                      key={id || "all"}
                      className={`ch-menu__option${statusFilter === id ? " is-active" : ""}`}
                      onClick={() => {
                        setStatusFilter(id);
                        setStatusMenu(false);
                      }}
                    >
                      <span>{label}</span>
                      {statusFilter === id && <i className="bi bi-check2" />}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="ch-bulk-bar">
              <button
                type="button"
                className={`ch-chip${selectMode ? " is-active" : ""}`}
                onClick={() => {
                  setSelectMode(!selectMode);
                  setSelectedIds(new Set());
                }}
              >
                {selectMode ? "退出多选" : "多选"}
              </button>
              {selectMode ? (
                <>
                  <button
                    type="button"
                    className="ch-chip"
                    onClick={() =>
                      setSelectedIds(new Set(visibleItems.map((item) => String(item.id))))
                    }
                  >
                    全选当前
                  </button>
                  <button
                    type="button"
                    className="ch-chip is-danger"
                    disabled={!selectedIds.size}
                    onClick={() => setPendingIds([...selectedIds])}
                  >
                    删除所选{selectedIds.size ? ` (${selectedIds.size})` : ""}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                className="ch-chip"
                disabled={loading}
                onClick={() => loadList()}
              >
                <i className={`bi bi-arrow-repeat${loading ? " spin" : ""}`} />
                刷新
              </button>
            </div>
            <div className="ch-layout-switch">
              <span>布局</span>
              {[3, 4, 6, 8].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={gridColumns === count ? "is-active" : ""}
                  aria-label={`${count} 列布局`}
                  onClick={() => setLayout(count)}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="ch-section">
          {loading && !items.length ? (
            <div className="ch-loading">正在加载投稿…</div>
          ) : error && !items.length ? (
            <div className="ch-empty">
              <strong>投稿列表读取失败</strong>
              <span>{error}</span>
              <button type="button" className="ch-btn" onClick={() => loadList()}>
                重试
              </button>
            </div>
          ) : empty ? (
            <div className="ch-empty">
              <strong>还没有投稿</strong>
              <span>可在创作历史里把成功任务投稿到画廊。</span>
              <Link className="ch-btn is-primary" to="/history">
                打开创作历史
              </Link>
            </div>
          ) : filteredEmpty ? (
            <div className="ch-empty">
              <strong>没有符合条件的投稿</strong>
              <span>换个关键词或筛选后再试。</span>
            </div>
          ) : (
            <ul
              ref={masonry.containerRef}
              className={`ps-submission-list ch-history-masonry${gridColumns >= 6 ? " is-dense" : ""}`}
              style={{ height: masonry.totalHeight || 1 }}
            >
              {masonry.visibleItems.map((entry) => {
                const submission = entry.item;
                const cover = coverOf(submission);
                const loadedCover = loadedCoverKeysRef.current.has(submission.id);
                const selected = selectedIds.has(String(submission.id));
                return (
                  <li
                    key={entry.key}
                    data-submission-id={entry.key}
                    className={`ch-card ch-history-masonry__item${selected ? " is-selected" : ""}${selectMode ? " is-selecting" : ""}`}
                    style={{
                      width: `${entry.width}px`,
                      height: `${entry.height}px`,
                      transform: `translate3d(${entry.left}px, ${entry.top}px, 0)`,
                    }}
                  >
                    {selectMode ? (
                      <button
                        type="button"
                        className="ch-card__check"
                        aria-pressed={selected}
                        onClick={() => toggleSelected(submission.id)}
                      >
                        <i
                          className={`bi ${selected ? "bi-check-circle-fill" : "bi-circle"}`}
                        />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="ch-card__media ch-prompt-card__media"
                      style={{ height: `${entry.mediaHeight}px` }}
                      onClick={() =>
                        selectMode
                          ? toggleSelected(submission.id)
                          : openPreview(submission)
                      }
                    >
                      {cover ? (
                        <img
                          className={`ch-prompt-card__image${loadedCover ? " is-loaded" : ""}`}
                          src={cover}
                          alt={submission.title || "AI 作品"}
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
                          onLoad={(event) => revealCover(submission.id, event)}
                          onError={(event) => revealCover(submission.id, event)}
                        />
                      ) : (
                        <div className="ch-card__placeholder">
                          <i className="bi bi-image" aria-hidden="true" />
                          {submission.title || "AI 作品"}
                        </div>
                      )}
                    </button>
                    <div className="ch-card__overlay">
                      <span className="ch-card__overlay-start">
                        <span className="ch-card__tag">{typeLabel(submission)}</span>
                      </span>
                      <span className="ch-card__overlay-end">
                        <span
                          className="ps-submission__status ch-card__share"
                          data-status={submission.status}
                        >
                          {STATUS_LABELS[submission.status] || submission.status}
                        </span>
                      </span>
                    </div>
                    <div className="ch-card__body">
                      <p className="ch-card__prompt">
                        {submission.title || "AI 作品"}
                      </p>
                      {submission.rejectReason ? (
                        <p className="ps-submission__reason ch-card__file-meta">
                          原因：{submission.rejectReason}
                        </p>
                      ) : (
                        <span className="ch-card__file-meta">
                          {formatTime(submission.createdAt)}
                        </span>
                      )}
                      <div className="ch-card__actions is-icon-row">
                        <button
                          type="button"
                          className="ps-submission__remove"
                          title="撤回/删除"
                          onClick={() => setPendingDelete(submission)}
                        >
                          <i className="bi bi-trash3" />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {cursor ? (
            <button
              type="button"
              className="ch-btn ps-more"
              disabled={loadingMore}
              onClick={() => loadList({ append: true })}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </button>
          ) : null}
        </section>
      </div>
      <DialogMotion
        open={Boolean(preview)}
        variant="detail"
        layerClassName="ch-preview-layer"
        panelClassName="ch-preview"
        ariaLabel="投稿预览"
        onClose={closePreview}
        onExited={() => setBodyScrollLock(PREVIEW_LOCK, false)}
        layerExtras={
          preview
            ? () => (
                <>
                  <button
                    type="button"
                    className="ch-preview__nav is-prev"
                    disabled={previewIndex <= 0}
                    onClick={() => setPreview(visibleItems[previewIndex - 1])}
                  >
                    <i className="bi bi-chevron-left" />
                  </button>
                  <button
                    type="button"
                    className="ch-preview__nav is-next"
                    disabled={
                      previewIndex < 0 || previewIndex >= visibleItems.length - 1
                    }
                    onClick={() => setPreview(visibleItems[previewIndex + 1])}
                  >
                    <i className="bi bi-chevron-right" />
                  </button>
                </>
              )
            : null
        }
      >
        {preview ? (
          <>
            <div className="ch-preview__media">
              {coverOf(preview) ? (
                <img
                  src={coverOf(preview)}
                  alt={preview.title || "AI 作品"}
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
                  <span className="ch-pill">{typeLabel(preview)}</span>
                  <span className="ch-pill is-share" data-status={preview.status}>
                    {STATUS_LABELS[preview.status] || preview.status}
                  </span>
                  <span className="ch-pill">{formatTime(preview.createdAt)}</span>
                </div>
              </div>
              <div className="ch-preview__mid">
                <p className="ch-preview__prompt">{preview.title || "AI 作品"}</p>
                {preview.rejectReason ? (
                  <p className="ps-submission__reason">
                    原因：{preview.rejectReason}
                  </p>
                ) : null}
              </div>
              <div className="ch-preview__bottom">
                <div className="ch-card__actions">
                  <button type="button" onClick={() => setPendingDelete(preview)}>
                    撤回/删除
                  </button>
                </div>
              </div>
            </aside>
          </>
        ) : null}
      </DialogMotion>
      <ConfirmDialog
        open={Boolean(pendingDelete || pendingIds?.length)}
        heading={pendingIds?.length > 1 ? "删除选中的投稿？" : "删除这项投稿？"}
        description="投稿将从你的记录中移除；已展示的作品也会从画廊撤下。"
        confirmLabel="确认删除"
        icon="bi-trash3"
        light={!isDark}
        onConfirm={confirmDelete}
        onClose={() => {
          setPendingDelete(null);
          setPendingIds(null);
        }}
      />
    </main>
  );
}
