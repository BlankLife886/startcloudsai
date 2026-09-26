import type { AgentAttachment } from "../../stores/use-agent-store";

export type HostedAgentReference = { id?: string; name?: string; dataUrl?: string; fileKey?: string; url?: string; thumbnailKey?: string; thumbnailUrl?: string };

export function assertHostedAgentRecoveryScope(input: {
    runId: string; projectId: string; conversationId?: string;
    run: { id: string; workspace?: string; conversationId?: string; userMessageId?: string };
    conversation: { id: string; workspace?: string; projectId?: string | null };
    userMessage?: { id: string; role?: string };
}) {
    const { run, conversation, userMessage } = input;
    if (run.id !== input.runId || run.workspace !== "infinite_canvas" || !run.conversationId || conversation.id !== run.conversationId || (input.conversationId && input.conversationId !== conversation.id) || conversation.workspace !== "infinite_canvas" || conversation.projectId !== input.projectId) throw new Error("无法恢复：任务不属于当前画布或对话");
    if (!userMessage || userMessage.role !== "user" || userMessage.id !== run.userMessageId) throw new Error("无法读取本轮原始附件，请刷新后重试");
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

const MAX_PAYLOAD = 12 * 1024 * 1024;
const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("附件读取失败"));
    reader.readAsDataURL(blob);
});

/** Recover only the exact run's references; never guess from the most recent chat message. */
export async function recoverHostedAgentAttachments(references: HostedAgentReference[] = [], options: {
    apiFilesUrl: string; pageUrl: string; signal?: AbortSignal;
    readImageMeta: (source: string) => Promise<{ width: number; height: number; mimeType?: string }>;
    fetch?: typeof fetch; toDataUrl?: (blob: Blob) => Promise<string>;
}): Promise<AgentAttachment[]> {
    if (references.length > 4) throw new Error("本轮附件数量超出恢复范围");
    const result: AgentAttachment[] = [];
    const ids = new Set<string>();
    let payloadBytes = 0;
    const files = new URL(options.apiFilesUrl, options.pageUrl);
    for (const reference of references) {
        throwIfAborted(options.signal);
        if (!reference.id || ids.has(reference.id)) throw new Error("本轮附件身份不完整，请重新打开对话");
        ids.add(reference.id);
        let source = reference.dataUrl || reference.url || (reference.fileKey ? files.href + reference.fileKey : "");
        let dataUrl = source;
        if (!/^data:image\/[\w.+-]+;base64,/i.test(source)) {
            const url = new URL(source, options.pageUrl);
            if (!source || url.origin !== files.origin || !url.pathname.startsWith(files.pathname) || url.username || url.password) throw new Error("无法恢复非站内附件，请重新上传图片");
            const response = await (options.fetch || fetch)(url.href, { signal: options.signal, credentials: "include", redirect: "error" });
            if (!response.ok) throw new Error(`附件已删除或暂时无法读取：${reference.name || "图片"}`);
            if (Number(response.headers.get("content-length") || 0) > MAX_PAYLOAD) throw new Error("本轮附件过大，无法恢复");
            const chunks: Uint8Array[] = [];
            let bytes = 0;
            if (response.body) {
                const reader = response.body.getReader();
                try {
                    for (;;) {
                        throwIfAborted(options.signal);
                        const { done, value } = await reader.read();
                        if (done) break;
                        bytes += value.byteLength;
                        if (bytes > MAX_PAYLOAD) throw new Error("本轮附件过大，无法恢复");
                        chunks.push(value);
                    }
                } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
                finally { reader.releaseLock(); }
            }
            const blob = new Blob(chunks as BlobPart[], { type: response.headers.get("content-type")?.split(";")[0] || "" });
            if (!blob.type.startsWith("image/")) throw new Error("附件已失效或不是图片");
            dataUrl = await (options.toDataUrl || blobDataUrl)(blob);
            source = url.href;
        }
        payloadBytes += dataUrl.length;
        if (payloadBytes > MAX_PAYLOAD) throw new Error("本轮附件过大，无法恢复");
        throwIfAborted(options.signal);
        const meta = await options.readImageMeta(dataUrl);
        throwIfAborted(options.signal);
        const body = dataUrl.slice(dataUrl.indexOf(",") + 1);
        result.push({ id: reference.id, name: reference.name || "图片", type: meta.mimeType || dataUrl.slice(5, dataUrl.indexOf(";")), size: Math.floor(body.length * 3 / 4) - (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0), width: meta.width, height: meta.height, url: source, dataUrl });
    }
    return result;
}
