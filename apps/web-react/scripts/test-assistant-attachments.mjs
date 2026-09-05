import assert from "node:assert/strict";
import test from "node:test";

import { assistantClipboardFiles, isImageToPSDRequest, isPSDFile } from "../src/features/assistant/domain/assistantAttachments.js";
import { assistantSendMode } from "../src/features/assistant/domain/assistantMessages.js";
import { promptNeedsRecentVisual, resolveVisualContext } from "../src/features/assistant/domain/visualContext.js";

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

test("only reuses conversation images when the prompt explicitly points to visual history", () => {
  for (const prompt of ["创建一张蓝天白云图", "设计一个全新的 logo", "画一张星空下的雪山"]) {
    assert.equal(promptNeedsRecentVisual(prompt), false, prompt);
  }
  for (const prompt of ["把上一张的背景换成蓝色", "参考图2的构图生成一个新版本", "把图片中的人物头发改成红色", "布局也要改一下，要美观", "再优化一下这个弹窗", "继续调整", "不太满意，再更新一版", "再来一版"]) {
    assert.equal(promptNeedsRecentVisual(prompt), true, prompt);
  }
});

test("visual iteration inherits the latest generated image instead of an older upload", () => {
  const originalUpload = { id: "upload-1", dataUrl: "/api/v1/files/uploads/original.png" };
  const firstResult = { id: "result-1", dataUrl: "/api/v1/files/tasks/first-result.png" };
  const conversation = {
    messages: [
      { id: "user-1", role: "user", content: "优化这个弹窗", referenceImages: [originalUpload] },
      { id: "assistant-1", role: "assistant", kind: "image", images: [firstResult] },
      { id: "user-2", role: "user", content: "布局也要改一下，要美观", referenceImages: [] },
    ],
  };

  assert.deepEqual(resolveVisualContext(conversation, "布局也要改一下，要美观", 4), [firstResult]);
  assert.deepEqual(resolveVisualContext(conversation, "不太满意，再更新一版", 4), [firstResult]);
  assert.deepEqual(resolveVisualContext(conversation, "换个感觉", 4, { force: true }), [firstResult]);
  assert.deepEqual(resolveVisualContext(conversation, "创建一张蓝天白云图", 4), []);
});

test("routes explicit image and workspace actions from Q&A mode through the agent", () => {
  for (const prompt of [
    "画一张星空下的雪山桌面壁纸",
    "请帮我设计一个简洁的品牌图标",
    "帮我画一只猫",
    "你能帮我生成一个 logo 吗？",
    "Could you draw a cat for me?",
    "先分析这张图，然后生成一张产品海报",
    "分析这张图然后再生成一张产品海报",
    "生成三张复古卧室人像",
    "把这张图片的背景换成夜景",
    "Remove the background from this photo",
    "请联网搜索今天的官方消息",
    "查询我最近失败的生图任务",
    "把这张图发送到无限画布",
    "打开素材库",
    "搜索三张产品参考图",
    "给这个网页截图",
    "导入这个商品链接到 AI 电商",
    "复刻这张参考图为可编辑工作流",
    "把本次图片打包为 ZIP 交付包",
  ]) {
    assert.equal(assistantSendMode("chat", 0, prompt), "agent", prompt);
  }
});

test("keeps documents, small talk, negated image work, and image-domain questions in chat", () => {
  assert.equal(assistantSendMode("chat", 1, "总结这份文档"), "chat");
  assert.equal(assistantSendMode("chat", 1, "你好"), "chat");
  for (const prompt of [
    "你好",
    "只回答，不要生图",
    "不要修改图片，帮我描述一下",
    "解释图片数据库设计",
    "如何设计图片数据库",
    "图片生成模型是什么原理？",
    "帮我分析这张照片拍得怎么样",
    "这个画面很好看",
    "优化图片加载性能",
    "图片搜索算法如何设计",
    "Explain how to design an image database",
    "你会生成图片吗？",
    "如何生成一张海报？",
  ]) {
    assert.equal(assistantSendMode("chat", 0, prompt), "chat", prompt);
  }
  assert.equal(assistantSendMode("chat", 0, "不要生成旧方案，生成一张新的海报"), "agent");
});

test("routes document-backed compound work through the agent", () => {
  assert.equal(assistantSendMode("chat", 1, "读取附件，联网核对最新资料并导出 CSV"), "agent");
  assert.equal(assistantSendMode("chat", 1, "根据附件生成一张产品海报"), "agent");
  assert.equal(assistantSendMode("agent", 1, "分析附件并给出执行建议"), "agent");
  assert.equal(assistantSendMode("image", 1, "根据这份品牌规范制作视觉稿"), "agent");
});
