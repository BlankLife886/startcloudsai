const keyFor = (userId) => `t2i-pending-batch:v1:${userId}`;

export function savePendingBatch(userId, batch, storage = globalThis.sessionStorage) {
  if (!userId || !storage) return;
  try {
    if (!batch || batch.entries.every(entry => entry.task || entry.discarded)) { storage.removeItem(keyFor(userId)); return; }
    const entries = batch.entries.map(entry => ({
      payload: entry.payload, task: entry.task, discarded: entry.discarded === true,
      error: entry.error ? { code: entry.error.code, name: entry.error.name, message: entry.error.message, status: entry.error.status } : null,
    }));
    storage.setItem(keyFor(userId), JSON.stringify({ version: 1, batch: { ...batch, entries } }));
  } catch {
    throw Object.assign(new Error("无法保存本次待提交任务，请检查浏览器存储空间后重试"), { code: "submission_storage_unavailable" });
  }
}

export function readPendingBatch(userId, storage = globalThis.sessionStorage) {
  if (!userId || !storage) return null;
  try {
    const saved = JSON.parse(storage.getItem(keyFor(userId)) || "null");
    const batch = saved?.batch;
    if (saved?.version !== 1 || !Array.isArray(batch?.entries) || !batch.entries.length || batch.entries.length > 4) return null;
    if (batch.entries.some(entry => !entry.payload?.clientRequestId || !entry.payload?.input)) return null;
    return batch;
  } catch { return null; }
}
