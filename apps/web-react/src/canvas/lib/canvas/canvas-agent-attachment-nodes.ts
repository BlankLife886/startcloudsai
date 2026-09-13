import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops.ts";

export async function insertCanvasAgentAttachments(input: {
    ids: string[]; runKey: string; attachments: Array<{ id: string; name?: string; dataUrl: string }>;
    x?: number; y?: number; gap?: number; column?: boolean;
}, context: {
    read: () => CanvasAgentSnapshot;
    apply: (ops: CanvasAgentOp[]) => CanvasAgentSnapshot;
    upload: (dataUrl: string) => Promise<{ url: string; storageKey: string; width: number; height: number; thumbnailUrl?: string; thumbnailKey?: string; bytes?: number; mimeType?: string }>;
}) {
    const origin = context.read();
    const read = () => {
        const current = context.read();
        if (current.projectId !== origin.projectId) throw new Error("画布已经切换，附件操作已停止");
        return current;
    };
    const known = new Map(input.attachments.map((item) => [item.id, item]));
    const ids = [...new Set(input.ids.filter(Boolean))];
    const missing = ids.filter((id) => !known.has(id));
    if (!ids.some((id) => known.has(id))) throw new Error(missing.length ? `附件不存在：${missing.join("、")}` : "attachmentIds 为空");
    const x = Number.isFinite(input.x) ? input.x! : origin.nodes.length ? Math.max(...origin.nodes.map((node) => node.position.x + node.width)) + 72 : (-origin.viewport.x + 80) / origin.viewport.k;
    const y = Number.isFinite(input.y) ? input.y! : origin.nodes[0]?.position.y || (-origin.viewport.y + 80) / origin.viewport.k;
    const planned: Array<Extract<CanvasAgentOp, { type: "add_node" }>> = [];
    const added: string[] = [];
    for (const attachmentId of ids) {
        const attachment = known.get(attachmentId);
        if (!attachment) continue;
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([origin.projectId, input.runKey, attachmentId])));
        const id = `agent-image-${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
        const index = added.length;
        added.push(id);
        if (read().nodes.some((node) => node.id === id)) continue;
        const stored = await context.upload(attachment.dataUrl);
        read();
        const width = 360;
        const height = stored.width > 0 && stored.height > 0 ? Math.max(200, Math.min(480, Math.round(width * stored.height / stored.width))) : 270;
        planned.push({ type: "add_node", id, nodeType: "image", title: attachment.name || "参考图", x: input.column ? x : x + index * (width + (input.gap || 40)), y: input.column ? y + index * (height + (input.gap || 40)) : y, width, height, metadata: { content: stored.url, storageKey: stored.storageKey, thumbnailUrl: stored.thumbnailUrl, thumbnailKey: stored.thumbnailKey, status: "success", naturalWidth: stored.width, naturalHeight: stored.height, bytes: stored.bytes, mimeType: stored.mimeType } });
    }
    const current = read();
    const existing = new Set(current.nodes.map((node) => node.id));
    const ops = planned.filter((op) => !existing.has(op.id!));
    const after = ops.length ? context.apply(ops) : current;
    return { added, missing, reused: added.filter((id) => existing.has(id)), created: ops.length, after };
}
