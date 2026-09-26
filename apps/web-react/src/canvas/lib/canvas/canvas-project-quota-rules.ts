/**
 * 当前实际占用的项目数：服务端已用数减去正在云端删除的，加上本地已建但尚未上传的。
 * 删除/首次上传都是异步的，只看服务端计数会在删除刚完成时误报「已满」。
 */
export function canvasProjectOccupancy(quota: { used: number }, unsynced: number, pendingDeletes = 0): number {
    return Math.max(0, Math.max(0, quota.used) - Math.max(0, pendingDeletes)) + Math.max(0, unsynced);
}

/** 纯函数：还能不能再新建 adding 个项目；不能时返回提示文案。 */
export function canvasProjectCapacityMessage(quota: { limit: number; used: number }, adding: number, unsynced: number, pendingDeletes = 0): string {
    const occupied = canvasProjectOccupancy(quota, unsynced, pendingDeletes);
    if (occupied + Math.max(1, adding) <= quota.limit) return "";
    const remaining = Math.max(0, quota.limit - occupied);
    return adding > 1 && remaining > 0
        ? `画布项目上限 ${quota.limit} 个，当前还能新建 ${remaining} 个，本次要导入 ${adding} 个；请删除不再使用的项目后再试`
        : `已达到 ${quota.limit} 个画布项目上限，请删除不再使用的项目后再新建`;
}

/** 画布项目大小的展示格式：不足 1MB 按 KB，否则按 MB 保留一位小数。 */
export function formatCanvasProjectBytes(bytes: number): string {
    const value = Math.max(0, Number(bytes) || 0);
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

/** 已用占上限的比例达到该值时提醒用户（0–1）。 */
export const CANVAS_PROJECT_SIZE_WARN_RATIO = 0.8;
