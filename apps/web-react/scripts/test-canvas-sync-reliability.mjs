import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";

import { mergeCanvasProjectDocuments, normalizeCanvasGraphSyncState, rebaseCanvasProjectGraph, trackCanvasProjectGraphChanges } from "../src/canvas/lib/canvas/canvas-project-sync.ts";
import { createLocalForageStorage } from "../src/canvas/lib/localforage-storage.ts";

const node = (id, metadata = {}) => ({ id, type: "image", title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata });
const edge = (fromNodeId, toNodeId, id = `${fromNodeId}-${toNodeId}`) => ({ id, fromNodeId, toNodeId });
const project = () => ({
    id: "audit-project", title: "并发编辑", revision: 4,
    createdAt: "2026-09-10T00:00:00.000Z", updatedAt: "2026-09-10T00:00:00.000Z",
    nodes: [node("a"), node("b"), node("output")], connections: [edge("a", "b"), edge("b", "output")],
    chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 }, workflowRun: null,
});
const edit = (before, patch) => trackCanvasProjectGraphChanges(before, { ...before, ...patch });
const ids = (document) => document.nodes.map((item) => item.id).sort();
const endpoints = (document) => document.connections.map((item) => `${item.fromNodeId}:${item.toNodeId}`).sort();
const membershipKey = (from, to) => JSON.stringify([from, to]);

test("a local deletion survives a conflict while new remote nodes and finished outputs survive", () => {
    const base = project();
    const local = edit(base, { nodes: base.nodes.filter((item) => item.id !== "a") });
    const remote = edit(base, {
        revision: 5,
        nodes: base.nodes.map((item) => item.id === "output" ? { ...item, metadata: { status: "success", storageKey: "output/new.png", generationCompletedAt: "2026-09-10T01:00:00Z" } } : item).concat(node("remote-new")),
        connections: [...base.connections, edge("b", "remote-new")],
    });
    const untouchedInputs = JSON.stringify([local, remote]);
    const merged = mergeCanvasProjectDocuments(local, remote);
    assert.deepEqual(ids(merged), ["b", "output", "remote-new"]);
    assert.deepEqual(endpoints(merged), ["b:output", "b:remote-new"]);
    assert.equal(merged.nodes.find((item) => item.id === "output").metadata.storageKey, "output/new.png");
    assert.equal(merged.revision, 5);
    assert.equal(JSON.stringify([local, remote]), untouchedInputs);
});

test("newer storyboard output keeps shot provenance across a cloud conflict", () => {
    const base = project();
    const remote = edit(base, {
        revision: 5,
        nodes: base.nodes.map((item) => item.id === "output" ? {
            ...item,
            metadata: {
                status: "success",
                storageKey: "tasks/storyboard-shot.png",
                generationCompletedAt: "2026-09-10T01:00:00Z",
                storyboardId: "storyboard-1",
                storyboardSceneId: "shot-2",
                storyboardIndex: 2,
                storyboardTitle: "雨后车站",
                storyboardShotType: "wide",
                storyboardStatus: "succeeded",
                storyboardSourceNodeId: "script",
                storyboardContinuity: "红伞与服装保持一致",
                storyboardPrompt: "电影级分镜画面，雨后车站",
            },
        } : item),
    });
    const merged = mergeCanvasProjectDocuments(base, remote);
    const output = merged.nodes.find((item) => item.id === "output");
    assert.equal(output.metadata.storyboardId, "storyboard-1");
    assert.equal(output.metadata.storyboardSceneId, "shot-2");
    assert.equal(output.metadata.storyboardIndex, 2);
    assert.equal(output.metadata.storyboardPrompt, "电影级分镜画面，雨后车站");
    assert.equal(output.metadata.storyboardStatus, "succeeded");
});

test("a remote deletion beats an older tab's unrelated edit and preserves its genuinely new node", () => {
    const base = project();
    const remote = edit(base, { revision: 5, nodes: base.nodes.filter((item) => item.id !== "a") });
    const local = edit(base, { nodes: base.nodes.map((item) => item.id === "b" ? { ...item, position: { x: 240, y: 80 } } : item).concat(node("local-new")) });
    const merged = mergeCanvasProjectDocuments(local, remote);
    assert.deepEqual(ids(merged), ["b", "local-new", "output"]);
    assert.deepEqual(merged.nodes.find((item) => item.id === "b").position, { x: 240, y: 80 });
    assert.equal(merged.connections.some((item) => item.fromNodeId === "a"), false);
    assert.deepEqual(ids(mergeCanvasProjectDocuments(remote, local)), ids(merged));
});

test("deleting an edge remains effective when another tab has the same endpoints under a different id", () => {
    const base = project();
    const local = edit(base, { connections: base.connections.filter((item) => item.fromNodeId !== "a") });
    const remote = { ...base, connections: [edge("a", "b", "different-id"), edge("b", "output")] };
    const merged = mergeCanvasProjectDocuments(local, remote);
    assert.deepEqual(ids(merged), ids(base));
    assert.deepEqual(endpoints(merged), ["b:output"]);
    assert.equal(merged.graphSync.connections[membershipKey("a", "b")].deleted, true);
});

test("explicit undo restores nodes and edges and a later delete still wins", () => {
    const base = project();
    const deleted = edit(base, { nodes: base.nodes.filter((item) => item.id !== "a") });
    const restored = edit(deleted, { nodes: base.nodes, connections: base.connections });
    const merged = mergeCanvasProjectDocuments(restored, deleted);
    assert.deepEqual(ids(merged), ids(base));
    assert.deepEqual(endpoints(merged), endpoints(base));
    assert.ok(restored.graphSync.nodes.a.generation > deleted.graphSync.nodes.a.generation);
    assert.equal(restored.graphSync.nodes.a.deleted, false);
    assert.deepEqual(ids(mergeCanvasProjectDocuments(deleted, restored)), ids(base));
    const deletedAgain = edit(merged, { nodes: merged.nodes.filter((item) => item.id !== "a") });
    assert.deepEqual(ids(mergeCanvasProjectDocuments(restored, deletedAgain)), ["b", "output"]);
});

test("restoration never inherits obsolete output from the previous node lifetime", () => {
    const base = project();
    base.nodes[0].metadata = { status: "success", storageKey: "obsolete.png", generationCompletedAt: "2099-01-01" };
    const deleted = edit(base, { nodes: base.nodes.filter((item) => item.id !== "a") });
    const restored = edit(deleted, { nodes: [...deleted.nodes, node("a", { status: "success", storageKey: "restored.png" })] });
    const merged = mergeCanvasProjectDocuments(base, restored);
    assert.equal(merged.nodes.find((item) => item.id === "a").metadata.storageKey, "restored.png");
});

test("ordinary edits do not create membership revisions or cancel a known deletion", () => {
    const base = project();
    const deleted = edit(base, { nodes: base.nodes.filter((item) => item.id !== "a") });
    const changed = edit(deleted, { nodes: deleted.nodes.map((item) => ({ ...item, title: `编辑 ${item.id}` })) });
    assert.deepEqual(changed.graphSync, deleted.graphSync);
    assert.deepEqual(ids(mergeCanvasProjectDocuments(changed, base)), ["b", "output"]);
});

test("deletion wins a same-generation conflict in both merge directions", () => {
    const local = project();
    local.graphSync = { version: 1, nodes: { a: { generation: 2, deleted: false } }, connections: {} };
    const remote = { ...project(), graphSync: { version: 1, nodes: { a: { generation: 2, deleted: true } }, connections: {} } };
    assert.equal(ids(mergeCanvasProjectDocuments(local, remote)).includes("a"), false);
    assert.equal(ids(mergeCanvasProjectDocuments(remote, local)).includes("a"), false);
});

test("legacy v3 documents keep both sides' additions without inventing deletions", () => {
    const local = project();
    const remote = { ...project(), nodes: [node("remote-only")] };
    assert.deepEqual(ids(mergeCanvasProjectDocuments(local, remote)), ["a", "b", "output", "remote-only"]);
    assert.equal(normalizeCanvasGraphSyncState(undefined), undefined);
    assert.deepEqual(normalizeCanvasGraphSyncState({ version: 1, nodes: { a: { generation: -1, deleted: true }, b: { generation: 2, deleted: true } }, connections: [] }), {
        version: 1, nodes: { b: { generation: 2, deleted: true } }, connections: {},
    });
});

test("an unchanged page adopts the cloud merge without treating its old full graph as a restore", () => {
    const before = project();
    const remote = edit(before, { nodes: before.nodes.filter((item) => item.id !== "a").concat(node("remote-new")) });
    const merged = mergeCanvasProjectDocuments(before, remote);
    assert.equal(rebaseCanvasProjectGraph(before, before, merged), merged);
    const equivalentPage = { nodes: before.nodes.map((item) => ({ ...item })), connections: [...before.connections] };
    assert.deepEqual(ids(rebaseCanvasProjectGraph(before, equivalentPage, merged)), ["b", "output", "remote-new"]);
});

test("page edits not yet in the store survive while remote deletions and additions are applied", () => {
    const before = project();
    const remote = edit(before, { nodes: before.nodes.filter((item) => item.id !== "a").concat(node("remote-new")), connections: [...before.connections, edge("b", "remote-new")] });
    const merged = mergeCanvasProjectDocuments(before, remote);
    const page = {
        nodes: before.nodes.map((item) => item.id === "b" ? { ...item, position: { x: 360, y: 100 } } : item).concat(node("local-new")),
        connections: [...before.connections, edge("b", "local-new")],
    };
    const rebased = rebaseCanvasProjectGraph(before, page, merged);
    assert.deepEqual(ids(rebased), ["b", "local-new", "output", "remote-new"]);
    assert.deepEqual(rebased.nodes.find((item) => item.id === "b").position, { x: 360, y: 100 });
    assert.deepEqual(endpoints(rebased), ["b:local-new", "b:output", "b:remote-new"]);
});

test("a pending page deletion wins over the merged old node without dropping remote additions", () => {
    const before = project();
    const merged = mergeCanvasProjectDocuments(before, edit(before, { nodes: [...before.nodes, node("remote-new")] }));
    const page = { nodes: before.nodes.filter((item) => item.id !== "a"), connections: before.connections };
    assert.deepEqual(ids(rebaseCanvasProjectGraph(before, page, merged)), ["b", "output", "remote-new"]);
});

function storageFixture() {
    const primaryData = new Map();
    const fallbackData = new Map();
    const state = { primaryFails: false, fallbackFails: false };
    const primary = {
        async getItem(name) { if (state.primaryFails) throw new Error("IDB unavailable"); return primaryData.get(name) ?? null; },
        async setItem(name, value) { if (state.primaryFails) throw new Error("IDB quota"); primaryData.set(name, value); },
    };
    const fallback = {
        getItem(name) { if (state.fallbackFails) throw new Error("fallback unavailable"); return fallbackData.get(name) ?? null; },
        setItem(name, value) { if (state.fallbackFails) throw new Error("fallback quota"); fallbackData.set(name, value); },
        removeItem(name) { if (state.fallbackFails) throw new Error("fallback unavailable"); fallbackData.delete(name); },
    };
    const options = { primary, fallback: () => fallback, writer: "test-writer" };
    return { state, primaryData, fallbackData, primary, fallback, options, storage: createLocalForageStorage(options) };
}

test("StateStorage reads legacy persisted JSON and keeps the exact string contract", async () => {
    const fixture = storageFixture();
    const value = JSON.stringify({ state: { config: { key: "原有配置" } }, version: 3 });
    fixture.primaryData.set("config", value);
    assert.equal(await fixture.storage.getItem("config"), value);
    await fixture.storage.setItem("config", value);
    assert.equal(await fixture.storage.getItem("config"), value);
    assert.notEqual(fixture.primaryData.get("config"), value, "the envelope stays private to the storage backend");
});

test("a newer fallback is recovered when IDB returns with an older copy", async () => {
    const fixture = storageFixture();
    await fixture.storage.setItem("canvas", "old");
    fixture.state.primaryFails = true;
    await fixture.storage.setItem("canvas", "new-unsynced-edit");
    fixture.state.primaryFails = false;
    const reloaded = createLocalForageStorage(fixture.options);
    assert.equal(await reloaded.getItem("canvas"), "new-unsynced-edit");
    assert.equal(JSON.parse(fixture.primaryData.get("canvas")).value, "new-unsynced-edit");
    assert.equal(fixture.fallbackData.has("canvas"), false);
});

test("legacy unversioned fallback is preserved and migrated rather than hidden by old IDB", async () => {
    const fixture = storageFixture();
    fixture.primaryData.set("canvas", '{"state":"old"}');
    fixture.fallbackData.set("canvas", '{"state":"new"}');
    assert.equal(await fixture.storage.getItem("canvas"), '{"state":"new"}');
    assert.equal(JSON.parse(fixture.primaryData.get("canvas")).value, '{"state":"new"}');
});

test("fallback-only data remains readable while primary storage is unavailable", async () => {
    const fixture = storageFixture();
    fixture.state.primaryFails = true;
    await fixture.storage.setItem("assets", "fallback-assets");
    assert.equal(await fixture.storage.getItem("assets"), "fallback-assets");
    assert.equal(fixture.fallbackData.has("assets"), true);
});

test("both backends failing rejects the write so flush cannot falsely report success", async () => {
    const fixture = storageFixture();
    fixture.state.primaryFails = fixture.state.fallbackFails = true;
    await assert.rejects(fixture.storage.setItem("canvas", "unsaved"), /本地保存失败/);
    fixture.state.primaryFails = fixture.state.fallbackFails = false;
    await fixture.storage.setItem("canvas", "retry-saved");
    assert.equal(await fixture.storage.getItem("canvas"), "retry-saved");
});

test("a slow first save cannot overwrite a later save and reads wait for pending writes", async () => {
    const fixture = storageFixture();
    let releaseFirst;
    const blocked = new Promise((resolve) => { releaseFirst = resolve; });
    const calls = [];
    const originalSet = fixture.primary.setItem;
    fixture.primary.setItem = async (name, encoded) => {
        const value = JSON.parse(encoded).value;
        calls.push(value);
        if (value === "first") await blocked;
        await originalSet(name, encoded);
    };
    const first = fixture.storage.setItem("canvas", "first");
    const second = fixture.storage.setItem("canvas", "second");
    const read = fixture.storage.getItem("canvas");
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(calls, ["first", "second"]);
    assert.equal(await read, "second");
});

test("separate storage clients share the supplied browser lock across read/write cycles", async () => {
    const fixture = storageFixture();
    let chain = Promise.resolve();
    let active = 0;
    let maxActive = 0;
    const withLock = (_name, task) => {
        const next = chain.then(async () => {
            maxActive = Math.max(maxActive, ++active);
            try { return await task(); } finally { active -= 1; }
        });
        chain = next.catch(() => undefined);
        return next;
    };
    const first = createLocalForageStorage({ ...fixture.options, writer: "tab-a", withLock });
    const second = createLocalForageStorage({ ...fixture.options, writer: "tab-b", withLock });
    await Promise.all([first.setItem("canvas", "first-tab"), second.setItem("canvas", "second-tab")]);
    assert.equal(await first.getItem("canvas"), "second-tab");
    assert.equal(maxActive, 1);
});

test("removing a key during an IDB outage cannot resurrect its old primary value on recovery", async () => {
    const fixture = storageFixture();
    await fixture.storage.setItem("canvas", "before-delete");
    fixture.state.primaryFails = true;
    await fixture.storage.removeItem("canvas");
    assert.equal(await fixture.storage.getItem("canvas"), null);
    fixture.state.primaryFails = false;
    assert.equal(await createLocalForageStorage(fixture.options).getItem("canvas"), null);
});

test("a newer primary deletion outranks stale fallback even when fallback cleanup fails", async () => {
    const fixture = storageFixture();
    fixture.state.primaryFails = true;
    await fixture.storage.setItem("canvas", "old-fallback");
    fixture.state.primaryFails = false;
    fixture.state.fallbackFails = true;
    await fixture.storage.removeItem("canvas");
    fixture.state.fallbackFails = false;
    assert.equal(await fixture.storage.getItem("canvas"), null);
});

const server = await createServer({ server: { middlewareMode: true, watch: null }, appType: "custom", logLevel: "silent" });
after(() => server.close());
const { canvasProjectDocument, canvasProjectFromResponse } = await server.ssrLoadModule("/src/canvas/services/canvas-cloud-repository.ts");

test("cloud v3 serialization preserves deletions and restorations and accepts old v3 documents", () => {
    const base = project();
    const deleted = edit(base, { nodes: base.nodes.filter((item) => item.id !== "a") });
    const encodeResponse = (source) => JSON.parse(JSON.stringify({ ...source, document: canvasProjectDocument(source) }));
    const decoded = canvasProjectFromResponse(encodeResponse(deleted));
    assert.deepEqual(decoded.graphSync, deleted.graphSync);
    assert.equal(ids(mergeCanvasProjectDocuments(base, decoded)).includes("a"), false);
    const restored = edit(decoded, { nodes: base.nodes, connections: base.connections });
    assert.deepEqual(canvasProjectFromResponse(encodeResponse(restored)).graphSync, restored.graphSync);
    assert.equal(canvasProjectDocument(deleted).version, 3);
    const old = canvasProjectFromResponse(encodeResponse(base));
    assert.equal(old.graphSync, undefined);
    assert.deepEqual(ids(old), ids(base));
});

test("the real canvas store records deletion and undo intent without page-level fields", async () => {
    const { useCanvasStore, flushCanvasPersistence } = await server.ssrLoadModule("/src/canvas/stores/canvas/use-canvas-store.ts");
    const base = project();
    useCanvasStore.getState().replaceProjects([base]);
    useCanvasStore.getState().updateProject(base.id, { nodes: base.nodes.filter((item) => item.id !== "a") });
    const deleted = useCanvasStore.getState().openProject(base.id);
    assert.equal(deleted.graphSync.nodes.a.deleted, true);
    assert.deepEqual(endpoints(deleted), ["b:output"]);
    useCanvasStore.getState().updateProject(base.id, { nodes: base.nodes, connections: base.connections });
    const restored = useCanvasStore.getState().openProject(base.id);
    assert.equal(restored.graphSync.nodes.a.deleted, false);
    assert.ok(restored.graphSync.nodes.a.generation > deleted.graphSync.nodes.a.generation);
    await flushCanvasPersistence();
});

test("a cloud revision conflict publishes its before/after graph after the store is updated", async () => {
    const { useCanvasStore, prepareCanvasCloudSync, disconnectCanvasCloudSync, subscribeCanvasProjectMerge, flushCanvasPersistence } = await server.ssrLoadModule("/src/canvas/stores/canvas/use-canvas-store.ts");
    const before = { ...project(), pendingSync: true };
    const remote = edit(before, { revision: 5, nodes: before.nodes.filter((item) => item.id !== "a").concat(node("remote-new")) });
    useCanvasStore.getState().replaceProjects([before]);
    const originalFetch = globalThis.fetch;
    const response = (data, status = 200) => new Response(JSON.stringify(status === 200 ? { success: true, data } : { success: false, code: "revision_conflict", error: "conflict" }), { status, headers: { "Content-Type": "application/json" } });
    let writes = 0;
    globalThis.fetch = async (url, init = {}) => {
        if (init.method === "PATCH") {
            writes += 1;
            if (writes === 1) return response(null, 409);
            const body = JSON.parse(init.body);
            assert.equal(body.document.graphSync.nodes.a.deleted, true);
            return response({ ...remote, revision: 6, document: body.document });
        }
        if (String(url).endsWith("/canvas-projects")) return response({ items: [before] });
        return response({ ...remote, document: canvasProjectDocument(remote) });
    };
    let timer;
    let unsubscribe = () => {};
    try {
        const event = new Promise((resolve, reject) => {
            timer = setTimeout(() => reject(new Error("cloud merge notification missing")), 2000);
            unsubscribe = subscribeCanvasProjectMerge((merge) => {
                assert.equal(useCanvasStore.getState().openProject(before.id), merge.after);
                resolve(merge);
            });
        });
        await prepareCanvasCloudSync("audit-user");
        const merge = await event;
        assert.equal(merge.before, before);
        assert.deepEqual(ids(merge.after), ["b", "output", "remote-new"]);
        assert.equal(writes, 2);
    } finally {
        clearTimeout(timer);
        unsubscribe();
        disconnectCanvasCloudSync();
        await flushCanvasPersistence();
        globalThis.fetch = originalFetch;
    }
});
