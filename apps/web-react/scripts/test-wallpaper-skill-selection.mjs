import assert from "node:assert/strict";
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
