# Xiaohei Illustrations

The `xiaohei-illustrations` official skill (`SKILL.md` in this folder) is
adapted from Ian's **Ian Xiaohei Illustrations**:

https://github.com/helloianneo/ian-xiaohei-illustrations

- Upstream commit at integration time: `4102eb8`.
- License: MIT License (full text below). The upstream NOTICE asks derived
  work to keep the `Ian Xiaohei Illustrations` name or attribute Ian; the
  attribution is kept in the skill description and in this file. "小黑" is part
  of Ian's visual language; the character definition is kept unchanged.
  Author: https://github.com/helloianneo · https://ianneo.xyz
- Adaptation: the upstream `SKILL.md` was rewritten as a Chinese instruction an
  image model can execute directly, plus a last section mapping the upstream
  workflow to StarClouds assistant tools (`files_read`, `webpage_capture`,
  `propose_image_action`, `delivery_export`). Saving files into a local
  workspace was dropped. The example images in `assets/examples/` are not
  imported.
- `references/*.md` are copied verbatim from the upstream commit above.
- The `content-illustration` skill (adapted from cc2image) does not carry its
  own copy of the Xiaohei style; users are pointed to this skill instead.

Import: zip this folder (SKILL.md plus references/) and upload it in the admin
console (`/admin/image-skills` → 导入 SKILL.md / zip).

---

MIT License

Copyright (c) 2026 Ian

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
