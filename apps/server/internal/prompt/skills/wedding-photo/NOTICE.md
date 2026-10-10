# Wedding Photo

The `wedding-photo` official skill (`SKILL.md` in this folder) is adapted from
wenyachen's **ai-wedding-photo-skill**:

https://github.com/wenyachen/ai-wedding-photo-skill

- Upstream commit at integration time: `e396f04`.
- License: MIT License (full text below).
- Adaptation: the upstream `ai-wedding-photo/SKILL.md` was rewritten as a
  Chinese instruction an image model can execute directly, plus a last section
  mapping the upstream workflow to StarClouds assistant tools (`ask_choices`,
  `propose_image_action` with the couple's photos as `referencedImageIds`,
  `delivery_export`). The upstream "which image model or platform" question
  and `references/model-adapters.md` were dropped because the platform picks
  the model. The upstream identity and retouching rules were kept; an
  adults-only rule was added.
- `references/styles.md` and `references/shot-direction.md` are copied
  verbatim from the upstream commit above. Style preview images and
  `scripts/make_contact_sheet.py` are not imported.

Import: zip this folder (SKILL.md plus references/) and upload it in the admin
console (`/admin/image-skills` → 导入 SKILL.md / zip).

---

MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

