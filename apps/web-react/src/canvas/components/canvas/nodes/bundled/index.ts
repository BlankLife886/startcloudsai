import type { CanvasPlugin } from "@/types/canvas-plugin";

import { htmlCanvasPlugin } from "./html-node";
import { markdownCanvasPlugin } from "./markdown-node";
import { panoramaCanvasPlugin } from "./panorama-node";
import { stickyNoteCanvasPlugin } from "./sticky-note-node";
import { svgCanvasPlugin } from "./svg-node";

// This source-controlled list is the only production enablement point for canvas plugins.
export const BUNDLED_CANVAS_PLUGINS: readonly CanvasPlugin[] = [markdownCanvasPlugin, svgCanvasPlugin, htmlCanvasPlugin, panoramaCanvasPlugin, stickyNoteCanvasPlugin];

export { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";
