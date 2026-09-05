import localforage from "localforage";
import {
  attachEcommerceUploadKey,
  isReusableTaskImageKey,
  normalizeTaskImageKey,
} from "./ecommerceTools.js";

const META_KEY = "accessory-v2";
const LEGACY_META_KEY = "accessory-v1";
const SLOT_ROLES = ["product", "model", "scene"];
const metaStore = localforage.createInstance({
  name: "starclouds-ecommerce",
  storeName: "accessory_draft",
});
const blobStore = localforage.createInstance({
  name: "starclouds-ecommerce",
  storeName: "accessory_blobs",
});

function uploadKeyOf(file) {
  return normalizeTaskImageKey(file?.uploadKey || "");
}

async function hydrateSlotItem(item, blobKey, fallbackName) {
  if (!item || typeof item !== "object") return null;
  if (item.source === "remote" && item.sourceUrl) {
    const file = new File([new Blob()], item.name || fallbackName, {
      type: item.type || "image/png",
    });
    Object.defineProperty(file, "sourceUrl", { value: item.sourceUrl });
    attachEcommerceUploadKey(file, item.uploadKey);
    return {
      file,
      url: item.previewUrl || item.sourceUrl,
      local: false,
    };
  }
  const blob = await blobStore.getItem(blobKey);
  if (!(blob instanceof Blob) || !blob.size) return null;
  const file = new File([blob], item.name || fallbackName, {
    type: item.type || blob.type || "image/jpeg",
  });
  attachEcommerceUploadKey(file, item.uploadKey);
  return { file, url: URL.createObjectURL(file), local: true };
}

async function persistSlotItem(preview, blobKey, fallbackName) {
  const file = preview?.file;
  if (!(file instanceof Blob)) {
    await blobStore.removeItem(blobKey);
    return null;
  }
  const uploadKey = uploadKeyOf(file);
  if (file.sourceUrl) {
    await blobStore.removeItem(blobKey);
    return {
      source: "remote",
      sourceUrl: file.sourceUrl,
      previewUrl: preview.url || file.sourceUrl,
      name: file.name || fallbackName,
      type: file.type || "image/png",
      uploadKey: isReusableTaskImageKey(uploadKey) ? uploadKey : "",
    };
  }
  if (!file.size) {
    await blobStore.removeItem(blobKey);
    return null;
  }
  await blobStore.setItem(blobKey, file);
  return {
    source: "upload",
    name: file.name || fallbackName,
    type: file.type || "image/jpeg",
    uploadKey: isReusableTaskImageKey(uploadKey) ? uploadKey : "",
  };
}

function emptySlots() {
  return { product: null, model: null, scene: null };
}

async function loadLegacyReferences(meta) {
  const slots = emptySlots();
  for (let index = 0; index < SLOT_ROLES.length; index += 1) {
    const item = meta.references?.[index];
    if (!item || typeof item !== "object") continue;
    const hydrated = await hydrateSlotItem(
      item,
      `reference-${index}`,
      `accessory-${index + 1}.png`,
    );
    if (hydrated) slots[SLOT_ROLES[index]] = hydrated;
  }
  return slots;
}

export async function loadAccessoryDraft() {
  let meta = await metaStore.getItem(META_KEY);
  let fromLegacy = false;
  if (!meta || typeof meta !== "object") {
    meta = await metaStore.getItem(LEGACY_META_KEY);
    fromLegacy = Boolean(meta && typeof meta === "object");
  }
  if (!meta || typeof meta !== "object") return null;

  let slots = emptySlots();
  if (meta.slots && typeof meta.slots === "object") {
    for (const role of SLOT_ROLES) {
      slots[role] = await hydrateSlotItem(
        meta.slots[role],
        `slot-${role}`,
        `accessory-${role}.png`,
      );
    }
  } else {
    slots = await loadLegacyReferences(meta);
  }

  return {
    category: String(meta.category || ""),
    pack: String(meta.pack || ""),
    material: String(meta.material || ""),
    scale: String(meta.scale || ""),
    sizeMm: String(meta.sizeMm || ""),
    occlusion: String(meta.occlusion || ""),
    crop: String(meta.crop || ""),
    style: String(meta.style || ""),
    sku: String(meta.sku || ""),
    productName: String(meta.productName || ""),
    sellingPoints: String(meta.sellingPoints || ""),
    platform: String(meta.platform || ""),
    market: String(meta.market || ""),
    aspectRatio: String(meta.aspectRatio || ""),
    slots,
    /** @deprecated compact list for older callers */
    references: SLOT_ROLES.map((role) => slots[role]).filter(Boolean),
    fromLegacy,
  };
}

export async function saveAccessoryDraft(draft = {}) {
  const sourceSlots =
    draft.slots && typeof draft.slots === "object"
      ? draft.slots
      : {
          product: draft.references?.[0] || null,
          model: draft.references?.[1] || null,
          scene: draft.references?.[2] || null,
        };
  const slots = emptySlots();
  for (const role of SLOT_ROLES) {
    slots[role] = await persistSlotItem(
      sourceSlots[role],
      `slot-${role}`,
      `accessory-${role}.png`,
    );
  }
  // Clear legacy blob keys so old dense-array drafts cannot collide.
  for (let index = 0; index < SLOT_ROLES.length; index += 1) {
    await blobStore.removeItem(`reference-${index}`);
  }
  await metaStore.setItem(META_KEY, {
    category: draft.category || "",
    pack: draft.pack || "",
    material: draft.material || "",
    scale: draft.scale || "",
    sizeMm: draft.sizeMm || "",
    occlusion: draft.occlusion || "",
    crop: draft.crop || "",
    style: draft.style || "",
    sku: draft.sku || "",
    productName: draft.productName || "",
    sellingPoints: draft.sellingPoints || "",
    platform: draft.platform || "",
    market: draft.market || "",
    aspectRatio: draft.aspectRatio || "",
    slots,
    savedAt: Date.now(),
  });
  await metaStore.removeItem(LEGACY_META_KEY);
}
