# XHS Visual Director

The `xhs-visual-director` official skill (`SKILL.md` in this folder) is
adapted from ziguishian's **xhs-visual-director-skill**:

https://github.com/ziguishian/xhs-visual-director-skill

- Upstream commit at integration time: `5c730c6`.
- License: MIT License (full text below).
- Adaptation: a new Chinese `SKILL.md` was written. Its first part is a
  page-style instruction an image model can execute directly; the last
  section maps the upstream workflow to StarClouds assistant tools
  (`ask_choices` for the clarifying questions, `files_read`,
  `propose_image_action` for one confirmation image and then the full set,
  `files_create`, `delivery_export`). Text-only tasks (caption only, page
  review only) skip image generation. Saving images to a local project folder
  and reporting file paths were dropped.
- `references/director-workflow.md` is the upstream `skill/SKILL.md` with the
  YAML frontmatter removed. All files from `docs/` and `templates/` except
  `templates/style_extension_template.md`, plus
  `examples/style_reference_notes.md` and `examples/example_output_plan.md`,
  are copied verbatim into `references/` under their upstream file names.

Import: zip this folder (SKILL.md plus references/) and upload it in the admin
console (`/admin/image-skills` → 导入 SKILL.md / zip).

---

MIT License

Copyright (c) 2026 ziguishian

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

