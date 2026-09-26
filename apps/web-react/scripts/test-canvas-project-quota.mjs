import assert from "node:assert/strict";
import test from "node:test";

import { canvasProjectCapacityMessage } from "../src/canvas/lib/canvas/canvas-project-quota-rules.ts";

test("allows creating while below the limit, counting unsynced local projects", () => {
    assert.equal(canvasProjectCapacityMessage({ limit: 30, used: 28 }, 1, 0), "");
    assert.equal(canvasProjectCapacityMessage({ limit: 30, used: 28 }, 1, 1), "");
    assert.match(canvasProjectCapacityMessage({ limit: 30, used: 28 }, 1, 2), /已达到 30 个画布项目上限/);
});

test("blocks at the limit and explains the remaining room for multi-project imports", () => {
    assert.match(canvasProjectCapacityMessage({ limit: 30, used: 30 }, 1, 0), /已达到 30 个/);
    assert.match(canvasProjectCapacityMessage({ limit: 30, used: 27 }, 5, 0), /还能新建 3 个，本次要导入 5 个/);
    assert.equal(canvasProjectCapacityMessage({ limit: 30, used: 27 }, 3, 0), "");
});

test("users already over a lowered limit cannot create more", () => {
    assert.match(canvasProjectCapacityMessage({ limit: 10, used: 25 }, 1, 0), /已达到 10 个/);
});

test("formats project sizes for the list and editor", async () => {
    const { formatCanvasProjectBytes } = await import("../src/canvas/lib/canvas/canvas-project-quota-rules.ts");
    assert.equal(formatCanvasProjectBytes(0), "1 KB");
    assert.equal(formatCanvasProjectBytes(300 * 1024), "300 KB");
    assert.equal(formatCanvasProjectBytes(Math.round(2.34 * 1024 * 1024)), "2.3 MB");
    assert.equal(formatCanvasProjectBytes(30 * 1024 * 1024), "30.0 MB");
});

test("occupancy discounts in-flight cloud deletes and adds unsynced local projects", async () => {
    const { canvasProjectOccupancy, canvasProjectCapacityMessage } = await import("../src/canvas/lib/canvas/canvas-project-quota-rules.ts");
    // 删除了 22 个、服务端还没处理完：服务端仍报 30，实际只占 8 个。
    assert.equal(canvasProjectOccupancy({ used: 30 }, 0, 22), 8);
    assert.equal(canvasProjectCapacityMessage({ limit: 10, used: 30 }, 1, 0, 22), "");
    // 另有 2 个本地新建、尚未上传的项目也要计入。
    assert.equal(canvasProjectOccupancy({ used: 8 }, 2, 0), 10);
    assert.match(canvasProjectCapacityMessage({ limit: 10, used: 8 }, 1, 2, 0), /已达到 10 个/);
    assert.equal(canvasProjectOccupancy({ used: 1 }, 0, 5), 0);
});
