import assert from "node:assert/strict";
import test from "node:test";

import { canExecuteApprovedCanvasAgentTool, createCanvasAgentToolDelivery, createCanvasAgentToolJournal, waitForCanvasAgentToolPaint } from "../src/canvas/lib/canvas/canvas-agent-tool-delivery.ts";
import { canvasAgentWorkflowStatus } from "../src/canvas/lib/canvas/canvas-agent-workflow-status.ts";
import { bindHostedAgentRunId, createHostedAgentRunScope, isHostedAgentRunIdRetired, isHostedAgentRunScopeActive, isHostedAgentStateForProject, registerHostedAgentRunStopper, retireHostedAgentRunId, settleHostedAgentMessagesOnStop, stopHostedAgentRunForCanvas } from "../src/canvas/lib/agent/hosted-agent-run-scope.ts";

test("binds a hosted run to the canvas that started it", () => {
    const scope = createHostedAgentRunScope("canvas-a");
    assert.equal(bindHostedAgentRunId(scope, "run-a", scope, "canvas-a"), true);
    assert.equal(scope.runId, "run-a");
    assert.equal(isHostedAgentRunScopeActive(scope, scope, "canvas-b"), false, "an old run must not execute against the newly opened canvas");
    const replacement = createHostedAgentRunScope("canvas-a");
    assert.equal(isHostedAgentRunScopeActive(scope, replacement, "canvas-a"), false, "a retired run must not overwrite a newer run on the same canvas");
});

test("reuses hosted chat memory only for the canvas that owns it", () => {
    assert.equal(isHostedAgentStateForProject("canvas-a", "canvas-a"), true);
    assert.equal(isHostedAgentStateForProject("canvas-a", "canvas-b"), false);
    assert.equal(isHostedAgentStateForProject("", "canvas-b"), false);
});

test("rejects a run id that arrives after its canvas was left", () => {
    const scope = createHostedAgentRunScope("canvas-a");
    scope.controller.abort();
    assert.equal(bindHostedAgentRunId(scope, "run-late", null, "canvas-b"), false);
    assert.equal(isHostedAgentRunScopeActive(scope, scope, "canvas-a"), false, "an aborted scope must stay retired after returning to the canvas");
});

test("does not resume a locally retired run while server cancellation is still settling", () => {
    retireHostedAgentRunId("run-canceling");
    assert.equal(isHostedAgentRunIdRetired("run-canceling"), true);
    assert.equal(isHostedAgentRunIdRetired("run-current"), false);
});

test("lets the canvas force-stop its hosted Agent before navigation", async () => {
    const calls = [];
    const unregister = registerHostedAgentRunStopper(async (projectId, options) => {
        calls.push([projectId, options?.keepalive || false]);
    });
    await stopHostedAgentRunForCanvas("canvas-a", { keepalive: true });
    unregister();
    await stopHostedAgentRunForCanvas("canvas-b");
    assert.deepEqual(calls, [["canvas-a", true]]);
});

test("settles streamed replies and reasoning cards when a hosted run stops", () => {
    const completed = { id: "done", role: "tool", text: "读取完成", detail: { kind: "tool", status: "completed" } };
    const messages = settleHostedAgentMessagesOnStop([
        { id: "answer", role: "assistant", text: "", streamId: "answer" },
        { id: "reasoning", role: "tool", text: "正在分析", detail: { kind: "reasoning", status: "inProgress" } },
        completed,
    ], "已停止");
    assert.equal(messages[0].streamId, undefined);
    assert.equal(messages[0].text, "已停止");
    assert.equal(messages[1].detail.status, "interrupted");
    assert.equal(messages[2], completed, "already completed records must stay unchanged");
});

test("retries a failed acknowledgement without executing the mutation twice", async () => {
    let executions = 0;
    let acknowledgements = 0;
    const delivery = createCanvasAgentToolDelivery({
        runId: "run-1",
        execute: async () => {
            executions += 1;
            return { applied: 1 };
        },
        acknowledge: async () => {
            acknowledgements += 1;
            if (acknowledgements === 1) throw new Error("response lost");
        },
        isPending: async () => true,
        acknowledgeAttempts: 1,
    });
    const call = { requestId: "request-1", name: "canvas_apply_ops", arguments: "{}" };
    assert.equal((await delivery.serve(call))?.acknowledged, false);
    assert.equal((await delivery.serve(call))?.acknowledged, true);
    assert.equal(executions, 1);
    assert.equal(acknowledgements, 2);
});

test("a tab that cannot claim the browser lock stays an observer", async () => {
    let executions = 0;
    const delivery = createCanvasAgentToolDelivery({
        runId: "run-2",
        execute: async () => {
            executions += 1;
        },
        acknowledge: async () => undefined,
        isPending: async () => true,
        withLock: async () => undefined,
    });
    const outcome = await delivery.serve({ requestId: "request-2", name: "canvas_apply_ops", arguments: "{}" });
    assert.equal(outcome, undefined);
    assert.equal(executions, 0);
});

test("revalidates an approved server tool before mutation", async () => {
    const checks = [];
    const allowed = await canExecuteApprovedCanvasAgentTool(
        { requestId: "request-approved" },
        "run-approved",
        async (runId, requestId) => {
            checks.push([runId, requestId]);
            return false;
        },
    );
    assert.equal(allowed, false);
    assert.deepEqual(checks, [["run-approved", "request-approved"]]);
});

test("does not require a server pending record for completion fallback", async () => {
    let checks = 0;
    const allowed = await canExecuteApprovedCanvasAgentTool(
        { requestId: "completion:local-fallback" },
        "",
        async () => {
            checks += 1;
            return false;
        },
    );
    assert.equal(allowed, true);
    assert.equal(checks, 0);
});

test("waits across a paint boundary before a canvas write starts", async () => {
    const callbacks = [];
    let resolved = false;
    const pending = waitForCanvasAgentToolPaint((callback) => {
        callbacks.push(callback);
        return callbacks.length;
    }).then(() => {
        resolved = true;
    });
    assert.equal(callbacks.length, 1);
    callbacks.shift()(0);
    await Promise.resolve();
    assert.equal(resolved, false);
    assert.equal(callbacks.length, 1);
    callbacks.shift()(16);
    await pending;
    assert.equal(resolved, true);
});

function memoryStorage() {
    const rows = new Map();
    return { getItem: (key) => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: (key) => rows.delete(key) };
}

test("rebuilds delivery after successful execution and lost acknowledgement without repeating it", async () => {
    const storage = memoryStorage();
    let executions = 0;
    const call = { requestId: "request-persisted", name: "canvas_run_generation", arguments: "{}" };
    const options = { runId: "run-persisted", execute: async () => ({ task: ++executions }), isPending: async () => true };
    await createCanvasAgentToolDelivery({ ...options, journal: createCanvasAgentToolJournal(storage), acknowledge: async () => { throw new Error("lost response"); } }).serve(call);
    let received;
    const outcome = await createCanvasAgentToolDelivery({ ...options, journal: createCanvasAgentToolJournal(storage), acknowledge: async (_call, envelope) => { received = envelope; } }).serve(call);
    assert.equal(executions, 1);
    assert.deepEqual(received, { result: { task: 1 } });
    assert.equal(outcome.executed, false);
    assert.equal(outcome.acknowledged, true);
});

test("an observing executor cannot erase another executor's durable result", async () => {
    const storage = memoryStorage();
    const journal = createCanvasAgentToolJournal(storage);
    let executions = 0;
    const call = { requestId: "shared-request", name: "canvas_run_generation", arguments: "{}" };
    const options = { runId: "shared-run", journal, execute: async () => ({ task: ++executions }), isPending: async () => true };
    await createCanvasAgentToolDelivery({ ...options, acknowledge: async () => { throw new Error("ack lost"); } }).serve(call);
    await createCanvasAgentToolDelivery({ ...options, isPending: async () => false, acknowledge: async () => assert.fail("observer cannot acknowledge") }).serve(call);
    const recovered = await createCanvasAgentToolDelivery({ ...options, journal: createCanvasAgentToolJournal(storage), acknowledge: async () => undefined }).serve(call);
    assert.equal(executions, 1);
    assert.equal(recovered.executed, false);
    assert.equal(recovered.successful, true);
});

test("an observing executor cannot erase an uncertain execution marker", async () => {
    const storage = memoryStorage();
    const journal = createCanvasAgentToolJournal(storage);
    const call = { requestId: "uncertain-shared", name: "canvas_apply_ops", arguments: "{}" };
    journal.write("shared-run\0uncertain-shared", { state: "executing" });
    let executions = 0;
    let result;
    const options = { runId: "shared-run", journal, execute: async () => ++executions, acknowledge: async (_call, envelope) => { result = envelope; } };
    await createCanvasAgentToolDelivery({ ...options, isPending: async () => false }).serve(call);
    await createCanvasAgentToolDelivery({ ...options, journal: createCanvasAgentToolJournal(storage), isPending: async () => true }).serve(call);
    assert.equal(executions, 0);
    assert.match(result.error, /可能已执行/);
});

test("does not replay an uncertain mutation when the result could not be persisted", async () => {
    const storage = memoryStorage();
    const journal = createCanvasAgentToolJournal(storage);
    let executions = 0;
    const call = { requestId: "uncertain", name: "canvas_apply_ops", arguments: "{}" };
    const options = { runId: "run-uncertain", execute: async () => ++executions, isPending: async () => true };
    await assert.rejects(createCanvasAgentToolDelivery({ ...options, journal: { ...journal, write: (key, value) => { if (value.state === "completed") throw new Error("quota exceeded"); journal.write(key, value); } }, acknowledge: async () => assert.fail("must persist before acknowledging") }).serve(call), /quota/);
    let received;
    await createCanvasAgentToolDelivery({ ...options, journal: createCanvasAgentToolJournal(storage), acknowledge: async (_call, result) => { received = result; } }).serve(call);
    assert.equal(executions, 1);
    assert.match(received.error, /可能已执行/);
});

test("unavailable durable storage blocks the mutation", async () => {
    let executed = false;
    const journal = createCanvasAgentToolJournal({ ...memoryStorage(), setItem: () => { throw new Error("storage disabled"); } });
    const delivery = createCanvasAgentToolDelivery({ runId: "no-storage", journal, isPending: async () => true, execute: async () => { executed = true; }, acknowledge: async () => undefined });
    await assert.rejects(delivery.serve({ requestId: "r", name: "canvas_apply_ops", arguments: "{}" }), /storage disabled/);
    assert.equal(executed, false);
});

test("workflow retry identity is independent of startedAt and later runs", () => {
    const previous = { attemptId: 1, startedAt: "2026-09-07T00:00:00Z", status: "error", completed: 0, total: 1 };
    const retry = { ...previous, attemptId: 2, status: "success", completed: 1 };
    const record = { baselineAttemptId: 1, settled: true, finalState: retry };
    assert.equal(canvasAgentWorkflowStatus(record, retry).status, "succeeded");
    assert.equal(canvasAgentWorkflowStatus(record, { ...retry, attemptId: 3, status: "running", completed: 0 }).status, "succeeded");
    assert.equal(canvasAgentWorkflowStatus({ baselineAttemptId: 1, settled: true }, previous).status, "canceled");
    assert.equal(canvasAgentWorkflowStatus({ baselineAttemptId: 1, settled: false }, { ...retry, status: "running" }).status, "running");
});
