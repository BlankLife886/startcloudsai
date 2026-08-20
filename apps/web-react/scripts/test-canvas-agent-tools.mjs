import assert from "node:assert/strict";
import test from "node:test";

import { runCanvasAgentTool } from "../src/canvas/lib/canvas/canvas-hosted-agent.ts";

const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata });

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

test("narrows a selection read to the selected nodes", async () => {
    const canvas = stubCanvas([node("a", "text"), node("b", "config")], [], ["b"]);
    const observation = await runCanvasAgentTool({ name: "canvas_get_selection", arguments: "{}" }, canvas);
    assert.deepEqual(observation.selectedNodeIds, ["b"]);
    assert.deepEqual(observation.nodes.map((item) => item.id), ["b"]);
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
    assert.equal(observation.applied, 2);
    assert.equal(canvas.calls[0][0].type, "move_nodes");
    assert.equal(canvas.calls[0][1].type, "resize_node");
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
