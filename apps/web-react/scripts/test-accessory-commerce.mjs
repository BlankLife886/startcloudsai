import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  root,
  appType: "custom",
  logLevel: "error",
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
});

const [domain, commerce] = await Promise.all([
  vite.ssrLoadModule("/src/features/ecommerce/accessory/accessoryCommerce.js"),
  vite.ssrLoadModule(
    "/src/legacy-modules/features/ecommerce/ecommerceTools.js",
  ),
]);
await vite.close();

const {
  ACCESSORY_CATEGORY_OPTIONS,
  ACCESSORY_PACK_OPTIONS,
  accessoryCategoryById,
  accessoryReferenceRoles,
  accessoryShotBlueprints,
  accessorySlotPresence,
  buildAccessoryIdentityLock,
  buildAccessorySpec,
  buildAccessoryTaskPrompt,
  emptyAccessorySlots,
  nextEmptyAccessorySlot,
  packAccessorySlotFiles,
} = domain;

assert.deepEqual(
  ACCESSORY_CATEGORY_OPTIONS.map((item) => item.id),
  [
    "earring",
    "necklace",
    "ring",
    "bracelet",
    "brooch",
    "hair",
    "watch",
    "glasses",
  ],
);
assert.ok(
  ACCESSORY_CATEGORY_OPTIONS.every(
    (item) => item.anchor && item.prompt && item.defaultCrop,
  ),
);
assert.deepEqual(
  ACCESSORY_PACK_OPTIONS.map((item) => item.id),
  ["single", "pdp", "social", "campaign"],
);
assert.deepEqual(
  accessoryShotBlueprints("pdp").map((item) => item.id),
  ["hero", "angle", "scale", "macro"],
);
assert.deepEqual(
  accessoryShotBlueprints("social").map((item) => item.id),
  ["hero", "style", "macro", "story"],
);

assert.equal(accessoryCategoryById("ring").anchor, "手指 / 指根");
assert.deepEqual(accessoryReferenceRoles(3), [
  "饰品身份",
  "模特身份",
  "场景环境",
]);

const identityLock = buildAccessoryIdentityLock({
  hasModel: true,
  hasScene: true,
});
for (const required of [
  "饰品身份锁",
  "宝石与珍珠数量",
  "人物身份锁",
  "场景分离锁",
]) {
  assert.ok(
    identityLock.includes(required),
    `identity lock missing ${required}`,
  );
}

const accessoryPlan = commerce.buildEcommerceGenerationPlan({
  modeId: "accessory",
  count: 4,
  basePrompt: "任务：饰品商业出图。",
  referenceCount: 3,
  referenceRoles: accessoryReferenceRoles(3),
  identityLock,
  hasPersonIdentity: true,
  shotBlueprints: accessoryShotBlueprints("pdp"),
});
assert.deepEqual(
  accessoryPlan.map((item) => item.viewId),
  ["hero", "angle", "scale", "macro"],
);
assert.ok(
  accessoryPlan.every((item) => item.prompt.includes("宝石与珍珠数量")),
);
assert.ok(
  accessoryPlan.every((item) =>
    item.prompt.includes("参考图角色：饰品身份；模特身份；场景环境。"),
  ),
);

const prompt = buildAccessoryTaskPrompt({
  productName: "玫瑰金戒指",
  sku: "RING-018",
  sellingPoints: "主石和六枚镶爪必须完整",
  category: "ring",
  pack: "pdp",
  material: "gemstone",
  scale: "true",
  sizeMm: "18.5",
  occlusion: "natural",
  crop: "macro",
  style: "luxury",
  platform: "Shopify",
  market: "美国",
  aspectRatio: "4:5",
  hasModel: true,
  hasScene: true,
});
for (const required of [
  "RING-018",
  "手指 / 指根",
  "18.5 mm",
  "宝石数量",
  "真实前后遮挡",
  "商品详情页副图",
  "质检硬门槛",
  "禁止饰品穿透人体",
]) {
  assert.ok(prompt.includes(required), `task prompt missing ${required}`);
}

const accessorySpec = buildAccessorySpec({
  category: "ring",
  pack: "pdp",
  material: "gemstone",
  scale: "true",
  sizeMm: "18.5",
  occlusion: "natural",
  crop: "macro",
  style: "luxury",
  platform: "Shopify",
  market: "美国",
  aspectRatio: "4:5",
  productName: "玫瑰金戒指",
  sku: "RING-018",
  sellingPoints: "六枚镶爪",
  hasModel: true,
  hasScene: false,
  shotId: "hero",
  shotLabel: "佩戴主图",
});
assert.equal(accessorySpec.schemaVersion, 1);
assert.equal(accessorySpec.category, "ring");
assert.equal(accessorySpec.sku, "RING-018");
assert.equal(accessorySpec.hasModel, true);
assert.equal(accessorySpec.hasScene, false);
assert.equal(accessorySpec.shotId, "hero");

const slots = emptyAccessorySlots();
slots.product = { file: { name: "ring.png" } };
slots.scene = { file: { name: "scene.png" } };
const presence = accessorySlotPresence(slots);
assert.equal(presence.hasProduct, true);
assert.equal(presence.hasModel, false);
assert.equal(presence.hasScene, false);
assert.equal(presence.sceneIgnoredWithoutModel, true);
assert.equal(packAccessorySlotFiles(slots).length, 1);
slots.model = { file: { name: "model.png" } };
assert.equal(packAccessorySlotFiles(slots).length, 3);
assert.equal(nextEmptyAccessorySlot(emptyAccessorySlots()), "product");

assert.ok(
  !ACCESSORY_CATEGORY_OPTIONS.some((item) =>
    /包袋|帽子|bag|hat/i.test(`${item.id} ${item.label}`),
  ),
  "accessory categories must stay jewelry-focused",
);

const view = await readFile(
  new URL("../src/views/EcommerceBusinessSession.jsx", import.meta.url),
  "utf8",
);
assert.ok(
  view.includes("<AccessoryStudio"),
  "accessory workspace branch missing",
);
assert.ok(
  view.includes("buildAccessoryTaskPrompt"),
  "accessory task prompt is not connected",
);
assert.ok(
  view.includes("buildAccessorySpec"),
  "accessorySpec builder is not connected",
);
assert.ok(
  view.includes("selectAccessoryHistory"),
  "accessory history restore missing",
);
assert.ok(
  view.includes('mode.id === "accessory"'),
  "accessory generation branch missing",
);
assert.ok(
  view.includes("setAccessorySku(product.sku"),
  "accessory product library wiring missing",
);
assert.ok(
  !view.includes('accessory: ["包袋"'),
  "legacy OPTIONS.accessory should be removed",
);
assert.ok(
  !view.includes("OPTIONS.accessory"),
  "dead OPTIONS.accessory references remain",
);

const toolsSource = await readFile(
  new URL(
    "../src/legacy-modules/features/ecommerce/ecommerceTools.js",
    import.meta.url,
  ),
  "utf8",
);
assert.ok(
  !toolsSource.includes("包袋") && !toolsSource.includes("帽子和腕表"),
  "accessory marketing copy still promises bags/hats",
);
assert.ok(
  toolsSource.includes("珠宝眼镜腕表真实佩戴"),
  "accessory tagline not updated",
);
assert.ok(
  commerce
    .ecommerceModeById("accessory")
    .fields.every((field) => field !== "accessory"),
  "legacy accessory field should be removed from mode fields",
);

console.log("accessory commerce domain checks passed");
