import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { taskCoverUrl, taskDisplayUrl, taskOriginalUrl } from "../src/legacy-modules/features/creator-hub/taskMedia.js";

test("history table uses the original when a completed task has no thumbnail", () => {
  const task = {
    originalUrls: ["/api/v1/files/tasks/user/task/original/1.png"],
    displayUrls: ["/api/v1/files/tasks/user/task/display/1"],
    thumbnailUrls: ["/api/v1/files/tasks/user/task/original/1.png"],
    thumbnailKeys: [],
  };
  assert.equal(taskOriginalUrl(task), task.originalUrls[0]);
  assert.equal(taskDisplayUrl(task), task.displayUrls[0]);
  assert.equal(taskCoverUrl(task), task.originalUrls[0]);
});

test("history view independently reads metadata and falls back to the original", async () => {
  const source = await readFile(new URL("../src/views/HistoryView.jsx", import.meta.url), "utf8");
  assert.match(source, /const tableCoverSrc = \(task\) => taskCoverUrl\(task\)/);
  assert.match(source, /visibleTasks\.slice\(0, 24\)\.forEach\(\(task\) => void ensureMetadata\(task\)\)/);
  assert.match(source, /fallbackSrc=\{\s*taskOriginalUrl\(task\)\s*\}/);
});
