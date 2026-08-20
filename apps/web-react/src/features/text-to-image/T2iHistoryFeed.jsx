import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);
const GRID_GAP = 10;
const OVERSCAN_ROWS = 2;

function columnCount(width) {
  if (width <= 520) return 2;
  if (width <= 760) return 3;
  if (width <= 1020) return 4;
  return 5;
}

function statusLabel(task) {
  if (task.status === "queued") return "排队中";
  if (task.status === "waiting_provider") return "等待模型响应";
  if (task.status === "running") return "正在生成";
  if (task.status === "completed") return "已完成";
  if (["cancelled", "canceled"].includes(task.status)) return "已取消";
  if (task.status === "failed") return "生成失败";
  return task.status || "处理中";
}

function elapsedLabel(task, now) {
  if (task.status === "queued" || !task.startedAt) return "";
  const started = Date.parse(task.startedAt);
  if (!Number.isFinite(started)) return "";
  const finished = Date.parse(task.finishedAt || "");
  const seconds = Math.max(
    0,
    Math.floor(((Number.isFinite(finished) ? finished : now) - started) / 1000),
  );
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function offsetTopWithin(el, root) {
  const rootRect = root.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  return elRect.top - rootRect.top + root.scrollTop;
}

function estimateRowHeight(innerWidth, cols) {
  const cell = cols > 0 ? (innerWidth - GRID_GAP * (cols - 1)) / cols : innerWidth;
  return Math.round(Math.max(96, cell) + 32);
}

export const T2iHistoryFeed = memo(function T2iHistoryFeed({
  items,
  activeTaskId,
  now = 0,
  onAction,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  scrollRootRef,
}) {
  const gridRef = useRef(null);
  const onLoadMoreRef = useRef(onLoadMore);
  const metricsRef = useRef({ start: 0, end: 0, cols: 5, stride: 180, startRow: 0, rows: 1 });
  const [range, setRange] = useState(() => ({
    start: 0,
    end: 30,
    cols: 5,
    stride: 180,
    startRow: 0,
    rows: 1,
  }));

  onLoadMoreRef.current = onLoadMore;

  const syncRange = useCallback(() => {
    const root = scrollRootRef?.current;
    const grid = gridRef.current;
    if (!root || !grid) return;
    const innerWidth = Math.max(160, grid.clientWidth);
    const cols = columnCount(innerWidth);
    const measured = Math.round(grid.querySelector(".t2i-history-card")?.getBoundingClientRect().height || 0);
    const rowHeight = measured > 72 ? measured : estimateRowHeight(innerWidth, cols);
    const stride = rowHeight + GRID_GAP;
    const rows = Math.max(1, Math.ceil(items.length / cols));
    const gridTop = offsetTopWithin(grid, root);
    const startRow = Math.max(0, Math.floor((root.scrollTop - gridTop) / stride) - OVERSCAN_ROWS);
    const visibleRows = Math.ceil(root.clientHeight / stride) + OVERSCAN_ROWS * 2;
    const endRow = Math.min(rows - 1, startRow + visibleRows);
    const next = {
      start: startRow * cols,
      end: Math.min(items.length, (endRow + 1) * cols),
      cols,
      stride,
      startRow,
      rows,
    };
    const prev = metricsRef.current;
    if (
      prev.start === next.start &&
      prev.end === next.end &&
      prev.cols === next.cols &&
      prev.stride === next.stride &&
      prev.rows === next.rows
    ) {
      return;
    }
    metricsRef.current = next;
    setRange(next);
  }, [items.length, scrollRootRef]);

  useLayoutEffect(() => {
    syncRange();
  }, [items.length, syncRange]);

  useEffect(() => {
    const root = scrollRootRef?.current;
    const grid = gridRef.current;
    if (!root) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = globalThis.requestAnimationFrame(() => {
        frame = 0;
        syncRange();
      });
    };
    syncRange();
    root.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(onScroll);
    observer?.observe(root);
    if (grid) observer?.observe(grid);
    return () => {
      if (frame) globalThis.cancelAnimationFrame(frame);
      root.removeEventListener("scroll", onScroll);
      observer?.disconnect();
    };
  }, [scrollRootRef, syncRange]);

  useEffect(() => {
    if (!items.length || !hasMore || loadingMore || range.end < items.length) return;
    onLoadMoreRef.current?.();
  }, [hasMore, items.length, loadingMore, range.end]);

  const visible = items.slice(range.start, range.end);
  const visibleRows = Math.ceil(visible.length / range.cols) || 0;
  const padTop = range.startRow * range.stride;
  const padBottom = Math.max(0, (range.rows - range.startRow - visibleRows) * range.stride);

  return (
    <div className="t2i-masonry-wrap">
      <div
        ref={gridRef}
        className="t2i-history-grid t2i-history-grid--virtual"
        style={{
          "--t2i-history-cols": range.cols,
          paddingTop: padTop,
          paddingBottom: padBottom,
        }}
      >
        {visible.map((item) => (
          <HistoryCard
            key={item.key}
            item={item}
            isActive={item.task.id === activeTaskId}
            now={ACTIVE_STATUSES.has(item.task.status) ? now : 0}
            onAction={onAction}
          />
        ))}
      </div>
      {loadingMore ? (
        <p className="t2i-feed-loading"><i className="bi bi-arrow-repeat spin" />正在加载更多历史记录…</p>
      ) : hasMore ? (
        <button type="button" className="t2i-feed-more" onClick={() => onLoadMoreRef.current?.()}>加载更多</button>
      ) : (
        <p className="t2i-feed-end">没有更多记录了</p>
      )}
    </div>
  );
});

const HistoryCard = memo(function HistoryCard({ item, isActive, now, onAction }) {
  const task = item.task;
  const running = ACTIVE_STATUSES.has(task.status);
  const elapsed = elapsedLabel(task, now);
  return (
    <article
      className={`t2i-history-card${isActive ? " is-active" : ""}`}
      data-status={task.status}
    >
      {item.kind === "image" ? (
        <button type="button" className="t2i-masonry-cover" onClick={() => onAction("open", item)}>
          <AuthenticatedImage
            src={item.displayUrl || item.url}
            fallbackSrc={item.url}
            alt=""
            loading="eager"
            onError={() => onAction("error", item)}
          />
          {item.total > 1 && (
            <span className="t2i-history-batch-index">{Number(item.batchIndex || 0) + 1}/{item.total}</span>
          )}
          <span className="t2i-history-image-overlay">
            <span className="t2i-history-image-prompt">{task.prompt}</span>
            <span className="t2i-history-image-specs">
              <span><i className="bi bi-aspect-ratio" />{task.actualOutputSize || task.outputSize || task.aspectRatio}</span>
              <span><i className="bi bi-clock" />{elapsed || statusLabel(task)}</span>
            </span>
          </span>
        </button>
      ) : (
        <div className="t2i-masonry-cover t2i-masonry-placeholder" data-status={task.status}>
          <i className={`bi ${running ? "bi-arrow-repeat spin" : task.status === "failed" ? "bi-exclamation-triangle" : "bi-image"}`} />
          <span>{statusLabel(task)}</span>
          {task.error ? <small className="t2i-history-error">{task.error}</small> : null}
        </div>
      )}
      <footer className="t2i-entry-actions t2i-history-actions">
        {item.kind === "image" && (
          <button type="button" aria-label="设为参考图" title="设为参考图" onClick={() => onAction("reference", item)}>
            <span className="t2i-icon-reference" />
          </button>
        )}
        <button type="button" aria-label="编辑任务" title="编辑" onClick={() => onAction("edit", item)}>
          <span className="t2i-icon-edit-image" />
        </button>
        <button type="button" aria-label="重新生成" title="重新生成" onClick={() => onAction("regenerate", item)}>
          <span className="t2i-icon-regenerate" />
        </button>
        {running && (
          <button type="button" aria-label="取消任务" title="取消" onClick={() => onAction("cancel", item)}>
            <i className="bi bi-stop-circle" />
          </button>
        )}
        <button type="button" className="is-danger" aria-label="删除任务" title="删除" onClick={() => onAction("delete", item)}>
          <span className="t2i-icon-delete" />
        </button>
      </footer>
    </article>
  );
});
