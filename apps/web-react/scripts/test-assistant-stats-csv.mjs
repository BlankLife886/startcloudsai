import assert from "node:assert/strict";
import test from "node:test";
import { statsCsv, statsCsvFilename } from "../src/features/assistant/domain/assistantStatsCsv.js";

const data = {
  range: { from: "2026-10-01", to: "2026-10-31", label: "本月" },
  metrics: [{ id: "spend_points", label: "消耗积分", unit: "积分" }, { id: "images", label: "图片数" }],
  dimensions: [{ id: "workspace", label: "功能" }],
  rows: [
    { labels: { workspace: "AI 电商" }, values: { spend_points: 180, images: 12 }, previous: { spend_points: 150, images: 10 } },
    { labels: { workspace: "海报, 横版" }, values: { spend_points: 60.456, images: 3 } },
  ],
  totals: { spend_points: 240.456, images: 15 },
  previousTotals: { spend_points: 200, images: 13 },
};

test("rows, comparison columns and a total line, Excel friendly", () => {
  const lines = statsCsv(data).replace(/^﻿/, "").split("\n");
  assert.deepEqual(lines, [
    "功能,消耗积分（积分）,图片数,上期消耗积分（积分）,上期图片数",
    "AI 电商,180,12,150,10",
    "\"海报, 横版\",60.46,3,,",
    "合计,240.46,15,200,13",
  ]);
  assert.ok(statsCsv(data).startsWith("﻿"));
});

test("totals only when there is no grouping", () => {
  const lines = statsCsv({ ...data, dimensions: [], rows: [], previousTotals: undefined }).replace(/^﻿/, "").split("\n");
  assert.deepEqual(lines, ["消耗积分（积分）,图片数", "240.46,15"]);
});

test("the file name carries the range", () => {
  assert.equal(statsCsvFilename(data), "我的统计_2026-10-01_2026-10-31.csv");
});
