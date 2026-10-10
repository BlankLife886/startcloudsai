# Academic Figure

The `academic-figure` official skill (`SKILL.md` in this folder) is adapted
from LigphiDonk's **academic-figure-generator**:

https://github.com/LigphiDonk/academic-figure-generator

- Upstream commit at integration time: `0a2bec6`.
- License: MIT License (full text below).
- Only the two agent skills were used: `academic-figure-prompt` (classic
  top-conference style) and `academic-figure-prompt-pastel` (modern ML airy
  style, v4). The upstream web platform (`backend/`, `frontend/`) is not used.
- Adaptation: the two upstream skills are merged into one Chinese `SKILL.md`.
  Its first part is a style instruction an image model can execute directly;
  the last section maps the upstream workflow to StarClouds assistant tools
  (`files_read`, `ask_choices`, `propose_image_action`, `files_create`). The
  upstream "show palette options and wait" step becomes an `ask_choices` card.
- `references/style-classic.md` is `academic-figure-prompt/SKILL.md` and
  `references/style-pastel.md` is `academic-figure-prompt-pastel/SKILL.md`
  from the upstream commit above, copied verbatim except that the YAML
  frontmatter was removed.

Import: zip this folder (SKILL.md plus references/) and upload it in the admin
console (`/admin/image-skills` → 导入 SKILL.md / zip).

---

MIT License

Copyright (c) 2026 LigphiDonk

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
