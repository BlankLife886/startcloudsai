// 重新生成后的回复版本：服务端把被替换的旧回复放在新回复的 previousVersions 里
// （最早的在前，最多 4 个）。界面上按“第 n / 共 m 版”切换，最后一版是当前回复。

export const MAX_PREVIOUS_VERSIONS = 4;

const SNAPSHOT_SKIPPED = new Set(["previousVersions", "pending", "pendingTool", "routing", "feedback", "feedbackReasons", "feedbackNote"]);

export function assistantMessageVersions(message) {
  return Array.isArray(message?.previousVersions) ? message.previousVersions.filter((item) => item && typeof item === "object") : [];
}

// 把某个旧版本摊平成一条可以照常渲染的消息；id 沿用当前回复，操作仍然作用在这条消息上。
export function assistantMessageVersion(message, version) {
  const metadata = version?.metadata && typeof version.metadata === "object" ? version.metadata : {};
  return {
    ...message,
    ...metadata,
    id: message.id,
    role: "assistant",
    content: String(version?.content || ""),
    kind: version?.kind || metadata.kind || message.kind,
    status: "complete",
    pending: false,
    error: metadata.error || "",
    createdAt: version?.createdAt || message.createdAt,
    previousVersions: message.previousVersions,
    isEarlierVersion: true,
  };
}

// 本地先拼出新回复的旧版本列表，生成过程中就能切回去看；服务端返回后以服务端为准。
export function versionsAfterRegenerate(message) {
  if (!message || message.localOnly || message.status !== "complete" || message.pending) return assistantMessageVersions(message);
  const metadata = {};
  Object.entries(message).forEach(([key, value]) => {
    if (!SNAPSHOT_SKIPPED.has(key) && !["id", "role", "content", "kind", "status", "createdAt", "updatedAt"].includes(key)) metadata[key] = value;
  });
  const snapshot = { id: message.id, content: message.content || "", kind: message.kind, createdAt: message.createdAt, metadata };
  return [...assistantMessageVersions(message), snapshot].slice(-MAX_PREVIOUS_VERSIONS);
}
