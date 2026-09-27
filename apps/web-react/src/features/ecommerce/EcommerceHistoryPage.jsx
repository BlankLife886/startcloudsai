import { useEffect, useRef, useState } from "react";
import { AuthenticatedImage } from "../../components/AuthenticatedImage.jsx";

// 电商历史：按天分段、按批次成行
export function historyRowTime(row) {
  const value =
    row?.task?.params?.batchCreatedAt || row?.task?.createdAt || "";
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

export function historyDayLabel(time) {
  if (!time) return "更早";
  const day = new Date(time);
  const today = new Date();
  const start = (date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((start(today) - start(day)) / 86400000);
  if (diff === 0) return "今天";
  if (diff === 1) return "昨天";
  return day.getFullYear() === today.getFullYear()
    ? `${day.getMonth() + 1}月${day.getDate()}日`
    : `${day.getFullYear()}年${day.getMonth() + 1}月${day.getDate()}日`;
}

export function historyTimeLabel(time) {
  if (!time) return "";
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function historyShotLabel(row) {
  return String(row?.task?.params?.viewLabel || "")
    .split(" · ")
    .slice(1)
    .join(" · ");
}

export function groupHistoryByDay(rows = []) {
  const days = [];
  const dayByKey = new Map();
  const batchById = new Map();
  for (const row of rows) {
    const time = historyRowTime(row);
    const key = historyDayLabel(time);
    let day = dayByKey.get(key);
    if (!day) {
      day = { key, label: key, batches: [] };
      dayByKey.set(key, day);
      days.push(day);
    }
    const id = String(row.groupId || row.url);
    let batch = batchById.get(id);
    if (!batch) {
      batch = { id, at: time, rows: [] };
      batchById.set(id, batch);
      day.batches.push(batch);
    }
    batch.rows.push(row);
  }
  for (const day of days)
    for (const batch of day.batches)
      batch.rows.sort((a, b) => (a.index || 0) - (b.index || 0));
  return days;
}

export function historyAspect(row) {
  const [w, h] = String(row?.aspectRatio || row?.task?.params?.aspectRatio || "")
    .split(":")
    .map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : "3 / 4";
}

// 电商生成历史：按天分段，每次生成一张卡片；图片按原始比例完整显示，
// 点击看大图，滚到底自动加载下一页，缩略图进入可视区才加载。
export function EcommerceHistoryPage({
  title,
  rows = [],
  loading = false,
  error = "",
  hasMore = false,
  onLoadMore,
  onRefresh,
  onOpen,
  onDownload,
  onDownloadBatch,
  onDelete,
  onStart,
  modeLabelOf,
  modeIconOf,
  emptyLabel = "",
}) {
  const [scroller, setScroller] = useState(null);
  const [busy, setBusy] = useState("");
  const sentinelRef = useRef(null);
  const loadMoreRef = useRef(onLoadMore);
  loadMoreRef.current = onLoadMore;
  const days = groupHistoryByDay(rows);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !scroller || !hasMore || loading) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current?.();
      },
      { root: scroller, rootMargin: "400px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [scroller, hasMore, loading, rows.length]);

  async function run(key, task) {
    if (busy) return;
    setBusy(key);
    try {
      await task();
    } catch {
      /* 下载工具自带失败通知 */
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="history-page">
      <header className="history-page__head">
        <span className="history-page__icon" aria-hidden="true">
          <i className="bi bi-clock-history" />
        </span>
        <div className="history-page__title">
          <h2>{title}</h2>
          <p>
            {rows.length ? `共 ${rows.length}${hasMore ? "+" : ""} 张 · 点击图片查看大图` : "成品会自动保存在这里"}
          </p>
        </div>
        <button
          type="button"
          className="history-page__refresh"
          aria-label="刷新历史"
          onClick={onRefresh}
        >
          <i className={`bi bi-arrow-clockwise${loading ? " is-spin" : ""}`} />
        </button>
      </header>

      <div className="history-page__body" ref={setScroller}>
        {error ? (
          <div className="workspace-library__inline-error" role="alert">
            <span>
              <i className="bi bi-exclamation-circle" />
              {error}
            </span>
            <button type="button" onClick={onRefresh}>
              <i className="bi bi-arrow-clockwise" />
              重试
            </button>
          </div>
        ) : null}

        {rows.length ? (
          days.map((day) => (
            <section key={day.key} className="history-day">
              <h3 className="history-day__title">
                {day.label}
                <span>
                  {day.batches.reduce((sum, batch) => sum + batch.rows.length, 0)} 张
                </span>
              </h3>
              {day.batches.map((batch) => (
                <article key={batch.id} className="history-batch">
                  <header className="history-batch__head">
                    <span className="history-batch__mode">
                      <i className={`bi ${modeIconOf(batch.rows[0])}`} aria-hidden="true" />
                      {modeLabelOf(batch.rows[0])}
                    </span>
                    <span className="history-batch__meta">
                      {batch.rows.length} 张 · {historyTimeLabel(batch.at)}
                    </span>
                    {batch.rows.length > 1 ? (
                      <button
                        type="button"
                        className="history-batch__download"
                        disabled={Boolean(busy)}
                        onClick={() => run(batch.id, () => onDownloadBatch(batch.rows))}
                      >
                        <i
                          className={`bi ${busy === batch.id ? "bi-arrow-repeat is-spin" : "bi-download"}`}
                          aria-hidden="true"
                        />
                        {busy === batch.id ? "打包中" : "下载全部"}
                      </button>
                    ) : null}
                  </header>
                  <div className="history-batch__strip">
                    {batch.rows.map((row) => {
                      const label = modeLabelOf(row);
                      const shot = historyShotLabel(row);
                      return (
                        <figure key={row.url} className="asset-card history-shot">
                          <button
                            type="button"
                            className="history-shot__media"
                            // 按任务记录的出图比例预留宽度，图片加载前后不跳动
                            style={{ aspectRatio: historyAspect(row) }}
                            aria-label={`查看大图：${shot || label}`}
                            onClick={() => onOpen(row)}
                          >
                            <AuthenticatedImage
                              src={row.preview || row.url}
                              fallbackSrc={row.url}
                              alt={shot || label}
                              loading="lazy"
                              observerRoot={scroller}
                              maxDimension={480}
                            />
                          </button>
                          <div className="history-shot__tools">
                            <button
                              type="button"
                              title="下载"
                              aria-label="下载"
                              disabled={Boolean(busy)}
                              onClick={() => run(row.url, () => onDownload(row))}
                            >
                              <i
                                className={`bi ${busy === row.url ? "bi-arrow-repeat is-spin" : "bi-download"}`}
                              />
                            </button>
                            <button
                              type="button"
                              className="danger"
                              title="删除"
                              aria-label={`删除${label}历史记录`}
                              onClick={() => onDelete(row)}
                            >
                              <i className="bi bi-trash3" />
                            </button>
                          </div>
                          {shot ? <figcaption className="history-shot__label">{shot}</figcaption> : null}
                        </figure>
                      );
                    })}
                  </div>
                </article>
              ))}
            </section>
          ))
        ) : !error && !loading ? (
          <div className="workspace-empty">
            <span>
              <i className="bi bi-clock-history" />
            </span>
            <strong>还没有{emptyLabel}记录</strong>
            <small>完成生成后，成品会自动保存在这里</small>
            <button type="button" onClick={onStart}>
              开始创作
            </button>
          </div>
        ) : null}

        {hasMore ? (
          <div ref={sentinelRef} className={`history-page__more${loading ? " is-loading" : ""}`}>
            <i className="bi bi-arrow-repeat is-spin" aria-hidden="true" />
            加载更多
          </div>
        ) : rows.length ? (
          <div className="history-page__end">已经到底了</div>
        ) : null}
      </div>
    </section>
  );
}
