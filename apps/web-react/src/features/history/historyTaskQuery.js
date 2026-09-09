export const HISTORY_CANVAS_SOURCE = "react_canvas";
const HISTORY_TERMINAL_STATUSES = new Set(["succeeded", "failed", "canceled"]);

export function historyTaskQueryScope(typeFilter = "") {
  const type = String(typeFilter || "").trim();
  return {
    type: type === HISTORY_CANVAS_SOURCE ? "" : type,
    excludeSource:
      type === "t2i" || type === "background_remove"
        ? HISTORY_CANVAS_SOURCE
        : "",
    source: type === HISTORY_CANVAS_SOURCE ? HISTORY_CANVAS_SOURCE : "",
  };
}

export function historyTaskDeleteTarget(task) {
  const id = String(task?.id || "").trim();
  const status = String(task?.status || "").trim().toLowerCase();
  if (!id || !HISTORY_TERMINAL_STATUSES.has(status)) return null;
  return { kind: "task", id };
}

export function historyTaskRequiresForceMediaRemoval(task) {
  const type = String(task?.type || "").trim().toLowerCase();
  const params = task?.params && typeof task.params === "object" ? task.params : {};
  const source = String(task?.source || params._source || params.source || "").trim().toLowerCase();
  const workspace = String(params.workspace || task?.workspace || "").trim().toLowerCase();
  const kind = String(params._kind || params.kind || "").trim().toLowerCase();
  return (
    type === "assistant" ||
    source === HISTORY_CANVAS_SOURCE ||
    source === "infinite_canvas" ||
    workspace === "infinite_canvas" ||
    kind.startsWith("canvas-")
  );
}

export function historyScopeMayRequireForceMediaRemoval(typeFilter = "") {
  const type = String(typeFilter || "").trim().toLowerCase();
  return !type || type === "assistant" || type === HISTORY_CANVAS_SOURCE;
}
