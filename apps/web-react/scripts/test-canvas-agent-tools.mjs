import assert from "node:assert/strict";
import test from "node:test";

import { compactCanvasSnapshot, runCanvasAgentTool } from "../src/canvas/lib/canvas/canvas-hosted-agent.ts";
import { planCanvasAgentRegeneration, resolveCanvasAgentRegenerationSourceIds } from "../src/canvas/lib/canvas/canvas-agent-regenerate.ts";
import { hasVisibleAgentRunActivity } from "../src/canvas/lib/agent/agent-run-activity.ts";

const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata });

test("keeps the working indicator visible until the current turn has visible activity", () => {
    const user = { id: "user-1", role: "user", text: "执行工作流 2" };
    const emptyStream = { id: "assistant-1", role: "assistant", text: "", streamId: "assistant-1" };
    assert.equal(hasVisibleAgentRunActivity([user, emptyStream]), false);
    assert.equal(hasVisibleAgentRunActivity([user, { ...emptyStream, text: "正在读取画布" }]), true);
    assert.equal(hasVisibleAgentRunActivity([user, emptyStream, { id: "tool-1", role: "tool", text: "正在读取画布", detail: { status: "running" } }]), true);
    assert.equal(hasVisibleAgentRunActivity([user, emptyStream, { id: "tool-1", role: "tool", text: "画布读取完成", detail: { status: "completed" } }]), false);
});

function stubCanvas(nodes = [], connections = [], selectedNodeIds = []) {
    const snapshot = { projectId: "p1", title: "测试画布", nodes, connections, selectedNodeIds, viewport: { x: 0, y: 0, k: 1 } };
    const calls = [];
    return {
        snapshot,
        calls,
        applyOps(ops) {
            calls.push(ops);
            // Stand in for the real canvas: one node and one edge per op group.
            return {
                ...snapshot,
                nodes: [...snapshot.nodes, node("new-1", "text")],
                connections: [...snapshot.connections, { id: "c1", fromNodeId: "a", toNodeId: "new-1" }],
            };
        },
    };
}

test("reports what actually changed so the model can verify its own work", async () => {
    const canvas = stubCanvas([node("a", "text")]);
    const observation = await runCanvasAgentTool({ name: "canvas_apply_ops", arguments: `{"summary":"加节点","ops":[{"type":"add_node","nodeType":"config"}]}` }, canvas);
    assert.equal(observation.applied, 1);
    assert.equal(observation.addedNodes, 1);
    assert.equal(observation.addedConnections, 1);
    assert.equal(observation.snapshot.nodes.length, 2);
    assert.equal(canvas.calls.length, 1);
});

test("refuses an apply call that carries no usable ops", async () => {
    const canvas = stubCanvas([node("a", "text")]);
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_apply_ops", arguments: "我做不到" }, canvas), /ops/);
    assert.equal(canvas.calls.length, 0, "a rejected call must not touch the canvas");
});

test("returns the live canvas for a read call", async () => {
    const canvas = stubCanvas([node("a", "text"), node("b", "config")], [{ id: "c0", fromNodeId: "a", toNodeId: "b" }]);
    const observation = await runCanvasAgentTool({ name: "canvas_get_state", arguments: "{}" }, canvas);
    assert.equal(observation.snapshot.nodes.length, 2);
    assert.equal(observation.snapshot.connections.length, 1);
    assert.equal(canvas.calls.length, 0, "reads must not mutate");
});

test("prefers the freshest canvas over the snapshot captured at turn start", async () => {
    const canvas = stubCanvas([node("a", "text")]);
    canvas.readSnapshot = () => ({ ...canvas.snapshot, nodes: [node("a", "text"), node("late", "image")] });
    const observation = await runCanvasAgentTool({ name: "canvas_get_state", arguments: "{}" }, canvas);
    assert.deepEqual(observation.snapshot.nodes.map((item) => item.id), ["a", "late"]);
});

test("exposes side-panel workflow ids and config composer content", () => {
    const snapshot = compactCanvasSnapshot({
        projectId: "p1",
        title: "测试画布",
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
        nodes: [node("text-1", "text", { content: "输入正文" }), node("config-1", "config", { composerContent: "真实生成提示词", content: "旧说明", localImageOperation: "split", localImageOperationParams: { rows: 2, columns: 3 } }), node("image-1", "image", { content: "https://example.com/large.png" })],
        connections: [{ id: "a", fromNodeId: "text-1", toNodeId: "config-1" }, { id: "b", fromNodeId: "config-1", toNodeId: "image-1" }],
    });
    assert.deepEqual(snapshot.workflows, [{ index: 1, id: "workflow:config-1", title: "config-1", nodeIds: ["text-1", "config-1", "image-1"], configNodeIds: ["config-1"] }]);
    assert.equal(snapshot.nodes.find((item) => item.id === "config-1").composerContent, "真实生成提示词");
    assert.equal(snapshot.nodes.find((item) => item.id === "config-1").content, undefined);
    assert.equal(snapshot.nodes.find((item) => item.id === "config-1").operation, "split");
    assert.deepEqual(snapshot.nodes.find((item) => item.id === "config-1").operationParams, { rows: 2, columns: 3 });
    assert.equal(snapshot.nodes.find((item) => item.id === "image-1").hasContent, true);
    assert.equal(snapshot.nodes.find((item) => item.id === "image-1").content, undefined);
});

test("keeps a large workflow snapshot structured and within the API budget", () => {
    const nodes = Array.from({ length: 100 }, (_, index) => node(`config-${index}`, "config", { composerContent: `生成指令 ${index} ${"细节".repeat(80)}` }));
    const snapshot = compactCanvasSnapshot({ projectId: "p1", title: "大型画布", nodes, connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, k: 1 } });
    assert.equal(snapshot.truncated, true);
    assert.equal(snapshot.nodes.length, 80);
    assert.equal(snapshot.workflows.length, 100, "workflow identities must survive node detail truncation");
    assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 96_000, "compact snapshots must fit the server validation budget");
});

test("budgets snapshot text by UTF-8 bytes and drops duplicate image prompts", () => {
    const prompt = "人物细节自然真实，避免人工痕迹。".repeat(80);
    const base = {
        projectId: "p1",
        title: "中文画布",
        viewport: { x: 0, y: 0, k: 1 },
        nodes: [node("config-1", "config", { composerContent: prompt, prompt }), node("image-1", "image", { content: "stored", prompt })],
        connections: [{ id: "edge-1", fromNodeId: "config-1", toNodeId: "image-1" }],
    };
    const snapshot = compactCanvasSnapshot({ ...base, selectedNodeIds: [] });
    const config = snapshot.nodes.find((item) => item.id === "config-1");
    const image = snapshot.nodes.find((item) => item.id === "image-1");
    assert.ok(Buffer.byteLength(config.composerContent) <= 640, "Chinese prompts must honor the byte budget used by the API");
    assert.equal(image.prompt, undefined, "generated image outputs must not duplicate their config prompt");

    const selected = compactCanvasSnapshot({ ...base, selectedNodeIds: ["image-1"] });
    const selectedImage = selected.nodes.find((item) => item.id === "image-1");
    assert.ok(selectedImage.prompt, "a selected reference image keeps its useful prompt context");
    assert.ok(Buffer.byteLength(selectedImage.prompt) <= 640);
});

test("narrows a selection read to the selected nodes", async () => {
    const selected = Array.from({ length: 12 }, (_, index) => `image-${index + 1}`);
    const canvas = stubCanvas([node("a", "text"), ...selected.map((id) => node(id, "image", { content: `${id}.png` }))], [], selected);
    const observation = await runCanvasAgentTool({ name: "canvas_get_selection", arguments: "{}" }, canvas);
    assert.equal(observation.total, 12);
    assert.equal(observation.truncated, false);
    assert.deepEqual(observation.selectedNodeIds, selected);
    assert.deepEqual(observation.nodes.map((item) => item.id), selected);
});

test("rejects a tool the canvas does not implement", async () => {
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_teleport", arguments: "{}" }, stubCanvas()), /canvas_teleport/);
});

test("triggers generation only for nodes that exist", async () => {
    const canvas = stubCanvas([node("config-1", "config")]);
    const observation = await runCanvasAgentTool({ name: "canvas_run_generation", arguments: `{"nodeIds":["config-1","ghost"],"mode":"image"}` }, canvas);
    assert.deepEqual(observation.triggered, ["config-1"]);
    assert.deepEqual(observation.missing, ["ghost"]);
    assert.deepEqual(canvas.calls[0], [{ type: "run_generation", nodeId: "config-1", mode: "image" }]);
});

test("delegates selected-image regeneration as one deterministic batch", async () => {
    const canvas = stubCanvas([node("image-1", "image", { content: "https://example.com/1.png" }), node("image-2", "image", { content: "https://example.com/2.png" })], [], ["image-1", "image-2"]);
    let received;
    canvas.regenerateSelection = async (input) => {
        received = input;
        return {
            status: "started",
            batchId: input.requestId,
            generationRequestId: "generation-batch-1",
            createdBranches: 2,
            selectedNodeCount: 2,
            sourceImageCount: 2,
            skippedNodeIds: [],
            items: [
                { sourceNodeId: "image-1", configNodeId: "config-1", outputNodeId: "output-1" },
                { sourceNodeId: "image-2", configNodeId: "config-2", outputNodeId: "output-2" },
            ],
        };
    };
    const observation = await runCanvasAgentTool({
        requestId: "tool-regenerate-1",
        name: "canvas_regenerate_selection",
        arguments: JSON.stringify({ sourceNodeIds: ["model-guessed-wrong-id"], instruction: "分别保留人物特征并换成米白背景" }),
    }, canvas);
    assert.deepEqual(received, {
        requestId: "tool-regenerate-1",
        instruction: "分别保留人物特征并换成米白背景",
    });
    assert.equal(observation.createdBranches, 2);
    assert.deepEqual(observation.items.map((item) => [item.sourceNodeId, item.configNodeId, item.outputNodeId]), [
        ["image-1", "config-1", "output-1"],
        ["image-2", "config-2", "output-2"],
    ]);
});

test("plans twelve strict one-to-one reference branches and replays idempotently", () => {
    const sources = Array.from({ length: 12 }, (_, index) => ({
        ...node(`source-${index + 1}`, "image", { content: `https://example.com/${index + 1}.png` }),
        position: { x: index % 2 ? 360 : 0, y: index * 260 },
    }));
    const snapshot = { projectId: "p1", title: "批量参考图", nodes: sources, connections: [], selectedNodeIds: sources.map((item) => item.id), viewport: { x: 0, y: 0, k: 1 } };
    let sequence = 0;
    const first = planCanvasAgentRegeneration({
        nodes: snapshot.nodes,
        sourceNodes: sources,
        batchId: "tool-batch-1",
        instruction: "分别保留人物身份特征并替换为米白背景",
        createId: (type) => `${type}-${++sequence}`,
        configSize: { width: 360, height: 240 },
        imageSize: { width: 360, height: 360 },
    });
    assert.equal(first.createdBranches, 12);
    assert.equal(first.items.length, 12);
    assert.equal(first.ops.filter((op) => op.type === "add_node").length, 24);
    assert.equal(first.ops.filter((op) => op.type === "connect_nodes").length, 24);
    first.items.forEach((item) => {
        assert.ok(first.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === item.sourceNodeId && op.toNodeId === item.configNodeId));
        assert.ok(first.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === item.configNodeId && op.toNodeId === item.outputNodeId));
        assert.equal(first.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId !== item.sourceNodeId && op.toNodeId === item.configNodeId), false);
    });

    const appliedNodes = [
        ...snapshot.nodes,
        ...first.ops.filter((op) => op.type === "add_node").map((op) => ({
            id: op.id,
            type: op.nodeType,
            title: op.title,
            position: { x: op.x, y: op.y },
            width: op.nodeType === "config" ? 360 : 360,
            height: op.nodeType === "config" ? 240 : 360,
            metadata: op.metadata,
        })),
    ];
    const replay = planCanvasAgentRegeneration({
        nodes: appliedNodes,
        sourceNodes: sources,
        batchId: "tool-batch-1",
        instruction: "分别保留人物身份特征并替换为米白背景",
        createId: () => { throw new Error("replay must reuse existing branch ids"); },
        configSize: { width: 360, height: 240 },
        imageSize: { width: 360, height: 360 },
    });
    assert.equal(replay.createdBranches, 0);
    assert.deepEqual(
        replay.items.map(({ created: _created, ...item }) => item),
        first.items.map(({ created: _created, ...item }) => item),
    );
    assert.equal(replay.items.every((item) => item.created === false), true);
    assert.deepEqual(replay.ops.map((op) => op.type), ["select_nodes"]);
});

test("uses the live valid image selection and only reuses cached ids for a request replay", () => {
    const selected = Array.from({ length: 12 }, (_, index) => `image-${index + 1}`);
    const resolved = resolveCanvasAgentRegenerationSourceIds({
        liveSelectedIds: selected,
        isValidSourceId: (id) => id !== "image-4",
    });
    assert.deepEqual(resolved, selected.filter((id) => id !== "image-4"));

    const replay = resolveCanvasAgentRegenerationSourceIds({
        replayIds: selected,
        liveSelectedIds: ["output-1", "output-2"],
        isValidSourceId: () => true,
    });
    assert.deepEqual(replay, selected, "a replay must keep its browser-cached sources after selection moves to outputs");
});

test("tracks only the current generation request instead of stale node success", async () => {
    const canvas = stubCanvas([node("config-1", "config", { status: "success" })]);
    let polls = 0;
    canvas.startGeneration = ({ nodeIds }) => ({ requestId: "generation-new", nodeIds });
    canvas.getGenerationStatus = () => ({
        requestId: "generation-new",
        tasks: [{ nodeId: "config-1", status: polls++ ? "succeeded" : "running" }],
    });
    const started = await runCanvasAgentTool({ name: "canvas_run_generation", arguments: `{"nodeIds":["config-1"]}` }, canvas);
    assert.equal(started.requestId, "generation-new");
    const status = await runCanvasAgentTool({ name: "canvas_generation_status", arguments: `{"requestId":"generation-new","waitSeconds":2}` }, canvas);
    assert.equal(status.settled, true);
    assert.deepEqual(status.summary, { succeeded: 1 });
    assert.ok(polls >= 2, "status must observe this request becoming terminal");
});

test("runs a named workflow through the workflow scheduler", async () => {
    const canvas = stubCanvas([node("config-1", "config")]);
    let polls = 0;
    canvas.startWorkflow = ({ workflowId }) => ({ requestId: "workflow-new", workflowId, configNodeIds: ["config-1"] });
    canvas.getWorkflowStatus = () => ({ requestId: "workflow-new", workflowId: "workflow:config-1", status: polls++ ? "succeeded" : "running", completed: polls > 1 ? 1 : 0, total: 1 });
    const started = await runCanvasAgentTool({ name: "canvas_run_workflow", arguments: `{"workflowId":"workflow:config-1"}` }, canvas);
    assert.equal(started.requestId, "workflow-new");
    const status = await runCanvasAgentTool({ name: "canvas_workflow_status", arguments: `{"requestId":"workflow-new","waitSeconds":2}` }, canvas);
    assert.equal(status.status, "succeeded");
    assert.equal(status.settled, true);
});

test("refuses to trigger generation when no known node is named", async () => {
    const canvas = stubCanvas([node("config-1", "config")]);
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_run_generation", arguments: `{"nodeIds":["ghost"]}` }, canvas), /不存在/);
    assert.equal(canvas.calls.length, 0);
});

test("waits for a running generation and reports the settled result", async () => {
    const canvas = stubCanvas([node("image-1", "image", { status: "loading" })]);
    const startedAt = Date.now();
    canvas.readSnapshot = () => ({
        ...canvas.snapshot,
        nodes: [node("image-1", "image", { status: Date.now() - startedAt > 800 ? "success" : "loading" })],
    });
    const observation = await runCanvasAgentTool({ name: "canvas_generation_status", arguments: `{"nodeIds":["image-1"],"waitSeconds":10}` }, canvas);
    assert.equal(observation.settled, true);
    assert.equal(observation.tasks[0].status, "succeeded");
    assert.deepEqual(observation.summary, { succeeded: 1 });
});

test("gives up waiting without pretending the generation finished", async () => {
    const canvas = stubCanvas([node("image-1", "image", { status: "loading" })]);
    const observation = await runCanvasAgentTool({ name: "canvas_generation_status", arguments: `{"nodeIds":["image-1"],"waitSeconds":1}` }, canvas);
    assert.equal(observation.settled, false);
    assert.equal(observation.tasks[0].status, "running");
});

test("applies move and resize ops", async () => {
    const canvas = stubCanvas([node("text-1", "text")]);
    canvas.applyOps = (ops) => {
        canvas.calls.push(ops);
        return canvas.snapshot;
    };
    const observation = await runCanvasAgentTool({
        name: "canvas_apply_ops",
        arguments: `{"summary":"移动并缩放","ops":[{"type":"move_nodes","items":[{"id":"text-1","dx":40,"dy":0}]},{"type":"resize_node","id":"text-1","width":480,"height":240}]}`,
    }, canvas);
    assert.equal(observation.applied, 0, "the test canvas returned an unchanged snapshot");
    assert.equal(observation.ignored, 2);
    assert.equal(canvas.calls[0][0].type, "move_nodes");
    assert.equal(canvas.calls[0][1].type, "resize_node");
});

test("reports mixed batches by operations that actually changed state", async () => {
    const canvas = stubCanvas([node("text-1", "text")]);
    canvas.applyOps = (ops) => {
        canvas.calls.push(ops);
        return {
            ...canvas.snapshot,
            nodes: [{ ...canvas.snapshot.nodes[0], position: { x: 40, y: 0 } }],
            agentReport: { requested: 2, accepted: 2, applied: 1, rejected: 0, errors: [] },
        };
    };
    const observation = await runCanvasAgentTool({
        name: "canvas_apply_ops",
        arguments: `{"ops":[{"type":"update_node","id":"text-1","title":"text-1"},{"type":"move_nodes","items":[{"id":"text-1","dx":40}]}]}`,
    }, canvas);
    assert.equal(observation.requested, 2);
    assert.equal(observation.applied, 1);
    assert.equal(observation.ignored, 1);
    assert.equal(observation.changedNodes, 1);
});

test("allows only in-site navigation paths", async () => {
    const paths = [];
    const canvas = stubCanvas();
    canvas.navigate = (path) => paths.push(path);
    const observation = await runCanvasAgentTool({ name: "site_navigate", arguments: `{"path":"/assets"}` }, canvas);
    assert.equal(observation.path, "/assets");
    assert.deepEqual(paths, ["/assets"]);
    await assert.rejects(() => runCanvasAgentTool({ name: "site_navigate", arguments: `{"path":"https://evil.example"}` }, canvas), /不允许/);
    await assert.rejects(() => runCanvasAgentTool({ name: "site_navigate", arguments: `{"path":"//evil.example"}` }, canvas), /不允许/);
});

test("export snapshot is a read of the live canvas", async () => {
    const canvas = stubCanvas([node("a", "text")]);
    const observation = await runCanvasAgentTool({ name: "canvas_export_snapshot", arguments: "{}" }, canvas);
    assert.equal(observation.snapshot.nodes.length, 1);
    assert.equal(canvas.calls.length, 0);
});

test("places chat attachments onto the canvas", async () => {
    const canvas = stubCanvas();
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_create_attachment_nodes", arguments: `{"attachmentIds":["missing"]}` }, canvas), /附件不存在/);
});
