import assert from "node:assert/strict";
import { after, test } from "node:test";

import { createServer } from "vite";

const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "silent",
});
after(() => server.close());

const { applyCanvasAgentOps } = await server.ssrLoadModule("/src/canvas/lib/canvas/canvas-agent-ops.ts");

test("create_graph atomically connects existing reference images to new workflow nodes", () => {
    const snapshot = {
        projectId: "p1",
        title: "参考图工作流",
        nodes: [{ id: "reference-1", type: "image", title: "参考图", position: { x: 0, y: 0 }, width: 300, height: 300, metadata: { content: "/reference.png" } }],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
    const afterSnapshot = applyCanvasAgentOps(snapshot, [{
        type: "create_graph",
        nodes: [
            { key: "prompt", type: "text", title: "提示词", text: "保留商品主体" },
            { key: "config", type: "config", title: "参考图生图", generationMode: "image" },
            { key: "result", type: "image", title: "结果图" },
        ],
        edges: [
            { from: "reference-1", to: "config" },
            { from: "prompt", to: "config" },
            { from: "config", to: "result" },
        ],
    }]);
    const config = afterSnapshot.nodes.find((item) => item.title === "参考图生图");
    const prompt = afterSnapshot.nodes.find((item) => item.title === "提示词");
    const result = afterSnapshot.nodes.find((item) => item.title === "结果图");
    assert.ok(config && prompt && result);
    assert.equal(afterSnapshot.connections.some((edge) => edge.fromNodeId === "reference-1" && edge.toNodeId === config.id), true);
    assert.equal(afterSnapshot.connections.some((edge) => edge.fromNodeId === prompt.id && edge.toNodeId === config.id), true);
    assert.equal(afterSnapshot.connections.some((edge) => edge.fromNodeId === config.id && edge.toNodeId === result.id), true);
});
