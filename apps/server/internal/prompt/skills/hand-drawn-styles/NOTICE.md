# Hand-drawn Styles

The `hand-drawn-styles` official skill (`SKILL.md` in this folder) is adapted
from threerocks's **hand-drawn-styles**:

https://github.com/threerocks/hand-drawn-styles

- Upstream commit at integration time: `7388c55`.
- License: MIT License (full text below).
- Adaptation: the upstream skill only produced prompts; here the assistant
  also generates images through `propose_image_action`, and offers a
  prompt-only mode. The upstream "show the menu and wait" step becomes an
  `ask_choices` card. `scripts/render_prompt.py` is not used; the assistant
  copies the template from `references/styles.md` verbatim and fills the
  placeholders.
- `references/styles.md` is the upstream `STYLES.md` with these changes:
  style 3.1 (蜡笔童涂-潦草自画版, which needs a fixed anchor image and a
  three-stage edit workflow) was removed; style 3 was renamed from a studio
  name to "日系手绘动画风" and the studio name was removed from its English
  template; the names of a webcomic and of animation studios were removed
  from the style 1, 11 and 12 templates and notes; notes that pointed to
  local benchmark / example images were removed.
- `references/protocol.md` is the upstream `PROTOCOL.md` with the same style
  3 / 3.1 changes, the renderer instructions removed, and the "prompt only,
  never generate" positioning removed.
- `assets/style-3.1/anchor-family.png` (with its privacy statement),
  `benchmarks/` and `examples/` are not imported.

Import: zip this folder (SKILL.md plus references/) and upload it in the admin
console (`/admin/image-skills` → 导入 SKILL.md / zip).

---

MIT License

Copyright (c) 2026 liulei

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
