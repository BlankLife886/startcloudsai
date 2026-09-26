import assert from "node:assert/strict";
import test from "node:test";

import { compactCanvasSnapshot, runCanvasAgentTool } from "../src/canvas/lib/canvas/canvas-hosted-agent.ts";
import { observeCanvasWorkflowStart } from "../src/canvas/lib/canvas/canvas-agent-workflow-start.ts";

const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata });
const canvasWith = (nodes) => ({ snapshot: { projectId: "agent-reliability", title: "audit", nodes, connections: [], selectedNodeIds: nodes.map((item) => item.id), viewport: { x: 0, y: 0, k: 1 } }, applyOps: () => { throw new Error("read must not mutate"); } });
const deferred = () => { let resolve; const promise = new Promise((finish) => { resolve = finish; }); return { promise, resolve }; };

test("workflow tools wait for the cost decision and return cancellation without claiming a start", async () => {
    const confirmation = deferred();
    let returned = false;
    const execution = observeCanvasWorkflowStart(async (acknowledge) => {
        if (!(await confirmation.promise)) { acknowledge({ status: "canceled" }); return; }
        acknowledge({ status: "started" });
    }, () => ({ status: "rejected" }));
    execution.decision.then(() => { returned = true; });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(returned, false);
    confirmation.resolve(false);
    assert.deepEqual(await execution.decision, { status: "canceled" });
    await execution.completion;
});

test("workflow acknowledgement returns while generation remains active", async () => {
    const generation = deferred();
    let completed = false;
    const execution = observeCanvasWorkflowStart(async (acknowledge) => {
        acknowledge({ status: "started" });
        await generation.promise;
        completed = true;
    }, () => ({ status: "rejected" }));
    assert.equal((await execution.decision).status, "started");
    assert.equal(completed, false, "a tool must not wait for the complete workflow");
    generation.resolve();
    await execution.completion;
    assert.equal(completed, true);
    assert.equal((await execution.decision).status, "started", "completion must not overwrite the start decision");
});

test("early preflight exits and synchronous scheduler errors reject the start", async () => {
    const preflight = observeCanvasWorkflowStart(async () => {}, () => ({ status: "rejected", error: "缺少输入" }));
    assert.deepEqual(await preflight.decision, { status: "rejected", error: "缺少输入" });
    const failed = observeCanvasWorkflowStart(() => { throw new Error("同步失败"); }, () => ({ status: "started" }));
    assert.deepEqual(await failed.decision, { status: "rejected", error: "同步失败" });
    await assert.rejects(failed.completion, /同步失败/);
});

test("resume and retry tools await the scheduler acknowledgement", async () => {
    for (const name of ["canvas_run_workflow", "canvas_resume_workflow", "canvas_retry_failed_nodes"]) {
        const canvas = canvasWith([node("config", "config", { status: "error" })]);
        canvas.startWorkflow = async () => ({ requestId: "workflow-ack", configNodeIds: ["config"], status: "canceled" });
        const observation = await runCanvasAgentTool({ name, arguments: "{}" }, canvas);
        assert.equal(observation.status, "canceled");
        assert.equal(observation.requestId, "workflow-ack", `${name} must not spread an unresolved Promise`);
    }
});

test("node inspection reads Chinese tail requirements and preserves original whitespace", async () => {
    const content = `${"设计说明。".repeat(120)}\n\n  只保留蓝色，删除红色。\n`;
    const canvas = canvasWith([node("brief", "text", { content })]);
    assert.ok(!JSON.stringify(compactCanvasSnapshot(canvas.snapshot)).includes("只保留蓝色"));
    const result = await runCanvasAgentTool({ name: "canvas_inspect_nodes", arguments: "{}" }, canvas);
    assert.equal(result.nodes[0].metadata.textContent, content);
    assert.equal(result.nodes[0].metadata.textPages.textContent.truncated, false);
});

test("long text pagination recovers all Unicode content without splitting emoji", async () => {
    const content = `https://example.test/brief\n${"🐱蓝色方案\n  ".repeat(800)}末尾硬性要求`;
    const canvas = canvasWith([node("brief", "text", { content })]);
    let textOffset = 0;
    let recovered = "";
    do {
        const result = await runCanvasAgentTool({ name: "canvas_inspect_nodes", arguments: JSON.stringify({ nodeIds: ["brief"], textOffset, textLimit: 333 }) }, canvas);
        const { textContent, textPages } = result.nodes[0].metadata;
        assert.equal(textPages.textContent.total, Array.from(content).length);
        recovered += textContent;
        textOffset = textPages.textContent.nextOffset;
    } while (textOffset !== undefined);
    assert.equal(recovered, content);
});

test("multi-node detailed reads stay below the server observation budget and retain every node", async () => {
    const text = "🐱".repeat(4000);
    const nodes = Array.from({ length: 12 }, (_, index) => node(`long-${index}`, "text", { content: text, prompt: text, composerContent: text }));
    const canvas = canvasWith(nodes);
    const ids = [];
    let offset = 0;
    do {
        const result = await runCanvasAgentTool({ name: "canvas_inspect_nodes", arguments: JSON.stringify({ offset, limit: 20, textLimit: 4000 }) }, canvas);
        assert.ok(new TextEncoder().encode(JSON.stringify(result)).byteLength < 64000);
        ids.push(...result.nodes.map((item) => item.id));
        offset = result.nextOffset;
    } while (offset !== undefined);
    assert.deepEqual(ids, nodes.map((item) => item.id));
});

test("generation logs expose the actual accepted node count", async () => {
    const canvas = canvasWith([node("config-a", "config"), node("config-b", "config")]);
    canvas.startGeneration = () => ({ requestId: "generation-actual", nodeIds: ["config-b"] });
    const result = await runCanvasAgentTool({ name: "canvas_run_generation", arguments: JSON.stringify({ nodeIds: ["config-a", "config-b"] }) }, canvas);
    assert.deepEqual(result.triggered, ["config-b"]);
    assert.deepEqual(result.triggered, result.nodeIds);
});

test("inspection budgets server HTML escaping before pagination", async () => {
    const text = "<>&".repeat(650);
    const canvas = canvasWith(Array.from({ length: 6 }, (_, index) => node(`html-${index}`, "text", { content: text, composerContent: text, prompt: text })));
    const result = await runCanvasAgentTool({ name: "canvas_inspect_nodes", arguments: JSON.stringify({ limit: 20 }) }, canvas);
    const serverJSON = JSON.stringify(result).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
    assert.ok(new TextEncoder().encode(serverJSON).byteLength < 64000);
    assert.equal(result.truncated, true);
    assert.equal(result.nodes[0].metadata.textContent, text);
});
