import assert from "node:assert/strict";
import test from "node:test";

import { canvasCompressSource, canvasDisplayCandidates, canvasPreviewCandidates, canonicalImageSrc, cloudFileUrl, cloudThumbnailKey, cloudThumbnailUrl, isCloudThumbnailUrl, isHeavyImageSource, isLocalImageKey, isRemoteOriginalSource, storageKeyFromUrl } from "../src/canvas/lib/canvas/canvas-preview-url.ts";

test("derives upload and task thumbnail keys", () => {
    assert.equal(cloudThumbnailKey("uploads/user-1/original/file-9.png"), "uploads/user-1/thumb/file-9.jpg");
    assert.equal(cloudThumbnailKey("/api/v1/files/uploads/user-1/original/file-9.webp"), "uploads/user-1/thumb/file-9.jpg");
    assert.equal(cloudThumbnailKey("tasks/user-1/task-2/original/0-claim.png"), "tasks/user-1/task-2/thumb/0-claim.jpg");
    assert.equal(cloudThumbnailKey("uploads/user-1/thumb/file-9.jpg"), "uploads/user-1/thumb/file-9.jpg");
    assert.equal(cloudThumbnailKey("image:local-only"), "");
});

test("builds file URLs and candidate order", () => {
    assert.equal(cloudThumbnailUrl("uploads/user-1/original/file-9.png"), "/api/v1/files/uploads/user-1/thumb/file-9.jpg");
    assert.equal(storageKeyFromUrl("/api/v1/files/uploads/user-1/original/file-9.png?download=1"), "uploads/user-1/original/file-9.png");
    assert.equal(isCloudThumbnailUrl("/api/v1/files/uploads/user-1/thumb/file-9.jpg"), true);
    assert.deepEqual(canvasDisplayCandidates({ src: "/api/v1/files/uploads/user-1/original/file-9.png", storageKey: "uploads/user-1/original/file-9.png" }), [
        "/api/v1/files/uploads/user-1/thumb/file-9.jpg",
    ]);
    assert.deepEqual(canvasPreviewCandidates({ src: "/api/v1/files/uploads/user-1/original/file-9.png", storageKey: "uploads/user-1/original/file-9.png" }), [
        "/api/v1/files/uploads/user-1/thumb/file-9.jpg",
        "/api/v1/files/uploads/user-1/original/file-9.png",
    ]);
    assert.equal(isHeavyImageSource("/api/v1/files/uploads/user-1/original/file-9.png"), true);
    assert.equal(isHeavyImageSource("/api/v1/files/uploads/user-1/thumb/file-9.jpg"), false);
    assert.equal(isRemoteOriginalSource("/api/v1/files/uploads/user-1/original/file-9.png"), true);
    assert.equal(isRemoteOriginalSource("image:local-only"), false);
    assert.equal(isRemoteOriginalSource("/api/v1/files/uploads/user-1/thumb/file-9.jpg"), false);
    assert.equal(isHeavyImageSource("image:local-only"), true);
    assert.equal(isLocalImageKey("image:local-only"), true);
    assert.equal(cloudFileUrl("uploads/user-1/original/file-9.png"), "/api/v1/files/uploads/user-1/original/file-9.png");
    assert.equal(canonicalImageSrc({ src: "blob:http://127.0.0.1/abc", storageKey: "uploads/user-1/original/file-9.png" }), "/api/v1/files/uploads/user-1/original/file-9.png");
    assert.equal(canonicalImageSrc({ src: "blob:http://127.0.0.1/abc", storageKey: "image:local-only" }), "image:local-only");
    assert.deepEqual(canvasDisplayCandidates({ src: "blob:http://127.0.0.1/abc", storageKey: "uploads/user-1/original/file-9.png" }), [
        "/api/v1/files/uploads/user-1/thumb/file-9.jpg",
    ]);
    assert.deepEqual(
        canvasDisplayCandidates({
            src: "/api/v1/files/uploads/user-1/original/file-9.png",
            storageKey: "uploads/user-1/original/file-9.png",
            thumbnailUrl: "/api/v1/files/uploads/user-1/original/file-9.png",
        }),
        ["/api/v1/files/uploads/user-1/thumb/file-9.jpg"],
    );
    assert.equal(
        canvasCompressSource({ src: "/api/v1/files/uploads/user-1/original/file-9.png", storageKey: "uploads/user-1/original/file-9.png" }),
        "/api/v1/files/uploads/user-1/thumb/file-9.jpg",
    );
    assert.equal(canvasCompressSource({ src: "/api/v1/files/uploads/user-1/original/file-9.png" }), "/api/v1/files/uploads/user-1/thumb/file-9.jpg");
    assert.equal(canvasCompressSource({ src: "https://cdn.example.com/full.png" }), "");
    assert.equal(canvasCompressSource({ src: "image:local-only", storageKey: "image:local-only" }), "image:local-only");
});
