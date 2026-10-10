# Material Illustration

The `material-illustration` official skill (`SKILL.md` in this folder) is
adapted from 歸藏 (op7418)'s `guizang-material-illustration`:

https://github.com/op7418/guizang-material-illustration

- Upstream commit at integration time: `cf26e19`.
- The upstream repository has no license file. StartCloudsAI integrates it
  with the author's permission (recorded in
  `docs/MATERIAL_ILLUSTRATION_SKILL_PLAN.md`).
- Adaptation: the upstream `SKILL.md` and `references/visual-style.md`,
  `references/prompt-patterns.md`, `references/chart-beautify.md` were
  condensed into a Chinese instruction that an image model can execute
  directly. Agent-only steps (reading reference files, web lookups, image QA,
  file handling) were removed, except for a short section addressed to the
  AI assistant.
- `references/*.md` and `assets/prompt-template.md` are copied verbatim from
  the upstream commit above. They are imported together with `SKILL.md` as a
  zip package (admin → 导入 SKILL.md / zip); the AI assistant reads them on
  demand with the `read_skill_reference` tool. Their "when to read" notes live
  in `SKILL.md` under `metadata.reference-notes`.

The skill is imported into the official skill library from the admin console
(`/admin/image-skills` → 导入 SKILL.md); this folder is the source of truth for
that import. To import, zip this folder (SKILL.md plus references/ and
assets/) and upload the zip.
