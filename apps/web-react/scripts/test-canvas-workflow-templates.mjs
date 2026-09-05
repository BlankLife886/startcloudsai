import assert from "node:assert/strict";
import test from "node:test";

import { CANVAS_WORKFLOW_TEMPLATES, createCanvasProjectFromTemplate } from "../src/canvas/templates/canvas-workflow-templates.ts";
import { createCanvasProjectFromUploadedTemplate } from "../src/canvas/lib/canvas/canvas-workflow-template-project.ts";
import { appendConnectedTextToPrompt } from "../src/canvas/lib/canvas/canvas-prompt-context.ts";

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
    assert.equal(CANVAS_WORKFLOW_TEMPLATES.length, 42);
    assert.deepEqual(
        Object.fromEntries([...new Set(CANVAS_WORKFLOW_TEMPLATES.map((item) => item.category))].map((category) => [category, CANVAS_WORKFLOW_TEMPLATES.filter((item) => item.category === category).length])),
        { "quick-test": 1, industry: 16, "model-poster": 5, "commerce-poster": 5, card: 5, "game-model": 5, icon: 5 },
    );
});

test("builds exact 10, 50, 80, and 100 node projects without audio or video", () => {
    for (const template of CANVAS_WORKFLOW_TEMPLATES) {
        const project = createCanvasProjectFromTemplate(template);
        if (template.id === "ecommerce-detail-replica") assert.equal(project.nodes.filter((node) => !node.metadata?.hidden).length, template.nodeCount, template.id);
        else assert.equal(project.nodes.length, template.nodeCount, template.id);
        assert.equal(new Set(project.nodes.map((node) => node.id)).size, project.nodes.length, template.id);
        assert.equal(project.nodes.some((node) => node.type === "audio" || node.type === "video"), false, template.id);
        if (template.id === "ecommerce-detail-replica") {
            assertAcyclic(project);
            continue;
        }
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

test("builds the Senge ecommerce replica topology with one image group and six original branches", () => {
    const exactAnalysisPrompt = "根据上传的详情图，反推详情图的排版逻辑与文案。 再根据最后一个上传的新产品图，撰写的详情图文案，新文案的排版、细节、要和原来的一模一样；如果人物、模特的要描述清楚。 几个详情图就写几屏文案，最后一张产品图不不算。 目的是复刻详情图。";
    const exactScreenPrompts = [
        "获取新产品复刻文案，第1屏的文案，生成详情图。",
        "获取新产品复刻文案，第2屏的文案，生成详情图。",
        "获取新产品复刻文案，第3屏的文案，生成详情图。",
        "获取新产品复刻文案，第4屏的文案，生成详情图。",
        "获取新产品复刻文案，第3屏的文案，生成详情图。",
        "获取新产品复刻文案，第3屏的文案，生成详情图。",
    ];
    const project = createCanvasProjectFromTemplate("ecommerce-detail-replica");
    const configs = project.nodes.filter((node) => node.type === "config");
    const analysis = configs.find((node) => node.id.endsWith("analysis-config"));
    const product = project.nodes.find((node) => node.id.endsWith("new-product"));
    const analysisOutput = project.nodes.find((node) => node.id.endsWith("analysis-output"));
    const oldDetailGroup = project.nodes.find((node) => node.id.endsWith("old-detail-group"));
    const imageConfigs = configs.filter((node) => node.metadata?.generationMode === "image");
    assert.equal(project.nodes.length, 17);
    assert.equal(project.connections.length, 22);
    assert.equal(project.nodes.filter((node) => !node.metadata?.hidden).length, 10);
    assert.equal(project.nodes.filter((node) => node.metadata?.hidden).length, 7);
    assert.equal(configs.length, 7);
    assert.equal(imageConfigs.length, 6);
    assert.equal(analysis?.metadata?.generationMode, "text");
    assert.equal(analysis?.metadata?.composerContent, exactAnalysisPrompt);
    assert.equal(project.connections.filter((edge) => edge.toNodeId === analysis?.id).length, 3);
    assert.ok(product && analysisOutput && oldDetailGroup);
    assert.equal(oldDetailGroup.metadata?.images?.length, 3);
    assert.equal(oldDetailGroup.metadata?.primaryImageId, oldDetailGroup.metadata?.images?.[0]?.id);
    [...(oldDetailGroup.metadata?.images || []), product.metadata].forEach((metadata) => {
        assert.equal(metadata?.status, "success");
        assert.match(metadata?.content || "", /^\/assets\/canvas-workflow-demo\/ecommerce-detail-replica\/senge-.+\.webp$/);
        assert.equal(metadata?.mimeType, "image/webp");
    });
    imageConfigs.forEach((node, index) => {
        const incoming = project.connections.filter((edge) => edge.toNodeId === node.id).map((edge) => edge.fromNodeId);
        assert.deepEqual(new Set(incoming), new Set([product.id, analysisOutput.id]));
        assert.equal(node.metadata?.model, "gpt-image-2");
        assert.equal(node.metadata?.size, "9:16");
        assert.equal(node.metadata?.workflowOutputNodeIds?.length, 1);
        assert.equal(node.metadata?.composerContent, exactScreenPrompts[index]);
    });
    assertAcyclic(project);
});

test("keeps the Senge prompt unchanged in the node and adds connected text only at execution time", () => {
    const storedPrompt = "获取新产品复刻文案，第1屏的文案，生成详情图。";
    assert.equal(appendConnectedTextToPrompt(storedPrompt, []), storedPrompt);
    assert.equal(appendConnectedTextToPrompt(storedPrompt, [undefined, "上游复刻文案"]), `${storedPrompt}\n\n上游复刻文案`);
    assert.equal(storedPrompt, "获取新产品复刻文案，第1屏的文案，生成详情图。");
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

test("creates a clean project from a backend-uploaded template", () => {
    const project = createCanvasProjectFromUploadedTemplate({
        id: "template-1",
        slug: "queued-workflow",
        title: "排队任务模板",
        category: "test",
        categoryLabel: "测试",
        industry: "",
        summary: "",
        platforms: [],
        deliverables: [],
        accent: "#16a34a",
        nodeCount: 1,
        sort: 0,
        document: {
            version: 3,
            backgroundMode: "dots",
            showImageInfo: true,
            viewport: { x: 10, y: 20, k: 0.5 },
            connections: [],
            nodes: [{
                id: "config-1",
                type: "config",
                title: "生图",
                position: { x: 20, y: 40 },
                width: 320,
                height: 240,
                metadata: {
                    status: "loading",
                    taskId: "task-1",
                    taskKind: "image",
                    executionStatus: "queued",
                    generationQueuedAt: "2026-08-19T00:00:00Z",
                    errorDetails: "stale error",
                    images: [{
                        id: "image-1",
                        status: "loading",
                        errorDetails: "stale image error",
                        content: "",
                        storageKey: "",
                        naturalWidth: 0,
                        naturalHeight: 0,
                        bytes: 0,
                        mimeType: "",
                        taskId: "task-1",
                    }],
                },
            }],
        },
    });

    assert.match(project.id, /^[0-9a-f-]{36}$/);
    assert.equal(project.title, "模板｜排队任务模板");
    assert.equal(project.workflowRun, null);
    assert.deepEqual(project.chatSessions, []);
    assert.equal(project.activeChatId, null);
    assert.equal(project.backgroundMode, "dots");
    assert.deepEqual(project.viewport, { x: 10, y: 20, k: 0.5 });
    assert.equal(project.nodes[0].metadata.status, "idle");
    assert.equal(project.nodes[0].metadata.taskId, undefined);
    assert.equal(project.nodes[0].metadata.executionStatus, undefined);
    assert.equal(project.nodes[0].metadata.errorDetails, undefined);
    assert.equal(project.nodes[0].metadata.images[0].status, "idle");
    assert.equal(project.nodes[0].metadata.images[0].taskId, undefined);
    assert.equal(project.nodes[0].metadata.images[0].errorDetails, undefined);
});

test("keeps migrated template image assets when creating a user project", () => {
    const storageKey = "canvas-template-assets/template-1/reference.webp";
    const content = `/api/v1/files/${storageKey}`;
    const project = createCanvasProjectFromUploadedTemplate({
        id: "template-1",
        slug: "template-with-image",
        title: "带参考图模板",
        category: "test",
        categoryLabel: "测试",
        industry: "",
        summary: "",
        platforms: [],
        deliverables: [],
        accent: "#16a34a",
        nodeCount: 1,
        sort: 0,
        document: {
            version: 3,
            connections: [],
            nodes: [{
                id: "image-1",
                type: "image",
                title: "商品参考图",
                position: { x: 20, y: 40 },
                width: 320,
                height: 240,
                metadata: {
                    content,
                    storageKey,
                    status: "success",
                    images: [{ id: "result-1", content, storageKey, status: "success" }],
                },
            }],
        },
    });

    assert.equal(project.nodes[0].metadata.content, content);
    assert.equal(project.nodes[0].metadata.storageKey, storageKey);
    assert.equal(project.nodes[0].metadata.status, "success");
    assert.equal(project.nodes[0].metadata.images[0].content, content);
    assert.equal(project.nodes[0].metadata.images[0].status, "success");
});
