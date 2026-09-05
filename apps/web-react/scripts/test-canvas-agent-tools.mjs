import assert from "node:assert/strict";
import test from "node:test";

import { compactCanvasSnapshot, runCanvasAgentTool } from "../src/canvas/lib/canvas/canvas-hosted-agent.ts";
import { planCanvasAgentRegeneration, resolveCanvasAgentRegenerationSourceIds } from "../src/canvas/lib/canvas/canvas-agent-regenerate.ts";
import { hasVisibleAgentRunActivity } from "../src/canvas/lib/agent/agent-run-activity.ts";
import { inspectCanvasWorkflowTemplate, queryCanvasWorkflowTemplates } from "../src/canvas/lib/agent/canvas-workflow-template-agent.ts";
import { analyzeCanvasVisualFingerprints, inspectCanvasVisuals } from "../src/canvas/lib/canvas/canvas-visual-inspection.ts";

const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata });

test("searches and inspects workflow templates without exposing image payloads", () => {
    const summaries = [
        { id: "tpl-commerce", slug: "commerce", title: "电商详情图", category: "commerce", categoryLabel: "电商", industry: "零售", summary: "生成商品详情页", platforms: ["淘宝"], deliverables: ["详情图"], accent: "#000", nodeCount: 3, sort: 1 },
        { id: "tpl-game", slug: "game", title: "游戏角色", category: "game", categoryLabel: "游戏", industry: "游戏", summary: "生成角色设定", platforms: [], deliverables: ["角色图"], accent: "#000", nodeCount: 2, sort: 2 },
    ];
    const listed = queryCanvasWorkflowTemplates(summaries, { keyword: "淘宝", category: "电商" });
    assert.equal(listed.total, 1);
    assert.equal(listed.items[0].id, "tpl-commerce");
    const inspected = inspectCanvasWorkflowTemplate({
        ...summaries[0],
        document: {
            version: 3,
            nodes: [
                node("input", "image", { content: "data:image/png;base64,secret", storageKey: "template/input.png" }),
                node("config", "config", { composerContent: "参考 @[node:input] 生成商品详情图", workflowOutputNodeIds: ["output"] }),
                node("output", "image", { workflowProducerNodeId: "config" }),
            ],
            connections: [
                { id: "a", fromNodeId: "input", toNodeId: "config" },
                { id: "b", fromNodeId: "config", toNodeId: "output" },
            ],
        },
    });
    assert.equal(inspected.nodes.find((item) => item.id === "input").metadata.hasMedia, true);
    assert.equal(inspected.workflows.length, 1);
    assert.equal(JSON.stringify(inspected).includes("base64,secret"), false);
});

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

function liveCanvas(nodes = [], connections = [], selectedNodeIds = []) {
    let snapshot = { projectId: "p1", title: "测试画布", nodes, connections, selectedNodeIds, viewport: { x: 0, y: 0, k: 1 } };
    const calls = [];
    return {
        snapshot,
        calls,
        readSnapshot: () => snapshot,
        applyOps(ops) {
            calls.push(ops);
            snapshot = {
                ...snapshot,
                nodes: snapshot.nodes.map((item) => {
                    const update = ops.find((op) => op.type === "update_node" && op.id === item.id);
                    return update ? { ...item, metadata: { ...item.metadata, ...update.patch?.metadata, ...update.metadata } } : item;
                }),
                agentReport: { requested: ops.length, accepted: ops.length, applied: ops.length, rejected: 0, errors: [] },
            };
            return snapshot;
        },
    };
}

test("visual inspection follows a selected text node to every downstream image", async () => {
    const snapshot = {
        projectId: "p1",
        title: "商品工作流",
        nodes: [
            node("prompt", "text", { content: "商品素材" }),
            node("config", "config", { composerContent: "生成两张商品图" }),
            node("output-a", "image", { storageKey: "tasks/user/task-a/original/a.png", workflowProducerNodeId: "config", generationCompletedAt: "2026-08-27T10:00:00Z" }),
            node("output-b", "image", { storageKey: "tasks/user/task-b/original/b.png", workflowProducerNodeId: "config", generationCompletedAt: "2026-08-27T10:00:01Z" }),
        ],
        connections: [
            { id: "a", fromNodeId: "prompt", toNodeId: "config" },
            { id: "b", fromNodeId: "config", toNodeId: "output-a" },
            { id: "c", fromNodeId: "config", toNodeId: "output-b" },
        ],
        selectedNodeIds: ["prompt"],
        viewport: { x: 0, y: 0, k: 1 },
    };
    const result = await inspectCanvasVisuals(snapshot, { scope: "auto" });
    assert.equal(result.resolvedFrom, "selection_downstream");
    assert.equal(result.inspected, 2);
    assert.deepEqual(new Set(result.items.map((item) => item.nodeId)), new Set(["output-a", "output-b"]));
    assert.deepEqual(new Set(result.visionReferences.map((item) => item.nodeId)), new Set(["output-a", "output-b"]));
});

test("visual inspection exposes every image in a multi-image node and detects identical storage", async () => {
    const sharedKey = "uploads/user/original/shared.png";
    const canvas = stubCanvas([
        node("gallery", "image", {
            images: [
                { id: "first", content: "", storageKey: sharedKey, thumbnailUrl: "", naturalWidth: 1200, naturalHeight: 800 },
                { id: "second", content: "", storageKey: sharedKey, thumbnailUrl: "", naturalWidth: 1200, naturalHeight: 800 },
            ],
        }),
    ], [], ["gallery"]);
    const result = await runCanvasAgentTool({ name: "canvas_inspect_visuals", arguments: "{}" }, canvas);
    assert.equal(result.inspected, 2);
    assert.deepEqual(result.items.map((item) => item.imageId), ["first", "second"]);
    assert.equal(result.exactDuplicateGroups.length, 1);
    assert.deepEqual(result.exactDuplicateGroups[0].resourceIds, ["gallery:first", "gallery:second"]);
    assert.equal(result.visionReferences.every((item) => item.nodeId === "gallery" && item.fileKey === sharedKey), true);
});

test("visual fingerprint analysis separates exact and perceptual duplicates", () => {
    const result = analyzeCanvasVisualFingerprints([
        { resourceId: "a", nodeId: "node-a", exact: "sha-a", perceptual: "0000000000000000" },
        { resourceId: "b", nodeId: "node-b", exact: "sha-a", perceptual: "0000000000000000" },
        { resourceId: "c", nodeId: "node-c", exact: "sha-c", perceptual: "0000000000000003" },
        { resourceId: "d", nodeId: "node-d", exact: "sha-d", perceptual: "ffffffffffffffff" },
    ]);
    assert.equal(result.exactDuplicateGroups.length, 1);
    assert.deepEqual(result.exactDuplicateGroups[0].nodeIds, ["node-a", "node-b"]);
    assert.equal(result.similarPairs.some((pair) => pair.leftResourceId === "a" && pair.rightResourceId === "c"), true);
    assert.equal(result.similarPairs.some((pair) => pair.leftResourceId === "a" && pair.rightResourceId === "b"), false, "exact pairs must not be reported twice");
    assert.equal(result.similarPairs.some((pair) => pair.rightResourceId === "d"), false);
});

test("visual fingerprint analysis caps quadratic similar-pair output", () => {
    const result = analyzeCanvasVisualFingerprints(Array.from({ length: 70 }, (_, index) => ({
        resourceId: `resource-${index}`,
        nodeId: `node-${index}`,
        exact: `sha-${index}`,
        perceptual: "0000000000000000",
    })));
    assert.equal(result.similarPairs.length, 64);
    assert.equal(result.similarPairsTruncated, true);
});

test("visual inspection falls back to the most recent workflow outputs", async () => {
    const canvas = stubCanvas([
        node("old", "image", { storageKey: "tasks/user/old/original/a.png", workflowProducerNodeId: "config-old", generationCompletedAt: "2026-08-26T10:00:00Z" }),
        node("new", "image", { storageKey: "tasks/user/new/original/b.png", workflowProducerNodeId: "config-new", generationCompletedAt: "2026-08-27T10:00:00Z" }),
        node("loose", "image", { storageKey: "uploads/user/original/loose.png", generationCompletedAt: "2026-08-28T10:00:00Z" }),
    ]);
    const result = await runCanvasAgentTool({ name: "canvas_inspect_visuals", arguments: JSON.stringify({ maxImages: 1 }) }, canvas);
    assert.equal(result.resolvedFrom, "recent_outputs");
    assert.equal(result.total, 2, "workflow outputs take precedence over unrelated loose images");
    assert.equal(result.items[0].nodeId, "new");
    assert.equal(result.truncated, true);
});

test("visual inspection paginates a large selection without dropping images", async () => {
    const sharedKey = "tasks/user/shared-task/original/result.png";
    const images = Array.from({ length: 15 }, (_, index) => node(`image-${String(index + 1).padStart(2, "0")}`, "image", {
        storageKey: index === 0 || index === 14 ? sharedKey : `tasks/user/task-${index + 1}/original/result.png`,
        generationCompletedAt: "2026-08-27T10:00:00Z",
    }));
    const canvas = stubCanvas(images, [], images.map((item) => item.id));
    const first = await runCanvasAgentTool({ name: "canvas_inspect_visuals", arguments: "{}" }, canvas);
    assert.equal(first.inspected, 12);
    assert.equal(first.truncated, true);
    assert.equal(first.nextOffset, 12);
    const second = await runCanvasAgentTool({ name: "canvas_inspect_visuals", arguments: JSON.stringify({ offset: first.nextOffset }) }, canvas);
    assert.equal(second.inspected, 3);
    assert.equal(second.offset, 12);
    assert.equal(second.truncated, false);
    assert.equal(second.nextOffset, undefined);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.nodeId)).size, 15);
    assert.equal(second.compared, 15);
    assert.equal(second.exactDuplicateGroups.some((group) => new Set(group.nodeIds).has("image-01") && new Set(group.nodeIds).has("image-15")), true, "duplicates across pages must be detected");
});

function semanticCanvas(nodes = [], connections = [], selectedNodeIds = []) {
    let snapshot = { projectId: "p1", title: "测试画布", nodes, connections, selectedNodeIds, viewport: { x: 0, y: 0, k: 1 } };
    const calls = [];
    return {
        snapshot,
        calls,
        readSnapshot: () => snapshot,
        applyOps(ops) {
            calls.push(ops);
            let nextNodes = snapshot.nodes;
            let nextConnections = snapshot.connections;
            let nextSelected = snapshot.selectedNodeIds;
            for (const op of ops) {
                if (op.type === "add_node") {
                    nextNodes = [...nextNodes, {
                        id: op.id,
                        type: op.nodeType,
                        title: op.title || op.nodeType,
                        position: op.position || { x: 0, y: 0 },
                        width: op.width || 360,
                        height: op.height || 414,
                        metadata: op.metadata || {},
                    }];
                }
                if (op.type === "connect_nodes") nextConnections = [...nextConnections, { id: op.id || `edge-${nextConnections.length}`, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
                if (op.type === "select_nodes") nextSelected = [...op.ids];
                if (op.type === "update_node") {
                    nextNodes = nextNodes.map((item) => item.id === op.id ? { ...item, metadata: { ...item.metadata, ...op.patch?.metadata, ...op.metadata } } : item);
                }
            }
            snapshot = { ...snapshot, nodes: nextNodes, connections: nextConnections, selectedNodeIds: nextSelected, agentReport: { requested: ops.length, accepted: ops.length, applied: ops.length, rejected: 0, errors: [] } };
            return snapshot;
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

test("creates one reusable split node and one exact edge for every selected image", async () => {
    const canvas = semanticCanvas([
        node("image-1", "image", { content: "stored-1" }),
        node("image-2", "image", { storageKey: "uploads/image-2.png" }),
    ], [], ["image-1", "image-2"]);
    const observation = await runCanvasAgentTool({
        name: "canvas_create_image_operation",
        arguments: JSON.stringify({ operation: "split", params: { rows: 2, columns: 3 }, execute: false }),
    }, canvas);
    assert.equal(observation.created, 2);
    assert.equal(observation.items.length, 2);
    assert.equal(observation.generation, undefined);
    const operationNodes = canvas.readSnapshot().nodes.filter((item) => item.type === "builtin:split");
    assert.equal(operationNodes.length, 2);
    assert.equal(operationNodes.every((item) => item.metadata.count === 6), true);
    assert.deepEqual(canvas.readSnapshot().connections.map((edge) => edge.fromNodeId), ["image-1", "image-2"]);
    assert.equal(new Set(canvas.readSnapshot().connections.map((edge) => edge.toNodeId)).size, 2);
});

test("only starts an image operation when execute is explicitly true", async () => {
    const canvas = semanticCanvas([node("image-1", "image", { content: "stored" })], [], ["image-1"]);
    const starts = [];
    canvas.startGeneration = (input) => {
        starts.push(input);
        return { requestId: "generation-1", nodeIds: input.nodeIds };
    };
    const observation = await runCanvasAgentTool({
        name: "canvas_create_image_operation",
        arguments: JSON.stringify({ operation: "upscale", params: { targetLongEdge: 4096, algorithm: "high" }, execute: true }),
    }, canvas);
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].nodeIds, observation.nodeIds);
    assert.equal(canvas.readSnapshot().nodes.find((item) => item.id === observation.nodeIds[0]).metadata.localImageOperationParams.targetLongEdge, 4096);
});

test("creates image operation nodes for every image in a selection larger than twenty", async () => {
    const images = Array.from({ length: 25 }, (_, index) => node(`image-${index + 1}`, "image", { content: `stored-${index + 1}` }));
    const canvas = semanticCanvas(images, [], images.map((item) => item.id));
    const observation = await runCanvasAgentTool({
        name: "canvas_create_image_operation",
        arguments: JSON.stringify({ operation: "split", params: { rows: 2, columns: 2 }, execute: false }),
    }, canvas);
    assert.equal(observation.created, 25);
    assert.equal(observation.items.length, 25);
    assert.equal(canvas.readSnapshot().nodes.filter((item) => item.type === "builtin:split").length, 25);
    assert.equal(canvas.readSnapshot().connections.length, 25);
});

test("rejects an oversized image-operation selection instead of silently truncating it", async () => {
    const images = Array.from({ length: 81 }, (_, index) => node(`image-${index + 1}`, "image", { content: `stored-${index + 1}` }));
    const canvas = semanticCanvas(images, [], images.map((item) => item.id));
    await assert.rejects(() => runCanvasAgentTool({
        name: "canvas_create_image_operation",
        arguments: JSON.stringify({ operation: "upscale", execute: false }),
    }, canvas), /当前选择了 81 个/);
    assert.equal(canvas.calls.length, 0);
});

test("duplicates a selected workflow branch with remapped references and internal edges", async () => {
    const canvas = semanticCanvas([
        node("input", "text", { content: "商品资料" }),
        node("config", "config", { composerContent: "使用 @[node:input] 生成图片", workflowOutputNodeIds: ["output"], taskId: "old-task", executionStatus: "running" }),
        node("output", "image", { content: "old-result", workflowProducerNodeId: "config" }),
    ], [
        { id: "a", fromNodeId: "input", toNodeId: "config" },
        { id: "b", fromNodeId: "config", toNodeId: "output" },
    ], ["input", "config", "output"]);
    const observation = await runCanvasAgentTool({ name: "canvas_duplicate_selection", arguments: "{}" }, canvas);
    assert.equal(observation.duplicated, 3);
    assert.equal(observation.copiedConnections, 2);
    const ids = new Map(observation.items.map((item) => [item.sourceNodeId, item.copiedNodeId]));
    const config = canvas.readSnapshot().nodes.find((item) => item.id === ids.get("config"));
    assert.equal(config.metadata.composerContent, `使用 @[node:${ids.get("input")}] 生成图片`);
    assert.deepEqual(config.metadata.workflowOutputNodeIds, [ids.get("output")]);
    assert.equal(config.metadata.taskId, undefined);
    assert.equal(config.metadata.executionStatus, undefined);
    assert.equal(canvas.readSnapshot().nodes.find((item) => item.id === ids.get("output")).metadata.workflowProducerNodeId, ids.get("config"));
});

test("replaces one workflow input and reruns only its reachable executable nodes", async () => {
    const canvas = semanticCanvas([
        node("old-input", "image", { content: "old-image", storageKey: "old-key" }),
        node("new-input", "image", { content: "new-image", storageKey: "new-key", naturalWidth: 1200, naturalHeight: 800 }),
        node("config-a", "config", { generationMode: "image", status: "success", workflowOutputNodeIds: ["output-a"] }),
        node("output-a", "image", { content: "old-output-a", storageKey: "result-a", workflowProducerNodeId: "config-a" }),
        node("config-b", "config", { generationMode: "image", status: "success", workflowOutputNodeIds: ["output-b"] }),
        node("output-b", "image", { content: "old-output-b", storageKey: "result-b", workflowProducerNodeId: "config-b" }),
        node("other-config", "config", { generationMode: "image", status: "success" }),
    ], [
        { id: "a", fromNodeId: "old-input", toNodeId: "config-a" },
        { id: "b", fromNodeId: "config-a", toNodeId: "output-a" },
        { id: "c", fromNodeId: "output-a", toNodeId: "config-b" },
        { id: "d", fromNodeId: "config-b", toNodeId: "output-b" },
    ]);
    const starts = [];
    canvas.getWorkflowState = () => ({ status: "idle", completed: 0, total: 0 });
    canvas.startWorkflow = (input) => {
        starts.push(input);
        return { requestId: "workflow-1", workflowId: input.workflowId, configNodeIds: input.nodeIds };
    };
    const observation = await runCanvasAgentTool({
        name: "canvas_replace_workflow_input",
        arguments: JSON.stringify({ targetNodeId: "old-input", sourceNodeId: "new-input", runDownstream: true }),
    }, canvas);
    assert.deepEqual(observation.executableNodeIds, ["config-a", "config-b"]);
    assert.deepEqual(starts[0].nodeIds, ["config-a", "config-b"]);
    assert.equal(starts[0].nodeIds.includes("other-config"), false);
    const updatedInput = canvas.readSnapshot().nodes.find((item) => item.id === "old-input");
    assert.equal(updatedInput.metadata.content, "new-image");
    assert.equal(updatedInput.metadata.storageKey, "new-key");
    assert.equal(canvas.readSnapshot().nodes.find((item) => item.id === "output-a").metadata.content, "");
    assert.equal(canvas.readSnapshot().nodes.find((item) => item.id === "output-b").metadata.content, "");
    assert.equal(canvas.readSnapshot().nodes.find((item) => item.id === "other-config").metadata.status, "success");
});

test("refuses to replace workflow input while a workflow is active", async () => {
    const canvas = semanticCanvas([
        node("old-input", "image", { content: "old" }),
        node("new-input", "image", { content: "new" }),
        node("config", "config", { generationMode: "image" }),
    ], [{ id: "a", fromNodeId: "old-input", toNodeId: "config" }]);
    canvas.getWorkflowState = () => ({ status: "running", completed: 0, total: 1 });
    await assert.rejects(() => runCanvasAgentTool({
        name: "canvas_replace_workflow_input",
        arguments: JSON.stringify({ targetNodeId: "old-input", sourceNodeId: "new-input" }),
    }, canvas), /请先停止/);
    assert.equal(canvas.calls.length, 0);
});

test("lists, creates, and restores named Agent history through exact ids", async () => {
    const canvas = semanticCanvas([node("a", "text", { content: "current" })]);
    const restoredSnapshot = { ...canvas.snapshot, nodes: [node("a", "text", { content: "checkpoint" })] };
    canvas.listHistory = () => ({ past: [{ id: "transaction-1", name: "修改节点", createdAt: "now" }], future: [], checkpoints: [{ id: "checkpoint-1", name: "初始版本", createdAt: "now" }] });
    canvas.createCheckpoint = (name) => ({ id: "checkpoint-2", name, createdAt: "later" });
    canvas.restoreHistory = (input) => input.checkpointId === "checkpoint-1" ? restoredSnapshot : null;
    const listed = await runCanvasAgentTool({ name: "canvas_list_agent_history", arguments: "{}" }, canvas);
    assert.equal(listed.checkpoints[0].id, "checkpoint-1");
    const created = await runCanvasAgentTool({ name: "canvas_create_checkpoint", arguments: JSON.stringify({ name: "替换前" }) }, canvas);
    assert.equal(created.checkpoint.name, "替换前");
    const restored = await runCanvasAgentTool({ name: "canvas_restore_checkpoint", arguments: JSON.stringify({ checkpointId: "checkpoint-1" }) }, canvas);
    assert.equal(restored.restored, true);
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_restore_checkpoint", arguments: JSON.stringify({ checkpointId: "missing" }) }, canvas), /不存在/);
});

test("returns the browser-calculated workflow preflight without starting generation", async () => {
    const canvas = semanticCanvas([node("config", "config", { generationMode: "image" })]);
    const calls = [];
    canvas.planWorkflow = (input) => {
        calls.push(input);
        return {
            workflowId: "workflow:config",
            resumeFromCheckpoint: false,
            nodeIds: ["config"],
            completedNodeIds: [],
            items: [{ nodeId: "config", title: "商品主图", mode: "image", model: "image-model", count: 2, localOperation: false, inputSummary: { textCount: 1, imageCount: 1, videoCount: 0, audioCount: 0 }, unit: 3, total: 6 }],
            totals: { generation: 6, removal: 0, total: 6, paidNodeCount: 1, freeNodeCount: 0 },
        };
    };
    const result = await runCanvasAgentTool({ name: "canvas_plan_workflow_run", arguments: JSON.stringify({ workflowId: "workflow:config", nodeIds: ["config", "config"] }) }, canvas);
    assert.deepEqual(calls, [{ workflowId: "workflow:config", nodeIds: ["config"] }]);
    assert.equal(result.totals.total, 6);
    assert.equal(canvas.calls.length, 0);
});

test("finds and inspects exact nodes without exposing image payloads", async () => {
    const canvas = semanticCanvas([
        { ...node("hero", "image", { content: "data:image/png;base64,secret", model: "image-model" }), title: "商品主图" },
        { ...node("copy", "text", { content: "夏季新品文案" }), title: "文案" },
    ], [{ id: "edge", fromNodeId: "copy", toNodeId: "hero" }], ["hero"]);
    const found = await runCanvasAgentTool({ name: "canvas_find_nodes", arguments: JSON.stringify({ query: "商品" }) }, canvas);
    assert.deepEqual(found.nodes.map((item) => item.id), ["hero"]);
    const inspected = await runCanvasAgentTool({ name: "canvas_inspect_nodes", arguments: "{}" }, canvas);
    assert.deepEqual(inspected.nodes[0].upstreamNodeIds, ["copy"]);
    assert.equal(inspected.nodes[0].metadata.hasContent, true);
    assert.equal(JSON.stringify(inspected).includes("base64,secret"), false);
});

test("pages through node search results without losing matches on large canvases", async () => {
    const canvas = semanticCanvas(Array.from({ length: 95 }, (_, index) => node(`image-${index + 1}`, "image", { content: `stored-${index + 1}` })));
    const first = await runCanvasAgentTool({ name: "canvas_find_nodes", arguments: JSON.stringify({ types: ["image"], limit: 40 }) }, canvas);
    const second = await runCanvasAgentTool({ name: "canvas_find_nodes", arguments: JSON.stringify({ types: ["image"], limit: 40, offset: first.nextOffset }) }, canvas);
    const third = await runCanvasAgentTool({ name: "canvas_find_nodes", arguments: JSON.stringify({ types: ["image"], limit: 40, offset: second.nextOffset }) }, canvas);
    assert.equal(first.total, 95);
    assert.equal(first.nodes.length, 40);
    assert.equal(second.nodes.length, 40);
    assert.equal(third.nodes.length, 15);
    assert.equal(third.hasMore, false);
    assert.equal(new Set([...first.nodes, ...second.nodes, ...third.nodes].map((item) => item.id)).size, 95);
});

test("validates empty workflow inputs before execution", async () => {
    const canvas = semanticCanvas([
        node("input", "text", { content: "" }),
        node("config", "config", { generationMode: "image" }),
        node("output", "image"),
    ], [
        { id: "a", fromNodeId: "input", toNodeId: "config" },
        { id: "b", fromNodeId: "config", toNodeId: "output" },
    ]);
    const observation = await runCanvasAgentTool({ name: "canvas_validate_workflow", arguments: "{}" }, canvas);
    assert.equal(observation.valid, false);
    assert.deepEqual(observation.workflows[0].emptyInputNodeIds, ["input"]);
});

test("requires every declared reference image to feed the executable workflow", async () => {
    const canvas = semanticCanvas([
        node("reference-a", "image", { content: "/a.png" }),
        node("reference-b", "image", { content: "/b.png" }),
        node("prompt", "text", { content: "商品主图" }),
        node("config", "config", { generationMode: "image" }),
        node("output", "image"),
    ], [
        { id: "a", fromNodeId: "reference-a", toNodeId: "config" },
        { id: "b", fromNodeId: "prompt", toNodeId: "config" },
        { id: "c", fromNodeId: "config", toNodeId: "output" },
    ]);
    const incomplete = await runCanvasAgentTool({
        name: "canvas_validate_workflow",
        arguments: JSON.stringify({ requiredInputNodeIds: ["reference-a", "reference-b"] }),
    }, canvas);
    assert.equal(incomplete.valid, false);
    assert.deepEqual(incomplete.disconnectedRequiredInputNodeIds, ["reference-b"]);
    canvas.snapshot = {
        ...canvas.snapshot,
        connections: [...canvas.snapshot.connections, { id: "d", fromNodeId: "reference-b", toNodeId: "config" }],
    };
    canvas.readSnapshot = () => canvas.snapshot;
    const complete = await runCanvasAgentTool({
        name: "canvas_validate_workflow",
        arguments: JSON.stringify({ requiredInputNodeIds: ["reference-a", "reference-b"] }),
    }, canvas);
    assert.equal(complete.valid, true);
    assert.deepEqual(complete.disconnectedRequiredInputNodeIds, []);
});

test("stops the live workflow and retries only when failed nodes exist", async () => {
    const canvas = semanticCanvas([node("config", "config", { generationMode: "image", status: "error" })]);
    canvas.stopWorkflow = () => ({ stopped: true, status: "canceling", nodeIds: ["config"] });
    canvas.startWorkflow = (input) => ({ requestId: "workflow-1", workflowId: input.workflowId, configNodeIds: ["config"] });
    const stopped = await runCanvasAgentTool({ name: "canvas_stop_workflow", arguments: "{}" }, canvas);
    assert.equal(stopped.stopped, true);
    const retried = await runCanvasAgentTool({ name: "canvas_retry_failed_nodes", arguments: "{}" }, canvas);
    assert.equal(retried.mode, "retry_failed");
    assert.deepEqual(retried.configNodeIds, ["config"]);
    canvas.snapshot = { ...canvas.snapshot, nodes: [node("config", "config", { generationMode: "image", status: "success" })] };
    canvas.readSnapshot = () => canvas.snapshot;
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_retry_failed_nodes", arguments: "{}" }, canvas), /没有失败节点/);
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

test("exposes current image generation settings in the compact snapshot", () => {
    const snapshot = compactCanvasSnapshot({
        projectId: "p1",
        title: "参数画布",
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
        nodes: [node("config-1", "config", { generationMode: "image", model: "gpt-image", size: "1:1", resolution: "2k", quality: "medium", count: 3, background: "transparent" })],
        connections: [],
    });
    const config = snapshot.nodes[0];
    assert.equal(config.model, "gpt-image");
    assert.equal(config.size, "1:1");
    assert.equal(config.resolution, "2k");
    assert.equal(config.quality, "medium");
    assert.equal(config.count, 3);
    assert.equal(config.background, "transparent");
});

test("updates all six existing generation configs in one workflow without structural changes", async () => {
    const configs = Array.from({ length: 6 }, (_, index) => node(`config-${index + 1}`, "config", { generationMode: "image", size: "1:1", quality: "medium" }));
    const outputs = Array.from({ length: 6 }, (_, index) => node(`image-${index + 1}`, "image", { workflowProducerNodeId: `config-${index + 1}` }));
    const connections = configs.flatMap((config, index) => [
        { id: `input-${index + 1}`, fromNodeId: "input", toNodeId: config.id },
        { id: `output-${index + 1}`, fromNodeId: config.id, toNodeId: outputs[index].id },
    ]);
    const canvas = liveCanvas([node("input", "text"), ...configs, ...outputs], connections);
    const observation = await runCanvasAgentTool({
        name: "canvas_update_generation_settings",
        arguments: JSON.stringify({ size: "9:16", quality: "high" }),
    }, canvas);
    assert.equal(observation.matched, 6);
    assert.equal(observation.updated, 6);
    assert.equal(observation.addedNodes, 0);
    assert.equal(observation.addedConnections, 0);
    assert.equal(canvas.calls.length, 1);
    assert.equal(canvas.calls[0].length, 6);
    assert.equal(canvas.calls[0].every((op) => op.type === "update_node"), true);
    assert.equal(canvas.readSnapshot().nodes.length, 13);
    assert.equal(canvas.readSnapshot().connections.length, 12);
    configs.forEach((config) => {
        const updated = canvas.readSnapshot().nodes.find((item) => item.id === config.id);
        assert.equal(updated.metadata.size, "9:16");
        assert.equal(updated.metadata.quality, "high");
    });
});

test("maps a selected output image back to its exact producer config", async () => {
    const canvas = liveCanvas([
        node("config-1", "config", { generationMode: "image", size: "1:1" }),
        node("image-1", "image", { workflowProducerNodeId: "config-1" }),
        node("config-2", "config", { generationMode: "image", size: "1:1" }),
        node("image-2", "image", { workflowProducerNodeId: "config-2" }),
    ], [
        { id: "edge-1", fromNodeId: "config-1", toNodeId: "image-1" },
        { id: "edge-2", fromNodeId: "config-2", toNodeId: "image-2" },
    ], ["image-2"]);
    const observation = await runCanvasAgentTool({
        name: "canvas_update_generation_settings",
        arguments: JSON.stringify({ size: "9:16", quality: "high" }),
    }, canvas);
    assert.deepEqual(observation.nodeIds, ["config-2"]);
    assert.equal(canvas.readSnapshot().nodes.find((item) => item.id === "config-1").metadata.size, "1:1");
    assert.equal(canvas.readSnapshot().nodes.find((item) => item.id === "config-2").metadata.size, "9:16");
});

test("fails closed when multiple workflows are ambiguous", async () => {
    const canvas = liveCanvas([
        node("config-1", "config", { generationMode: "image" }),
        node("config-2", "config", { generationMode: "image" }),
    ]);
    await assert.rejects(() => runCanvasAgentTool({
        name: "canvas_update_generation_settings",
        arguments: JSON.stringify({ size: "9:16", quality: "high" }),
    }, canvas), /2 个生图工作流/);
    assert.equal(canvas.calls.length, 0);
});

test("undoes and redoes the latest verified Agent canvas transaction", async () => {
    const original = {
        projectId: "p1",
        title: "回退画布",
        nodes: [node("config-1", "config", { generationMode: "image", size: "1:1", quality: "medium" })],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
    const changed = {
        ...original,
        nodes: [node("config-1", "config", { generationMode: "image", size: "9:16", quality: "high" })],
    };
    let current = changed;
    const canvas = {
        snapshot: changed,
        readSnapshot: () => current,
        applyOps: () => current,
        canUndo: true,
        canRedo: false,
        undoOps: () => {
            current = original;
            canvas.canUndo = false;
            canvas.canRedo = true;
            return current;
        },
        redoOps: () => {
            current = changed;
            canvas.canUndo = true;
            canvas.canRedo = false;
            return current;
        },
    };
    const undone = await runCanvasAgentTool({ name: "canvas_undo_last_action", arguments: "{}" }, canvas);
    assert.equal(undone.restored, true);
    assert.equal(undone.direction, "undo");
    assert.equal(current.nodes[0].metadata.size, "1:1");
    const redone = await runCanvasAgentTool({ name: "canvas_redo_last_action", arguments: "{}" }, canvas);
    assert.equal(redone.restored, true);
    assert.equal(redone.direction, "redo");
    assert.equal(current.nodes[0].metadata.size, "9:16");
});

test("refuses Agent rollback after its verified history is unavailable", async () => {
    const canvas = liveCanvas([node("config-1", "config", { generationMode: "image" })]);
    canvas.canUndo = false;
    canvas.undoOps = () => null;
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_undo_last_action", arguments: "{}" }, canvas), /没有可撤销/);
});

test("refuses a stale Agent rollback instead of overwriting later node edits", async () => {
    const canvas = liveCanvas([node("config-1", "config", { generationMode: "image", size: "3:2" })]);
    canvas.canUndo = true;
    canvas.undoOps = () => null;
    await assert.rejects(() => runCanvasAgentTool({ name: "canvas_undo_last_action", arguments: "{}" }, canvas), /画布已在之后被修改/);
    assert.equal(canvas.readSnapshot().nodes[0].metadata.size, "3:2");
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

test("returns a recoverable snapshot without touching the canvas when every op has stale references", async () => {
    const canvas = semanticCanvas([node("text-1", "text"), node("config-1", "config")]);
    const observation = await runCanvasAgentTool({
        name: "canvas_apply_ops",
        arguments: JSON.stringify({
            summary: "连接节点",
            ops: [
                { type: "connect_nodes", fromNodeId: "stale-text", toNodeId: "config-1" },
                { type: "connect_nodes", fromNodeId: "text-1", toNodeId: "stale-config" },
            ],
        }),
    }, canvas);
    assert.equal(observation.requested, 2);
    assert.equal(observation.applied, 0);
    assert.equal(observation.ignored, 2);
    assert.equal(observation.rejected, 2);
    assert.equal(observation.reason, "invalid_references");
    assert.deepEqual(observation.invalidNodeIds, ["stale-text", "stale-config"]);
    assert.deepEqual(observation.invalidConnectionIds, []);
    assert.deepEqual(observation.snapshot.nodes.map((item) => item.id), ["text-1", "config-1"]);
    assert.match(observation.recovery, /create_graph/);
    assert.equal(canvas.calls.length, 0, "invalid references must never reach the canvas mutation layer");
});

test("applies valid ops from a mixed batch and reports stale references separately", async () => {
    const canvas = semanticCanvas([node("text-1", "text"), node("config-1", "config")]);
    const observation = await runCanvasAgentTool({
        name: "canvas_apply_ops",
        arguments: JSON.stringify({
            summary: "连接节点",
            ops: [
                { type: "connect_nodes", fromNodeId: "text-1", toNodeId: "config-1" },
                { type: "connect_nodes", fromNodeId: "stale-text", toNodeId: "config-1" },
            ],
        }),
    }, canvas);
    assert.equal(observation.requested, 2);
    assert.equal(observation.applied, 1);
    assert.equal(observation.ignored, 1);
    assert.equal(observation.rejected, 1);
    assert.equal(observation.reason, "partial_rejection");
    assert.deepEqual(observation.invalidNodeIds, ["stale-text"]);
    assert.equal(observation.addedConnections, 1);
    assert.equal(canvas.calls.length, 1);
    assert.deepEqual(canvas.calls[0], [{ type: "connect_nodes", fromNodeId: "text-1", toNodeId: "config-1" }]);
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
