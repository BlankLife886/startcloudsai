import assert from "node:assert/strict";
import test from "node:test";

import { assistantClipboardFiles, isImageToPSDRequest, isPSDFile } from "../src/views/assistant-attachments.js";

test("collects pasted documents and images without duplicate clipboard entries", () => {
  const document = { name: "brief.pdf", type: "application/pdf", size: 100, lastModified: 1 };
  const image = { name: "capture.png", type: "image/png", size: 200, lastModified: 2 };
  const files = assistantClipboardFiles({
    files: [document],
    items: [
      { kind: "file", getAsFile: () => document },
      { kind: "file", getAsFile: () => image },
      { kind: "string", getAsFile: () => null },
    ],
  });
  assert.deepEqual(files, [document, image]);
});

test("keeps plain text paste native and recognizes PSD MIME or extension", () => {
  assert.deepEqual(assistantClipboardFiles({ items: [{ kind: "string" }] }), []);
  assert.equal(isPSDFile({ name: "LAYOUT.PSD", type: "application/octet-stream" }), true);
  assert.equal(isPSDFile({ name: "layout.bin", type: "image/vnd.adobe.photoshop" }), true);
  assert.equal(isPSDFile({ name: "photo.png", type: "image/png" }), false);
});

test("recognizes explicit image-to-PSD commands without matching conceptual questions", () => {
  assert.equal(isImageToPSDRequest("把这张图片转换为 PSD", 1), true);
  assert.equal(isImageToPSDRequest("Convert this image to a PSD", 1), true);
  assert.equal(isImageToPSDRequest("图片可以转 PSD 吗？", 1), false);
  assert.equal(isImageToPSDRequest("把这张图片转换为 PSD", 0), false);
});
