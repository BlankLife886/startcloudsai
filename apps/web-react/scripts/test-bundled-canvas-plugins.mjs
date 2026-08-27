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

test("top toolbar exposes operation nodes directly and keeps plugin nodes grouped", async () => {
    const toolbar = await readCanvasSource("components/canvas/canvas-toolbar.tsx");
    assert.match(toolbar, /creatableDefinitions\.filter\(\(def\) => isCanvasOperationNodeType\(def\.type\)\)/);
    assert.match(toolbar, /operationDefs\.map\(\(definition\) =>/);
    assert.match(toolbar, /\[&>svg\]:size-3\.5/);
    assert.match(toolbar, /getNodePluginId\(def\.type\) !== "builtin"/);
    assert.match(toolbar, /id="tool-extensions"/);
});

test("workflow controls live with the right-side canvas actions", async () => {
    const topBar = await readCanvasSource("components/canvas/canvas-top-bar.tsx");
    assert.match(topBar, /data-canvas-topbar-actions/);
    assert.match(topBar, /canvas-workflow-control-slot/);
    assert.match(topBar, /data-canvas-topbar-actions>[\s\S]*canvas-workflow-control-slot[\s\S]*canvas-chrome-cluster/);
});

test("text node keeps edit and font controls in its dedicated bottom action row", async () => {
    const [canvasNode, hoverToolbar] = await Promise.all([
        readCanvasSource("components/canvas/canvas-node.tsx"),
        readCanvasSource("components/canvas/canvas-node-hover-toolbar.tsx"),
    ]);
    assert.match(canvasNode, /flex h-12 shrink-0 items-center justify-end gap-1 px-4/);
    assert.match(canvasNode, /onTogglePanel\?\.\(node\)/);
    assert.match(canvasNode, /onDecreaseFont\?\.\(node\)/);
    assert.match(canvasNode, /onIncreaseFont\?\.\(node\)/);
    assert.match(canvasNode, /containerClassName="min-h-0 flex-1"/);
    assert.match(canvasNode, /className="thin-scrollbar m-0 block h-full w-full resize-none/);
    assert.doesNotMatch(hoverToolbar, /id: "decreaseFont"|id: "increaseFont"/);
    assert.match(hoverToolbar, /!isText && onInfo/);
    assert.match(hoverToolbar, /!isText \? \[\{ id: "rename"/);
    assert.match(hoverToolbar, /!isText \? \[\{ id: "duplicate"/);
    assert.doesNotMatch(hoverToolbar, /<InfoRow label="ID"|copyText\(node\.id\)/);
    assert.match(hoverToolbar, /nodeToolbar\.name[\s\S]*first theme=\{theme\}/);
});

test("node context menu stays focused and rename uses one dialog flow", async () => {
    const [contextMenu, canvasNode, project] = await Promise.all([
        readCanvasSource("components/canvas/canvas-context-menu.tsx"),
        readCanvasSource("components/canvas/canvas-node.tsx"),
        readCanvasSource("pages/canvas/project.tsx"),
    ]);
    assert.match(contextMenu, /onRename/);
    assert.match(contextMenu, /onEdit/);
    assert.doesNotMatch(contextMenu, /onDuplicate|onFocus|onInfo/);
    assert.match(canvasNode, /onRenameRequest\(data\)/);
    assert.doesNotMatch(canvasNode, /isEditingTitle|titleDraft|renameRequestNonce/);
    assert.match(project, /open=\{Boolean\(renameDialog\)\}/);
    assert.match(project, /setRenameDialog\(\{ nodeId: node\.id, title: node\.title \|\| "" \}\)/);
});

test("side panel node actions omit duplicate but retain node information", async () => {
    const sidePanel = await readCanvasSource("components/canvas/canvas-side-panel.tsx");
    assert.doesNotMatch(sidePanel, /onDuplicateNode|<Copy\b/);
    assert.match(sidePanel, /onInfoNode/);
    assert.match(sidePanel, /function NodeRowActionsMenu/);
    assert.match(sidePanel, /useAnchorPopover\(onOpenChange, open\)/);
    assert.doesNotMatch(sidePanel, /if \(open !== popoverOpen\) updateOpen\(open\)/);
    assert.match(sidePanel, /<AnchorPopoverPanel/);
    assert.match(sidePanel, /open=\{openActionsNodeId === node\.id\}/);
    assert.match(sidePanel, /current === node\.id \? null : current/);
    assert.match(sidePanel, /label=\{t\("canvas\.nodeToolbar\.info"\)\}/);
    assert.match(sidePanel, /<Ellipsis className="size-4"/);
    assert.match(sidePanel, /canvas-node-actions-trigger/);
    assert.doesNotMatch(sidePanel, /nodePreviewText|metadata\?\.content \|\| node\.metadata\?\.prompt/);
    assert.doesNotMatch(sidePanel, /workflowGroup.*workflowIndex/);
    assert.match(sidePanel, /max-w-\[180px\]/);
    assert.match(sidePanel, /max-w-\[160px\]/);
    assert.match(sidePanel, /aria-label=\{t\("canvas\.exportSelected"\)\}/);
    assert.doesNotMatch(sidePanel, /<Download className="size-3\.5" \/>\s*\{t\("canvas\.exportSelected"\)\}/);
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

test("image uploads render a pending node before waiting for cloud storage", async () => {
    const [project, canvasNode] = await Promise.all([
        readCanvasSource("pages/canvas/project.tsx"),
        readCanvasSource("components/canvas/canvas-node.tsx"),
    ]);
    const createUploadStart = project.indexOf("setNodes((prev) => [...prev, pendingNode])");
    const waitForUpload = project.indexOf("const image = await uploadImage(file)", createUploadStart);
    assert.ok(createUploadStart >= 0, "image upload must insert a visible pending node");
    assert.ok(waitForUpload > createUploadStart, "pending node must render before the cloud upload resolves");
    assert.match(project, /metadata: \{ status: NODE_STATUS_LOADING, uploading: true \}/);
    assert.match(canvasNode, /data\.metadata\?\.uploading\s*\? t\("canvas\.node\.uploading"\)/);
    assert.match(canvasNode, /node\.metadata\?\.uploading \? "canvas\.node\.uploading" : "canvas\.node\.generating"/);
});
