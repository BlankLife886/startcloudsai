import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "../src/canvas/components/canvas/nodes/bundled/contracts.ts";

const canvasSource = new URL("../src/canvas/", import.meta.url);
const readCanvasSource = async (path) => readFile(new URL(path, canvasSource), "utf8");

test("developer manifest preserves all supported plugin and node identifiers", () => {
    assert.deepEqual(Object.values(BUNDLED_CANVAS_PLUGIN_IDS), ["markdown", "svg", "html", "panorama", "sticky-note"]);
    assert.deepEqual(Object.values(BUNDLED_CANVAS_NODE_TYPES), ["markdown:doc", "svg:vector", "html:render", "panorama:viewer", "sticky-note:note"]);
});

test("bundled plugins are registered under their original storage namespaces", async () => {
    const [manifest, builtinNodes] = await Promise.all([
        readCanvasSource("components/canvas/nodes/bundled/index.ts"),
        readCanvasSource("components/canvas/nodes/builtin-nodes.tsx"),
    ]);
    for (const plugin of ["markdownCanvasPlugin", "svgCanvasPlugin", "htmlCanvasPlugin", "panoramaCanvasPlugin", "stickyNoteCanvasPlugin"]) {
        assert.match(manifest, new RegExp(`\\b${plugin}\\b`));
    }
    assert.match(builtinNodes, /BUNDLED_CANVAS_PLUGINS\.forEach\(\(plugin\) => registerNodeDefinitions\(plugin\.nodes, plugin\.id\)\)/);
});

test("production canvas has no user plugin management or remote startup loader", async () => {
    const [project, topBar, statusActions, pluginHost] = await Promise.all([
        readCanvasSource("pages/canvas/project.tsx"),
        readCanvasSource("components/canvas/canvas-top-bar.tsx"),
        readCanvasSource("components/layout/user-status-actions.tsx"),
        readCanvasSource("pages/canvas/hooks/use-plugin-host.tsx"),
    ]);
    const productionEntrySources = [project, topBar, statusActions, pluginHost].join("\n");
    assert.doesNotMatch(productionEntrySources, /CanvasPluginManagerModal|onOpenPlugins|ensurePluginsLoaded|installPluginFromUrl/);
});
