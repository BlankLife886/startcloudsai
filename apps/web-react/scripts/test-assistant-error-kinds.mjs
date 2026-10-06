import assert from "node:assert/strict";
import test from "node:test";
import { assistantErrorKind } from "../src/features/assistant/domain/assistantErrorKinds.js";

const kindOf = (error) => assistantErrorKind({ role: "assistant", error })?.kind;

test("errors are grouped by what the user can do about them", () => {
  assert.equal(kindOf("积分不足，本次需要 40 积分"), "balance");
  assert.equal(kindOf("提示词包含敏感内容，未通过审核"), "moderation");
  assert.equal(kindOf("图片生成超过 5 分钟仍未完成，请重试或切换图片模型"), "timeout");
  assert.equal(kindOf("当前助手任务较多，请稍后再试；你的输入不会丢失"), "busy");
  assert.equal(kindOf("assistant reference \"x\" cannot be decoded"), "upload");
  assert.equal(kindOf("所选模型暂不可用"), "model");
  assert.equal(kindOf("网络连接中断"), "network");
  assert.equal(kindOf("something odd"), "unknown");
});

test("each kind offers its actions and keeps the original message", () => {
  const balance = assistantErrorKind({ error: "余额不足" });
  assert.deepEqual(balance.actions, ["recharge", "retry"]);
  assert.equal(balance.detail, "余额不足");
  assert.deepEqual(assistantErrorKind({ error: "审核未通过" }).actions, ["edit"]);
});

test("replies without an error get no card; a failed stage without text gets a generic one", () => {
  assert.equal(assistantErrorKind({ content: "好的" }), null);
  const failed = assistantErrorKind({ statusStage: "failed" });
  assert.equal(failed.kind, "unknown");
  assert.match(failed.detail, /没有完成/);
});
