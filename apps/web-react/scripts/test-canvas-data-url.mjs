import assert from "node:assert/strict";
import test from "node:test";

import { dataUrlToBlob } from "../src/canvas/lib/data-url.ts";

test("decodes a base64 image data URL without fetch", async () => {
    const blob = dataUrlToBlob("data:image/png;base64,iVBORw0KGgo=");
    assert.equal(blob.type, "image/png");
    assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("decodes a percent-encoded data URL", async () => {
    const blob = dataUrlToBlob("data:text/plain;charset=utf-8,%E6%98%9F%E7%A9%BA");
    assert.equal(blob.type, "text/plain");
    assert.equal(await blob.text(), "星空");
});

test("rejects malformed data URLs", () => {
    assert.throws(() => dataUrlToBlob("https://example.com/image.png"), /Invalid data URL/);
});
