import assert from "node:assert/strict";
import test from "node:test";

import { positionCanvasFloatingLayer } from "../src/canvas/lib/canvas/canvas-floating-geometry.ts";

const bounds = { left: 0, top: 64, right: 1280, bottom: 720 };

test("keeps an editor at 600 screen pixels at low and high canvas zoom", () => {
    for (const scale of [0.05, 0.25, 1, 2, 5]) {
        const anchor = { left: 640 - 160 * scale, right: 640 + 160 * scale, top: 280, bottom: 280 + 120 * scale };
        const result = positionCanvasFloatingLayer({ anchor, bounds, width: 600, height: 200 });
        assert.equal(result.left, 340);
        assert.ok(result.top >= 76);
        assert.ok(result.top + 200 <= 708);
    }
});

test("flips a menu above a click at the bottom right edge", () => {
    const result = positionCanvasFloatingLayer({ anchor: { left: 1278, right: 1278, top: 710, bottom: 710 }, bounds, width: 308, height: 420, placement: "bottom-start", gap: 0 });
    assert.equal(result.left, 960);
    assert.equal(result.top, 288);
    assert.equal(result.side, "top");
});

test("moves a top toolbar below a node near the top edge", () => {
    const result = positionCanvasFloatingLayer({ anchor: { left: 500, right: 820, top: 80, bottom: 240 }, bounds, width: 460, height: 60, placement: "top", gap: 14 });
    assert.equal(result.left, 430);
    assert.equal(result.top, 254);
    assert.equal(result.side, "bottom");
});

test("caps oversized editors to the canvas viewport and keeps their scroll area reachable", () => {
    const result = positionCanvasFloatingLayer({ anchor: { left: 500, right: 820, top: 400, bottom: 650 }, bounds, width: 1800, height: 1300 });
    assert.equal(result.maxWidth, 1256);
    assert.equal(result.maxHeight, 632);
    assert.equal(result.left, 12);
    assert.equal(result.top, 76);
});

test("keeps a flipped toolbar from covering its node editor", () => {
    const editor = { left: 340, right: 940, top: 256, bottom: 456 };
    const result = positionCanvasFloatingLayer({ anchor: { left: 480, right: 800, top: 80, bottom: 240 }, bounds, width: 460, height: 60, placement: "top", gap: 14, avoid: editor });
    assert.equal(result.top, 182);
    assert.ok(result.top + 60 < editor.top);
});

test("keeps controls visible when their selected anchor is partly or fully offscreen", () => {
    for (const x of [-1800, -50, 640, 1250, 2500]) {
        for (const y of [-1000, 60, 400, 700, 1800]) {
            for (const placement of ["top", "bottom", "bottom-start"]) {
                const result = positionCanvasFloatingLayer({ anchor: { left: x, right: x + 320, top: y, bottom: y + 220 }, bounds, width: 600, height: 240, placement });
                assert.ok(result.left >= 12);
                assert.ok(result.top >= 76);
                assert.ok(result.left + 600 <= 1268);
                assert.ok(result.top + 240 <= 708);
            }
        }
    }
});

test("does not create negative limits in a temporarily collapsed canvas", () => {
    const result = positionCanvasFloatingLayer({ anchor: { left: 0, right: 0, top: 0, bottom: 0 }, bounds: { left: 0, right: 10, top: 0, bottom: 8 }, width: 308, height: 420 });
    assert.deepEqual({ left: result.left, top: result.top, maxWidth: result.maxWidth, maxHeight: result.maxHeight }, { left: 5, top: 4, maxWidth: 0, maxHeight: 0 });
});
