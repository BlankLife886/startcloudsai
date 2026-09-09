export function pendingBatchEntries(batch) {
  return (batch?.entries || []).filter((entry) => !entry.task && !entry.discarded);
}

export function createSubmissionBatch({ count, sourceUrls, buildPayload }) {
  const batchSize = Math.min(4, Math.max(1, Math.floor(Number(count) || 1)));
  const batchId = `batch-${crypto.randomUUID()}`;
  const batchCreatedAt = new Date().toISOString();
  return {
    batchId,
    batchSize,
    batchCreatedAt,
    entries: Array.from({ length: batchSize }, (_, batchIndex) => ({
      // Persist the exact request and idempotency key across uncertain responses.
      payload: structuredClone(buildPayload({ sourceUrls, batchId, batchIndex, batchSize, batchCreatedAt })),
      task: null,
      error: null,
    })),
  };
}

export async function submitPendingBatch(batch, submit, { confirmedUnitPrice = null, onChange = () => {} } = {}) {
  const entries = pendingBatchEntries(batch);
  const results = await Promise.allSettled(entries.map(async (entry) => {
    // A price_changed response proves that this request was rejected. Do not
    // alter uncertain requests: an accepted POST may only have lost its reply.
    if (entry.error?.code === "price_changed" && confirmedUnitPrice != null) {
      entry.payload = { ...entry.payload, expectedUnitPriceCents: confirmedUnitPrice };
      onChange(batch);
    }
    try {
      const task = await submit(entry.payload);
      entry.task = task;
      entry.error = null;
      onChange(batch);
      return task;
    } catch (error) {
      entry.error = error;
      onChange(batch);
      throw error;
    }
  }));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    const cause = failures.find((result) => result.reason?.code === "price_changed")?.reason || failures[0].reason;
    throw Object.assign(new Error(cause?.message || "部分任务尚未提交成功"), {
      code: cause?.code,
      name: cause?.name || "Error",
      batch,
      remainingCount: pendingBatchEntries(batch).length,
      cause,
    });
  }
  return batch.entries.map((entry) => entry.task);
}

export function batchQuotePayload(batch) {
  return pendingBatchEntries(batch)[0]?.payload || null;
}

export function historyTaskReferences(task, fileUrl) {
  const input = task?.input || task?.params || {};
  const keys = Array.from(new Set([
    ...(Array.isArray(task?.inputKeys) ? task.inputKeys : []),
    ...(Array.isArray(input.inputKeys) ? input.inputKeys : []),
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  const urls = keys.length ? keys.map(fileUrl) : Array.from(new Set([
    ...(Array.isArray(input.sourceUrls) ? input.sourceUrls : []),
    ...(Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : []),
    input.sourceUrl,
  ].map((value) => String(value || "").trim()).filter(Boolean)));
  if (!urls.length && String(task?.kind || input._kind || "").includes("image-edit")) {
    throw new Error("原任务的参考图已失效，请重新选择参考图后生成");
  }
  if (urls.some((url) => /^(blob:|deleted:)/i.test(url))) {
    throw new Error("原任务的参考图已失效，请重新选择参考图后生成");
  }
  return urls.map((url, index) => ({
    id: crypto.randomUUID(), name: `原参考图 ${index + 1}`, url, preview: url,
    key: keys[index] || "", file: null,
  }));
}
