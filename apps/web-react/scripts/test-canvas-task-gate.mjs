import assert from "node:assert/strict";
import test from "node:test";

import { createCanvasTaskGate, normalizeCanvasTaskConcurrency } from "../src/canvas/lib/canvas/canvas-task-gate.ts";
import { clampCanvasBatchCount, normalizeCanvasBatchMaxCount } from "../src/canvas/lib/canvas/canvas-batch-limit.ts";

const abortError = () => new DOMException("aborted", "AbortError");
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("canvas task gate reserves image units up to the user's quota", async () => {
    const gate = createCanvasTaskGate({ limit: 16, abortError });
    const held = [];
    for (let i = 0; i < 4; i += 1) held.push(await gate.acquire(4));
    assert.deepEqual(gate.snapshot(), { limit: 16, activeUnits: 16, waiting: 0 });
    let fifthStarted = false;
    const fifth = gate.acquire(1).then((units) => { fifthStarted = true; return units; });
    await flush();
    assert.equal(fifthStarted, false, "a full quota must queue further tasks");
    gate.release(held[0]);
    assert.equal(await fifth, 1);
});

test("a single task larger than the quota still runs alone", async () => {
    const gate = createCanvasTaskGate({ limit: 4, abortError });
    assert.equal(await gate.acquire(8), 4);
    assert.equal(gate.snapshot().activeUnits, 4);
});

test("waiters are released in order so large tasks are not starved", async () => {
    const gate = createCanvasTaskGate({ limit: 4, abortError });
    const first = await gate.acquire(3);
    const order = [];
    const big = gate.acquire(4).then(() => order.push("big"));
    const small = gate.acquire(1).then(() => order.push("small"));
    await flush();
    assert.deepEqual(order, [], "a small task must not jump ahead of the queued large task");
    gate.release(first);
    await big;
    await flush();
    assert.deepEqual(order, ["big"]);
    gate.release(4);
    await small;
    assert.deepEqual(order, ["big", "small"]);
});

test("raising the quota wakes queued tasks and aborted waiters leave the queue", async () => {
    const gate = createCanvasTaskGate({ limit: 2, abortError });
    await gate.acquire(2);
    const controller = new AbortController();
    const aborted = gate.acquire(1, controller.signal);
    const queued = gate.acquire(1);
    controller.abort();
    await assert.rejects(aborted, { name: "AbortError" });
    gate.setLimit(3);
    assert.equal(await queued, 1);
    assert.equal(gate.snapshot().waiting, 0);
});

test("limits are normalized to safe ranges", () => {
    assert.equal(normalizeCanvasTaskConcurrency(undefined), 6);
    assert.equal(normalizeCanvasTaskConcurrency(0), 6);
    assert.equal(normalizeCanvasTaskConcurrency(16), 16);
    assert.equal(normalizeCanvasTaskConcurrency(5000), 100);
    assert.equal(normalizeCanvasBatchMaxCount(undefined), 100);
    assert.equal(normalizeCanvasBatchMaxCount(20), 20);
    assert.equal(normalizeCanvasBatchMaxCount(999), 100);
    assert.equal(clampCanvasBatchCount(50, 4, 20), 20);
    assert.equal(clampCanvasBatchCount("", 4, 20), 4);
    assert.equal(clampCanvasBatchCount(3, 4, 20), 3);
});
