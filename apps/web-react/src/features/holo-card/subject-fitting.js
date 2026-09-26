export const SUBJECT_FRAMING_MODES = Object.freeze(['native', 'auto', 'contain']);
const CARD_ASPECT = 2 / 3;

function imageSize(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error('图片没有可用的像素尺寸。');
  }
}

export function hasNativeCardAspect(width, height) {
  imageSize(width, height);
  return width * 3 === height * 2;
}

/** Read-only RGBA inspection. Alpha 1 counts, including isolated fine hair. */
export function scanAlphaBounds(pixels, width, height, top = 0) {
  imageSize(width, height);
  if (!pixels || pixels.length < width * height * 4 || !Number.isInteger(top) || top < 0) {
    throw new Error('无法读取图片的完整透明通道。');
  }
  let left = width, right = -1, first = height, last = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 1) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      first = Math.min(first, y); last = Math.max(last, y);
    }
  }
  return right < left ? null : { x: left, y: first + top, width: right - left + 1, height: last - first + 1 };
}

export function mergeAlphaBounds(first, second) {
  if (!first) return second ? { ...second } : null;
  if (!second) return { ...first };
  const x = Math.min(first.x, second.x), y = Math.min(first.y, second.y);
  return {
    x, y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  };
}

function validateBounds(bounds, width, height) {
  if (!bounds || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(bounds[key]))
    || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > width || bounds.y + bounds.height > height) {
    throw new Error('主体没有可用的透明边界。');
  }
}

/** Artwork windows are expressed in top-origin normalized card coordinates. */
export function normalizeArtworkRect(rect) {
  const result = rect == null ? { x: 0, y: 0, width: 1, height: 1 } : { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  if (!Object.values(result).every(Number.isFinite) || result.x < 0 || result.y < 0 || result.width <= 0 || result.height <= 0
    || result.x + result.width > 1 || result.y + result.height > 1) throw new Error('卡片绘图区超出可用范围。');
  return result;
}

/** Maps bottom-left card UV to the unmodified source texture's bottom-left UV. */
export function fitSubject({ width, height, framing = 'native', subjectScale = 1, alphaBounds = null, artworkRect } = {}) {
  imageSize(width, height);
  const mode = SUBJECT_FRAMING_MODES.includes(framing) ? framing : 'native';
  const rect = normalizeArtworkRect(artworkRect);
  const full = rect.x === 0 && rect.y === 0 && rect.width === 1 && rect.height === 1;
  const nativeAspect = hasNativeCardAspect(width, height);
  const requestedScale = Number.isFinite(subjectScale) ? Math.max(.75, Math.min(1.2, subjectScale)) : 1;
  if (full && (mode === 'native' || mode === 'auto' && nativeAspect)) {
    const inverse = 1 / requestedScale;
    return {
      mode, strategy: 'native', requestedScale, effectiveScale: requestedScale,
      uvScale: { x: inverse, y: inverse }, uvOffset: { x: .5 - .5 * inverse, y: .5 - .5 * inverse },
      sourceBounds: { x: 0, y: 0, width, height },
      displayBounds: { x: .5 - requestedScale / 2, y: .5 - requestedScale / 2, width: requestedScale, height: requestedScale },
      artworkRect: rect,
    };
  }

  const bounds = mode === 'auto' && !nativeAspect ? alphaBounds : { x: 0, y: 0, width, height };
  validateBounds(bounds, width, height);
  const targetWidth = full ? mode === 'auto' ? .90 : .92 : rect.width * .96;
  const targetHeight = full ? mode === 'auto' ? .88 : .86 : rect.height * .96;
  const targetCenter = full ? { x: .5, y: .52 } : { x: rect.x + rect.width / 2, y: 1 - rect.y - rect.height / 2 };
  // These extents use physical card units; source pixels stay square for every aspect.
  const fit = Math.min(targetWidth * 2 / bounds.width, targetHeight * 3 / bounds.height);
  // Scaling up never clips a hair or a corner. Extra zoom uses the unused margin.
  const safe = Math.min((full ? .98 : rect.width * .985) * 2 / bounds.width, (full ? .92 : rect.height * .985) * 3 / bounds.height);
  const pixelScale = Math.min(fit * requestedScale, safe);
  const uvScale = { x: 2 / (width * pixelScale), y: 3 / (height * pixelScale) };
  const sourceCenter = { x: (bounds.x + bounds.width / 2) / width, y: 1 - (bounds.y + bounds.height / 2) / height };
  const displayWidth = bounds.width * pixelScale / 2, displayHeight = bounds.height * pixelScale / 3;
  return {
    mode, strategy: mode === 'native' || nativeAspect ? 'contain' : mode, requestedScale, effectiveScale: pixelScale / fit,
    uvScale, uvOffset: { x: sourceCenter.x - targetCenter.x * uvScale.x, y: sourceCenter.y - targetCenter.y * uvScale.y },
    sourceBounds: { ...bounds },
    displayBounds: { x: targetCenter.x - displayWidth / 2, y: targetCenter.y - displayHeight / 2, width: displayWidth, height: displayHeight },
    artworkRect: rect,
  };
}

export function fitCardLayer(width, height, mode = 'cover') {
  imageSize(width, height);
  const aspect = width / height;
  const native = hasNativeCardAspect(width, height);
  let x = 1, y = 1;
  if (!native && mode === 'cover') {
    if (aspect > CARD_ASPECT) x = CARD_ASPECT / aspect;
    else y = aspect / CARD_ASPECT;
  } else if (!native && mode === 'contain') {
    if (aspect > CARD_ASPECT) y = aspect / CARD_ASPECT;
    else x = CARD_ASPECT / aspect;
  }
  return { uvScale: { x, y }, uvOffset: { x: (1 - x) / 2, y: (1 - y) / 2 } };
}
