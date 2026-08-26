import assert from "node:assert/strict";
import test from "node:test";

import { defaultConfig, migrateConfigStore } from "../src/canvas/stores/use-config-store.ts";
import { normalizeConnection } from "../src/canvas/lib/canvas/canvas-connection.ts";
import { copyCanvasNodeMetadata, resolveCopiedCanvasNodeReferences } from "../src/canvas/lib/canvas/canvas-node-copy.ts";
import {
    advanceCanvasWorkflowCheckpoint,
    beginCanvasWorkflowRetry,
    canvasWorkflowCheckpointForStart,
    compileCanvasWorkflow,
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
    waitForCanvasWorkflowStop,
    workflowPlanMatchesCheckpoint,
} from "../src/canvas/lib/canvas/canvas-workflow.ts";
import { pendingCanvasTasks } from "../src/canvas/lib/canvas/canvas-pending-tasks.ts";
import { canvasProjectNeedsCloudRetry, mergeCanvasProjectDocuments, mergeCanvasProjectSnapshots } from "../src/canvas/lib/canvas/canvas-project-sync.ts";
import { buildCanvasSidePanelWorkflowGroups } from "../src/canvas/lib/canvas/canvas-workflow-groups.ts";
import { shouldPromoteGeneratedImage } from "../src/canvas/lib/canvas/canvas-image-primary.ts";
import { shouldBlockCanvasNavigation } from "../src/canvas/lib/canvas/canvas-leave-guard.ts";
import { canvasLocalImageOperationOutputCount, isCanvasLocalImageOperation, normalizeCanvasLocalImageOperationParams } from "../src/canvas/lib/canvas/canvas-local-image-operation.ts";

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
    const checkpoint = createCanvasWorkflowCheckpoint(["a", "b"]);
    assert.equal(workflowPlanMatchesCheckpoint({ nodeIds: ["a", "b"], layers: [["a"], ["b"]], dependencies: new Map() }, checkpoint), true);
    assert.equal(workflowPlanMatchesCheckpoint({ nodeIds: ["b", "a"], layers: [["b"], ["a"]], dependencies: new Map() }, checkpoint), false);
});

test("adopts a valid output from a falsely failed node without regenerating it", () => {
    const failed = failCanvasWorkflowCheckpoint(createCanvasWorkflowCheckpoint(["config"]), "config", "stale state");
    const nodes = [node("config", "config", { generationMode: "text", count: 1, workflowOutputNodeIds: ["result"] }), node("result", "text", { status: "success", content: "complete answer" })];
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
    assert.deepEqual(reconcileCanvasWorkflowOutputs(checkpoint, nodes, [], { recoverPersistedOutputs: true }).completedNodeIds, ["a", "b"]);
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
    const checkpoint = { ...createCanvasWorkflowCheckpoint(["a", "b"]), currentNodeId: "a" };
    const completed = reconcileCanvasWorkflowCheckpoint(
        checkpoint,
        [node("a", "config", { status: "success", generationMode: "image", count: 1, workflowOutputNodeIds: ["a-out"] }), node("a-out", "image", { status: "success", content: "done.png" }), node("b", "config")],
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
