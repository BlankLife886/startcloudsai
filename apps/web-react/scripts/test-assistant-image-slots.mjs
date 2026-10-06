import assert from "node:assert/strict";
import test from "node:test";
import { imageSlots, missingImageSlots } from "../src/features/assistant/domain/assistantImageSlots.js";

const done = (images, count, extra = {}) => ({ role: "assistant", kind: "image", status: "complete", pending: false, images, count, ...extra });

test("images land in their own slot, even when a later one finished first", () => {
  const slots = imageSlots({ images: [{ id: "c", index: 2 }, { id: "a", index: 0 }], count: 4 });
  assert.deepEqual(slots.map((slot) => slot.image?.id || null), ["a", null, "c", null]);
});

test("older images without an index fill slots in order", () => {
  assert.deepEqual(imageSlots({ images: [{ id: "a" }, { id: "b" }], count: 3 }).map((slot) => slot.image?.id || null), ["a", "b", null]);
});

test("a finished batch reports which slots are missing", () => {
  assert.deepEqual(missingImageSlots(done([{ index: 0 }, { index: 3 }], 4)), [1, 2]);
  assert.deepEqual(missingImageSlots(done([{ index: 0 }], 1)), []);
});

test("nothing is missing while generating, after a failure, or outside image replies", () => {
  assert.deepEqual(missingImageSlots(done([], 2, { pending: true })), []);
  assert.deepEqual(missingImageSlots(done([], 2, { error: "超时" })), []);
  assert.deepEqual(missingImageSlots(done([], 2, { kind: "chat" })), []);
});
