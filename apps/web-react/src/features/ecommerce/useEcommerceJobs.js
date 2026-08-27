import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelTask,
  createTask,
  deleteTask,
  listTasks,
  quoteTaskPrice,
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
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
  normalizeImageQuality,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import {
  attachEcommerceUploadKey,
  ECOMMERCE_IMAGE_TARGET_BYTES,
  isReusableTaskImageKey,
  normalizeTaskImageKey,
} from "@react/legacy-modules/features/ecommerce/ecommerceTools.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function isAbortError(error) {
  return error?.name === "AbortError";
}

function sanitizeEcommerceImageParams(item = {}, model = {}) {
  const capabilities = normalizeImageModelCapabilities(model);
  const {
    aspectRatio,
    requestedAspectRatio,
    quality,
    resolution,
    resolutionScale,
    outputSize,
    size,
    outputFormat,
    moderationLevel,
    transparentPngEnabled,
    transparentBackground,
    ...businessParams
  } = item;
  const requestedResolution = String(resolutionScale || resolution || "").trim().toUpperCase();
  const supportedResolution = capabilities.resolutions.includes(requestedResolution)
    ? requestedResolution
    : "";
  const requestedRatio = String(aspectRatio || requestedAspectRatio || "").trim().toLowerCase();
  const supportedRatios = getModelAspectRatiosForResolution(model, supportedResolution);
  const supportedRatio = supportedRatios.includes(requestedRatio) ? requestedRatio : "";
  const requestedQuality = normalizeImageQuality(quality);
  const requestedFormat = String(outputFormat || "").trim().toLowerCase().replace(/^jpg$/, "jpeg");
  const requestedModeration = String(moderationLevel || "").trim().toLowerCase();
  const supportsDimensions = capabilities.resolutions.length > 0 && Boolean(supportedRatio);
  const wantsTransparent = transparentPngEnabled === true || transparentBackground === true;
  return {
    ...businessParams,
    ...(supportedRatio ? { aspectRatio: supportedRatio, requestedAspectRatio: supportedRatio } : {}),
    ...(supportedResolution ? { resolutionScale: supportedResolution } : {}),
    ...(supportsDimensions && outputSize ? { outputSize } : {}),
    ...(supportsDimensions && size ? { size } : {}),
    ...(capabilities.qualities.includes(requestedQuality) ? { quality: requestedQuality } : {}),
    ...(capabilities.outputFormats.includes(requestedFormat) ? { outputFormat: requestedFormat } : {}),
    ...(capabilities.moderationLevels.includes(requestedModeration) ? { moderationLevel: requestedModeration } : {}),
    ...(capabilities.transparentBackground
      ? { transparentPngEnabled: wantsTransparent, transparentBackground: wantsTransparent }
      : {}),
  };
}

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
  // 展示图与 originalUrls 按下标对应；outputs 去过重，按原图地址重新对齐。
  const originalList = (
    Array.isArray(task.originalUrls) ? task.originalUrls : []
  ).map(String);
  const displayList = (
    Array.isArray(task.displayUrls) ? task.displayUrls : []
  ).map(String);
  const displays = outputs.map((url) => {
    const index = originalList.indexOf(url);
    return (index >= 0 && displayList[index]) || "";
  });
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
    aspectRatio: String(params.aspectRatio || task.aspectRatio || "").trim(),
    parentOutputUrl: String(params.parentOutputUrl || ""),
    outputs,
    displays,
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

export function ecommerceTaskMatchesKind(task, taskKind = "") {
  const expected = String(taskKind || "").trim();
  if (!expected) return true;
  const params =
    task?.params && typeof task.params === "object" ? task.params : {};
  return String(task?.kind || params._kind || "").trim() === expected;
}

export function useEcommerceJobs({ taskKind = "", models = [] } = {}) {
  const [tasks, setTasks] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [historyCursor, setHistoryCursor] = useState("");
  const [runningIds, setRunningIds] = useState([]);
  const [submitting, setSubmitting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [lastError, setLastError] = useState("");
  const controllersRef = useRef(new Map());
  const preparationDoneRef = useRef(new Map());
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
          .filter((task) => ecommerceTaskMatchesKind(task, taskKind))
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
    [historyCursor, taskKind, watchTask],
  );

  useEffect(() => {
    mountedRef.current = true;
    setRunningIds([]);
    void loadHistory();
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    };
    // Business switches re-scope subscriptions without remounting the page shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskKind]);

  useEffect(() => {
    tasks
      .filter((task) => ecommerceTaskMatchesKind(task, taskKind))
      .filter((task) => ACTIVE_STATUSES.has(task.status))
      .forEach(watchTask);
  }, [taskKind, tasks, watchTask]);

  const quoteBatch = useCallback(
    async ({ items = [], modelId = "" } = {}) => {
      if (!items.length) throw new Error("没有可报价的生成内容");
      const selectedModel = models.find((model) =>
        [model?.id, model?.publicModelKey, model?.model]
          .map(String)
          .includes(String(modelId)),
      );
      const firstItem = selectedModel
        ? sanitizeEcommerceImageParams(items[0], selectedModel)
        : items[0];
      return quoteTaskPrice({
        type: "ecommerce_design",
        params: {
          ...firstItem,
          publicModelKey: modelId,
          _kind: `ui-design-ecommerce-${firstItem.kindVariant || "detail"}-generation`,
        },
        count: 1,
      });
    },
    [models],
  );

  const createBatch = useCallback(
    async ({
      files = [],
      items = [],
      modelId = "",
      batchId = "",
      batchSize = 0,
      expectedUnitPriceCents = null,
    } = {}) => {
      if (!items.length) {
        throw new Error("没有可生成的内容");
      }
      const selectedModel = models.find((model) =>
        [model?.id, model?.publicModelKey, model?.model].map(String).includes(String(modelId)),
      );
      if (selectedModel) {
        const maxReferences = normalizeImageModelCapabilities(selectedModel).maxReferenceImages;
        if (files.length > maxReferences) {
          throw new Error(`当前模型最多支持 ${maxReferences} 张参考图`);
        }
      }
      const taskItems = selectedModel
        ? items.map((item) => sanitizeEcommerceImageParams(item, selectedModel))
        : items;
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
      let resolvePreparationDone;
      preparationDoneRef.current.set(
        prepareKey,
        new Promise((resolve) => {
          resolvePreparationDone = resolve;
        }),
      );
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
          taskItems.map(async (item, index) => {
            if (controller.signal.aborted) {
              throw new DOMException("已停止本次生成", "AbortError");
            }
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
              expectedUnitPriceCents,
            });
            if (controller.signal.aborted) {
              try {
                const canceled = await cancelTask(task.id);
                upsert(canceled);
              } catch {
                upsert(task);
              }
              throw new DOMException("已停止本次生成", "AbortError");
            }
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
          const item = taskItems[index] || {};
          const batchIndex = Number.isFinite(Number(item.batchIndex))
            ? Number(item.batchIndex)
            : index;
          upsert({
            id: `local-failed-${nextBatchId}-${batchIndex}`,
            status: isAbortError(result.reason) ? "canceled" : "failed",
            error: isAbortError(result.reason)
              ? "已停止本次生成"
              : result.reason?.message || "创建任务失败",
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
          const reason = settled.find(
            (result) => result.status === "rejected",
          )?.reason;
          if (isAbortError(reason)) throw reason;
          const message = reason?.message || "生成失败，请重试";
          setLastError(message);
          throw new Error(message);
        }
        return { batchId: nextBatchId, tasks: created };
      } catch (error) {
        const message = error?.message || "生成失败，请重试";
        if (isAbortError(error)) {
          taskItems.forEach((item, index) => {
            const batchIndex = Number.isFinite(Number(item.batchIndex))
              ? Number(item.batchIndex)
              : index;
            upsert({
              id: `local-failed-${nextBatchId}-${batchIndex}`,
              status: "canceled",
              error: "已停止本次生成",
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
        }
        if (mountedRef.current && !isAbortError(error)) setLastError(message);
        throw error;
      } finally {
        controllersRef.current.delete(prepareKey);
        preparationDoneRef.current.delete(prepareKey);
        resolvePreparationDone?.();
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [models, upsert, watchTask],
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

  const scopedTasks = useMemo(
    () => tasks.filter((task) => ecommerceTaskMatchesKind(task, taskKind)),
    [taskKind, tasks],
  );
  const scopedTaskIds = useMemo(
    () => new Set(scopedTasks.map((task) => task.id)),
    [scopedTasks],
  );

  const cancelAll = useCallback(async () => {
    const active = scopedTasks.filter((task) =>
      ACTIVE_STATUSES.has(task.status),
    );
    const pendingControllers = [...controllersRef.current.entries()].filter(
      ([key]) => String(key).startsWith("prepare-"),
    );
    const preparationDone = pendingControllers
      .map(([key]) => preparationDoneRef.current.get(key))
      .filter(Boolean);
    if (!active.length && !pendingControllers.length) return;
    setCancelling(true);
    try {
      pendingControllers.forEach(([, controller]) => controller.abort());
      const settled = await Promise.allSettled(
        active.map((task) => cancelTask(task.id)),
      );
      await Promise.allSettled(preparationDone);
      const canceledIds = [];
      settled.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const taskId = active[index]?.id;
        upsert(result.value);
        if (taskId) {
          canceledIds.push(taskId);
          controllersRef.current.get(taskId)?.abort();
          controllersRef.current.delete(taskId);
        }
      });
      if (canceledIds.length && mountedRef.current) {
        const canceled = new Set(canceledIds);
        setRunningIds((current) => current.filter((id) => !canceled.has(id)));
      }
    } finally {
      if (mountedRef.current) setCancelling(false);
    }
  }, [scopedTasks, upsert]);

  const remove = useCallback(async (taskId) => {
    await deleteTask(taskId, { cascade: true });
    controllersRef.current.get(taskId)?.abort();
    controllersRef.current.delete(taskId);
    if (mountedRef.current)
      setTasks((current) => current.filter((task) => task.id !== taskId));
  }, []);

  const running =
    submitting ||
    runningIds.some((id) => scopedTaskIds.has(id)) ||
    scopedTasks.some((task) => ACTIVE_STATUSES.has(task.status));
  const outputRows = useMemo(
    () =>
      scopedTasks.flatMap((task) =>
        task.outputs.map((url, index) => ({
          task,
          url,
          // 展示图：大图预览用；旧任务没有时直接用原图。
          display: task.displays?.[index] || url,
          preview: task.previews[index] || task.previews[0] || url,
          index: task.batchSize > 1 ? task.batchIndex : index,
          groupId: task.batchId || task.id,
          groupSize: task.batchSize,
          aspectRatio: task.aspectRatio,
          kind: task.kind,
          parentOutputUrl: task.parentOutputUrl,
        })),
      ),
    [scopedTasks],
  );

  return {
    tasks: scopedTasks,
    outputRows,
    running,
    submitting,
    cancelling,
    historyLoading,
    historyError,
    historyHasMore: Boolean(historyCursor),
    refreshHistory: () => loadHistory({ retries: 6 }),
    loadMoreHistory: () => loadHistory({ append: true }),
    lastError,
    clearError: () => setLastError(""),
    quoteBatch,
    createBatch,
    createHandheldBatch,
    retryHandheldItem,
    hydrateHandheldBatch,
    cancelHandheldBatch,
    cancelAll,
    remove,
  };
}
