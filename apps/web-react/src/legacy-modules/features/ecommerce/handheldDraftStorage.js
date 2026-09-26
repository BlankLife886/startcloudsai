import localforage from 'localforage'
import { attachEcommerceUploadKey, isReusableTaskImageKey, normalizeTaskImageKey } from './ecommerceTools.js'
import { tryonSlotDraftRecord } from './tryonDraftStorage.js'

const ROLES = ['product', 'model', 'scene', 'layout']
const META_KEY = 'slots-v1'
const OPTIONAL_SELECTION_VERSION = 4

function normalizeDraftAnnotations(value) {
  return (Array.isArray(value) ? value : [])
    .slice(0, 12)
    .map((item, index) => {
      const text = String(item?.text || '').trim().slice(0, 240)
      const x = Number(item?.x)
      const y = Number(item?.y)
      if (!text || !Number.isFinite(x) || !Number.isFinite(y)) return null
      return {
        id: String(item?.id || `annotation-${index + 1}`).trim().slice(0, 80),
        x: Math.round(Math.min(1, Math.max(0, x)) * 10000) / 10000,
        y: Math.round(Math.min(1, Math.max(0, y)) * 10000) / 10000,
        text,
        enabled: item?.enabled !== false,
      }
    })
    .filter(Boolean)
}

const metaStore = localforage.createInstance({
  name: 'starclouds-ecommerce',
  storeName: 'handheld_draft',
})
const blobStore = localforage.createInstance({
  name: 'starclouds-ecommerce',
  storeName: 'handheld_blobs',
})

export function handheldSlotDraftRecord(slot) {
  return tryonSlotDraftRecord(slot)
}

export async function loadHandheldDraft() {
  const meta = await metaStore.getItem(META_KEY)
  if (!meta || typeof meta !== 'object') return null
  const slots = {}
  for (const role of ROLES) {
    const item = meta.slots?.[role]
    if (!item || typeof item !== 'object') {
      slots[role] = null
      continue
    }
    if (item.source === 'builtin' && String(item.catalogId || '').trim()) {
      slots[role] = {
        source: 'builtin',
        catalogId: String(item.catalogId).trim(),
        uploadKey: isReusableTaskImageKey(item.uploadKey) ? item.uploadKey : '',
      }
      continue
    }
    const blob = await blobStore.getItem(role)
    if (!(blob instanceof Blob) || !blob.size) {
      slots[role] = null
      continue
    }
    const file = new File([blob], item.name || `${role}.png`, {
      type: item.type || blob.type || 'image/jpeg',
    })
    attachEcommerceUploadKey(file, item.uploadKey)
    slots[role] = {
      source: 'upload',
      file,
      uploadKey: isReusableTaskImageKey(item.uploadKey) ? item.uploadKey : '',
    }
  }
  return {
    optionalSelectionVersion: Number(
      meta.optionalSelectionVersion || meta.picturePlanVersion || 0,
    ),
    poseId: String(meta.poseId || ''),
    styleId: String(meta.styleId || ''),
    cropId: String(meta.cropId || ''),
    packId: String(meta.packId || ''),
    handId: String(meta.handId || ''),
    categoryId: String(meta.categoryId || ''),
    platformId: String(meta.platformId || ''),
    aspectRatio: String(meta.aspectRatio || ''),
    languageId: String(meta.languageId || ''),
    annotations: normalizeDraftAnnotations(meta.annotations),
    lensId: String(meta.lensId || ''),
    lightId: String(meta.lightId || ''),
    cameraId: String(meta.cameraId || ''),
    depthId: String(meta.depthId || ''),
    focusId: String(meta.focusId || ''),
    materialInteractionId: String(meta.materialInteractionId || ''),
    photoPresetId: String(meta.photoPresetId || ''),
    packStateId: String(meta.packStateId || ''),
    architectureId: String(meta.architectureId || ''),
    sku: String(meta.sku || ''),
    featuredModelId: String(meta.featuredModelId || ''),
    featuredHandId: String(meta.featuredHandId || ''),
    featuredSceneId: String(meta.featuredSceneId || ''),
    scene: String(meta.scene || ''),
    modelProfile: String(meta.modelProfile || ''),
    slots,
  }
}

export async function saveHandheldDraft(draft = {}) {
  const slotsMeta = {}
  for (const role of ROLES) {
    const record = handheldSlotDraftRecord(draft.slots?.[role])
    slotsMeta[role] = record
    if (!record || record.source === 'builtin') {
      await blobStore.removeItem(role)
      continue
    }
    await blobStore.setItem(role, draft.slots[role].file)
  }
  await metaStore.setItem(META_KEY, {
    optionalSelectionVersion: OPTIONAL_SELECTION_VERSION,
    poseId: draft.poseId || '',
    styleId: draft.styleId || '',
    cropId: draft.cropId || '',
    packId: draft.packId || '',
    handId: draft.handId || '',
    categoryId: draft.categoryId || '',
    platformId: draft.platformId || '',
    aspectRatio: draft.aspectRatio || '',
    languageId: draft.languageId || '',
    annotations: normalizeDraftAnnotations(draft.annotations),
    lensId: draft.lensId || '',
    lightId: draft.lightId || '',
    cameraId: draft.cameraId || '',
    depthId: draft.depthId || '',
    focusId: draft.focusId || '',
    materialInteractionId: draft.materialInteractionId || '',
    photoPresetId: draft.photoPresetId || '',
    packStateId: draft.packStateId || '',
    architectureId: draft.architectureId || '',
    sku: draft.sku || '',
    featuredModelId: draft.featuredModelId || '',
    featuredHandId: draft.featuredHandId || '',
    featuredSceneId: draft.featuredSceneId || '',
    scene: draft.scene || '',
    modelProfile: draft.modelProfile || '',
    slots: slotsMeta,
    savedAt: Date.now(),
  })
}
