import localforage from 'localforage'
import { attachEcommerceUploadKey, isReusableTaskImageKey, normalizeTaskImageKey } from './ecommerceTools.js'

const ROLES = ['garment', 'model', 'scene']
const META_KEY = 'slots-v1'

const metaStore = localforage.createInstance({
  name: 'starclouds-ecommerce',
  storeName: 'tryon_draft',
})
const blobStore = localforage.createInstance({
  name: 'starclouds-ecommerce',
  storeName: 'tryon_blobs',
})

function uploadKeyOf(slot) {
  return normalizeTaskImageKey(slot?.uploadKey || slot?.file?.uploadKey || '')
}

export function tryonSlotDraftRecord(slot) {
  if (!slot) return null
  const uploadKey = uploadKeyOf(slot)
  const catalogId = String(slot.catalogId || '').trim()
  if (slot.source === 'builtin' && catalogId) {
    return {
      source: 'builtin',
      catalogId,
      uploadKey: isReusableTaskImageKey(uploadKey) ? uploadKey : '',
    }
  }
  if (!(slot.file instanceof Blob) || !slot.file.size) return null
  return {
    source: 'upload',
    name: slot.file.name || 'tryon.png',
    type: slot.file.type || 'image/jpeg',
    uploadKey: isReusableTaskImageKey(uploadKey) ? uploadKey : '',
  }
}

export async function loadTryonDraft() {
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
    apparel: String(meta.apparel || ''),
    featuredTryonModelId: String(meta.featuredTryonModelId || ''),
    featuredTryonSceneId: String(meta.featuredTryonSceneId || ''),
    featuredTryonGarmentId: String(meta.featuredTryonGarmentId || ''),
    scene: String(meta.scene || ''),
    modelProfile: String(meta.modelProfile || ''),
    slots,
  }
}

export async function saveTryonDraft(draft = {}) {
  const slotsMeta = {}
  for (const role of ROLES) {
    const record = tryonSlotDraftRecord(draft.slots?.[role])
    slotsMeta[role] = record
    if (!record || record.source === 'builtin') {
      await blobStore.removeItem(role)
      continue
    }
    await blobStore.setItem(role, draft.slots[role].file)
  }
  await metaStore.setItem(META_KEY, {
    apparel: draft.apparel || '',
    featuredTryonModelId: draft.featuredTryonModelId || '',
    featuredTryonSceneId: draft.featuredTryonSceneId || '',
    featuredTryonGarmentId: draft.featuredTryonGarmentId || '',
    scene: draft.scene || '',
    modelProfile: draft.modelProfile || '',
    slots: slotsMeta,
    savedAt: Date.now(),
  })
}
