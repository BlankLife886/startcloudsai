import { fetchCanvasProjectQuota } from "@/services/canvas-cloud-repository";
import { canvasProjectCapacityMessage, canvasProjectOccupancy } from "./canvas-project-quota-rules.ts";

export { canvasProjectCapacityMessage, canvasProjectOccupancy };
import { pendingCloudProjectDeleteCount, useCanvasStore } from "@/stores/canvas/use-canvas-store";

/** 本地已建、尚未同步到云端的新项目（服务端还没计数）。 */
export function unsyncedLocalProjectCount() {
    return useCanvasStore.getState().projects.filter((project) => !project.revision).length;
}

/**
 * 新建/导入前检查项目数上限；返回空串表示可以继续。配额读取失败时不拦截（服务端仍会兜底校验）。
 */
export async function checkCanvasProjectCapacity(adding = 1): Promise<string> {
    try {
        return canvasProjectCapacityMessage(await fetchCanvasProjectQuota(), adding, unsyncedLocalProjectCount(), pendingCloudProjectDeleteCount());
    } catch {
        return "";
    }
}
