import assert from "node:assert/strict";
import test from "node:test";

import { normalizeConnection } from "../src/canvas/lib/canvas/canvas-connection.ts";
import { compileCanvasWorkflow, findWorkflowOutputNodes } from "../src/canvas/lib/canvas/canvas-workflow.ts";

const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
const edge = (fromNodeId, toNodeId) => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

test("orders config nodes through generated resource nodes", () => {
    const nodes = [node("input", "image"), node("a", "config"), node("a-out", "image"), node("b", "config"), node("b-out", "image"), node("c", "config")];
    const connections = [edge("input", "a"), edge("a", "a-out"), edge("a-out", "b"), edge("b", "b-out"), edge("b-out", "c")];
    const result = compileCanvasWorkflow(nodes, connections);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.layers, [["a"], ["b"], ["c"]]);
});

test("keeps independent branches in the same layer", () => {
    const nodes = [node("a", "config"), node("b", "config"), node("a-out", "image"), node("b-out", "image"), node("c", "config")];
    const connections = [edge("a", "a-out"), edge("b", "b-out"), edge("a-out", "c"), edge("b-out", "c")];
    const result = compileCanvasWorkflow(nodes, connections);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.layers, [["a", "b"], ["c"]]);
});

test("rejects cycles between config nodes", () => {
    const nodes = [node("a", "config"), node("a-out", "image"), node("b", "config"), node("b-out", "image")];
    const connections = [edge("a", "a-out"), edge("a-out", "b"), edge("b", "b-out"), edge("b-out", "a")];
    const result = compileCanvasWorkflow(nodes, connections);
    assert.deepEqual(result, { ok: false, reason: "cycle", nodeIds: ["a", "b"] });
});

test("resolves stable output slots", () => {
    const nodes = [node("config", "config", { workflowOutputNodeIds: ["result"] }), node("result", "image", { workflowProducerNodeId: "config" })];
    assert.deepEqual(findWorkflowOutputNodes("config", "image", nodes).map((item) => item.id), ["result"]);
});

test("adopts a connected placeholder as the stable output slot", () => {
    const nodes = [node("config", "config"), node("result", "image")];
    assert.deepEqual(findWorkflowOutputNodes("config", "image", nodes, [edge("config", "result")]).map((item) => item.id), ["result"]);
});

test("connects a config source handle to image and text outputs", () => {
    const nodes = [node("config", "config"), node("image", "image"), node("text", "text")];
    assert.deepEqual(normalizeConnection("config", "image", nodes, "source"), { fromNodeId: "config", toNodeId: "image" });
    assert.deepEqual(normalizeConnection("config", "text", nodes, "source"), { fromNodeId: "config", toNodeId: "text" });
});

test("keeps config output direction when the connection is dragged in reverse", () => {
    const nodes = [node("config", "config"), node("result", "image")];
    assert.deepEqual(normalizeConnection("result", "config", nodes, "target"), { fromNodeId: "config", toNodeId: "result" });
    assert.deepEqual(normalizeConnection("config", "result", nodes, "target"), { fromNodeId: "result", toNodeId: "config" });
});

test("keeps config input direction from either drag direction", () => {
    const nodes = [node("input", "image"), node("config", "config")];
    assert.deepEqual(normalizeConnection("input", "config", nodes, "source"), { fromNodeId: "input", toNodeId: "config" });
    assert.deepEqual(normalizeConnection("config", "input", nodes, "target"), { fromNodeId: "input", toNodeId: "config" });
});

test("rejects config-to-config connections", () => {
    const nodes = [node("a", "config"), node("b", "config")];
    assert.equal(normalizeConnection("a", "b", nodes, "source"), null);
});
