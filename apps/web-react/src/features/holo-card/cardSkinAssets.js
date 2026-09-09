import { ASTRAL_SAMPLE } from './astral-design-layers.js';
import { createCardSkinCanvases } from './card-skin-art.js';
import { resolveCardDesign } from './cardSkins.js';

// Store encoded artwork, not live canvases or unreleased object URLs. Color
// exploration is bounded; each stage owns and releases its own URLs.
const cache = new Map();
const CACHE_LIMIT = 8;

function skinBlobs(id, accentColor) {
  const key = `${id}:${accentColor}`;
  if (cache.has(key)) {
    const cached = cache.get(key);
    cache.delete(key); cache.set(key, cached);
    return cached;
  }
  const result = Promise.resolve().then(async () => {
    const canvases = createCardSkinCanvases(id, { accentColor, width: 1024, height: 1536 });
    const entries = await Promise.all(Object.entries(canvases).map(async ([part, canvas]) => {
      try {
        const blob = await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('皮肤素材准备失败，请重新选择皮肤。')), 'image/png'));
        return [part, blob];
      } finally { canvas.width = 1; canvas.height = 1; }
    }));
    return Object.fromEntries(entries);
  });
  cache.set(key, result);
  result.catch(() => { if (cache.get(key) === result) cache.delete(key); });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return result;
}

export function cardDesignAssetKey(settings) {
  const design = resolveCardDesign(settings);
  return ['background', 'effects', 'frame', 'back'].map(part => design[part].id).concat(design.accentColor).join(':');
}

export async function getCardDesignAssets(settings) {
  const design = resolveCardDesign(settings);
  const entries = await Promise.all(['background', 'effects', 'frame', 'back'].map(async part => {
    const id = design[part].id;
    if (id === 'astral') return [part, ASTRAL_SAMPLE.assets[part] || null];
    if (part === 'background' && design[part].artwork) return [part, design[part].artwork];
    return [part, (await skinBlobs(id, design.accentColor))[part]];
  }));
  return Object.fromEntries(entries);
}
