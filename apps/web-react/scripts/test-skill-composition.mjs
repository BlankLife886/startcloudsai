import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SKILL_FILE_MAX_BYTES,
  SKILL_INSTRUCTION_MAX_LENGTH,
  SKILL_MAX_MENTIONS_PER_PROMPT,
  SKILL_PROMPT_MAX_LENGTH,
  SKILL_SLUG_MAX_LENGTH,
  SKILL_SLUG_PATTERN,
  SKILL_TASK_TYPES,
  composeSkillPrompt,
  expandSkillMentionsInText,
  findSkillMentions,
  isValidSkillSlug,
  parseSkillMarkdown,
  readSkillFile,
  sanitizeSkillLine,
  sanitizeSkillTags,
  serializeSkillMarkdown,
  skillMentionToken,
  slugifySkillName,
  stripSkillMentions,
} from "../src/features/skills/skillComposition.js";

function skill(partial) {
  return {
    id: partial.id || partial.slug || partial.name,
    slug: partial.slug || "",
    name: partial.name,
    description: partial.description || "",
    instruction: partial.instruction || "",
  };
}

test("skillMentionToken uses the Chinese name and falls back to slug when the name has spaces", () => {
  assert.equal(skillMentionToken({ name: "柔光人像", slug: "soft-portrait" }), "@柔光人像");
  assert.equal(skillMentionToken({ name: "Soft Light", slug: "soft-light" }), "@soft-light");
  assert.equal(skillMentionToken({ name: "Soft/Light", slug: "soft-light" }), "@soft-light");
});

test("findSkillMentions matches @name glued to CJK, ignores a@soft, prefers the longer name, dedupes, and caps at 8", () => {
  const portrait = skill({ id: "long", name: "柔光人像", slug: "soft-portrait", instruction: "长" });
  const soft = skill({ id: "short", name: "柔光", slug: "soft", instruction: "短" });
  const ascii = skill({ id: "ascii", name: "soft", slug: "soft", instruction: "en" });

  const glued = findSkillMentions("@柔光人像一只猫", [soft, portrait]);
  assert.equal(glued.length, 1);
  assert.equal(glued[0].skill.id, "long");
  assert.equal(glued[0].token, "@柔光人像");

  assert.deepEqual(findSkillMentions("a@soft", [ascii]), []);
  assert.deepEqual(findSkillMentions("mail@soft.com", [ascii]), []);

  const bothSpellings = findSkillMentions("@柔光人像 再用 @soft-portrait", [portrait]);
  assert.equal(bothSpellings.length, 1);
  assert.equal(bothSpellings[0].skill.id, "long");

  const many = Array.from({ length: SKILL_MAX_MENTIONS_PER_PROMPT + 2 }, (_, index) =>
    skill({ id: `s${index}`, name: `技能${index}`, slug: `skill-${index}` }),
  );
  const text = many.map((item) => `@${item.name}`).join(" ");
  const capped = findSkillMentions(text, many);
  assert.equal(capped.length, SKILL_MAX_MENTIONS_PER_PROMPT);
  assert.deepEqual(
    capped.map((item) => item.skill.id),
    many.slice(0, SKILL_MAX_MENTIONS_PER_PROMPT).map((item) => item.id),
  );
});

test("stripSkillMentions removes the given tokens and collapses leftover whitespace", () => {
  assert.equal(stripSkillMentions("@柔光人像 一只猫", ["@柔光人像"]), "一只猫");
  assert.equal(stripSkillMentions("  @soft-light 一只猫  ", ["@soft-light"]), "一只猫");
  assert.equal(stripSkillMentions("一只猫 @柔光人像\n\n\n再拍一张", ["@柔光人像"]), "一只猫\n\n再拍一张");
  assert.equal(stripSkillMentions("  一只猫  ", []), "一只猫");
});

test("expandSkillMentionsInText puts skill bodies first and leaves mention-free text alone", () => {
  const skills = [
    skill({ id: "1", name: "柔光人像", slug: "soft-portrait", instruction: "使用柔和顶光" }),
    skill({ id: "2", name: "干净背景", slug: "clean-bg", instruction: "背景纯净" }),
  ];
  assert.deepEqual(expandSkillMentionsInText("@柔光人像 一只猫", skills), {
    prompt: "使用柔和顶光\n\n一只猫",
    skills: [skills[0]],
  });
  assert.deepEqual(expandSkillMentionsInText("@柔光人像 @干净背景 一只猫", skills), {
    prompt: "使用柔和顶光\n\n背景纯净\n\n一只猫",
    skills: skills,
  });
  assert.deepEqual(expandSkillMentionsInText("  一只猫  ", skills), { prompt: "一只猫", skills: [] });
  assert.deepEqual(expandSkillMentionsInText("@未知技能 一只猫", skills), {
    prompt: "@未知技能 一只猫",
    skills: [],
  });
});

test("composeSkillPrompt still drops blank/duplicate skills and keeps the user prompt when overlong", () => {
  assert.equal(composeSkillPrompt("一只猫", [{ instruction: "柔和顶光" }, { instruction: "背景纯净" }]), "柔和顶光\n\n背景纯净\n\n一只猫");
  assert.equal(composeSkillPrompt("一只猫", [{ instruction: "柔和顶光" }, { instruction: "柔和顶光" }]), "柔和顶光\n\n一只猫");
  assert.equal(composeSkillPrompt("一只猫", [{ instruction: "   " }, {}, null, { instruction: "有效" }]), "有效\n\n一只猫");
  const long = "指".repeat(SKILL_PROMPT_MAX_LENGTH - 10);
  const merged = composeSkillPrompt("一只猫", [{ instruction: long }, { instruction: "会被丢掉" }]);
  assert.ok(merged.length <= SKILL_PROMPT_MAX_LENGTH);
  assert.ok(merged.endsWith("一只猫"));
  assert.ok(!merged.includes("会被丢掉"));
});

test("skill slugs stay hyphen-case, letter-first, and at most 64 chars", () => {
  assert.equal(SKILL_SLUG_MAX_LENGTH, 64);
  assert.ok(SKILL_SLUG_PATTERN.test("soft-light"));
  assert.ok(isValidSkillSlug("soft-light"));
  assert.equal(isValidSkillSlug("Soft-Light"), false);
  assert.equal(isValidSkillSlug("100"), false);
  assert.equal(slugifySkillName("Soft Light"), "soft-light");
  assert.equal(slugifySkillName("柔光人像"), "");
  assert.deepEqual(SKILL_TASK_TYPES, ["t2i", "ecommerce_design"]);
});

function snapshot(item) {
  return {
    slug: item.slug || "",
    name: item.name,
    description: item.description,
    instruction: item.instruction,
    tags: item.tags,
    category: item.category || null,
  };
}

test("serializeSkillMarkdown then parseSkillMarkdown round-trips a Chinese display name", () => {
  const source = {
    slug: "soft-light",
    name: "柔光人像",
    description: "柔和顶光，肤色自然",
    instruction: "使用柔和顶光，背景纯净，主体居中。",
    tags: ["人像", "柔光"],
    category: "人像",
  };
  const { skill: parsed, warnings } = parseSkillMarkdown(serializeSkillMarkdown(source));
  assert.deepEqual(snapshot(parsed), snapshot(source));
  assert.deepEqual(warnings, []);
});

test("serializeSkillMarkdown then parseSkillMarkdown round-trips an ASCII display name", () => {
  const source = {
    slug: "soft-light",
    name: "Soft Light Portrait",
    description: 'Soft key light with a "clean" background',
    instruction: "Use soft overhead lighting and keep the subject centered.",
    tags: ["portrait"],
    category: "portrait",
  };
  const { skill: parsed, warnings } = parseSkillMarkdown(serializeSkillMarkdown(source));
  assert.deepEqual(snapshot(parsed), snapshot(source));
  assert.deepEqual(warnings, []);
});

test("parseSkillMarkdown accepts Codex-style folded description and block arrays", () => {
  const folded = `---
name: gsap-core
description: >
  Official GSAP skill for the core API — gsap.to(), from(), fromTo(),
  easing, duration, stagger. Use when the user asks for a JavaScript
  animation library.
metadata:
  display-name: GSAP Core
  tags: ["motion", "gsap"]
  category: "animation"
---

Use gsap.to() for single tweens.
`;
  const { skill, warnings } = parseSkillMarkdown(folded);
  assert.equal(skill.slug, "gsap-core");
  assert.equal(skill.name, "GSAP Core");
  assert.equal(
    skill.description,
    "Official GSAP skill for the core API — gsap.to(), from(), fromTo(), easing, duration, stagger. Use when the user asks for a JavaScript animation library.",
  );
  assert.equal(skill.instruction, "Use gsap.to() for single tweens.");
  assert.deepEqual(skill.tags, ["motion", "gsap"]);
  assert.equal(skill.category, "animation");
  assert.deepEqual(warnings, []);

  const listed = `---
name: 'soft-light'
description: 'It''s a soft key'
metadata:
  display-name: "柔光人像"
  tags:
    - 人像
    - 柔光
  category: |
    人像
    摄影
---

# ignored heading

主体居中，肤色通透。
`;
  const parsed = parseSkillMarkdown(listed);
  assert.equal(parsed.skill.slug, "soft-light");
  assert.equal(parsed.skill.name, "柔光人像");
  assert.equal(parsed.skill.description, "It's a soft key");
  assert.deepEqual(parsed.skill.tags, ["人像", "柔光"]);
  assert.equal(parsed.skill.category, "人像 摄影");
  assert.equal(parsed.skill.instruction, "# ignored heading\n\n主体居中，肤色通透。");
});

test("parseSkillMarkdown strips control / bidi / zero-width characters, clamps lengths and caps tags", () => {
  const long = "好".repeat(SKILL_INSTRUCTION_MAX_LENGTH + 50);
  const md = [
    "---",
    'name: "soft\u202elight"',
    "description: hi\u0007there\u200b",
    "metadata:",
    "  tags: [a, a, b, c, d, e, f, g, h, i, j, k, l]",
    "---",
    "# 标\u200b题\u202e",
    "",
    `${long}\u0000`,
  ].join("\n");
  const { skill: parsed, warnings } = parseSkillMarkdown(md);
  assert.equal(parsed.slug, "softlight");
  assert.equal(parsed.name, "标题");
  assert.equal(parsed.description, "hithere");
  assert.equal(parsed.tags.length, 10);
  assert.equal(Array.from(parsed.instruction).length, SKILL_INSTRUCTION_MAX_LENGTH);
  assert.ok(!parsed.instruction.includes("\u0000"));
  assert.ok(warnings.some((item) => item.includes("截断")));
});

test("sanitizeSkillLine folds whitespace, drops unsafe characters and clamps by code point", () => {
  assert.equal(sanitizeSkillLine("  a\u202eb\n\tc  ", 10), "ab c");
  assert.equal(sanitizeSkillLine("😀😀😀😀", 2), "😀😀");
  assert.deepEqual(sanitizeSkillTags(" 人像 ，人像,, \u202e ,b "), ["人像", "b"]);
});

test("readSkillFile rejects wrong extensions, oversized files and binary content", async () => {
  const file = (name, content, type = "text/markdown") => ({
    name,
    type,
    size: content.length,
    text: async () => content,
  });
  await assert.rejects(readSkillFile(file("skill.exe", "x")), /只支持/);
  await assert.rejects(readSkillFile(file("skill.md", "x", "image/png")), /文本/);
  await assert.rejects(readSkillFile({ ...file("skill.md", "x"), size: SKILL_FILE_MAX_BYTES + 1 }), /超过/);
  await assert.rejects(readSkillFile(file("skill.md", "a\u0000b")), /二进制/);
  assert.equal(await readSkillFile(file("SKILL.MD", "\uFEFF# ok", "")), "# ok");
});
