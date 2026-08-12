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
    batchId: String(input.batchId || params.batchId || job.batchId || ""),
    batchIndex: Math.max(
      0,
      Number(input.batchIndex ?? params.batchIndex ?? job.batchIndex ?? 0) || 0,
    ),
    batchSize,
    outputs: urls,
    thumbnailOutputs: Array.isArray(job.resultMediaUrls)
      ? job.resultMediaUrls.filter(Boolean)
      : urls,
    createdAt: job.createdAt || new Date().toISOString(),
    startedAt: job.startedAt || "",
    finishedAt: job.finishedAt || "",
    error: String(job.error || ""),
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

export function useTextToImageJobs({ authenticated }) {
  const [tasks, setTasks] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(Boolean(authenticated));
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const controllersRef = useRef(new Map());
  const mountedRef = useRef(true);

  const upsertTask = useCallback((next) => {
    if (!next?.id || !mountedRef.current) return;
    setTasks((current) => {
      const existing = current.find((item) => item.id === next.id);
      const merged = existing ? { ...existing, ...next } : next;
      return newestFirst([
        merged,
        ...current.filter((item) => item.id !== next.id),
      ]);
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

  const loadHistory = useCallback(
    async ({ append = false } = {}) => {
      if (!authenticated) {
        setTasks([]);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(true);
      try {
        const response = await listServerAiJobs(append ? 20 : 12, {
          type: "t2i",
          cursor: append ? historyCursor : "",
        });
        if (!mountedRef.current) return;
        const incoming = (response.jobs || []).map((job) => taskFromJob(job));
        setTasks((current) => {
          const rows = append ? [...current, ...incoming] : incoming;
          return newestFirst(
            Array.from(new Map(rows.map((item) => [item.id, item])).values()),
          );
        });
        const nextCursor = String(response.pagination?.nextCursor || "");
        setHistoryCursor(nextCursor);
        setHistoryHasMore(Boolean(nextCursor));
        incoming.filter((item) => ACTIVE_STATUSES.has(item.status)).forEach(watchJob);
      } finally {
        if (mountedRef.current) setHistoryLoading(false);
      }
    },
    [authenticated, historyCursor, watchJob],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadHistory();
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    };
    // Initial hydration only. Further pages are explicitly requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

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
              upsertTask(next);
              watchJob(next);
            }
            return next;
          } catch (error) {
            upsertTask({
              id: optimisticId,
              status: "failed",
              error: error?.message || "任务提交失败",
              finishedAt: new Date().toISOString(),
            });
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
    }
  }, []);

  return {
    tasks,
    submitting,
    historyLoading,
    historyHasMore,
    loadMoreHistory: () => loadHistory({ append: true }),
    refreshHistory: () => loadHistory({ append: false }),
    createBatch,
    cancelTask,
    removeTask,
  };
}
