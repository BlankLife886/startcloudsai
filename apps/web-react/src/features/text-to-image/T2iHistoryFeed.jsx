import { memo, useEffect, useRef } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";
import { RegenerateIcon } from "../../components/common/RegenerateIcon.jsx";
import { taskFailureMessage } from "../history/taskFailureMessage.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function statusLabel(task) {
  if (task.status === "queued") return "排队中";
  if (task.status === "waiting_provider") return "等待模型响应";
  if (task.status === "running") {
    if (task.generationStage === "preparing") return "正在准备生成";
    if (task.generationStage === "fetching_result") return "正在拉取结果";
    if (task.generationStage === "saving_result") return "正在处理图片";
    return "上游模型正在生成";
  }
  if (task.status === "completed") return "已完成";
  if (task.status === "paused") return "已暂停";
  if (["cancelled", "canceled"].includes(task.status)) {
    return String(task.error || "").includes("停止接收") ? "已停止接收结果" : "已取消";
  }
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
  const sentinelRef = useRef(null);
  const onLoadMoreRef = useRef(onLoadMore);
  onLoadMoreRef.current = onLoadMore;

  useEffect(() => {
    if (!hasMore || loadingMore) return undefined;
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMoreRef.current?.();
      },
      {
        root: scrollRootRef?.current || sentinel.closest(".t2i-panel") || null,
        rootMargin: "520px 0px",
        threshold: 0.01,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, items.length, loadingMore, scrollRootRef]);

  return (
    <div className="t2i-masonry-wrap">
      <div className="t2i-history-grid">
        {items.map((item) => (
          <HistoryCard
            key={item.key}
            item={item}
            isActive={item.task.id === activeTaskId}
            now={ACTIVE_STATUSES.has(item.task.status) ? now : 0}
            onAction={onAction}
          />
        ))}
      </div>
      {hasMore && <div ref={sentinelRef} className="t2i-masonry-sentinel" aria-hidden="true" />}
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
  const failure = task.status === "failed" ? taskFailureMessage(task) : "";
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
            keepLoaded
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
          {failure ? <small className="t2i-history-error" title={failure}>{failure}</small> : null}
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
          <RegenerateIcon />
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
