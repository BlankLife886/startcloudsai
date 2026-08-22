import i18n from "@/i18n";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { AgentReasoningEffort } from "@/stores/use-agent-store";

type AgentConfigResponse = { ok?: boolean; protocolVersion?: number; url?: string; token?: string; hasToken?: boolean };
const AGENT_MESSAGE_ASSET_PATTERN = /^agent-asset:([a-f0-9]{64})\/([a-f0-9]{64}\.(?:gif|jpe?g|png|webp))$/;

export class AgentApiError<T = unknown> extends Error {
    constructor(readonly status: number, readonly response: T & { code?: string; error?: string; msg?: string }) {
        super(response.error || response.msg || i18n.t("agent.state.requestFailed"));
        this.name = "AgentApiError";
    }
}

export type AgentSkillScope = "user" | "repo" | "system" | "admin";
export type AgentSkillInterface = { displayName?: string | null; shortDescription?: string | null; defaultPrompt?: string | null };
export type AgentSkillSummary = {
    name: string;
    description: string;
    shortDescription?: string | null;
    interface?: AgentSkillInterface | null;
    dependencies?: unknown;
    path: string;
    scope: AgentSkillScope;
    enabled: boolean;
    managed: boolean;
};
export type AgentSkillDetail = {
    name: string;
    description: string;
    instructions: string;
    interface?: AgentSkillInterface | null;
    path: string;
    managed: true;
    revision: string;
};
export type AgentSkillInput = { name?: string; description: string; instructions: string; interface?: AgentSkillInterface | null; expectedRevision?: string };
export type AgentSkillDraft = { name: string; displayName: string; description: string; instructions: string; shortDescription: string; defaultPrompt: string };
export type AgentSkillDraftInput = { source: "conversation" | "canvas"; threadId: string; clientId: string; model?: string; effort?: AgentReasoningEffort };
export type AgentSkillsResponse = { ok?: boolean; data?: AgentSkillSummary[]; errors?: unknown[] };
export type AgentSkillResponse = { ok?: boolean; data?: AgentSkillDetail };
export type AgentSkillDraftResponse = { ok?: boolean; data?: AgentSkillDraft };

export async function postState(endpoint: string, token: string, clientId: string, snapshot: CanvasAgentSnapshot | null) {
    try {
        const response = await fetch(`${endpoint}/canvas/state?clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: agentHeaders(token, { "content-type": "application/json" }),
            body: JSON.stringify(snapshot ? { ...snapshot, hasCanvas: true } : { hasCanvas: false }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

export async function activateAgentClient(endpoint: string, token: string, clientId: string) {
    try {
        await fetch(`${endpoint}/canvas/activate?clientId=${encodeURIComponent(clientId)}`, {
            method: "POST",
            headers: agentHeaders(token),
        });
    } catch {}
}

export async function postToolResult(endpoint: string, token: string, clientId: string, body: { requestId: string; result?: unknown; error?: string }) {
    await fetchAgentJson(endpoint, token, `/canvas/result?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function postCodexApproval(endpoint: string, token: string, requestId: string, decision: "accept" | "acceptForSession" | "decline") {
    await fetchAgentJson(endpoint, token, "/agent/codex/approval", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestId, decision }) });
}

export async function interruptCodexTurn(endpoint: string, token: string, threadId?: string) {
    await fetchAgentJson(endpoint, token, "/agent/codex/interrupt", jsonPost({ threadId }));
}

export async function acknowledgeCodexHistory(endpoint: string, token: string, threadId: string, turnIds: string[]) {
    await fetchAgentJson(endpoint, token, "/agent/codex/history/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadId, turnIds }) });
}

export async function revealAgentLocalFile(endpoint: string, token: string, path: string) {
    await fetchAgentJson(endpoint, token, "/agent/local-file/reveal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
}

export async function resolveAgentMessageAssetUrl(endpoint: string, token: string, value: string) {
    const match = AGENT_MESSAGE_ASSET_PATTERN.exec(value);
    if (!match) return value.startsWith("agent-asset:") ? "" : value;
    const baseUrl = endpoint.trim().replace(/\/$/, "");
    if (!baseUrl || !token) return "";
    try {
        const response = await fetch(`${baseUrl}/agent/message-assets/${match[1]}/${match[2]}`, { headers: agentHeaders(token) });
        if (!response.ok) return "";
        return URL.createObjectURL(await response.blob());
    } catch {
        return "";
    }
}

export function fetchCodexSkills(endpoint: string, token: string, forceReload = false) {
    return fetchAgentJson<AgentSkillsResponse>(endpoint, token, `/agent/codex/skills${forceReload ? "?forceReload=1" : ""}`);
}

export function fetchCodexSkill(endpoint: string, token: string, name: string) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`);
}

export function createCodexSkill(endpoint: string, token: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, "/agent/codex/skills", jsonPost(input));
}

export function createCodexSkillDraft(endpoint: string, token: string, input: AgentSkillDraftInput) {
    return fetchAgentJson<AgentSkillDraftResponse>(endpoint, token, "/agent/codex/skills/draft", jsonPost(input));
}

export function updateCodexSkill(endpoint: string, token: string, name: string, input: AgentSkillInput) {
    return fetchAgentJson<AgentSkillResponse>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}`, jsonPost(input));
}

export function deleteCodexSkill(endpoint: string, token: string, name: string, expectedRevision: string) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(name)}/delete`, jsonPost({ expectedRevision }));
}

export function setCodexSkillEnabled(endpoint: string, token: string, skill: Pick<AgentSkillSummary, "name" | "path">, enabled: boolean) {
    return fetchAgentJson<{ ok?: boolean }>(endpoint, token, `/agent/codex/skills/${encodeURIComponent(skill.name)}/enabled`, jsonPost({ ...skill, enabled }));
}

export async function fetchAgentJson<T>(endpoint: string, token: string, path: string, init?: RequestInit) {
    const res = await fetch(`${endpoint}${path}`, { ...init, headers: agentHeaders(token, init?.headers) });
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; msg?: string };
    if (!res.ok) throw new AgentApiError(res.status, data);
    return data;
}

export class AgentEventStream extends EventTarget {
    onerror: ((event: Event) => void) | null = null;
    private readonly controller = new AbortController();
    private closed = false;
    private retryMs = 1000;

    constructor(endpoint: string, token: string, clientId: string) {
        super();
        void this.connect(endpoint, token, clientId);
    }

    close() {
        this.closed = true;
        this.controller.abort();
    }

    private async connect(endpoint: string, token: string, clientId: string) {
        const url = `${endpoint}/events?clientId=${encodeURIComponent(clientId)}`;
        while (!this.closed) {
            try {
                const response = await fetch(url, {
                    headers: agentHeaders(token, { accept: "text/event-stream" }),
                    signal: this.controller.signal,
                });
                if (!response.ok || !response.body) throw new Error(`Agent event stream failed: ${response.status}`);
                await this.consume(response.body, response.url || url);
                if (!this.closed) throw new Error("Agent event stream closed");
            } catch (error) {
                if (this.closed || (error instanceof DOMException && error.name === "AbortError")) return;
                const event = new Event("error");
                this.dispatchEvent(event);
                this.onerror?.(event);
                if (this.closed) return;
                await new Promise((resolve) => setTimeout(resolve, this.retryMs));
            }
        }
    }

    private async consume(body: ReadableStream<Uint8Array>, origin: string) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!this.closed) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const trailingCarriageReturn = !done && buffer.endsWith("\r");
            if (trailingCarriageReturn) buffer = buffer.slice(0, -1);
            buffer = buffer.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
            if (trailingCarriageReturn) buffer += "\r";
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
                this.dispatchBlock(buffer.slice(0, boundary), origin);
                buffer = buffer.slice(boundary + 2);
                boundary = buffer.indexOf("\n\n");
            }
            if (done) return;
        }
    }

    private dispatchBlock(block: string, origin: string) {
        let type = "message";
        let lastEventId = "";
        const data: string[] = [];
        for (const line of block.split("\n")) {
            if (!line || line.startsWith(":")) continue;
            const separator = line.indexOf(":");
            const field = separator < 0 ? line : line.slice(0, separator);
            let value = separator < 0 ? "" : line.slice(separator + 1);
            if (value.startsWith(" ")) value = value.slice(1);
            if (field === "event") type = value || "message";
            else if (field === "data") data.push(value);
            else if (field === "id" && !value.includes("\0")) lastEventId = value;
            else if (field === "retry" && /^\d+$/.test(value)) this.retryMs = Math.max(250, Number(value));
        }
        if (!data.length || this.closed) return;
        this.dispatchEvent(new MessageEvent(type, { data: data.join("\n"), lastEventId, origin }));
    }
}

export function agentHeaders(token: string, headers?: HeadersInit) {
    const result = new Headers(headers);
    result.set("x-canvas-agent-token", token);
    return result;
}

export async function discoverAgentConfig(endpoint: string) {
    try {
        const res = await fetch(`${endpoint}/config`);
        if (!res.ok) return null;
        const data = (await res.json()) as AgentConfigResponse;
        return data.ok ? data : null;
    } catch {
        return null;
    }
}

function jsonPost(body: unknown): RequestInit {
    return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}
