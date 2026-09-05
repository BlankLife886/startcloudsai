import assert from "node:assert/strict";
import test from "node:test";
import { summarizeGalleryGroup } from "../src/features/text-to-image/galleryGroupState.js";

const item = (kind, status) => ({ kind, task: { status } });

test("failed task without output is a terminal status group", () => {
  const failed = item("status", "failed");
  const group = summarizeGalleryGroup([failed]);
  assert.equal(group.kind, "status");
  assert.equal(group.pendingCount, 0);
  assert.equal(group.statusCount, 1);
  assert.equal(group.cover, failed);
});

test("active task without output remains pending", () => {
  const group = summarizeGalleryGroup([item("pending", "running")]);
  assert.equal(group.kind, "pending");
  assert.equal(group.pendingCount, 1);
  assert.equal(group.statusCount, 0);
});

test("partial success and failure is mixed without pending animation", () => {
  const image = item("image", "completed");
  const group = summarizeGalleryGroup([image, item("status", "failed")]);
  assert.equal(group.kind, "mixed");
  assert.equal(group.imageCount, 1);
  assert.equal(group.pendingCount, 0);
  assert.equal(group.statusCount, 1);
  assert.equal(group.cover, image);
});

test("partial success with active work remains mixed and pending", () => {
  const group = summarizeGalleryGroup([
    item("image", "completed"),
    item("pending", "running"),
  ]);
  assert.equal(group.kind, "mixed");
  assert.equal(group.imageCount, 1);
  assert.equal(group.pendingCount, 1);
  assert.equal(group.statusCount, 0);
});
