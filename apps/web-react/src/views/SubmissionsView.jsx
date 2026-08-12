import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import {
  deleteMyGallerySubmission,
  listMyGallerySubmissions,
} from "@legacy/services/meApi.js";
import notificationService from "@legacy/services/notification.js";
import "@react/legacy-styles/generated/views/SubmissionsView.css";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { OptimizedImage } from "../components/OptimizedImage.jsx";
import { ProfileSectionShell } from "../components/ProfileSectionShell.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import "./SubmissionsView.css";

const STATUS_LABELS = {
  pending: "审核中",
  approved: "已通过",
  rejected: "已拒绝",
  removed: "已下架",
};

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function SubmissionsView() {
  const isDark = useIsDark();
  const mountedRef = useRef(true);
  const controllerRef = useRef(null);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const cursorRef = useRef(null);
  const itemsRef = useRef([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);

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
          limit: 12,
          cursor: append ? cursorRef.current || "" : "",
          signal: controller.signal,
        });
        if (!mountedRef.current || controller.signal.aborted) return;
        applyItems(
          append ? [...itemsRef.current, ...result.items] : result.items,
        );
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
    void loadList();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [loadList]);

  const confirmDelete = async () => {
    const submission = pendingDelete;
    setPendingDelete(null);
    if (!submission) return;
    try {
      await deleteMyGallerySubmission(submission.id);
      if (!mountedRef.current) return;
      applyItems(itemsRef.current.filter((item) => item.id !== submission.id));
      notificationService.success("投稿已删除");
    } catch (deleteError) {
      if (mountedRef.current)
        notificationService.error(deleteError?.message || "删除失败");
    }
  };

  const empty = loaded && !loading && !items.length;
  const actions = (
    <button
      type="button"
      className="ps-btn is-ghost"
      disabled={loading}
      onClick={() => loadList()}
    >
      <i className={`bi bi-arrow-repeat${loading ? " spin" : ""}`} />
      刷新
    </button>
  );

  return (
    <div className={`ps-page ${isDark ? "is-dark" : "is-light"}`}>
      <div className="ps-atmosphere" aria-hidden="true">
        <div className="ps-atmosphere__wash" />
      </div>
      <ProfileSectionShell
        title="我的投稿"
        description="查看画廊投稿与审核进度。"
        actions={actions}
      >
        {loading && !items.length ? (
          <div className="ps-skel" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="ps-skel__row" />
            ))}
          </div>
        ) : error && !items.length ? (
          <div className="ps-empty is-error">
            <strong>投稿列表读取失败</strong>
            <p>{error}</p>
            <button
              type="button"
              className="ps-btn is-ghost"
              onClick={() => loadList()}
            >
              重试
            </button>
          </div>
        ) : items.length ? (
          <ul className="ps-submission-list">
            {items.map((submission) => (
              <li key={submission.id}>
                {(submission.coverUrl || submission.mediaUrls?.length > 0) && (
                  <OptimizedImage
                    src={submission.coverUrl || submission.mediaUrls[0]}
                    alt=""
                    loading="lazy"
                    rootMargin="480px 0px"
                  />
                )}
                <div className="ps-submission__body">
                  <strong>{submission.title || "AI 作品"}</strong>
                  <small>{formatTime(submission.createdAt)}</small>
                  {submission.rejectReason && (
                    <p className="ps-submission__reason">
                      原因：{submission.rejectReason}
                    </p>
                  )}
                </div>
                <span
                  className="ps-submission__status"
                  data-status={submission.status}
                >
                  {STATUS_LABELS[submission.status] || submission.status}
                </span>
                <button
                  type="button"
                  className="ps-submission__remove"
                  title="撤回/删除"
                  onClick={() => setPendingDelete(submission)}
                >
                  <i className="bi bi-trash3" />
                </button>
              </li>
            ))}
          </ul>
        ) : empty ? (
          <div className="ps-empty">
            <i className="bi bi-send" aria-hidden="true" />
            <strong>还没有投稿</strong>
            <p>可在创作历史里把成功任务投稿到画廊。</p>
            <Link className="ps-btn is-ghost" to="/history">
              打开创作历史
            </Link>
          </div>
        ) : null}
        {cursor && (
          <button
            type="button"
            className="ps-btn is-ghost ps-more"
            disabled={loadingMore}
            onClick={() => loadList({ append: true })}
          >
            {loadingMore ? "加载中…" : "加载更多"}
          </button>
        )}
      </ProfileSectionShell>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        heading="删除这项投稿？"
        description="投稿将从你的记录中移除；已展示的作品也会从画廊撤下。"
        confirmLabel="确认删除"
        icon="bi-trash3"
        light={!isDark}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
