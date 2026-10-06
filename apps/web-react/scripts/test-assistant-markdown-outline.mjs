import assert from "node:assert/strict";
import test from "node:test";
import { markdownOutline, OUTLINE_MIN_CHARS } from "../src/features/assistant/assistantMarkdownEnhance.js";

const filler = "这是一段足够长的正文。".repeat(Math.ceil(OUTLINE_MIN_CHARS / 10));

test("long replies with three or more headings get an outline", () => {
  const outline = markdownOutline(`## 一、**市场**概况\n\n${filler}\n\n### [目标人群](https://x.example)\n\n正文\n\n## 二、竞品\n\n正文`);
  assert.deepEqual(outline, [
    { index: 0, level: 1, title: "一、市场概况" },
    { index: 1, level: 2, title: "目标人群" },
    { index: 2, level: 1, title: "二、竞品" },
  ]);
});

test("short replies and replies with few headings get none", () => {
  assert.deepEqual(markdownOutline("## 一\n\n## 二\n\n## 三"), []);
  assert.deepEqual(markdownOutline(`## 一\n\n${filler}\n\n## 二`), []);
});

test("headings deeper than level three and headings inside code are ignored", () => {
  const outline = markdownOutline(`# 总览\n\n${filler}\n\n#### 细节\n\n\`\`\`md\n## 不是标题\n\`\`\`\n\n## 甲\n\n## 乙`);
  assert.deepEqual(outline.map((item) => [item.level, item.title]), [[1, "总览"], [2, "甲"], [2, "乙"]]);
});
