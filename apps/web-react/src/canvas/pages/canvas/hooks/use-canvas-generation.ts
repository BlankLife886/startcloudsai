import { CANVAS_AUDIO_ENABLED, CANVAS_VIDEO_ENABLED } from "@/constant/canvas";
import { isAudioFile } from "@/lib/canvas/canvas-generation-helpers";

export const VIDEO_NODE_MAX_WIDTH = 360;
export const VIDEO_NODE_MAX_HEIGHT = 360;

export function isAcceptedCanvasFile(file: File) {
    if (file.type.startsWith("image/")) return true;
    if (CANVAS_VIDEO_ENABLED && file.type.startsWith("video/")) return true;
    if (CANVAS_AUDIO_ENABLED && isAudioFile(file)) return true;
    return false;
}

/** Leave-guard busy: any in-flight node generation tracked by the page. */
export function isCanvasGenerationBusy(runningNodeIds: Set<string>) {
    return runningNodeIds.size > 0;
}
