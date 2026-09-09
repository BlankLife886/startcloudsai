import assert from "node:assert/strict";
import test from "node:test";

class TestCustomEvent extends Event {
    constructor(type, options = {}) {
        super(type);
        this.detail = options.detail;
    }
}

class TestBroadcastChannel extends EventTarget {
    static instances = [];

    constructor(name) {
        super();
        this.name = name;
        this.messages = [];
        TestBroadcastChannel.instances.push(this);
    }

    postMessage(value) {
        this.messages.push(value);
    }
}

globalThis.CustomEvent = TestCustomEvent;
globalThis.BroadcastChannel = TestBroadcastChannel;
globalThis.window = new EventTarget();
window.location = { origin: "http://localhost" };
window.setTimeout = globalThis.setTimeout.bind(globalThis);
window.clearTimeout = globalThis.clearTimeout.bind(globalThis);

const { publishWalletSnapshot, WALLET_UPDATED_EVENT } = await import("../src/legacy-modules/services/walletSync.js");
const { createTask } = await import("../src/legacy-modules/services/tasksApi.js");

test("publishes wallet snapshots locally and across browser tabs", () => {
    const received = [];
    window.addEventListener(WALLET_UPDATED_EVENT, (event) => received.push(event.detail));
    const local = { availableCents: 88, balanceCents: 100 };
    publishWalletSnapshot(local);
    assert.deepEqual(received, [local]);
    assert.deepEqual(TestBroadcastChannel.instances[0].messages, [local]);

    const remote = { availableCents: 55, balanceCents: 70 };
    // BroadcastChannel message payload lives on event.data in browsers.
    const message = new Event("message");
    Object.defineProperty(message, "data", { value: remote });
    TestBroadcastChannel.instances[0].dispatchEvent(message);
    assert.deepEqual(received, [local, remote]);
});

test("refreshes and publishes the authoritative wallet after task submission", async () => {
    const received = [];
    let walletCalls = 0;
    window.addEventListener(WALLET_UPDATED_EVENT, (event) => received.push(event.detail));
    globalThis.fetch = async (url, options = {}) => {
        const parsed = new URL(String(url), "http://localhost");
        if (parsed.pathname === "/api/v1/tasks") {
            assert.equal(options.method, "POST");
            return new Response(JSON.stringify({ success: true, data: { task: { id: "task-1", status: "queued" } } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        if (parsed.pathname === "/api/v1/me/wallet") {
            walletCalls += 1;
            return new Response(JSON.stringify({ success: true, data: { availableCents: 42, balanceCents: 50, frozenCents: 8 } }), { status: 200, headers: { "content-type": "application/json" } });
        }
        throw new Error(`unexpected request: ${parsed.pathname}`);
    };

    await createTask({ type: "t2i", prompt: "wallet refresh", idempotencyKey: "wallet-refresh" });
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(walletCalls, 1);
    assert.deepEqual(received.at(-1), { availableCents: 42, balanceCents: 50, frozenCents: 8 });
});
