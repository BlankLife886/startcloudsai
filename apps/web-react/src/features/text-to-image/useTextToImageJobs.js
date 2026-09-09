import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelServerAiJob,
  cancelServerAiJobs,
  createServerAiJob,
  deleteServerAiJob,
  getServerAiJob,
  findServerAiJob,
  listServerAiJobs,
  listActiveServerAiJobs,
  prepareAiInputReference,
  waitForServerAiJob,
} from "@react/legacy-modules/services/aiWallpaper.js";
import { createSubmissionBatch, pendingBatchEntries, submitPendingBatch } from "./submissionBatch.js";
import { readPendingBatch, savePendingBatch } from "./pendingBatchStore.js";
import { submissionFailure, submissionTask } from "./submissionState.js";
import { removeEmptyHistory } from "../history/historyCleanup.js";

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
    clientRequestId: String(job.clientRequestId || ""),
    kind: String(job.kind || "wallpaper-image-generation"),
		status,
		generationStage: String(job.generationStage || ""),
    queueReason: String(job.queueReason || ""),
		cancelPolicy:
			job.cancelPolicy && typeof job.cancelPolicy === "object"
				? { ...job.cancelPolicy }
				: null,
    prompt: String(input.userPrompt || params.userPrompt || job.prompt || ""),
    model: String(job.gatewayModelId || job.model || ""),
    publicModelKey: String(params.publicModelKey || input.publicModelKey || ""),
    sizeMode: String(input.sizeMode || params.sizeMode || ""),
    exactWidth: input.exactWidth ?? params.exactWidth,
    exactHeight: input.exactHeight ?? params.exactHeight,
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
    inputKeys: Array.isArray(job.inputKeys) ? [...job.inputKeys] : [],
    outputKeys: Array.isArray(job.outputKeys) ? [...job.outputKeys] : [],
    thumbnailKeys: Array.isArray(job.thumbnailKeys) ? [...job.thumbnailKeys] : [],
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

export function useTextToImageJobs({ authenticated, userId = "", historyActive = false }) {
  const [tasks, setTasks] = useState([]);
  const [stageLoading, setStageLoading] = useState(Boolean(authenticated));
  const [historyTasks, setHistoryTasks] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyCursor, setHistoryCursor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submissionPhase, setSubmissionPhase] = useState("");
  const [latestBatchId, setLatestBatchId] = useState("");
  const [pendingBatch, setPendingBatch] = useState(null);
  const [clearingEmptyHistory, setClearingEmptyHistory] = useState(false);
  const historyCleanupRef = useRef(null);
  const deletedTaskIdsRef = useRef(new Set());
  const pendingBatchRef = useRef(null);
  const submissionRef = useRef(null);
  const controllersRef = useRef(new Map());
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const scopeKey = authenticated ? String(userId || "authenticated") : "guest";
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };
  const captureScope = useCallback(() => ({ scope: scopeRef.current, generation: generationRef.current }), []);
  const isCurrentScope = useCallback((token) => mountedRef.current && token.scope === scopeRef.current && token.generation === generationRef.current, []);
  const appendingRef = useRef(false);
  const historyReadyRef = useRef(false);

  const persistBatch = useCallback((batch) => {
    savePendingBatch(userId, batch);
    const pending = pendingBatchEntries(batch).length ? batch : null;
    pendingBatchRef.current = pending;
    setPendingBatch(pending ? { ...pending } : null);
  }, [userId]);

  const upsertTask = useCallback((next) => {
    if (!next?.id || !mountedRef.current || deletedTaskIdsRef.current.has(next.id)) return;
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
      if (!next.serverJobId) return current.filter(item => item.id !== next.id);
      if (!current.some((item) => item.id === next.id) && !insertHistory) return current;
      return upsertInto(current, next);
    });
  }, []);

  const watchJob = useCallback(
    (task) => {
      const token = captureScope();
      const jobId = String(task?.serverJobId || task?.id || "");
      if (!jobId || controllersRef.current.has(jobId)) return;
      const controller = new AbortController();
      controllersRef.current.set(jobId, controller);
      void waitForServerAiJob(jobId, {
        signal: controller.signal,
        maxWaitMs: null,
        terminalAsResult: true,
        onUpdate(job, result) {
          if (!isCurrentScope(token)) return;
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
          if (!isCurrentScope(token)) return;
          upsertTask(taskFromJob(job, { result: { ...result, outputs: urls } }));
        },
      })
        .then(({ job, result }) => {
          if (isCurrentScope(token)) upsertTask(taskFromJob(job, { result }));
        })
        .catch((error) => {
          if (error?.name === "AbortError") return;
          // Only persisted snapshots may change the task's business status.
          console.warn("Task monitoring interrupted", jobId, error);
        })
        .finally(() => {
          if (controllersRef.current.get(jobId) === controller) controllersRef.current.delete(jobId);
        });
    },
    [captureScope, isCurrentScope, upsertTask],
  );

  const reconcileBatch = useCallback(async (batch) => {
    const token = captureScope();
    const controller = new AbortController();
    controllersRef.current.set("batch-recovery", controller);
    const timer = globalThis.setTimeout(() => controller.abort(), 12000);
    setSubmissionPhase("recovering");
    try {
      const entries = batch.entries.filter(entry => !entry.discarded);
      const snapshots = await Promise.allSettled(entries.map(entry => findServerAiJob(entry.payload.clientRequestId, { signal: controller.signal })));
      if (!isCurrentScope(token)) throw new DOMException("账号已切换", "AbortError");
      snapshots.forEach((result, index) => {
        const entry = entries[index];
        if (result.status === "fulfilled" && result.value.job) {
          entry.task = taskFromJob(result.value.job);
          entry.error = null;
        } else if (!entry.task && result.status === "rejected") {
          entry.error = { code: "task_submission_uncertain", message: "暂时无法核对提交结果，请恢复连接后重试" };
        }
        const next = entry.task || submissionTask(entry, batch);
        setTasks(current => upsertInto(current.filter(task => task.id !== entry.payload.clientRequestId), next));
        if (entry.task) {
          setHistoryTasks(current => upsertInto(current.filter(task => task.id !== entry.payload.clientRequestId), next));
          if (ACTIVE_STATUSES.has(next.status)) watchJob(next);
        }
      });
      persistBatch(batch);
      return batch;
    } finally {
      globalThis.clearTimeout(timer);
      if (controllersRef.current.get("batch-recovery") === controller) controllersRef.current.delete("batch-recovery");
      if (isCurrentScope(token)) setSubmissionPhase("");
    }
  }, [captureScope, isCurrentScope, persistBatch, watchJob]);

  const loadStage = useCallback(async () => {
    if (!authenticated) {
      setTasks([]);
      setStageLoading(false);
      return;
    }
    const token = captureScope();
    const controller = new AbortController();
    controllersRef.current.set("stage-list", controller);
    setStageLoading(true);
    try {
      const [response, active] = await Promise.all([
        listServerAiJobs(30, { type: "t2i", signal: controller.signal }),
        listActiveServerAiJobs({ type: "t2i", signal: controller.signal }),
      ]);
      if (!isCurrentScope(token)) return;
      const incoming = [...new Map([...(response.jobs || []), ...active].map(job => [job.id, job])).values()].map((job) => taskFromJob(job)).filter((task) => !deletedTaskIdsRef.current.has(task.id));
      setTasks((current) => mergeTaskPages(current, incoming, { append: false }));
      incoming.filter((item) => ACTIVE_STATUSES.has(item.status)).forEach(watchJob);
    } catch (error) {
      if (isCurrentScope(token) && error?.name !== "AbortError") console.warn("Task list unavailable", error);
    } finally {
      if (controllersRef.current.get("stage-list") === controller) controllersRef.current.delete("stage-list");
      if (isCurrentScope(token)) setStageLoading(false);
    }
  }, [authenticated, captureScope, isCurrentScope, watchJob]);

  const loadHistory = useCallback(
    async ({ append = false } = {}) => {
      if (!authenticated) {
        setHistoryTasks([]);
        setHistoryLoading(false);
        setHistoryLoadingMore(false);
        historyReadyRef.current = false;
        return;
      }
      const token = captureScope();
      if (append) {
        if (appendingRef.current || !historyHasMore) return;
        appendingRef.current = true;
        setHistoryLoadingMore(true);
      } else {
        setHistoryLoading(true);
      }
      const controller = new AbortController();
      controllersRef.current.get("history-list")?.abort();
      controllersRef.current.set("history-list", controller);
      try {
        const response = await listServerAiJobs(24, {
          type: "t2i",
          cursor: append ? historyCursor : "",
          signal: controller.signal,
        });
        if (!isCurrentScope(token) || controller.signal.aborted) return;
        const incoming = (response.jobs || []).map((job) => taskFromJob(job)).filter((task) => !deletedTaskIdsRef.current.has(task.id));
        setHistoryTasks((current) => mergeTaskPages(current, incoming, { append }));
        historyReadyRef.current = true;
        const nextCursor = String(response.pagination?.nextCursor || "");
        setHistoryCursor(nextCursor);
        setHistoryHasMore(Boolean(nextCursor));
        incoming.filter((item) => ACTIVE_STATUSES.has(item.status)).forEach(watchJob);
      } catch (error) {
        if (isCurrentScope(token) && error?.name !== "AbortError") console.warn("Task history unavailable", error);
      } finally {
        if (controllersRef.current.get("history-list") === controller) controllersRef.current.delete("history-list");
        if (isCurrentScope(token) && !controller.signal.aborted) {
          appendingRef.current = false;
          setHistoryLoading(false);
          setHistoryLoadingMore(false);
        }
      }
    },
    [authenticated, captureScope, historyCursor, historyHasMore, isCurrentScope, watchJob],
  );

  const loadMoreHistory = useCallback(() => {
    void loadHistory({ append: true });
  }, [loadHistory]);

  const refreshHistory = useCallback(() => {
    void loadHistory({ append: false });
  }, [loadHistory]);

  useEffect(() => {
    mountedRef.current = true;
    generationRef.current += 1;
    historyReadyRef.current = false;
    appendingRef.current = false;
    pendingBatchRef.current = null;
    submissionRef.current = null;
    historyCleanupRef.current = null;
    deletedTaskIdsRef.current = new Set();
    setClearingEmptyHistory(false);
    setPendingBatch(null);
    setSubmitting(false);
    setSubmissionPhase("");
    setTasks([]);
    setHistoryTasks([]);
    setHistoryLoading(false);
    setHistoryLoadingMore(false);
    setHistoryCursor("");
    setHistoryHasMore(false);
    const recovered = authenticated ? readPendingBatch(userId) : null;
    if (recovered) {
      pendingBatchRef.current = recovered;
      setPendingBatch(recovered);
      setTasks(recovered.entries.filter(entry => !entry.discarded).map(entry => entry.task || submissionTask(entry, recovered)));
      setLatestBatchId(recovered.batchId || recovered.entries[0]?.payload.clientRequestId || "");
      void reconcileBatch(recovered).catch(error => { if (error?.name !== "AbortError") console.warn("Task submission recovery unavailable", error); });
    }
    void loadStage();
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
    };
    // Initial stage hydration only. History feed loads when that tab is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, scopeKey]);

  useEffect(() => {
    if (!authenticated || !historyActive || historyReadyRef.current) return undefined;
    void loadHistory({ append: false });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, scopeKey, historyActive]);

  const uploadReferences = useCallback(async (references, signal, isCurrentSession, onReferencePrepared) => {
    return Promise.all(
      references.map(async (item) => {
        const prepared = await prepareAiInputReference(item, { signal, isCurrentSession });
        if (isCurrentSession()) onReferencePrepared?.(item.id, prepared);
        return prepared.url;
      }),
    );
  }, []);

  const createBatch = useCallback(
    async ({ count = 1, references = [], buildPayload, retryBatch = null, confirmedUnitPrice = null, onReferencePrepared }) => {
      if (submissionRef.current) return submissionRef.current.promise;
      const token = captureScope();
      const isCurrentSession = () => isCurrentScope(token);
      const assertCurrent = () => {
        if (!isCurrentSession()) throw new DOMException("账号已切换或页面已关闭", "AbortError");
      };
      assertCurrent();
      const preparation = new AbortController();
      controllersRef.current.set("prepare-batch", preparation);
      const operation = { promise: null };
      submissionRef.current = operation;
      setSubmitting(true);
      operation.promise = (async () => {
        let batch = retryBatch || pendingBatchRef.current;
        try {
          if (batch) await reconcileBatch(batch);
          assertCurrent();
          if (!batch) {
            setSubmissionPhase(references.length ? "uploading" : "submitting");
            const sourceUrls = await uploadReferences(references, preparation.signal, isCurrentSession, onReferencePrepared);
            assertCurrent();
            batch = createSubmissionBatch({ count, sourceUrls, buildPayload });
          }
          persistBatch(batch);
          setLatestBatchId(batch.batchId || batch.entries[0]?.payload.clientRequestId || "");
          setSubmissionPhase("submitting");
          const result = await submitPendingBatch(batch, async (payload) => {
            assertCurrent();
            const optimisticId = payload.clientRequestId;
            const { batchId, batchIndex, batchSize } = payload.input;
            upsertTask(submissionTask({ payload }, batch, "submitting"));
            try {
              const response = await createServerAiJob({ ...payload, isCurrentSession });
              assertCurrent();
              const next = taskFromJob(response.job, { batchId, batchIndex, batchSize });
              // An idempotent recovery may already return a completed task.
              // Replace the optimistic row atomically, including terminal results.
              setTasks((current) => upsertInto(current.filter((item) => item.id !== optimisticId), next));
              setHistoryTasks((current) => upsertInto(current.filter((item) => item.id !== optimisticId), next));
              if (ACTIVE_STATUSES.has(next.status)) watchJob(next);
              return next;
            } catch (error) {
              if (isCurrentSession()) {
                upsertTask(submissionTask({ payload, error }, batch));
              }
              throw error;
            }
          }, { confirmedUnitPrice, onChange: (updated) => { if (isCurrentSession()) persistBatch(updated); } });
          assertCurrent();
          persistBatch(null);
          return result;
        } catch (error) {
          if (isCurrentSession() && error.batch) persistBatch(error.batch);
          throw error;
        } finally {
          if (controllersRef.current.get("prepare-batch") === preparation) controllersRef.current.delete("prepare-batch");
          if (submissionRef.current === operation) submissionRef.current = null;
          if (isCurrentSession()) { setSubmitting(false); setSubmissionPhase(""); }
        }
      })();
      return operation.promise;
    },
    [captureScope, isCurrentScope, uploadReferences, upsertTask, watchJob, persistBatch, reconcileBatch],
  );

  const discardPendingBatch = useCallback(() => {
    if (submissionRef.current) return;
    const ids = new Set((pendingBatchRef.current?.entries || []).filter((entry) => !entry.task).map((entry) => entry.payload.clientRequestId));
    persistBatch(null);
    setTasks((current) => current.filter((item) => !ids.has(item.id)));
    setHistoryTasks((current) => current.filter((item) => !ids.has(item.id)));
  }, [persistBatch]);

  const refreshTask = useCallback(async (task) => {
    const token = captureScope();
    const response = await getServerAiJob(String(task?.serverJobId || task?.id || ""));
    if (!isCurrentScope(token)) throw new DOMException("账号已切换", "AbortError");
    const next = taskFromJob(response.job);
    upsertTask(next);
    return next;
  }, [captureScope, isCurrentScope, upsertTask]);

	const cancelTask = useCallback(async (task, { acknowledgeUpstream = false } = {}) => {
		const token = captureScope();
		const id = String(task?.serverJobId || "");
		if (!id) return;
		const response = await cancelServerAiJob(id, { acknowledgeUpstream });
		if (!isCurrentScope(token)) throw new DOMException("账号已切换", "AbortError");
		controllersRef.current.get(id)?.abort();
		controllersRef.current.delete(id);
		upsertTask(
			taskFromJob(
				response.job || response.task || { ...task, id, status: "cancelled" },
			),
		);
		return response.job;
	}, [captureScope, isCurrentScope, upsertTask]);

  const removeTask = useCallback(async (task, { onlyEmpty = false } = {}) => {
    const token = captureScope();
    if (!isCurrentScope(token)) throw new DOMException("账号已切换", "AbortError");
    const id = String(task?.serverJobId || "");
    if (!id && pendingBatchRef.current) {
      const batch = pendingBatchRef.current;
      const entry = batch.entries.find(entry => entry.payload.clientRequestId === task.id);
      if (entry) { entry.discarded = true; persistBatch(batch); }
    }
    if (id) {
      try {
        await deleteServerAiJob(id, { onlyEmpty });
      } catch (error) {
        if (error?.code !== "task_not_found") throw error;
      }
    }
    if (!isCurrentScope(token)) throw new DOMException("账号已切换", "AbortError");
    deletedTaskIdsRef.current.add(task.id);
    controllersRef.current.get(id)?.abort();
    controllersRef.current.delete(id);
    if (mountedRef.current) {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setHistoryTasks((current) => current.filter((item) => item.id !== task.id));
    }
  }, [captureScope, isCurrentScope, persistBatch]);

  const cancelTasks = useCallback(async (tasks, { acknowledgedTaskIds = [] } = {}) => {
    const token = captureScope();
    const ids = tasks.map(task => task.serverJobId).filter(Boolean);
    const result = await cancelServerAiJobs(ids, { acknowledgedTaskIds });
    if (!isCurrentScope(token)) throw new DOMException("账号已切换", "AbortError");
    return result.jobs.map(job => {
      const next = taskFromJob(job);
      if (!ACTIVE_STATUSES.has(next.status)) {
        controllersRef.current.get(next.id)?.abort();
        controllersRef.current.delete(next.id);
      }
      upsertTask(next);
      return next;
    });
  }, [captureScope, isCurrentScope, upsertTask]);

  const clearEmptyHistory = useCallback(() => {
    if (historyCleanupRef.current) return historyCleanupRef.current.promise;
    const token = captureScope();
    const assertCurrent = () => {
      if (!authenticated || !isCurrentScope(token)) throw new DOMException("账号已切换", "AbortError");
    };
    assertCurrent();
    const controller = new AbortController();
    controllersRef.current.set("history-cleanup", controller);
    const operation = { promise: null };
    historyCleanupRef.current = operation;
    setClearingEmptyHistory(true);
    operation.promise = removeEmptyHistory({
      assertCurrent,
      removeTask,
      listPage: async (cursor) => {
        const response = await listServerAiJobs(100, { type: "t2i", cursor, signal: controller.signal });
        return { tasks: (response.jobs || []).map((job) => taskFromJob(job)), nextCursor: response.pagination?.nextCursor };
      },
    }).finally(() => {
      if (controllersRef.current.get("history-cleanup") === controller) controllersRef.current.delete("history-cleanup");
      if (historyCleanupRef.current === operation) historyCleanupRef.current = null;
      if (isCurrentScope(token)) setClearingEmptyHistory(false);
    });
    return operation.promise;
  }, [authenticated, captureScope, isCurrentScope, removeTask]);

  return {
    tasks,
    historyTasks,
    submitting,
    submissionPhase,
    latestBatchId,
    pendingBatch,
    clearingEmptyHistory,
    clearEmptyHistory,
    stageLoading,
    historyLoading,
    historyLoadingMore,
    historyHasMore,
    loadMoreHistory,
    refreshHistory,
    createBatch,
    discardPendingBatch,
    refreshTask,
    cancelTask,
    cancelTasks,
    removeTask,
  };
}
