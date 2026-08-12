import { useCallback, useEffect, useRef, useState } from "react";
import {
  cancelServerAiJob,
  deleteServerAiJob,
  getServerAiJob,
  listServerAiJobs,
  uploadAiInputFile,
} from "@react/legacy-modules/services/aiWallpaper.js";
import { createIllustrationColoringJob } from "@react/legacy-modules/services/aiIllustrationColoring.js";
import { prepareColoringUploadBlob } from "@react/legacy-modules/features/ai-illustration-coloring/domain/prepareColoringUpload.js";
import {
  isActiveColoringJobStatus,
  mapColoringJobToHistory,
} from "@react/legacy-modules/features/ai-illustration-coloring/domain/mapColoringJobToHistory.js";
import {
  mergeColoringHistory,
  readColoringHistory,
  resolveOutputPixelSize,
  writeColoringHistory,
} from "@react/legacy-modules/services/aiIllustrationColoringState.js";

function newestFirst(items) {
  return [...items].sort(
    (left, right) =>
      Date.parse(right.createdAt || 0) - Date.parse(left.createdAt || 0),
  );
}

function updateItem(items, item) {
  const found = items.some(
    (entry) =>
      (item.serverJobId && entry.serverJobId === item.serverJobId) ||
      entry.id === item.id,
  );
  const next = found
    ? items.map((entry) =>
        (item.serverJobId && entry.serverJobId === item.serverJobId) ||
        entry.id === item.id
          ? { ...entry, ...item }
          : entry,
      )
    : [item, ...items];
  return newestFirst(next);
}

async function prepareUploadFile(file, settings, signal) {
  if (!file) return null;
  const prepared = await prepareColoringUploadBlob({ blob: file, settings });
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!prepared.changed) return file;
  const extension = prepared.exportFormat === "image/webp"
    ? "webp"
    : prepared.exportFormat === "image/png"
      ? "png"
      : "jpg";
  const base = String(file.name || "coloring-input").replace(/\.[^.]+$/, "");
  return new File([prepared.blob], `${base}.${extension}`, {
    type: prepared.exportFormat || prepared.blob.type || file.type,
  });
}

export function useIllustrationColoringJobs({ authenticated }) {
  const [history, setHistoryState] = useState(() => readColoringHistory());
  const [activeId, setActiveId] = useState(() => readColoringHistory()[0]?.id || "");
  const [historyLoading, setHistoryLoading] = useState(Boolean(authenticated));
  const [submitting, setSubmitting] = useState(false);
  const controllersRef = useRef(new Set());
  const pollersRef = useRef(new Map());
  const mountedRef = useRef(true);

  const commitHistory = useCallback((updater) => {
    setHistoryState((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return writeColoringHistory(next);
    });
  }, []);

  const stopPolling = useCallback((jobId) => {
    const timer = pollersRef.current.get(jobId);
    if (timer) window.clearTimeout(timer);
    pollersRef.current.delete(jobId);
  }, []);

  const pollJob = useCallback(
    async (jobId) => {
      if (!jobId || !mountedRef.current) return;
      const controller = new AbortController();
      controllersRef.current.add(controller);
      try {
        const { job } = await getServerAiJob(jobId, { signal: controller.signal });
        let existing = null;
        setHistoryState((current) => {
          existing = current.find((item) => item.serverJobId === jobId) || null;
          const mapped = mapColoringJobToHistory(job, { existingItem: existing });
          const next = writeColoringHistory(updateItem(current, mapped));
          return next;
        });
        if (isActiveColoringJobStatus(job?.status)) {
          const timer = window.setTimeout(() => pollJob(jobId), 2400);
          pollersRef.current.set(jobId, timer);
        } else {
          stopPolling(jobId);
        }
      } catch (error) {
        if (error?.name !== "AbortError" && mountedRef.current) {
          const timer = window.setTimeout(() => pollJob(jobId), 4000);
          pollersRef.current.set(jobId, timer);
        }
      } finally {
        controllersRef.current.delete(controller);
      }
    },
    [stopPolling],
  );

  const refresh = useCallback(async () => {
    if (!authenticated) {
      setHistoryLoading(false);
      return;
    }
    const controller = new AbortController();
    controllersRef.current.add(controller);
    setHistoryLoading(true);
    try {
      const response = await listServerAiJobs(100, {
        kind: "illustration-coloring",
        signal: controller.signal,
      });
      const remote = (response.jobs || []).map((job) =>
        mapColoringJobToHistory(job, {
          existingItem: history.find((item) => item.serverJobId === job.id) || null,
        }),
      );
      const merged = writeColoringHistory(mergeColoringHistory(remote, readColoringHistory()));
      if (!mountedRef.current) return;
      setHistoryState(merged);
      setActiveId((current) => current || merged[0]?.id || "");
      merged
        .filter((item) => isActiveColoringJobStatus(item.status))
        .forEach((item) => {
          if (!pollersRef.current.has(item.serverJobId)) void pollJob(item.serverJobId);
        });
    } catch (error) {
      if (error?.name !== "AbortError") {
        const local = readColoringHistory();
        if (mountedRef.current) setHistoryState(local);
      }
    } finally {
      controllersRef.current.delete(controller);
      if (mountedRef.current) setHistoryLoading(false);
    }
  }, [authenticated, history, pollJob]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      controllersRef.current.forEach((controller) => controller.abort());
      controllersRef.current.clear();
      pollersRef.current.forEach((timer) => window.clearTimeout(timer));
      pollersRef.current.clear();
    };
    // Refresh once per authenticated session. Polling owns subsequent updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated]);

  const createBatch = useCallback(
    async ({ sourceFile, sourceUrl, sourceMeta, referenceFiles, referenceUrls, ...options }) => {
      if (!sourceFile && !sourceUrl) throw new Error("请先上传线稿插画");
      const controller = new AbortController();
      controllersRef.current.add(controller);
      setSubmitting(true);
      try {
        const preparedSource = sourceFile
          ? await prepareUploadFile(sourceFile, options.uploadSettings, controller.signal)
          : null;
        const remoteSource =
          sourceUrl ||
          (await uploadAiInputFile(preparedSource, { signal: controller.signal }));
        const preparedReferences = await Promise.all(
          (referenceFiles || []).map((file) =>
            prepareUploadFile(file, options.uploadSettings, controller.signal),
          ),
        );
        const uploadedReferences = await Promise.all(
          preparedReferences.map((file) =>
            uploadAiInputFile(file, { signal: controller.signal }),
          ),
        );
        const remoteReferences = Array.from(
          new Set([...(referenceUrls || []), ...uploadedReferences].filter(Boolean)),
        ).slice(0, 3);
        const count = Math.max(1, Math.min(4, Number(options.generationCount || 1)));
        const batchId = count > 1 ? `coloring-${crypto.randomUUID()}` : "";
        const output = resolveOutputPixelSize(
          sourceMeta?.width,
          sourceMeta?.height,
          options.outputSize,
          options.outputOrientation,
        );
        const requests = Array.from({ length: count }, (_, index) => ({
          clientRequestId: crypto.randomUUID(),
          batchId,
          variantIndex: index + 1,
        }));
        const created = await Promise.all(
          requests.map((request) =>
            createIllustrationColoringJob({
              sourceUrl: remoteSource,
              clientRequestId: request.clientRequestId,
              title: options.title,
              customPrompt: options.customPrompt,
              publicModelKey: options.publicModelKey,
              outputSize: options.outputSize,
              outputWidth: output.width,
              outputHeight: output.height,
              outputOrientation: output.orientation,
              referenceImageUrls: remoteReferences,
              batchId,
              variantIndex: request.variantIndex,
              variantCount: count,
            }),
          ),
        );
        const items = created.map(({ job }, index) =>
          mapColoringJobToHistory(job, {
            existingItem: {
              id: `coloring-${job.id}`,
              sourcePreview: remoteSource,
              sourceRemoteUrl: remoteSource,
              sourceName: sourceFile?.name || "线稿插画",
              sourceWidth: sourceMeta?.width || 0,
              sourceHeight: sourceMeta?.height || 0,
              sourceBytes: sourceMeta?.bytes || 0,
              inputType: sourceMeta?.type || "",
              referenceImageUrls: remoteReferences,
              title: options.title,
              customPrompt: options.customPrompt,
              batchId,
              variantIndex: index + 1,
              variantCount: count,
              outputSize: options.outputSize,
              outputOrientation: output.orientation,
              requestedOutputWidth: output.width,
              requestedOutputHeight: output.height,
              publicModelKey: options.publicModelKey,
            },
          }),
        );
        commitHistory((current) => mergeColoringHistory(items, current));
        setActiveId(items[0]?.id || "");
        items.forEach((item) => void pollJob(item.serverJobId));
        return items;
      } finally {
        controllersRef.current.delete(controller);
        if (mountedRef.current) setSubmitting(false);
      }
    },
    [commitHistory, pollJob],
  );

  const cancel = useCallback(
    async (item) => {
      if (!item?.serverJobId) return;
      const { job } = await cancelServerAiJob(item.serverJobId);
      const mapped = mapColoringJobToHistory(job, { existingItem: item });
      commitHistory((current) => updateItem(current, mapped));
      stopPolling(item.serverJobId);
    },
    [commitHistory, stopPolling],
  );

  const remove = useCallback(
    async (ids) => {
      const selected = history.filter((item) => ids.includes(item.id));
      await Promise.all(
        selected
          .filter((item) => item.serverJobId)
          .map((item) => deleteServerAiJob(item.serverJobId).catch(() => undefined)),
      );
      selected.forEach((item) => stopPolling(item.serverJobId));
      commitHistory((current) => current.filter((item) => !ids.includes(item.id)));
      setActiveId((current) => {
        if (!ids.includes(current)) return current;
        return history.find((item) => !ids.includes(item.id))?.id || "";
      });
    },
    [commitHistory, history, stopPolling],
  );

  return {
    history,
    activeId,
    setActiveId,
    historyLoading,
    submitting,
    refresh,
    createBatch,
    cancel,
    remove,
  };
}
