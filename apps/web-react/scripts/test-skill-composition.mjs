import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SKILL_GLOBAL_SCOPE,
  SKILL_PROMPT_MAX_LENGTH,
  SKILL_TASK_TYPES,
  composeSkillPrompt,
  resolveBoundSkillIds,
  skillAppliesTo,
} from "../src/features/skills/skillComposition.js";

test("skill instructions land before the user prompt so the user's ask stays last", () => {
  const skills = [{ instruction: "柔和顶光" }, { instruction: "背景纯净" }];
  assert.equal(composeSkillPrompt("一只猫", skills), "柔和顶光\n\n背景纯净\n\n一只猫");
  // 没有 Skill 时原样返回，且收敛首尾空白。
  assert.equal(composeSkillPrompt("  一只猫  ", []), "一只猫");
  // 用户没写提示词时只拼 Skill，不留下空段。
  assert.equal(composeSkillPrompt("", skills), "柔和顶光\n\n背景纯净");
});

test("a skill loaded both globally and per page is not duplicated", () => {
  const skills = [{ instruction: "柔和顶光" }, { instruction: "柔和顶光" }, { instruction: "背景纯净" }];
  assert.equal(composeSkillPrompt("一只猫", skills), "柔和顶光\n\n背景纯净\n\n一只猫");
});

test("blank and malformed skills never inject empty segments", () => {
  const skills = [{ instruction: "   " }, {}, null, { instruction: "有效" }];
  assert.equal(composeSkillPrompt("一只猫", skills), "有效\n\n一只猫");
  assert.equal(composeSkillPrompt("一只猫", null), "一只猫");
});

test("overlong merges drop skills from the end and always keep the user prompt", () => {
  const long = "指".repeat(SKILL_PROMPT_MAX_LENGTH - 10);
  const merged = composeSkillPrompt("一只猫", [{ instruction: long }, { instruction: "会被丢掉" }]);
  assert.ok(merged.length <= SKILL_PROMPT_MAX_LENGTH);
  assert.ok(merged.endsWith("一只猫"), "用户输入必须保留");
  assert.ok(!merged.includes("会被丢掉"), "超长时应从后往前丢 Skill");

  // 连一个 Skill 都放不下时，退回纯用户输入。
  const tooLong = "指".repeat(SKILL_PROMPT_MAX_LENGTH + 100);
  assert.equal(composeSkillPrompt("一只猫", [{ instruction: tooLong }]), "一只猫");
});

test("page bindings fully override global instead of stacking", () => {
  const bindings = {
    [SKILL_GLOBAL_SCOPE]: ["g1", "g2"],
    t2i: ["p1"],
  };
  assert.deepEqual(resolveBoundSkillIds(bindings, "t2i"), ["p1"]);
  assert.deepEqual(resolveBoundSkillIds(bindings, "coloring"), ["g1", "g2"]);
  assert.deepEqual(resolveBoundSkillIds({}, "t2i"), []);
});

test("a skill with no taskTypes applies everywhere, including global", () => {
  const universal = { taskTypes: [] };
  const t2iOnly = { taskTypes: ["t2i"] };
  assert.equal(skillAppliesTo(universal, SKILL_GLOBAL_SCOPE), true);
  assert.equal(skillAppliesTo(universal, "t2i"), true);
  assert.equal(skillAppliesTo(t2iOnly, SKILL_GLOBAL_SCOPE), true);
  assert.equal(skillAppliesTo(t2iOnly, "t2i"), true);
  assert.equal(skillAppliesTo(t2iOnly, "coloring"), false);
  assert.deepEqual(SKILL_TASK_TYPES, [
    "t2i",
    "coloring",
    "ui_design",
    "ecommerce_design",
    "model_sheet",
    "game_art",
  ]);
});
