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
import {
  HISTORY_CANVAS_SOURCE,
  historyTaskDeleteTarget,
  historyTaskQueryScope,
  historyScopeMayRequireForceMediaRemoval,
  historyTaskRequiresForceMediaRemoval,
} from "../src/features/history/historyTaskQuery.js";
import { taskFailureMessage } from "../src/features/history/taskFailureMessage.js";

test("history table uses the server-derived thumbnail for an old completed task", () => {
  const task = {
    originalUrls: ["/api/v1/files/tasks/user/task/original/1.png"],
    displayUrls: ["/api/v1/files/tasks/user/task/display/1"],
    thumbnailUrls: ["/api/v1/files/tasks/user/task/original/1.png"],
    thumbnailKeys: [],
  };
  assert.equal(taskOriginalUrl(task), task.originalUrls[0]);
  assert.equal(taskDisplayUrl(task), task.displayUrls[0]);
  assert.equal(taskCoverUrl(task), task.thumbnailUrls[0]);
});

test("history falls back to the original when neither keys nor derived thumbnail URL exist", () => {
  const original = "/api/v1/files/tasks/user/task/original/1.png";
  assert.equal(taskCoverUrl({ originalUrls: [original], thumbnailKeys: [], thumbnailUrls: [] }), original);
});

test("history only opens records that have preview media", () => {
  assert.equal(historyTaskStatus({ status: "cancelled" }), "canceled");
  assert.equal(historyTaskCanOpen({ status: "failed" }, false), false);
  assert.equal(historyTaskCanOpen({ status: "canceled" }, false), false);
  assert.equal(historyTaskCanOpen({ status: "queued" }, false), false);
  assert.equal(historyTaskCanOpen({ status: "succeeded" }, true), true);
  assert.equal(historyTaskCanOpen({ status: "failed" }, true), true);
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

test("history bulk actions use the same task scope as the selected type tab", () => {
  assert.deepEqual(historyTaskQueryScope(""), {
    type: "",
    excludeSource: "",
    source: "",
  });
  assert.deepEqual(historyTaskQueryScope(HISTORY_CANVAS_SOURCE), {
    type: "",
    excludeSource: "",
    source: HISTORY_CANVAS_SOURCE,
  });
  assert.deepEqual(historyTaskQueryScope("t2i"), {
    type: "t2i",
    excludeSource: HISTORY_CANVAS_SOURCE,
    source: "",
  });
  assert.deepEqual(historyTaskQueryScope("background_remove"), {
    type: "background_remove",
    excludeSource: HISTORY_CANVAS_SOURCE,
    source: "",
  });
  assert.deepEqual(historyTaskQueryScope("ui_design"), {
    type: "ui_design",
    excludeSource: "",
    source: "",
  });
});

test("history deletion routes all terminal records through the task endpoint", () => {
  assert.deepEqual(
    historyTaskDeleteTarget({
      id: "run-1",
      type: "assistant",
      status: "failed",
      params: { assistantMessageId: "message-1" },
    }),
    { kind: "task", id: "run-1" },
  );
  assert.deepEqual(
    historyTaskDeleteTarget({ id: "task-1", type: "t2i", status: "succeeded" }),
    { kind: "task", id: "task-1" },
  );
  assert.deepEqual(
    historyTaskDeleteTarget({ id: "gallery-1", type: "assistant", status: "succeeded" }),
    { kind: "task", id: "gallery-1" },
  );
  assert.equal(
    historyTaskDeleteTarget({ id: "task-2", type: "t2i", status: "running" }),
    null,
  );
});

test("history requires explicit force removal for assistant and canvas media", () => {
  assert.equal(historyTaskRequiresForceMediaRemoval({ type: "assistant" }), true);
  assert.equal(
    historyTaskRequiresForceMediaRemoval({
      type: "t2i",
      params: { _source: HISTORY_CANVAS_SOURCE },
    }),
    true,
  );
  assert.equal(historyTaskRequiresForceMediaRemoval({ type: "t2i" }), false);
  assert.equal(historyScopeMayRequireForceMediaRemoval(""), true);
  assert.equal(historyScopeMayRequireForceMediaRemoval("assistant"), true);
  assert.equal(
    historyScopeMayRequireForceMediaRemoval(HISTORY_CANVAS_SOURCE),
    true,
  );
  assert.equal(historyScopeMayRequireForceMediaRemoval("ui_design"), false);
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
  assert.doesNotMatch(source, /visibleTasks\.slice\(0, 24\)\.forEach[^;]*ensureMetadata/);
  assert.doesNotMatch(source, /retryCount=\{2\}\s+keepLoaded/);
  assert.match(source, /fallbackSrc=\{taskDisplayUrl\(task\) \|\| taskOriginalUrl\(task\)\}/);
  assert.match(source, /<th className="is-duration">生成耗时<\/th>/);
  assert.match(source, /className="ch-history-card__duration"/);
  assert.doesNotMatch(source, /const cardMediaLabel =/);
  assert.match(source, /historyTaskStatus\(preview\) === "canceled" \? "取消原因" : "失败原因"/);
});
