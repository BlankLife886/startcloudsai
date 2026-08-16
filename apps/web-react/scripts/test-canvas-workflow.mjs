import assert from "node:assert/strict";
import test from "node:test";

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
