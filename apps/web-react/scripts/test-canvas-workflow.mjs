import assert from "node:assert/strict";
import test from "node:test";

import { catalogModelsByCapability, defaultConfig, migrateConfigStore, resolveModelForCapability, selectableModelsByCapability } from "../src/canvas/stores/use-config-store.ts";
import { canvasConnectionIdsTouchingNodes, connectionSourceNodeIds, normalizeConnection } from "../src/canvas/lib/canvas/canvas-connection.ts";
import { copyCanvasNodeMetadata, resolveCopiedCanvasNodeReferences } from "../src/canvas/lib/canvas/canvas-node-copy.ts";
import { canvasShotInputSignature, canvasShotIsReusable } from "../src/canvas/lib/canvas/canvas-storyboard-shot-signature.ts";
import { createCanvasSubmissionFreeze } from "../src/canvas/lib/canvas/canvas-submission-freeze.ts";
import {
    advanceCanvasWorkflowCheckpoint,
    beginCanvasWorkflowRetry,
    canvasWorkflowCheckpointForStart,
    canvasWorkflowNodeOutputFingerprint,
    carryOverCanvasWorkflowCompletions,
    compileCanvasWorkflow,
    completeCanvasWorkflowNode,
    createCanvasWorkflowCheckpoint,
    failCanvasWorkflowCheckpoint,
    findCanvasWorkflowCancellationClosure,
    findRunnableCanvasWorkflowNodeIds,
    findWorkflowOutputNodes,
    isCanvasWorkflowFailureRetry,
    mergeCanvasWorkflowRunProgress,
    normalizeCanvasWorkflowCheckpoint,
    reconcileCanvasWorkflowCheckpoint,
    reconcileCanvasWorkflowFailureOutput,
    reconcileCanvasWorkflowOutputs,
    settleCanvasWorkflowTerminal,
    validateCanvasWorkflowNodeOutputs,
    validateCanvasWorkflowNodeReadiness,
    validateCanvasWorkflowCompletedOutputs,
    waitForCanvasWorkflowStop,
    workflowExpectedOutputCount,
    workflowPlanMatchesCheckpoint,
} from "../src/canvas/lib/canvas/canvas-workflow.ts";
import { pendingCanvasTasks } from "../src/canvas/lib/canvas/canvas-pending-tasks.ts";
import { canvasProjectNeedsCloudRetry, markCanvasProjectMediaDeleted, mergeCanvasProjectDocuments, mergeCanvasProjectSnapshots } from "../src/canvas/lib/canvas/canvas-project-sync.ts";
import { buildCanvasSidePanelWorkflowGroups } from "../src/canvas/lib/canvas/canvas-workflow-groups.ts";
import { shouldPromoteGeneratedImage } from "../src/canvas/lib/canvas/canvas-image-primary.ts";
import { shouldBlockCanvasNavigation } from "../src/canvas/lib/canvas/canvas-leave-guard.ts";
import { applyCanvasAgentNodeUpdate, clampCanvasAgentImageCounts } from "../src/canvas/lib/canvas/canvas-agent-node-metadata.ts";
import { boundedCanvasTaskKey, canvasManualTaskKey, canvasWorkflowTaskKey, MAX_CANVAS_TASK_KEY_LENGTH } from "../src/canvas/lib/canvas/canvas-task-key.ts";
import { canvasLocalImageOperationOutputCount, isCanvasLocalImageOperation, normalizeCanvasLocalImageOperationParams } from "../src/canvas/lib/canvas/canvas-local-image-operation.ts";
import { resolveStoryboardConsistency } from "../src/canvas/lib/canvas/storyboard-parser.ts";
import { canvasWorkflowNodeInputFingerprint } from "../src/canvas/lib/canvas/canvas-workflow-signature.ts";

const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
const edge = (fromNodeId, toNodeId) => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

test("blocks leaving only while the Agent is active", () => {
    assert.equal(shouldBlockCanvasNavigation("/canvas/a", "/canvas/b", true, false), true);
    assert.equal(shouldBlockCanvasNavigation("/canvas/a", "/canvas/b", false, false), false, "workflow and generation activity must not block navigation without an active Agent");
    assert.equal(shouldBlockCanvasNavigation("/canvas/a", "/canvas/a", true, false), false);
    assert.equal(shouldBlockCanvasNavigation("/canvas/a", "/canvas/b", true, true), false);
});

test("only retries a cloud save when newer local edits are still pending", () => {
    assert.equal(canvasProjectNeedsCloudRetry({ pendingSync: true }), true);
    assert.equal(canvasProjectNeedsCloudRetry({ pendingSync: false }), false);
    assert.equal(canvasProjectNeedsCloudRetry({}), false);
    assert.equal(canvasProjectNeedsCloudRetry(null), false);
});

test("groups disconnected canvas branches as separate collapsible workflows", () => {
    const nodes = [node("input-a", "image"), node("config-a", "config"), node("output-a", "image"), node("input-b", "text"), node("config-b", "config"), node("output-b", "text"), node("guide", "text")];
    const groups = buildCanvasSidePanelWorkflowGroups(nodes, [edge("input-a", "config-a"), edge("config-a", "output-a"), edge("input-b", "config-b"), edge("config-b", "output-b")]);
    assert.deepEqual(groups.map((group) => group.nodes.map((item) => item.id)), [["input-a", "config-a", "output-a"], ["input-b", "config-b", "output-b"], ["guide"]]);
    assert.deepEqual(groups.map((group) => group.firstConfig?.id), ["config-a", "config-b", undefined]);
});

test("defaults new and legacy canvas image generation to one image", () => {
    assert.equal(defaultConfig.canvasImageCount, "1");
    assert.equal(migrateConfigStore({ config: { canvasImageCount: "3" } }, 1).config.canvasImageCount, "1");
    assert.equal(migrateConfigStore({ config: { canvasImageCount: "4" } }, 2).config.canvasImageCount, "4");
});

test("keeps maintenance models visible but excludes them from new canvas tasks", () => {
    const config = {
        ...defaultConfig,
        imageModel: "starclouds::maintenance-image",
        channels: [{
            id: "starclouds",
            name: "本站模型",
            models: [
                { name: "maintenance-image", label: "维护模型", capability: "image", iconUrl: "/api/v1/files/model-icons/maintenance.webp", status: "maintenance", maintenance: true },
                { name: "available-image", label: "正常模型", capability: "image", iconUrl: "/api/v1/files/model-icons/available.webp", status: "available", maintenance: false },
            ],
        }],
        models: ["starclouds::maintenance-image", "starclouds::available-image"],
    };
    assert.deepEqual(catalogModelsByCapability(config, "image"), ["starclouds::maintenance-image", "starclouds::available-image"]);
    assert.deepEqual(selectableModelsByCapability(config, "image"), ["starclouds::available-image"]);
    assert.equal(resolveModelForCapability(config, "starclouds::maintenance-image", "image"), "starclouds::available-image");
});

test("promotes the first completed image when the previous batch primary is stale", () => {
    assert.equal(shouldPromoteGeneratedImage("old-primary", "new-1", ["new-1", "new-2"]), true);
    assert.equal(shouldPromoteGeneratedImage("new-1", "new-2", ["new-1", "new-2"]), false);
    assert.equal(shouldPromoteGeneratedImage(undefined, "new-2", ["new-1", "new-2"]), true);
});

test("orders config nodes through generated resource nodes", () => {
    const nodes = [node("input", "image"), node("a", "config"), node("a-out", "image"), node("b", "config"), node("b-out", "image"), node("c", "config")];
    const connections = [edge("input", "a"), edge("a", "a-out"), edge("a-out", "b"), edge("b", "b-out"), edge("b-out", "c")];
    const result = compileCanvasWorkflow(nodes, connections);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.layers, [["a"], ["b"], ["c"]]);
});

test("keeps reusable local image operations deterministic", () => {
    assert.equal(isCanvasLocalImageOperation("split"), true);
    assert.equal(isCanvasLocalImageOperation("angle"), false);
    const split = normalizeCanvasLocalImageOperationParams("split", { rows: 99, columns: 0, horizontalLines: [0.75, 0.25, 0.25], verticalLines: [0.5] });
    assert.deepEqual(split, { rows: 3, columns: 2, horizontalLines: [0.25, 0.75], verticalLines: [0.5] });
    assert.equal(canvasLocalImageOperationOutputCount("split", split), 6);
    assert.deepEqual(normalizeCanvasLocalImageOperationParams("crop", { x: -1, y: 0.8, width: 3, height: 3 }), { x: 0, y: 0.8, width: 1, height: 0.19999999999999996 });
    assert.deepEqual(normalizeCanvasLocalImageOperationParams("upscale", { targetLongEdge: 9000, algorithm: "unknown" }), { targetLongEdge: 4096, algorithm: "high" });
});

test("schedules reusable image operations as ordinary workflow dependencies", () => {
    const nodes = [
        node("input", "image", { status: "success", content: "source.png" }),
        node("split", "builtin:split", { localImageOperation: "split", localImageOperationParams: { rows: 2, columns: 2 } }),
        node("piece", "image", { workflowProducerNodeId: "split" }),
        node("angle", "builtin:angle", { generationMode: "image" }),
    ];
    const result = compileCanvasWorkflow(nodes, [edge("input", "split"), edge("split", "piece"), edge("piece", "angle")]);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.layers, [["split"], ["angle"]]);
});


test("keeps independent branches in the same layer", () => {
    const nodes = [node("a", "config"), node("b", "config"), node("a-out", "image"), node("b-out", "image"), node("c", "config")];
    const connections = [edge("a", "a-out"), edge("b", "b-out"), edge("a-out", "c"), edge("b-out", "c")];
    const result = compileCanvasWorkflow(nodes, connections);
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.layers, [["a", "b"], ["c"]]);
});

test("compiles only the requested workflow config nodes", () => {
    const nodes = [node("input-a", "text"), node("config-a", "config"), node("output-a", "image"), node("input-b", "text"), node("config-b", "config"), node("output-b", "image")];
    const connections = [edge("input-a", "config-a"), edge("config-a", "output-a"), edge("input-b", "config-b"), edge("config-b", "output-b")];
    const result = compileCanvasWorkflow(nodes, connections, { configNodeIds: ["config-b"] });
    assert.equal(result.ok, true);
    assert.deepEqual(result.plan.nodeIds, ["config-b"]);
});

test("rejects cycles between config nodes", () => {
    const nodes = [node("a", "config"), node("a-out", "image"), node("b", "config"), node("b-out", "image")];
    const connections = [edge("a", "a-out"), edge("a-out", "b"), edge("b", "b-out"), edge("b-out", "a")];
    const result = compileCanvasWorkflow(nodes, connections);
    assert.deepEqual(result, { ok: false, reason: "cycle", nodeIds: ["a", "b"] });
});

test("rejects direct config-to-config edges before scheduling", () => {
    const nodes = [node("a", "config"), node("b", "config")];
    assert.deepEqual(compileCanvasWorkflow(nodes, [edge("a", "b")]), { ok: false, reason: "invalid_connection", nodeIds: ["a", "b"] });
});

test("resolves stable output slots", () => {
    const nodes = [node("config", "config", { workflowOutputNodeIds: ["result"] }), node("result", "image", { workflowProducerNodeId: "config" })];
    assert.deepEqual(findWorkflowOutputNodes("config", "image", nodes).map((item) => item.id), ["result"]);
});

test("adopts a connected placeholder as the stable output slot", () => {
    const nodes = [node("config", "config"), node("result", "image")];
    assert.deepEqual(findWorkflowOutputNodes("config", "image", nodes, [edge("config", "result")]).map((item) => item.id), ["result"]);
});

test("a copied config forgets its old output and adopts the newly connected text card", () => {
    const metadata = copyCanvasNodeMetadata(
        {
            generationMode: "text",
            composerContent: "write listing copy",
            workflowOutputNodeIds: ["old-result"],
            taskId: "old-task",
            taskKind: "assistant",
            executionStatus: "succeeded",
            generationCompletedAt: "2026-08-17T00:00:00.000Z",
        },
        new Map([["config", "config-copy"]]),
    );
    const nodes = [node("old-result", "text"), node("config-copy", "config", metadata), node("new-result", "text")];
    assert.equal(metadata.workflowOutputNodeIds, undefined);
    assert.equal(metadata.taskId, undefined);
    assert.equal(metadata.executionStatus, undefined);
    assert.deepEqual(findWorkflowOutputNodes("config-copy", "text", nodes, [edge("config-copy", "new-result")]).map((item) => item.id), ["new-result"]);
});

test("copying a storyboard shot creates an independent retry identity", () => {
    const metadata = copyCanvasNodeMetadata({
        prompt: "电影级分镜画面，雨后车站",
        storyboardId: "storyboard-1",
        storyboardSceneId: "shot-2",
        storyboardIndex: 2,
        storyboardStatus: "failed",
        storyboardSourceNodeId: "script",
        storyboardPreviousSceneId: "shot-1",
        storyboardNextSceneId: "shot-3",
        storyboardStyle: "cinematic",
        storyboardConsistency: true,
    }, new Map());
    assert.equal(metadata.prompt, "电影级分镜画面，雨后车站");
    assert.equal(metadata.storyboardId, undefined);
    assert.equal(metadata.storyboardSceneId, undefined);
    assert.equal(metadata.storyboardStatus, undefined);
    assert.equal(metadata.storyboardSourceNodeId, undefined);
    assert.equal(metadata.storyboardPreviousSceneId, undefined);
    assert.equal(metadata.storyboardNextSceneId, undefined);
});

test("an existing copied config prefers its current connection over a stale persisted output id", () => {
    const nodes = [
        node("config-copy", "config", { workflowOutputNodeIds: ["old-result"] }),
        node("old-result", "text", { workflowProducerNodeId: "original-config" }),
        node("new-result", "text"),
    ];
    assert.deepEqual(findWorkflowOutputNodes("config-copy", "text", nodes, [edge("config-copy", "new-result")]).map((item) => item.id), ["new-result"]);
});

test("copying a complete workflow remaps output ownership and composer references", () => {
    const idMap = new Map([
        ["input", "input-copy"],
        ["config", "config-copy"],
        ["result", "result-copy"],
    ]);
    const config = copyCanvasNodeMetadata({ composerContent: "use @[node:input]", workflowOutputNodeIds: ["result"] }, idMap);
    const result = copyCanvasNodeMetadata({ workflowProducerNodeId: "config" }, idMap);
    assert.equal(config.composerContent, "use @[node:input-copy]");
    assert.deepEqual(config.workflowOutputNodeIds, ["result-copy"]);
    assert.equal(result.workflowProducerNodeId, "config-copy");
});

test("repairs stale references in workflows copied before reference remapping", () => {
    const nodes = [
        node("original-input", "image", { content: "original.png" }),
        node("copied-input", "image", { content: "copied.png" }),
        node("original-output", "image", { workflowProducerNodeId: "original-config" }),
        node("copied-output", "image", { content: "copied-output.png", workflowProducerNodeId: "copied-parent" }),
        node("copied-config", "config", { composerContent: "use @[node:original-input] and @[node:original-output]" }),
    ];
    nodes[0].title = "商品图";
    nodes[1].title = "商品图 Copy";
    nodes[2].title = "输出 01｜透明母资产";
    nodes[3].title = "输出 01｜透明母资产 Copy";
    const connections = [edge("copied-input", "copied-config"), edge("copied-output", "copied-config")];
    assert.equal(
        resolveCopiedCanvasNodeReferences("copied-config", nodes[4].metadata.composerContent, nodes, connections),
        "use @[node:copied-input] and @[node:copied-output]",
    );
    const pendingNodes = nodes.map((item) =>
        item.id === "copied-output" ? { ...item, metadata: { ...item.metadata, content: "" } } : item,
    );
    const readiness = validateCanvasWorkflowNodeReadiness({
        nodeId: "copied-config",
        nodes: pendingNodes,
        connections,
        dependencies: new Set(["copied-parent"]),
        completedNodeIds: new Set(),
        allowPendingDependencies: true,
    });
    assert.equal(readiness.ok, true);
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

test("connectionSourceNodeIds expands multi-select sources", () => {
    assert.deepEqual(connectionSourceNodeIds({ nodeId: "a" }), ["a"]);
    assert.deepEqual(connectionSourceNodeIds({ nodeId: "a", sourceNodeIds: [] }), ["a"]);
    assert.deepEqual(connectionSourceNodeIds({ nodeId: "a", sourceNodeIds: ["a", "b", "a", "c"] }), ["a", "b", "c"]);
    assert.deepEqual(connectionSourceNodeIds(null), []);
});

test("disconnecting a selection cuts wires on both sides and leaves the rest alone", () => {
    const connections = [
        { id: "c1", fromNodeId: "text", toNodeId: "config" },
        { id: "c2", fromNodeId: "config", toNodeId: "out" },
        { id: "c3", fromNodeId: "out", toNodeId: "upscale" },
        { id: "c4", fromNodeId: "other-a", toNodeId: "other-b" },
    ];
    // Incoming c1 and outgoing c2 both go, because either endpoint counts.
    assert.deepEqual([...canvasConnectionIdsTouchingNodes(connections, new Set(["config"]))], ["c1", "c2"]);
    assert.deepEqual([...canvasConnectionIdsTouchingNodes(connections, new Set(["config", "upscale"]))], ["c1", "c2", "c3"]);
    // An empty or unrelated selection must never touch a wire.
    assert.equal(canvasConnectionIdsTouchingNodes(connections, new Set()).size, 0);
    assert.equal(canvasConnectionIdsTouchingNodes(connections, new Set(["ghost"])).size, 0);
});

test("multi-selected images can each normalize onto one config target", () => {
    const nodes = [node("img-1", "image"), node("img-2", "image"), node("img-3", "image"), node("config", "config")];
    const links = ["img-1", "img-2", "img-3"]
        .map((id) => normalizeConnection(id, "config", nodes, "source"))
        .filter(Boolean);
    assert.equal(links.length, 3);
    assert.deepEqual(links.map((link) => link.fromNodeId), ["img-1", "img-2", "img-3"]);
    assert.ok(links.every((link) => link.toNodeId === "config"));
});

test("blocks unresolved workflow references until their producer has completed", () => {
    const nodes = [
        node("input", "image", { content: "source.png", status: "success" }),
        node("a", "config", { composerContent: "use @[node:input]" }),
        node("a-out", "image", { workflowProducerNodeId: "a", status: "idle" }),
        node("b", "config", { composerContent: "use @[node:a-out]" }),
    ];
    const pending = validateCanvasWorkflowNodeReadiness({ nodeId: "b", nodes, dependencies: new Set(["a"]), completedNodeIds: new Set(), allowPendingDependencies: true });
    assert.equal(pending.ok, true);
    const runtime = validateCanvasWorkflowNodeReadiness({ nodeId: "b", nodes, dependencies: new Set(["a"]), completedNodeIds: new Set(["a"]) });
    assert.deepEqual(runtime, { ok: false, issue: { reason: "reference_empty", nodeId: "b", relatedNodeId: "a-out" } });
});

test("rejects missing references and incomplete dependencies", () => {
    const missing = validateCanvasWorkflowNodeReadiness({ nodeId: "b", nodes: [node("b", "config", { composerContent: "use @[node:missing]" })], dependencies: new Set(), completedNodeIds: new Set() });
    assert.deepEqual(missing, { ok: false, issue: { reason: "reference_missing", nodeId: "b", relatedNodeId: "missing" } });
    const dependency = validateCanvasWorkflowNodeReadiness({ nodeId: "b", nodes: [node("b", "config")], dependencies: new Set(["a"]), completedNodeIds: new Set() });
    assert.deepEqual(dependency, { ok: false, issue: { reason: "dependency_incomplete", nodeId: "b", relatedNodeId: "a" } });
});

test("requires the requested number of successful workflow outputs", () => {
    const nodes = [
        node("config", "config", { workflowOutputNodeIds: ["result"] }),
        node("result", "image", { images: [{ id: "ok", status: "success", content: "ok.png" }, { id: "bad", status: "error", errorDetails: "provider failed" }] }),
    ];
    assert.deepEqual(validateCanvasWorkflowNodeOutputs({ nodeId: "config", mode: "image", expectedCount: 2, nodes, connections: [] }), {
        ok: false,
        issue: { reason: "output_failed", nodeId: "config", expected: 2, actual: 1, errorDetails: "provider failed" },
    });
    assert.equal(validateCanvasWorkflowNodeOutputs({ nodeId: "config", mode: "image", expectedCount: 1, nodes, connections: [] }).ok, true);
});

test("does not mark empty text output or a changed plan as complete", () => {
    const nodes = [node("config", "config", { workflowOutputNodeIds: ["result"] }), node("result", "text", { content: "", status: "success" })];
    assert.deepEqual(validateCanvasWorkflowNodeOutputs({ nodeId: "config", mode: "text", expectedCount: 1, nodes, connections: [] }), {
        ok: false,
        issue: { reason: "output_incomplete", nodeId: "config", expected: 1, actual: 0 },
    });
    const plan = compileCanvasWorkflow([node("a", "config"), node("b", "config")], []).plan;
    const checkpoint = createCanvasWorkflowCheckpoint(plan);
    assert.equal(workflowPlanMatchesCheckpoint(plan, checkpoint), true);
    assert.equal(workflowPlanMatchesCheckpoint({ ...plan, nodeIds: ["b", "a"] }, checkpoint), false);
});

test("workflow recovery validates prompts, models, input pixels, wiring and legacy checkpoints", () => {
    const nodes = [node("source", "image", { storageKey: "uploads/input.png" }), node("a", "config", { composerContent: "original", model: "model-a" }), node("out", "image"), node("b", "config")];
    const edges = [edge("source", "a"), edge("a", "out"), edge("out", "b")];
    const plan = compileCanvasWorkflow(nodes, edges).plan;
    const checkpoint = createCanvasWorkflowCheckpoint(plan);
    assert.equal(workflowPlanMatchesCheckpoint(plan, normalizeCanvasWorkflowCheckpoint(JSON.parse(JSON.stringify(checkpoint)))), true);
    for (const patch of [{ composerContent: "changed" }, { model: "model-b" }, { count: 4 }, { localImageOperationParams: { scale: 2 } }]) {
        const edited = nodes.map((item) => item.id === "a" ? { ...item, metadata: { ...item.metadata, ...patch } } : item);
        assert.equal(workflowPlanMatchesCheckpoint(compileCanvasWorkflow(edited, edges).plan, checkpoint), false);
    }
    const editedInput = nodes.map((item) => item.id === "source" ? { ...item, metadata: { storageKey: "uploads/changed.png" } } : item);
    assert.equal(workflowPlanMatchesCheckpoint(compileCanvasWorkflow(editedInput, edges).plan, checkpoint), false);
    assert.equal(workflowPlanMatchesCheckpoint(compileCanvasWorkflow(nodes, edges.filter((item) => item.fromNodeId !== "a")).plan, checkpoint), false);
    assert.equal(workflowPlanMatchesCheckpoint(plan, createCanvasWorkflowCheckpoint(plan.nodeIds)), false, "legacy node IDs alone cannot prove input compatibility");
    const defaultsA = compileCanvasWorkflow(nodes, edges, { resolveSettings: () => ({ model: "default-a" }) }).plan;
    const defaultsB = compileCanvasWorkflow(nodes, edges, { resolveSettings: () => ({ model: "default-b" }) }).plan;
    assert.equal(workflowPlanMatchesCheckpoint(defaultsB, createCanvasWorkflowCheckpoint(defaultsA)), false);
    const mentioned = [node("a", "config", { composerContent: "use @[node:reference]" }), node("reference", "text", { content: "original facts" })];
    const mentionedCheckpoint = createCanvasWorkflowCheckpoint(compileCanvasWorkflow(mentioned, []).plan);
    mentioned[1].metadata.content = "changed facts";
    assert.equal(workflowPlanMatchesCheckpoint(compileCanvasWorkflow(mentioned, []).plan, mentionedCheckpoint), false, "unconnected explicit mentions are inputs too");
});

test("output creation and execution metadata do not change a workflow input version", () => {
    const nodes = [node("source", "image", { storageKey: "uploads/input.png" }), node("a", "config", { composerContent: "original" }), node("out", "image"), node("b", "config")];
    const edges = [edge("source", "a"), edge("a", "out"), edge("out", "b")];
    const checkpoint = createCanvasWorkflowCheckpoint(compileCanvasWorkflow(nodes, edges).plan);
    const completed = nodes.map((item) => item.id === "out" ? { ...item, metadata: { content: "data:image/png;base64,generated", storageKey: "tasks/output.png", status: "success", workflowProducerNodeId: "a" } } : item.id === "a" ? { ...item, metadata: { ...item.metadata, status: "success", generationStartedAt: "now", generationDurationMs: 400, workflowOutputNodeIds: ["out"] } } : item);
    completed.push(node("extra", "image", { content: "generated", workflowProducerNodeId: "a" }));
    assert.equal(workflowPlanMatchesCheckpoint(compileCanvasWorkflow(completed, [...edges, edge("a", "extra")]).plan, checkpoint), true);
});

test("adopts a valid output from a falsely failed node without regenerating it", () => {
    const nodes = [node("config", "config", { generationMode: "text", count: 1, workflowOutputNodeIds: ["result"] }), node("result", "text", { status: "success", content: "complete answer" })];
    const failed = failCanvasWorkflowCheckpoint(completeCanvasWorkflowNode(createCanvasWorkflowCheckpoint(["config"]), "config", nodes, []), "config", "stale state");
    const recovered = reconcileCanvasWorkflowFailureOutput(failed, nodes, []);
    assert.equal(recovered.status, "running");
    assert.deepEqual(recovered.completedNodeIds, ["config"]);
    assert.equal(recovered.errorNodeId, undefined);
});

test("adopts all completed concurrent outputs after refresh", () => {
    const checkpoint = { ...createCanvasWorkflowCheckpoint(["a", "b", "c"]), currentNodeId: "a" };
    const nodes = [
        node("a", "config", { status: "success", workflowOutputNodeIds: ["a-out"] }),
        node("a-out", "image", { status: "success", content: "a.png" }),
        node("b", "config", { status: "success", workflowOutputNodeIds: ["b-out"] }),
        node("b-out", "image", { status: "success", content: "b.png" }),
        node("c", "config"),
    ];
    const certified = completeCanvasWorkflowNode(completeCanvasWorkflowNode(checkpoint, "a", nodes, []), "b", nodes, []);
    assert.deepEqual(reconcileCanvasWorkflowOutputs({ ...certified, completedNodeIds: [] }, nodes, [], { recoverPersistedOutputs: true }).completedNodeIds, ["a", "b"]);
});

test("does not adopt outputs from a previous run when explicitly rerunning", () => {
    const checkpoint = createCanvasWorkflowCheckpoint(["a", "b"]);
    const nodes = [
        node("a", "config", { status: "success", workflowOutputNodeIds: ["a-out"] }),
        node("a-out", "image", { status: "success", content: "old-a.png" }),
        node("b", "config", { status: "success", workflowOutputNodeIds: ["b-out"] }),
        node("b-out", "image", { status: "success", content: "old-b.png" }),
    ];
    const rerun = reconcileCanvasWorkflowOutputs(checkpoint, nodes, [], { recoverPersistedOutputs: false });
    assert.equal(rerun, checkpoint);
    assert.deepEqual(rerun.completedNodeIds, []);
});

test("resumes a duplicated workflow task only on its real output node", () => {
    const taskId = "task-1";
    const image = { id: "image-1", status: "loading", content: "", storageKey: "", naturalWidth: 0, naturalHeight: 0, bytes: 0, mimeType: "", taskId };
    const nodes = [
        node("config", "config", { status: "loading", taskId, taskKind: "image", workflowOutputNodeIds: ["output"] }),
        node("output", "image", { status: "loading", taskId, taskKind: "image", workflowProducerNodeId: "config", images: [image] }),
    ];
    assert.deepEqual(pendingCanvasTasks(nodes), [{ nodeId: "output", imageId: "image-1", taskId, kind: "image" }]);
});

test("schedules independent workflows together and cancels only queued dependents", () => {
    const dependencies = new Map([
        ["a", new Set()],
        ["b", new Set(["a"])],
        ["x", new Set()],
        ["y", new Set(["x"])],
    ]);
    assert.deepEqual(findRunnableCanvasWorkflowNodeIds({ pendingNodeIds: ["a", "b", "x", "y"], completedNodeIds: new Set(), dependencies }), ["a", "x"]);
    assert.deepEqual([...findCanvasWorkflowCancellationClosure("a", ["a", "b", "x", "y"], dependencies)], ["a", "b"]);
});

test("canceling the queue while a node is running leaves later nodes unrunnable after it completes", () => {
    const dependencies = new Map([
        ["a", new Set()],
        ["b", new Set(["a"])],
        ["c", new Set(["b"])],
    ]);
    const pending = new Set(["a", "b", "c"]);
    const first = findRunnableCanvasWorkflowNodeIds({ pendingNodeIds: pending, completedNodeIds: new Set(), dependencies });
    assert.deepEqual(first, ["a"]);
    first.forEach((id) => pending.delete(id));
    const canceled = new Set(["b", "c"]);
    canceled.forEach((id) => pending.delete(id));
    const next = findRunnableCanvasWorkflowNodeIds({
        pendingNodeIds: pending,
        completedNodeIds: new Set(["a"]),
        blockedNodeIds: canceled,
        dependencies,
    }).filter((id) => !canceled.has(id));
    assert.deepEqual(next, []);
    assert.equal(pending.size, 0);

    const persisted = normalizeCanvasWorkflowCheckpoint({
        ...createCanvasWorkflowCheckpoint(["a", "b", "c"]),
        currentNodeId: "a",
        canceledNodeIds: ["b", "c"],
    });
    assert.deepEqual(persisted?.canceledNodeIds, ["b", "c"]);
    const restoredCanceled = new Set(persisted?.canceledNodeIds || []);
    const restoredPending = persisted.nodeIds.filter((id) => !persisted.completedNodeIds.includes(id) && !restoredCanceled.has(id));
    assert.deepEqual(restoredPending, ["a"]);
    assert.deepEqual(
        findRunnableCanvasWorkflowNodeIds({
            pendingNodeIds: restoredPending.filter((id) => id !== "a"),
            completedNodeIds: new Set(["a"]),
            blockedNodeIds: restoredCanceled,
            dependencies,
        }),
        [],
    );
});

test("does not reuse stale text content from a newly failed retry", () => {
    const nodes = [node("config", "config", { workflowOutputNodeIds: ["result"] }), node("result", "text", { status: "error", content: "old answer", errorDetails: "new request failed" })];
    assert.deepEqual(validateCanvasWorkflowNodeOutputs({ nodeId: "config", mode: "text", expectedCount: 1, nodes, connections: [] }), {
        ok: false,
        issue: { reason: "output_failed", nodeId: "config", expected: 1, actual: 0, errorDetails: "new request failed" },
    });
});

test("persists and advances workflow checkpoints", () => {
    const started = createCanvasWorkflowCheckpoint(["a", "b", "c"], "2026-08-17T00:00:00.000Z");
    const running = { ...started, currentNodeId: "a" };
    const restored = normalizeCanvasWorkflowCheckpoint(JSON.parse(JSON.stringify(running)));
    assert.deepEqual(restored, running);
    assert.deepEqual(advanceCanvasWorkflowCheckpoint(running, "a", "2026-08-17T00:01:00.000Z"), {
        ...started,
        completedNodeIds: ["a"],
        currentNodeId: undefined,
        updatedAt: "2026-08-17T00:01:00.000Z",
    });
});

test("starts success and canceled workflow reruns from a fresh checkpoint", () => {
    const terminal = {
        ...createCanvasWorkflowCheckpoint(["a", "b"], "2026-08-17T00:00:00.000Z"),
        runId: "run-old",
        completedNodeIds: ["a"],
        canceledNodeIds: ["b"],
        currentNodeId: "b",
    };
    assert.equal(canvasWorkflowCheckpointForStart("success", terminal), null);
    assert.equal(canvasWorkflowCheckpointForStart("canceled", terminal), null);
    assert.equal(canvasWorkflowCheckpointForStart("error", terminal), terminal);

    const restarted = createCanvasWorkflowCheckpoint(["a", "b"], "2026-08-17T01:00:00.000Z");
    assert.deepEqual(restarted.completedNodeIds, []);
    assert.equal(restarted.canceledNodeIds, undefined);
    assert.equal(restarted.currentNodeId, undefined);
    assert.equal(restarted.runId, undefined);
});

test("waits for a stopped workflow before creating its fresh rerun", async () => {
    const events = [];
    let finishStop;
    const stopped = new Promise((resolve) => {
        finishStop = () => {
            events.push("stopped");
            resolve();
        };
    });
    const restart = (async () => {
        await waitForCanvasWorkflowStop(stopped);
        events.push("restarted");
        return createCanvasWorkflowCheckpoint(["a"]);
    })();
    await Promise.resolve();
    assert.deepEqual(events, []);
    finishStop();
    const checkpoint = await restart;
    assert.deepEqual(events, ["stopped", "restarted"]);
    assert.deepEqual(checkpoint.completedNodeIds, []);
});

test("waits for terminal persistence before creating a fresh rerun", async () => {
    const events = [];
    let finishPersistence;
    const terminalPersistence = new Promise((resolve) => {
        finishPersistence = () => {
            events.push("persisted-terminal");
            resolve();
        };
    });
    const restart = (async () => {
        await waitForCanvasWorkflowStop(terminalPersistence);
        events.push("created-rerun");
    })();
    await Promise.resolve();
    assert.deepEqual(events, []);
    finishPersistence();
    await restart;
    assert.deepEqual(events, ["persisted-terminal", "created-rerun"]);
});

test("releases the workflow lock and presents a terminal state when local persistence fails", async () => {
    const events = [];
    const failure = new Error("indexeddb unavailable");
    const result = await settleCanvasWorkflowTerminal({
        persist: async () => {
            events.push("persist");
            throw failure;
        },
        release: () => events.push("release"),
        present: () => events.push("present"),
    });
    assert.equal(result.persistenceFailed, true);
    assert.equal(result.persistenceError, failure);
    assert.deepEqual(events, ["release", "present", "persist"]);
});

test("keeps a failed workflow checkpoint retryable", () => {
    const running = { ...createCanvasWorkflowCheckpoint(["config-a", "config-b"], "2026-08-17T00:00:00.000Z"), runId: "run-1" };
    const failed = failCanvasWorkflowCheckpoint(advanceCanvasWorkflowCheckpoint(running, "config-a"), "config-b", "provider failed", "2026-08-17T00:01:00.000Z");
    const restored = normalizeCanvasWorkflowCheckpoint(failed);
    assert.equal(restored.status, "failed");
    assert.equal(restored.runId, "run-1");
    assert.deepEqual(restored.completedNodeIds, ["config-a"]);
    assert.equal(restored.errorNodeId, "config-b");
    assert.equal(restored.errorMessage, "provider failed");
});

test("reconciles a refreshed current node without replaying completed work", () => {
    const nodes = [node("a", "config", { status: "success", generationMode: "image", count: 1, workflowOutputNodeIds: ["a-out"] }), node("a-out", "image", { status: "success", content: "done.png" }), node("b", "config")];
    const checkpoint = { ...completeCanvasWorkflowNode(createCanvasWorkflowCheckpoint(["a", "b"]), "a", nodes, []), completedNodeIds: [], currentNodeId: "a" };
    const completed = reconcileCanvasWorkflowCheckpoint(
        checkpoint,
        nodes,
        "interrupted",
    );
    assert.equal(completed.ok, true);
    assert.deepEqual(completed.checkpoint.completedNodeIds, ["a"]);
    const incomplete = reconcileCanvasWorkflowCheckpoint(checkpoint, [node("a", "config", { status: "success", workflowOutputNodeIds: ["a-out"] }), node("a-out", "image", { status: "success" })], "interrupted");
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.reason, "failed");
    const interrupted = reconcileCanvasWorkflowCheckpoint(checkpoint, [node("a", "config", { status: "error", errorDetails: "interrupted" })], "interrupted");
    assert.equal(interrupted.ok, true);
    assert.equal(interrupted.checkpoint.currentNodeId, "a");
    const failed = reconcileCanvasWorkflowCheckpoint(checkpoint, [node("a", "config", { status: "error", errorDetails: "provider failed" })], "interrupted");
    assert.deepEqual({ ok: failed.ok, reason: failed.reason, nodeId: failed.nodeId }, { ok: false, reason: "failed", nodeId: "a" });
    const canceled = reconcileCanvasWorkflowCheckpoint(checkpoint, [node("a", "config", { status: "error", errorDetails: "生成已取消，请重新生成。" })], "interrupted", [], ["生成已取消，请重新生成。"]);
    assert.equal(canceled.ok, true);
    const retryingFailure = reconcileCanvasWorkflowCheckpoint({ ...failCanvasWorkflowCheckpoint(checkpoint, "a", "provider failed"), currentNodeId: undefined, errorNodeId: undefined, errorMessage: undefined, status: "running" }, [node("a", "config", { status: "error", errorDetails: "provider failed" })], "interrupted");
    assert.equal(retryingFailure.ok, true);
});

test("rejects recovery after a completed intermediate output is manually replaced", () => {
    const nodes = [node("a", "config", { status: "success" }), node("a-out", "image", { status: "success", storageKey: "tasks/user/task/original/a.png" }), node("b", "config")];
    const edges = [edge("a", "a-out"), edge("a-out", "b")];
    const plan = compileCanvasWorkflow(nodes, edges).plan;
    const saved = JSON.parse(JSON.stringify(completeCanvasWorkflowNode(createCanvasWorkflowCheckpoint(plan), "a", nodes, edges)));
    const restored = normalizeCanvasWorkflowCheckpoint(saved);
    assert.equal(validateCanvasWorkflowCompletedOutputs(restored, nodes, edges).ok, true);
    const edited = nodes.map((item) => item.id === "a-out" ? { ...item, metadata: { ...item.metadata, storageKey: "uploads/manual-replacement.png", content: "new pixels" } } : item);
    assert.equal(workflowPlanMatchesCheckpoint(compileCanvasWorkflow(edited, edges).plan, restored), true, "runtime output contents stay outside the input signature");
    assert.deepEqual(validateCanvasWorkflowCompletedOutputs(restored, edited, edges), { ok: false, nodeId: "a", reason: "changed" });
    const agentEdit = nodes.map((item) => item.id === "a-out" ? applyCanvasAgentNodeUpdate(item, { patch: { content: "data:image/png;base64,edited-pixels" } }) : item);
    assert.equal(agentEdit[1].metadata.storageKey, undefined, "an Agent content replacement must discard the old resource identity");
    assert.equal(validateCanvasWorkflowCompletedOutputs(restored, agentEdit, edges).ok, false);
    const sameResource = nodes.map((item) => item.id === "a-out" ? applyCanvasAgentNodeUpdate(item, { patch: { content: "/api/v1/files/tasks/user/task/original/a.png" } }) : item);
    assert.equal(validateCanvasWorkflowCompletedOutputs(restored, sameResource, edges).ok, true);
    assert.throws(() => completeCanvasWorkflowNode(createCanvasWorkflowCheckpoint(plan), "a", edited, edges, new Date().toISOString(), canvasWorkflowNodeOutputFingerprint("a", nodes, edges)), /完成后已被修改/, "a sibling's long execution cannot cause a later manual edit to be certified as this node's output");
    const textNodes = [node("a", "config", { generationMode: "text" }), node("text", "text", { status: "success", content: "original answer" })];
    const textEdges = [edge("a", "text")];
    const textCheckpoint = completeCanvasWorkflowNode(createCanvasWorkflowCheckpoint(["a"]), "a", textNodes, textEdges);
    textNodes[1].metadata.content = "manually rewritten answer";
    assert.equal(validateCanvasWorkflowCompletedOutputs(textCheckpoint, textNodes, textEdges).ok, false);
});

test("normal output hydration and cloud progress preserve resumable output fingerprints", () => {
    const key = "tasks/user/task/original/a.png";
    const nodes = [node("a", "config"), node("out", "image", { status: "success", storageKey: key, content: "data:image/png;base64,original" }), node("b", "config")];
    const edges = [edge("a", "out"), edge("out", "b")];
    const initial = createCanvasWorkflowCheckpoint(compileCanvasWorkflow(nodes, edges).plan);
    const completed = completeCanvasWorkflowNode(initial, "a", nodes, edges);
    const hydrated = nodes.map((item) => item.id === "out" ? { ...item, position: { x: 300, y: 400 }, metadata: { ...item.metadata, content: `/api/v1/files/${key}`, thumbnailUrl: "new-thumbnail", generationDurationMs: 99 } } : item);
    const local = normalizeCanvasWorkflowCheckpoint(JSON.parse(JSON.stringify(completed)));
    assert.equal(validateCanvasWorkflowCompletedOutputs(local, hydrated, edges).ok, true);
    const recovered = mergeCanvasWorkflowRunProgress(initial, { id: "run-1", nodeIds: ["a", "b"], completedNodeIds: ["a"], nodeMetrics: [{ nodeId: "a", outputFingerprint: completed.outputFingerprints.a }] });
    assert.equal(validateCanvasWorkflowCompletedOutputs(recovered, hydrated, edges).ok, true);
    const gallery = nodes.map((item) => item.id === "out" ? { ...item, metadata: { status: "success", images: [{ id: "image-1", status: "success", storageKey: key, content: "data:image/png;base64,original" }] } } : item);
    const galleryCheckpoint = completeCanvasWorkflowNode(initial, "a", gallery, edges);
    const galleryHydrated = gallery.map((item) => item.id === "out" ? { ...item, metadata: { ...item.metadata, storageKey: key, content: `/api/v1/files/${key}`, primaryImageId: "image-1" } } : item);
    assert.equal(validateCanvasWorkflowCompletedOutputs(galleryCheckpoint, galleryHydrated, edges).ok, true);
    const unsaved = nodes.map((item) => item.id === "out" ? { ...item, metadata: { status: "success", content: "data:image/png;base64,pending-upload" } } : item);
    assert.throws(() => completeCanvasWorkflowNode(initial, "a", unsaved, edges), /尚未完整保存/);
});

test("legacy completed outputs without fingerprints are never silently trusted", () => {
    const nodes = [node("a", "config", { status: "success" }), node("out", "image", { status: "success", storageKey: "tasks/result.png" })];
    const edges = [edge("a", "out")];
    const initial = createCanvasWorkflowCheckpoint(compileCanvasWorkflow(nodes, edges).plan);
    const legacy = advanceCanvasWorkflowCheckpoint(initial, "a");
    assert.deepEqual(validateCanvasWorkflowCompletedOutputs(legacy, nodes, edges), { ok: false, nodeId: "a", reason: "unverified" });
    assert.deepEqual(reconcileCanvasWorkflowOutputs(initial, nodes, edges, { recoverPersistedOutputs: true }).completedNodeIds, []);
    const current = reconcileCanvasWorkflowCheckpoint({ ...initial, currentNodeId: "a" }, nodes, "interrupted", edges);
    assert.deepEqual(current.checkpoint.completedNodeIds, []);
});

test("local operation output count does not pollute the input signature", () => {
    const operation = node("split", "builtin:split", { localImageOperation: "split", localImageOperationParams: { rows: 2, columns: 2 } });
    const options = { resolveSettings: (item) => ({ model: "local", count: item.metadata.count || 1 }) };
    const plan = compileCanvasWorkflow([operation], [], options).plan;
    const updated = { ...operation, metadata: { ...operation.metadata, count: 4, localImageOperationCompletedCount: 4, workflowOutputNodeIds: ["out"] } };
    assert.equal(workflowPlanMatchesCheckpoint(compileCanvasWorkflow([updated], [], options).plan, createCanvasWorkflowCheckpoint(plan)), true);
});

test("treats an error current node as a failure retry even if the checkpoint still says running", () => {
    const checkpoint = { ...createCanvasWorkflowCheckpoint(["a", "b"]), currentNodeId: "a", runId: "run-1" };
    const nodes = [node("a", "config", { status: "error", errorDetails: "provider failed" }), node("b", "config")];
    assert.equal(isCanvasWorkflowFailureRetry(checkpoint, nodes), true);
    const started = beginCanvasWorkflowRetry(checkpoint, "2026-08-19T00:00:00.000Z");
    assert.equal(started.status, "running");
    assert.equal(started.currentNodeId, undefined);
    assert.equal(started.errorNodeId, undefined);
    assert.equal(started.runId, "run-1");
    const merged = mergeCanvasWorkflowRunProgress(started, { id: "run-1", nodeIds: ["a", "b"], completedNodeIds: [], currentNodeId: "a" }, { resetCurrentNode: true });
    assert.equal(merged.currentNodeId, undefined);
    const clobbered = mergeCanvasWorkflowRunProgress(started, { id: "run-1", nodeIds: ["a", "b"], completedNodeIds: [], currentNodeId: "a" });
    assert.equal(clobbered.currentNodeId, "a");
    const reconciled = reconcileCanvasWorkflowCheckpoint(merged, nodes, "interrupted");
    assert.equal(reconciled.ok, true);
});

test("counts leftover image content as a valid workflow output after a canceled retry", () => {
    const nodes = [
        node("config", "config", { generationMode: "image", count: 1, workflowOutputNodeIds: ["result"] }),
        node("result", "image", { status: "success", content: "kept.png", images: [{ id: "img-1", status: "error", errorDetails: "canceled", content: "", storageKey: "" }] }),
    ];
    assert.equal(validateCanvasWorkflowNodeOutputs({ nodeId: "config", mode: "image", expectedCount: 1, nodes, connections: [] }).ok, true);
});

test("keeps an unsynced local workflow checkpoint during cloud hydration", () => {
    const createStub = (summary) => ({ ...summary, marker: "stub" });
    const cloud = { id: "project", title: "project", revision: 7, createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z" };
    const local = { id: "project", title: "project", revision: 7, updatedAt: "2026-08-17T00:00:01.000Z", marker: "checkpoint" };
    const merged = mergeCanvasProjectSnapshots([cloud], [local], createStub);
    assert.equal(merged.projects[0].marker, "checkpoint");
    assert.deepEqual(merged.localNewerIds, ["project"]);

    // The list endpoint only carries summaries: when the remote revision moved
    // on, the local document is kept but marked stale for a merge-on-open
    // instead of being blindly replaced.
    const remoteAdvanced = { ...cloud, revision: 8, updatedAt: "2026-08-17T00:00:02.000Z" };
    const stale = mergeCanvasProjectSnapshots([remoteAdvanced], [local], createStub).projects[0];
    assert.equal(stale.marker, "checkpoint");
    assert.equal(stale.documentStale, true);
    assert.equal(stale.updatedAt, "2026-08-17T00:00:02.000Z");

    // Cloud-only entries become lazy-loading stubs.
    const cloudOnly = { id: "other", title: "other", revision: 1, createdAt: "2026-08-16T00:00:00.000Z", updatedAt: "2026-08-17T00:00:00.000Z" };
    assert.equal(mergeCanvasProjectSnapshots([cloudOnly], [local], createStub).projects[0].marker, "stub");
});

test("node-merges conflicting canvas documents instead of overwriting", () => {
    const doc = (nodes, connections, chatSessions = []) => ({ title: "p", revision: 1, updatedAt: "2026-08-17T00:00:00.000Z", nodes, connections, chatSessions });
    const local = doc(
        [
            node("kept-local", "image", { status: "success", content: "local.png", generationCompletedAt: "2026-08-17T00:00:05.000Z" }),
            node("pending-local", "image", { status: "loading" }),
            node("local-only", "text", { status: "success", content: "hi" }),
        ],
        [edge("kept-local", "pending-local")],
    );
    const remote = {
        ...doc(
            [
                node("kept-local", "image", { status: "success", content: "remote.png", generationCompletedAt: "2026-08-17T00:00:09.000Z" }),
                node("pending-local", "image", { status: "success", content: "remote-output.png", generationCompletedAt: "2026-08-17T00:00:08.000Z" }),
                node("remote-only", "image", { status: "success", content: "other-tab.png" }),
            ],
            [edge("kept-local", "pending-local"), edge("pending-local", "remote-only"), edge("remote-only", "ghost")],
        ),
        revision: 5,
        updatedAt: "2026-08-17T00:00:10.000Z",
    };
    // Local position is authoritative even when the remote output wins.
    remote.nodes[0].position = { x: 999, y: 999 };

    const merged = mergeCanvasProjectDocuments(local, remote);
    const byId = new Map(merged.nodes.map((item) => [item.id, item]));
    // Both sides have an output: the newer one (remote) wins, position stays local.
    assert.equal(byId.get("kept-local").metadata.content, "remote.png");
    assert.deepEqual(byId.get("kept-local").position, { x: 0, y: 0 });
    // Only the remote side finished: adopt its output.
    assert.equal(byId.get("pending-local").metadata.content, "remote-output.png");
    // Local-only and remote-only nodes both survive.
    assert.ok(byId.has("local-only"));
    assert.equal(byId.get("remote-only").metadata.content, "other-tab.png");
    // Connections are the de-duplicated union, dropping edges to missing nodes.
    assert.deepEqual(
        merged.connections.map((connection) => `${connection.fromNodeId}->${connection.toNodeId}`),
        ["kept-local->pending-local", "pending-local->remote-only"],
    );
    // The merged document saves on top of the remote revision.
    assert.equal(merged.revision, 5);
});

test("history media deletion survives stale canvas caches as a placeholder", () => {
    const key = "tasks/user/canvas/output.png";
    const document = {
        title: "p",
        revision: 1,
        updatedAt: "2026-08-17T00:00:00.000Z",
        nodes: [node("image", "image", { status: "success", content: `/api/v1/files/${key}`, storageKey: key })],
        connections: [],
        chatSessions: [],
    };
    const deletedAt = "2026-08-17T00:00:10.000Z";
    const marked = markCanvasProjectMediaDeleted(document, [key], deletedAt);
    assert.equal(marked.nodes[0].metadata.content, undefined);
    assert.equal(marked.nodes[0].metadata.storageKey, undefined);
    assert.equal(marked.nodes[0].metadata.deletedByHistory, true);
    assert.equal(marked.nodes[0].metadata.errorDetails, "该图片已被删除");

    const merged = mergeCanvasProjectDocuments(document, { ...marked, revision: 2 });
    assert.equal(merged.nodes[0].metadata.deletedByHistory, true);
    assert.equal(merged.nodes[0].metadata.content, undefined);
});

test("clamps agent-written image counts to the model cap so a finished node can certify its outputs", () => {
    const cap = (value) => () => value;
    const requested = [
        node("over", "config", { generationMode: "image", count: 8 }),
        node("within", "config", { generationMode: "image", count: 2 }),
        node("text", "text", { content: "hi" }),
    ];

    const clamped = clampCanvasAgentImageCounts(requested, cap(4));
    assert.equal(clamped[0].metadata.count, 4, "a count above the model cap must be lowered to the cap");
    assert.equal(clamped[1], requested[1], "a count within the cap keeps its node identity");
    assert.equal(clamped[2], requested[2], "nodes without a count are untouched");

    assert.equal(clampCanvasAgentImageCounts(requested, cap(8)), requested, "nothing changes when every count fits");
    assert.equal(clampCanvasAgentImageCounts(requested, () => null), requested, "an unknown model cap must not clamp");

    // The certification path reads the stored count, so clamping keeps the
    // expected output count aligned with what generation will actually request.
    assert.equal(workflowExpectedOutputCount(clamped[0]), 4);
    assert.equal(workflowExpectedOutputCount(requested[0]), 8);
});

test("keeps storyboard shot idempotency keys inside the server's 128-character limit", () => {
    const projectId = "123e4567-e89b-12d3-a456-426614174000";
    const runId = "7f1c9a02-5b3d-4e88-9a21-0c6f5d8e4b17";
    const nodeId = "config-1758043200000-a1b2c";
    const storyboardId = "storyboard-Ab3dEf9xYz";

    // The regression: a workflow run folded its 36-character runId into the
    // manual key format, which overflowed and failed every shot with a 422.
    const overflowed = `canvas:${projectId}:${nodeId}:${storyboardId}:${runId}:shot-1`;
    assert.equal(overflowed.length, 136, "the original composition really did exceed the limit");

    const workflowKey = canvasWorkflowTaskKey(runId, nodeId, `${storyboardId}:shot-1`);
    assert.ok(workflowKey.length <= MAX_CANVAS_TASK_KEY_LENGTH, `workflow shot key must fit, got ${workflowKey.length}`);
    assert.equal(workflowKey, `canvas:${runId}:${nodeId}:${storyboardId}:shot-1`, "a key within the limit stays readable and unhashed");

    // Distinct shots and distinct runs must stay distinct.
    assert.notEqual(workflowKey, canvasWorkflowTaskKey(runId, nodeId, `${storyboardId}:shot-2`));
    assert.notEqual(workflowKey, canvasWorkflowTaskKey(projectId, nodeId, `${storyboardId}:shot-1`));

    // Manual generation was already inside the limit and must not change shape,
    // or in-flight tasks would lose their dedup identity across a deploy.
    const manualKey = canvasManualTaskKey(projectId, nodeId, `${storyboardId}:nonce12345`, "shot-1");
    assert.equal(manualKey, `canvas:${projectId}:${nodeId}:${storyboardId}:nonce12345:shot-1`);
    assert.ok(manualKey.length <= MAX_CANVAS_TASK_KEY_LENGTH);
});

test("folds an over-long task key into a stable bounded digest", () => {
    const long = `canvas:${"x".repeat(200)}`;
    const bounded = boundedCanvasTaskKey(long);
    assert.equal(bounded.length, MAX_CANVAS_TASK_KEY_LENGTH, "a clamped key uses the full allowance");
    assert.equal(bounded, boundedCanvasTaskKey(long), "the same input must survive a crash-resume with the same key");
    assert.notEqual(bounded, boundedCanvasTaskKey(`${long}y`), "different inputs must not collapse onto one key");
    assert.equal(boundedCanvasTaskKey("canvas:short"), "canvas:short", "a short key is returned untouched");
});

test("restricts cast continuity to split mode so batch runs stay parallel", () => {
    // Continuity generates serially (each shot anchors on the previous render),
    // so a stale flag on a 100-image batch would silently cost ~4x wall clock.
    assert.equal(resolveStoryboardConsistency("split", true), true);
    assert.equal(resolveStoryboardConsistency("variants", true), false, "variants are independent takes on one prompt");
    assert.equal(resolveStoryboardConsistency("refs", true), false, "refs shots already carry their own reference");

    // Legacy documents saved the flag before the toggle was retired from the UI.
    assert.equal(resolveStoryboardConsistency(undefined, true), true, "an absent mode is split");
    assert.equal(resolveStoryboardConsistency("variants", undefined), false);
    assert.equal(resolveStoryboardConsistency("split", false), false);
});

const shotInput = (overrides = {}) => ({
    prompt: "a red bicycle",
    params: { quality: "high", size: "1024x1024", publicModelKey: "gpt-image-1" },
    count: 1,
    references: [{ storageKey: "uploads/a.png" }],
    ...overrides,
});

test("signs every value a shot submits so a rerun can tell changed images from unchanged ones", () => {
    const baseline = canvasShotInputSignature(shotInput());
    assert.equal(baseline, canvasShotInputSignature(shotInput()), "identical inputs must reuse, not re-bill");
    assert.notEqual(baseline, canvasShotInputSignature(shotInput({ prompt: "a blue bicycle" })), "prompt");
    assert.notEqual(baseline, canvasShotInputSignature(shotInput({ params: { quality: "low", size: "1024x1024", publicModelKey: "gpt-image-1" } })), "params");
    assert.notEqual(baseline, canvasShotInputSignature(shotInput({ count: 2 })), "count");
    assert.notEqual(baseline, canvasShotInputSignature(shotInput({ references: [{ storageKey: "uploads/b.png" }] })), "reference");
    assert.notEqual(baseline, canvasShotInputSignature(shotInput({ references: [] })), "dropping a reference");

    // Edit models read references positionally, so the same set in a new order
    // is a different request.
    const ordered = canvasShotInputSignature(shotInput({ references: [{ storageKey: "uploads/a.png" }, { storageKey: "uploads/b.png" }] }));
    const swapped = canvasShotInputSignature(shotInput({ references: [{ storageKey: "uploads/b.png" }, { storageKey: "uploads/a.png" }] }));
    assert.notEqual(ordered, swapped, "reference order is part of the request");

    assert.equal(baseline, canvasShotInputSignature(shotInput({ prompt: "  a red bicycle  " })), "the request trims the prompt, so the signature must too");
});

test("refuses to sign a shot whose reference has no identity beyond this session", () => {
    // A blob/data reference cannot be compared across runs; signing it by value
    // would let a rerun serve pixels from a since-replaced upload.
    assert.equal(canvasShotInputSignature(shotInput({ references: [{ dataUrl: "data:image/png;base64,AAA" }] })), null);
    assert.equal(canvasShotInputSignature(shotInput({ references: [{ url: "blob:http://localhost/abc" }] })), null);
    assert.equal(canvasShotInputSignature(shotInput({ references: [{ storageKey: "uploads/a.png" }, { url: "blob:http://localhost/abc" }] })), null, "one transient reference taints the whole shot");
});

test("reuses an image only when it is the proven output of exactly these inputs", () => {
    const signature = canvasShotInputSignature(shotInput());
    const succeeded = { id: "n1", metadata: { storyboardShotSignature: signature, storyboardShotOutput: "tasks/out.png", storyboardStatus: "succeeded", storageKey: "tasks/out.png" } };
    assert.equal(canvasShotIsReusable(succeeded, signature), true);

    assert.equal(canvasShotIsReusable(succeeded, canvasShotInputSignature(shotInput({ prompt: "changed" }))), false, "changed inputs must regenerate");
    assert.equal(canvasShotIsReusable(succeeded, null), false, "an unsignable shot must regenerate");
    assert.equal(canvasShotIsReusable(null, signature), false);
    assert.equal(canvasShotIsReusable({ id: "n2", metadata: { storyboardStatus: "succeeded", storageKey: "tasks/out.png" } }, signature), false, "an image from before signing must regenerate");

    // A failed shot keeps the pixels and signature of its last success, so the
    // inputs it failed on can never match it.
    assert.equal(canvasShotIsReusable({ ...succeeded, metadata: { ...succeeded.metadata, storyboardStatus: "failed" } }, signature), false);
    assert.equal(canvasShotIsReusable({ id: "n3", metadata: { storyboardShotSignature: signature, storyboardShotOutput: "tasks/out.png", storyboardStatus: "succeeded" } }, signature), false, "a signature without pixels is not an output");
});

test("refuses to reuse a shot whose pixels were replaced after it was signed", () => {
    // Task recovery, Agent edits and manual uploads all write images without
    // knowing which inputs produced them. Checking the recorded output against
    // the node's current image catches every such path at once.
    const signature = canvasShotInputSignature(shotInput());
    const signed = { storyboardShotSignature: signature, storyboardShotOutput: "tasks/out.png", storyboardStatus: "succeeded" };
    assert.equal(canvasShotIsReusable({ id: "n1", metadata: { ...signed, storageKey: "tasks/out.png" } }, signature), true);
    assert.equal(canvasShotIsReusable({ id: "n2", metadata: { ...signed, storageKey: "uploads/replaced.png" } }, signature), false, "a replaced upload is not the signed output");
    assert.equal(canvasShotIsReusable({ id: "n3", metadata: { ...signed, storageKey: "", content: "data:image/png;base64,edited" } }, signature), false, "an edit that drops the durable key is not the signed output");
    assert.equal(canvasShotIsReusable({ id: "n4", metadata: { ...signed, storageKey: undefined, content: undefined } }, signature), false, "a shot with no pixels left has nothing to reuse");

    // Older documents were signed before the output was recorded.
    assert.equal(canvasShotIsReusable({ id: "n5", metadata: { storyboardShotSignature: signature, storyboardStatus: "succeeded", storageKey: "tasks/out.png" } }, signature), false);
});

// Chain: a -> a-out -> b -> b-out, so b reads the image a produces.
const signedChain = () => {
    const nodes = [
        node("a", "config", { status: "success", prompt: "draw a cat" }),
        node("a-out", "image", { status: "success", storageKey: "tasks/user/task/original/a.png" }),
        node("b", "config", { status: "success", prompt: "upscale it" }),
        node("b-out", "image", { status: "success", storageKey: "tasks/user/task/original/b.png" }),
    ];
    const edges = [edge("a", "a-out"), edge("a-out", "b"), edge("b", "b-out")];
    const plan = compileCanvasWorkflow(nodes, edges).plan;
    const stamped = nodes.map((item) => {
        if (!plan.nodeIds.includes(item.id)) return item;
        return {
            ...item,
            metadata: {
                ...item.metadata,
                workflowInputSignature: canvasWorkflowNodeInputFingerprint({
                    nodeId: item.id,
                    nodes,
                    connections: edges,
                    executableNodeIds: plan.nodeIds,
                    resolveProducerOutput: (id) => canvasWorkflowNodeOutputFingerprint(id, nodes, edges),
                }),
                workflowOutputSignature: canvasWorkflowNodeOutputFingerprint(item.id, nodes, edges),
            },
        };
    });
    const carry = (current) => carryOverCanvasWorkflowCompletions({ layers: plan.layers, nodeIds: plan.nodeIds, nodes: current, connections: edges, dependencies: plan.dependencies }).completedNodeIds;
    const edit = (id, patch) => stamped.map((item) => (item.id === id ? { ...item, metadata: { ...item.metadata, ...patch } } : item));
    return { plan, edges, stamped, carry, edit };
};

test("carries over only the nodes a change cannot have touched", () => {
    const chain = signedChain();
    assert.deepEqual(chain.plan.nodeIds, ["a", "b"], "only config nodes execute");
    assert.deepEqual(chain.carry(chain.stamped).sort(), ["a", "b"], "an untouched graph owes no work");

    // The rule that makes this safe: b reads a's pixels, so a rerunning forces
    // b to rerun even though b's own prompt never changed.
    assert.deepEqual(chain.carry(chain.edit("a", { prompt: "draw a dog" })), [], "a changed upstream invalidates everything below it");
    assert.deepEqual(chain.carry(chain.edit("b", { prompt: "upscale it twice" })), ["a"], "a change invalidates only itself and its downstream");

    // A result that no longer exists, or was replaced by hand, is not a result.
    assert.deepEqual(chain.carry(chain.edit("a-out", { storageKey: "uploads/manual-replacement.png", content: "" })), [], "a manually replaced output must be regenerated");
    assert.deepEqual(chain.carry(chain.edit("b-out", { storageKey: "", content: "" })), ["a"], "a missing output must be regenerated");
});

test("never carries over a node that has not proven what it ran on", () => {
    const chain = signedChain();
    assert.deepEqual(chain.carry(chain.edit("a", { workflowInputSignature: undefined })), [], "a node from before signing must run, and so must its downstream");
    assert.deepEqual(chain.carry(chain.edit("b", { workflowOutputSignature: undefined })), ["a"]);

    // Stamping writes to node metadata, so it must not feed back into either
    // fingerprint or a second run could never match the first.
    const restamped = signedChain();
    assert.equal(restamped.stamped[0].metadata.workflowInputSignature, chain.stamped[0].metadata.workflowInputSignature);
    assert.deepEqual(
        carryOverCanvasWorkflowCompletions({ layers: chain.plan.layers, nodeIds: chain.plan.nodeIds, nodes: restamped.stamped, connections: chain.edges, dependencies: chain.plan.dependencies }).completedNodeIds.sort(),
        ["a", "b"],
    );
});

test("treats batch settings as inputs so changing the image count is never skipped", () => {
    const batch = (metadata) => {
        const nodes = [
            node("text", "text", { content: "one\ntwo\nthree" }),
            node("cfg", "config", { storyboardConfig: true, batchMode: "variants", batchVariantCount: 100, storyboardParseMode: "lines", storyboardStyle: "ink", storyboardAspectRatio: "1:1", ...metadata }),
            node("out", "image", { status: "success", storageKey: "tasks/user/task/original/out.png" }),
        ];
        const edges = [edge("text", "cfg"), edge("cfg", "out")];
        return canvasWorkflowNodeInputFingerprint({ nodeId: "cfg", nodes, connections: edges, executableNodeIds: ["cfg"], resolveProducerOutput: () => "v1:0" });
    };
    const baseline = batch({});
    assert.equal(baseline, batch({}));
    assert.notEqual(baseline, batch({ batchVariantCount: 80 }), "image count");
    assert.notEqual(baseline, batch({ batchMode: "split" }), "batch mode");
    assert.notEqual(baseline, batch({ storyboardParseMode: "blank-line" }), "split method");
    assert.notEqual(baseline, batch({ storyboardStyle: "watercolor" }), "style");
    assert.notEqual(baseline, batch({ storyboardAspectRatio: "16:9" }), "aspect ratio");

    // Written back at run start from the resolved inputs. Signing them would
    // compare a run against its own output, and the text they came from is
    // already covered by the upstream node.
    assert.equal(baseline, batch({ storyboardScript: "one\ntwo\nthree", storyboardShotCount: 3, storyboardInputRoles: { text: "primary" }, storyboardTitle: "batch" }), "run-written fields stay out of the input fingerprint");
});

test("reads the source text through the upstream node rather than the cached script", () => {
    const build = (content) => {
        const nodes = [node("text", "text", { content }), node("cfg", "config", { storyboardConfig: true, storyboardScript: "stale cached copy" })];
        const edges = [edge("text", "cfg")];
        return canvasWorkflowNodeInputFingerprint({ nodeId: "cfg", nodes, connections: edges, executableNodeIds: ["cfg"], resolveProducerOutput: () => "v1:0" });
    };
    assert.notEqual(build("one\ntwo"), build("one\ntwo\nthree"), "editing the connected text must invalidate the batch");
});

test("images still queued when a stop lands create no task", async () => {
    const freeze = createCanvasSubmissionFreeze();
    const createdTasks = [];
    const slotWaiters = [];
    // A multi-image node fires one request per image, but only a handful hold a
    // concurrency slot at a time, so most are still queued when a stop lands.
    const submitImage = async (nodeId) => {
        await new Promise((resolve) => slotWaiters.push(resolve));
        freeze.guard(nodeId)();
        createdTasks.push(nodeId);
    };
    const inFlight = Array.from({ length: 10 }, () => submitImage("node-a").then(() => "created", (error) => error.name));
    assert.equal(slotWaiters.length, 10, "every image is waiting on a slot");

    // Cancelling the tasks already created is what frees the slots these are
    // waiting for, so the freeze has to be in place before the cancels go out.
    const thaw = freeze.freeze(["node-a"]);
    slotWaiters.forEach((release) => release());
    assert.deepEqual(await Promise.all(inFlight), Array(10).fill("AbortError"));
    assert.deepEqual(createdTasks, [], "a stopped node must not bill for work it never ran");

    thaw();
    assert.doesNotThrow(freeze.guard("node-a"), "a settled stop must leave the node restartable");
});

test("overlapping stops do not thaw each other's nodes", () => {
    const freeze = createCanvasSubmissionFreeze();
    const thawWorkflow = freeze.freeze(["a", "b"]);
    const thawNode = freeze.freeze(["b", "c"]);
    thawNode();
    assert.equal(freeze.isFrozen("b"), true, "the workflow stop still owns b");
    assert.equal(freeze.isFrozen("c"), false);
    thawWorkflow();
    assert.equal(freeze.isFrozen("a"), false);
    assert.equal(freeze.isFrozen("b"), false);
});

test("a guard covers every node the request writes to", () => {
    const freeze = createCanvasSubmissionFreeze();
    freeze.freeze(["host"]);
    assert.throws(freeze.guard("shot", "host"), { name: "AbortError" }, "freezing a batch host must stop its shots");
    assert.doesNotThrow(freeze.guard("shot", ""), "an absent companion id must not freeze anything");
});
