export const TRANSPARENT_PNG_PROMPT_INSTRUCTION =
  'Return a real transparent PNG with an actual alpha channel. Use smooth anti-aliased contours, clean subpixel alpha coverage, crisp vector-like silhouette edges, and enough transparent padding around the subject. Never draw a checkerboard, white backdrop, solid-color backdrop, frame, halo, matte fringe, ground plane, cast shadow, or fake transparency pattern.'

export function withTransparentPngInstruction(prompt, enabled = false) {
  const value = String(prompt || '').trim()
  if (!enabled || !value) return value
  return [
    'Image-generation output requirement:',
    `- ${TRANSPARENT_PNG_PROMPT_INSTRUCTION}`,
    '- Do not render these instructions as visible text. Generate the requested image directly.',
    '',
    value,
  ].join('\n')
}
