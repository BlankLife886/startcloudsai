import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeSelectedWallpaperSkillIds } from "../src/legacy-modules/features/ai-wallpaper/skills/wallpaperSkillSelection.js";

const skills = [
  { id: "prompt-architect" },
  { id: "preserve-4k-upscale" },
];

test("wallpaper skills default to no selection", () => {
  assert.deepEqual(normalizeSelectedWallpaperSkillIds(undefined, skills), []);
});

test("wallpaper skill selection restores valid unique ids", () => {
  assert.deepEqual(
    normalizeSelectedWallpaperSkillIds(
      ["prompt-architect", "removed-skill", "prompt-architect", "none", "preserve-4k-upscale"],
      skills,
    ),
    ["prompt-architect", "preserve-4k-upscale"],
  );
});

test("retired portrait director id is dropped from old drafts without breaking selection", () => {
  // 人像导演已改为官方技能（@人像导演），文生图内置开关里不再有它。
  // wallpaperSkills.js 带 `?raw` 导入，Node 里加载不了，直接查源码。
  const source = readFileSync(
    new URL("../src/legacy-modules/features/ai-wallpaper/skills/wallpaperSkills.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("female-portrait-director"), false);
  assert.deepEqual(
    normalizeSelectedWallpaperSkillIds(["female-portrait-director", "prompt-architect"], skills),
    ["prompt-architect"],
  );
});
