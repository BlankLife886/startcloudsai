# Handdrawn PPT

The `handdrawn-ppt` official skill (`SKILL.md` in this folder) is adapted from
Ian's **Ian Handdrawn PPT**:

https://github.com/helloianneo/ian-handdrawn-ppt

- Upstream commit at integration time: `306d824`.
- License: MIT License, Copyright (c) 2026 Ian. The upstream NOTICE asks
  derived work to keep the `Ian Handdrawn PPT` name or attribute Ian; the
  attribution is kept in the skill description and in this file.
  Author: https://github.com/helloianneo · https://ianneo.xyz
- Adaptation: the upstream `SKILL.md` was rewritten in Chinese. The first part
  is a style instruction an image model can execute directly; the last section
  maps the upstream workflow to StarClouds assistant tools (`files_read`,
  `ask_choices`, `propose_image_action`, `delivery_export`). Steps that depend
  on a local agent (saving files, contact sheets, image-size normalization,
  deterministic text overlay, the style-anchor PNG) were dropped.
- `references/*.md` are copied verbatim from the upstream commit above.
  `assets/theme-tokens.md` wraps the upstream `assets/theme-tokens.json`
  unchanged in a Markdown code block (the skill library only stores `.md` /
  `.txt`). The style-anchor PNG is not imported yet.

Import: zip this folder (SKILL.md plus references/ and assets/) and upload it
in the admin console (`/admin/image-skills` → 导入 SKILL.md / zip).

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
