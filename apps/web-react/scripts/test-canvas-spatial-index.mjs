import assert from "node:assert/strict";
import test from "node:test";

import { CanvasSpatialIndex, canvasViewportQueryRect, pickLargestCanvasNodes, shouldRefreshCanvasRenderViewport } from "../src/canvas/lib/canvas/canvas-spatial-index.ts";

const node = (id, x, y, width = 100, height = 100) => ({ id, type: "image", title: id, position: { x, y }, width, height });

test("spatial index returns only intersecting nodes in visual z-order", () => {
    const index = new CanvasSpatialIndex([node("bottom", 0, 0), node("far", 1000, 1000), node("top", 20, 20)]);
    assert.deepEqual(index.queryRect({ left: 10, top: 10, right: 30, bottom: 30 }).map((item) => item.id), ["top", "bottom"]);
    assert.deepEqual(index.queryPoint(1050, 1050).map((item) => item.id), ["far"]);
});

test("spatial index supports negative coordinates and oversized groups", () => {
    const index = new CanvasSpatialIndex([node("negative", -500, -400), node("group", -10000, -10000, 20000, 20000)]);
    assert.deepEqual(index.queryPoint(-450, -350).map((item) => item.id), ["group", "negative"]);
    assert.deepEqual(index.queryPoint(9000, 9000).map((item) => item.id), ["group"]);
});

test("viewport query converts screen bounds and overscan into world coordinates", () => {
    assert.deepEqual(canvasViewportQueryRect({ x: 100, y: -50, k: 2 }, { width: 800, height: 600 }, 120), {
        left: -110,
        top: -35,
        right: 410,
        bottom: 385,
    });
});

test("render viewport refreshes only after meaningful pan or zoom movement", () => {
    const previous = { x: 100, y: 200, k: 1 };
    assert.equal(shouldRefreshCanvasRenderViewport(previous, { x: 150, y: 250, k: 1.05 }, 96, 0.08), false);
    assert.equal(shouldRefreshCanvasRenderViewport(previous, { x: 196, y: 200, k: 1 }, 96, 0.08), true);
    assert.equal(shouldRefreshCanvasRenderViewport(previous, { x: 100, y: 200, k: 1.08 }, 96, 0.08), true);
});

test("huge sparse selections fall back to a bounded node scan", () => {
    const index = new CanvasSpatialIndex([node("left", -1_000_000, 0), node("right", 1_000_000, 0)]);
    assert.deepEqual(index.queryRect({ left: -2_000_000, top: -100, right: 2_000_000, bottom: 200 }).map((item) => item.id), ["right", "left"]);
});

test("spatial lookup keeps a 10k-node point query bounded", () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => node(`n-${index}`, (index % 100) * 500, Math.floor(index / 100) * 500));
    const spatial = new CanvasSpatialIndex(nodes);
    const startedAt = performance.now();
    for (let index = 0; index < 1_000; index += 1) spatial.queryPoint(25_050, 25_050);
    const elapsed = performance.now() - startedAt;
    assert.equal(spatial.queryPoint(25_050, 25_050).length, 1);
    assert.ok(elapsed < 250, `1,000 indexed queries took ${elapsed.toFixed(1)}ms`);
});

test("min-heap selection keeps the largest nodes and their visual order", () => {
    const nodes = [node("small-a", 0, 0, 2, 2), node("large-a", 0, 0, 10, 10), node("small-b", 0, 0, 3, 3), node("large-b", 0, 0, 20, 20)];
    assert.deepEqual(pickLargestCanvasNodes(nodes, 2).map((item) => item.id), ["large-a", "large-b"]);
    assert.equal(pickLargestCanvasNodes(nodes, 10), nodes);
});
