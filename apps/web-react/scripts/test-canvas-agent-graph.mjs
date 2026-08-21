import assert from "node:assert/strict";
import test from "node:test";

import { arrangeCanvasNodes, layoutCanvasGraph } from "../src/canvas/lib/canvas/canvas-graph-layout.ts";
import { validCanvasAgentOps } from "../src/canvas/lib/canvas/canvas-agent-op-validation.js";
import { parseCanvasAgentOpsPayload, resolveCanvasAgentCompletion } from "../src/canvas/lib/canvas/canvas-hosted-agent.ts";

const options = { originX: 0, originY: 0, columnGap: 72, rowGap: 48 };
const sized = (keys) => keys.map((key) => ({ key, width: 300, height: 200 }));
const chain = (count) => ({
    nodes: sized(Array.from({ length: count }, (_, index) => `n${index}`)),
    edges: Array.from({ length: count - 1 }, (_, index) => ({ from: `n${index}`, to: `n${index + 1}` })),
});

function assertNoOverlap(nodes, positions, message = "layout nodes must not overlap") {
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
        const left = nodes[leftIndex];
        const leftPosition = positions.get(left.key);
        assert.ok(leftPosition, `missing position for ${left.key}`);
        for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
            const right = nodes[rightIndex];
            const rightPosition = positions.get(right.key);
            assert.ok(rightPosition, `missing position for ${right.key}`);
            const overlaps = leftPosition.x < rightPosition.x + right.width
                && leftPosition.x + left.width > rightPosition.x
                && leftPosition.y < rightPosition.y + right.height
                && leftPosition.y + left.height > rightPosition.y;
            assert.equal(overlaps, false, `${message}: ${left.key} and ${right.key}`);
        }
    }
}

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

test("keeps weakly connected workflows in separate non-crossing bands", () => {
    const nodes = sized(["a", "d", "c", "b"]);
    const { positions } = layoutCanvasGraph(nodes, [{ from: "a", to: "b" }, { from: "c", to: "d" }], options);
    assert.ok(positions.get("a").x < positions.get("b").x);
    assert.ok(positions.get("c").x < positions.get("d").x);
    assert.equal(positions.get("a").y, positions.get("b").y);
    assert.equal(positions.get("c").y, positions.get("d").y);
    assert.ok(Math.abs(positions.get("a").y - positions.get("c").y) >= 200 + options.rowGap);
    assertNoOverlap(nodes, positions);
});

test("packs isolated nodes into a stable compact grid", () => {
    const nodes = [
        { key: "a", width: 500, height: 120 },
        { key: "b", width: 140, height: 360 },
        { key: "c", width: 240, height: 180 },
        { key: "d", width: 320, height: 220 },
        { key: "e", width: 180, height: 160 },
    ];
    const first = layoutCanvasGraph(nodes, [], options).positions;
    const second = layoutCanvasGraph(nodes, [], options).positions;
    assert.deepEqual([...first], [...second]);
    assert.ok(new Set([...first.values()].map((position) => position.x)).size > 1);
    assert.ok(new Set([...first.values()].map((position) => position.y)).size > 1);
    assertNoOverlap(nodes, first);
});

test("lays cycles out identically regardless of edge order", () => {
    const nodes = sized(["a", "b", "c"]);
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "a" }, { from: "b", to: "c" }];
    const first = layoutCanvasGraph(nodes, edges, options).positions;
    const second = layoutCanvasGraph(nodes, [...edges].reverse(), options).positions;
    assert.deepEqual([...first], [...second]);
    assert.equal(first.get("a").x, first.get("b").x, "members of one SCC stay in one compact rank");
    assert.notEqual(first.get("a").y, first.get("b").y);
    assert.ok(first.get("c").x > first.get("a").x);
    assertNoOverlap(nodes, first);
});

test("uses actual mixed node dimensions without overlap", () => {
    const nodes = [
        { key: "root", width: 620, height: 520 },
        { key: "small", width: 120, height: 100 },
        { key: "tall", width: 180, height: 640 },
        { key: "result", width: 460, height: 260 },
    ];
    const edges = [{ from: "root", to: "small" }, { from: "root", to: "tall" }, { from: "small", to: "result" }, { from: "tall", to: "result" }];
    const { positions } = layoutCanvasGraph(nodes, edges, options);
    assertNoOverlap(nodes, positions);
    positions.forEach((position) => {
        assert.ok(Number.isFinite(position.x));
        assert.ok(Number.isFinite(position.y));
    });
});

test("rejects duplicate keys and non-finite dimensions", () => {
    assert.throws(() => layoutCanvasGraph([{ key: "a", width: 300, height: 200 }, { key: "a", width: 300, height: 200 }], [], options), /Duplicate/);
    assert.throws(() => layoutCanvasGraph([{ key: "a", width: Number.POSITIVE_INFINITY, height: 200 }], [], options), /finite/);
    assert.throws(() => arrangeCanvasNodes([{ key: "a", x: Number.NaN, y: 0, width: 300, height: 200 }], [], { scope: "all", columnGap: 72, rowGap: 48 }), /finite/);
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

test("parses arrange_nodes direction without accepting model-provided coordinates", () => {
    const { ops } = parseCanvasAgentOpsPayload(`{"ops":[{"type":"arrange_nodes","scope":"selection","direction":"TB","x":999,"y":999}]}`);
    assert.deepEqual(ops, [{ type: "arrange_nodes", scope: "selection", direction: "TB" }]);
    assert.deepEqual(parseCanvasAgentOpsPayload(`{"ops":[{"type":"arrange_nodes","direction":"diagonal"}]}`).ops, [
        { type: "arrange_nodes", scope: "all", direction: "LR" },
    ]);
});

test("arranges the complete live node set deterministically and idempotently", () => {
    const nodes = [
        { key: "a", x: 420, y: 380, width: 300, height: 200 },
        { key: "b", x: 440, y: 390, width: 180, height: 360 },
        { key: "c", x: 460, y: 400, width: 520, height: 160 },
        { key: "d", x: 480, y: 410, width: 260, height: 260 },
        { key: "isolate", x: 500, y: 420, width: 240, height: 180 },
    ];
    const edges = [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }];
    const first = arrangeCanvasNodes(nodes, edges, { scope: "all", direction: "LR", columnGap: 72, rowGap: 48 });
    assert.deepEqual(new Set(first.arrangedKeys), new Set(nodes.map((node) => node.key)));
    assertNoOverlap(nodes, first.positions);

    const arrangedNodes = nodes.map((node) => ({ ...node, ...first.positions.get(node.key) }));
    const second = arrangeCanvasNodes(arrangedNodes, edges, { scope: "all", direction: "LR", columnGap: 72, rowGap: 48 });
    assert.deepEqual([...second.positions], [...first.positions]);
});

test("arranges a mixed-size chain top to bottom and remains idempotent", () => {
    const nodes = [
        { key: "a", x: 420, y: 380, width: 300, height: 200 },
        { key: "b", x: 440, y: 390, width: 180, height: 360 },
        { key: "c", x: 460, y: 400, width: 520, height: 160 },
        { key: "d", x: 480, y: 410, width: 260, height: 260 },
    ];
    const edges = [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "d" }];
    const arrangeOptions = { scope: "all", direction: "TB", columnGap: 72, rowGap: 48 };
    const first = arrangeCanvasNodes(nodes, edges, arrangeOptions);

    assertNoOverlap(nodes, first.positions);
    const centers = nodes.map((node) => first.positions.get(node.key).x + node.width / 2);
    assert.equal(new Set(centers).size, 1);
    const ys = [...first.positions.values()].map((position) => position.y);
    assert.deepEqual(ys, [...ys].sort((left, right) => left - right));

    const arrangedNodes = nodes.map((node) => ({ ...node, ...first.positions.get(node.key) }));
    const second = arrangeCanvasNodes(arrangedNodes, edges, arrangeOptions);
    assert.deepEqual([...second.positions], [...first.positions]);
});

test("keeps crossing branch order stable across repeated arrangements", () => {
    const nodes = [
        { key: "n8", width: 410, height: 344, x: -390, y: -205 },
        { key: "n9", width: 928, height: 281, x: -280, y: -205 },
        { key: "n12", width: 614, height: 368, x: 50, y: -205 },
        { key: "n15", width: 323, height: 117, x: -390, y: -110 },
        { key: "n16", width: 379, height: 142, x: -280, y: -110 },
        { key: "n17", width: 488, height: 262, x: -170, y: -110 },
        { key: "n19", width: 290, height: 309, x: 50, y: -110 },
        { key: "n21", width: 941, height: 113, x: -500, y: -15 },
    ];
    const edges = [
        { from: "n8", to: "n12" },
        { from: "n8", to: "n16" },
        { from: "n9", to: "n15" },
        { from: "n9", to: "n17" },
        { from: "n17", to: "n16" },
        { from: "n17", to: "n21" },
        { from: "n19", to: "n9" },
    ];
    const arrangeOptions = { scope: "all", direction: "LR", columnGap: 72, rowGap: 48 };

    const first = arrangeCanvasNodes(nodes, edges, arrangeOptions);
    const arrangedNodes = nodes.map((node) => ({ ...node, ...first.positions.get(node.key) }));
    const second = arrangeCanvasNodes(arrangedNodes, edges, arrangeOptions);

    assertNoOverlap(nodes, first.positions);
    assert.deepEqual([...second.positions], [...first.positions]);
});

test("arrange selection promotes a group and translates all children rigidly", () => {
    const nodes = [
        { key: "loose", x: 0, y: 0, width: 180, height: 160 },
        { key: "fixed", x: 600, y: 0, width: 220, height: 240 },
        { key: "group", x: 500, y: 500, width: 500, height: 400, isGroup: true },
        { key: "child-a", x: 530, y: 540, width: 140, height: 120, groupKey: "group" },
        { key: "child-b", x: 720, y: 560, width: 180, height: 160, groupKey: "group" },
    ];
    const result = arrangeCanvasNodes(nodes, [{ from: "child-a", to: "loose" }], {
        scope: "selection",
        selectedKeys: ["child-a", "loose"],
        direction: "LR",
        columnGap: 72,
        rowGap: 48,
    });
    assert.deepEqual(new Set(result.arrangedKeys), new Set(["loose", "group", "child-a", "child-b"]));
    assert.equal(result.positions.has("fixed"), false);
    const groupDelta = {
        x: result.positions.get("group").x - 500,
        y: result.positions.get("group").y - 500,
    };
    for (const [key, x, y] of [["child-a", 530, 540], ["child-b", 720, 560]]) {
        assert.deepEqual({ x: result.positions.get(key).x - x, y: result.positions.get(key).y - y }, groupDelta);
    }
    const fixed = nodes.find((node) => node.key === "fixed");
    for (const node of nodes.filter((item) => result.positions.has(item.key) && item.key !== "child-a" && item.key !== "child-b")) {
        const position = result.positions.get(node.key);
        const overlapsFixed = position.x < fixed.x + fixed.width && position.x + node.width > fixed.x && position.y < fixed.y + fixed.height && position.y + node.height > fixed.y;
        assert.equal(overlapsFixed, false, `${node.key} must not overlap an unselected node`);
    }
});

test("canvas mutations require exact ids and reject duplicate node ids", () => {
    const snapshot = {
        projectId: "p1",
        title: "strict",
        nodes: [
            { id: "text-1", type: "text", title: "提示词", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: {} },
            { id: "config-1", type: "config", title: "配置", position: { x: 400, y: 0 }, width: 300, height: 200, metadata: {} },
        ],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
    const checked = validCanvasAgentOps(snapshot, [
        { type: "add_node", id: "text-1", nodeType: "text" },
        { type: "connect_nodes", fromNodeId: "提示词", toNodeId: "config-1" },
        { type: "connect_nodes", fromNodeId: "text-1", toNodeId: "config-1" },
    ]);
    assert.equal(checked.rejected, 2);
    assert.deepEqual(checked.ops, [{ type: "connect_nodes", fromNodeId: "text-1", toNodeId: "config-1" }]);
});

test("ordered validation allows deleting and recreating the same connection", () => {
    const snapshot = {
        projectId: "p1",
        title: "replace edge",
        nodes: [
            { id: "a", type: "text", title: "a", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: {} },
            { id: "b", type: "config", title: "b", position: { x: 400, y: 0 }, width: 300, height: 200, metadata: {} },
        ],
        connections: [{ id: "old", fromNodeId: "a", toNodeId: "b" }],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
    const checked = validCanvasAgentOps(snapshot, [
        { type: "delete_connections", ids: ["old"] },
        { type: "connect_nodes", id: "new", fromNodeId: "a", toNodeId: "b" },
    ]);
    assert.equal(checked.rejected, 0);
    assert.deepEqual(checked.ops.map((op) => op.type), ["delete_connections", "connect_nodes"]);
});

test("ordered validation forgets anonymous incident connections after node deletion", () => {
    const snapshot = {
        projectId: "p1",
        title: "anonymous edge",
        nodes: [
            { id: "a", type: "text", title: "a", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: {} },
            { id: "b", type: "config", title: "b", position: { x: 400, y: 0 }, width: 300, height: 200, metadata: {} },
        ],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
    const checked = validCanvasAgentOps(snapshot, [
        { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" },
        { type: "delete_node", id: "a" },
        { type: "add_node", id: "a", nodeType: "text" },
        { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" },
    ]);
    assert.equal(checked.rejected, 0);
    assert.deepEqual(checked.ops.map((op) => op.type), ["connect_nodes", "delete_node", "add_node", "connect_nodes"]);
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
