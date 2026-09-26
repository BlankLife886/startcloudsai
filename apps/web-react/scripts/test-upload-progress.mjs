import assert from "node:assert/strict";
import test from "node:test";

import { apiUploadRequest } from "../src/legacy-modules/services/apiClient.js";

test("reports multipart upload bytes before waiting for the server response", async () => {
  const previous = globalThis.XMLHttpRequest;
  const progress = [];
  class MockXMLHttpRequest {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = "";
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    send(body) {
      this.body = body;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 40, total: 100 });
      this.upload.onload?.({ lengthComputable: true, loaded: 100, total: 100 });
      this.status = 200;
      this.responseText = JSON.stringify({ success: true, data: { key: "uploads/test.webp" } });
      this.onload?.();
    }

    abort() {
      this.onabort?.();
    }
  }

  globalThis.XMLHttpRequest = MockXMLHttpRequest;
  try {
    const body = new FormData();
    body.append("file", new Blob(["image"]), "reference.webp");
    const result = await apiUploadRequest("/uploads", {
      body,
      onProgress: (value) => progress.push(value),
    });
    assert.deepEqual(result, { key: "uploads/test.webp" });
    assert.deepEqual(progress.map(({ percent, done }) => ({ percent, done })), [
      { percent: 40, done: false },
      { percent: 100, done: true },
    ]);
  } finally {
    if (previous === undefined) delete globalThis.XMLHttpRequest;
    else globalThis.XMLHttpRequest = previous;
  }
});
