import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTask,
  createTask,
  deleteTask,
  listTasks,
  uploadFile,
  waitForTask,
} from "@react/legacy-modules/services/tasksApi.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function taskOutputs(task = {}) {
  const originals = Array.isArray(task.originalUrls) ? task.originalUrls : [];
  const outputs = Array.isArray(task.outputUrls)
    ? task.outputUrls
    : Array.isArray(task.outputs)
      ? task.outputs
      : [];
  return Array.from(
    new Set(
      (originals.length ? originals : outputs).map(String).filter(Boolean),
    ),
  );
}

function normalizeTask(task = {}) {
  const params =
    task.params && typeof task.params === "object" ? task.params : {};
  const outputs = taskOutputs(task);
  return {
    ...task,
    id: String(task.id || ""),
    status: String(task.status || "queued").toLowerCase(),
    kind: String(params._kind || task.kind || ""),
    batchId: String(params.batchId || task.batchId || task.id || ""),
    batchIndex: Math.max(
      0,
      Number(params.batchIndex ?? task.batchIndex ?? 0) || 0,
    ),
    batchSize: Math.max(
      1,
      Number(params.batchSize ?? task.batchSize ?? outputs.length ?? 1) || 1,
    ),
    aspectRatio: String(params.aspectRatio || task.aspectRatio || "1:1"),
    parentOutputUrl: String(params.parentOutputUrl || ""),
    outputs,
    previews: Array.isArray(task.thumbnailUrls)
      ? task.thumbnailUrls.map(String).filter(Boolean)
      : outputs,
    // Queued tasks have not started provider execution yet.
    startedAt:
      String(task.status || "").toLowerCase() === "queued"
        ? ""
        : task.startedAt || "",
  };
}

function newestFirst(tasks) {
  return [...tasks].sort((left, right) => {
    const leftBatch = Date.parse(
      left.params?.batchCreatedAt || left.createdAt || 0,
    );
    const rightBatch = Date.parse(
      right.params?.batchCreatedAt || right.createdAt || 0,
    );
    if (leftBatch !== rightBatch) return rightBatch - leftBatch;
    return left.batchIndex - right.batchIndex;
  });
}

function mergeTasks(current, incoming) {
  const rows = new Map(current.map((task) => [task.id, task]));
  incoming.forEach((task) => {
    const normalized = normalizeTask(task);
    if (!normalized.id) return;
    rows.set(normalized.id, {
      ...(rows.get(normalized.id) || {}),
      ...normalized,
    });
  });
  return newestFirst([...rows.values()]);
}

export function useEcommerceJobs() {
  const [tasks, setTasks] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyCursor, setHistoryCursor] = useState("");
  const [runningIds, setRunningIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const controllersRef = useRef(new Map());
  const mountedRef = useRef(true);

  const upsert = useCallback((task) => {
    if (!task?.id || !mountedRef.current) return;
    setTasks((current) => mergeTasks(current, [task]));
  }, []);

  const watchTask = useCallback(
    (task) => {
      const id = String(task?.id || "");
      if (!id || controllersRef.current.has(id)) return;
      const controller = new AbortController();
      controllersRef.current.set(id, controller);
      setRunningIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      void waitForTask(id, {
        signal: controller.signal,
        onUpdate: upsert,
      })
        .then(upsert)
        .catch((error) => {
          if (error?.name !== "AbortError") {
            upsert({
              ...task,
              status: "failed",
              error: error?.message || "任务执行失败",
            });
          }
        })
        .finally(() => {
          controllersRef.current.delete(id);
          if (mountedRef.current)
            setRunningIds((current) => current.filter((item) => item !== id));
        });
    },
    [upsert],
  );

  const loadHistory = useCallback(
    async ({ append = false, retries = 1 } = {}) => {
      const key = append ? "history-more" : "history";
      controllersRef.current.get(key)?.abort();
      const controller = new AbortController();
      controllersRef.current.set(key, controller);
      setHistoryLoading(true);
      if (!append) setHistoryError("");
      try {
        const requestPage = () =>
          listTasks({
            type: "ecommerce_design",
            limit: 12,
            cursor: append ? historyCursor : "",
            signal: controller.signal,
          });
        let result;
        let lastError;
        for (let attempt = 0; attempt < Math.max(1, retries); attempt += 1) {
          try {
            result = await requestPage();
            break;
          } catch (error) {
            if (error?.name === "AbortError") throw error;
            lastError = error;
          }
        }
        if (!result) throw lastError || new Error("历史记录读取失败");
        if (!mountedRef.current || controller.signal.aborted) return;
        const incoming = result.items.map(normalizeTask);
        setTasks((current) =>
          append ? mergeTasks(current, incoming) : newestFirst(incoming),
        );
        setHistoryCursor(String(result.nextCursor || ""));
        incoming
          .filter((task) => ACTIVE_STATUSES.has(task.status))
          .forEach(watchTask);
      } catch (error) {
        if (error?.name !== "AbortError" && mountedRef.current) {
          setHistoryError("历史记录读取失败，请重试");
        }
      } finally {
        controllersRef.current.delete(key);
        if (mountedRef.current) setHistoryLoading(false);
      }
    },
    [historyCursor, watchTask],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadHistory();
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    };
    // Initial hydration is intentionally independent from pagination state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createBatch = useCallback(
    async ({ files = [], items = [], modelId = "" }) => {
      if (!items.length) return [];
      const prepareKey = `prepare-${Date.now()}`;
      const controller = new AbortController();
      controllersRef.current.set(prepareKey, controller);
      setSubmitting(true);
      try {
        const uploads = await Promise.all(
          files.map(async (file) => {
            const source = String(file?.sourceUrl || "");
            const match = source.match(/\/api\/v1\/files\/(.+?)(?:\?|$)/);
            if (match) return decodeURIComponent(match[1]);
            return (await uploadFile(file, { signal: controller.signal })).key;
          }),
        );
        const batchId = crypto.randomUUID();
        const batchCreatedAt = new Date().toISOString();
        const created = await Promise.all(
          items.map(async (item, index) => {
            const task = await createTask({
              type: "ecommerce_design",
              prompt: item.prompt,
              params: {
                ...item,
                publicModelKey: modelId,
                _kind: `ui-design-ecommerce-${item.kindVariant || "detail"}-generation`,
                batchId,
                batchIndex: index,
                batchSize: items.length,
                batchCreatedAt,
              },
              inputKeys: uploads,
              count: 1,
              idempotencyKey: crypto.randomUUID(),
            });
            const normalized = normalizeTask(task);
            upsert(normalized);
            watchTask(normalized);
            return normalized;
          }),
        );
        return created;
      } finally {
        controllersRef.current.delete(prepareKey);
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [upsert, watchTask],
  );

  const cancelAll = useCallback(async () => {
    const active = tasks.filter((task) => ACTIVE_STATUSES.has(task.status));
    if (!active.length) return;
    setCancelling(true);
    try {
      const settled = await Promise.allSettled(
        active.map((task) => cancelTask(task.id)),
      );
      settled.forEach((result) => {
        if (result.status === "fulfilled") upsert(result.value);
      });
    } finally {
      if (mountedRef.current) setCancelling(false);
    }
  }, [tasks, upsert]);

  const remove = useCallback(async (taskId) => {
    await deleteTask(taskId, { cascade: true });
    controllersRef.current.get(taskId)?.abort();
    controllersRef.current.delete(taskId);
    if (mountedRef.current)
      setTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

  const running =
    submitting ||
    runningIds.length > 0 ||
    tasks.some((task) => ACTIVE_STATUSES.has(task.status));
  const outputRows = useMemo(
    () =>
      tasks.flatMap((task) =>
        task.outputs.map((url, index) => ({
          task,
          url,
          preview: task.previews[index] || task.previews[0] || url,
          index: task.batchSize > 1 ? task.batchIndex : index,
          groupId: task.batchId || task.id,
          groupSize: task.batchSize,
          aspectRatio: task.aspectRatio,
          kind: task.kind,
          parentOutputUrl: task.parentOutputUrl,
        })),
      ),
    [tasks],
  );

  return {
    tasks,
    outputRows,
    running,
    cancelling,
    historyLoading,
    historyError,
    historyHasMore: Boolean(historyCursor),
    refreshHistory: () => loadHistory({ retries: 6 }),
    loadMoreHistory: () => loadHistory({ append: true }),
    createBatch,
    cancelAll,
    remove,
  };
}
