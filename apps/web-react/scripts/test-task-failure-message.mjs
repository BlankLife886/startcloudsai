import assert from "node:assert/strict";
import test from "node:test";

import { taskFailureMessage } from "../src/features/history/taskFailureMessage.js";

test("uses the concrete upstream failure message", () => {
  assert.equal(
    taskFailureMessage({ status: "failed", errorMessage: "参考图不符合服务政策" }),
    "参考图不符合服务政策",
  );
});

test("supports the legacy job error field", () => {
  assert.equal(
    taskFailureMessage({ status: "failed", error: "上游返回文本，未生成图片" }),
    "上游返回文本，未生成图片",
  );
});

test("redacts internal URLs and identifiers", () => {
  const message = taskFailureMessage({
    errorMessage:
      "request_id=req_private task 4e234871-6802-4f54-9bc0-bdd715449104 failed at http://internal.example/task",
  });
  assert.equal(message.includes("req_private"), false);
  assert.equal(message.includes("4e234871-6802-4f54-9bc0-bdd715449104"), false);
  assert.equal(message.includes("internal.example"), false);
  assert.match(message, /编号已隐藏/);
});

test("falls back to a user-readable error code message", () => {
  assert.equal(
    taskFailureMessage({ errorCode: "upstream_rate_limited" }),
    "生成服务当前繁忙或额度不足，请稍后重试",
  );
});
