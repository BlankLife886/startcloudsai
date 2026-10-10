import { expect, test } from "@playwright/test";

// 虚拟试衣体验升级的端到端用例。所有 /api/v1 请求都在这里 mock，
// 不会触达真实上游、不会扣积分。

const USER = {
  id: "e2e-user-1",
  email: "e2e@example.com",
  username: "E2E 用户",
  displayName: "E2E 用户",
  requireCostConfirm: false,
};

const IMAGE_MODEL = {
  id: "e2e-image-model",
  publicModelKey: "e2e-image-model",
  label: "E2E 图片模型",
  default: true,
  capabilities: ["image.generate", "image.edit", "imageToImage"],
  aspectRatios: ["1:1", "2:3", "3:4", "4:5", "16:9", "9:16"],
  aspectRatiosByResolution: {
    "1K": ["1:1", "2:3", "3:4", "4:5", "16:9", "9:16"],
  },
  qualities: ["low", "medium", "high"],
  resolutions: ["1K"],
  maxReferenceImages: 8,
  creditCost: 3,
};

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function tryonTask(index, { seconds = 60 } = {}) {
  const url = `/api/v1/files/mock-product.png?tryon=${index + 1}`;
  const created = new Date(Date.UTC(2026, 0, 1, 0, index, 0));
  return {
    id: `e2e-tryon-${index + 1}`,
    type: "ecommerce_design",
    status: "succeeded",
    prompt: "测试试衣结果",
    params: {
      _kind: "ui-design-ecommerce-tryon-generation",
      aspectRatio: "2:3",
      batchId: `e2e-tryon-batch-${index + 1}`,
      batchIndex: 0,
      batchSize: 1,
      batchCreatedAt: created.toISOString(),
    },
    count: 1,
    originalUrls: [url],
    outputUrls: [url],
    createdAt: created.toISOString(),
    startedAt: created.toISOString(),
    finishedAt: new Date(created.getTime() + seconds * 1000).toISOString(),
  };
}

function withRefs(task, garmentName, { bottom = "" } = {}) {
  task.params.referenceKeys = [
    `uploads/e2e-user-1/${garmentName}`,
    "uploads/e2e-user-1/model.png",
    "uploads/e2e-user-1/scene.png",
    ...(bottom ? [`uploads/e2e-user-1/${bottom}`] : []),
  ];
  return task;
}

function batchTask(index, size, { batchId = "e2e-batch-group", label } = {}) {
  const task = withRefs(tryonTask(index), `garment-${index + 1}.png`);
  task.params.batchId = batchId;
  task.params.batchIndex = index;
  task.params.batchSize = size;
  task.params.batchCreatedAt = "2026-01-02T00:00:00.000Z";
  task.createdAt = "2026-01-02T00:00:00.000Z";
  task.params.viewLabel =
    label || `虚拟试衣 · 上身主图 · 第${index + 1}件`;
  return task;
}

async function mockApis(page, options = {}) {
  const state = {
    uploads: 0,
    classifyRequests: [],
    createdTasks: [],
    classify:
      "classify" in options
        ? options.classify
        : { apparel: "全身", label: "深蓝蕾丝长礼服" },
    wallet: options.wallet ?? 120,
    // 已完成的新建任务序号（从 1 开始）；其余保持 running
    finished: options.finished || new Set(),
    history: options.history ?? [],
  };
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/v1/auth/session") return fulfill(route, { user: USER });
    if (path === "/api/v1/runtime-config") {
      return fulfill(route, {
        routes: {},
        features: {
          "ai.ecommerceDesign": {
            enabled: true,
            config: { publicModels: [IMAGE_MODEL] },
          },
        },
        aiModelCatalog: {
          providers: [],
          models: [],
          publicModels: [IMAGE_MODEL],
          featurePublicModels: [IMAGE_MODEL],
          updatedAt: "e2e",
        },
        blacklist: { blocked: false, reason: "" },
      });
    }
    if (path === "/api/v1/pricing") {
      return fulfill(route, { taskPointPrices: { ecommerce_design: 3 } });
    }
    if (path === "/api/v1/me/wallet") {
      return fulfill(route, {
        availableCents: state.wallet,
        balanceCents: state.wallet,
      });
    }
    if (path === "/api/v1/uploads" && method === "POST") {
      state.uploads += 1;
      return fulfill(route, {
        key: `uploads/e2e-user-1/upload-${state.uploads}.png`,
        url: `/api/v1/files/mock-product.png?upload=${state.uploads}`,
      });
    }
    if (
      path === "/api/v1/commerce/catalog" ||
      path === "/api/v1/commerce/tryon-catalog"
    ) {
      const imageUrl = "/api/v1/files/mock-product.png";
      return fulfill(route, {
        models: [
          { id: "east-asian-female", label: "东亚女性", imageUrl },
          { id: "european-male", label: "欧美男性", imageUrl },
          { id: "south-asian-female", label: "南亚女性", imageUrl },
        ],
        scenes: [
          { id: "studio", label: "纯色棚拍", imageUrl },
          { id: "street", label: "都市街头", imageUrl },
        ],
        garments: [],
        hands: [],
      });
    }
    if (
      path === "/api/v1/commerce/tryon/garment-classifications" &&
      method === "POST"
    ) {
      state.classifyRequests.push(request.postDataJSON());
      if (!state.classify) {
        return route.fulfill({
          status: 502,
          contentType: "application/json",
          body: JSON.stringify({ success: false, message: "bad response" }),
        });
      }
      return fulfill(route, state.classify);
    }
    if (path === "/api/v1/tasks/quote" && method === "POST") {
      return fulfill(route, { unitPriceCents: 3, totalCents: 3 });
    }
    if (path === "/api/v1/tasks" && method === "POST") {
      const body = request.postDataJSON() || {};
      state.createdTasks.push(body);
      const now = new Date().toISOString();
      return fulfill(route, {
        id: `e2e-created-${state.createdTasks.length}`,
        type: body.type,
        status: "queued",
        prompt: body.prompt,
        params: body.params,
        inputKeys: body.inputKeys,
        count: 1,
        originalUrls: [],
        outputUrls: [],
        createdAt: now,
      });
    }
    const createdTask = (id) => {
      const index = Number(String(id).split("-").at(-1)) - 1;
      const body = state.createdTasks[index] || {};
      const done = state.finished.has(index + 1);
      const output = `/api/v1/files/mock-product.png?created=${index + 1}`;
      return {
        id,
        type: body.type,
        status: done ? "succeeded" : "running",
        prompt: body.prompt,
        params: body.params,
        count: 1,
        originalUrls: done ? [output] : [],
        outputUrls: done ? [output] : [],
        createdAt: new Date(Date.now() - 20_000).toISOString(),
        startedAt: new Date(Date.now() - 20_000).toISOString(),
        ...(done ? { finishedAt: new Date().toISOString() } : {}),
      };
    };
    if (path.startsWith("/api/v1/tasks/e2e-created-") && method === "GET") {
      return fulfill(route, createdTask(path.split("/").at(-1)));
    }
    // 任务状态是批量轮询的：GET /tasks?ids=a,b,c
    if (path === "/api/v1/tasks" && method === "GET" && url.searchParams.get("ids")) {
      const ids = url.searchParams.get("ids").split(",").filter(Boolean);
      return fulfill(route, {
        items: ids.map((id) =>
          id.startsWith("e2e-created-")
            ? createdTask(id)
            : state.history.find((task) => task.id === id),
        ).filter(Boolean),
        nextCursor: null,
      });
    }
    if (path === "/api/v1/tasks" && method === "GET") {
      // 可选分页：historyPages = [[...第一页], [...第二页]]
      if (options.historyPages) {
        const page = Number(url.searchParams.get("cursor") || 0);
        state.historyRequests = (state.historyRequests || 0) + 1;
        return fulfill(route, {
          items: options.historyPages[page] || [],
          nextCursor: page + 1 < options.historyPages.length ? String(page + 1) : null,
        });
      }
      return fulfill(route, { items: state.history, nextCursor: null });
    }
    if (path.startsWith("/api/v1/files/")) {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: PIXEL_PNG,
      });
    }
    if (path === "/api/v1/me/assets") {
      return fulfill(route, { items: [], nextCursor: null });
    }
    if (path === "/api/v1/me/asset-groups") {
      return fulfill(route, {
        items: [],
        ungroupedCount: 0,
        totalAssetCount: 0,
      });
    }
    return fulfill(route, {});
  });
  return state;
}

async function fulfill(route, data) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
}

// 在浏览器里画一张图，返回可直接 setInputFiles 的文件
async function paintImage(page, name, { width, height, noisy = false }) {
  const base64 = await page.evaluate(
    ({ width, height, noisy }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      if (noisy) {
        for (let y = 0; y < height; y += 8) {
          for (let x = 0; x < width; x += 8) {
            context.fillStyle = `hsl(${(x * 7 + y * 13) % 360} 80% 45%)`;
            context.fillRect(x, y, 8, 8);
          }
        }
      }
      context.fillStyle = "#1e3a8a";
      context.fillRect(width * 0.3, height * 0.2, width * 0.4, height * 0.6);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height, noisy },
  );
  return { name, mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

async function uploadVia(page, trigger, files) {
  const chooser = page.waitForEvent("filechooser");
  await trigger.click();
  await (await chooser).setFiles(files);
}

async function openTryon(page, query = "", { withHistory = false } = {}) {
  await page.addInitScript(() => {
    localStorage.setItem("starclouds-locale", "zh-CN");
  });
  await page.goto(`/ecommerce-design?tool=tryon${query}`);
  await expect(page.locator(".tryon-stage")).toBeVisible();
  if (withHistory) {
    await expect(page.locator(".tryon-history__item").first()).toBeVisible();
    return;
  }
  // 等内置模特/场景就位（结果区步骤里两项打勾）
  await expect(page.locator(".tryon-stage__steps li.is-done")).toHaveCount(2);
}

async function uploadGarment(page, name = "garment.png") {
  const file = await paintImage(page, name, { width: 900, height: 1200 });
  await uploadVia(
    page,
    page.getByRole("button", { name: "上传服装", exact: true }),
    file,
  );
  await expect(page.locator(".tryon-stage__garment img").first()).toBeVisible();
}

async function pickApparel(page, value) {
  await page.getByLabel("选择衣服类型").click();
  await page.getByRole("option", { name: value, exact: true }).click();
  await expect(page.locator(".tryon-stage__garment")).toHaveAttribute(
    "data-apparel",
    value,
  );
}

async function pickPack(page, label) {
  await page.getByLabel("选择出图套餐").click();
  // 选项名称后面带机位说明，按开头匹配
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  await page.getByRole("option", { name: new RegExp(`^${escaped}`) }).click();
}

test.describe("虚拟试衣：结果区与布局", () => {
  test("空结果区显示步骤引导、居中大按钮与积分，历史栏收起", async ({
    page,
  }) => {
    await mockApis(page);
    await openTryon(page);

    const steps = page.locator(".tryon-stage__steps li");
    await expect(steps).toHaveText([/服装\s*必填/, "模特", "场景"]);
    await expect(page.locator(".tryon-stage__empty-hint")).toHaveText(
      "还需上传服装",
    );

    const generate = page.locator(".tryon-generate");
    await expect(generate).toBeDisabled();
    await expect(generate).toContainText("1张 · 3 积分");
    const buttonBox = await generate.boundingBox();
    const resultBox = await page.locator(".tryon-stage__result").boundingBox();
    expect(buttonBox.height).toBeGreaterThanOrEqual(38);
    const buttonCenter = buttonBox.x + buttonBox.width / 2;
    const resultCenter = resultBox.x + resultBox.width / 2;
    expect(Math.abs(buttonCenter - resultCenter)).toBeLessThan(4);

    await expect(page.locator(".tryon-stage")).toHaveClass(/is-history-empty/);
    await expect(page.getByLabel("生成历史")).toBeHidden();
  });

  test("左侧工具栏显示三个分组标题", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await expect(page.locator(".commerce-rail__group-label")).toHaveText([
      "服饰模特",
      "商品设计",
      "图片处理",
    ]);
  });

  test("有历史时显示预计耗时（最近成功任务的中位数）", async ({ page }) => {
    await mockApis(page, {
      history: [
        tryonTask(0, { seconds: 50 }),
        tryonTask(1, { seconds: 60 }),
        tryonTask(2, { seconds: 90 }),
      ],
    });
    await openTryon(page, "", { withHistory: true });
    await expect(page.locator(".tryon-history__item")).toHaveCount(3);
    await expect(page.locator(".tryon-generate")).toContainText("约 60 秒");
  });

  test("没有历史时不显示预计耗时", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await expect(page.locator(".tryon-generate")).toContainText("3 积分");
    await expect(page.locator(".tryon-generate")).not.toContainText("秒");
  });
});

test.describe("虚拟试衣：服装识别与质检", () => {
  test("上传服装后自动识别品类并切换下拉", async ({ page }) => {
    const state = await mockApis(page);
    await openTryon(page);
    await uploadGarment(page);

    const chip = page.locator(".tryon-stage__detect");
    await expect(chip).toHaveClass(/is-done/);
    await expect(chip).toHaveText("深蓝蕾丝长礼服 · 全身");
    await expect(page.locator(".tryon-stage__garment")).toHaveAttribute(
      "data-apparel",
      "全身",
    );
    expect(state.classifyRequests).toHaveLength(1);
    expect(state.classifyRequests[0].inputKey).toMatch(
      /^uploads\/e2e-user-1\//,
    );
    await expect(page.locator(".tryon-stage__steps li.is-done")).toHaveCount(3);
  });

  test("识别失败时提示手动选择，品类保持不变", async ({ page }) => {
    await mockApis(page, { classify: null });
    await openTryon(page);
    await uploadGarment(page);
    await expect(page.locator(".tryon-stage__detect")).toHaveText(
      "未识别，请手动选类型",
    );
    await expect(page.locator(".tryon-stage__garment")).toHaveAttribute(
      "data-apparel",
      "上装",
    );
  });

  test("后台关闭服装识别时静默跳过，不显示任何识别提示", async ({ page }) => {
    await mockApis(page, { classify: null });
    await page.route("**/api/v1/commerce/tryon/garment-classifications", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          success: false,
          error: { code: "feature_disabled", message: "服装识别已关闭" },
        }),
      }),
    );
    await openTryon(page);
    await uploadGarment(page);
    await page.waitForTimeout(400);
    await expect(page.locator(".tryon-stage__detect")).toHaveCount(0);
    await expect(page.locator(".tryon-stage__garment")).toHaveAttribute(
      "data-apparel",
      "上装",
    );
  });

  test("已选套装时识别为上装不会覆盖套装", async ({ page }) => {
    await mockApis(page, { classify: { apparel: "上装", label: "白色衬衫" } });
    await openTryon(page);
    await pickApparel(page, "套装");
    await uploadGarment(page);
    await expect(page.locator(".tryon-stage__detect")).toContainText("白色衬衫");
    await expect(page.locator(".tryon-stage__garment")).toHaveAttribute(
      "data-apparel",
      "套装",
    );
  });

  test("低分辨率、杂乱背景的服装图给出质检提示", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    const file = await paintImage(page, "small-noisy.png", {
      width: 320,
      height: 400,
      noisy: true,
    });
    await uploadVia(
      page,
      page.getByRole("button", { name: "上传服装", exact: true }),
      file,
    );
    const hints = page.locator(".tryon-stage__garment .tryon-stage__hint");
    await expect(hints).toHaveCount(2);
    await expect(hints.nth(0)).toContainText("分辨率偏低（320×400）");
    await expect(hints.nth(1)).toContainText("背景较杂");
  });

  test("横版模特图提示可能含排版，干净大图不提示", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    const wide = await paintImage(page, "poster.png", {
      width: 1600,
      height: 900,
    });
    await uploadVia(
      page,
      page.getByRole("button", { name: "上传模特", exact: true }),
      wide,
    );
    const modelHints = page.locator(".tryon-stage__model .tryon-stage__hint");
    await expect(modelHints).toHaveCount(1);
    await expect(modelHints).toContainText("横版图可能含多余排版");

    const tall = await paintImage(page, "portrait.png", {
      width: 900,
      height: 1400,
    });
    await uploadVia(
      page,
      page.getByRole("button", { name: "上传模特", exact: true }),
      tall,
    );
    await expect(modelHints).toHaveCount(0);
  });
});

test.describe("虚拟试衣：套装、套餐与批量", () => {
  test("套装需要下装，生成时下装作为第 4 张参考图", async ({ page }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await pickApparel(page, "套装");

    await expect(page.locator(".tryon-stage__garment .tryon-stage__tag")).toHaveText(
      "上装",
    );
    await expect(page.locator(".tryon-stage__bottom.is-empty")).toBeVisible();
    await uploadGarment(page);
    await expect(page.locator(".tryon-stage__empty-hint")).toHaveText(
      "还需上传下装",
    );
    await expect(page.locator(".tryon-generate")).toBeDisabled();

    const bottom = await paintImage(page, "pants.png", {
      width: 900,
      height: 1200,
    });
    await uploadVia(
      page,
      page.locator(".tryon-stage__bottom-hit.is-upload"),
      bottom,
    );
    await expect(page.locator(".tryon-stage__bottom img")).toBeVisible();
    await expect(page.locator(".tryon-generate")).toBeEnabled();

    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(1);
    const task = state.createdTasks[0];
    expect(task.inputKeys).toHaveLength(4);
    expect(new Set(task.inputKeys).size).toBe(4);
    expect(task.prompt).toContain("按套装搭配生成");
    expect(task.prompt).toContain("第 4 张参考图是下装");
    expect(task.prompt).toContain("套装身份锁");
  });

  test("不选套装时不显示下装卡，也只发 3 张参考图", async ({ page }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await expect(page.locator(".tryon-stage__bottom")).toHaveCount(0);
    await uploadGarment(page);
    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(1);
    expect(state.createdTasks[0].inputKeys).toHaveLength(3);
    expect(state.createdTasks[0].prompt).not.toContain("按套装搭配生成");
    expect(state.createdTasks[0].prompt).not.toContain("套装身份锁");
    expect(state.createdTasks[0].prompt).toContain("三图身份锁");
  });

  test("上架套图：正面/背面/45°侧身/工艺特写 4 个机位，积分按 4 张计", async ({
    page,
  }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await pickPack(page, "上架套图（4张）");
    await expect(page.locator(".tryon-stage__pack-note")).toHaveText(
      "上架套图 · 正面主图 / 背面 / 45° 侧身 / 工艺特写",
    );
    await expect(page.locator(".tryon-generate")).toContainText(
      "4张 · 12 积分",
    );
    await uploadGarment(page);
    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(4);
    const byView = Object.fromEntries(
      state.createdTasks.map((task) => [task.params.viewId, task]),
    );
    expect(Object.keys(byView).sort()).toEqual([
      "angle",
      "back",
      "detail",
      "front",
    ]);
    for (const task of state.createdTasks) {
      expect(task.params.batchSize).toBe(4);
    }
    // 识别为上装：正面取七分身、特写拍领口袖口
    expect(byView.front.prompt).toContain("七分身");
    expect(byView.back.prompt).toContain("后领");
    expect(byView.detail.prompt).toContain("领口、袖口");
  });

  test("种草氛围：行走/回眸/近景/坐姿 4 个机位，下装自动换成坐姿垂感", async ({
    page,
  }) => {
    const state = await mockApis(page, {
      classify: { apparel: "下装", label: "阔腿裤" },
    });
    await openTryon(page);
    await pickPack(page, "种草氛围（4张）");
    await uploadGarment(page);
    await expect(page.locator(".tryon-stage__garment")).toHaveAttribute(
      "data-apparel",
      "下装",
    );
    await expect(page.locator(".tryon-stage__pack-note")).toHaveText(
      "种草氛围 · 行走抓拍 / 回眸 / 坐姿垂感 / 倚靠站姿",
    );
    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(4);
    const labels = state.createdTasks
      .slice()
      .sort((a, b) => a.params.batchIndex - b.params.batchIndex)
      .map((task) => task.params.viewLabel.split(" · ").pop());
    expect(labels).toEqual(["行走抓拍", "回眸", "坐姿垂感", "倚靠站姿"]);
  });

  test("切换服装类型时套图机位跟着变", async ({ page }) => {
    await mockApis(page, { classify: null });
    await openTryon(page);
    await pickPack(page, "种草氛围（4张）");
    const note = page.locator(".tryon-stage__pack-note");
    await expect(note).toContainText("半身氛围");
    await pickApparel(page, "下装");
    await expect(note).toContainText("坐姿垂感");
    await expect(note).not.toContainText("半身氛围");
  });

  test("批量：每件衣服独立一组参考图，模特和场景共用", async ({ page }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await uploadGarment(page);

    const extras = await Promise.all([
      paintImage(page, "shirt-2.png", { width: 900, height: 1200 }),
      paintImage(page, "shirt-3.png", { width: 900, height: 1200 }),
    ]);
    await uploadVia(page, page.locator(".tryon-stage__batch-add"), extras);
    await expect(page.locator(".tryon-stage__batch-item")).toHaveCount(2);
    await expect(page.locator(".tryon-stage__batch-index")).toHaveText([
      "2",
      "3",
    ]);
    await expect(page.locator(".tryon-generate")).toContainText(
      "3张 · 9 积分",
    );

    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(3);
    const keys = state.createdTasks
      .slice()
      .sort((a, b) => a.params.batchIndex - b.params.batchIndex)
      .map((task) => task.inputKeys);
    // 第 1 张参考图（服装）各不相同，第 2/3 张（模特、场景）完全一致
    expect(new Set(keys.map((list) => list[0])).size).toBe(3);
    expect(new Set(keys.map((list) => list[1])).size).toBe(1);
    expect(new Set(keys.map((list) => list[2])).size).toBe(1);
    const labels = state.createdTasks.map((task) => task.params.viewLabel);
    expect(labels.some((label) => label.includes("第 3件") || label.includes("第3件"))).toBe(true);
  });

  test("批量服装可以移除，最多再加 5 件；选套装时隐藏批量", async ({
    page,
  }) => {
    await mockApis(page, { classify: { apparel: "上装", label: "白色衬衫" } });
    await openTryon(page);
    await uploadGarment(page);
    const files = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        paintImage(page, `extra-${index}.png`, { width: 900, height: 1200 }),
      ),
    );
    await uploadVia(page, page.locator(".tryon-stage__batch-add"), files);
    await expect(page.locator(".tryon-stage__batch-item")).toHaveCount(5);
    await expect(page.locator(".tryon-stage__batch-add")).toHaveCount(0);

    await page.locator(".tryon-stage__batch-item").first().hover();
    await page.getByRole("button", { name: "移除这件服装" }).first().click();
    await expect(page.locator(".tryon-stage__batch-item")).toHaveCount(4);
    await expect(page.locator(".tryon-stage__batch-add")).toBeVisible();

    await pickApparel(page, "套装");
    await expect(page.locator(".tryon-stage__batch")).toHaveCount(0);
  });
});

test.describe("虚拟试衣：下载与首屏加载", () => {
  test("结果图悬停即可下载当前这张，不用进全屏", async ({ page }) => {
    await mockApis(page, { history: [withRefs(tryonTask(0), "a.png")] });
    await openTryon(page, "", { withHistory: true });
    await page.locator(".tryon-stage__result").hover();
    const fetched = page.waitForRequest((request) =>
      request.url().includes("mock-product.png?tryon=1"),
    );
    await page
      .locator(".tryon-stage__result-tools")
      .getByRole("button", { name: "下载", exact: true })
      .click();
    await fetched;
    // 单张结果没有“全部”
    await expect(
      page.locator(".tryon-stage__result-tools").getByRole("button", { name: /全部/ }),
    ).toHaveCount(0);
  });

  test("批量结果在卡组视图直接“下载全部”打包", async ({ page }) => {
    await mockApis(page, {
      history: [batchTask(0, 3), batchTask(1, 3), batchTask(2, 3)],
    });
    await openTryon(page, "", { withHistory: true });
    const all = page.locator(".tryon-stage__stacks-download");
    await expect(all).toContainText("下载全部");
    await expect(all).toContainText("3");
    const urls = new Set();
    page.on("request", (request) => {
      const match = request.url().match(/mock-product\.png\?tryon=(\d)/);
      if (match) urls.add(match[1]);
    });
    await all.click();
    await expect.poll(() => [...urls].sort()).toEqual(["1", "2", "3"]);
  });

  test("单件 4 连拍的单张视图有“全部 4”打包下载", async ({ page }) => {
    await mockApis(page, {
      history: [0, 1, 2, 3].map((index) =>
        batchTask(index, 4, { batchId: "pack", label: `虚拟试衣 · 机位${index + 1}` }),
      ),
    });
    await openTryon(page, "", { withHistory: true });
    await page.locator(".tryon-stage__result").hover();
    await expect(
      page.locator(".tryon-stage__result-tools").getByRole("button", { name: /全部 4/ }),
    ).toBeVisible();
  });

  test("硬刷新时不会先闪出空状态再跳成结果", async ({ page }) => {
    const history = [withRefs(tryonTask(0), "a.png")];
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    await mockApis(page, { history });
    // 让历史接口晚一点返回，放大加载窗口
    await page.route("**/api/v1/tasks?**", async (route) => {
      await gate;
      await route.fallback();
    });
    await page.addInitScript(() =>
      localStorage.setItem("starclouds-locale", "zh-CN"),
    );
    await page.goto("/ecommerce-design?tool=tryon");
    await expect(page.locator(".tryon-stage")).toBeVisible();
    // 加载中：结果区是骨架，不出现空状态引导，历史栏不收起
    await expect(page.locator(".tryon-stage__result")).toHaveClass(/is-pending/);
    await expect(page.locator(".tryon-stage__skeleton")).toHaveCount(1);
    await expect(page.locator(".tryon-stage__empty-guide")).toHaveCount(0);
    await expect(page.locator(".tryon-stage")).not.toHaveClass(/is-history-empty/);
    release();
    await expect(page.locator(".tryon-history__item")).toHaveCount(1);
    await expect(page.locator(".tryon-stage__skeleton")).toHaveCount(0);
    await expect(page.locator(".tryon-stage__empty-guide")).toHaveCount(0);
  });

  test("没有历史时加载完成后才显示空状态", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await expect(page.locator(".tryon-stage__empty-guide")).toBeVisible();
    await expect(page.locator(".tryon-stage")).toHaveClass(/is-history-empty/);
    await expect(page.locator(".tryon-stage__skeleton")).toHaveCount(0);
  });
});

test.describe("虚拟试衣：边出边看", () => {
  test("4 连拍出了 2 张就先显示，其余位置显示生成中", async ({ page }) => {
    await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
      finished: new Set([1, 2]),
    });
    await openTryon(page);
    await pickPack(page, "上架套图（4张）");
    await uploadGarment(page);
    await page.locator(".tryon-generate").click();
    const progress = page.locator(".tryon-stage__progress");
    await expect(progress).toContainText("已出 2/4", { timeout: 15_000 });
    // 不再整体遮挡：大图与挂卡片可见，未出的两格在转圈
    await expect(page.locator(".tryon-generating__frame")).toHaveCount(0);
    await expect(page.locator(".tryon-stage__hanging-card")).toHaveCount(4);
    await expect(
      page.locator(".tryon-stage__hanging-card.is-running"),
    ).toHaveCount(2);
    await expect(page.locator(".tryon-stage__result-image")).toBeVisible();
  });

  test("批量多件时先出来的件先成叠，没出的件显示生成中", async ({ page }) => {
    await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
      finished: new Set([1]),
    });
    await openTryon(page);
    await uploadGarment(page);
    const extra = await paintImage(page, "shirt-2.png", {
      width: 900,
      height: 1200,
    });
    await uploadVia(page, page.locator(".tryon-stage__batch-add"), [extra]);
    await page.locator(".tryon-generate").click();
    await expect(page.locator(".tryon-stage__progress")).toContainText(
      "已出 1/2",
      { timeout: 15_000 },
    );
    await expect(page.locator(".tryon-stage__stack")).toHaveCount(2);
    await expect(page.locator(".tryon-stage__stack.is-pending")).toHaveCount(1);
    await expect(page.locator(".tryon-stage__stack.is-pending")).toContainText(
      "生成中",
    );
  });

  test("一张都没出时仍显示生成动画", async ({ page }) => {
    await mockApis(page, { classify: { apparel: "上装", label: "白色衬衫" } });
    await openTryon(page);
    await pickPack(page, "上架套图（4张）");
    await uploadGarment(page);
    await page.locator(".tryon-generate").click();
    await expect(page.locator(".tryon-stage__result")).toHaveClass(/is-running/);
    await expect(page.locator(".tryon-stage__progress")).toHaveCount(0);
  });
});

test.describe("虚拟试衣：顶栏与历史", () => {
  test("试衣顶栏不显示业务中心和商品库，也不再有镜头选择", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await expect(page.locator(".commerce-header__actions button")).toHaveText([
      /创作台/,
      /电商历史/,
      /资产与素材/,
    ]);
    await expect(page.getByLabel("选择摄影镜头")).toHaveCount(0);
  });

  test("每个机位自带镜头：特写用微距、行走用人文镜头", async ({ page }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await pickPack(page, "上架套图（4张）");
    await uploadGarment(page);
    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(4);
    const byView = Object.fromEntries(
      state.createdTasks.map((task) => [task.params.viewId, task.prompt]),
    );
    expect(byView.front).toContain("85mm");
    expect(byView.detail).toContain("100mm 微距");
    // 不再有全局镜头硬约束
    expect(byView.front).not.toContain("这是画面透视和景深的硬约束");
  });

  test("下拉菜单：模型图标、名字、价格三列对齐，使用界面字体", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await page.getByLabel("选择生成模型").click();
    const layout = await page
      .locator(".commerce-select-menu button")
      .first()
      .evaluate((btn) => ({
        columns: getComputedStyle(btn).gridTemplateColumns.split(" ").length,
        font: getComputedStyle(btn).fontFamily,
        price: btn.querySelector(".commerce-select-aside").textContent.trim(),
        priceWidth: btn.querySelector(".commerce-select-aside").getBoundingClientRect().width,
      }));
    expect(layout.columns).toBe(4);
    expect(layout.font).not.toMatch(/Mono|Rajdhani/);
    expect(layout.price).toBe("3 积分/张");
    expect(layout.priceWidth).toBeGreaterThan(40);
  });

  test("电商历史按天分段、每次生成一行，时间是真实时间", async ({ page }) => {
    const now = Date.now();
    const at = (task, ago) => {
      task.params.batchCreatedAt = task.createdAt = new Date(now - ago).toISOString();
      return task;
    };
    const history = [
      ...[0, 1].map((i) => at(batchTask(i, 2, { batchId: "today", label: `虚拟试衣 · 机位${i + 1}` }), 60_000)),
      at(batchTask(0, 1, { batchId: "old", label: "虚拟试衣 · 正面主图" }), 3 * 86_400_000),
    ];
    await mockApis(page, { history });
    await openTryon(page, "", { withHistory: true });
    await page
      .locator(".commerce-header__actions button", { hasText: "电商历史" })
      .click();
    await expect(page.locator(".history-day__title")).toHaveCount(2);
    await expect(page.locator(".history-day__title").first()).toContainText("今天");
    await expect(page.locator(".history-batch")).toHaveCount(2);
    const first = page.locator(".history-batch").first();
    await expect(first.locator(".history-shot")).toHaveCount(2);
    await expect(first.locator(".history-batch__meta")).toContainText("2 张");
    await expect(first.locator(".history-batch__meta")).not.toContainText("01/01");
    await expect(first.locator(".history-batch__download")).toBeVisible();
    await expect(first.locator(".history-shot__label")).toHaveText(["机位1", "机位2"]);
    // 单张一行不显示“下载全部”
    await expect(page.locator(".history-batch").nth(1).locator(".history-batch__download")).toHaveCount(0);
    // 单张操作在悬停时出现
    await first.locator(".history-shot").first().hover();
    await expect(first.locator(".history-shot").first().getByRole("button", { name: "下载" })).toBeVisible();
  });
});

test.describe("虚拟试衣：历史浏览", () => {
  function page(n, size, prefix) {
    return Array.from({ length: size }, (_, i) => {
      const task = tryonTask(n * 100 + i);
      task.id = `${prefix}-${n}-${i}`;
      task.createdAt = task.params.batchCreatedAt = new Date(
        Date.now() - (n * 100 + i) * 60_000,
      ).toISOString();
      return task;
    });
  }

  test("电商历史点击图片打开大图，不再有“作为参考”", async ({ page: browser }) => {
    await mockApis(browser, { history: [withRefs(tryonTask(0), "a.png")] });
    await openTryon(browser, "", { withHistory: true });
    await browser
      .locator(".commerce-header__actions button", { hasText: "电商历史" })
      .click();
    await expect(browser.locator(".history-page")).toBeVisible();
    await expect(browser.getByRole("button", { name: "作为参考" })).toHaveCount(0);
    await browser.locator(".history-shot__media").first().click();
    await expect(browser.getByRole("dialog", { name: /全屏预览/ })).toBeVisible();
  });

  test("历史图片按原始比例完整显示，不裁切", async ({ page: browser }) => {
    const task = withRefs(tryonTask(0), "a.png");
    task.params.aspectRatio = "2:3";
    await mockApis(browser, { history: [task] });
    await openTryon(browser, "", { withHistory: true });
    await browser
      .locator(".commerce-header__actions button", { hasText: "电商历史" })
      .click();
    const media = browser.locator(".history-shot__media").first();
    const ratio = await media.evaluate((node) => {
      const box = node.getBoundingClientRect();
      return box.width / box.height;
    });
    expect(Math.abs(ratio - 2 / 3)).toBeLessThan(0.02);
    const fit = await media
      .locator("img")
      .evaluate((img) => getComputedStyle(img).objectFit);
    expect(fit).toBe("contain");
  });

  test("右侧历史栏滚到底自动加载下一页", async ({ page: browser }) => {
    const state = await mockApis(browser, {
      historyPages: [page(0, 12, "p"), page(1, 12, "p")],
    });
    await openTryon(browser, "", { withHistory: true });
    const items = browser.locator(".tryon-history__item");
    await expect(items).toHaveCount(12);
    await browser.locator(".tryon-history").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(items).toHaveCount(24);
    expect(state.historyRequests).toBeGreaterThanOrEqual(2);
    // 最后一页后不再显示加载占位
    await expect(browser.locator(".tryon-history__more")).toHaveCount(0);
  });

  test("电商历史页滚到底自动加载下一页，最后显示已经到底", async ({
    page: browser,
  }) => {
    await mockApis(browser, {
      historyPages: [page(0, 10, "h"), page(1, 10, "h")],
    });
    await openTryon(browser, "", { withHistory: true });
    await browser
      .locator(".commerce-header__actions button", { hasText: "电商历史" })
      .click();
    const shots = browser.locator(".history-shot");
    await expect(shots).toHaveCount(10);
    await browser.locator(".history-page__body").evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await expect(shots).toHaveCount(20);
    await expect(browser.locator(".history-page__end")).toContainText("已经到底了");
  });
});

test.describe("虚拟试衣：纯白棚拍背景", () => {
  test("纯白棚拍不发送场景图，提示词改为棚拍且不再提场景", async ({ page }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await page.getByRole("radio", { name: "纯白棚拍" }).click();
    await expect(page.getByRole("radio", { name: "纯白棚拍" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.locator(".tryon-stage__white-studio")).toContainText(
      "适合亚马逊等平台主图",
    );
    await expect(page.locator(".tryon-stage__steps")).toContainText("纯白棚拍");
    await uploadGarment(page);
    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(1);
    const task = state.createdTasks[0];
    expect(task.inputKeys).toHaveLength(2);
    expect(task.params.tryonBackdrop).toBe("white");
    expect(task.prompt).toContain("纯白棚拍");
    expect(task.prompt).toContain("RGB 255,255,255");
    expect(task.prompt).toContain("双身份锁");
    expect(task.prompt).not.toContain("第 3 张场景");
    expect(task.prompt).not.toContain("第 3 张参考图的场景");
  });

  test("纯白棚拍 + 套装：下装是第 3 张参考图", async ({ page }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await page.getByRole("radio", { name: "纯白棚拍" }).click();
    await pickApparel(page, "套装");
    await uploadGarment(page);
    const bottom = await paintImage(page, "pants.png", {
      width: 900,
      height: 1200,
    });
    await uploadVia(
      page,
      page.locator(".tryon-stage__bottom-hit.is-upload"),
      bottom,
    );
    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(1);
    const task = state.createdTasks[0];
    expect(task.inputKeys).toHaveLength(3);
    expect(task.prompt).toContain("第 3 张参考图是下装");
    expect(task.prompt).toContain("参考图角色：上装身份；模特身份；下装身份。");
  });

  test("背景选择刷新后保留", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await page.getByRole("radio", { name: "纯白棚拍" }).click();
    await page.waitForTimeout(700);
    await page.reload();
    await expect(page.getByRole("radio", { name: "纯白棚拍" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("虚拟试衣：全屏预览界面", () => {
  test("反复点缩略图和切换后，预览不会发生位移", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const history = Array.from({ length: 16 }, (_, index) => {
      const garment = Math.floor(index / 4);
      const task = batchTask(index, 16, {
        label: `虚拟试衣 · 机位${(index % 4) + 1} · 第${garment + 1}件`,
      });
      task.params.viewId = `s${index % 4}-g${garment + 1}`;
      return task;
    });
    await mockApis(page, { history });
    await openTryon(page, "", { withHistory: true });
    await page.locator(".tryon-stage__stack").first().click();
    const viewer = page.getByRole("dialog", { name: "批量结果预览" });
    await expect(viewer).toBeVisible();
    const thumbs = viewer.locator(".tryon-viewer__segment-items button");
    for (const at of [15, 3, 12, 0, 9, 14]) {
      await thumbs.nth(at).click();
    }
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press("ArrowRight");
    }
    await page.waitForTimeout(500);
    const layout = await viewer.evaluate((root) => ({
      scrollLeft: root.scrollLeft,
      scrollTop: root.scrollTop,
      left: root.getBoundingClientRect().left,
      titleLeft: root
        .querySelector(".tryon-viewer__title")
        .getBoundingClientRect().left,
      closeRight: root
        .querySelector('[aria-label="关闭预览"]')
        .getBoundingClientRect().right,
      width: window.innerWidth,
    }));
    expect(layout.scrollLeft).toBe(0);
    expect(layout.scrollTop).toBe(0);
    expect(layout.left).toBe(0);
    expect(layout.titleLeft).toBeGreaterThanOrEqual(0);
    expect(layout.closeRight).toBeLessThanOrEqual(layout.width);
    // 缩略条自身滚动，把当前这张带到可见区域
    const activeVisible = await viewer
      .locator(".tryon-viewer__segment-items button.is-active")
      .evaluate((node) => {
        const strip = node.closest(".tryon-viewer__strip").getBoundingClientRect();
        const box = node.getBoundingClientRect();
        return box.left >= strip.left - 1 && box.right <= strip.right + 1;
      });
    expect(activeVisible).toBe(true);
  });

  test("顶栏工具、氛围背景、本张输入、快捷键提示齐全", async ({ page }) => {
    await mockApis(page, {
      history: [batchTask(0, 2), batchTask(1, 2)],
    });
    await openTryon(page, "", { withHistory: true });
    await page.locator(".tryon-stage__stack").first().click();
    const viewer = page.getByRole("dialog", { name: "批量结果预览" });
    await expect(viewer.locator(".tryon-viewer__ambient")).toHaveCount(1);
    await expect(viewer.locator(".tryon-viewer__tools button")).toHaveText([
      "下载",
      "设为模特",
      "在画布查看",
      "",
    ]);
    await expect(viewer.locator(".tryon-viewer__inputs")).toContainText("本张输入");
    await expect(viewer.locator(".tryon-viewer__keys")).toContainText("切换");
    await expect(viewer).toBeFocused();
  });
});

test.describe("虚拟试衣：结果工具与交互", () => {
  test("结果图右下角有下载和设为模特，不再有对比；设为模特可撤销", async ({
    page,
  }) => {
    await mockApis(page, {
      history: [withRefs(tryonTask(0), "dress-used.png")],
    });
    await openTryon(page, "", { withHistory: true });
    const result = page.locator(".tryon-stage__result");
    await result.hover();
    const tools = page.locator(".tryon-stage__result-tools");
    await expect(tools.getByRole("button", { name: "下载", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "对比", exact: true })).toHaveCount(0);
    // 工具在右下角，秒数在左上角
    const layout = await result.evaluate((card) => {
      const box = card.getBoundingClientRect();
      const tools = card.querySelector(".tryon-stage__result-tools").getBoundingClientRect();
      const generate = card.querySelector(".tryon-generate").getBoundingClientRect();
      const elapsed = card.querySelector(".tryon-stage__elapsed")?.getBoundingClientRect();
      const overlap =
        tools.left < generate.right &&
        tools.right > generate.left &&
        tools.top < generate.bottom &&
        tools.bottom > generate.top;
      return {
        overlap,
        toolsRight: box.right - tools.right,
        toolsBottom: box.bottom - tools.bottom,
        elapsedLeft: elapsed ? elapsed.left - box.left : null,
        elapsedTop: elapsed ? elapsed.top - box.top : null,
      };
    });
    // 右下区域；卡片窄时工具换到生成按钮上一行，但绝不重叠
    expect(layout.toolsRight).toBeLessThan(16);
    expect(layout.toolsBottom).toBeLessThan(60);
    expect(layout.overlap).toBe(false);
    expect(layout.elapsedLeft).toBeLessThan(16);
    expect(layout.elapsedTop).toBeLessThan(16);

    await tools.getByRole("button", { name: "设为模特" }).click();
    const undo = page.locator(".tryon-stage__undo");
    await expect(undo).toContainText("已替换模特");
    await undo.getByRole("button", { name: "撤销" }).click();
    await expect(undo).toHaveCount(0);
  });

  test("移除下装后 6 秒内可撤销恢复", async ({ page }) => {
    await mockApis(page, { classify: { apparel: "上装", label: "白色衬衫" } });
    await openTryon(page);
    await pickApparel(page, "套装");
    const bottom = await paintImage(page, "pants.png", {
      width: 900,
      height: 1200,
    });
    await uploadVia(
      page,
      page.locator(".tryon-stage__bottom-hit.is-upload"),
      bottom,
    );
    await expect(page.locator(".tryon-stage__bottom img")).toBeVisible();

    await page.locator(".tryon-stage__bottom").hover();
    await page.getByRole("button", { name: "移除下装" }).click();
    await expect(page.locator(".tryon-stage__bottom.is-empty")).toBeVisible();
    await expect(page.locator(".tryon-stage__undo")).toContainText(
      "已移除下装",
    );
    await page.locator(".tryon-stage__undo button").click();
    await expect(page.locator(".tryon-stage__bottom img")).toBeVisible();
    await expect(page.locator(".tryon-stage__bottom img")).toHaveJSProperty(
      "complete",
      true,
    );
  });

  test("撤销提示 6 秒后自动消失", async ({ page }) => {
    await mockApis(page, { classify: { apparel: "上装", label: "白色衬衫" } });
    await openTryon(page);
    await uploadGarment(page, "first.png");
    await uploadGarment(page, "second.png");
    await expect(page.locator(".tryon-stage__undo")).toContainText(
      "已替换服装",
    );
    await expect(page.locator(".tryon-stage__undo")).toHaveCount(0, {
      timeout: 8000,
    });
  });

  test("快捷键：⌘/Ctrl+Enter 生成，←/→ 切历史，空格放大", async ({ page }) => {
    const state = await mockApis(page, {
      history: [tryonTask(0), tryonTask(1)],
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page, "", { withHistory: true });
    const items = page.locator(".tryon-history__item");
    await expect(items).toHaveCount(2);
    const active = () =>
      items.evaluateAll((nodes) =>
        nodes.findIndex((node) => node.classList.contains("is-active")),
      );
    await expect(page.locator(".tryon-history__item.is-active")).toHaveCount(1);
    // 历史首屏会先选中最新一张，稍等选中状态稳定后再记录
    await page.waitForTimeout(400);
    const first = await active();
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ArrowRight");
    await expect.poll(active).not.toBe(first);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(active).toBe(first);

    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog", { name: /预览|全屏/ })).toBeVisible();
    await page.keyboard.press("Escape");

    await uploadGarment(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect.poll(() => state.createdTasks.length).toBe(1);
  });

  test("在输入框里按方向键不会切换历史", async ({ page }) => {
    await mockApis(page, { history: [tryonTask(0), tryonTask(1)] });
    await openTryon(page, "", { withHistory: true });
    const items = page.locator(".tryon-history__item");
    const active = () =>
      items.evaluateAll((nodes) =>
        nodes.findIndex((node) => node.classList.contains("is-active")),
      );
    await expect(page.locator(".tryon-history__item.is-active")).toHaveCount(1);
    // 历史首屏会先选中最新一张，稍等选中状态稳定后再记录
    await page.waitForTimeout(400);
    const first = await active();
    await page.locator(".tryon-stage__result").hover();
    await page.getByRole("button", { name: "补充说明当前结果" }).click();
    const beforeKey = await active();
    await page.locator(".tryon-stage__result-input").press("ArrowRight");
    // 补充说明框开着时，即使焦点不在输入框里也不能切换
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(200);
    expect({ first, beforeKey, after: await active() }).toEqual({
      first,
      beforeKey: first,
      after: first,
    });
  });

  test("余额不足时在生成按钮旁提示去充值", async ({ page }) => {
    await mockApis(page, { wallet: 2 });
    await openTryon(page);
    const link = page.getByRole("link", { name: "积分不足，去充值" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "/wallet");
  });

  test("余额充足时不显示充值提示", async ({ page }) => {
    await mockApis(page, { wallet: 120 });
    await openTryon(page);
    await expect(page.locator(".tryon-generate")).toBeVisible();
    await expect(page.locator(".tryon-stage__balance")).toHaveCount(0);
  });
});

test.describe("虚拟试衣：整组结果与按实际输入对比", () => {
  test("多件批量：历史一格带张数，结果区显示折叠卡组", async ({ page }) => {
    await mockApis(page, {
      history: [batchTask(0, 3), batchTask(1, 3), batchTask(2, 3)],
    });
    await openTryon(page, "", { withHistory: true });
    await expect(page.locator(".tryon-history__item")).toHaveCount(1);
    await expect(page.locator(".tryon-history__count")).toHaveText("3");

    const stacks = page.locator(".tryon-stage__stack");
    await expect(stacks).toHaveCount(3);
    const labels = page.locator(".tryon-stage__stack-label");
    await expect(labels).toHaveCount(3);
    await expect(labels.nth(0)).toContainText("第1件");
    await expect(labels.nth(2)).toContainText("第3件");
    // 卡组视图里不显示作用于单张的工具，避免不知道改的是哪一张
    await page.locator(".tryon-stage__result").hover();
    await expect(page.locator(".tryon-stage__result-tools")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "补充说明当前结果" }),
    ).toHaveCount(0);
    await expect(page.locator(".tryon-stage__elapsed")).toHaveCount(0);
    await expect(page.locator(".tryon-stage__hanging")).toHaveCount(0);
  });

  test("点卡组进入全屏预览：切换、分段缩略条、本张输入，在画布查看回到单件", async ({
    page,
  }) => {
    const shots = ["上身主图", "版型侧面"];
    const history = [0, 1, 2, 3].map((index) => {
      const garment = Math.floor(index / 2);
      const task = batchTask(index, 4, {
        label: `虚拟试衣 · ${shots[index % 2]} · 第${garment + 1}件`,
      });
      task.params.viewId = `${index % 2 ? "side" : "hero"}-g${garment + 1}`;
      task.params.referenceKeys[0] = `uploads/e2e-user-1/garment-${garment + 1}.png`;
      return task;
    });
    await mockApis(page, { history });
    await openTryon(page, "", { withHistory: true });

    const stacks = page.locator(".tryon-stage__stack");
    await expect(stacks).toHaveCount(2);
    await expect(page.locator(".tryon-stage__stack-count")).toHaveText([
      "2",
      "2",
    ]);
    await stacks.nth(1).click();
    const viewer = page.getByRole("dialog", { name: "批量结果预览" });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator(".tryon-viewer__count")).toHaveText("3 / 4");
    await expect(viewer.locator(".tryon-viewer__title strong")).toHaveText(
      "第2件 · 上身主图",
    );
    await expect(viewer.locator(".tryon-viewer__segment-label")).toHaveText([
      "第1件",
      "第2件",
    ]);
    await expect(viewer.getByAltText("本张使用的衣服")).toBeVisible();
    await expect(viewer.getByAltText("本张使用的模特")).toBeVisible();

    await page.keyboard.press("ArrowRight");
    await expect(viewer.locator(".tryon-viewer__count")).toHaveText("4 / 4");
    await page.keyboard.press("ArrowRight");
    await expect(viewer.locator(".tryon-viewer__count")).toHaveText("1 / 4");
    await viewer.getByRole("button", { name: "上一张" }).click();
    await expect(viewer.locator(".tryon-viewer__count")).toHaveText("4 / 4");
    await viewer
      .locator(".tryon-viewer__segment button")
      .nth(1)
      .click();
    await expect(viewer.locator(".tryon-viewer__count")).toHaveText("2 / 4");

    // 预览里的方向键不能同时切换画布历史
    await expect(page.locator(".tryon-history__item.is-active")).toHaveCount(1);

    await viewer.getByRole("button", { name: "在画布查看" }).click();
    await expect(viewer).toHaveCount(0);
    await expect(page.locator(".tryon-stage__stacks")).toHaveCount(0);
    const back = page.locator(".tryon-stage__group-back");
    await expect(back).toContainText("返回全部 2 件");
    await expect(back).toContainText("第1件");
    // 单件视图：本件其余机位挂在右上角
    await expect(page.locator(".tryon-stage__hanging-card")).toHaveCount(2);
    await expect(
      page.locator(".tryon-stage__hanging-card.is-active"),
    ).toHaveCount(1);

    await back.click();
    await expect(stacks).toHaveCount(2);
  });

  test("卡组悬停拨动：左右划过逐张预览本件机位，点击从当前这张打开", async ({
    page,
  }) => {
    const shots = ["上身主图", "版型侧面", "穿着场景", "面料细节"];
    const history = Array.from({ length: 8 }, (_, index) => {
      const garment = Math.floor(index / 4);
      const task = batchTask(index, 8, {
        label: `虚拟试衣 · ${shots[index % 4]} · 第${garment + 1}件`,
      });
      task.params.viewId = `shot${index % 4}-g${garment + 1}`;
      return task;
    });
    await mockApis(page, { history });
    await openTryon(page, "", { withHistory: true });

    const stack = page.locator(".tryon-stage__stack").nth(1);
    const label = stack.locator(".tryon-stage__stack-label");
    await expect(label).toContainText("第2件");
    await expect(label).toContainText("上身主图");
    const box = await stack.boundingBox();
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.9, y);
    await expect(label).toContainText("面料细节");
    await expect(stack.locator(".tryon-stage__stack-skim i.is-on")).toHaveCount(1);
    await expect(stack.locator(".tryon-stage__stack-skim i").nth(3)).toHaveClass(/is-on/);
    await page.mouse.move(box.x + box.width * 0.35, y);
    await expect(label).toContainText("版型侧面");

    // 点击：从拨到的这张打开全屏
    await page.mouse.click(box.x + box.width * 0.35, y);
    const viewer = page.getByRole("dialog", { name: "批量结果预览" });
    await expect(viewer).toBeVisible();
    await expect(viewer.locator(".tryon-viewer__title strong")).toHaveText(
      "第2件 · 版型侧面",
    );
    await expect(viewer.locator(".tryon-viewer__count")).toHaveText("6 / 8");
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);

    // 移出后恢复主图
    await page.mouse.move(5, 5);
    await expect(label).toContainText("上身主图");
  });

  test("卡组支持键盘：聚焦后 ←/→ 拨动，不会切换画布历史", async ({ page }) => {
    const shots = ["上身主图", "版型侧面"];
    const history = Array.from({ length: 4 }, (_, index) => {
      const garment = Math.floor(index / 2);
      const task = batchTask(index, 4, {
        label: `虚拟试衣 · ${shots[index % 2]} · 第${garment + 1}件`,
      });
      task.params.viewId = `s${index % 2}-g${garment + 1}`;
      return task;
    });
    await mockApis(page, { history });
    await openTryon(page, "", { withHistory: true });
    const stack = page.locator(".tryon-stage__stack").first();
    await stack.focus();
    await page.keyboard.press("ArrowRight");
    await expect(stack.locator(".tryon-stage__stack-label")).toContainText(
      "版型侧面",
    );
    await expect(page.locator(".tryon-stage__stack")).toHaveCount(2);
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "批量结果预览" }),
    ).toContainText("第1件 · 版型侧面");
  });

  test("全屏预览：Esc 关闭，设为模特后关闭并可撤销", async ({ page }) => {
    await mockApis(page, {
      history: [batchTask(0, 2), batchTask(1, 2)],
    });
    await openTryon(page, "", { withHistory: true });
    const viewer = page.getByRole("dialog", { name: "批量结果预览" });
    await page.locator(".tryon-stage__stack").first().click();
    await expect(viewer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect(page.locator(".tryon-stage__stack")).toHaveCount(2);

    await page.locator(".tryon-stage__stack").first().click();
    await viewer.getByRole("button", { name: "设为模特" }).click();
    await expect(viewer).toHaveCount(0);
    await expect(page.locator(".tryon-stage__undo")).toContainText(
      "已替换模特",
    );
  });

  test("全屏预览的下载会取回当前这张图", async ({ page }) => {
    await mockApis(page, {
      history: [batchTask(0, 2), batchTask(1, 2)],
    });
    await openTryon(page, "", { withHistory: true });
    await page.locator(".tryon-stage__stack").nth(1).click();
    const viewer = page.getByRole("dialog", { name: "批量结果预览" });
    const fetched = page.waitForRequest((request) =>
      request.url().includes("mock-product.png?tryon=2"),
    );
    await viewer.getByRole("button", { name: "下载", exact: true }).click();
    await fetched;
  });

  test("单件 4 连拍：其余机位挂在大图右上角，缺的显示占位，点击切换", async ({
    page,
  }) => {
    const shots = ["上身主图", "版型侧面", "穿着场景", "面料细节"];
    await mockApis(page, {
      history: [0, 1, 3].map((index) =>
        batchTask(index, 4, {
          batchId: "e2e-pack",
          label: `虚拟试衣 · ${shots[index]}`,
        }),
      ),
    });
    await openTryon(page, "", { withHistory: true });
    await expect(page.locator(".tryon-stage__stacks")).toHaveCount(0);
    const cards = page.locator(".tryon-stage__hanging-card");
    await expect(cards).toHaveCount(4);
    await expect(
      page.locator(".tryon-stage__hanging-card.is-pending"),
    ).toHaveCount(1);
    await expect(cards.nth(2)).toHaveClass(/is-pending/);
    await cards.nth(3).click();
    await expect(cards.nth(3)).toHaveClass(/is-active/);
    await expect(cards.nth(3)).toHaveAttribute("title", "面料细节");
    // 单件视图保留单张工具
    await page.locator(".tryon-stage__result").hover();
    await expect(page.getByRole("button", { name: "设为模特" })).toBeVisible();
  });

  test("单张结果不显示挂卡片", async ({ page }) => {
    await mockApis(page, { history: [withRefs(tryonTask(0), "a.png")] });
    await openTryon(page, "", { withHistory: true });
    await expect(page.locator(".tryon-stage__hanging")).toHaveCount(0);
    await expect(page.locator(".tryon-stage__stacks")).toHaveCount(0);
  });

  test("←/→ 按组切换，而不是在同一组内逐张跳", async ({ page }) => {
    const single = withRefs(tryonTask(9), "single.png");
    single.createdAt = "2026-01-03T00:00:00.000Z";
    single.params.batchCreatedAt = single.createdAt;
    await mockApis(page, {
      history: [single, batchTask(0, 3), batchTask(1, 3), batchTask(2, 3)],
    });
    await openTryon(page, "", { withHistory: true });
    const items = page.locator(".tryon-history__item");
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toHaveClass(/is-active/);
    await page.waitForTimeout(400);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press("ArrowRight");
    await expect(items.nth(1)).toHaveClass(/is-active/);
    await expect(page.locator(".tryon-stage__stack")).toHaveCount(3);
    await page.keyboard.press("ArrowRight");
    await expect(items.nth(0)).toHaveClass(/is-active/);
  });

  test("没有记录输入图的旧结果不显示对比，避免和错的衣服对比", async ({
    page,
  }) => {
    await mockApis(page, {
      history: [tryonTask(0)],
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page, "", { withHistory: true });
    await uploadGarment(page);
    await page.locator(".tryon-stage__result").hover();
    await expect(page.getByRole("button", { name: "设为模特" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "对比", exact: true }),
    ).toHaveCount(0);
  });

  test("新建任务时记录每张实际用的参考图（批量各不相同）", async ({ page }) => {
    const state = await mockApis(page, {
      classify: { apparel: "上装", label: "白色衬衫" },
    });
    await openTryon(page);
    await uploadGarment(page);
    const extra = await paintImage(page, "shirt-2.png", {
      width: 900,
      height: 1200,
    });
    await uploadVia(page, page.locator(".tryon-stage__batch-add"), [extra]);
    await page.locator(".tryon-generate").click();
    await expect.poll(() => state.createdTasks.length).toBe(2);
    for (const task of state.createdTasks) {
      expect(task.params.referenceKeys).toEqual(task.inputKeys);
    }
    const garments = state.createdTasks.map((task) => task.params.referenceKeys[0]);
    expect(new Set(garments).size).toBe(2);
  });
});

test.describe("虚拟试衣：卡片布局", () => {
  test("衣服卡片：顶部一行、底部一栈，互不重叠且不超出卡片", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 860 });
    await mockApis(page, {
      classify: { apparel: "全身", label: "深蓝蕾丝长礼服很长很长的名字" },
    });
    await openTryon(page);
    const file = await paintImage(page, "small.png", {
      width: 420,
      height: 560,
      noisy: true,
    });
    await uploadVia(
      page,
      page.getByRole("button", { name: "上传服装", exact: true }),
      file,
    );
    await expect(page.locator(".tryon-stage__detect")).toHaveClass(/is-done/);
    const extras = await Promise.all(
      [1, 2].map((index) =>
        paintImage(page, `e${index}.png`, { width: 900, height: 1200 }),
      ),
    );
    await uploadVia(page, page.locator(".tryon-stage__batch-add"), extras);
    await expect(page.locator(".tryon-stage__batch-item")).toHaveCount(2);

    const layout = await page.locator(".tryon-stage__garment").evaluate((card) => {
      const box = (selector) => {
        const node = card.querySelector(selector);
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, height: rect.height };
      };
      const cardBox = card.getBoundingClientRect();
      const hints = [...card.querySelectorAll(".tryon-stage__hint")].map((node) => ({
        height: node.getBoundingClientRect().height,
        right: node.getBoundingClientRect().right,
      }));
      const controls = [
        ...card.querySelectorAll(".tryon-stage__card-actions button, .tryon-stage__card-actions .commerce-select-trigger"),
      ].map((node) => node.getBoundingClientRect().height);
      return {
        card: { top: cardBox.top, bottom: cardBox.bottom, left: cardBox.left, right: cardBox.right },
        head: box(".tryon-stage__head"),
        foot: box(".tryon-stage__foot"),
        actions: box(".tryon-stage__card-actions"),
        hints,
        controls,
      };
    });
    // 顶部一行：标签和识别结果在同一行
    expect(layout.head.height).toBeLessThanOrEqual(30);
    // 底部栈在操作栏之上、在顶部行之下
    expect(layout.foot.bottom).toBeLessThanOrEqual(layout.actions.top + 1);
    expect(layout.foot.top).toBeGreaterThan(layout.head.bottom);
    // 每条提示单行，不超出卡片
    for (const hint of layout.hints) {
      expect(hint.height).toBeLessThanOrEqual(26);
      expect(hint.right).toBeLessThanOrEqual(layout.card.right);
    }
    // 操作栏控件等高
    expect(new Set(layout.controls.map((value) => Math.round(value))).size).toBe(1);
    expect(layout.actions.left).toBeGreaterThanOrEqual(layout.card.left);
    expect(layout.actions.right).toBeLessThanOrEqual(layout.card.right);
  });
});

test.describe("虚拟试衣：模特裁剪", () => {
  test("框选人物后替换模特图，可撤销", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    const poster = await paintImage(page, "poster.png", {
      width: 3200,
      height: 1800,
    });
    await uploadVia(
      page,
      page.getByRole("button", { name: "上传模特", exact: true }),
      poster,
    );
    await expect(
      page.locator(".tryon-stage__model .tryon-stage__hint", {
        hasText: "横版",
      }),
    ).toHaveCount(1);
    await page.locator(".tryon-stage__model button", { hasText: "裁剪" }).click();
    const dialog = page.getByRole("dialog", { name: "裁剪模特" });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole("button", { name: "使用裁剪" });
    await expect(confirm).toBeDisabled();

    const stage = dialog.locator(".tryon-crop__stage");
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.1);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.9, {
      steps: 6,
    });
    await page.mouse.up();
    await expect(dialog.locator(".tryon-crop__box")).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".tryon-stage__undo")).toContainText(
      "已替换模特",
    );
    // 裁剪后是竖版图，横版提示消失
    await expect(
      page.locator(".tryon-stage__model .tryon-stage__hint", {
        hasText: "横版",
      }),
    ).toHaveCount(0);
  });

  test("太小的框自动重置，取消不改动模特", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    // 内置模特在生成时才取图，只有自己上传的模特才能裁剪
    await expect(
      page.locator(".tryon-stage__model button", { hasText: "裁剪" }),
    ).toHaveCount(0);
    const portrait = await paintImage(page, "portrait.png", {
      width: 900,
      height: 1400,
    });
    await uploadVia(
      page,
      page.getByRole("button", { name: "上传模特", exact: true }),
      portrait,
    );
    const modelImage = page.locator(".tryon-stage__model img").first();
    await expect(modelImage).toHaveAttribute("src", /^blob:/);
    const srcBefore = await modelImage.getAttribute("src");
    await page.locator(".tryon-stage__model button", { hasText: "裁剪" }).click();
    const dialog = page.getByRole("dialog", { name: "裁剪模特" });
    const stage = dialog.locator(".tryon-crop__stage");
    const box = await stage.boundingBox();
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 12, box.y + 12);
    await page.mouse.up();
    await expect(dialog.locator(".tryon-crop__box")).toHaveCount(0);
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(modelImage).toHaveAttribute("src", srcBefore);
  });
});

test.describe("虚拟试衣：收藏、最近与草稿记忆", () => {
  test("收藏的模特排最前，最近选过的带标记，刷新后仍在", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await page.getByRole("button", { name: "更多模特" }).click();
    const dialog = page.getByRole("dialog", { name: "选择模特" });
    const names = dialog.locator(".tryon-model-popup__name");
    await expect(names).toHaveText(["东亚女性", "欧美男性", "南亚女性"]);

    await dialog.locator(".tryon-model-popup__card").nth(2).hover();
    await dialog.getByRole("button", { name: "收藏 南亚女性" }).click();
    await expect(names).toHaveText(["南亚女性", "东亚女性", "欧美男性"]);
    await expect(
      dialog.getByRole("button", { name: "取消收藏 南亚女性" }),
    ).toHaveAttribute("aria-pressed", "true");

    await dialog.getByRole("button", { name: "欧美男性", exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await page.reload();
    await expect(page.locator(".tryon-stage")).toBeVisible();
    await page.getByRole("button", { name: "更多模特" }).click();
    const reopened = page.getByRole("dialog", { name: "选择模特" });
    await expect(reopened.locator(".tryon-model-popup__name")).toHaveText([
      "南亚女性",
      "欧美男性",
      "东亚女性",
    ]);
    await expect(reopened.locator(".tryon-model-popup__recent")).toHaveCount(1);
  });

  test("选择弹窗：模特完整显示不裁切，名字在图下方，筛选收藏/最近，第一格可上传", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "starclouds.tryon.picks.model.v1",
        JSON.stringify({ favorites: ["south-asian-female"], recent: ["european-male"] }),
      );
    });
    await mockApis(page);
    await openTryon(page);
    await page.getByRole("button", { name: "更多模特" }).click();
    const dialog = page.getByRole("dialog", { name: "选择模特" });
    await expect(dialog).toBeVisible();

    // 按原始比例完整显示：图片框的宽高比与图片本身一致，不留色边也不裁切
    const firstImage = dialog.locator(".tryon-model-popup__media img").first();
    await expect(firstImage).toHaveJSProperty("complete", true);
    const ratios = await firstImage.evaluate((img) => {
      const box = img.parentElement.getBoundingClientRect();
      return {
        box: box.width / box.height,
        image: img.naturalWidth / img.naturalHeight,
      };
    });
    expect(Math.abs(ratios.box - ratios.image)).toBeLessThan(0.02);
    // 名字不再压在图片上
    const nameInsideMedia = await dialog
      .locator(".tryon-model-popup__media .tryon-model-popup__name")
      .count();
    expect(nameInsideMedia).toBe(0);

    const tabs = dialog.getByRole("tab");
    await expect(tabs).toHaveText([/全部\s*3/, /收藏\s*1/, /最近\s*1/]);
    await dialog.getByRole("tab", { name: /收藏/ }).click();
    await expect(dialog.locator(".tryon-model-popup__name")).toHaveText([
      "南亚女性",
    ]);
    await expect(dialog.locator(".tryon-model-popup__upload")).toHaveCount(0);
    await dialog.getByRole("tab", { name: /最近/ }).click();
    await expect(dialog.locator(".tryon-model-popup__name")).toHaveText([
      "欧美男性",
    ]);
    await dialog.getByRole("tab", { name: /全部/ }).click();

    const upload = dialog.locator(".tryon-model-popup__upload");
    await expect(upload).toContainText("上传模特");
    const chooser = page.waitForEvent("filechooser");
    await upload.click();
    await chooser;
    await expect(dialog).toHaveCount(0);
  });

  test("上传过的模特进入“最近”，点击复用且不重复上传，可移除", async ({
    page,
  }) => {
    const state = await mockApis(page);
    await openTryon(page);
    const portrait = await paintImage(page, "me.png", { width: 900, height: 1400 });
    await uploadVia(
      page,
      page.getByRole("button", { name: "上传模特", exact: true }),
      portrait,
    );
    await expect.poll(() => state.uploads).toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(localStorage.getItem("starclouds.tryon.custom.model.v1") || "[]").length,
        ),
      )
      .toBe(1);

    await page.getByRole("button", { name: "更多模特" }).click();
    const dialog = page.getByRole("dialog", { name: "选择模特" });
    await dialog.getByRole("tab", { name: /最近/ }).click();
    const custom = dialog.locator(".tryon-model-popup__card.is-custom");
    await expect(custom).toHaveCount(1);
    await expect(custom).toContainText("我上传的");
    await expect(custom.locator("img")).toHaveAttribute(
      "src",
      /^\/api\/v1\/files\/uploads\//,
    );

    // 先换成内置模特，再从“最近”选回自己的图
    await dialog.getByRole("tab", { name: /全部/ }).click();
    await dialog.getByRole("button", { name: "东亚女性", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const uploadsBefore = state.uploads;
    await page.getByRole("button", { name: "更多模特" }).click();
    await dialog.getByRole("tab", { name: /最近/ }).click();
    await dialog.locator(".tryon-model-popup__card.is-custom .tryon-model-popup__hit").click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".tryon-stage__model img").first()).toHaveAttribute(
      "src",
      /^blob:/,
    );
    await page.waitForTimeout(300);
    expect(state.uploads).toBe(uploadsBefore);

    await page.getByRole("button", { name: "更多模特" }).click();
    await dialog.getByRole("tab", { name: /最近/ }).click();
    await dialog.locator(".tryon-model-popup__card.is-custom").hover();
    await dialog.getByRole("button", { name: /^移除/ }).click();
    await expect(dialog.locator(".tryon-model-popup__card.is-custom")).toHaveCount(0);
  });

  test("“设为模特”的结果图也进入最近", async ({ page }) => {
    const task = tryonTask(0);
    task.originalUrls = task.outputUrls = [
      "/api/v1/files/tasks/e2e-user-1/result-1.png",
    ];
    await mockApis(page, { history: [task] });
    await openTryon(page, "", { withHistory: true });
    await page.locator(".tryon-stage__result").hover();
    await page.getByRole("button", { name: "设为模特" }).click();
    await expect(page.locator(".tryon-stage__undo")).toContainText("已替换模特");
    await page.getByRole("button", { name: "更多模特" }).click();
    const dialog = page.getByRole("dialog", { name: "选择模特" });
    await dialog.getByRole("tab", { name: /最近/ }).click();
    const custom = dialog.locator(".tryon-model-popup__card.is-custom");
    await expect(custom).toHaveCount(1);
    await expect(custom).toContainText("试衣结果");
    await expect(custom.locator("img")).toHaveAttribute(
      "src",
      "/api/v1/files/tasks/e2e-user-1/result-1.png",
    );
  });

  test("没有收藏和最近时不显示筛选", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await page.getByRole("button", { name: "更多场景" }).click();
    const dialog = page.getByRole("dialog", { name: "选择拍摄场景" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("tab")).toHaveCount(0);
    const fit = await dialog
      .locator(".tryon-model-popup__media img")
      .first()
      .evaluate((img) => getComputedStyle(img).objectFit);
    // 场景图是背景，铺满显示
    expect(fit).toBe("cover");
  });

  test("光影、出图套餐在刷新后保留", async ({ page }) => {
    await mockApis(page);
    await openTryon(page);
    await pickPack(page, "上架套图（4张）");
    await page.getByLabel("选择光影调整").click();
    const lightOptions = page.getByRole("option");
    const lightLabel = (await lightOptions.nth(1).innerText()).trim();
    await lightOptions.nth(1).click();
    // 草稿有 280ms 防抖
    await page.waitForTimeout(700);

    await page.reload();
    await expect(page.locator(".tryon-stage")).toBeVisible();
    await expect(page.getByLabel("选择出图套餐")).toContainText("上架套图");
    await expect(page.getByLabel("选择光影调整")).toContainText(
      lightLabel.split("\n")[0],
    );
  });
});

test.describe("虚拟试衣：手机端", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("输入卡横向滑动吸附，顶部参数条可横滑且模型不被挤压", async ({
    page,
  }) => {
    await mockApis(page);
    await openTryon(page);
    const frame = page.locator(".tryon-stage__frame");
    const layout = await frame.evaluate((node) => ({
      display: getComputedStyle(node).display,
      snap: getComputedStyle(node).scrollSnapType,
      overflowX: getComputedStyle(node).overflowX,
      scrollable: node.scrollWidth > node.clientWidth,
    }));
    expect(layout.display).toBe("flex");
    expect(layout.snap).toContain("x");
    expect(layout.overflowX).toBe("auto");
    expect(layout.scrollable).toBe(true);

    const header = page.locator(".commerce-header__tryon");
    const headerLayout = await header.evaluate((node) => ({
      overflowX: getComputedStyle(node).overflowX,
      modelWidth: node
        .querySelector(".commerce-header__model")
        .getBoundingClientRect().width,
    }));
    expect(headerLayout.overflowX).toBe("auto");
    expect(headerLayout.modelWidth).toBeGreaterThan(120);

    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(pageOverflow).toBe(false);
  });
});

test.describe("虚拟试衣：暗色模式", () => {
  // 按 WCAG 相对亮度计算文字与其实际背景的对比度
  async function contrastOf(locator) {
    return locator.evaluate((node) => {
      const parse = (value) => {
        const m = value.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = 1] = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
        return { r, g, b, a };
      };
      const lum = ({ r, g, b }) => {
        const c = [r, g, b].map((v) => {
          const x = v / 255;
          return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const fg = parse(getComputedStyle(node).color);
      let bg = null;
      for (let el = node; el; el = el.parentElement) {
        const color = parse(getComputedStyle(el).backgroundColor);
        if (color && color.a > 0.5) {
          bg = color;
          break;
        }
      }
      bg = bg || { r: 0, g: 0, b: 0 };
      const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return (hi + 0.05) / (lo + 0.05);
    });
  }

  test("纯白棚拍卡片与充值提示在暗色下文字清晰可读", async ({ page }) => {
    await mockApis(page, { wallet: 1 });
    await openTryon(page);
    await page.evaluate(() =>
      document.documentElement.classList.add("color-scheme-dark"),
    );
    await page.getByRole("radio", { name: "纯白棚拍" }).click();
    const card = page.locator(".tryon-stage__white-studio");
    await expect(card).toBeVisible();
    expect(await contrastOf(card.locator("strong"))).toBeGreaterThan(4.5);
    for (const small of await card.locator("small").all()) {
      expect(await contrastOf(small)).toBeGreaterThan(3);
    }
    const balance = page.getByRole("link", { name: "积分不足，去充值" });
    await expect(balance).toBeVisible();
    expect(await contrastOf(balance)).toBeGreaterThan(4.5);
    // 暗色下充值提示不能是浅色底
    const bgLightness = await balance.evaluate((node) => {
      const [r, g, b] = getComputedStyle(node)
        .backgroundColor.match(/\d+(\.\d+)?/g)
        .map(Number);
      return (r + g + b) / 3;
    });
    expect(bgLightness).toBeLessThan(128);
  });
});

