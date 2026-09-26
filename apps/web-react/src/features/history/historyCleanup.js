const TERMINAL_STATUSES = new Set(["completed", "succeeded", "failed", "paused", "cancelled", "canceled"]);
const OUTPUT_FIELDS = [
  "outputKeys", "thumbnailKeys", "outputs", "originalOutputs", "thumbnailOutputs", "displayOutputs",
  "outputUrls", "originalUrls", "thumbnailUrls", "displayUrls", "resultMediaUrls", "originalMediaUrls", "displayMediaUrls",
];
const OUTPUT_URL_FIELDS = ["outputUrl", "originalUrl", "thumbnailUrl", "resultMediaUrl", "originalMediaUrl", "displayMediaUrl"];

export function isEmptyHistoryTask(task) {
  return TERMINAL_STATUSES.has(String(task?.status || "").trim().toLowerCase()) && !OUTPUT_URL_FIELDS.some((field) => task?.[field]) && !OUTPUT_FIELDS.some((field) =>
    Array.isArray(task?.[field]) && task[field].some((value) => String(value || "").trim()),
  );
}

export async function removeEmptyHistory({ listPage, removeTask, assertCurrent }) {
  const candidates = new Map();
  const cursors = new Set();
  let cursor = "";
  // Finish discovery before deleting so removal cannot disturb pagination.
  do {
    assertCurrent();
    if (cursors.has(cursor)) throw new Error("历史记录分页异常，请刷新后重试");
    cursors.add(cursor);
    const page = await listPage(cursor);
    assertCurrent();
    for (const task of page.tasks) {
      if (isEmptyHistoryTask(task)) candidates.set(task.id, task);
      else candidates.delete(task.id);
    }
    cursor = page.nextCursor || "";
  } while (cursor);

  let removed = 0;
  let failed = 0;
  const tasks = [...candidates.values()];
  for (let offset = 0; offset < tasks.length; offset += 4) {
    assertCurrent();
    const results = await Promise.allSettled(tasks.slice(offset, offset + 4).map(async (task) => {
      assertCurrent();
      await removeTask(task, { onlyEmpty: true });
    }));
    assertCurrent();
    removed += results.filter((result) => result.status === "fulfilled").length;
    failed += results.filter((result) => result.status === "rejected").length;
  }
  return { removed, failed };
}
