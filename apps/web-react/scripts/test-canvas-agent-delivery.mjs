import assert from "node:assert/strict";
import test from "node:test";

import { canExecuteApprovedCanvasAgentTool, createCanvasAgentToolDelivery, waitForCanvasAgentToolPaint } from "../src/canvas/lib/canvas/canvas-agent-tool-delivery.ts";

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
