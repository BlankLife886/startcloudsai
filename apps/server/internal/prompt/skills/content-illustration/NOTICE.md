# Content Illustration

The `content-illustration` official skill (`SKILL.md` in this folder) is
adapted from izscc's **cc2image** (zscc配图生成器):

https://github.com/izscc/cc2image

- Upstream commit at integration time: `33b18b3`.
- License: MIT License (full text below).
- Adaptation: a new Chinese `SKILL.md` was written. Its first part is a style
  instruction an image model can execute directly (default: 手绘知识风); the
  last section maps the upstream workflow to StarClouds assistant tools. The
  upstream style gate (an HTML selector built by `scripts/build_selector.py`
  through `Visualize:visualize`, returning a `CC2IMAGE_SELECTION_V1` block)
  becomes an `ask_choices` card; image generation goes through
  `propose_image_action` instead of `image_gen`.
- Removed: style 38 `quirky_doodle_character_flow` (怪诞小人风) and
  `references/quirky_doodle_method.md`, together with the Xiaohei sample
  images under `assets/examples/xiaohei/` (by Ian). Users are pointed to the
  `xiaohei-illustrations` skill, which is adapted from Ian's original
  repository. The icon style `airbnb_soft_miniature_icon` was renamed to
  `soft_miniature_icon` (暖调软拟物图标) so no brand name is used as a style
  name.
- `references/workflow.md` is an excerpt of the upstream `SKILL.md`
  (style choice, style anchors, input handling, cover/body rules, breakdown
  flow, typography and output format) with the selector, script and
  `image_gen`-only rules removed. `references/style_options.md`,
  `article_breakdown.md` and `visual_style.md` carry the same removals;
  `cover_prompt.md`, `body_prompt.md` and the three `kashika_*` method notes
  are copied verbatim. `references/interactive_selection.md`,
  `references/style_example_assets.json`, `scripts/`, style thumbnails and
  example images are not imported.

Import: zip this folder (SKILL.md plus references/) and upload it in the admin
console (`/admin/image-skills` → 导入 SKILL.md / zip).

---

MIT License

Copyright (c) 2026 izscc

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
