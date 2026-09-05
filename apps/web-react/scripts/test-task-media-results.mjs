import assert from "node:assert/strict";
import test from "node:test";
import { resolveTaskMedia } from "../src/features/task-media/taskMediaResults.js";

test("keeps originals as outputs and maps thumbnails without duplicating them", () => {
  const media = resolveTaskMedia({
    originalMediaUrls: ["/original/a.png", "/original/b.png"],
    resultMediaUrls: ["/thumb/a.webp", "/thumb/b.webp"],
    displayMediaUrls: ["/display/a.webp", "/display/b.webp"],
  });

  assert.deepEqual(media.urls, ["/original/a.png", "/original/b.png"]);
  assert.equal(media.previewByUrl["/original/a.png"], "/thumb/a.webp");
  assert.equal(media.displayByUrl["/original/b.png"], "/display/b.webp");
});

test("uses completed result outputs before thumbnail-only fallbacks", () => {
  const media = resolveTaskMedia(
    { resultMediaUrls: ["/thumb/a.webp"] },
    { outputs: ["/original/a.png"] },
  );

  assert.deepEqual(media.urls, ["/original/a.png"]);
  assert.equal(media.previewByUrl["/original/a.png"], "/thumb/a.webp");
});

test("supports singular legacy fields and structured result values", () => {
  const singular = resolveTaskMedia({ resultMediaUrl: "/legacy/thumb.png" });
  const structured = resolveTaskMedia({}, { outputs: [{ url: "/result/a.png" }] });

  assert.deepEqual(singular.urls, ["/legacy/thumb.png"]);
  assert.deepEqual(structured.urls, ["/result/a.png"]);
});
