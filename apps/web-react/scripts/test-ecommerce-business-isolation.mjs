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
const registry = await vite.ssrLoadModule(
  "/src/features/ecommerce/businesses/businessRegistry.js",
);
await vite.close();

const businesses = registry.ECOMMERCE_BUSINESSES;
assert.deepEqual(
  businesses.map((business) => business.id),
  [
    "shoot",
    "listing",
    "clone",
    "detail",
    "campaign",
    "background",
    "outpaint",
    "enhance",
    "tryon",
    "handheld",
    "accessory",
    "backdrop",
    "shadow",
  ],
);
assert.equal(new Set(businesses.map((item) => item.stateNamespace)).size, 13);
assert.equal(new Set(businesses.map((item) => item.draftNamespace)).size, 13);
assert.equal(new Set(businesses.map((item) => item.taskKind)).size, 13);
assert.ok(businesses.every((item) => item.stateNamespace.includes(item.id)));

const view = await readFile(
  new URL("../src/views/EcommerceDesignView.jsx", import.meta.url),
  "utf8",
);
const session = await readFile(
  new URL("../src/views/EcommerceBusinessSession.jsx", import.meta.url),
  "utf8",
);
for (const leakedOwner of [
  "starclouds-accessory-reviews-v1",
  "starclouds-accessory-qa-v1",
  "starclouds-ecommerce-handheld-active-batch-v1",
  "tryon-model-east-asian-female.jpg",
  "tryon-scene-studio.jpg",
]) {
  assert.equal(
    session.includes(leakedOwner),
    false,
    `route view still owns business data: ${leakedOwner}`,
  );
}
assert.ok(
  view.includes("key={business.stateNamespace}"),
  "switching tabs must remount an isolated business session",
);
assert.ok(
  session.includes("function EcommerceBusinessSession({ businessId })"),
  "the route view must delegate state to a business session boundary",
);
assert.ok(view.split("\n").length < 30, "route view must stay a thin router");
assert.equal(session.includes("function TryonLiveStage"), false);
assert.equal(session.includes("clone-settings-section"), false);
assert.equal(session.includes("listing-structure-section"), false);
for (const isolatedState of [
  "const [accessoryCategory",
  "const [tryonSlots",
  "const [handheldSlots",
]) {
  assert.equal(
    session.includes(isolatedState),
    false,
    `business state leaked back into the shared session: ${isolatedState}`,
  );
}

console.log("ecommerce business isolation checks passed");
