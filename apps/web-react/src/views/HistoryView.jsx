import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useVirtualMasonryFeed } from "../features/prompts/useVirtualMasonryFeed.js";
import {
  deleteTask,
  listTasks,
  subscribeTask,
  TASK_TYPE_LABELS,
  TASK_UPDATE_EVENT,
} from "@react/legacy-modules/services/tasksApi.js";
import { formatPoints } from "@react/legacy-modules/services/billingApi.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import {
  taskCoverUrl,
  taskDisplayUrl,
  taskOriginalUrl,
  taskThumbnailUrl,
} from "@react/legacy-modules/features/creator-hub/taskMedia.js";
import { isSmartCanvasTask } from "@react/legacy-modules/features/creator-hub/studioTools.js";
import { downloadAuthenticatedMedia } from "@react/legacy-modules/services/authenticatedMedia.js";
import {
  downloadHistoryImagesAsZip,
  readHistoryImageMetadata,
} from "@react/legacy-modules/services/historyMediaTools.js";
import { submitShareItem } from "@react/legacy-modules/services/shareGallery.js";
import { setBodyScrollLock } from "@react/legacy-modules/utils/bodyScrollLock.js";
import "@react/legacy-static/features/creator-hub/creator-hub.css";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { SharePublishDialog } from "../components/SharePublishDialog.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import "./HistoryView.css";

const HISTORY_LAYOUT_KEY = "creation-history-layout-v3";
const HISTORY_PREVIEW_LOCK = "react-creation-history-preview";
const HISTORY_CARD_MEDIA_ASPECT = 4 / 5;
const HISTORY_CARD_BODY_HEIGHT = 40;
const DELETABLE_STATUSES = new Set(["succeeded", "failed", "canceled"]);
const STATUS_LABELS = {
  succeeded: "已完成",
  running: "生成中",
  queued: "排队中",
  failed: "失败",
  canceled: "已取消",
};
const SHARE_STATUS_LABELS = {
  pending: "审核中",
  approved: "已通过",
  rejected: "已拒绝",
  removed: "已下架",
};
const STATUS_FILTERS = [
  ["", "全部状态"],
  ["succeeded", "已完成"],
  ["running", "生成中"],
  ["queued", "排队中"],
  ["failed", "失败"],
];
const CANVAS_SOURCE = "react_canvas";
const TYPE_FILTERS = [
  ["", "全部"],
  [CANVAS_SOURCE, "无限画布"],
  ...Object.entries(TASK_TYPE_LABELS),
];

function matchesTypeFilter(task, typeFilter) {
  if (!typeFilter) return true;
  if (typeFilter === CANVAS_SOURCE) return isSmartCanvasTask(task);
  if (
    (typeFilter === "t2i" || typeFilter === "background_remove") &&
    isSmartCanvasTask(task)
  ) {
    return false;
  }
  return typeFilter === task?.type;
}

function readStoredLayout() {
  const stored = localStorage.getItem(HISTORY_LAYOUT_KEY) || "table:4";
  const columns = Number(stored.split(":")[1]);
  return {
    mode: stored.startsWith("table") ? "table" : "grid",
    columns: [3, 4, 6, 8].includes(columns) ? columns : 4,
  };
}

function taskPrompt(task) {
  return String(
    task?.params?.userPrompt ||
      task?.userPrompt ||
      task?.params?.prompt ||
      task?.prompt ||
      "",
  )
    .replace(/\{argument\b[^{}]*\bdefault="([^"]*)"[^{}]*\}/gi, "$1")
    .replace(/\{argument\b[^{}]*\bdefault='([^']*)'[^{}]*\}/gi, "$1")
    .replace(/\{argument\b[^{}]*\}/gi, "")
    .trim();
}

function cardPromptPreview(text) {
  const raw = String(text || "").trim();
  const chinese = raw.match(/\[中文\]\s*([\s\S]*?)(?=\s*\[English\]|$)/i);
  if (chinese?.[1]?.trim()) return chinese[1].trim();
  return raw.replace(/\s*\[(?:中文|English)\]\s*/gi, " ").trim();
}

function taskTypeLabel(task) {
  if (!task || typeof task !== "object") return "创作";
  return isSmartCanvasTask(task)
    ? "无限画布"
    : TASK_TYPE_LABELS[task?.type] || "创作";
}

function taskShareStatus(task) {
  const status = String(task?.shareSubmissionStatus || "")
    .trim()
    .toLowerCase();
  if (status) return status;
  return task?.shareSubmitted === true ? "pending" : "";
}

function shareStatusLabel(status) {
  return SHARE_STATUS_LABELS[status] || "";
}

function mergeTaskSnapshot(current, incoming) {
  if (!incoming) return current;
  const hasShare =
    incoming.shareSubmitted !== undefined ||
    incoming.shareSubmissionStatus !== undefined;
  return {
    ...incoming,
    shareSubmitted: hasShare
      ? incoming.shareSubmitted === true
      : current?.shareSubmitted === true,
    shareSubmissionStatus: hasShare
      ? String(incoming.shareSubmissionStatus || "").toLowerCase()
      : String(current?.shareSubmissionStatus || "").toLowerCase(),
  };
}

function formatTime(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString("zh-CN", { hour12: false })
    : "—";
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2)
    return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

function isUserDeleted(task) {
  return task?.deletionActor === "user" && Boolean(task?.deletedAt);
}

export function HistoryView() {
  const navigate = useNavigate();
  const isDark = useIsDark();
  const stored = useMemo(readStoredLayout, []);
  const mountedRef = useRef(true);
  const listControllerRef = useRef(null);
  const subscriptionsRef = useRef(new Map());
  const sentinelRef = useRef(null);
  const pageRef = useRef(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [statusMenu, setStatusMenu] = useState(false);
  const [layoutMode, setLayoutMode] = useState(stored.mode);
  const [gridColumns, setGridColumns] = useState(stored.columns);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [preview, setPreview] = useState(null);
  const [metadata, setMetadata] = useState({});
  const metadataPendingRef = useRef(new Set());
  const [failedThumbIds, setFailedThumbIds] = useState(new Set());
  const loadedImageIdsRef = useRef(new Set());
  const [actionBusyIds, setActionBusyIds] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [publishTarget, setPublishTarget] = useState(null);
  const [publishBusy, setPublishBusy] = useState(false);

  const visibleTasks = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tasks
      .filter((task) => task && typeof task === "object")
      .filter(
        (task) =>
          (!statusFilter || task.status === statusFilter) &&
          (!query ||
            `${taskPrompt(task)} ${taskTypeLabel(task)}`
              .toLowerCase()
              .includes(query)),
      )
      .map((task) => ({
        ...task,
        cleanPrompt: taskPrompt(task) || "未填写提示词",
      }));
  }, [search, statusFilter, tasks]);
  const masonryItems = useMemo(
    () =>
      visibleTasks.map((task, index) => ({
        key: String(task.id),
        item: task,
        index,
      })),
    [visibleTasks],
  );
  const masonry = useVirtualMasonryFeed({
    items: masonryItems,
    fallbackAspect: HISTORY_CARD_MEDIA_ASPECT,
    bodyHeight: HISTORY_CARD_BODY_HEIGHT,
    minColumnWidth: 220,
    maxColumns: gridColumns,
    overscan: 280,
    uniformRows: true,
    enabled: layoutMode === "grid",
  });
  const selectedDownloadTasks = visibleTasks.filter(
    (task) => selectedIds.has(String(task.id)) && taskOriginalUrl(task),
  );
  const previewIndex = preview
    ? visibleTasks.findIndex((task) => String(task.id) === String(preview.id))
    : -1;

  const syncSubscriptions = useCallback((rows) => {
    const active = new Set(
      rows
        .filter((task) =>
          ["queued", "running"].includes(String(task.status).toLowerCase()),
        )
        .map((task) => String(task.id)),
    );
    for (const [id, unsubscribe] of subscriptionsRef.current) {
      if (!active.has(id)) {
        unsubscribe();
        subscriptionsRef.current.delete(id);
      }
    }
    for (const id of active) {
      if (subscriptionsRef.current.has(id)) continue;
      subscriptionsRef.current.set(
        id,
        subscribeTask(id, {
          onUpdate: (incoming) => {
            if (!mountedRef.current) return;
            setTasks((current) =>
              current.map((task) =>
                task.id === incoming.id
                  ? mergeTaskSnapshot(task, incoming)
                  : task,
              ),
            );
            if (
              !["queued", "running"].includes(
                String(incoming.status).toLowerCase(),
              )
            ) {
              subscriptionsRef.current.get(id)?.();
              subscriptionsRef.current.delete(id);
            }
          },
        }),
      );
    }
  }, []);

  const loadTasks = useCallback(
    async ({ append = false } = {}) => {
      if (append && (!cursor || loadingMore || loading || bulkBusy)) return;
      if (!append) {
        listControllerRef.current?.abort();
        listControllerRef.current = new AbortController();
        setLoading(true);
      } else setLoadingMore(true);
      try {
        const page = await listTasks({
          type: typeFilter === CANVAS_SOURCE ? "" : typeFilter,
          limit: 24,
          cursor: append ? cursor || "" : "",
          excludeSource:
            typeFilter === "t2i" || typeFilter === "background_remove"
              ? CANVAS_SOURCE
              : "",
          source: typeFilter === CANVAS_SOURCE ? CANVAS_SOURCE : "",
          signal: listControllerRef.current?.signal,
        });
        if (!mountedRef.current) return;
        setTasks((current) => {
          const rows = append
            ? [...current, ...(page.items || [])]
            : page.items || [];
          queueMicrotask(() => mountedRef.current && syncSubscriptions(rows));
          return rows;
        });
        setCursor(page.nextCursor || null);
      } catch (error) {
        if (error?.name !== "AbortError")
          notificationService.error(error?.message || "历史记录读取失败");
      } finally {
        if (mountedRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [bulkBusy, cursor, loading, loadingMore, syncSubscriptions, typeFilter],
  );

  useEffect(() => {
    mountedRef.current = true;
    document.documentElement.classList.add("creator-hub-sticky-page");
    loadTasks();
    const realtime = (event) => {
      const incoming = event?.detail?.task;
      if (!incoming) return;
      setTasks((current) => {
        const index = current.findIndex((task) => task.id === incoming.id);
        const rows =
          index >= 0
            ? current.map((task) =>
                task.id === incoming.id
                  ? mergeTaskSnapshot(task, incoming)
                  : task,
              )
            : matchesTypeFilter(incoming, typeFilter)
              ? [incoming, ...current]
              : current;
        queueMicrotask(() => mountedRef.current && syncSubscriptions(rows));
        return rows;
      });
    };
    window.addEventListener(TASK_UPDATE_EVENT, realtime);
    return () => {
      mountedRef.current = false;
      listControllerRef.current?.abort();
      window.removeEventListener(TASK_UPDATE_EVENT, realtime);
      document.documentElement.classList.remove("creator-hub-sticky-page");
      setBodyScrollLock(HISTORY_PREVIEW_LOCK, false);
      subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      subscriptionsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!sentinelRef.current || !cursor) return undefined;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.some((entry) => entry.isIntersecting) &&
        loadTasks({ append: true }),
      { rootMargin: "160px 0px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, loadTasks]);

  useEffect(() => {
    if (!preview) return undefined;
    setBodyScrollLock(HISTORY_PREVIEW_LOCK, true, { freezeViewport: false });
    const keydown = (event) => {
      if (event.key === "ArrowLeft" && previewIndex > 0)
        setPreview(visibleTasks[previewIndex - 1]);
      if (event.key === "ArrowRight" && previewIndex < visibleTasks.length - 1)
        setPreview(visibleTasks[previewIndex + 1]);
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
    };
  }, [preview, previewIndex, visibleTasks]);

  const resetForType = (value) => {
    setTypeFilter(value);
    setSelectedIds(new Set());
    setSelectMode(false);
    setTasks([]);
    setCursor(null);
    listControllerRef.current?.abort();
    window.setTimeout(() => {
      listControllerRef.current = new AbortController();
      setLoading(true);
      listTasks({
        type: value === CANVAS_SOURCE ? "" : value,
        limit: 24,
        excludeSource:
          value === "t2i" || value === "background_remove" ? CANVAS_SOURCE : "",
        source: value === CANVAS_SOURCE ? CANVAS_SOURCE : "",
        signal: listControllerRef.current.signal,
      })
        .then((page) => {
          if (!mountedRef.current) return;
          setTasks(page.items || []);
          setCursor(page.nextCursor || null);
          syncSubscriptions(page.items || []);
        })
        .catch(
          (error) =>
            error?.name !== "AbortError" &&
            notificationService.error(error?.message || "历史记录读取失败"),
        )
        .finally(() => mountedRef.current && setLoading(false));
    }, 0);
  };

  const coverSrc = (task) =>
    failedThumbIds.has(String(task.id))
      ? taskDisplayUrl(task) || taskOriginalUrl(task)
      : taskThumbnailUrl(task) || taskDisplayUrl(task) || taskOriginalUrl(task);
  const tableCoverSrc = (task) =>
    taskThumbnailUrl(task) || taskDisplayUrl(task) || taskOriginalUrl(task);
  const ensureMetadata = async (task) => {
    const id = String(task?.id || "");
    const url = taskOriginalUrl(task);
    if (!id || !url || metadata[id] || metadataPendingRef.current.has(id))
      return;
    metadataPendingRef.current.add(id);
    try {
      const result = await readHistoryImageMetadata(url);
      if (mountedRef.current)
        setMetadata((current) => ({ ...current, [id]: result }));
    } catch (error) {
      if (mountedRef.current)
        setMetadata((current) => ({
          ...current,
          [id]: { error: error?.message || "读取失败" },
        }));
    } finally {
      metadataPendingRef.current.delete(id);
    }
  };
  const metadataLabel = (task) => {
    if (!taskOriginalUrl(task))
      return isUserDeleted(task)
        ? `用户已删除 ${task.deletedOutputCount || ""} 个产物`.trim()
        : "无原图信息";
    const value = metadata[String(task.id)];
    if (!value)
      return metadataPendingRef.current.has(String(task.id))
        ? "读取原图信息…"
        : "原图信息待读取";
    return value.error
      ? "原图信息不可用"
      : `${value.width}×${value.height} · ${formatBytes(value.bytes)} · ${value.transparent ? "透明图" : "不透明"}`;
  };
  const revealHistoryImage = (task, event) => {
    const key = String(task.id);
    const image = event?.currentTarget;
    const root = image?.closest?.(".authenticated-image") || image;
    loadedImageIdsRef.current.add(key);
    root?.classList.add("is-loaded");
  };
  const recoverHistoryImage = (task, event) => {
    const key = String(task.id);
    const display = taskDisplayUrl(task);
    const original = taskOriginalUrl(task);
    if (
      !failedThumbIds.has(key) &&
      display &&
      original &&
      display !== original
    ) {
      loadedImageIdsRef.current.delete(key);
      setFailedThumbIds((current) => new Set(current).add(key));
      return;
    }
    revealHistoryImage(task, event);
  };
  const setLayout = (mode, columns = gridColumns) => {
    setLayoutMode(mode);
    setGridColumns(columns);
    localStorage.setItem(HISTORY_LAYOUT_KEY, `${mode}:${columns}`);
    if (mode === "table") visibleTasks.slice(0, 24).forEach(ensureMetadata);
  };
  const toggleSelected = (id) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      const key = String(id);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const openPreview = (task) => {
    if (!taskCoverUrl(task)) return;
    setPreview(task);
    ensureMetadata(task);
  };
  const closePreview = () => setPreview(null);
  const openShareAction = (task) => {
    if (taskShareStatus(task)) {
      closePreview();
      navigate("/submissions");
      return;
    }
    setPublishTarget(task);
  };
  const downloadFilename = (task) =>
    `${taskTypeLabel(task)}-${String(task.createdAt || new Date().toISOString()).slice(0, 10)}-${String(task.id || "original").slice(0, 8)}`;
  const downloadTask = async (task) => {
    const url = taskOriginalUrl(task);
    if (!url) return notificationService.info("当前记录没有可下载的原图");
    const id = String(task.id);
    if (actionBusyIds.has(id)) return;
    setActionBusyIds((current) => new Set(current).add(id));
    try {
      await downloadAuthenticatedMedia(url, downloadFilename(task));
      notificationService.success("原图已开始下载");
    } catch (error) {
      notificationService.error(error?.message || "原图下载失败");
    } finally {
      if (mountedRef.current)
        setActionBusyIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
    }
  };
  const openConfirm = (options, action) =>
    setConfirm({ ...options, action, busy: false });
  const runConfirm = async () => {
    if (!confirm?.action || confirm.busy) return;
    setConfirm((current) => ({ ...current, busy: true }));
    setBulkBusy(true);
    try {
      await confirm.action();
      if (mountedRef.current) setConfirm(null);
    } catch (error) {
      notificationService.error(error?.message || "操作失败");
      if (mountedRef.current)
        setConfirm((current) => ({ ...current, busy: false }));
    } finally {
      if (mountedRef.current) setBulkBusy(false);
    }
  };
  const removeTask = (task) => {
    if (!DELETABLE_STATUSES.has(String(task.status).toLowerCase()))
      return notificationService.info("进行中的任务结束后才能删除");
    openConfirm(
      {
        heading: "删除这条历史记录？",
        description: taskPrompt(task)
          ? `删除后无法恢复：“${taskPrompt(task).slice(0, 72)}”`
          : "删除后产物也会一并清除，且无法恢复。",
        confirmLabel: "确认删除",
        busyLabel: "删除中…",
      },
      async () => {
        await deleteTask(task.id);
        setTasks((current) => current.filter((item) => item.id !== task.id));
        notificationService.success("已删除");
      },
    );
  };
  const deleteIds = async (ids) => {
    let succeeded = 0;
    let failed = 0;
    const queue = [...new Set(ids)];
    await Promise.all(
      Array.from({ length: Math.min(4, queue.length) }, async () => {
        while (queue.length) {
          const id = queue.shift();
          try {
            await deleteTask(id);
            succeeded += 1;
          } catch {
            failed += 1;
          }
        }
      }),
    );
    return { succeeded, failed };
  };
  const fetchAll = async ({ status = "" } = {}) => {
    const all = [];
    let pageCursor = "";
    do {
      const page = await listTasks({ status, limit: 50, cursor: pageCursor });
      all.push(...page.items);
      pageCursor = page.nextCursor || "";
    } while (pageCursor);
    return all;
  };
  const batchDelete = (ids) =>
    openConfirm(
      {
        heading: `删除选中的 ${ids.length} 条记录？`,
        description: "产物也会一并删除，删除后无法恢复。",
        confirmLabel: "删除所选",
        busyLabel: "删除中…",
      },
      async () => {
        const result = await deleteIds(ids);
        setSelectedIds(new Set());
        setSelectMode(false);
        await loadTasks();
        result.failed
          ? notificationService.error(
              `已删除 ${result.succeeded} 条，${result.failed} 条失败`,
            )
          : notificationService.success(`已删除 ${result.succeeded} 条`);
      },
    );
  const clearByStatus = (all) =>
    openConfirm(
      {
        heading: all ? "删除全部历史记录？" : "清除全部失败记录？",
        description: all
          ? "仅已结束的任务会被删除，进行中的任务会保留。产物也会一并删除，且不可撤销。"
          : "将删除账号下所有失败任务及其产物，此操作不可撤销。",
        confirmLabel: all ? "清空全部" : "全部清除",
        busyLabel: "清除中…",
      },
      async () => {
        const rows = await fetchAll(all ? {} : { status: "failed" });
        const targets = all
          ? rows.filter((task) =>
              DELETABLE_STATUSES.has(String(task.status).toLowerCase()),
            )
          : rows;
        if (!targets.length)
          return notificationService.info(
            all ? "没有可删除的已结束任务" : "没有失败记录",
          );
        const result = await deleteIds(targets.map((task) => task.id));
        await loadTasks();
        notificationService.success(
          `已删除 ${result.succeeded} 条记录${result.failed ? `，${result.failed} 条失败` : ""}`,
        );
      },
    );
  const downloadSelected = async () => {
    if (!selectedDownloadTasks.length || batchBusy) return;
    setBatchBusy(true);
    setBatchProgress({
      phase: "fetching",
      completed: 0,
      total: selectedDownloadTasks.length,
    });
    try {
      const result = await downloadHistoryImagesAsZip(
        selectedDownloadTasks.map((task) => ({
          url: taskOriginalUrl(task),
          filename: downloadFilename(task),
        })),
        { onProgress: setBatchProgress },
      );
      notificationService.success(`已打包 ${result.count} 张原图`);
    } catch (error) {
      notificationService.error(error?.message || "批量打包下载失败");
    } finally {
      if (mountedRef.current) {
        setBatchBusy(false);
        window.setTimeout(
          () => mountedRef.current && setBatchProgress(null),
          1200,
        );
      }
    }
  };
  const copyPrompt = (task) => {
    const prompt = taskPrompt(task);
    if (!prompt) return notificationService.info("该任务没有可复制的提示词");
    navigator.clipboard
      .writeText(prompt)
      .then(() => notificationService.success("提示词已复制"))
      .catch(() => notificationService.error("复制失败，请手动选择文本"));
  };
  const submitPublish = async (options) => {
    if (!publishTarget || publishBusy) return;
    setPublishBusy(true);
    try {
      const response = await submitShareItem({
        jobId: String(publishTarget.id).replace(/^server-/, ""),
        title: options.title,
        categoryId: options.categoryId,
      });
      const status = String(
        response?.status || response?.item?.status || "pending",
      ).toLowerCase();
      const next = {
        ...publishTarget,
        shareSubmitted: true,
        shareSubmissionStatus: status,
      };
      setTasks((current) =>
        current.map((item) => (item.id === publishTarget.id ? next : item)),
      );
      setPreview((current) =>
        current?.id === publishTarget.id ? next : current,
      );
      notificationService.success(
        status === "approved" ? "作品已经发布" : "作品已提交发布审核",
      );
      setPublishTarget(null);
    } catch (error) {
      notificationService.error(error?.message || "作品发布失败");
    } finally {
      if (mountedRef.current) setPublishBusy(false);
    }
  };
  const batchLabel = !batchProgress
    ? "打包下载"
    : batchProgress.phase === "packing"
      ? "正在打包…"
      : batchProgress.phase === "done"
        ? "下载已就绪"
        : `读取原图 ${batchProgress.completed}/${batchProgress.total}`;

  return (
    <main
      ref={pageRef}
      className="ch-page ch-page--history"
      data-history-content-motion-state="entered"
    >
      <div className="ch-shell">
        <div className="ch-sticky-bar">
          <div className="ch-toolbar">
            <label className="ch-search">
              <i className="bi bi-search" />
              <input
                value={search}
                type="search"
                placeholder="搜索提示词"
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
                        setSelectedIds(new Set());
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
                disabled={bulkBusy}
                onClick={() => {
                  setSelectMode(!selectMode);
                  setSelectedIds(new Set());
                }}
              >
                {selectMode ? "退出多选" : "多选"}
              </button>
              {selectMode && (
                <>
                  <button
                    type="button"
                    className="ch-chip"
                    onClick={() =>
                      setSelectedIds(
                        new Set(
                          visibleTasks
                            .filter((task) => taskOriginalUrl(task))
                            .map((task) => String(task.id)),
                        ),
                      )
                    }
                  >
                    全选当前
                  </button>
                  <button
                    type="button"
                    className="ch-chip is-download"
                    disabled={batchBusy || !selectedDownloadTasks.length}
                    onClick={downloadSelected}
                  >
                    <i className="bi bi-file-earmark-zip" />
                    {batchLabel}
                  </button>
                  <button
                    type="button"
                    className="ch-chip is-danger"
                    disabled={!selectedIds.size || bulkBusy}
                    onClick={() => batchDelete([...selectedIds])}
                  >
                    删除所选{selectedIds.size ? ` (${selectedIds.size})` : ""}
                  </button>
                </>
              )}
              <button
                type="button"
                className="ch-chip"
                disabled={bulkBusy}
                onClick={() => clearByStatus(false)}
              >
                清除失败
              </button>
              <button
                type="button"
                className="ch-chip is-danger"
                disabled={bulkBusy}
                onClick={() => clearByStatus(true)}
              >
                清空全部
              </button>
            </div>
            <div className="ch-layout-switch">
              <span>布局</span>
              {[3, 4, 6, 8].map((count) => (
                <button
                  key={count}
                  type="button"
                  className={
                    layoutMode === "grid" && gridColumns === count
                      ? "is-active"
                      : ""
                  }
                  aria-label={`${count} 列布局`}
                  onClick={() => setLayout("grid", count)}
                >
                  {count}
                </button>
              ))}
              <button
                type="button"
                className={layoutMode === "table" ? "is-active" : ""}
                aria-label="列表布局"
                onClick={() => setLayout("table")}
              >
                <i className="bi bi-list-ul" />
              </button>
            </div>
          </div>
          <div className="ch-chips">
            {TYPE_FILTERS.map(([id, label]) => (
              <button
                key={id || "all"}
                type="button"
                className={`ch-chip${typeFilter === id ? " is-active" : ""}`}
                onClick={() => resetForType(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <section className="ch-section">
          {loading && !visibleTasks.length ? (
            <div className="ch-loading">正在加载历史…</div>
          ) : !visibleTasks.length ? (
            <div className="ch-empty">
              <strong>还没有历史记录</strong>
              <span>
                {typeFilter === CANVAS_SOURCE
                  ? "去无限画布生成第一张图吧"
                  : "去创作台生成第一张图吧"}
              </span>
              <Link
                className="ch-btn is-primary"
                to={typeFilter === CANVAS_SOURCE ? "/canvas" : "/studio"}
              >
                {typeFilter === CANVAS_SOURCE ? "打开无限画布" : "打开创作台"}
              </Link>
            </div>
          ) : layoutMode === "grid" ? (
            <div
              ref={masonry.containerRef}
              className={`ch-history-masonry${gridColumns >= 6 ? " is-dense" : ""}`}
              style={{ height: `${masonry.totalHeight}px` }}
            >
              {masonry.visibleItems.map((item) => {
                const task = item.item;
                const src = coverSrc(task);
                const selected = selectedIds.has(String(task.id));
                const share = taskShareStatus(task);
                const hasCachedMetadata = Boolean(metadata[String(task.id)]);
                const cardMediaLabel = hasCachedMetadata
                  ? metadataLabel(task)
                  : formatTime(task.createdAt);
                return (
                  <article
                    key={item.key}
                    data-history-id={item.key}
                    className={`ch-card ch-history-masonry__item${selected ? " is-selected" : ""}${selectMode ? " is-selecting" : ""}`}
                    style={{
                      width: item.width,
                      height: item.height,
                      transform: `translate(${item.left}px, ${item.top}px)`,
                    }}
                  >
                    {selectMode && taskOriginalUrl(task) && (
                      <button
                        type="button"
                        className="ch-card__check"
                        aria-pressed={selected}
                        onClick={() => toggleSelected(task.id)}
                      >
                        <i
                          className={`bi ${selected ? "bi-check-circle-fill" : "bi-circle"}`}
                        />
                      </button>
                    )}
                    <button
                      type="button"
                      className="ch-card__media ch-prompt-card__media"
                      style={{ height: item.mediaHeight, aspectRatio: "auto" }}
                      disabled={!selectMode && !src}
                      onClick={() =>
                        selectMode
                          ? taskOriginalUrl(task) && toggleSelected(task.id)
                          : openPreview(task)
                      }
                    >
                      {src ? (
                        <AuthenticatedImage
                          className={`ch-prompt-card__image${loadedImageIdsRef.current.has(String(task.id)) ? " is-loaded" : ""}`}
                          src={src}
                          fallbackSrc={
                            taskDisplayUrl(task) || taskOriginalUrl(task)
                          }
                          alt={task.cleanPrompt}
                          maxDimension={Math.min(
                            640,
                            Math.max(320, Math.ceil(item.width * 2)),
                          )}
                          loading={
                            item.index < masonry.columnCount ? "eager" : "lazy"
                          }
                          onLoad={(event) => revealHistoryImage(task, event)}
                          onError={(event) => recoverHistoryImage(task, event)}
                        />
                      ) : (
                        <div
                          className={`ch-card__placeholder${isUserDeleted(task) ? " is-user-deleted" : ""}`}
                        >
                          <i
                            className={`bi ${isUserDeleted(task) ? "bi-trash3" : task.status === "failed" ? "bi-x-circle" : task.status === "succeeded" ? "bi-image" : "bi-hourglass-split"}`}
                          />
                          <span>
                            {isUserDeleted(task)
                              ? "产物已被用户删除"
                              : task.status === "succeeded"
                                ? "缩略图暂不可用"
                                : STATUS_LABELS[task.status] || task.status}
                          </span>
                        </div>
                      )}
                      <span className="ch-history-card__details">
                        <span className="ch-history-card__prompt">
                          {cardPromptPreview(task.cleanPrompt)}
                        </span>
                        <span
                          className="ch-history-card__meta"
                          title={cardMediaLabel}
                        >
                          <i
                            className={`bi ${hasCachedMetadata ? "bi-aspect-ratio" : "bi-clock"}`}
                          />
                          {cardMediaLabel}
                        </span>
                      </span>
                    </button>
                    <div className="ch-card__overlay">
                      <span className="ch-card__overlay-start">
                        <span className="ch-card__tag">
                          {taskTypeLabel(task)}
                        </span>
                      </span>
                      <span className="ch-card__overlay-end">
                        <span
                          className="ch-card__share is-status"
                          data-status={task.status}
                        >
                          {STATUS_LABELS[task.status] || task.status}
                        </span>
                        {share ? (
                          <span className="ch-card__share" data-status={share}>
                            {shareStatusLabel(share)}
                          </span>
                        ) : null}
                      </span>
                    </div>
                    <div className="ch-card__body">
                      <div className="ch-card__actions is-icon-row">
                        <button
                          type="button"
                          title="下载原图"
                          aria-label="下载原图"
                          disabled={
                            !taskOriginalUrl(task) ||
                            actionBusyIds.has(String(task.id))
                          }
                          onClick={() => downloadTask(task)}
                        >
                          <span
                            className="ch-history-icon is-download"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          title={
                            share
                              ? `已投稿 · ${shareStatusLabel(share)}`
                              : "发布到社区"
                          }
                          aria-label={
                            share
                              ? `已投稿 · ${shareStatusLabel(share)}`
                              : "发布到社区"
                          }
                          disabled={
                            !share &&
                            (task.status !== "succeeded" || !taskCoverUrl(task))
                          }
                          onClick={() => openShareAction(task)}
                        >
                          <span
                            className="ch-history-icon is-publish"
                            aria-hidden="true"
                          />
                        </button>
                        <button
                          type="button"
                          title="复制提示词"
                          aria-label="复制提示词"
                          disabled={!taskPrompt(task)}
                          onClick={() => copyPrompt(task)}
                        >
                          <i className="bi bi-copy" aria-hidden="true" />
                        </button>
                        {!selectMode && (
                          <button
                            type="button"
                            className="is-danger"
                            title="删除"
                            aria-label="删除"
                            disabled={
                              !DELETABLE_STATUSES.has(
                                String(task.status).toLowerCase(),
                              )
                            }
                            onClick={() => removeTask(task)}
                          >
                            <span
                              className="ch-history-icon is-delete"
                              aria-hidden="true"
                            />
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="ch-history-table-wrap">
              <table className="ch-history-table">
                <thead>
                  <tr>
                    {selectMode && (
                      <th className="is-check" aria-label="选择" />
                    )}
                    <th className="is-work">作品</th>
                    <th className="is-prompt">提示词</th>
                    <th className="is-size">尺寸</th>
                    <th className="is-file-size">大小</th>
                    <th className="is-transparency">透明</th>
                    <th className="is-status-cell">状态</th>
                    <th className="is-created">创建时间</th>
                    <th className="is-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((task) => {
                    const meta = metadata[String(task.id)];
                    const share = taskShareStatus(task);
                    return (
                      <tr
                        key={task.id}
                        data-history-id={String(task.id)}
                        className={
                          selectedIds.has(String(task.id)) ? "is-selected" : ""
                        }
                      >
                        {selectMode && (
                          <td className="is-check">
                            <button
                              disabled={!taskOriginalUrl(task)}
                              onClick={() => toggleSelected(task.id)}
                            >
                              <i
                                className={`bi ${selectedIds.has(String(task.id)) ? "bi-check-circle-fill" : "bi-circle"}`}
                              />
                            </button>
                          </td>
                        )}
                        <td className="is-work">
                          <button
                            className="ch-table-preview"
                            type="button"
                            disabled={!tableCoverSrc(task)}
                            onClick={() => openPreview(task)}
                          >
                            {tableCoverSrc(task) && (
                              <img
                                src={tableCoverSrc(task)}
                                alt={task.cleanPrompt}
                                loading="lazy"
                                decoding="async"
                                width={52}
                                height={52}
                                onLoad={() => ensureMetadata(task)}
                              />
                            )}
                            <span>{taskTypeLabel(task)}</span>
                          </button>
                        </td>
                        <td className="is-prompt" title={task.cleanPrompt}>
                          {task.cleanPrompt}
                        </td>
                        <td className="is-size" data-label="尺寸">
                          {!taskOriginalUrl(task)
                            ? "—"
                            : meta?.width
                              ? `${meta.width}×${meta.height}`
                              : meta?.error
                                ? "不可用"
                                : "读取中…"}
                        </td>
                        <td className="is-file-size" data-label="大小">
                          {meta?.bytes ? formatBytes(meta.bytes) : "—"}
                        </td>
                        <td className="is-transparency" data-label="透明">
                          {meta && !meta.error ? (
                            <span
                              className={`ch-transparency${meta.transparent ? " is-transparent" : ""}`}
                            >
                              {meta.transparent ? "是" : "否"}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="is-status-cell" data-label="状态">
                          <span
                            className="ch-pill is-status"
                            data-status={task.status}
                          >
                            {STATUS_LABELS[task.status] || task.status}
                          </span>
                          {share && (
                            <span
                              className="ch-pill is-share"
                              data-status={share}
                            >
                              {shareStatusLabel(share)}
                            </span>
                          )}
                        </td>
                        <td className="is-created" data-label="创建时间">
                          {formatTime(task.createdAt)}
                        </td>
                        <td className="is-actions">
                          <div className="ch-table-actions">
                            <button
                              title="下载原图"
                              disabled={!taskOriginalUrl(task)}
                              onClick={() => downloadTask(task)}
                            >
                              <i className="bi bi-download" />
                            </button>
                            <button
                              title={
                                share
                                  ? `已投稿 · ${shareStatusLabel(share)}`
                                  : "发布"
                              }
                              aria-label={
                                share
                                  ? `已投稿 · ${shareStatusLabel(share)}`
                                  : "发布"
                              }
                              disabled={
                                !share &&
                                (task.status !== "succeeded" ||
                                  !taskCoverUrl(task))
                              }
                              onClick={() => openShareAction(task)}
                            >
                              <i
                                className={`bi ${share ? "bi-send-check" : "bi-send"}`}
                              />
                            </button>
                            <button
                              title="复制提示词"
                              aria-label="复制提示词"
                              disabled={!taskPrompt(task)}
                              onClick={() => copyPrompt(task)}
                            >
                              <i className="bi bi-copy" />
                            </button>
                            <button
                              title="删除"
                              disabled={
                                !DELETABLE_STATUSES.has(
                                  String(task.status).toLowerCase(),
                                )
                              }
                              onClick={() => removeTask(task)}
                            >
                              <i className="bi bi-trash3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {(cursor || loadingMore) && (
            <div ref={sentinelRef} className="ch-more">
              {loadingMore && <span className="ch-more__hint">加载中…</span>}
            </div>
          )}
        </section>
      </div>
      <DialogMotion
        open={Boolean(preview)}
        variant="detail"
        layerClassName="ch-preview-layer"
        panelClassName="ch-preview"
        ariaLabel="历史记录图片预览"
        onClose={closePreview}
        onExited={() => setBodyScrollLock(HISTORY_PREVIEW_LOCK, false)}
        layerExtras={
          preview
            ? () => (
                <>
                  <button
                    type="button"
                    className="ch-preview__nav is-prev"
                    disabled={previewIndex <= 0}
                    onClick={() => setPreview(visibleTasks[previewIndex - 1])}
                  >
                    <i className="bi bi-chevron-left" />
                  </button>
                  <button
                    type="button"
                    className="ch-preview__nav is-next"
                    disabled={
                      previewIndex < 0 ||
                      previewIndex >= visibleTasks.length - 1
                    }
                    onClick={() => setPreview(visibleTasks[previewIndex + 1])}
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
              {taskCoverUrl(preview) ? (
                <img
                  key={String(preview.id)}
                  src={taskDisplayUrl(preview) || taskCoverUrl(preview)}
                  alt={taskPrompt(preview) || "AI 作品"}
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                  onError={(event) => {
                    // 旧任务的展示图可能 404：回退到原图重试一次。
                    const fallback = taskOriginalUrl(preview);
                    const image = event.currentTarget;
                    if (fallback && !image.dataset.fallbackApplied) {
                      image.dataset.fallbackApplied = "1";
                      image.src = fallback;
                    }
                  }}
                />
              ) : (
                <div className="ch-preview__empty">暂无预览图</div>
              )}
            </div>
            <aside className="ch-preview__body">
              <div className="ch-preview__top">
                <div className="ch-card__meta">
                  <span className="ch-pill">{taskTypeLabel(preview)}</span>
                  <span
                    className="ch-pill is-status"
                    data-status={preview.status}
                  >
                    {STATUS_LABELS[preview.status] || preview.status}
                  </span>
                  {taskShareStatus(preview) ? (
                    <span
                      className="ch-pill is-share"
                      data-status={taskShareStatus(preview)}
                    >
                      {shareStatusLabel(taskShareStatus(preview))}
                    </span>
                  ) : null}
                  <span className="ch-pill">
                    {formatTime(preview.createdAt)}
                  </span>
                  <span className="ch-pill">
                    {formatPoints(preview.costCents)}
                  </span>
                </div>
              </div>
              <div className="ch-preview__mid">
                <p className="ch-preview__prompt">
                  {taskPrompt(preview) || "未填写提示词"}
                </p>
                <dl className="ch-preview__specs">
                  <div>
                    <dt>尺寸</dt>
                    <dd>
                      {metadata[String(preview.id)]?.width
                        ? `${metadata[String(preview.id)].width}×${metadata[String(preview.id)].height}`
                        : "读取中…"}
                    </dd>
                  </div>
                  <div>
                    <dt>原图大小</dt>
                    <dd>{formatBytes(metadata[String(preview.id)]?.bytes)}</dd>
                  </div>
                  <div>
                    <dt>透明背景</dt>
                    <dd>
                      {metadata[String(preview.id)] &&
                      !metadata[String(preview.id)].error
                        ? metadata[String(preview.id)].transparent
                          ? "是"
                          : "否"
                        : "—"}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="ch-preview__bottom">
                <div className="ch-card__actions">
                  {taskPrompt(preview) && (
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() => copyPrompt(preview)}
                    >
                      复制提示词
                    </button>
                  )}
                  <button type="button" onClick={() => downloadTask(preview)}>
                    下载原图
                  </button>
                  <button
                    type="button"
                    disabled={
                      !taskShareStatus(preview) &&
                      preview.status !== "succeeded"
                    }
                    onClick={() => openShareAction(preview)}
                  >
                    {taskShareStatus(preview)
                      ? `投稿 · ${shareStatusLabel(taskShareStatus(preview))}`
                      : "发布"}
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
      <SharePublishDialog
        open={Boolean(publishTarget)}
        title={
          taskPrompt(publishTarget).slice(0, 120) ||
          `${taskTypeLabel(publishTarget)} 创作`
        }
        submitting={publishBusy}
        light={!isDark}
        onClose={() => !publishBusy && setPublishTarget(null)}
        onSubmit={submitPublish}
      />
      <ConfirmDialog
        open={Boolean(confirm)}
        busy={confirm?.busy}
        heading={confirm?.heading}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel}
        busyLabel={confirm?.busyLabel}
        light={!isDark}
        onClose={() => !confirm?.busy && setConfirm(null)}
        onConfirm={runConfirm}
      />
    </main>
  );
}
