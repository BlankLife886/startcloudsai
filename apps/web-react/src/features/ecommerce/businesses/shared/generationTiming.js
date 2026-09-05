export function ecommerceElapsedSeconds(task) {
  if (!task) return 0;
  const started = Date.parse(task.startedAt || "");
  if (!Number.isFinite(started)) return 0;
  const finished = Date.parse(task.finishedAt || "");
  const end = Number.isFinite(finished) ? finished : Date.now();
  return Math.max(0, Math.floor((end - started) / 1000));
}

export function firstReturnedOutputUrl(rows = []) {
  const successes = rows.filter((row) => row?.url);
  if (!successes.length) return "";
  return [...successes].sort((left, right) => {
    const leftDone =
      Date.parse(left.task?.finishedAt || left.task?.updatedAt || "") ||
      Number.MAX_SAFE_INTEGER;
    const rightDone =
      Date.parse(right.task?.finishedAt || right.task?.updatedAt || "") ||
      Number.MAX_SAFE_INTEGER;
    if (leftDone !== rightDone) return leftDone - rightDone;
    return Number(left.index || 0) - Number(right.index || 0);
  })[0].url;
}
