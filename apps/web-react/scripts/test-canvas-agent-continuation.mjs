import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
after(() => server.close());
const history = await server.ssrLoadModule("/src/canvas/lib/canvas/canvas-agent-continuation.ts");
const recovery = await server.ssrLoadModule("/src/canvas/lib/agent/hosted-agent-recovery.ts");
const { insertCanvasAgentAttachments } = await server.ssrLoadModule("/src/canvas/lib/canvas/canvas-agent-attachment-nodes.ts");
const repository = await server.ssrLoadModule("/src/canvas/services/canvas-cloud-repository.ts");
const { mergeCanvasProjectDocuments } = await server.ssrLoadModule("/src/canvas/lib/canvas/canvas-project-sync.ts");
const { runCanvasAgentTool } = await server.ssrLoadModule("/src/canvas/lib/canvas/canvas-hosted-agent.ts");
const { fetchCanvasAgentRunRecovery, hostedAgentMessagesFromConversation } = await server.ssrLoadModule("/src/canvas/services/canvas-task-api.ts");

const image = "data:image/png;base64,aW1hZ2U=";
const node = (id, metadata = {}) => ({ id, type: "text", title: id, width: 300, height: 200, position: { x: 0, y: 0 }, metadata });
const snapshot = (nodes = [node("brief", { content: "初始方案" })]) => ({ projectId: "p1", title: "恢复测试", nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });
const pack = (checkpoints, extra = {}) => history.packCanvasAgentContinuation({ ownerUserId: "u1", projectId: "p1", history: { past: [], future: [], checkpoints }, historyUpdatedAt: "2026-09-10T00:00:00Z", generations: [], workflows: [], regenerations: [], ...extra });
const cp = (id, view = snapshot()) => ({ id, name: id, createdAt: "2026-09-10T00:00:00Z", snapshot: view });
const clone = (value) => JSON.parse(JSON.stringify(value));

test("checkpoints and undo snapshots survive serialization with content matching", () => {
    const before = snapshot();
    const after = snapshot([node("brief", { content: "修改后的方案" })]);
    const saved = pack([cp("safe", before)], { history: { checkpoints: [cp("safe", before)], past: [{ id: "edit", name: "修改", createdAt: "now", before, after }], future: [] } });
    const restored = history.unpackCanvasAgentHistory(history.normalizeCanvasAgentContinuation(clone(saved), { ownerUserId: "u1", projectId: "p1" }));
    assert.equal(restored.checkpoints[0].snapshot.nodes[0].metadata.content, "初始方案");
    assert.equal(history.canvasAgentHistoryMatches(clone(after), restored.past[0].after), true);
    assert.equal(history.canvasAgentHistoryMatches(before, restored.past[0].after), false);
    assert.equal(Object.keys(saved.snapshots).length, 2);
});

test("another account/project and legacy empty documents never load these checkpoints", () => {
    const saved = pack([cp("secret")]);
    assert.equal(history.normalizeCanvasAgentContinuation(saved, { ownerUserId: "u2", projectId: "p1" }), undefined);
    assert.equal(history.normalizeCanvasAgentContinuation(saved, { ownerUserId: "u1", projectId: "p2" }), undefined);
    assert.deepEqual(history.unpackCanvasAgentHistory(), { past: [], future: [], checkpoints: [] });
});

test("cloud v3 round-trip and conflict merge preserve checkpoints and protected media", () => {
    const base = { id: "p1", title: "canvas", createdAt: "now", updatedAt: "now", revision: 1, ...snapshot(), chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false };
    const left = { ...base, agentContinuation: pack([cp("local", snapshot([node("old-image", { storageKey: "image:keep" })]))]) };
    const right = { ...base, agentContinuation: pack([cp("remote")]) };
    const merged = mergeCanvasProjectDocuments(left, right);
    assert.deepEqual(new Set(merged.agentContinuation.checkpoints.map(c => c.id)), new Set(["local", "remote"]));
    const restored = repository.canvasProjectFromResponse({ ...base, document: clone(repository.canvasProjectDocument(merged)) });
    assert.equal(history.canvasAgentContinuationNodes(restored.agentContinuation).some(n => n.metadata.storageKey === "image:keep"), true);
});

test("oversized new checkpoints are refused without modifying the old checkpoint object", () => {
    const old = pack([cp("old")]);
    assert.throws(() => pack([cp("large", snapshot([node("large", { content: "x".repeat(history.MAX_AGENT_CONTINUATION_BYTES + 1) })]))]), /4 MB/);
    assert.deepEqual(old.checkpoints.map(c => c.id), ["old"]);
});

test("generation recovery retains exact task identity and ignores a subsequent run", () => {
    const before = [node("config", { taskId: "older-task", generationStartedAt: "old" })];
    const record = history.createAgentGenerationRecord("generation-1", ["config"], before);
    const active = [node("config", { agentGenerationRequestId: "generation-1", taskId: "this-task", executionStatus: "running", generationStartedAt: record.createdAt })];
    const tracked = history.reconcileAgentGenerationRecord(record, active, true);
    assert.deepEqual(tracked.tasks.config.taskIds.map(t => t.id), ["this-task"]);
    const later = history.reconcileAgentGenerationRecord(tracked, [node("config", { agentGenerationRequestId: "generation-2", taskId: "later-task", executionStatus: "succeeded", generationCompletedAt: "2999-01-01" })], true);
    assert.deepEqual(later.tasks.config.taskIds.map(t => t.id), ["this-task"]);
    assert.notEqual(later.tasks.config.status, "succeeded");
    assert.equal(history.reconcileAgentGenerationRecord(record, before, true).tasks.config.status, "unknown");
});

test("restored asynchronous status tools await the exact lookup and expose unknown honestly", async () => {
    const canvas = { snapshot: snapshot(), applyOps: () => snapshot(), getGenerationStatus: async requestId => ({ requestId, tasks: [{ nodeId: "n", status: "unknown", error: "未确认" }] }), getWorkflowStatus: async requestId => ({ requestId, status: "succeeded", total: 3, completed: 3 }) };
    const generation = await runCanvasAgentTool({ name: "canvas_generation_status", requestId: "q1", arguments: JSON.stringify({ requestId: "original", waitSeconds: 0 }) }, canvas);
    assert.equal(generation.tasks[0].status, "unknown");
    const workflow = await runCanvasAgentTool({ name: "canvas_workflow_status", requestId: "q2", arguments: JSON.stringify({ requestId: "old-workflow", waitSeconds: 0 }) }, canvas);
    assert.equal(workflow.completed, 3);
});

test("run recovery rejects the wrong turn, workspace, conversation or project", () => {
    const input = { runId: "run", projectId: "p1", conversationId: "chat", run: { id: "run", workspace: "infinite_canvas", conversationId: "chat", userMessageId: "user-turn" }, conversation: { id: "chat", workspace: "infinite_canvas", projectId: "p1" }, userMessage: { id: "user-turn", role: "user" } };
    recovery.assertHostedAgentRecoveryScope(input);
    for (const patch of [{ projectId: "p2" }, { conversationId: "another" }, { userMessage: { id: "later-turn", role: "user" } }, { run: { ...input.run, workspace: "assistant" } }]) assert.throws(() => recovery.assertHostedAgentRecoveryScope({ ...input, ...patch }));
});

test("API recovery reads the exact run input without rebinding a legacy conversation", async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async url => {
        calls.push(String(url));
        const data = String(url).includes("/runs/") ? { run: { id: "run", workspace: "infinite_canvas", conversationId: "chat", userMessageId: "user-1" }, userMessage: { id: "user-1", role: "user", referenceImages: [{ id: "original", dataUrl: image }] } } : { id: "chat", workspace: "infinite_canvas", projectId: "p1", messages: [{ id: "later", role: "user", referenceImages: [{ id: "wrong" }] }] };
        return new Response(JSON.stringify({ success: true, data }), { headers: { "content-type": "application/json" } });
    };
    try {
        const restored = await fetchCanvasAgentRunRecovery("run", "p1", "chat");
        assert.equal(restored.userMessage.referenceImages[0].id, "original");
        assert.equal(calls.some(url => url.includes("?projectId")), false);
        assert.equal(calls[0].endsWith("?includeInput=1"), true);
    } finally { globalThis.fetch = originalFetch; }
});

const options = (extra = {}) => ({ apiFilesUrl: "/api/v1/files/", pageUrl: "https://canvas.test/canvas/p1", readImageMeta: async () => ({ width: 10, height: 20, mimeType: "image/png" }), ...extra });
test("inline attachments keep original IDs and appear in restored chat", async () => {
    const refs = [{ id: "original", name: "商品图.png", dataUrl: image }];
    const result = await recovery.recoverHostedAgentAttachments(refs, options({ fetch: () => assert.fail("inline images must not refetch") }));
    assert.equal(result[0].id, "original"); assert.equal(result[0].dataUrl, image);
    assert.equal(hostedAgentMessagesFromConversation([{ id: "u", role: "user", referenceImages: refs }], {})[0].attachments[0].url, image);
});
test("cloud attachments use authenticated same-origin reads and cancellation", async () => {
    let request;
    const result = await recovery.recoverHostedAgentAttachments([{ id: "cloud", dataUrl: "/api/v1/files/uploads/u/file.png" }], options({ fetch: async (url, init) => { request = { url, init }; return new Response("image", { headers: { "content-type": "image/png" } }); }, toDataUrl: async () => image }));
    assert.equal(result[0].dataUrl, image); assert.equal(request.init.credentials, "include"); assert.equal(request.init.redirect, "error");
    await assert.rejects(recovery.recoverHostedAgentAttachments([{ id: "external", url: "https://other.test/file.png" }], options()), /非站内/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(recovery.recoverHostedAgentAttachments([{ id: "a", dataUrl: image }], options({ signal: controller.signal })), { name: "AbortError" });
    await assert.rejects(recovery.recoverHostedAgentAttachments([{ id: "missing", dataUrl: "/api/v1/files/no.png" }], options({ fetch: async () => new Response("", { status: 404 }) })), /已删除/);
});

test("attachment replays reuse nodes, and switching projects during upload cannot mutate", async () => {
    let current = snapshot([]); let uploads = 0; let applies = 0;
    const context = { read: () => current, upload: async () => { uploads++; return { url: "/image.png", storageKey: "uploads/u/file.png", width: 20, height: 10 }; }, apply: ops => { applies++; current = { ...current, nodes: [...current.nodes, ...ops.map(op => node(op.id, op.metadata))] }; return current; } };
    const input = { ids: ["a", "a"], runKey: "run", attachments: [{ id: "a", dataUrl: image }] };
    const first = await insertCanvasAgentAttachments(input, context);
    const repeat = await insertCanvasAgentAttachments(input, context);
    assert.deepEqual(first.added, repeat.added); assert.equal(uploads, 1); assert.equal(applies, 1); assert.equal(repeat.reused.length, 1);
    current = snapshot([]);
    await assert.rejects(insertCanvasAgentAttachments({ ...input, runKey: "another-run" }, { ...context, upload: async () => { current = { ...current, projectId: "other" }; return { url: "/image", storageKey: "key", width: 1, height: 1 }; } }), /画布已经切换/);
    assert.equal(applies, 1);
});
