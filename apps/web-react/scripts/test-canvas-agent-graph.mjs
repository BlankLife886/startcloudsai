import assert from "node:assert/strict";
import test from "node:test";

import { layoutCanvasGraph } from "../src/canvas/lib/canvas/canvas-graph-layout.ts";
import { parseCanvasAgentOpsPayload, resolveCanvasAgentCompletion } from "../src/canvas/lib/canvas/canvas-hosted-agent.ts";

const options = { originX: 0, originY: 0, columnGap: 72, rowGap: 48 };
const sized = (keys) => keys.map((key) => ({ key, width: 300, height: 200 }));
const chain = (count) => ({
    nodes: sized(Array.from({ length: count }, (_, index) => `n${index}`)),
    edges: Array.from({ length: count - 1 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}` })),
});

test("lays a ten step chain out left to right on a single row", () => {
    const { positions, edges } = layoutCanvasGraph(chain(10).nodes, chain(10).edges, options);
    assert.equal(positions.size, 10);
    assert.equal(edges.length, 9);
    const xs = [...positions.values()].map((position) => position.x);
    assert.deepEqual(xs, [...xs].sort((left, right) => left - right));
    assert.equal(new Set(xs).size, 10, "chained nodes need distinct columns");
    assert.equal(new Set([...positions.values()].map((position) => position.y)).size, 1);
});

test("stacks sibling branches as rows inside one column", () => {
    const { positions } = layoutCanvasGraph(sized(["a", "b", "c"]), [{ from: "a", to: "b" }, { from: "a", to: "c" }], options);
    assert.equal(positions.get("b").x, positions.get("c").x);
    assert.notEqual(positions.get("b").y, positions.get("c").y);
    assert.ok(positions.get("b").x > positions.get("a").x);
});

test("merges a diamond back into a later column", () => {
    const { positions } = layoutCanvasGraph(sized(["a", "b", "c", "d"]), [
        { from: "a", to: "b" },
        { from: "a", to: "c" },
        { from: "b", to: "d" },
        { from: "c", to: "d" },
    ], options);
    assert.ok(positions.get("d").x > positions.get("b").x);
    assert.equal(positions.get("d").y, positions.get("a").y);
});

test("tolerates a cycle instead of looping forever", () => {
    const { positions, edges } = layoutCanvasGraph(sized(["a", "b"]), [{ from: "a", to: "b" }, { from: "b", to: "a" }], options);
    assert.equal(positions.size, 2);
    assert.equal(edges.length, 2);
});

test("drops edges pointing at unknown keys", () => {
    const { edges } = layoutCanvasGraph(sized(["a", "b"]), [{ from: "a", to: "ghost" }, { from: "a", to: "a" }], options);
    assert.deepEqual(edges, []);
});

test("parses a graph payload without coordinates and accepts edge pairs", () => {
    const { summary, ops } = parseCanvasAgentOpsPayload(`{"summary":"已创建工作流","ops":[{"type":"create_graph",
        "nodes":[{"key":"a","type":"text","content":"卖点"},{"key":"b","type":"config"},{"key":"c","type":"bogus"}],
        "edges":[["a","b"],{"source":"b","target":"c"}]}]}`);
    assert.equal(summary, "已创建工作流");
    assert.equal(ops.length, 1);
    assert.equal(ops[0].type, "create_graph");
    assert.deepEqual(ops[0].nodes.map((node) => node.type), ["text", "config", "text"]);
    assert.equal(ops[0].nodes[0].text, "卖点");
    assert.deepEqual(ops[0].edges, [{ from: "a", to: "b" }, { from: "b", to: "c" }]);
});

test("keeps all nodes and edges in a fifty-node workflow", () => {
    const nodes = Array.from({ length: 50 }, (_, index) => ({ key: `n${index + 1}`, type: "text", text: `步骤 ${index + 1}` }));
    const edges = Array.from({ length: 49 }, (_, index) => ({ from: `n${index + 1}`, to: `n${index + 2}` }));
    const { ops } = parseCanvasAgentOpsPayload(JSON.stringify({ summary: "已创建 50 节点工作流", ops: [{ type: "create_graph", nodes, edges }] }));
    assert.equal(ops.length, 1);
    assert.equal(ops[0].nodes.length, 50);
    assert.equal(ops[0].edges.length, 49);
    const layout = layoutCanvasGraph(sized(nodes.map((node) => node.key)), edges, options);
    assert.equal(layout.positions.size, 50);
    assert.equal(layout.edges.length, 49);
});

test("keeps the workflow alias and rejects a graph with no nodes", () => {
    const aliased = parseCanvasAgentOpsPayload(`{"ops":[{"type":"workflow","nodes":[{"key":"a","type":"image"}]}]}`);
    assert.equal(aliased.ops[0].type, "create_graph");
    assert.deepEqual(parseCanvasAgentOpsPayload(`{"ops":[{"type":"create_graph","nodes":[]}]}`).ops, []);
});

test("parses move and resize ops without inventing coordinates for graphs", () => {
    const { ops } = parseCanvasAgentOpsPayload(`{"ops":[{"type":"move_nodes","items":[{"id":"text-1","dx":40}]},{"type":"resize_node","id":"text-1","width":480,"height":240}]}`);
    assert.equal(ops[0].type, "move_nodes");
    assert.equal(ops[0].items[0].id, "text-1");
    assert.equal(ops[1].type, "resize_node");
    assert.equal(ops[1].width, 480);
});

test("does not return canvas ops that were already applied by a streamed tool call", () => {
    const completion = resolveCanvasAgentCompletion({
        content: "已创建图标工作流",
        canvasOps: [{ type: "create_generation_flow", prompt: "生成一个图标" }],
        canvasOpsSummary: "已创建图标工作流",
        executedTools: 1,
        canvasOpsApplied: true,
    });
    assert.deepEqual(completion.ops, []);
    assert.equal(completion.summary, "已创建图标工作流");
});

test("keeps reported canvas ops after read-only tools", () => {
    const completion = resolveCanvasAgentCompletion({
        content: "已读取画布并准备修改",
        canvasOps: [{ type: "add_node", nodeType: "text", metadata: { content: "图标提示词" } }],
        executedTools: 1,
        canvasOpsApplied: false,
    });
    assert.equal(completion.ops.length, 1);
    assert.equal(completion.ops[0].type, "add_node");
});
