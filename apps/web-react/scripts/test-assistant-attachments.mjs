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

test("keeps a single pasted image when files and items both expose it", () => {
  const named = new File(["png-bytes"], "image.png", { type: "image/png", lastModified: 1 });
  const unnamed = new File(["png-bytes"], "", { type: "", lastModified: 2 });
  Object.defineProperty(unnamed, "type", { value: "" });
  const files = assistantClipboardFiles({
    files: [named],
    items: [{ kind: "file", type: "image/png", getAsFile: () => unnamed }],
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].name, "image.png");
});

test("treats clipboard screenshots with empty MIME type as images", () => {
  const screenshot = new File(["png"], "", { type: "" });
  Object.defineProperty(screenshot, "type", { value: "" });
  const files = assistantClipboardFiles({
    files: [],
    items: [{ kind: "file", type: "image/png", getAsFile: () => screenshot }],
  });
  assert.equal(files.length, 1);
  assert.equal(files[0].type, "image/png");
  assert.match(files[0].name, /^paste-\d+\.png$/);
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
