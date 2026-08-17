import assert from "node:assert/strict";
import test from "node:test";

import { CANVAS_WORKFLOW_TEMPLATES, createCanvasProjectFromTemplate } from "../src/canvas/templates/canvas-workflow-templates.ts";

function assertAcyclic(project) {
    const configs = new Set(project.nodes.filter((node) => node.type === "config").map((node) => node.id));
    const nodeById = new Map(project.nodes.map((node) => [node.id, node]));
    const incoming = new Map();
    project.connections.forEach((edge) => incoming.set(edge.toNodeId, [...(incoming.get(edge.toNodeId) || []), edge.fromNodeId]));
    const dependencies = new Map();
    for (const configId of configs) {
        const found = new Set();
        const seen = new Set([configId]);
        const queue = [...(incoming.get(configId) || [])];
        while (queue.length) {
            const current = queue.shift();
            if (seen.has(current)) continue;
            seen.add(current);
            if (configs.has(current)) found.add(current);
            else if (nodeById.has(current)) queue.push(...(incoming.get(current) || []));
        }
        dependencies.set(configId, found);
    }
    const remaining = new Map([...dependencies].map(([id, deps]) => [id, new Set(deps)]));
    while (remaining.size) {
        const ready = [...remaining].filter(([, deps]) => deps.size === 0).map(([id]) => id);
        assert.ok(ready.length, "workflow must not contain cycles");
        ready.forEach((id) => remaining.delete(id));
        remaining.forEach((deps) => ready.forEach((id) => deps.delete(id)));
    }
}

test("ships the production templates and the quick-test workflow by category", () => {
    assert.equal(CANVAS_WORKFLOW_TEMPLATES.length, 41);
    assert.deepEqual(
        Object.fromEntries([...new Set(CANVAS_WORKFLOW_TEMPLATES.map((item) => item.category))].map((category) => [category, CANVAS_WORKFLOW_TEMPLATES.filter((item) => item.category === category).length])),
        { "quick-test": 1, industry: 15, "model-poster": 5, "commerce-poster": 5, card: 5, "game-model": 5, icon: 5 },
    );
});

test("builds exact 10, 50, 80, and 100 node projects without audio or video", () => {
    for (const template of CANVAS_WORKFLOW_TEMPLATES) {
        const project = createCanvasProjectFromTemplate(template);
        assert.equal(project.nodes.length, template.nodeCount, template.id);
        assert.equal(new Set(project.nodes.map((node) => node.id)).size, project.nodes.length, template.id);
        assert.equal(project.nodes.some((node) => node.type === "audio" || node.type === "video"), false, template.id);
        const minimumConfigCount = template.nodeCount === 10 ? 3 : 22;
        assert.ok(project.nodes.filter((node) => node.type === "config").length >= minimumConfigCount, template.id);
        assert.ok(project.nodes.some((node) => node.type === "config" && node.metadata?.generationMode === "image" && node.metadata?.background === "transparent"), `${template.id}: missing transparent image stage`);
        const guide = project.nodes.find((node) => node.id.endsWith("-guide"));
        const inputs = project.nodes.filter((node) => node.id.includes("-input-"));
        assert.match(guide?.metadata?.content || "", /输入清单/);
        assert.ok(inputs.every((node) => /【必填】|【选填】/.test(node.title)), `${template.id}: input requirement missing`);
        assert.ok(inputs.filter((node) => node.type === "text").every((node) => node.metadata?.content?.includes("【填写模板")), `${template.id}: text input template missing`);
        assert.ok(inputs.filter((node) => node.type === "image").every((node) => node.metadata?.prompt?.includes("上传要求")), `${template.id}: image input instructions missing`);
        const nodeIds = new Set(project.nodes.map((node) => node.id));
        project.connections.forEach((edge) => {
            assert.ok(nodeIds.has(edge.fromNodeId), `${template.id}: missing ${edge.fromNodeId}`);
            assert.ok(nodeIds.has(edge.toNodeId), `${template.id}: missing ${edge.toNodeId}`);
        });
        project.nodes.filter((node) => node.type === "config").forEach((node) => {
            const outputId = node.metadata?.workflowOutputNodeIds?.[0];
            assert.ok(outputId && nodeIds.has(outputId), `${template.id}: ${node.id} has no stable output`);
        });
        assertAcyclic(project);
    }
});

test("builds a complete deterministic 10-node ecommerce quick-test workflow", () => {
    const project = createCanvasProjectFromTemplate("quick-test-ecommerce-main-image");
    const configs = project.nodes.filter((node) => node.type === "config");
    assert.equal(project.nodes.length, 10);
    assert.equal(configs.length, 3);
    assert.deepEqual(configs.map((node) => node.metadata?.generationMode), ["image", "image", "text"]);
    assert.equal(configs[0].metadata?.background, "transparent");
    assert.deepEqual(configs.map((node) => node.metadata?.workflowOutputNodeIds?.length), [1, 1, 1]);
    const configIds = configs.map((node) => node.id);
    const dependencyEdges = project.connections.filter((edge) => edge.toNodeId === configIds[2]).map((edge) => edge.fromNodeId);
    assert.ok(dependencyEdges.some((id) => id.endsWith("output-1")));
    assert.ok(dependencyEdges.some((id) => id.endsWith("output-2")));
    assertAcyclic(project);
});

test("uses distinct workflow topology for every template", () => {
    const signatures = CANVAS_WORKFLOW_TEMPLATES.map((template) => {
        const project = createCanvasProjectFromTemplate(template);
        const stageIndex = (id) => Number(id.match(/(?:config|output)-(\d+)$/)?.[1] || 0);
        return project.connections
            .filter((edge) => edge.fromNodeId.includes("-output-") && edge.toNodeId.includes("-config-"))
            .map((edge) => `${stageIndex(edge.fromNodeId)}>${stageIndex(edge.toNodeId)}`)
            .sort()
            .join("|");
    });
    assert.equal(new Set(signatures).size, CANVAS_WORKFLOW_TEMPLATES.length);
});

test("covers major domestic and international commerce platforms", () => {
    const platforms = new Set(CANVAS_WORKFLOW_TEMPLATES.flatMap((template) => template.platforms));
    ["天猫", "淘宝", "京东", "拼多多", "抖音商城", "小红书", "Amazon", "Shopee", "Lazada", "Temu", "Shopify", "Etsy", "eBay", "Walmart", "Rakuten"].forEach((platform) => assert.ok(platforms.has(platform), platform));
});
