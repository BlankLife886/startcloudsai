import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createServer } from "vite";

const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "silent" });
after(() => server.close());

const [clipboard, receivingPage, workspace, resources, references] = await Promise.all([
    server.ssrLoadModule("/src/canvas/lib/canvas/canvas-node-clipboard.ts"),
    server.ssrLoadModule("/src/canvas/lib/canvas/canvas-node-clipboard.ts?receiving-page"),
    server.ssrLoadModule("/src/canvas/lib/canvas/canvas-workspace-geometry.ts"),
    server.ssrLoadModule("/src/canvas/lib/canvas/canvas-resource-index.ts"),
    server.ssrLoadModule("/src/canvas/lib/canvas/canvas-resource-references.ts"),
]);
const { copyCanvasNodeMetadata } = await server.ssrLoadModule("/src/canvas/lib/canvas/canvas-node-copy.ts");

test("a copied config displays its own copied output rather than the original", () => {
    const metadata = { inlineOutputNodeId: "hidden", workflowOutputNodeIds: ["hidden"], taskId: "running-task", executionStatus: "running" };
    const copied = copyCanvasNodeMetadata(metadata, new Map([["hidden", "copied-hidden"]]));
    assert.equal(copied.inlineOutputNodeId, "copied-hidden");
    assert.deepEqual(copied.workflowOutputNodeIds, ["copied-hidden"]);
    assert.equal(copied.taskId, undefined);
    assert.equal(copyCanvasNodeMetadata(metadata, new Map()).inlineOutputNodeId, undefined);
    assert.equal(metadata.inlineOutputNodeId, "hidden");
});

test("deleting producers includes hidden outputs without deleting visible results or group children", () => {
    const nodes = [node("producer", { type: "config", metadata: { inlineOutputNodeId: "hidden" } }), node("hidden", { type: "image", metadata: { hidden: true, workflowProducerNodeId: "producer" } }), node("visible-result", { type: "image", metadata: { workflowProducerNodeId: "producer" } }), node("group", { type: "group" }), node("child", { metadata: { groupId: "group" } })];
    assert.deepEqual([...resources.collectCanvasOwnedOutputIds(nodes, new Set(["producer"]))], ["producer", "hidden"]);
    assert.deepEqual([...resources.collectCanvasOwnedOutputIds(nodes, new Set(["group"]))], ["group"]);
});

test("dragging one storyboard shot keeps its image and caption aligned", () => {
    const nodes = [
        node("shot-image", { type: "image", metadata: { storyboardId: "storyboard-1", storyboardSceneId: "shot-1" } }),
        node("shot-caption", { type: "text", metadata: { storyboardId: "storyboard-1", storyboardSceneId: "shot-1" } }),
        node("other-shot", { type: "image", metadata: { storyboardId: "storyboard-1", storyboardSceneId: "shot-2" } }),
        node("ordinary", { type: "text" }),
    ];
    assert.deepEqual([...resources.collectCanvasDragNodeIds(nodes, new Set(["shot-image"]))], ["shot-image", "shot-caption"]);
    assert.deepEqual([...resources.collectCanvasDragNodeIds(nodes, new Set(["ordinary"]))], ["ordinary"]);
});

function node(id, { type = "text", title = id, position = { x: 0, y: 0 }, width = 120, height = 80, metadata = { content: `${id} content` } } = {}) {
    return { id, type, title, position, width, height, metadata };
}

function edge(id, fromNodeId, toNodeId) {
    return { id, fromNodeId, toNodeId };
}

function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
}

function payloadText(nodes, connections = []) {
    return `startclouds-canvas:${JSON.stringify({ version: 1, nodes, connections })}`;
}

function rectAt(center, size) {
    return { left: center.x - size.width / 2, right: center.x + size.width / 2, top: center.y - size.height / 2, bottom: center.y + size.height / 2 };
}

function overlapsNode(rect, existing) {
    return rect.left < existing.position.x + existing.width && rect.right > existing.position.x && rect.top < existing.position.y + existing.height && rect.bottom > existing.position.y;
}

test("panel resizing always leaves a usable desktop workspace", () => {
    for (const width of [1280, 1440, 1920]) {
        const panels = workspace.constrainCanvasPanelWidths(width, 480, 760);
        const area = workspace.canvasWorkspaceRect({ width, height: 720 }, panels.left, panels.right);
        assert.ok(area.width >= 480);
        assert.ok(panels.left >= 220 && panels.right >= 360);
    }
    assert.deepEqual(workspace.constrainCanvasPanelWidths(1440, 280, 440), { left: 280, right: 440 });
    assert.deepEqual(workspace.constrainCanvasPanelWidths(1280, 0, 760), { left: 0, right: 752 });
});

test("connection culling retains paths crossing the viewport while excluding distant paths", () => {
    const viewport = { left: 0, top: 0, right: 800, bottom: 600 };
    assert.equal(workspace.canvasConnectionIntersectsRect(node("left", { position: { x: -500, y: 200 } }), node("right", { position: { x: 1000, y: 200 } }), viewport), true);
    assert.equal(workspace.canvasConnectionIntersectsRect(node("far-a", { position: { x: 10000, y: 10000 } }), node("far-b", { position: { x: 11000, y: 10000 } }), viewport), false);
    assert.equal(workspace.canvasConnectionIntersectsRect(node("below", { position: { x: 200, y: 900 } }), node("above", { position: { x: 200, y: -400 } }), viewport), true);
});

test("serializes a complete nested group and its internal workflow outputs for another page", () => {
    const nodes = freeze([
        node("outside", { type: "image", metadata: { content: "/outside.webp" } }),
        node("prompt", { metadata: { groupId: "inner", content: "保留产品轮廓", references: [{ nodeId: "source", kind: "image" }] } }),
        node("result", { type: "image", metadata: { hidden: true, workflowProducerNodeId: "generator", storageKey: "canvas/result.webp", content: "/result.webp", images: [{ id: "batch-1", content: "/result.webp", status: "success" }] } }),
        node("inner", { type: "group", metadata: { groupId: "outer" } }),
        node("source", { type: "image", metadata: { groupId: "outer", content: "/source.webp", naturalWidth: 2048, naturalHeight: 1024 } }),
        node("generator", { type: "config", metadata: { groupId: "inner", generationMode: "image", model: "canvas-model", composerContent: "@图片1 生成海报", inlineOutputNodeId: "result" } }),
        node("outer", { type: "group", metadata: {} }),
        node("unselected-visible-output", { type: "image", metadata: { workflowProducerNodeId: "generator", content: "/other.webp" } }),
    ]);
    const connections = freeze([
        edge("external-input", "outside", "generator"),
        edge("prompt-input", "prompt", "generator"),
        edge("image-input", "source", "generator"),
        edge("generated-result", "generator", "result"),
        edge("external-output", "generator", "unselected-visible-output"),
    ]);
    const selected = new Set(["outer"]);
    const original = structuredClone({ nodes, connections });
    const copied = clipboard.createCanvasNodeClipboard(nodes, connections, selected);
    assert.ok(copied);
    assert.deepEqual(copied.nodes.map((item) => item.id), ["prompt", "result", "inner", "source", "generator", "outer"]);
    assert.deepEqual(copied.connections.map((item) => item.id), ["prompt-input", "image-input", "generated-result"]);

    const text = clipboard.serializeCanvasNodeClipboard(copied);
    const restored = receivingPage.parseCanvasNodeClipboard(text);
    assert.deepEqual(restored, copied);
    assert.notStrictEqual(restored, copied);
    assert.equal(restored.nodes.find((item) => item.id === "generator").metadata.inlineOutputNodeId, "result");
    assert.equal(restored.nodes.find((item) => item.id === "result").metadata.images[0].content, "/result.webp");

    copied.nodes.find((item) => item.id === "prompt").metadata.references[0].nodeId = "changed-copy";
    copied.connections[0].toNodeId = "changed-copy";
    assert.deepEqual({ nodes, connections }, original);
    assert.deepEqual([...selected], ["outer"]);
    assert.equal(restored.nodes.find((item) => item.id === "prompt").metadata.references[0].nodeId, "source");
});

test("copying a cyclic group membership terminates and includes each node once", () => {
    const nodes = [node("a", { type: "group", metadata: { groupId: "b" } }), node("b", { type: "group", metadata: { groupId: "a" } }), node("child", { metadata: { groupId: "b", content: "content" } })];
    const copied = clipboard.createCanvasNodeClipboard(nodes, [], new Set(["a"]));
    assert.deepEqual(copied.nodes.map((item) => item.id), ["a", "b", "child"]);
    assert.equal(clipboard.createCanvasNodeClipboard(nodes, [], new Set()), null);
    assert.equal(clipboard.createCanvasNodeClipboard(nodes, [], new Set(["missing"])), null);
});

test("ordinary clipboard text passes through while stale canvas markers are rejected", () => {
    for (const text of ["", "普通文案\n第二段", "https://example.com/image.webp", "提到 startclouds-canvas: 内容", '{"version":1}']) {
        assert.equal(receivingPage.parseCanvasNodeClipboard(text), null);
    }
    assert.throws(() => receivingPage.parseCanvasNodeClipboard("startclouds-canvas:5da95f36-77d5-4d8f-9481-03dce9e917db"), /重新复制/);
    assert.throws(() => receivingPage.parseCanvasNodeClipboard("startclouds-canvas:{broken"), /重新复制/);
});

test("rejects invalid geometry, duplicate nodes and connections leaving the copied graph", () => {
    for (const patch of [
        { width: 0 }, { width: -1 }, { height: 0 }, { height: -20 },
        { position: { x: "12", y: 0 } }, { position: { x: null, y: 0 } },
        { position: { x: NaN, y: 0 } }, { position: { x: 0, y: Infinity } },
        { position: null }, { metadata: [] },
    ]) {
        assert.throws(() => receivingPage.parseCanvasNodeClipboard(payloadText([{ ...node("n"), ...patch }])), /重新复制/);
    }
    assert.throws(() => receivingPage.parseCanvasNodeClipboard(payloadText([node("same"), node("same")])), /重新复制/);
    assert.throws(() => receivingPage.parseCanvasNodeClipboard(payloadText([node("a")], [edge("invalid", "a", "missing")])), /重新复制/);
    assert.throws(() => receivingPage.parseCanvasNodeClipboard("startclouds-canvas:{\"version\":2,\"nodes\":[],\"connections\":[]}"), /重新复制/);
});

test("finds a visible free gap before falling back to overlapping offsets", () => {
    const center = { x: 500, y: 100 };
    const size = { width: 240, height: 160 };
    const viewport = { left: 0, right: 1000, top: 0, bottom: 200 };
    const existing = node("occupied", { position: { x: 380, y: 20 }, ...size });
    const placed = workspace.findCanvasInsertionCenter(center, size, [existing], viewport);
    const rect = rectAt(placed, size);
    assert.equal(overlapsNode(rect, existing), false);
    assert.ok(rect.left >= viewport.left && rect.right <= viewport.right);
    assert.ok(rect.top >= viewport.top && rect.bottom <= viewport.bottom);
});

test("repeated creation never puts nodes at an identical center when the viewport is full", () => {
    const center = { x: 50, y: 40 };
    const size = { width: 240, height: 160 };
    const viewport = { left: 0, right: 100, top: 0, bottom: 80 };
    const nodes = [];
    const positions = new Set();
    for (let index = 0; index < 12; index++) {
        const placed = workspace.findCanvasInsertionCenter(center, size, nodes, viewport);
        assert.deepEqual(workspace.findCanvasInsertionCenter(center, size, nodes, viewport), placed);
        const key = `${placed.x},${placed.y}`;
        assert.equal(positions.has(key), false);
        positions.add(key);
        nodes.push(node(`created-${index}`, { position: { x: placed.x - size.width / 2, y: placed.y - size.height / 2 }, ...size }));
    }
    assert.equal(positions.size, 12);
});

test("group frames and hidden workflow outputs do not occupy a visible insertion gap", () => {
    const center = { x: 400, y: 300 };
    const size = { width: 240, height: 160 };
    const obstacles = freeze([
        node("frame", { type: "group", position: { x: 0, y: 0 }, width: 900, height: 700, metadata: {} }),
        node("internal-result", { position: { x: 280, y: 220 }, ...size, metadata: { hidden: true, content: "internal" } }),
    ]);
    assert.deepEqual(workspace.findCanvasInsertionCenter(center, size, obstacles, { left: 0, right: 900, top: 0, bottom: 700 }), center);
});

test("the workspace center accounts for both open side panels", () => {
    const rect = workspace.canvasWorkspaceRect({ width: 1280, height: 720 }, 280, 440);
    assert.equal(rect.left, 304);
    assert.equal(rect.right, 816);
    assert.equal(rect.center.x, 560);
    assert.ok(rect.center.y > rect.top && rect.center.y < rect.bottom);
});

test("the resource index preserves connection order and original node identities", () => {
    const nodes = freeze([node("target", { type: "config", metadata: {} }), node("a", { type: "image", metadata: { content: "/a.webp" } }), node("b", { type: "image", metadata: { content: "/b.webp" } }), node("c")]);
    const connections = freeze([edge("b-first", "b", "target"), edge("missing-source", "missing", "target"), edge("a-second", "a", "target"), edge("b-to-c", "b", "c"), edge("missing-target", "target", "missing"), edge("c-third", "c", "target")]);
    const index = resources.createCanvasResourceIndex(nodes, connections);
    assert.deepEqual(index.incoming.get("target").map((item) => item.id), ["b", "a", "c"]);
    assert.deepEqual(index.outgoing.get("b").map((item) => item.id), ["target", "c"]);
    assert.strictEqual(index.nodesById.get("b"), nodes[2]);
    assert.strictEqual(index.incoming.get("target")[0], nodes[2]);
    const mentions = references.buildNodeMentionReferences(nodes[0], nodes, connections, index);
    assert.deepEqual(mentions.map((item) => item.nodeId), ["b", "a", "c"]);
    assert.deepEqual(mentions.map((item) => item.kind), ["image", "image", "text"]);
    assert.notEqual(mentions[0].label, mentions[1].label);
});

test("generation references include recursive text ancestors once in input order", () => {
    const nodes = [node("image", { type: "image", metadata: { content: "/source.webp" } }), node("base", { metadata: { prompt: "上游文案" } }), node("final"), node("sibling"), node("run", { type: "config", metadata: {} })];
    const connections = [edge("image-base", "image", "base"), edge("base-final", "base", "final"), edge("base-sibling", "base", "sibling"), edge("cycle", "final", "base"), edge("final-run", "final", "run"), edge("sibling-run", "sibling", "run")];
    const index = resources.createCanvasResourceIndex(nodes, connections);
    assert.deepEqual(references.getMentionResourceNodes("run", nodes, connections, index).map((item) => item.id), ["final", "sibling"]);
    assert.deepEqual(references.getGenerationResourceNodes("run", nodes, connections, index).map((item) => item.id), ["final", "base", "image", "sibling"]);
});

test("unchanged mention arrays and entire unchanged maps retain identity", () => {
    const nodes = [node("a"), node("run-a", { type: "config", metadata: {} }), node("b"), node("run-b", { type: "config", metadata: {} }), node("empty", { type: "image", metadata: {} })];
    const connections = [edge("input-a", "a", "run-a"), edge("input-b", "b", "run-b")];
    const initial = references.buildCanvasNodeMentionReferences(nodes, connections, resources.createCanvasResourceIndex(nodes, connections));
    assert.strictEqual(references.buildCanvasNodeMentionReferences(nodes, connections, resources.createCanvasResourceIndex(nodes, connections), initial), initial);

    const updatedNodes = nodes.map((item) => item.id === "a" ? { ...item, title: "已更新的A", metadata: { ...item.metadata, content: "新的内容" } } : item.id === "b" ? { ...item, position: { x: 600, y: 400 } } : item);
    const updated = references.buildCanvasNodeMentionReferences(updatedNodes, connections, resources.createCanvasResourceIndex(updatedNodes, connections), initial);
    assert.notStrictEqual(updated, initial);
    for (const id of ["a", "run-a"]) assert.notStrictEqual(updated.get(id), initial.get(id));
    for (const id of ["b", "run-b", "empty"]) assert.strictEqual(updated.get(id), initial.get(id));
    assert.equal(updated.get("run-a")[0].text, "新的内容");
    assert.equal(initial.get("run-a")[0].text, "a content");

    const rewired = [connections[0], edge("new-input-b", "a", "run-b")];
    const rewiredReferences = references.buildCanvasNodeMentionReferences(updatedNodes, rewired, resources.createCanvasResourceIndex(updatedNodes, rewired), updated);
    assert.notStrictEqual(rewiredReferences.get("run-b"), updated.get("run-b"));
    assert.deepEqual(rewiredReferences.get("run-b").map((item) => item.nodeId), ["a"]);
    assert.strictEqual(rewiredReferences.get("run-a"), updated.get("run-a"));
});

test("a 10000-node graph updates only the references affected by one resource edit", () => {
    const nodes = [];
    const connections = [];
    for (let index = 0; index < 5000; index++) {
        nodes.push(node(`resource-${index}`), node(`run-${index}`, { type: "config", metadata: {} }));
        connections.push(edge(`input-${index}`, `resource-${index}`, `run-${index}`));
    }
    const index = resources.createCanvasResourceIndex(nodes, connections);
    assert.equal(index.nodesById.size, 10000);
    assert.equal(index.incoming.size, 5000);
    const initial = references.buildCanvasNodeMentionReferences(nodes, connections, index);
    assert.deepEqual(initial.get("run-4999").map((item) => item.nodeId), ["resource-4999"]);

    const updatedNodes = nodes.map((item) => item.id === "resource-2499" ? { ...item, metadata: { ...item.metadata, content: "只更新这一份文案" } } : item);
    const updated = references.buildCanvasNodeMentionReferences(updatedNodes, connections, resources.createCanvasResourceIndex(updatedNodes, connections), initial);
    const reused = updatedNodes.filter((item) => updated.get(item.id) === initial.get(item.id));
    assert.equal(reused.length, 9998);
    assert.equal(updated.get("run-2499")[0].text, "只更新这一份文案");
    assert.strictEqual(updated.get("run-4999"), initial.get("run-4999"));
});
