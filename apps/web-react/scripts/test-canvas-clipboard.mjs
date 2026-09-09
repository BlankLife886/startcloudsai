import assert from "node:assert/strict";
import test from "node:test";

import { canvasClipboardImages } from "../src/canvas/lib/canvas/canvas-clipboard.ts";

test("reads a screenshot exposed only through clipboard files", () => {
    const screenshot = new File(["png"], "Screenshot.png", { type: "image/png" });

    assert.deepEqual(canvasClipboardImages({ files: [screenshot], items: [] }), [screenshot]);
});

test("reads and normalizes a screenshot exposed only through clipboard items", () => {
    const screenshot = new File(["png"], "", { type: "" });
    const images = canvasClipboardImages({
        files: [],
        items: [{ kind: "file", type: "image/png", getAsFile: () => screenshot }],
    });

    assert.equal(images.length, 1);
    assert.equal(images[0].type, "image/png");
    assert.match(images[0].name, /^paste-\d+\.png$/);
});

test("deduplicates a screenshot exposed through files and items", () => {
    const named = new File(["same-image"], "Screenshot.png", { type: "image/png" });
    const unnamed = new File(["same-image"], "", { type: "" });
    const images = canvasClipboardImages({
        files: [named],
        items: [{ kind: "file", type: "image/png", getAsFile: () => unnamed }],
    });

    assert.deepEqual(images, [named]);
});

test("ignores non-image clipboard files and null item files", () => {
    const document = new File(["text"], "brief.txt", { type: "text/plain" });
    const images = canvasClipboardImages({
        files: [document],
        items: [
            { kind: "string", type: "text/plain", getAsFile: () => null },
            { kind: "file", type: "image/png", getAsFile: () => null },
        ],
    });

    assert.deepEqual(images, []);
});

test("infers the correct MIME type from an image filename", () => {
    const jpeg = new File(["jpeg"], "capture.jpg", { type: "application/octet-stream" });
    const [image] = canvasClipboardImages({ files: [jpeg] });

    assert.equal(image.type, "image/jpeg");
    assert.equal(image.name, "capture.jpg");
});
