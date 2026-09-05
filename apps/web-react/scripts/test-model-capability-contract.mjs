import assert from "node:assert/strict";
import test from "node:test";

import {
  IMAGE_QUALITIES,
  IMAGE_RESOLUTIONS,
  coerceImageModelSettings,
  getModelAutoAspectRatioCandidates,
  normalizeImageModelCapabilities,
} from "../src/legacy-modules/features/ai-shared/modelImageCapabilities.js";

test("explicit empty backend capabilities stay empty", () => {
  const capabilities = normalizeImageModelCapabilities({
    aspectRatios: ["auto", "16:9", "1:1"],
    qualities: [],
    resolutions: [],
  });
  assert.deepEqual(capabilities.aspectRatios, ["auto", "16:9", "1:1"]);
  assert.deepEqual(capabilities.qualities, []);
  assert.deepEqual(capabilities.resolutions, []);
  assert.equal(coerceImageModelSettings({ qualities: [] }, { quality: "high" }).quality, "");
});

test("explicit empty aspect ratios do not invent a selectable ratio", () => {
  const capabilities = normalizeImageModelCapabilities({
    aspectRatios: [],
    qualities: [],
    resolutions: [],
  });
  assert.deepEqual(capabilities.aspectRatios, []);
  assert.deepEqual(getModelAutoAspectRatioCandidates({ aspectRatios: [] }, ""), []);
});

test("missing legacy capabilities retain compatibility defaults", () => {
  const capabilities = normalizeImageModelCapabilities({});
  assert.deepEqual(capabilities.qualities, IMAGE_QUALITIES);
  assert.deepEqual(capabilities.resolutions, IMAGE_RESOLUTIONS);
});
