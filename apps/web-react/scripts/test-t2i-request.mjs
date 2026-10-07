import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

// 技能提示词以 Vite 的 `?raw` 方式内联 Markdown；测试里按同样语义返回文本。
registerHooks({
  load(url, context, nextLoad) {
    const path = url.replace(/\?raw$/, "");
    if (!path.endsWith(".md")) return nextLoad(url, context);
    const text = readFileSync(fileURLToPath(path), "utf8");
    return { format: "module", source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
  },
});

const { buildT2iPayload, featureModels, normalizePublicModel } = await import("../src/features/text-to-image/t2iRequest.js");

const model = normalizePublicModel({
  id: "gpt-image-2",
  resolutions: ["1K", "2K"],
  qualities: ["low", "medium", "high"],
  aspectRatios: ["1:1", "16:9"],
  outputFormats: ["png", "webp"],
  moderationLevels: ["low"],
});

const batch = { sourceUrls: [], batchId: "b1", batchIndex: 1, batchSize: 2, batchCreatedAt: "2026-10-07T00:00:00.000Z" };

test("payload carries prompt, model and supported frame parameters", () => {
  const payload = buildT2iPayload({
    model, prompt: "  雨夜的猫  ", ratio: "16:9", resolution: "2K", quality: "high", expectedUnitPriceCents: 3,
  }, batch);
  assert.equal(payload.kind, "wallpaper-image-generation");
  assert.equal(payload.prompt, "雨夜的猫");
  assert.equal(payload.input.userPrompt, "雨夜的猫");
  assert.equal(payload.input.aspectRatio, "16:9");
  assert.equal(payload.input.resolutionScale, "2K");
  assert.equal(payload.input.quality, "high");
  assert.ok(payload.input.outputSize);
  assert.equal(payload.input.batchId, "b1");
  assert.equal(payload.input.batchIndex, 1);
  assert.equal(payload.input.batchSize, 2);
  assert.equal(payload.params.publicModelKey, "gpt-image-2");
  assert.equal(payload.params.executionMode, "server");
  assert.equal(payload.expectedUnitPriceCents, 3);
  assert.equal(payload.units, 1);
});

test("unsupported ratio and format are dropped instead of sent", () => {
  const payload = buildT2iPayload({
    model, prompt: "x", ratio: "21:9", resolution: "1K", quality: "medium", outputFormat: "jpeg", moderation: "auto",
  }, batch);
  assert.equal(payload.input.aspectRatio, undefined);
  assert.equal(payload.input.outputSize, undefined);
  assert.equal(payload.input.outputFormat, undefined);
  assert.equal(payload.input.moderationLevel, undefined);
});

test("reference images switch to edit and background removal names its model", () => {
  const payload = buildT2iPayload({
    model, prompt: "x", ratio: "1:1", resolution: "1K", quality: "medium", autoRemove: true, backgroundRemovalModelId: "rmbg",
  }, { ...batch, sourceUrls: ["/api/v1/files/a.png"] });
  assert.equal(payload.kind, "wallpaper-image-edit");
  assert.equal(payload.input.sourceUrl, "/api/v1/files/a.png");
  assert.equal(payload.input.autoBackgroundRemovalModelKey, "rmbg");
});

test("feature models read the public catalog from runtime config", () => {
  const models = featureModels({ features: { "ai.wallpaperGeneration": { config: { publicModels: [{ id: "a" }, {}] } } } });
  assert.deepEqual(models.map((item) => item.id), ["a"]);
});
