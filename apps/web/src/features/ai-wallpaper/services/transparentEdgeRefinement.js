const ALPHA_CLEAR = 8
const ALPHA_OPAQUE = 247
const KERNEL_WEIGHTS = [1, 2, 1, 2, 4, 2, 1, 2, 1]

/**
 * Reconstruct hard transparent-mask contours into subpixel Alpha coverage.
 * RGB is rebuilt from premultiplied visible neighbours to prevent matte halos.
 */
export function refineTransparentImageData(pixels, width, height) {
  if (!(pixels instanceof Uint8ClampedArray) || width < 3 || height < 3) {
    return { changedPixels: 0 }
  }

  const source = new Uint8ClampedArray(pixels)
  let changedPixels = 0

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const center = (y * width + x) * 4
      const centerAlpha = source[center + 3]
      let minAlpha = 255
      let maxAlpha = 0
      let alphaSum = 0
      let colorWeight = 0
      let redSum = 0
      let greenSum = 0
      let blueSum = 0
      let kernelIndex = 0

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const offset = ((y + offsetY) * width + x + offsetX) * 4
          const alpha = source[offset + 3]
          const weight = KERNEL_WEIGHTS[kernelIndex]
          const premultipliedWeight = alpha * weight
          minAlpha = Math.min(minAlpha, alpha)
          maxAlpha = Math.max(maxAlpha, alpha)
          alphaSum += premultipliedWeight
          colorWeight += premultipliedWeight
          redSum += source[offset] * premultipliedWeight
          greenSum += source[offset + 1] * premultipliedWeight
          blueSum += source[offset + 2] * premultipliedWeight
          kernelIndex += 1
        }
      }

      // Preserve existing soft Alpha gradients such as shadows. Only hard
      // 0↔255 mask transitions need coverage reconstruction.
      if (minAlpha > ALPHA_CLEAR || maxAlpha < ALPHA_OPAQUE) continue
      const coverageAlpha = Math.round(alphaSum / 16)
      const blend = centerAlpha <= ALPHA_CLEAR || centerAlpha >= ALPHA_OPAQUE ? 0.68 : 0.24
      let refinedAlpha = Math.round(centerAlpha * (1 - blend) + coverageAlpha * blend)
      if (refinedAlpha <= 2) refinedAlpha = 0
      if (refinedAlpha >= 253) refinedAlpha = 255

      if (refinedAlpha !== centerAlpha) changedPixels += 1
      pixels[center + 3] = refinedAlpha
      if (refinedAlpha > 0 && colorWeight > 0) {
        pixels[center] = Math.round(redSum / colorWeight)
        pixels[center + 1] = Math.round(greenSum / colorWeight)
        pixels[center + 2] = Math.round(blueSum / colorWeight)
      }
    }
  }

  return { changedPixels }
}
