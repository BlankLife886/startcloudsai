import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const view = [
  await readFile(
    new URL("../src/views/EcommerceBusinessSession.jsx", import.meta.url),
    "utf8",
  ),
  await readFile(
    new URL(
      "../src/features/ecommerce/businesses/handheld/useHandheldBusinessState.js",
      import.meta.url,
    ),
    "utf8",
  ),
].join("\n");
const handheldStart = view.indexOf("<HandheldStudio");
const handheldEnd = view.indexOf(
  "/>\n          ) : isAccessoryMode(mode.id) ? (",
  handheldStart,
);
assert.ok(
  handheldStart > 0 && handheldEnd > handheldStart,
  "handheld component branch missing",
);
const branch = view.slice(handheldStart, handheldEnd);

for (const forbidden of [
  "tryonModelCatalog",
  "tryonSceneCatalog",
  "applyBuiltinTryonModel",
  "applyBuiltinTryonScene",
  "tryonResultUrl",
  "tryonBusy",
  "tryonUploadNotice",
  "jobs.cancelAll",
  "reviewStatus",
  "reviewBusy",
  "onAccept",
  "onReject",
  "decideCurrentHandheld",
  "onDownload",
  "onRegenerate",
  "onCancel",
]) {
  assert.equal(
    branch.includes(forbidden),
    false,
    `handheld branch leaked ${forbidden}`,
  );
}
for (const required of [
  "handheldModelCatalog",
  "handheldSceneCatalog",
  "applyBuiltinHandheldModel",
  "applyBuiltinHandheldScene",
  "handheldResultUrl",
]) {
  assert.equal(
    branch.includes(required),
    true,
    `handheld branch missing ${required}`,
  );
}

assert.equal(view.includes("<HandheldTunePopover"), true);
assert.equal(
  view.indexOf('className="commerce-header__language"') >
    view.indexOf("<HandheldPosePopover"),
  true,
  "language control must be placed to the right of pose",
);
assert.equal(
  view.includes("annotations={handheldAnnotations}"),
  true,
  "handheld annotations must reach the studio",
);
assert.equal(
  view.includes("currentRow?.aspectRatio ||") &&
    view.includes("handheldHistorySpec?.aspectRatio ||"),
  true,
  "handheld result canvas must prefer the stored result ratio",
);
assert.equal(
  view.includes("applyRestoredBatch(restoredBatchId, restoredTasks)") &&
    view.includes("jobs.historyLoading") &&
    view.includes("HANDHELD_ACTIVE_BATCH_STORAGE_KEY") &&
    view.includes(".hydrateHandheldBatch(restoredBatchId)"),
  true,
  "refresh must restore the exact handheld batch beyond general history limits",
);
assert.equal(
  view.includes("setSessionBatchId(String(row.groupId))"),
  true,
  "selecting handheld history must switch the tracked batch",
);
assert.equal(
  view.includes("depthOptions={HANDHELD_DEPTH_OPTIONS}"),
  true,
  "tune popover missing depth options",
);
assert.equal(
  view.includes("focusOptions={HANDHELD_FOCUS_OPTIONS}"),
  true,
  "tune popover missing focus options",
);
assert.equal(
  view.includes(
    "materialInteractionOptions={HANDHELD_MATERIAL_INTERACTION_OPTIONS}",
  ),
  true,
  "tune popover missing material interaction options",
);
assert.equal(
  view.includes(
    'const [handheldPhotoPreset, setHandheldPhotoPreset] = useState("")',
  ),
  true,
  "picture scheme must not be preselected",
);
for (const emptyState of [
  'const [handheldPose, setHandheldPose] = useState("")',
  'const [handheldHand, setHandheldHand] = useState("")',
  'const [handheldCategory, setHandheldCategory] = useState("")',
  'const [handheldPackState, setHandheldPackState] = useState("")',
  'const [handheldLanguage, setHandheldLanguage] = useState("")',
  'const [productName, setProductName] = useState("")',
  'const [sellingPoints, setSellingPoints] = useState("")',
]) {
  assert.equal(
    view.includes(emptyState),
    true,
    `optional product or pose state still has a default: ${emptyState}`,
  );
}
assert.equal(
  view.includes("if (option.poseId) setHandheldPose(option.poseId)"),
  false,
  "category selection must not inject a hidden pose",
);
assert.equal(
  view.includes("prompt: handheldPromptForShot(shot, index).prompt"),
  true,
  "visible prompt rules must be sent with each handheld shot",
);
assert.equal(
  view.includes("const includeModel = Boolean(handheldSlots.model?.file)"),
  true,
  "an explicitly selected hand or model reference must be uploaded",
);
assert.equal(
  view.includes("if (!next.scene?.file && !handheldClearedRef.current.scene)"),
  false,
  "scene must not be inserted without an explicit selection",
);
assert.equal(
  view.includes("(handheldSlots.scene?.file ? 1 : 0)"),
  true,
  "handheld quote input count must include a scene only when the user selected one",
);

const studio = await readFile(
  new URL("../src/features/ecommerce/HandheldStudio.jsx", import.meta.url),
  "utf8",
);
const studioStyles = await readFile(
  new URL("../src/features/ecommerce/HandheldStudio.css", import.meta.url),
  "utf8",
);
const draftStorage = await readFile(
  new URL(
    "../src/legacy-modules/features/ecommerce/handheldDraftStorage.js",
    import.meta.url,
  ),
  "utf8",
);
assert.equal(
  draftStorage.includes("aspectRatio: draft.aspectRatio || ''"),
  true,
  "handheld draft must persist the selected aspect ratio",
);
assert.equal(
  draftStorage.includes(
    "annotations: normalizeDraftAnnotations(draft.annotations)",
  ),
  true,
  "handheld draft must persist normalized annotations",
);
assert.equal(
  studio.includes("function HandheldAnnotationDialog"),
  true,
  "handheld product image annotation editor is missing",
);
assert.equal(
  (studio.match(/hasSelection \? "" : " is-placeholder"/g) || []).length,
  3,
  "picture plan, product info and pose triggers must start as unselected",
);
assert.equal(
  view.includes("treatEmptyAsPlaceholder"),
  true,
  "the empty language value must render as an unselected placeholder",
);
const guide = await readFile(
  new URL("../src/features/ecommerce/HandheldGuideDialog.jsx", import.meta.url),
  "utf8",
);
assert.equal(studio.includes('allowEmpty ? "" : id'), true);
assert.equal(studio.includes("完整出图规则"), true);
assert.equal(studio.includes("说明修改"), true);
for (const removedReviewFeature of [
  "onAccept",
  "onReject",
  "reviewStatus",
  "reviewBusy",
  ">验收<",
  ">驳回<",
  ">下载<",
  "onRegenerate",
  "重生",
]) {
  assert.equal(
    studio.includes(removedReviewFeature),
    false,
    `handheld review feature must stay removed: ${removedReviewFeature}`,
  );
}
assert.equal(
  studio.includes("className={`handheld-submit handheld-submit--frame"),
  true,
  "generate action must live inside the main result frame",
);
assert.equal(
  studio.includes("handheld-product-stack"),
  false,
  "detached generate dock must stay removed",
);
assert.equal(
  studio.includes("HandheldGeneratingStage"),
  true,
  "running handheld tasks must render a loading animation",
);
assert.equal(
  studio.includes("handheld-frame__thumb-failed") &&
    studio.includes("handheld-frame__thumb-pending") &&
    studio.includes("onRetryShot") &&
    !studio.includes("失败任务不会继续出图"),
  true,
  "unfinished handheld thumbs must keep a light loader and failed thumbs must retry",
);
assert.equal(
  view.includes("async function retryHandheldShot") &&
    view.includes("async function executeRetryHandheldShot"),
  true,
  "failed handheld shots must retry through the handheld job API",
);
const retryStart = view.indexOf("async function executeRetryHandheldShot");
const retryEnd = view.indexOf("async function executeRetrySlot", retryStart);
const retryImplementation = view.slice(retryStart, retryEnd);
assert.equal(
  retryImplementation.includes("jobs.retryHandheldItem(itemId)") &&
    !retryImplementation.includes("createHandheldBatch") &&
    !retryImplementation.includes("parentBatchId"),
  true,
  "failed handheld shots must replace the item task without creating child history",
);
const handheldApi = await readFile(
  new URL("../src/features/ecommerce/handheld/handheldApi.js", import.meta.url),
  "utf8",
);
assert.equal(
  handheldApi.includes(
    "/commerce/handheld/items/${encodeURIComponent(id)}/retry",
  ),
  true,
  "handheld item retry endpoint is missing",
);
assert.equal(
  studio.includes("Math.max(1, shotCount, packShots.length, shots.length)"),
  true,
  "restored multi-shot batches must not be truncated by current editor state",
);
const completedShotPriority = studio.indexOf(
  "plannedShots.find((item) => item.url && item.url === resultUrl)",
);
const runningShotPriority = studio.indexOf(
  "plannedShots.find((item) => item.running)",
);
assert.ok(
  completedShotPriority > 0 && runningShotPriority > completedShotPriority,
  "completed handheld output must remain on the main canvas while other shots load",
);
assert.equal(
  studio.includes("plannedShots.find((item) => item.failed)"),
  false,
  "failed handheld shots must not take over the main canvas",
);
assert.equal(
  view.includes("firstReturnedOutputUrl(handheldSessionOutputs)"),
  true,
  "handheld must pin the first successful shot that returns",
);
for (const staleGuideAction of ["验收", "驳回", "下载", "点左侧「生成」"]) {
  assert.equal(
    guide.includes(staleGuideAction),
    false,
    `handheld guide still mentions removed action: ${staleGuideAction}`,
  );
}
assert.match(
  studioStyles,
  /grid-template-areas:\s*"controls result references history"/,
  "desktop handheld layout must use stable work columns plus a right history rail",
);
for (const fluidTrack of [
  "--handheld-controls-track: clamp(280px, 21%, 400px)",
  "--handheld-references-track: clamp(145px, 10.5%, 196px)",
  "--handheld-history-track: clamp(72px, 6%, 112px)",
]) {
  assert.equal(
    studioStyles.includes(fluidTrack),
    true,
    `handheld desktop track must resize continuously: ${fluidTrack}`,
  );
}
assert.equal(
  view.includes("photoPresetOptions={HANDHELD_PHOTO_PRESET_OPTIONS}"),
  true,
  "scheme popover missing photo presets",
);

const api = await readFile(
  new URL("../src/features/ecommerce/handheld/handheldApi.js", import.meta.url),
  "utf8",
);
assert.equal(
  api.includes("tryon"),
  false,
  "handheld API must not reference try-on",
);
assert.equal(api.includes("/commerce/handheld/"), true);
assert.equal(
  api.includes(
    "/commerce/handheld/items/${encodeURIComponent(id)}/regenerations",
  ),
  false,
  "removed handheld regeneration endpoint must stay absent",
);
assert.equal(
  api.includes("/commerce/handheld/items/${encodeURIComponent(id)}/save-asset"),
  true,
  "handheld asset endpoint missing",
);

const jobs = await readFile(
  new URL("../src/features/ecommerce/useEcommerceJobs.js", import.meta.url),
  "utf8",
);
assert.equal(
  jobs.includes("const trackTask = useCallback("),
  false,
  "removed handheld regeneration task tracker must stay absent",
);
assert.equal(
  view.includes("async function regenerateCurrentHandheld(url)"),
  false,
  "removed handheld regeneration handler must stay absent",
);
assert.equal(
  view.includes("handheldRegeneration"),
  false,
  "removed handheld regeneration state must stay absent",
);
assert.equal(
  view.includes("outputModeId(task) === mode.id &&"),
  true,
  "live task selection must be scoped to the current ecommerce mode",
);
assert.equal(
  view.includes(
    'sessionBatchId || activeTask?.batchId || currentRow?.groupId || ""',
  ),
  true,
  "the explicitly restored or selected handheld batch must outrank another active batch",
);
assert.equal(
  view.includes('["failed", "canceled", "cancelled"].includes('),
  true,
  "task failure accounting must support the backend canceled spelling",
);
const handheldHeaderStart = view.indexOf(") : isHandheldMode(mode.id) ? (");
const handheldHeaderEnd = view.indexOf(
  ") : isAccessoryMode(mode.id) ? (",
  handheldHeaderStart,
);
assert.ok(
  handheldHeaderStart > 0 && handheldHeaderEnd > handheldHeaderStart,
  "handheld header branch missing",
);
const handheldHeader = view.slice(handheldHeaderStart, handheldHeaderEnd);
assert.equal(
  handheldHeader.includes("disabled={jobs.running}"),
  false,
  "unrelated ecommerce tasks must not disable handheld configuration",
);
assert.equal(
  handheldHeader.includes("disabled={handheldCurrentRunning}"),
  true,
  "handheld configuration must remain locked while its own batch is running",
);
assert.equal(
  view.includes("current.items.filter((asset) => asset.id !== saved.id)"),
  true,
  "saved handheld assets must update the visible asset library",
);
assert.equal(
  studio.includes("uploadNotice || failedShotCount"),
  false,
  "an upload notice must not hide the partial failure notice",
);

const commerceEntries = await readFile(
  new URL(
    "../src/legacy-modules/features/creator-hub/studioTools.js",
    import.meta.url,
  ),
  "utf8",
);
assert.equal(
  /ids:\s*\[['"]tryon['"],\s*['"]handheld['"],\s*['"]accessory['"]\]/.test(
    commerceEntries,
  ),
  true,
  "top ecommerce menu must place handheld directly after try-on",
);
assert.equal(
  /ids:\s*\[['"]shoot['"],\s*['"]listing['"],\s*['"]handheld['"],\s*['"]detail['"]\]/.test(
    commerceEntries,
  ),
  false,
  "top ecommerce menu must not leave handheld in product design",
);
console.log("handheld domain boundary checks passed");
