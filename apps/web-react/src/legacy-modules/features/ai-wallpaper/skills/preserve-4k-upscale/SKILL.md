---
name: "preserve-4k-upscale"
description: "Conservative 2K/4K/8K enlargement that preserves text, logos, clothing, products, alpha, and the original composition."
---

# Preserve 4K Upscale

## Purpose

Only enlarge an existing image to the requested 2K, 4K, or 8K output. Preserve
the original composition, people, objects, colors, lighting, background, and
style. Do not treat upscaling as a new image-generation request.

## Invariants

- Do not add, remove, replace, or redesign any visual element.
- Keep all text, numbers, logos, symbols, labels, signatures, and watermarks
  pixel-faithful. Never translate, rewrite, OCR-reconstruct, or guess text.
- Keep clothing and product details unchanged: silhouette, color, pattern,
  material, texture, seams, folds, buttons, zippers, labels, and logos.
- Prefer conservative pixel reconstruction and edge sharpening over generative
  restyling. If sharpening would change content, preserve the source instead.
- Do not apply color grading, skin retouching, background replacement, denoise
  hallucination, object removal, or style transfer.

## Protected-region policy

For images with important text or product/clothing details, preserve those
regions as fixed source pixels and use conservative enlargement. Only apply
light edge sharpening after scaling. The source must win whenever clarity and
identity conflict.

## Output policy

Return the selected target resolution without lossy recompression. Keep the
source aspect ratio and alpha channel when present. Report failure rather than
silently changing content. This skill is active only when the image
super-resolution feature is enabled by the application.

