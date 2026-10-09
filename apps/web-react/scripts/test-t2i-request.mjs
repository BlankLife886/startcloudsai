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

const { modelPointPriceRange, resolveModelTierPointPricing } = await import("../src/legacy-modules/features/ai-shared/modelPointPricing.js");

test("tiered models price by resolution and quality", () => {
  const tiered = {
    pricePoints: 10, resolutions: ["1K", "4K"], defaultQuality: "medium",
    imagePricing: {
      "1K": { low: { priceCents: 5, discountPriceCents: null }, medium: { priceCents: 10, discountPriceCents: 8 } },
      "4K": { low: { priceCents: 40, discountPriceCents: null }, medium: { priceCents: 60, discountPriceCents: null } },
    },
  };
  assert.equal(resolveModelTierPointPricing(tiered, { resolution: "4K", quality: "low" }).effective, 40);
  const discounted = resolveModelTierPointPricing(tiered, { resolution: "1K" });
  assert.equal(discounted.effective, 8);
  assert.equal(discounted.standard, 10);
  assert.equal(discounted.hasDiscount, true);
  assert.deepEqual(modelPointPriceRange(tiered), { min: 5, max: 60 });
  assert.equal(modelPointPriceRange({ pricePoints: 10 }), null);
  assert.equal(resolveModelTierPointPricing({ pricePoints: 12 }, { resolution: "4K", quality: "high" }).effective, 12);
});

test("a model's own prompt limit wins over the global limit", async () => {
  const { modelPromptMaxChars } = await import("../src/features/text-to-image/t2iRequest.js");
  assert.equal(modelPromptMaxChars({ promptMaxChars: 800 }, 8000), 800);
  assert.equal(modelPromptMaxChars({ promptMaxChars: 20000 }, 8000), 20000);
  assert.equal(modelPromptMaxChars({ promptMaxChars: 0 }, 8000), 8000);
  assert.equal(modelPromptMaxChars(null, 8000), 8000);
});

test("a model with skills disabled gets no skill prompt", async () => {
  const { buildT2iPayload } = await import("../src/features/text-to-image/t2iRequest.js");
  const model = { id: "qwen", resolutions: ["2K"], aspectRatios: ["1:1"], aspectRatiosByResolution: { "2K": ["1:1"] }, qualities: [], skillsDisabled: true };
  const payload = buildT2iPayload(
    { model, prompt: "一只猫", ratio: "1:1", resolution: "2K", superResolutionEnabled: true, selectedSkillIds: ["any"] },
    { sourceUrls: [], batchId: "b", batchIndex: 0, batchSize: 1, batchCreatedAt: 0 },
  );
  assert.equal(payload.prompt, "一只猫");
  assert.deepEqual(payload.input.skillIds, []);
  const withSkills = buildT2iPayload(
    { model: { ...model, skillsDisabled: false }, prompt: "一只猫", ratio: "1:1", resolution: "2K", superResolutionEnabled: true },
    { sourceUrls: [], batchId: "b", batchIndex: 0, batchSize: 1, batchCreatedAt: 0 },
  );
  assert.equal(withSkills.input.skillIds.length > 0, withSkills.prompt !== "一只猫", "skills, when active, change the prompt");
});

test("models keep custom aspect ratios the admin configured", async () => {
  const { normalizeImageModelCapabilities, isValidAspectRatio } = await import("../src/legacy-modules/features/ai-shared/modelImageCapabilities.js");
  const caps = normalizeImageModelCapabilities({ resolutions: ["2K"], aspectRatios: ["16:9", "1:4", "8:1"], aspectRatiosByResolution: { "2K": ["16:9", "1:4", "8:1", "bad"] } });
  assert.deepEqual(caps.aspectRatiosByResolution["2K"], ["16:9", "8:1", "1:4"]);
  assert.deepEqual(caps.aspectRatios, ["16:9", "8:1", "1:4"]);
  assert.equal(isValidAspectRatio("9:19.5"), true);
  assert.equal(isValidAspectRatio("50:1"), false);
});
