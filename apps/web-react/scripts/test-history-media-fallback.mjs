import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { taskCoverUrl, taskDisplayUrl, taskOriginalUrl } from "../src/legacy-modules/features/creator-hub/taskMedia.js";
import {
  historyTaskCanOpen,
  historyTaskDurationLabel,
  historyTaskDurationMs,
  historyTaskStatus,
} from "../src/features/history/historyTaskPresentation.js";
import { taskFailureMessage } from "../src/features/history/taskFailureMessage.js";

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

test("history presents failed and canceled image tasks as distinct terminal states", () => {
  assert.equal(historyTaskStatus({ status: "cancelled" }), "canceled");
  assert.equal(historyTaskCanOpen({ status: "failed" }, false), true);
  assert.equal(historyTaskCanOpen({ status: "canceled" }, false), true);
  assert.equal(historyTaskCanOpen({ status: "queued" }, false), false);
});

test("history duration uses real generation timestamps instead of queue time", () => {
  const task = {
    status: "failed",
    createdAt: "2026-08-29T10:00:00.000Z",
    startedAt: "2026-08-29T10:00:05.000Z",
    finishedAt: "2026-08-29T10:01:12.000Z",
  };
  assert.equal(historyTaskDurationMs(task), 67_000);
  assert.equal(historyTaskDurationLabel(task), "1分7秒");
  assert.equal(
    historyTaskDurationLabel({ status: "canceled", createdAt: task.createdAt, finishedAt: task.finishedAt }),
    "未开始生成",
  );
  assert.equal(historyTaskDurationLabel({ status: "queued" }), "等待开始");
});

test("history translates known upstream timeout boilerplate but preserves unknown details", () => {
  assert.equal(
    taskFailureMessage({ errorCode: "image_poll_timeout", errorMessage: "image_poll_timeout: Image generation timed out. Please try again." }),
    "图片生成超时，请稍后重试",
  );
  assert.equal(
    taskFailureMessage({ errorCode: "upstream_error", errorMessage: "上游拒绝：提示词触发安全策略" }),
    "上游拒绝：提示词触发安全策略",
  );
});

test("history view independently reads metadata and falls back to the original", async () => {
  const source = await readFile(new URL("../src/views/HistoryView.jsx", import.meta.url), "utf8");
  assert.match(source, /const tableCoverSrc = \(task\) => taskCoverUrl\(task\)/);
  assert.match(source, /visibleTasks\.slice\(0, 24\)\.forEach\(\(task\) => void ensureMetadata\(task\)\)/);
  assert.match(source, /fallbackSrc=\{\s*taskOriginalUrl\(task\)\s*\}/);
  assert.match(source, /<th className="is-duration">生成耗时<\/th>/);
  assert.match(source, /className="ch-history-card__duration"/);
  assert.doesNotMatch(source, /const cardMediaLabel =/);
  assert.match(source, /historyTaskStatus\(preview\) === "canceled" \? "取消原因" : "失败原因"/);
});
