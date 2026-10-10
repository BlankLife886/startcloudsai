import localforage from "localforage";
import {
  attachEcommerceUploadKey,
  isReusableTaskImageKey,
  normalizeTaskImageKey,
} from "@react/legacy-modules/features/ecommerce/ecommerceTools.js";

// 每个侧栏业务模块独立的草稿：参考图（商品图 / 风格参考 / 补充参考）与表单字段。
// 刷新页面、切换模块后回来都能原样恢复；不同模块的草稿互不读取。
// 试衣 / 手持 / 饰品的参考槽位另有专用草稿，这里只负责它们的通用字段。

const metaStore = localforage.createInstance({
  name: "starclouds-ecommerce",
  storeName: "business_draft",
});
const blobStore = localforage.createInstance({
  name: "starclouds-ecommerce",
  storeName: "business_blobs",
});

export const BUSINESS_DRAFT_IMAGE_GROUPS = Object.freeze(["files", "style", "extras"]);
const MAX_IMAGES_PER_GROUP = 8;

function metaKey(businessId) {
  return `${businessId}:meta`;
}

function imagesKey(businessId, group) {
  return `${businessId}:images:${group}`;
}

function blobKey(businessId, group, index) {
  return `${businessId}:${group}:${index}`;
}

function sourceUrlOf(file) {
  return String(file?.sourceUrl || "").trim();
}

// 文件签名：同一组图片没变时不重复写 IndexedDB
function signatureOf(files) {
  return files
    .map((file) =>
      sourceUrlOf(file)
        ? `src:${sourceUrlOf(file)}`
        : `blob:${file?.name}:${file?.size}:${file?.lastModified}:${file?.uploadKey || ""}`,
    )
    .join("|");
}

const lastSignatures = new Map();

export async function saveBusinessDraftFields(businessId, fields) {
  if (!businessId) return;
  await metaStore.setItem(metaKey(businessId), {
    version: 1,
    savedAt: Date.now(),
    fields: fields && typeof fields === "object" ? fields : {},
  });
}

export async function saveBusinessDraftImages(businessId, group, list) {
  if (!businessId || !BUSINESS_DRAFT_IMAGE_GROUPS.includes(group)) return;
  const files = Array.from(list || [])
    .filter(Boolean)
    .slice(0, MAX_IMAGES_PER_GROUP);
  const cacheKey = imagesKey(businessId, group);
  const signature = signatureOf(files);
  if (lastSignatures.get(cacheKey) === signature) return;
  lastSignatures.set(cacheKey, signature);
  const items = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const uploadKey = normalizeTaskImageKey(file?.uploadKey || "");
    const sourceUrl = sourceUrlOf(file);
    const base = {
      name: String(file?.name || `${group}-${index + 1}.png`),
      type: String(file?.type || "image/png"),
      uploadKey: isReusableTaskImageKey(uploadKey) ? uploadKey : "",
      previewUrl: String(file?.previewUrl || ""),
    };
    if (sourceUrl) {
      // 商品库图片：只记链接，恢复时按原方式重建
      items.push({ ...base, kind: "source", sourceUrl });
      continue;
    }
    if (!(file instanceof Blob) || !file.size) continue;
    await blobStore.setItem(blobKey(businessId, group, index), file);
    items.push({ ...base, kind: "blob", index });
  }
  await metaStore.setItem(cacheKey, items);
  // 清掉多余的旧图片
  const keys = await blobStore.keys();
  const prefix = `${businessId}:${group}:`;
  await Promise.all(
    keys
      .filter((key) => key.startsWith(prefix))
      .filter((key) => !items.some((item) => item.kind === "blob" && blobKey(businessId, group, item.index) === key))
      .map((key) => blobStore.removeItem(key)),
  );
}

function sourceFile(item, index) {
  const file = new File([new Blob()], item.name || `product-${index + 1}.png`, {
    type: item.type || "image/png",
  });
  Object.defineProperty(file, "sourceUrl", { value: item.sourceUrl });
  if (item.previewUrl) Object.defineProperty(file, "previewUrl", { value: item.previewUrl });
  return file;
}

async function loadImages(businessId, group) {
  const items = await metaStore.getItem(imagesKey(businessId, group));
  if (!Array.isArray(items)) return [];
  const files = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (!item || typeof item !== "object") continue;
    let file = null;
    if (item.kind === "source" && item.sourceUrl) {
      file = sourceFile(item, index);
    } else if (item.kind === "blob") {
      const blob = await blobStore.getItem(blobKey(businessId, group, item.index));
      if (!(blob instanceof Blob) || !blob.size) continue;
      file = new File([blob], item.name || `${group}-${index + 1}.png`, {
        type: item.type || blob.type || "image/png",
      });
    }
    if (!file) continue;
    attachEcommerceUploadKey(file, item.uploadKey);
    files.push(file);
  }
  lastSignatures.set(imagesKey(businessId, group), signatureOf(files));
  return files;
}

export async function loadBusinessDraft(businessId) {
  if (!businessId) return null;
  const meta = await metaStore.getItem(metaKey(businessId));
  const images = {};
  for (const group of BUSINESS_DRAFT_IMAGE_GROUPS) {
    images[group] = await loadImages(businessId, group);
  }
  return {
    fields: meta?.fields && typeof meta.fields === "object" ? meta.fields : {},
    images,
  };
}

// 预览：本地图片生成 blob URL，商品库图片沿用原链接
export function businessDraftPreview(file) {
  const sourceUrl = sourceUrlOf(file);
  if (sourceUrl) {
    return { file, url: String(file.previewUrl || sourceUrl), local: false };
  }
  return { file, url: URL.createObjectURL(file), local: true };
}
