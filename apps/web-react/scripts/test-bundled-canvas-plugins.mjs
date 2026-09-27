import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "../src/canvas/components/canvas/nodes/bundled/contracts.ts";
import { applyHtmlPatches, isTruncatedHtml, mergeHtmlContinuation, parseHtmlPatches, stashHtmlAssets } from "../src/canvas/components/canvas/nodes/bundled/html-node-edit.ts";
import { htmlImageTokens, isHtmlFrameMessage, withHtmlBridge } from "../src/canvas/components/canvas/nodes/bundled/html-node-runtime.ts";
import { canvasMiniMapLayout } from "../src/canvas/lib/canvas/canvas-mini-map.ts";
import { continueStickyList, parseStickyLines, stickyTextColor, stickyTodoProgress, toggleStickyChecklist, toggleStickyTodo } from "../src/canvas/components/canvas/nodes/bundled/sticky-note-model.ts";
import { repairRetypedConfigNodes } from "../src/canvas/lib/canvas/canvas-image-hydration.ts";
import { collapseGroup, createGroupAround, dissolveGroup, expandGroup, fitGroupToMembers, GROUP_HEADER, GROUP_PADDING, growGroupsToFit, summarizeGroups } from "../src/canvas/lib/canvas/canvas-groups.ts";
import { buildCanvasSidePanelWorkflowGroups, canvasWorkflowDisplayName, orderCanvasWorkflowNodes } from "../src/canvas/lib/canvas/canvas-workflow-groups.ts";

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

test("top toolbar labels common tools and groups advanced operations without dropping them", async () => {
    const toolbar = await readCanvasSource("components/canvas/canvas-toolbar.tsx");
    assert.match(toolbar, /creatableDefinitions\.filter\(\(def\) => isCanvasOperationNodeType\(def\.type\)\)/);
    // Both groups must still reach the more-tools panel, now each under its own section header.
    assert.match(toolbar, /definitions: operationDefs/);
    assert.match(toolbar, /definitions: extensionDefs/);
    assert.match(toolbar, /data-canvas-more-tools/);
    assert.match(toolbar, /id="tool-text" showLabel/);
    assert.match(toolbar, /getNodePluginId\(def\.type\) !== "builtin"/);
    assert.match(toolbar, /id="tool-extensions"/);
});

test("workflow controls live with the right-side canvas actions", async () => {
    const topBar = await readCanvasSource("components/canvas/canvas-top-bar.tsx");
    assert.match(topBar, /data-canvas-topbar-actions/);
    assert.match(topBar, /canvas-workflow-control-slot/);
    assert.match(topBar, /data-canvas-topbar-actions[^>]*>[\s\S]*canvas-workflow-control-slot[\s\S]*canvas-chrome-cluster/);
});

test("text node keeps font controls in its dedicated bottom action row", async () => {
    const [canvasNode, hoverToolbar] = await Promise.all([
        readCanvasSource("components/canvas/canvas-node.tsx"),
        readCanvasSource("components/canvas/canvas-node-hover-toolbar.tsx"),
    ]);
    assert.match(canvasNode, /flex h-10 shrink-0 items-center gap-2 border-t pl-4 pr-2/);
    assert.match(canvasNode, /onDecreaseFont\?\.\(node\)/);
    assert.match(canvasNode, /onIncreaseFont\?\.\(node\)/);
    // Editing and generation moved to the hover toolbar, so the row stays font-only.
    assert.doesNotMatch(canvasNode, /onTogglePanel/);
    assert.match(hoverToolbar, /isText \? \[\{ id: "editText"/);
    assert.match(hoverToolbar, /isText \? \[\{ id: "generateImage"/);
    assert.match(canvasNode, /containerClassName="min-h-0 flex-1"/);
    assert.match(canvasNode, /className="thin-scrollbar m-0 block h-full w-full resize-none/);
    assert.doesNotMatch(hoverToolbar, /id: "decreaseFont"|id: "increaseFont"/);
    assert.match(hoverToolbar, /!isText \? \[\{ id: "rename"/);
    assert.doesNotMatch(hoverToolbar, /\bonInfo\b|id: "duplicate"|<InfoRow label="ID"|copyText\(node\.id\)/);
    assert.match(hoverToolbar, /showLabel=\{showImageToolLabels && index < labelledCount\}/);
    assert.match(hoverToolbar, /const hasText = showLabel && Boolean\(label\)/);
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

test("side panel node actions omit duplicate while retaining node information", async () => {
    const sidePanel = await readCanvasSource("components/canvas/canvas-side-panel.tsx");
    assert.doesNotMatch(sidePanel, /onDuplicateNode|<Copy\b/);
    assert.match(sidePanel, /onInfo=\{\(\) => setInfoNodeId\(node\.id\)\}/);
    assert.match(sidePanel, /label=\{t\("canvas\.nodeToolbar\.nodeInfo"\)\}/);
    assert.doesNotMatch(sidePanel, /label="ID"|JSON\.stringify\(\s*node/);
    assert.match(sidePanel, /function NodeRowActionsMenu/);
    assert.match(sidePanel, /useAnchorPopover\(onOpenChange, open\)/);
    assert.doesNotMatch(sidePanel, /if \(open !== popoverOpen\) updateOpen\(open\)/);
    assert.match(sidePanel, /<AnchorPopoverPanel/);
    assert.match(sidePanel, /open=\{openActionsNodeId === node\.id\}/);
    assert.match(sidePanel, /current === node\.id \? null : current/);
    assert.match(sidePanel, /<Ellipsis className="size-4"/);
    assert.match(sidePanel, /canvas-node-actions-trigger/);
    assert.doesNotMatch(sidePanel, /nodePreviewText|metadata\?\.content \|\| node\.metadata\?\.prompt/);
    assert.doesNotMatch(sidePanel, /workflowGroup.*workflowIndex/);
    // Names use the full row width and truncate; rows add a one-line summary (failure reason, excerpt, settings).
    assert.match(sidePanel, /block truncate text-\[12px\]/);
    assert.match(sidePanel, /function nodeSummary/);
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
    assert.match(canvasNode, /node\.metadata\?\.uploading\s*\? t\("canvas\.node\.uploading"\)\s*: canvasGenerationStageLabel/);
});

test("HTML node edits apply SEARCH/REPLACE patches all-or-nothing", () => {
    const page = "<!doctype html>\n<html>\n<head>\n  <style>:root{--brand:#6d4aff}</style>\n</head>\n<body>\n  <h1>Hello</h1>\n  <p>World</p>\n</body>\n</html>";
    const reply = [
        "好的",
        "<<<<<<< SEARCH",
        ":root{--brand:#6d4aff}",
        "=======",
        ":root{--brand:#ff4f8b}",
        ">>>>>>> REPLACE",
        "<<<<<<< SEARCH",
        "<h1>Hello</h1>",
        "  <p>World</p>",
        "=======",
        "<h1>你好</h1>",
        ">>>>>>> REPLACE",
    ].join("\n");
    const patches = parseHtmlPatches(reply);
    assert.equal(patches.length, 2);
    const applied = applyHtmlPatches(page, patches);
    assert.equal(applied.ok, true);
    assert.match(applied.html, /--brand:#ff4f8b/);
    assert.match(applied.html, /<h1>你好<\/h1>/);
    assert.doesNotMatch(applied.html, /World/);

    // One patch that does not line up rejects the whole reply and leaves the page as it was.
    const broken = applyHtmlPatches(page, [...patches, { search: "<footer>missing</footer>", replace: "" }]);
    assert.deepEqual(broken, { ok: false, failed: [3] });
    // Ambiguous anchors are rejected rather than guessed.
    assert.equal(applyHtmlPatches("<p>a</p><p>a</p>", [{ search: "<p>a</p>", replace: "<p>b</p>" }]).ok, false);
});

test("HTML node edits keep embedded images out of the request and restore them afterwards", () => {
    const image = `data:image/png;base64,${"A".repeat(400)}`;
    const page = `<html><body><img src="${image}"><p>x</p></body></html>`;
    const stash = stashHtmlAssets(page);
    assert.equal(stash.count, 1);
    assert.ok(!stash.text.includes("AAAA"));
    assert.equal(stash.restore(stash.text), page);
});

test("HTML node continues pages cut off by the output cap and stitches the parts", () => {
    const first = "<!doctype html>\n<html><head><style>body{margin:0}</style></head><body>\n<section class=\"hero\"><h1>Nimbus</h1>";
    assert.equal(isTruncatedHtml(first), true);
    // The continuation repeats the tail of the first part and is wrapped in a code fence.
    const continuation = "```html\n<section class=\"hero\"><h1>Nimbus</h1>\n<p>hi</p></section></body></html>\n```";
    const merged = mergeHtmlContinuation(first, continuation);
    assert.equal(merged.split("<h1>Nimbus</h1>").length, 2, "repeated text is not duplicated");
    assert.match(merged, /<p>hi<\/p><\/section><\/body><\/html>$/);
    assert.equal(isTruncatedHtml(merged), false);
    assert.equal(isTruncatedHtml("好的，已经为你生成"), false, "a non-page reply is not treated as a truncated page");
});

test("HTML node bridge sits on the <head> line so reported error lines match the source", () => {
    const page = "<!doctype html><html><head><title>x</title></head>\n<body><p>hi</p></body></html>";
    const bridged = withHtmlBridge(page);
    assert.equal(bridged.split("\n").length, page.split("\n").length, "the bridge adds no lines");
    assert.match(bridged, /<head><script>.*__htmlNode.*<\/script><title>/s);
    assert.ok(isHtmlFrameMessage({ __htmlNode: 1, type: "error", message: "x" }));
    assert.ok(!isHtmlFrameMessage({ type: "error" }), "messages without the marker are ignored");
});

test("HTML node pages reference canvas images by token", () => {
    const page = `<img src="sc-file:uploads/u1/original/a.png"><div style="background:url(sc-node:image-123)"></div><img src="sc-file:uploads/u1/original/a.png">`;
    assert.deepEqual(htmlImageTokens(page), ["sc-file:uploads/u1/original/a.png", "sc-node:image-123"]);
});

test("side panel lists a workflow in connection order and names it by its content", () => {
    const node = (id, type, title, metadata = {}) => ({ id, type, title, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
    const output = node("out", "image", "蓝天白云，棉花糖般的云朵 · 1");
    const config = node("cfg", "config", "生成配置", { composerContent: "一张海报" });
    const input = node("in", "text", "文本", { content: "蓝天白云" });
    const connections = [
        { id: "c1", fromNodeId: "cfg", toNodeId: "out" },
        { id: "c2", fromNodeId: "in", toNodeId: "cfg" },
    ];
    const [group] = buildCanvasSidePanelWorkflowGroups([output, config, input], connections);
    assert.deepEqual(orderCanvasWorkflowNodes(group.nodes, connections).map((item) => item.id), ["in", "cfg", "out"]);
    assert.equal(canvasWorkflowDisplayName(group, connections), "蓝天白云，棉花糖般的云朵");
    // Generic output titles fall back to the prompt; a user-chosen name wins over everything.
    const generic = buildCanvasSidePanelWorkflowGroups([{ ...output, title: "Generated Image" }, config, input], connections)[0];
    assert.equal(canvasWorkflowDisplayName(generic, connections), "一张海报");
    const named = buildCanvasSidePanelWorkflowGroups([output, { ...config, metadata: { ...config.metadata, workflowName: "春季海报" } }, input], connections)[0];
    assert.equal(canvasWorkflowDisplayName(named, connections), "春季海报");
});

test("recent project preview fits the canvas into a small map with connection curves", () => {
    const node = (id, type, x, y, width, height) => ({ id, type, title: id, position: { x, y }, width, height, metadata: {} });
    const nodes = [node("group", "group", -100, -100, 1200, 700), node("a", "text", 0, 0, 200, 100), node("b", "image", 800, 300, 200, 200)];
    const map = canvasMiniMapLayout(nodes, [{ id: "c", fromNodeId: "a", toNodeId: "b" }], 276, 168);
    assert.equal(map.rects[0].id, "group", "group frames are drawn first, behind their members");
    for (const rect of map.rects) {
        assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= 276.01 && rect.y + rect.height <= 168.01, `${rect.id} stays inside the box`);
    }
    const a = map.rects.find((rect) => rect.id === "a");
    const b = map.rects.find((rect) => rect.id === "b");
    assert.ok(b.x > a.x && b.y > a.y, "relative positions are kept");
    assert.equal(map.paths.length, 1);
    assert.match(map.paths[0], /^M [\d.]+ [\d.]+ C /);
    assert.deepEqual(canvasMiniMapLayout([], [], 276, 168).rects, []);
});

test("groups wrap a selection, grow with their members, fold into a card and dissolve cleanly", () => {
    const node = (id, type, x, y, width, height, metadata = {}) => ({ id, type, title: id, position: { x, y }, width, height, metadata });
    const inline = node("inline", "image", 900, 900, 50, 50, { hidden: true, workflowProducerNodeId: "cfg" });
    const start = [node("a", "text", 100, 100, 200, 100), node("b", "image", 400, 150, 200, 200, { status: "error" }), node("cfg", "config", 100, 400, 300, 200), inline];
    const created = createGroupAround(start, ["a", "b", "inline"], { id: "g", title: "组" });
    assert.ok(created);
    const group = created.nodes[0];
    assert.equal(group.id, "g", "frames go first so they draw behind members");
    assert.deepEqual(group.position, { x: 100 - GROUP_PADDING, y: 100 - GROUP_PADDING - GROUP_HEADER });
    assert.equal(group.width, 500 + GROUP_PADDING * 2);
    assert.equal(created.nodes.find((item) => item.id === "inline").metadata.groupId, undefined, "hidden nodes are not grabbed");

    // A member moving past the edge widens the frame; nothing changes when everything fits.
    const moved = created.nodes.map((item) => (item.id === "b" ? { ...item, position: { x: 900, y: 150 } } : item));
    const grown = growGroupsToFit(moved);
    assert.equal(grown.find((item) => item.id === "g").width, 1100 - 100 + GROUP_PADDING * 2);
    assert.equal(growGroupsToFit(grown), grown);
    const fitted = fitGroupToMembers(grown.map((item) => (item.id === "g" ? { ...item, width: 5000 } : item)), "g");
    assert.equal(fitted.find((item) => item.id === "g").width, 1100 - 100 + GROUP_PADDING * 2);

    const summary = summarizeGroups(created.nodes).get("g");
    assert.equal(summary.total, 2);
    assert.equal(summary.failed, 1);

    // Folding hides members (and remembers them); unfolding restores exactly those, not nodes hidden for other reasons.
    const folded = collapseGroup([...created.nodes.map((item) => (item.id === "inline" ? { ...item, metadata: { ...item.metadata, groupId: "g" } } : item))], "g");
    assert.equal(folded.find((item) => item.id === "g").metadata.groupCollapsed, true);
    assert.equal(folded.find((item) => item.id === "a").metadata.hidden, true);
    assert.equal(folded.find((item) => item.id === "inline").metadata.collapsedIntoGroupId, undefined);
    assert.equal(growGroupsToFit(folded), folded, "folded frames never grow");
    const unfolded = expandGroup(folded, "g");
    assert.equal(unfolded.find((item) => item.id === "a").metadata.hidden, undefined);
    assert.equal(unfolded.find((item) => item.id === "inline").metadata.hidden, true);
    assert.equal(unfolded.find((item) => item.id === "g").width, group.width);

    // Dissolving a folded group brings its members back and drops the frame.
    const dissolved = dissolveGroup(folded, "g");
    assert.ok(!dissolved.some((item) => item.id === "g"));
    assert.equal(dissolved.find((item) => item.id === "a").metadata.hidden, undefined);
    assert.equal(dissolved.find((item) => item.id === "a").metadata.groupId, undefined);
});

test("a generation config that a retry turned into an image node is restored on load", () => {
    const broken = {
        id: "config-1790429586271-4iinv",
        type: "image",
        title: "生成配置",
        position: { x: 0, y: 0 },
        width: 580,
        height: 440,
        metadata: { generationMode: "image", composerContent: "蓝天白云", model: "gpt-image-2", workflowOutputNodeIds: ["out"], content: "/api/v1/files/x.png", storageKey: "tasks/x.png", images: [{ id: "i" }], primaryImageId: "i", naturalWidth: 1024, status: "success" },
    };
    const realImage = { id: "image-1", type: "image", title: "蓝天白云", position: { x: 0, y: 0 }, width: 300, height: 300, metadata: { content: "/api/v1/files/y.png" } };
    const [config, untouched] = repairRetypedConfigNodes([broken, realImage]);
    assert.equal(config.type, "config");
    assert.equal(config.metadata.composerContent, "蓝天白云");
    assert.deepEqual(config.metadata.workflowOutputNodeIds, ["out"]);
    assert.equal(config.metadata.content, undefined);
    assert.equal(config.metadata.images, undefined);
    assert.equal(untouched, realImage, "real image nodes are left alone");
    const clean = [realImage];
    assert.equal(repairRetypedConfigNodes(clean), clean);
});

test("retrying a generation config runs it again instead of writing an image into it", async () => {
    const project = await readCanvasSource("pages/canvas/project.tsx");
    const retry = project.slice(project.indexOf("const handleRetryNode = useCallback"), project.indexOf("const handleRetryNode = useCallback") + 2500);
    assert.match(retry, /if \(isCanvasExecutableNode\(node\)\) \{[\s\S]*handleGenerateNode\(node\.id/);
});

test("sticky notes understand to-dos, bullets and headings and keep lists going on Enter", () => {
    const note = "# 本周\n- [ ] 出海报\n- [x] 定配色\n- 备注\n随手记";
    assert.deepEqual(parseStickyLines(note).map((line) => line.kind), ["heading", "todo", "todo", "bullet", "text"]);
    assert.deepEqual(stickyTodoProgress(note), { total: 2, done: 1 });
    assert.equal(toggleStickyTodo(note, 1).split("\n")[1], "- [x] 出海报");
    assert.equal(toggleStickyTodo(note, 4), note, "plain lines do not toggle");

    assert.equal(toggleStickyChecklist("买咖啡\n\n- 写周报"), "- [ ] 买咖啡\n\n- [ ] 写周报");
    assert.equal(toggleStickyChecklist("- [ ] 买咖啡\n- [x] 写周报"), "买咖啡\n写周报");
    assert.equal(toggleStickyChecklist(""), "- [ ] ");

    const typed = "- [x] 定配色";
    assert.deepEqual(continueStickyList(typed, typed.length), { value: "- [x] 定配色\n- [ ] ", caret: typed.length + 7 });
    assert.deepEqual(continueStickyList("- 一\n- ", 6), { value: "- 一\n", caret: 4 }, "Enter on an empty item ends the list");
    assert.equal(continueStickyList("普通文字", 4), null);

    assert.equal(stickyTextColor("#fde68a"), "#1c1917");
    assert.equal(stickyTextColor("#334155"), "#fafaf9");
});
