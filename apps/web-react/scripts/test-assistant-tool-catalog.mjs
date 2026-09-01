import assert from "node:assert/strict";
import test from "node:test";
import { TOOL_GROUPS } from "../src/features/tool-catalog/toolCatalog.js";

test("tool catalog includes every new assistant tool and all canvas agent tools", () => {
  const tools = TOOL_GROUPS.flatMap((group) => group.tools);
  const ids = new Set(tools.map((item) => item.id));
  for (const id of [
    "media_action", "image_search", "webpage_capture", "send_to_workspace",
    "reference_rebuild", "product_import", "delivery_export", "site_operator",
  ]) assert.ok(ids.has(id), `missing ${id}`);
  const canvasAgentCount = tools.filter((item) => item.surface === "画布 Agent").length;
  assert.equal(canvasAgentCount, 40);
  assert.ok(tools.length >= 95, `catalog unexpectedly small: ${tools.length}`);
});

test("every catalog item is user-readable and navigable", () => {
  for (const group of TOOL_GROUPS) {
    for (const item of group.tools) {
      assert.ok(item.id && item.name && item.description, JSON.stringify(item));
      assert.match(item.to, /^\/(?!\/)/, item.id);
    }
  }
});
