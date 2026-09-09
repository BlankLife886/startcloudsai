import assert from "node:assert/strict";
import test from "node:test";

import {
  clampPreviewOffsets,
  clampZoom,
  getEffectiveBounds,
  getVisibleSourceRect,
  getZoomOffsetsAroundPoint,
} from "../src/components/common/usePreviewViewport.js";

const metrics = {
  naturalWidth: 1600,
  naturalHeight: 900,
  containerWidth: 1000,
  containerHeight: 800,
  baseScale: 0.625,
  baseDisplayWidth: 1000,
  baseDisplayHeight: 562.5,
};

test("preview zoom keeps the historical 1x to 5x limits", () => {
  assert.equal(clampZoom(0.25), 1);
  assert.equal(clampZoom(2.4), 2.4);
  assert.equal(clampZoom(8), 5);
});

test("preview pan bounds use the contained image dimensions", () => {
  assert.deepEqual(getEffectiveBounds(metrics, 2, 0), {
    maxOffsetX: 500,
    maxOffsetY: 162.5,
  });
  assert.deepEqual(
    clampPreviewOffsets(900, -400, { metrics, zoom: 2, rotation: 0 }),
    { x: 500, y: -162.5 },
  );
});

test("quarter-turn rotation swaps effective pan dimensions", () => {
  assert.deepEqual(getEffectiveBounds(metrics, 2, 90), {
    maxOffsetX: 62.5,
    maxOffsetY: 600,
  });
});

test("wheel zoom preserves the source point beneath the pointer", () => {
  const offsets = getZoomOffsetsAroundPoint({
    previousZoom: 1,
    nextZoom: 2,
    offsetX: 0,
    offsetY: 0,
    containerRect: { left: 0, top: 0, width: 1000, height: 800 },
    point: { clientX: 750, clientY: 300 },
  });
  assert.deepEqual(offsets, { x: -250, y: 100 });
});

test("minimap source rectangle follows clamped pan offsets", () => {
  const rect = getVisibleSourceRect(metrics, 2, 500, -162.5);
  assert.equal(rect.visibleSourceWidth, 800);
  assert.equal(rect.visibleSourceHeight, 640);
  assert.equal(rect.sourceLeft, 0);
  assert.equal(rect.sourceTop, 260);
});
