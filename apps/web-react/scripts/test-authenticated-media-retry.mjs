import assert from "node:assert/strict";
import test from "node:test";

import {
  clearAuthenticatedMediaCache,
  fetchAuthenticatedMediaBlob,
  isRetryableAuthenticatedMediaError,
  resolveAuthenticatedMediaUrl,
} from "../src/legacy-modules/services/authenticatedMedia.js";

test("soft missing previews rely on server cache headers and remain retryable", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return new Response(null, {
      status: 204,
      headers: { "X-StarCloud-Media-Missing": "1" },
    });
  };

  try {
    await assert.rejects(
      fetchAuthenticatedMediaBlob("/api/v1/files/uploads/user/thumb/missing.jpg", {
        softMissing: true,
      }),
      (error) => {
        assert.equal(error.status, 404);
        assert.equal(isRetryableAuthenticatedMediaError(error), true);
        return true;
      },
    );
    assert.match(request.url, /[?&]soft_missing=1(?:&|$)/);
    assert.equal(request.options.cache, "default");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authentication failures remain terminal", () => {
  assert.equal(isRetryableAuthenticatedMediaError({ status: 401 }), false);
  assert.equal(isRetryableAuthenticatedMediaError({ status: 403 }), false);
  assert.equal(isRetryableAuthenticatedMediaError({ status: 404 }), false);
  assert.equal(isRetryableAuthenticatedMediaError({ status: 500 }), true);
  assert.equal(isRetryableAuthenticatedMediaError(new TypeError("network")), true);
  assert.equal(isRetryableAuthenticatedMediaError({ name: "AbortError" }), false);
});

test("a failed shared request is removed before the next retry", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let requests = 0;
  globalThis.window = { setTimeout };
  globalThis.fetch = async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(null, {
        status: 204,
        headers: { "X-StarCloud-Media-Missing": "1" },
      });
    }
    return new Response(new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), {
      status: 200,
      headers: { "Content-Type": "image/png" },
    });
  };

  try {
    const url = "/api/v1/files/uploads/user/thumb/eventually-visible.jpg";
    await assert.rejects(resolveAuthenticatedMediaUrl(url));
    const objectUrl = await resolveAuthenticatedMediaUrl(url);
    assert.match(objectUrl, /^blob:/);
    assert.equal(requests, 2);
  } finally {
    clearAuthenticatedMediaCache();
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});
