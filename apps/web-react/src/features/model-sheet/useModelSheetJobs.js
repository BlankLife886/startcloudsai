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
import {
  GPT_IMAGE_OUTPUT_LIMITS,
  normalizeGptImageOutputSize,
} from "@react/legacy-modules/services/aiImageOutputSize.js";

const HISTORY_LIMIT = 24;
const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function resultUrls(job = {}, result = null) {
  const originals = [
    ...(Array.isArray(job.originalMediaUrls) ? job.originalMediaUrls : []),
    job.originalMediaUrl,
  ];
  const resultValues = [
    ...(Array.isArray(result?.outputs) ? result.outputs : []),
    ...(Array.isArray(job.resultMediaUrls) ? job.resultMediaUrls : []),
    job.resultMediaUrl,
  ];
  const values = originals.some(Boolean) ? [...originals, ...resultValues] : resultValues;
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 4);
}

function previewUrls(job = {}, originals = []) {
  const thumbnails = [
    ...(Array.isArray(job.resultMediaUrls) ? job.resultMediaUrls : []),
    job.resultMediaUrl,
  ].filter(Boolean);
  return Object.fromEntries(
    originals.map((url, index) => [url, thumbnails[index] || thumbnails[0] || url]),
  );
}

function outputSize(aspectRatio = "16:9", longSide = 1536) {
  const [rawWidth = 16, rawHeight = 9] = String(aspectRatio).split(":").map(Number);
  const ratioWidth = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1;
  const ratioHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
  const edge = Math.max(1024, Math.min(longSide, GPT_IMAGE_OUTPUT_LIMITS.maxEdge));
  const width = ratioWidth >= ratioHeight ? edge : (edge * ratioWidth) / ratioHeight;
  const height = ratioWidth >= ratioHeight ? (edge * ratioHeight) / ratioWidth : edge;
  const normalized = normalizeGptImageOutputSize(width, height);
  return `${normalized.width}x${normalized.height}`;
}

function taskMeta(job = {}) {
  const input = job.input && typeof job.input === "object" ? job.input : {};
  return {
    groupId: String(input.batchId || input.groupId || job.id || ""),
    index: Math.max(0, Number(input.batchIndex) || 0),
    size: Math.max(1, Number(input.batchSize) || Number(job.count) || 1),
    label: String(input.viewLabel || "").trim() || "设定板",
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

  const markExecutionStarted = useCallback((job = {}) => {
    const currentStatus = String(job.status || "").toLowerCase();
    if (currentStatus !== "running") return;
    const startedAt = Date.parse(job.startedAt || "") || Date.now();
    setExecutionStartedAt((current) => current ? Math.min(current, startedAt) : startedAt);
  }, []);

  const ingestJob = useCallback((job, { activate = false, prepend = false } = {}) => {
    const urls = resultUrls(job);
    if (!urls.length) return [];
    const meta = taskMeta(job);
    const previews = previewUrls(job, urls);
    const incoming = urls.map((url, offset) => ({
      url,
      previewUrl: previews[url] || url,
      jobId: String(job.id || ""),
      groupId: meta.groupId,
      groupIndex: meta.index + offset,
      groupSize: Math.max(meta.size, urls.length),
      label: meta.label,
      aspectRatio: meta.aspectRatio,
      outputMode: meta.outputMode,
      createdAt: String(job.createdAt || ""),
    }));
    if (mountedRef.current) {
      setEntries((current) => mergeEntries(current, incoming, prepend));
      if (activate) setActiveOutput(urls[0]);
    }
    return urls;
  }, []);

  const resumeJob = useCallback(async (job, signal) => {
    const jobId = String(job?.id || "");
    if (!jobId) return;
    activeJobIdsRef.current.add(jobId);
    try {
      const completed = await waitForServerAiJob(jobId, {
        intervalMs: 2500,
        maxPolls: 260,
        signal,
        onUpdate: markExecutionStarted,
        onImage: (_partialOutputs, partialJob, partialResult) => {
          if (signal.aborted || !mountedRef.current) return;
          const urls = resultUrls(partialJob, partialResult);
          if (!urls.length) return;
          ingestJob({
            ...partialJob,
            id: jobId,
            originalMediaUrls: urls,
          }, { activate: !activeOutput, prepend: true });
        },
      });
      if (signal.aborted || !mountedRef.current) return;
      const completedJob = completed?.job || job;
      const urls = resultUrls(completedJob, completed?.result);
      if (!urls.length) return;
      ingestJob(completedJob, { activate: !activeOutput, prepend: true });
    } catch (caught) {
      if (caught?.name !== "AbortError" && mountedRef.current) {
        setError(caught?.message || "运行中的任务恢复失败");
      }
    } finally {
      activeJobIdsRef.current.delete(jobId);
    }
  }, [activeOutput, ingestJob, markExecutionStarted]);

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
          void resumeJob(job, controller.signal);
          return;
        }
        if (!["completed", "done", "succeeded"].includes(String(job.status || "").toLowerCase())) return;
        const urls = resultUrls(job);
        const meta = taskMeta(job);
        const previews = previewUrls(job, urls);
        urls.forEach((url, offset) => completedEntries.push({
          url,
          previewUrl: previews[url] || url,
          jobId: String(job.id || ""),
          groupId: meta.groupId,
          groupIndex: meta.index + offset,
          groupSize: Math.max(meta.size, urls.length),
          label: meta.label,
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
    const settings = coerceImageModelSettings(model, {
      aspectRatio: item.aspectRatio,
      quality: item.quality,
      transparentBackground: item.transparentPngEnabled,
      outputFormat: item.transparentPngEnabled ? "png" : undefined,
    });
    const sources = [...new Set((sourceUrls || []).filter(Boolean))].slice(
      0,
      normalizeImageModelCapabilities(model || {}).maxReferenceImages,
    );
    const sizeValue = outputSize(settings.aspectRatio);
    const shared = {
      source: "ultra-model-sheet",
      sourceUrl: sources[0] || "",
      sourceUrls: sources,
      ...(item.maskUrl ? { maskUrl: item.maskUrl, mask: item.maskUrl } : {}),
      aspectRatio: settings.aspectRatio,
      size: sizeValue,
      outputSize: sizeValue,
      count: 1,
      transparentPngEnabled: settings.transparentBackground,
      transparentBackground: settings.transparentBackground,
      upscaleOutputFormat: settings.transparentBackground ? "png" : "auto",
      quality: settings.quality,
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
          ingestJob({
            ...partialJob,
            id: jobId,
            originalMediaUrls: urls,
            input: { ...(partialJob?.input || shared), ...shared },
          }, { activate: true, prepend: true });
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
      ingestJob(normalizedJob, { activate: true, prepend: true });
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
    if (running || !model || !items?.length) return { outputs: [], failures: [], groupId };
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
        groupId,
      };
    } catch (caught) {
      if (caught?.name !== "AbortError" && mountedRef.current) {
        setError(caught?.message || "模型图生成失败");
      }
      return { outputs: [], failures: [], groupId };
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, [model, runOne, running]);

  const generateMaskedEdit = useCallback(async ({ sourceUrl, maskFile, prompt, aspectRatio, quality, groupId, groupIndex }) => {
    if (!(maskFile instanceof File) || !maskFile.size) throw new Error("蒙版无效，请重新涂抹");
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
      return result.urls;
    } finally {
      if (mountedRef.current) setRunning(false);
    }
  }, [runOne]);

  const cancel = useCallback(async () => {
    if (!running || cancelling) return;
    setCancelling(true);
    setStatus("正在停止后续生成");
    const ids = [...activeJobIdsRef.current];
    await Promise.allSettled(ids.map((jobId) => cancelServerAiJob(jobId)));
    generationControllerRef.current?.abort();
    if (mountedRef.current) {
      setRunning(false);
      setCancelling(false);
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
    };
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadHistory();
      return undefined;
    }
    historyControllerRef.current?.abort();
    generationControllerRef.current?.abort();
    activeJobIdsRef.current.clear();
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
    loadHistory,
    loadMoreHistory: () => loadHistory({ reset: false }),
    generateBatch,
    generateMaskedEdit,
    cancel,
    deleteEntries,
  };
}
