import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelServerAiJob,
  createServerAiJob,
  deleteServerAiJob,
  listServerAiJobs,
  uploadAiInputFile,
  waitForServerAiJob,
} from "@react/legacy-modules/services/aiWallpaper.js";

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function outputUrls(job = {}, result = {}) {
  const originals = Array.isArray(job.originalMediaUrls)
    ? job.originalMediaUrls
    : [];
  const results = Array.isArray(result.outputs) ? result.outputs : [];
  const previews = Array.isArray(job.resultMediaUrls)
    ? job.resultMediaUrls
    : [];
  const fullSize = [...originals, ...results].map(String).filter(Boolean);
  return Array.from(
    new Set((fullSize.length ? fullSize : previews).map(String).filter(Boolean)),
  );
}

function taskFromJob(job = {}, patch = {}) {
  const status = String(job.status || "queued").toLowerCase();
  const urls = outputUrls(job, patch.result);
  const input = job.input && typeof job.input === "object" ? job.input : {};
  const params = job.params && typeof job.params === "object" ? job.params : {};
  const batchSize = Math.max(
    1,
    Number(input.batchSize ?? params.batchSize ?? job.batchSize ?? 1) || 1,
  );
  const originalOutputs = Array.isArray(job.originalMediaUrls)
    ? job.originalMediaUrls.filter(Boolean)
    : urls;
  // 展示图：大图预览用，与原图按下标对应；旧任务为空数组，取用时回退原图。
  const displayOutputs = Array.isArray(job.displayMediaUrls)
    ? job.displayMediaUrls.filter(Boolean)
    : [];
  const hasDedicatedThumbnails = Array.isArray(job.thumbnailKeys) && job.thumbnailKeys.length > 0;
  const thumbnailOutputs = hasDedicatedThumbnails && Array.isArray(job.resultMediaUrls)
    ? job.resultMediaUrls.filter(Boolean)
    : [];
  return {
    id: String(job.id || job.taskId || ""),
    serverJobId: String(job.id || job.taskId || ""),
    kind: String(job.kind || "wallpaper-image-generation"),
    status,
    prompt: String(input.userPrompt || params.userPrompt || job.prompt || ""),
    model: String(job.gatewayModelId || job.model || ""),
    publicModelKey: String(params.publicModelKey || input.publicModelKey || ""),
    aspectRatio: String(input.aspectRatio || params.aspectRatio || "1:1"),
    outputSize: String(input.outputSize || params.outputSize || ""),
    actualOutputSize: String(job.actualOutputSize || job.result?.actualOutputSize || ""),
    originalOutputUrl: String(
      input.originalOutputUrl || params.originalOutputUrl || "",
    ),
    originalOutputSize: String(
      input.originalOutputSize || params.originalOutputSize || "",
    ),
    resolutionScale: String(input.resolutionScale || params.resolutionScale || ""),
    imageQuality: String(input.quality || params.quality || ""),
    outputFormat: String(input.outputFormat || params.outputFormat || ""),
    moderationLevel: String(input.moderationLevel || params.moderationLevel || ""),
    promptPolishEnabled: input.promptPolishEnabled === true,
    autoTranslateEnabled: input.autoTranslateEnabled === true,
    transparentPngEnabled:
      input.transparentPngEnabled === true || input.transparentBackground === true,
    autoBackgroundRemovalEnabled: input.autoBackgroundRemovalEnabled === true,
    automaticBackgroundRemoval: input._automatic === true,
    batchId: String(input.batchId || params.batchId || job.batchId || ""),
    batchIndex: Math.max(
      0,
      Number(input.batchIndex ?? params.batchIndex ?? job.batchIndex ?? 0) || 0,
    ),
    batchSize,
    outputs: urls,
    originalOutputs,
    displayOutputs,
    thumbnailOutputs,
    hasDedicatedThumbnails,
    createdAt: job.createdAt || new Date().toISOString(),
    startedAt: job.startedAt || "",
    finishedAt: job.finishedAt || "",
    error: String(job.error || ""),
    errorCode: String(job.errorCode || ""),
    input,
    params,
    ...patch,
  };
}

function newestFirst(tasks) {
  return [...tasks].sort(
    (left, right) =>
      Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0),
  );
}

function upsertInto(current, next) {
  const existing = current.find((item) => item.id === next.id);
  const merged = existing ? { ...existing, ...next } : next;
  return newestFirst([
    merged,
    ...current.filter((item) => item.id !== next.id),
  ]);
}

function mergeTaskPages(current, incoming, { append = false } = {}) {
  const rows = append ? [...current, ...incoming] : incoming;
  const byId = new Map(rows.map((item) => [item.id, item]));
  if (!append) {
    current.forEach((item) => {
      if (
        !byId.has(item.id) &&
        (ACTIVE_STATUSES.has(item.status) || !item.serverJobId)
      ) {
        byId.set(item.id, item);
      }
    });
  }
  return newestFirst(Array.from(byId.values()));
}

export function useTextToImageJobs({ authenticated, historyActive = false }) {
  const [tasks, setTasks] = useState([]);
  const [stageLoading, setStageLoading] = useState(Boolean(authenticated));
  const [historyTasks, setHistoryTasks] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const controllersRef = useRef(new Map());
  const mountedRef = useRef(true);
  const appendingRef = useRef(false);
  const historyReadyRef = useRef(false);

  const upsertTask = useCallback((next) => {
    if (!next?.id || !mountedRef.current) return;
    const insertStage = ACTIVE_STATUSES.has(next.status) || !next.serverJobId;
    const insertHistory =
      historyReadyRef.current ||
      ACTIVE_STATUSES.has(next.status) ||
      !next.serverJobId;
    setTasks((current) => {
      if (!current.some((item) => item.id === next.id) && !insertStage) return current;
      return upsertInto(current, next);
    });
    setHistoryTasks((current) => {
      if (!current.some((item) => item.id === next.id) && !insertHistory) return current;
      return upsertInto(current, next);
    });
  }, []);

  const watchJob = useCallback(
    (task) => {
      const jobId = String(task?.serverJobId || task?.id || "");
      if (!jobId || controllersRef.current.has(jobId)) return;
      const controller = new AbortController();
      controllersRef.current.set(jobId, controller);
      void waitForServerAiJob(jobId, {
        signal: controller.signal,
        onUpdate(job, result) {
          const status = String(job?.status || "queued").toLowerCase();
          upsertTask(
            taskFromJob(job, {
              result,
              // 排队阶段没有开始时间，不显示为生成耗时。
              startedAt: status === "queued" ? "" : job.startedAt || "",
            }),
          );
        },
        onImage(urls, job, result) {
          upsertTask(taskFromJob(job, { result: { ...result, outputs: urls } }));
        },
      })
        .then(({ job, result }) => upsertTask(taskFromJob(job, { result })))
        .catch((error) => {
          if (error?.name === "AbortError") return;
          upsertTask({
            ...task,
            status: "failed",
            error: error?.message || "任务执行失败",
            finishedAt: new Date().toISOString(),
          });
        })
        .finally(() => controllersRef.current.delete(jobId));
    },
    [upsertTask],
  );

  const loadStage = useCallback(async () => {
    if (!authenticated) {
      setTasks([]);
      setStageLoading(false);
      return;
    }
    setStageLoading(true);
    try {
      const response = await listServerAiJobs(30, { type: "t2i" });
      if (!mountedRef.current) return;
      const incoming = (response.jobs || []).map((job) => taskFromJob(job));
      setTasks((current) => mergeTaskPages(current, incoming, { append: false }));
      incoming.filter((item) => ACTIVE_STATUSES.has(item.status)).forEach(watchJob);
    } finally {
      if (mountedRef.current) setStageLoading(false);
    }
  }, [authenticated, watchJob]);

  const loadHistory = useCallback(
    async ({ append = false } = {}) => {
      if (!authenticated) {
        setHistoryTasks([]);
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
        historyReadyRef.current = false;
        return;
      }
      if (append) {
        if (appendingRef.current || !historyHasMore) return;
        appendingRef.current = true;
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }
      try {
        const response = await listServerAiJobs(24, {
          type: "t2i",
          cursor: append ? historyCursor : "",
        });
        if (!mountedRef.current) return;
        const incoming = (response.jobs || []).map((job) => taskFromJob(job));
        setHistoryTasks((current) => mergeTaskPages(current, incoming, { append }));
        historyReadyRef.current = true;
        const nextCursor = String(response.pagination?.nextCursor || "");
        setHistoryCursor(nextCursor);
        setHistoryHasMore(Boolean(nextCursor));
        incoming.filter((item) => ACTIVE_STATUSES.has(item.status)).forEach(watchJob);
      } finally {
        appendingRef.current = false;
        if (mountedRef.current) {
          setHistoryLoading(false);
          setHistoryLoadingMore(false);
        }
      }
    },
    [authenticated, historyCursor, historyHasMore, watchJob],
  );

  const loadMoreHistory = useCallback(() => {
    void loadHistory({ append: true });
  }, [loadHistory]);

  const refreshHistory = useCallback(() => {
    void loadHistory({ append: false });
  }, [loadHistory]);

  useEffect(() => {
    mountedRef.current = true;
    historyReadyRef.current = false;
    setHistoryTasks([]);
    setHistoryCursor("");
    setHistoryHasMore(false);
    void loadStage();
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    };
    // Initial stage hydration only. History feed loads when that tab is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !historyActive || historyReadyRef.current) return undefined;
    void loadHistory({ append: false });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, historyActive]);

  const uploadReferences = useCallback(async (references, signal) => {
    return Promise.all(
      references.map(async (item) => {
        if (item.url) return item.url;
        if (!item.file) throw new Error("参考图已失效，请重新选择");
        return uploadAiInputFile(item.file, { signal });
      }),
    );
  }, []);

  const createBatch = useCallback(
    async ({ count = 1, references = [], buildPayload }) => {
      const batchSize = Math.min(4, Math.max(1, Number(count) || 1));
      const batchId = batchSize > 1 ? `batch-${Date.now()}` : "";
      const batchCreatedAt = new Date().toISOString();
      const preparation = new AbortController();
      controllersRef.current.set(`prepare-${batchCreatedAt}`, preparation);
      setSubmitting(true);
      try {
        const sourceUrls = await uploadReferences(references, preparation.signal);
        const submissions = Array.from({ length: batchSize }, async (_, batchIndex) => {
          const payload = buildPayload({
            sourceUrls,
            batchId,
            batchIndex,
            batchSize,
            batchCreatedAt,
          });
          const optimisticId = payload.clientRequestId;
          upsertTask({
            id: optimisticId,
            serverJobId: "",
            kind: payload.kind,
            status: "queued",
            prompt: payload.input?.userPrompt || payload.prompt,
            model: payload.params?.publicModelKey || payload.params?.modelHint || "",
            aspectRatio: payload.input?.aspectRatio || "1:1",
            outputSize: payload.input?.outputSize || "",
            outputs: [],
            thumbnailOutputs: [],
            createdAt: batchCreatedAt,
            startedAt: "",
            finishedAt: "",
            batchId,
            batchIndex,
            batchSize,
          });
          try {
            const response = await createServerAiJob(payload);
            const next = taskFromJob(response.job, {
              batchId,
              batchIndex,
              batchSize,
            });
            if (mountedRef.current) {
              setTasks((current) => current.filter((item) => item.id !== optimisticId));
              setHistoryTasks((current) => current.filter((item) => item.id !== optimisticId));
              upsertTask(next);
              watchJob(next);
            }
            return next;
          } catch (error) {
            if (error?.code === "price_changed") {
              if (mountedRef.current) {
                setTasks((current) => current.filter((item) => item.id !== optimisticId));
                setHistoryTasks((current) => current.filter((item) => item.id !== optimisticId));
              }
            } else {
              upsertTask({
                id: optimisticId,
                status: "failed",
                error: error?.message || "任务提交失败",
                finishedAt: new Date().toISOString(),
              });
            }
            throw error;
          }
        });
        return await Promise.all(submissions);
      } finally {
        controllersRef.current.delete(`prepare-${batchCreatedAt}`);
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [uploadReferences, upsertTask, watchJob],
  );

  const cancelTask = useCallback(async (task) => {
    const id = String(task?.serverJobId || "");
    if (!id) return;
    controllersRef.current.get(id)?.abort();
    controllersRef.current.delete(id);
    const response = await cancelServerAiJob(id);
    upsertTask(
      taskFromJob(
        response.job || response.task || { ...task, id, status: "cancelled" },
      ),
    );
  }, [upsertTask]);

  const removeTask = useCallback(async (task) => {
    const id = String(task?.serverJobId || "");
    if (id) await deleteServerAiJob(id);
    controllersRef.current.get(id)?.abort();
    controllersRef.current.delete(id);
    if (mountedRef.current) {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setHistoryTasks((current) => current.filter((item) => item.id !== task.id));
    }
  }, []);

  return {
    tasks,
    historyTasks,
    submitting,
    stageLoading,
    historyLoading,
    historyLoadingMore,
    historyHasMore,
    loadMoreHistory,
    refreshHistory,
    createBatch,
    cancelTask,
    removeTask,
  };
}
