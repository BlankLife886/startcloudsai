import assert from "node:assert/strict";
import test from "node:test";
import { collectHomeModels } from "../src/views/home/homeModels.js";

test("collects actual runtime model fields and all supported media sources", () => {
  const config = {
    aiModelCatalog: {
      models: [
        { id: "chat", name: "gpt-5-5", kind: "chat", iconUrl: "/chat.webp", status: "available" },
        { id: "image", label: "GPT Image 2", kind: "image", iconUrl: "/image.webp" },
      ],
      publicModels: [{ id: "image", name: "GPT Image 2" }],
    },
    features: {
      "ai.assistant": { enabled: true, config: {
        textModels: [{ model: "assistant", label: "Assistant model" }],
        imageModels: [{ publicModelKey: "assistant-image", name: "Assistant image" }],
      } },
      "ai.uiDesign": { enabled: true, config: {
        analysisModels: [{ model: "analysis", label: "Analysis model" }],
      } },
      "ai.mediaTools": { enabled: true, config: { tools: [
        { id: "video", name: "Video model", modality: "video", tool: "video_generate" },
        { id: "audio", name: "Audio model", modality: "audio", tool: "audio_generate" },
      ] } },
      "ai.imageTools": { enabled: true, config: { backgroundRemovalModels: [
        { publicModelKey: "background", label: "背景移除", modality: "image", tool: "background_remove" },
      ] } },
      media: { config: {
        videoModels: [{ id: "video-list", name: "Video list model" }],
        audioModels: [{ id: "audio-list", name: "Audio list model" }],
        publicModels: [{ id: "image-list", name: "Image list model" }],
      } },
    },
  };
  const before = structuredClone(config);
  const models = collectHomeModels(config);
  assert.deepEqual(models.map(({ id, modality }) => [id, modality]), [
    ["chat", "text"], ["image", "image"], ["assistant-image", "image"], ["assistant", "text"],
    ["analysis", "text"], ["video", "video"], ["audio", "audio"], ["background", "image"],
    ["image-list", "image"], ["video-list", "video"], ["audio-list", "audio"],
  ]);
  assert.deepEqual(models[0], { id: "chat", name: "gpt-5-5", iconUrl: "/chat.webp", modality: "text" });
  assert.equal(models.find(({ id }) => id === "background").name, "背景移除");
  assert.deepEqual(config, before);
});

test("deduplicates by stable id and only fills a missing icon from later copies", () => {
  const models = collectHomeModels({
    aiModelCatalog: {
      models: [{ id: "primary", name: "gpt-image-2", kind: "image", iconUrl: " " }],
      publicModels: [{ publicModelKey: "primary", name: "Renamed duplicate", iconUrl: "/first.webp" }],
      featurePublicModels: [{ id: "second", name: "GPT Image 2", kind: "image" }],
      providers: [{ models: [{ id: "provider", name: "Provider model", kind: "chat" }] }],
    },
    features: {
      assistant: { config: { imageModels: [
        { id: "primary", name: "Another label", iconUrl: "/second.webp", modality: "video" },
        { id: "second", name: "GPT Image 2", iconUrl: "/second-id.webp" },
      ] } },
    },
  });
  assert.deepEqual(models, [
    { id: "primary", name: "gpt-image-2", iconUrl: "/first.webp", modality: "image" },
    { id: "second", name: "GPT Image 2", iconUrl: "/second-id.webp", modality: "image" },
    { id: "provider", name: "Provider model", iconUrl: "", modality: "text" },
  ]);
});

test("catalog availability prevents workspace copies from restoring unavailable models", () => {
  const denied = [
    { id: "disabled", enabled: false },
    { id: "private", public: false },
    { id: "maintenance", maintenance: true },
    { id: "maintenance-status", status: " MAINTENANCE " },
  ].map((model) => ({ ...model, name: model.id }));
  const copies = denied.map(({ id, name }) => ({ id, name, kind: "image" }));
  assert.deepEqual(collectHomeModels({
    aiModelCatalog: { models: denied, publicModels: copies },
    features: { assistant: { config: { imageModels: copies } } },
  }), []);
});

test("skips disabled features, private providers, invalid entries and missing display identity", () => {
  assert.deepEqual(collectHomeModels({
    aiModelCatalog: {
      models: [null, false, 1, "model", [], {}, { id: "no-name" }, { name: "No id" },
        { id: {}, name: "Invalid id" }, { id: "invalid-name", name: {} }],
      providers: [null, { enabled: false, models: [{ id: "provider-off", name: "Disabled" }] },
        { public: false, models: [{ id: "provider-private", name: "Private" }] }],
    },
    features: {
      disabled: { enabled: false, config: { publicModels: [{ id: "feature-off", name: "Disabled feature" }] } },
      invalid: { config: [] },
      enabled: { config: { tools: [
        { id: "flag-disabled", name: "Disabled", disabled: true },
        { id: "flag-private", name: "Private", private: true },
        { id: "status-disabled", name: "Disabled", status: "disabled" },
        { id: "status-private", name: "Private", status: "private" },
        { id: "visibility", name: "Private", visibility: "private" },
        { id: "valid", name: "  Valid model  ", iconUrl: " /model.webp " },
      ] } },
    },
  }), [{ id: "valid", name: "Valid model", iconUrl: "/model.webp", modality: "tool" }]);
});

test("uses feature-only catalogs and identifies tool modality without inventing model names", () => {
  assert.deepEqual(collectHomeModels({ features: { media: { config: { tools: [
    { id: "video", label: "Configured Video", capabilities: ["textToVideo"] },
    { id: "audio", label: "Configured Voice", operations: ["text-to-speech"] },
    { id: "background", label: "Configured Background", tool: "background_remove" },
    { id: "chat", label: "Configured Chat", capabilities: ["text.chat", "image.understand"] },
  ] } } } }).map(({ id, modality }) => [id, modality]), [
    ["video", "video"], ["audio", "audio"], ["background", "image"], ["chat", "text"],
  ]);
});

test("empty or malformed runtime responses produce an empty list", () => {
  for (const config of [undefined, null, false, [], "runtime", {},
    { aiModelCatalog: [], features: "features" }, { aiModelCatalog: { models: {} }, features: { feature: null } }]) {
    assert.deepEqual(collectHomeModels(config), []);
  }
});
