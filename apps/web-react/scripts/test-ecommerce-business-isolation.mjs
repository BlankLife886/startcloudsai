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
const [registry, jobs] = await Promise.all([
  vite.ssrLoadModule(
    "/src/features/ecommerce/businesses/businessRegistry.js",
  ),
  vite.ssrLoadModule("/src/features/ecommerce/useEcommerceJobs.js"),
]);
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
const jobsSource = await readFile(
  new URL("../src/features/ecommerce/useEcommerceJobs.js", import.meta.url),
  "utf8",
);
const tasksApiSource = await readFile(
  new URL("../src/legacy-modules/services/tasksApi.js", import.meta.url),
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
assert.equal(
  view.includes("key={business.stateNamespace}"),
  false,
  "switching tabs must preserve the mounted page shell",
);
assert.match(
  session,
  /function EcommerceBusinessSession\(\{[\s\S]*?businessId,/,
  "the route view must delegate state to a business session boundary",
);
assert.ok(view.split("\n").length < 80, "route view must stay a thin router");
assert.equal(
  jobs.ecommerceTaskMatchesKind(
    { params: { _kind: "ui-design-ecommerce-tryon-generation" } },
    "ui-design-ecommerce-tryon-generation",
  ),
  true,
);
assert.equal(
  jobs.ecommerceTaskMatchesKind(
    { kind: "ui-design-ecommerce-tryon-generation" },
    "ui-design-ecommerce-handheld-generation",
  ),
  false,
);
assert.ok(
  session.includes("taskKind: `ui-design-ecommerce-${mode.id}-generation`"),
  "each business session must scope job state to its own task kind",
);
assert.ok(
  String(jobs.useEcommerceJobs).includes("[taskKind]"),
  "task subscriptions must re-scope when the business changes",
);
assert.equal(
  session.includes("if (activeTask || tryonStarting || handheldStarting) return"),
  false,
  "running work must not block business tab navigation",
);
assert.ok(
  session.includes("if (!beginTaskLaunch()) return"),
  "generation clicks must synchronously acquire the task launch gate",
);
assert.ok(
  session.includes("disabled={taskLaunchPending && item.id !== mode.id}"),
  "business tabs must stay locked until task creation is acknowledged",
);
assert.ok(
  session.includes("finishTaskLaunch();"),
  "task launch failures and acknowledgements must release navigation",
);
assert.ok(
  session.includes("jobs.quoteBatch({") &&
    session.includes("expectedUnitPriceCents: quotedUnit"),
  "ecommerce generation must submit the same authoritative price the user confirmed",
);
assert.ok(
  jobsSource.includes('String(key).startsWith("prepare-")') &&
    jobsSource.includes("pendingControllers.forEach"),
  "stop generation must also abort uploads and task preparation before a task id exists",
);
assert.ok(
  tasksApiSource.includes("expectedUnitPriceCents != null"),
  "an omitted expected price must not be serialized as zero",
);
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
