import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTask,
  createTask,
  deleteTask,
  listTasks,
  subscribeTask,
  uploadFile,
  waitForTask,
} from "@react/legacy-modules/services/tasksApi.js";
import { fetchAuthenticatedMediaBlob } from "@react/legacy-modules/services/authenticatedMedia.js";
import {
  cancelHandheldJob,
  createHandheldJob,
  getHandheldJob,
  retryHandheldItem as retryHandheldItemRequest,
} from "./handheld/handheldApi.js";
import { compressEcommerceUploadFile } from "@react/legacy-modules/features/ecommerce/compressEcommerceUpload.js";
import {
  attachEcommerceUploadKey,
  ECOMMERCE_IMAGE_TARGET_BYTES,
  isReusableTaskImageKey,
  normalizeTaskImageKey,
} from "@react/legacy-modules/features/ecommerce/ecommerceTools.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

async function uploadKeyFromFile(file, signal) {
  const ready = await compressEcommerceUploadFile(file, {
    targetBytes: ECOMMERCE_IMAGE_TARGET_BYTES,
    signal,
  });
  const uploaded = await uploadFile(ready, { signal });
  const key = normalizeTaskImageKey(uploaded?.key || uploaded?.url || "");
  if (!isReusableTaskImageKey(key)) {
    throw new Error("图片上传未返回有效文件，请重试");
  }
  return key;
}

async function resolveEcommerceUploadKey(file, signal) {
  const cached = normalizeTaskImageKey(file?.uploadKey || "");
  if (isReusableTaskImageKey(cached)) return cached;
  const source = String(file?.sourceUrl || "").trim();
  const hasBytes = file instanceof Blob && Number(file.size) > 0;
  if (hasBytes) {
    const key = await uploadKeyFromFile(file, signal);
    attachEcommerceUploadKey(file, key);
    return key;
  }
  if (source) {
    try {
      const blob = await fetchAuthenticatedMediaBlob(source, {
        signal,
        cache: "no-store",
      });
      const typed = new File([blob], file?.name || "ecommerce-source.png", {
        type:
          blob.type && String(blob.type).startsWith("image/")
            ? blob.type
            : "image/png",
      });
      const key = await uploadKeyFromFile(typed, signal);
      attachEcommerceUploadKey(file, key);
      attachEcommerceUploadKey(typed, key);
      return key;
    } catch {
      const reused = normalizeTaskImageKey(source);
      if (isReusableTaskImageKey(reused)) return reused;
      throw new Error("参考图已失效，请重新上传衣服、模特或场景");
    }
  }
  throw new Error("参考图未准备好，请重新选择模特、衣服或场景");
}

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
  const [lastError, setLastError] = useState("");
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
      const unsubscribe = subscribeTask(id, { onUpdate: upsert });
      void waitForTask(id, {
        signal: controller.signal,
        onUpdate: upsert,
        intervalMs: 500,
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
          unsubscribe();
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
            limit: 32,
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
    async ({
      files = [],
      items = [],
      modelId = "",
      batchId = "",
      batchSize = 0,
    } = {}) => {
      if (!items.length) {
        throw new Error("没有可生成的内容");
      }
      if (
        files.some(
          (file) =>
            !String(file?.sourceUrl || "") &&
            (!file || !(file instanceof Blob) || !file.size),
        )
      ) {
        throw new Error("参考图未准备好，请重新选择模特、衣服或场景");
      }
      const prepareKey = `prepare-${Date.now()}`;
      const controller = new AbortController();
      controllersRef.current.set(prepareKey, controller);
      const nextBatchId = String(batchId || crypto.randomUUID());
      const nextBatchSize = Math.max(1, Number(batchSize) || items.length);
      setLastError("");
      setSubmitting(true);
      try {
        const uploads = await Promise.all(
          files.map((file) =>
            resolveEcommerceUploadKey(file, controller.signal),
          ),
        );
        if (uploads.some((key) => !isReusableTaskImageKey(key))) {
          throw new Error("参考图上传失败，请重新选择模特、衣服或场景");
        }
        const batchCreatedAt = new Date().toISOString();
        const settled = await Promise.allSettled(
          items.map(async (item, index) => {
            const batchIndex = Number.isFinite(Number(item.batchIndex))
              ? Number(item.batchIndex)
              : index;
            const task = await createTask({
              type: "ecommerce_design",
              prompt: item.prompt,
              params: {
                ...item,
                publicModelKey: modelId,
                _kind: `ui-design-ecommerce-${item.kindVariant || "detail"}-generation`,
                batchId: nextBatchId,
                batchIndex,
                batchSize: nextBatchSize,
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
        const created = settled
          .filter((result) => result.status === "fulfilled")
          .map((result) => result.value);
        settled.forEach((result, index) => {
          if (result.status !== "rejected") return;
          const item = items[index] || {};
          const batchIndex = Number.isFinite(Number(item.batchIndex))
            ? Number(item.batchIndex)
            : index;
          upsert({
            id: `local-failed-${nextBatchId}-${batchIndex}`,
            status: "failed",
            error: result.reason?.message || "创建任务失败",
            kind: `ui-design-ecommerce-${item.kindVariant || "detail"}-generation`,
            batchId: nextBatchId,
            batchIndex,
            batchSize: nextBatchSize,
            params: {
              _kind: `ui-design-ecommerce-${item.kindVariant || "detail"}-generation`,
              batchId: nextBatchId,
              batchIndex,
              batchSize: nextBatchSize,
            },
            outputs: [],
            previews: [],
          });
        });
        if (!created.length) {
          const message =
            settled.find((result) => result.status === "rejected")?.reason
              ?.message || "生成失败，请重试";
          setLastError(message);
          throw new Error(message);
        }
        return { batchId: nextBatchId, tasks: created };
      } catch (error) {
        const message = error?.message || "生成失败，请重试";
        if (mountedRef.current) setLastError(message);
        throw error;
      } finally {
        controllersRef.current.delete(prepareKey);
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [upsert, watchTask],
  );

  const createHandheldBatch = useCallback(
    async ({
      roleFiles = [],
      projectId = "",
      productId = "",
      modelId = "",
      spec = {},
      parentBatchId = "",
    } = {}) => {
      if (
        !roleFiles.length ||
        !Array.isArray(spec.shots) ||
        !spec.shots.length
      ) {
        throw new Error("手持商品任务缺少商品图或生成项");
      }
      const controller = new AbortController();
      const prepareKey = `handheld-${Date.now()}`;
      controllersRef.current.set(prepareKey, controller);
      setLastError("");
      setSubmitting(true);
      try {
        const inputs = await Promise.all(
          roleFiles.map(async ({ role, file }) => ({
            role,
            key: await resolveEcommerceUploadKey(file, controller.signal),
          })),
        );
        const batch = await createHandheldJob(
          {
            ...(projectId ? { projectId } : {}),
            ...(productId ? { productId } : {}),
            ...(parentBatchId ? { parentBatchId } : {}),
            modelId,
            spec: { ...spec, inputs },
          },
          { signal: controller.signal },
        );
        const incoming = (Array.isArray(batch?.items) ? batch.items : [])
          .map((item) => item?.task)
          .filter(Boolean)
          .map(normalizeTask);
        incoming.forEach((task) => {
          upsert(task);
          if (ACTIVE_STATUSES.has(task.status)) watchTask(task);
        });
        return { batchId: String(batch?.id || ""), tasks: incoming, batch };
      } catch (error) {
        if (mountedRef.current)
          setLastError(error?.message || "手持商品生成失败");
        throw error;
      } finally {
        controllersRef.current.delete(prepareKey);
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [upsert, watchTask],
  );

  const hydrateHandheldBatch = useCallback(
    async (batchId, { signal } = {}) => {
      const id = String(batchId || "").trim();
      if (!id) return { batchId: "", tasks: [], batch: null };
      const batch = await getHandheldJob(id, { signal });
      const incoming = (Array.isArray(batch?.items) ? batch.items : [])
        .map((item) => item?.task)
        .filter(Boolean)
        .map(normalizeTask);
      incoming.forEach((task) => {
        upsert(task);
        if (ACTIVE_STATUSES.has(task.status)) watchTask(task);
      });
      return { batchId: String(batch?.id || id), tasks: incoming, batch };
    },
    [upsert, watchTask],
  );

  const retryHandheldItem = useCallback(
    async (itemId, { signal } = {}) => {
      const id = String(itemId || "").trim();
      if (!id) throw new Error("缺少失败图片标识，请刷新后重试");
      setLastError("");
      try {
        const result = await retryHandheldItemRequest(id, { signal });
        const task = normalizeTask(result?.task || {});
        if (!task.id) throw new Error("重试任务创建失败，请刷新后重试");
        upsert(task);
        if (ACTIVE_STATUSES.has(task.status)) watchTask(task);
        return {
          batchId: String(result?.batchId || task.batchId || ""),
          itemId: String(result?.id || id),
          task,
        };
      } catch (error) {
        if (mountedRef.current)
          setLastError(error?.message || "失败图片重试失败");
        throw error;
      }
    },
    [upsert, watchTask],
  );

  const cancelHandheldBatch = useCallback(
    async (batchId) => {
      if (!batchId) return;
      setCancelling(true);
      try {
        await cancelHandheldJob(batchId);
        await loadHistory({ retries: 2 });
      } finally {
        if (mountedRef.current) setCancelling(false);
      }
    },
    [loadHistory],
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
    lastError,
    clearError: () => setLastError(""),
    createBatch,
    createHandheldBatch,
    retryHandheldItem,
    hydrateHandheldBatch,
    cancelHandheldBatch,
    cancelAll,
    remove,
  };
}
