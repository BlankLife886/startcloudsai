import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelServerAiJob,
  createServerAiJob,
  deleteServerAiJob,
  listServerAiJobs,
  uploadAiInputFile,
  waitForServerAiJob,
} from "@react/legacy-modules/services/aiWallpaper.js";
import {
  coerceImageModelSettings,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { resolveT2iOutputSize } from "@react/legacy-modules/features/ai-wallpaper/composables/wallpaperStudioConstants.js";
import { resolveTaskMedia } from "../task-media/taskMediaResults.js";

const HISTORY_LIMIT = 24;
const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function resultUrls(job = {}, result = null) {
  return resolveTaskMedia(job, result).urls;
}

function taskMeta(job = {}) {
  const input = job.input && typeof job.input === "object" ? job.input : {};
  return {
    groupId: String(input.batchId || input.groupId || job.id || ""),
    index: Math.max(0, Number(input.batchIndex) || 0),
    size: Math.max(1, Number(input.batchSize) || Number(job.count) || 1),
    label: String(input.viewLabel || "").trim() || "设定板",
    viewId: String(input.viewId || "").trim(),
    aspectRatio: String(input.aspectRatio || "16:9"),
    outputMode: String(input.outputMode || "board"),
  };
}

function mergeEntries(current, incoming, prepend = false) {
  const values = prepend ? [...incoming, ...current] : [...current, ...incoming];
  return [...new Map(values.map((entry) => [entry.url, entry])).values()];
}

export function useModelSheetJobs({ model, isAuthenticated }) {
  const mountedRef = useRef(true);
  const historyControllerRef = useRef(null);
  const generationControllerRef = useRef(null);
  const activeJobIdsRef = useRef(new Set());
  const resumeJobIdsRef = useRef(new Set());
  const generationActiveRef = useRef(false);
  const runningRef = useRef(false);
  const pendingActivationGroupRef = useRef("");
  const resumeControllerRef = useRef(null);
  const cursorRef = useRef("");
  const [entries, setEntries] = useState([]);
  const [activeOutput, setActiveOutput] = useState("");
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [batchProgress, setBatchProgress] = useState([]);
  const [executionStartedAt, setExecutionStartedAt] = useState(0);
  const [cancelConfirmationRequired, setCancelConfirmationRequired] = useState(false);

  const markExecutionStarted = useCallback((job = {}) => {
    const currentStatus = String(job.status || "").toLowerCase();
    if (currentStatus !== "running") return;
    const startedAt = Date.parse(job.startedAt || "") || Date.now();
    setExecutionStartedAt((current) => current ? Math.min(current, startedAt) : startedAt);
  }, []);

  const ingestJob = useCallback((job, { activate = false, prepend = false } = {}) => {
    const media = resolveTaskMedia(job);
    const urls = media.urls;
    if (!urls.length) return [];
    const meta = taskMeta(job);
    const incoming = urls.map((url, offset) => ({
      url,
      displayUrl: media.displayByUrl[url] || "",
      previewUrl: media.previewByUrl[url] || url,
      jobId: String(job.id || ""),
      groupId: meta.groupId,
      groupIndex: meta.index + offset,
      groupSize: Math.max(meta.size, urls.length),
      label: meta.label,
      viewId: meta.viewId,
      aspectRatio: meta.aspectRatio,
      outputMode: meta.outputMode,
      createdAt: String(job.createdAt || ""),
    }));
    if (mountedRef.current) {
      setEntries((current) => mergeEntries(current, incoming, prepend));
      if (activate === "if-empty") {
        setActiveOutput((current) => current || urls[0]);
      } else if (activate) {
        setActiveOutput(urls[0]);
      }
    }
    return urls;
  }, []);

  const resumeJob = useCallback(async (job, signal) => {
    const jobId = String(job?.id || "");
    if (!jobId || resumeJobIdsRef.current.has(jobId)) return;
    resumeJobIdsRef.current.add(jobId);
    activeJobIdsRef.current.add(jobId);
    runningRef.current = true;
    if (mountedRef.current) {
      const meta = taskMeta(job);
      setRunning(true);
      setStatus("正在恢复未完成的模型图任务");
      setBatchProgress((current) => {
        if (current.some((item) => item.jobId === jobId)) return current;
        return [...current, {
          jobId,
          label: meta.label,
          status: String(job.status || "queued").toLowerCase() === "running" ? "running" : "pending",
        }];
      });
    }
    try {
      const completed = await waitForServerAiJob(jobId, {
        intervalMs: 2500,
        maxPolls: 260,
        signal,
        onUpdate: (currentJob) => {
          markExecutionStarted(currentJob);
          if (!mountedRef.current) return;
          const nextStatus = String(currentJob?.status || "").toLowerCase();
          setBatchProgress((current) => current.map((item) =>
            item.jobId === jobId
              ? { ...item, status: nextStatus === "running" ? "running" : "pending" }
              : item,
          ));
        },
        onImage: (_partialOutputs, partialJob, partialResult) => {
          if (signal.aborted || !mountedRef.current) return;
          const urls = resultUrls(partialJob, partialResult);
          if (!urls.length) return;
          ingestJob({
            ...partialJob,
            id: jobId,
            originalMediaUrls: urls,
          }, { activate: "if-empty", prepend: true });
        },
      });
      if (signal.aborted || !mountedRef.current) return;
      const completedJob = completed?.job || job;
      const urls = resultUrls(completedJob, completed?.result);
      if (!urls.length) return;
      ingestJob(completedJob, { activate: "if-empty", prepend: true });
      setBatchProgress((current) => current.map((item) =>
        item.jobId === jobId ? { ...item, status: "done" } : item,
      ));
    } catch (caught) {
      if (caught?.name !== "AbortError" && mountedRef.current) {
        setError(caught?.message || "运行中的任务恢复失败");
        setBatchProgress((current) => current.map((item) =>
          item.jobId === jobId
            ? { ...item, status: "failed", message: caught?.message || "恢复失败" }
            : item,
        ));
      }
    } finally {
      resumeJobIdsRef.current.delete(jobId);
      activeJobIdsRef.current.delete(jobId);
      if (!resumeJobIdsRef.current.size && !generationActiveRef.current) {
        runningRef.current = false;
        if (mountedRef.current) {
          setRunning(false);
          setStatus("");
        }
      }
    }
  }, [ingestJob, markExecutionStarted]);

  const loadHistory = useCallback(async ({ reset = true } = {}) => {
    if (!isAuthenticated || historyLoading) return [];
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    setHistoryLoading(true);
    setError("");
    try {
      const response = await listServerAiJobs(HISTORY_LIMIT, {
        kind: "ultra-reference-generation",
        cursor: reset ? "" : cursorRef.current,
        signal: controller.signal,
      });
      if (controller.signal.aborted || !mountedRef.current) return [];
      const jobs = (Array.isArray(response?.jobs) ? response.jobs : [])
        .filter((job) => String(job.kind || "").startsWith("ultra-reference"))
        .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
      const completedEntries = [];
      jobs.forEach((job) => {
        if (ACTIVE_STATUSES.has(String(job.status || "").toLowerCase())) {
          if (!resumeControllerRef.current || resumeControllerRef.current.signal.aborted) {
            resumeControllerRef.current = new AbortController();
          }
          void resumeJob(job, resumeControllerRef.current.signal);
          return;
        }
        if (!["completed", "done", "succeeded"].includes(String(job.status || "").toLowerCase())) return;
        const urls = resultUrls(job);
        const meta = taskMeta(job);
        const media = resolveTaskMedia(job);
        urls.forEach((url, offset) => completedEntries.push({
          url,
          displayUrl: media.displayByUrl[url] || "",
          previewUrl: media.previewByUrl[url] || url,
          jobId: String(job.id || ""),
          groupId: meta.groupId,
          groupIndex: meta.index + offset,
          groupSize: Math.max(meta.size, urls.length),
          label: meta.label,
          viewId: meta.viewId,
          aspectRatio: meta.aspectRatio,
          outputMode: meta.outputMode,
          createdAt: String(job.createdAt || ""),
        }));
      });
      setEntries((current) => reset ? mergeEntries([], completedEntries) : mergeEntries(current, completedEntries));
      setActiveOutput((current) => current || completedEntries[0]?.url || "");
      cursorRef.current = String(response?.pagination?.nextCursor || "");
      setHistoryHasMore(Boolean(response?.pagination?.hasMore && cursorRef.current));
      return completedEntries;
    } catch (caught) {
      if (caught?.name !== "AbortError" && mountedRef.current) {
        setError(caught?.message || "历史记录读取失败，请重试");
      }
      return [];
    } finally {
      if (mountedRef.current) setHistoryLoading(false);
    }
  }, [historyLoading, isAuthenticated, resumeJob]);

  const runOne = useCallback(async ({ item, sourceUrls, groupId, index, size, signal }) => {
    const capabilities = normalizeImageModelCapabilities(model || {});
    const resolutionScale = capabilities.resolutions[0] || "";
    const settings = coerceImageModelSettings(model, {
      aspectRatio: item.aspectRatio,
      resolutionScale,
      quality: item.quality,
      transparentBackground: item.transparentPngEnabled,
      outputFormat: item.transparentPngEnabled ? "png" : undefined,
    });
    const sources = [...new Set((sourceUrls || []).filter(Boolean))].slice(
      0,
      capabilities.maxReferenceImages,
    );
    const sizeValue = resolutionScale && settings.aspectRatio
      ? resolveT2iOutputSize(settings.aspectRatio, resolutionScale)
      : "";
    const shared = {
      source: "ultra-model-sheet",
      sourceUrl: sources[0] || "",
      sourceUrls: sources,
      ...(item.maskUrl ? { maskUrl: item.maskUrl, mask: item.maskUrl } : {}),
      ...(settings.aspectRatio ? { aspectRatio: settings.aspectRatio } : {}),
      ...(sizeValue ? { size: sizeValue, outputSize: sizeValue } : {}),
      ...(resolutionScale ? { resolutionScale } : {}),
      count: 1,
      ...(capabilities.transparentBackground
        ? {
            transparentPngEnabled: settings.transparentBackground,
            transparentBackground: settings.transparentBackground,
          }
        : {}),
      ...(settings.transparentBackground ? { upscaleOutputFormat: "png" } : {}),
      ...(settings.quality ? { quality: settings.quality } : {}),
      ...(settings.outputFormat ? { outputFormat: settings.outputFormat } : {}),
      viewId: String(item.viewId || ""),
      viewLabel: String(item.viewLabel || ""),
      outputMode: String(item.outputMode || "board"),
      iterationMode: item.iterationMode === true,
      parentOutputUrl: String(item.parentOutputUrl || ""),
      batchId: groupId,
      batchIndex: index,
      batchSize: size,
      batchCreatedAt: String(item.batchCreatedAt || new Date().toISOString()),
    };
    const response = await createServerAiJob({
      kind: sources.length ? "ultra-reference-edit" : "ultra-reference-generation",
      clientRequestId: crypto.randomUUID(),
      prompt: String(item.prompt || "").trim(),
      input: shared,
      params: {
        providerHint: model?.publicModelKey ? "" : String(model?.provider || ""),
        modelHint: String(model?.id || ""),
        publicModelKey: String(model?.publicModelKey || model?.id || ""),
        ...shared,
        executionMode: "server",
      },
      units: 1,
      signal,
    });
    const jobId = String(response?.job?.id || "");
    if (!jobId) throw new Error("任务创建后未返回任务 ID");
    activeJobIdsRef.current.add(jobId);
    let streamedUrls = [];
    try {
      const completed = await waitForServerAiJob(jobId, {
        intervalMs: 2500,
        maxPolls: 260,
        signal,
        onUpdate: markExecutionStarted,
        onStatus: (message) => mountedRef.current && setStatus(String(message || "")),
        onImage: (_partialOutputs, partialJob, partialResult) => {
          if (signal.aborted || !mountedRef.current) return;
          const urls = resultUrls(partialJob, partialResult);
          if (!urls.length) return;
          streamedUrls = [...new Set([...streamedUrls, ...urls])];
          const activate = pendingActivationGroupRef.current === groupId;
          if (activate) pendingActivationGroupRef.current = "";
          ingestJob({
            ...partialJob,
            id: jobId,
            originalMediaUrls: urls,
            input: { ...(partialJob?.input || shared), ...shared },
          }, { activate, prepend: true });
        },
      });
      const job = completed?.job || response.job;
      const urls = resultUrls(job, completed?.result).length
        ? resultUrls(job, completed?.result)
        : streamedUrls;
      if (!urls.length) throw new Error("任务已完成，但没有返回可用图片");
      const normalizedJob = {
        ...job,
        id: jobId,
        originalMediaUrls: urls,
        input: { ...(job.input || shared), ...shared },
      };
      const activate = pendingActivationGroupRef.current === groupId;
      if (activate) pendingActivationGroupRef.current = "";
      ingestJob(normalizedJob, { activate, prepend: true });
      return { item, jobId, urls, job: normalizedJob };
    } finally {
      activeJobIdsRef.current.delete(jobId);
    }
  }, [ingestJob, markExecutionStarted, model]);

  const generateBatch = useCallback(async ({
    items,
    files = [],
    sourceUrls = [],
    concurrency = 1,
    chainFirstOutputAsSource = false,
    groupId = crypto.randomUUID(),
  }) => {
    if (runningRef.current || !model || !items?.length) return { outputs: [], failures: [], results: [], groupId };
    runningRef.current = true;
    generationActiveRef.current = true;
    pendingActivationGroupRef.current = groupId;
    generationControllerRef.current?.abort();
    const controller = new AbortController();
    generationControllerRef.current = controller;
    setRunning(true);
    setError("");
    setStatus("正在准备参考图");
    setExecutionStartedAt(0);
    const progress = items.map((item, index) => ({
      label: String(item.viewLabel || `第 ${index + 1} 张`),
      status: "pending",
    }));
    setBatchProgress(progress);
    const updateProgress = (index, next) => {
      if (!mountedRef.current) return;
      setBatchProgress((current) => current.map((entry, at) => at === index ? { ...entry, ...next } : entry));
    };
    try {
      const uploaded = await Promise.all(
        files.filter(Boolean).map((file) => uploadAiInputFile(file, {
          featureKey: "ai.ultraModelSheet",
          signal: controller.signal,
        })),
      );
      let effectiveSources = [...new Set([...uploaded, ...sourceUrls.filter(Boolean)])];
      const results = new Array(items.length);
      const failures = [];
      let cursor = 0;
      const worker = async () => {
        while (cursor < items.length && !controller.signal.aborted) {
          const index = cursor++;
          const item = items[index];
          updateProgress(index, { status: "running" });
          setStatus(`正在生成 ${item.viewLabel || `第 ${index + 1} 张`} · ${index + 1}/${items.length}`);
          try {
            const result = await runOne({
              item,
              sourceUrls: effectiveSources,
              groupId,
              index,
              size: items.length,
              signal: controller.signal,
            });
            results[index] = result;
            updateProgress(index, { status: "done" });
            if (chainFirstOutputAsSource && !effectiveSources.length && result.urls[0]) {
              effectiveSources = [result.urls[0]];
            }
          } catch (caught) {
            if (caught?.name === "AbortError") {
              updateProgress(index, { status: "cancelled" });
              break;
            }
            failures.push({ item, index, message: caught?.message || "生成失败" });
            updateProgress(index, { status: "failed", message: caught?.message || "生成失败" });
          }
        }
      };
      const workers = chainFirstOutputAsSource ? 1 : Math.max(1, Math.min(Number(concurrency) || 1, 4));
      await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker));
      if (mountedRef.current) {
        setStatus(failures.length ? `已完成，${failures.length} 张失败` : "生成完成");
        if (failures.length) setError(failures[0].message);
      }
      return {
        outputs: results.filter(Boolean).flatMap((result) => result.urls),
        failures,
        results: results.filter(Boolean),
        groupId,
      };
    } catch (caught) {
      if (caught?.name !== "AbortError" && mountedRef.current) {
        setError(caught?.message || "模型图生成失败");
      }
      return { outputs: [], failures: [], results: [], groupId };
    } finally {
      generationActiveRef.current = false;
      runningRef.current = false;
      if (pendingActivationGroupRef.current === groupId) pendingActivationGroupRef.current = "";
      if (mountedRef.current) setRunning(false);
    }
  }, [model, runOne]);

  const generateMaskedEdit = useCallback(async ({ sourceUrl, maskFile, prompt, aspectRatio, quality, groupId, groupIndex }) => {
    if (!(maskFile instanceof File) || !maskFile.size) throw new Error("蒙版无效，请重新涂抹");
    if (runningRef.current) throw new Error("当前任务仍在运行，请完成或停止后再试");
    runningRef.current = true;
    generationActiveRef.current = true;
    const controller = new AbortController();
    generationControllerRef.current = controller;
    setRunning(true);
    setStatus("正在上传蒙版");
    try {
      const maskUrl = await uploadAiInputFile(maskFile, {
        featureKey: "ai.ultraModelSheet",
        signal: controller.signal,
      });
      const item = {
        prompt: `${prompt}\n只修改蒙版覆盖的区域，其余部分与原图保持完全一致（构图、比例、光照、材质不变）。`,
        aspectRatio,
        quality,
        transparentPngEnabled: false,
        maskUrl,
        viewLabel: "局部修正",
        outputMode: "mask-edit",
        iterationMode: true,
        parentOutputUrl: sourceUrl,
      };
      const result = await runOne({
        item,
        sourceUrls: [sourceUrl],
        groupId: groupId || crypto.randomUUID(),
        index: Math.max(0, Number(groupIndex) || 0),
        size: Math.max(1, Number(groupIndex) + 1 || 1),
        signal: controller.signal,
      });
      setStatus("修正完成");
      if (result.urls[0]) setActiveOutput(result.urls[0]);
      return result.urls;
    } finally {
      generationActiveRef.current = false;
      runningRef.current = false;
      if (mountedRef.current) setRunning(false);
    }
  }, [runOne]);

  const cancel = useCallback(async ({ acknowledgeUpstream = false } = {}) => {
    if (!running || cancelling) return;
    setCancelling(true);
    setStatus(acknowledgeUpstream ? "正在停止任务" : "正在确认任务阶段");
    const ids = [...activeJobIdsRef.current];
    const settled = await Promise.allSettled(
      ids.map((jobId) => cancelServerAiJob(jobId, { acknowledgeUpstream })),
    );
    const needsConfirmation = settled.some(
      (item) => item.status === "rejected" && item.reason?.code === "task_cancel_confirmation_required",
    );
    if (needsConfirmation && !acknowledgeUpstream) {
      if (mountedRef.current) {
        setCancelConfirmationRequired(true);
        setCancelling(false);
        setStatus("任务已提交上游，请确认是否停止接收结果");
      }
      return;
    }
    generationControllerRef.current?.abort();
    resumeControllerRef.current?.abort();
    resumeJobIdsRef.current.clear();
    generationActiveRef.current = false;
    runningRef.current = false;
    if (mountedRef.current) {
      setRunning(false);
      setCancelling(false);
      setCancelConfirmationRequired(false);
      setStatus("已停止提交后续任务");
    }
  }, [cancelling, running]);

  const deleteEntries = useCallback(async (targets) => {
    const urls = new Set((targets || []).map((entry) => entry.url));
    const jobIds = [...new Set((targets || []).map((entry) => entry.jobId).filter(Boolean))];
    await Promise.all(jobIds.map((jobId) => deleteServerAiJob(jobId)));
    setEntries((current) => current.filter((entry) => !urls.has(entry.url) && !jobIds.includes(entry.jobId)));
    setActiveOutput((current) => urls.has(current) ? "" : current);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historyControllerRef.current?.abort();
      generationControllerRef.current?.abort();
      resumeControllerRef.current?.abort();
      resumeJobIdsRef.current.clear();
      generationActiveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadHistory();
      return undefined;
    }
    historyControllerRef.current?.abort();
    generationControllerRef.current?.abort();
    resumeControllerRef.current?.abort();
    activeJobIdsRef.current.clear();
    resumeJobIdsRef.current.clear();
    generationActiveRef.current = false;
    runningRef.current = false;
    cursorRef.current = "";
    setEntries([]);
    setActiveOutput("");
    setRunning(false);
    setCancelling(false);
    setStatus("");
    setError("");
    setHistoryLoading(false);
    setHistoryHasMore(false);
    setBatchProgress([]);
    setExecutionStartedAt(0);
    setCancelConfirmationRequired(false);
    return undefined;
    // Authentication changes own history refreshes; polling owns later updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  return {
    entries,
    activeOutput,
    setActiveOutput,
    running,
    cancelling,
    status,
    error,
    setError,
    historyLoading,
    historyHasMore,
    batchProgress,
    executionStartedAt,
    cancelConfirmationRequired,
    dismissCancelConfirmation: () => setCancelConfirmationRequired(false),
    loadHistory,
    loadMoreHistory: () => loadHistory({ reset: false }),
    generateBatch,
    generateMaskedEdit,
    cancel,
    deleteEntries,
  };
}
