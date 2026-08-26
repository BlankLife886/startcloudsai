import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
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

const ACTIVE_STATUSES = new Set(["queued", "running", "waiting_provider"]);

function resultUrls(job = {}, result = null) {
  const originals = [...(Array.isArray(job.originalMediaUrls) ? job.originalMediaUrls : []), job.originalMediaUrl];
  const fallbacks = [...(Array.isArray(result?.outputs) ? result.outputs : []), ...(Array.isArray(job.resultMediaUrls) ? job.resultMediaUrls : []), job.resultMediaUrl];
  return [...new Set((originals.some(Boolean) ? [...originals, ...fallbacks] : fallbacks).map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 4);
}

function taskMeta(job = {}) {
  const input = job.input && typeof job.input === "object" ? job.input : {};
  const kind = String(job.kind || input._kind || "");
  const match = kind.match(/^game-art-(.+?)-(?:generation|edit)$/);
  return {
    kindVariant: String(input.kindVariant || match?.[1] || "character"),
    groupId: String(input.batchId || input.groupId || job.id || ""),
    index: Math.max(0, Number(input.batchIndex) || 0),
    size: Math.max(1, Number(input.batchSize) || Number(job.count) || 1),
    aspectRatio: String(input.aspectRatio || "1:1"),
    label: String(input.viewLabel || "游戏资产"),
  };
}

function previewMap(job, urls) {
  const values = [...(Array.isArray(job.resultMediaUrls) ? job.resultMediaUrls : []), job.resultMediaUrl].filter(Boolean);
  return Object.fromEntries(urls.map((url, index) => [url, values[index] || values[0] || url]));
}

// 展示图（服务端压缩大图）与原图按下标对应；旧任务没有，取用时回退原图。
function displayMap(job, urls) {
  const values = [...(Array.isArray(job.displayMediaUrls) ? job.displayMediaUrls : []), job.displayMediaUrl].filter(Boolean);
  return Object.fromEntries(urls.map((url, index) => [url, values[index] || ""]));
}

function entriesFromJob(job, result = null) {
  const urls = resultUrls(job, result);
  const meta = taskMeta(job);
  const previews = previewMap(job, urls);
  const displays = displayMap(job, urls);
  return urls.map((url, offset) => ({
    url,
    displayUrl: displays[url] || "",
    previewUrl: previews[url] || url,
    jobId: String(job.id || ""),
    kindVariant: meta.kindVariant,
    groupId: meta.groupId,
    groupIndex: meta.index + offset,
    groupSize: Math.max(meta.size, urls.length),
    aspectRatio: meta.aspectRatio,
    label: meta.label,
    createdAt: String(job.createdAt || ""),
    startedAt: String(job.startedAt || ""),
    finishedAt: String(job.finishedAt || ""),
  }));
}

function mergeEntries(current, incoming, prepend = false) {
  const values = prepend ? [...incoming, ...current] : [...current, ...incoming];
  return [...new Map(values.map((entry) => [entry.url, entry])).values()];
}

export function useGameArtJobs({ model, isAuthenticated }) {
  const mountedRef = useRef(true);
  const historyControllerRef = useRef(null);
  const runContextsRef = useRef(new Map());
  const cursorRef = useRef("");
  const [entries, setEntries] = useState([]);
  const [activeOutput, setActiveOutput] = useState("");
  const [generationTasks, setGenerationTasks] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [error, setError] = useState("");
  const busy = useMemo(() => generationTasks.some((task) => ["running", "cancelling"].includes(task.state)), [generationTasks]);

  const ingest = useCallback((job, result = null, { activate = true, prepend = true } = {}) => {
    const incoming = entriesFromJob(job, result);
    if (!incoming.length || !mountedRef.current) return [];
    setEntries((current) => mergeEntries(current, incoming, prepend));
    if (activate) setActiveOutput(incoming[0].url);
    return incoming.map((entry) => entry.url);
  }, []);

  const patchTask = useCallback((id, patch) => {
    if (!mountedRef.current) return;
    setGenerationTasks((current) => current.map((task) => task.id === id ? { ...task, ...patch } : task));
  }, []);

  const loadHistory = useCallback(async ({ reset = true } = {}) => {
    if (!isAuthenticated || historyLoading) return [];
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    historyControllerRef.current = controller;
    setHistoryLoading(true);
    try {
      const response = await listServerAiJobs(40, {
        kind: "game-art-character-generation",
        cursor: reset ? "" : cursorRef.current,
        signal: controller.signal,
      });
      if (controller.signal.aborted || !mountedRef.current) return [];
      const jobs = (Array.isArray(response?.jobs) ? response.jobs : [])
        .filter((job) => String(job.kind || "").startsWith("game-art-"))
        .sort((left, right) => Date.parse(right.createdAt || "") - Date.parse(left.createdAt || ""));
      const incoming = jobs.flatMap((job) => {
        const status = String(job.status || "").toLowerCase();
        if (ACTIVE_STATUSES.has(status)) {
          void resumeJob(job, controller.signal);
          return [];
        }
        return ["completed", "done", "succeeded"].includes(status) ? entriesFromJob(job) : [];
      });
      setEntries((current) => reset ? mergeEntries([], incoming) : mergeEntries(current, incoming));
      setActiveOutput((current) => current || incoming[0]?.url || "");
      cursorRef.current = String(response?.pagination?.nextCursor || "");
      setHistoryHasMore(Boolean(response?.pagination?.hasMore && cursorRef.current));
      return incoming;
    } catch (caught) {
      if (caught?.name !== "AbortError" && mountedRef.current) setError(caught?.message || "历史记录读取失败");
      return [];
    } finally {
      if (mountedRef.current) setHistoryLoading(false);
    }
  }, [historyLoading, isAuthenticated]);

  async function resumeJob(job, signal) {
    try {
      const completed = await waitForServerAiJob(job.id, {
        maxPolls: 260,
        signal,
        onImage: (_values, partialJob, partialResult) => ingest(partialJob, partialResult, { activate: !activeOutput }),
      });
      if (!signal.aborted) ingest(completed.job, completed.result, { activate: !activeOutput });
    } catch (caught) {
      if (caught?.name !== "AbortError" && mountedRef.current) setError(caught?.message || "运行中的任务恢复失败");
    }
  }

  const runItem = useCallback(async ({ item, sourceUrl, groupId, index, size, runId, context }) => {
    const capabilities = normalizeImageModelCapabilities(model || {});
    const resolutionScale = capabilities.resolutions[0] || "";
    const settings = coerceImageModelSettings(model, {
      aspectRatio: item.aspectRatio,
      resolutionScale,
      quality: item.quality,
      transparentBackground: item.transparentPngEnabled,
      outputFormat: item.transparentPngEnabled ? "png" : undefined,
    });
    const dimensions = resolutionScale && settings.aspectRatio
      ? resolveT2iOutputSize(settings.aspectRatio, resolutionScale)
      : "";
    const allowedSourceUrl = capabilities.maxReferenceImages > 0 ? String(sourceUrl || "") : "";
    const shared = {
      source: "game-art-studio",
      sourceUrl: allowedSourceUrl,
      sourceUrls: allowedSourceUrl ? [allowedSourceUrl] : [],
      ...(settings.aspectRatio ? { aspectRatio: settings.aspectRatio } : {}),
      ...(dimensions ? { size: dimensions, outputSize: dimensions } : {}),
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
      viewLabel: item.viewLabel,
      kindVariant: item.kindVariant,
      batchId: groupId,
      batchIndex: index,
      batchSize: size,
      batchCreatedAt: item.batchCreatedAt,
    };
    const response = await createServerAiJob({
      kind: `game-art-${item.kindVariant}-${allowedSourceUrl ? "edit" : "generation"}`,
      clientRequestId: crypto.randomUUID(),
      prompt: item.prompt,
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
    context.jobIds.add(jobId);
    let streamed = [];
    try {
      const completed = await waitForServerAiJob(jobId, {
        maxPolls: 260,
        signal: context.controller.signal,
        onStatus: (message) => patchTask(runId, { status: String(message || "") }),
        onImage: (_values, partialJob, partialResult) => {
          const urls = resultUrls(partialJob, partialResult);
          streamed = [...new Set([...streamed, ...urls])];
          ingest({ ...partialJob, id: jobId, input: { ...(partialJob?.input || {}), ...shared }, originalMediaUrls: urls }, partialResult);
        },
      });
      const finalUrls = resultUrls(completed.job, completed.result).length ? resultUrls(completed.job, completed.result) : streamed;
      if (!finalUrls.length) throw new Error("任务已完成，但没有返回可用图片");
      ingest({ ...completed.job, id: jobId, input: { ...(completed.job?.input || {}), ...shared }, originalMediaUrls: finalUrls }, completed.result);
      return { jobId, urls: finalUrls };
    } finally {
      context.jobIds.delete(jobId);
    }
  }, [ingest, model, patchTask]);

  const generate = useCallback(async ({ prompt, file, sourceUrl = "", aspectRatio, count, quality, transparentPngEnabled, viewLabel, kindVariant, referencePreviewUrl = "" }) => {
    if (!model || !String(prompt || "").trim()) return { outputs: [], failures: [] };
    const total = Math.max(1, Math.min(Number(count) || 1, 4));
    const runId = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const context = { controller: new AbortController(), jobIds: new Set() };
    runContextsRef.current.set(runId, context);
    const progress = Array.from({ length: total }, (_, index) => ({ label: total > 1 ? `${viewLabel} ${index + 1}` : viewLabel, status: "pending" }));
    setGenerationTasks((current) => [{ id: runId, groupId, label: viewLabel, kindVariant, previewUrl: referencePreviewUrl, state: "running", status: "正在准备生成任务", progress, completedCount: 0, totalCount: total, createdAt }, ...current]);
    setError("");
    try {
      let effectiveSource = String(sourceUrl || "");
      if (file) {
        patchTask(runId, { status: "正在上传参考图" });
        effectiveSource = await uploadAiInputFile(file, { featureKey: "ai.gameDesign", signal: context.controller.signal });
      }
      const results = await Promise.all(Array.from({ length: total }, async (_, index) => {
        patchTask(runId, {
          status: `正在生成 ${viewLabel} · ${index + 1}/${total}`,
          progress: progress.map((entry, at) => at === index ? { ...entry, status: "running" } : entry),
        });
        try {
          const result = await runItem({
            item: { prompt, aspectRatio, quality, transparentPngEnabled, viewLabel: total > 1 ? `${viewLabel} ${index + 1}` : viewLabel, kindVariant, batchCreatedAt: createdAt },
            sourceUrl: effectiveSource,
            groupId,
            index,
            size: total,
            runId,
            context,
          });
          progress[index] = { ...progress[index], status: "done" };
          patchTask(runId, { progress: [...progress], completedCount: progress.filter((entry) => entry.status === "done").length });
          return result;
        } catch (caught) {
          progress[index] = { ...progress[index], status: caught?.name === "AbortError" ? "cancelled" : "failed", message: caught?.message || "生成失败" };
          patchTask(runId, { progress: [...progress] });
          return { error: caught, urls: [] };
        }
      }));
      const failures = results.filter((item) => item.error);
      patchTask(runId, { state: "done", status: failures.length ? `完成，${failures.length} 张失败` : "生成完成", completedCount: total, finishedAt: new Date().toISOString() });
      window.setTimeout(() => mountedRef.current && setGenerationTasks((current) => current.filter((task) => task.id !== runId)), 1800);
      return { outputs: results.flatMap((item) => item.urls || []), failures, groupId };
    } catch (caught) {
      if (caught?.name !== "AbortError") setError(caught?.message || "游戏资产生成失败");
      patchTask(runId, { state: "failed", status: caught?.message || "生成失败", finishedAt: new Date().toISOString() });
      return { outputs: [], failures: [{ error: caught }], groupId };
    } finally {
      runContextsRef.current.delete(runId);
    }
  }, [model, patchTask, runItem]);

  const deleteOutput = useCallback(async (url) => {
    const target = entries.find((entry) => entry.url === url);
    if (!target) return;
    if (target.jobId) await deleteServerAiJob(target.jobId);
    setEntries((current) => current.filter((entry) => target.jobId ? entry.jobId !== target.jobId : entry.url !== url));
    setActiveOutput((current) => current === url ? "" : current);
  }, [entries]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      historyControllerRef.current?.abort();
      runContextsRef.current.forEach((context) => context.controller.abort());
      runContextsRef.current.clear();
    };
  }, []);

  return {
    entries,
    activeOutput,
    setActiveOutput,
    generationTasks,
    busy,
    historyLoading,
    historyHasMore,
    error,
    setError,
    loadHistory,
    loadMoreHistory: () => loadHistory({ reset: false }),
    generate,
    deleteOutput,
  };
}
