import { expect, test } from "@playwright/test";

const USER = {
  id: "e2e-user-1",
  email: "e2e@example.com",
  username: "E2E 用户",
  displayName: "E2E 用户",
};

const IMAGE_MODEL = {
  id: "e2e-image-model",
  publicModelKey: "e2e-image-model",
  label: "E2E 图片模型",
  default: true,
  capabilities: ["image.generate", "image.edit", "imageToImage"],
  aspectRatios: ["1:1", "3:4", "4:5", "16:9", "9:16"],
  aspectRatiosByResolution: { "1K": ["1:1", "3:4", "4:5", "16:9", "9:16"] },
  qualities: ["low", "medium", "high"],
  resolutions: ["1K"],
  maxReferenceImages: 6,
  creditCost: 3,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("starclouds-locale", "zh-CN"),
  );
  await mockEcommerceApis(page);
});

// 打开工作台顶部工具栏的某个菜单（如“商品信息”），返回菜单弹层。
// 切换业务后页头会有入场动画，点击可能落在重渲染之间，这里以 aria-expanded 为准并允许重试一次。
async function openWorkbenchMenu(page, label) {
  const trigger = page.getByRole("button", { name: new RegExp(`^${label}，当前：`) });
  await expect(trigger).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await trigger.click();
    try {
      await expect(trigger).toHaveAttribute("aria-expanded", "true", {
        timeout: 1500,
      });
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  const menu = page.getByRole("dialog", { name: `${label}设置` });
  await expect(menu).toBeVisible();
  return menu;
}

test("AI commerce opens in a canvas-first commercial shoot workbench", async ({
  page,
}) => {
  await page.goto("/ecommerce-design");

  const workbench = page.locator(".commerce-workbench.is-shoot");
  await expect(workbench).toBeVisible();
  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(page.locator(".workbench-toolbar")).toBeVisible();
  // 业务中心已移除：只剩创作台与电商历史
  await expect(page.locator(".commerce-header__actions button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "上传商品" }).first()).toBeVisible();
  await expect(
    page.getByRole("radiogroup", { name: "选择画面比例" }).getByRole("radio"),
  ).toHaveCount(5);
  await expect(page.getByRole("radiogroup", { name: "选择出图任务" })).toHaveCount(0);
  const shots = page.getByRole("group", { name: "拍摄镜头" });
  await expect(shots.getByRole("checkbox")).toHaveCount(6);
  await expect(shots.getByRole("checkbox", { checked: true })).toHaveCount(4);
  // 第 1 个选中的镜头是整套定调首张
  await expect(page.locator(".workbench-shots")).toContainText("4/4 张 · 商品主视觉定调");
  await expect(page.locator(".workbench-plan li").first()).toHaveClass(/is-anchor/);
  // 已选满 4 个：未选镜头不能再加
  await shots.getByRole("checkbox", { name: "尺寸比例" }).click();
  await expect(shots.getByRole("checkbox", { name: "尺寸比例" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(page.locator(".workbench-plan")).toContainText(
    "首张先出定调，其余参照首张成片生成",
  );
  // 商品不变项摘要露在画布上，点击打开“商业目标”里的完整设置
  const factLock = page.getByRole("button", { name: /^商品不变项 6 项/ });
  await expect(factLock).toBeVisible();
  await factLock.click();
  const lockMenu = page.getByRole("dialog", { name: "商业目标设置" });
  await expect(lockMenu).toBeVisible();
  await expect(lockMenu.getByPlaceholder("Logo、包装文字、颜色、比例…")).toHaveValue(
    /商品外形与比例/,
  );
  await page.keyboard.press("Escape");
  await expect(lockMenu).toHaveCount(0);
  await expect(
    page.getByRole("radiogroup", { name: "拍摄方向" }).getByRole("radio"),
  ).toHaveCount(4);
  await expect(page.locator(".workbench-plan li")).toHaveCount(4);
  await expect(page.locator(".workbench-empty__steps li")).toHaveCount(3);
  const generate = page.getByRole("button", { name: /^生成商拍成片/ });
  await expect(generate).toBeDisabled();

  const goalMenu = await openWorkbenchMenu(page, "商业目标");
  await goalMenu.getByRole("radio", { name: "社媒种草" }).click();
  await goalMenu.getByRole("radio", { name: "建立质感" }).click();
  await goalMenu
    .getByPlaceholder("例如：25-35岁城市通勤人群")
    .fill("25-35岁城市通勤人群");
  await expect(
    page.getByRole("button", { name: "商业目标，当前：社媒种草 · 建立质感" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(goalMenu).toHaveCount(0);

  await shots.getByRole("checkbox", { name: /材质细节/ }).click();
  await shots.getByRole("checkbox", { name: /卖点表达/ }).click();
  await expect(page.locator(".workbench-plan li")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^生成商拍成片（2张）/ })).toHaveCount(
    1,
  );

  const lifestyle = page
    .getByRole("radiogroup", { name: "拍摄方向" })
    .getByRole("radio", { name: "生活场景" });
  await lifestyle.click();
  await expect(lifestyle).toHaveAttribute("aria-checked", "true");

  await page
    .getByRole("radiogroup", { name: "选择画面比例" })
    .getByRole("radio", { name: /方图/ })
    .click();
  const frame = await page.locator(".handheld-frame").boundingBox();
  expect(Math.abs(frame.width / frame.height - 1)).toBeLessThan(0.03);

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "product.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(page.locator(".workbench-refs .handheld-ref-card.has-file")).toHaveCount(1);
  await expect(page.locator(".workbench-angles")).toBeVisible();
  await expect(page.getByRole("button", { name: /^生成商拍成片（2张）/ })).toBeEnabled();
});

test("commercial shoot creates the hero first and anchors the other shots to it", async ({
  page,
}) => {
  const created = [];
  await page.route("**/api/v1/tasks", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = request.postDataJSON();
    const index = Number(body.params?.batchIndex) || 0;
    // 首张稍慢返回：后续几张必须等它建好才能拿到它的任务 ID
    if (index === 0) await new Promise((resolve) => setTimeout(resolve, 200));
    const { seriesAnchorTaskId, ...params } = body.params || {};
    created.push({ index, seriesAnchorTaskId, prompt: body.prompt, at: Date.now() });
    await fulfill(route, {
      id: `e2e-shoot-task-${index + 1}`,
      type: "ecommerce_design",
      status: index === 0 ? "running" : "queued",
      prompt: body.prompt,
      params: {
        ...params,
        ...(seriesAnchorTaskId ? { _seriesAnchorTaskId: seriesAnchorTaskId } : {}),
      },
      count: 1,
      outputUrls: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  await page.goto("/ecommerce-design?tool=shoot");
  await expect(page.locator(".commerce-workbench.is-shoot")).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "product.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(page.locator(".workbench-refs .handheld-ref-card.has-file")).toHaveCount(1);
  await page.getByRole("button", { name: /^生成商拍成片（4张）/ }).click();
  const dialog = page.getByRole("dialog", { name: "确认生成费用" });
  await expect(dialog).toBeVisible();
  await page.locator(".ai-cost-confirm-btn.primary").click();

  await expect.poll(() => created.length).toBe(4);
  const hero = created.find((item) => item.index === 0);
  const followers = created.filter((item) => item.index > 0);
  expect(hero.seriesAnchorTaskId).toBeUndefined();
  for (const follower of followers) {
    expect(follower.seriesAnchorTaskId).toBe("e2e-shoot-task-1");
    expect(follower.at).toBeGreaterThanOrEqual(hero.at);
  }
  // 拍摄方向只定基调；每张有自己的景别，且不混入文字类要求
  const promptOf = (index) => created.find((item) => item.index === index).prompt;
  for (const item of created) {
    expect(item.prompt).toContain("整套视觉基调：干净棚拍");
    expect(item.prompt).toContain("真实相机拍摄质感的商业商品摄影");
    expect(item.prompt).not.toContain("拍摄场景：");
    expect(item.prompt).not.toContain("文字必须准确清晰");
  }
  expect(promptOf(0)).toContain("景别：全景主视觉");
  expect(promptOf(1)).toContain("景别：中景使用场景");
  expect(promptOf(1)).toContain("不要影棚纯色背景");
  expect(promptOf(2)).toContain("景别：微距特写");
  expect(promptOf(3)).toContain("景别：广告构图");

  // 首张还在生成：后续几张显示“等首张”，方案列表标出等待
  const thumbs = page.getByLabel("本次套图");
  await expect(thumbs.getByRole("listitem", { name: /等待首张定调/ })).toHaveCount(3);
  await expect(page.locator(".workbench-plan li.is-waiting")).toHaveCount(3);
});

test("workbench exposes seeany-style presets, detail note, resolution and a style reference slot", async ({
  page,
}) => {
  await page.goto("/ecommerce-design");
  const workbench = page.locator(".commerce-workbench.is-shoot");
  await expect(workbench).toBeVisible();

  // 可选的风格 / 构图参考图槽位在右侧，商品图未上传前不阻塞
  const styleSlot = workbench.locator(".workbench-slot--style");
  await expect(styleSlot).toContainText("参考图 · 可选");
  await expect(styleSlot).toContainText("风格 / 构图参考");

  // 细节补充：2000 字上限，计数实时
  const note = workbench.getByRole("textbox", { name: "细节补充" });
  await note.fill("暖色木质桌面，右上角留白放标题");
  await expect(workbench.locator(".workbench-note__count")).toContainText("15/2000");

  // 画面预设：seeany 字段（产品类型 / 场景类型 / 产品展示 / 排版呈现 / 氛围营造 / 价值导向）可选可输入
  const presets = await openWorkbenchMenu(page, "画面预设");
  for (const label of ["产品类型", "场景类型", "产品展示", "排版呈现", "氛围营造", "价值导向"]) {
    await expect(presets.getByText(label, { exact: true })).toBeVisible();
  }
  await presets
    .getByRole("group", { name: "产品类型建议" })
    .getByRole("button", { name: "3C 数码" })
    .click();
  await presets.locator("input").nth(2).fill("开箱平铺");
  await expect(
    page.getByRole("button", { name: /^画面预设，当前：已填 2 项/ }),
  ).toBeVisible();
  // 清晰度只列出模型支持的档位（E2E 模型只支持 1K）
  const resolution = presets.getByRole("radiogroup", { name: "选择清晰度" });
  await expect(resolution.getByRole("radio")).toHaveCount(1);
  await expect(resolution.getByRole("radio", { name: /1K/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");

  // 已删除的自造选项不再出现
  await expect(page.getByRole("button", { name: /^画面方案/ })).toHaveCount(0);
});

test("single-image tools offer a variant count instead of fixed packs", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=outpaint");
  const workbench = page.locator(".commerce-workbench.is-outpaint");
  await expect(workbench).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "选择出图任务" })).toHaveCount(0);
  const stepper = workbench.getByRole("group", { name: "出图数量" });
  await expect(stepper).toContainText("1");
  await expect(page.locator(".workbench-plan li")).toHaveCount(1);
  await stepper.getByRole("button", { name: "增加出图数量" }).click();
  await stepper.getByRole("button", { name: "增加出图数量" }).click();
  await expect(page.locator(".workbench-plan li")).toHaveCount(3);
  await expect(page.locator(".workbench-plan")).toContainText("方案 3");
  await expect(page.getByRole("button", { name: /^生成扩图结果（3张）/ })).toHaveCount(1);
  await stepper.getByRole("button", { name: "增加出图数量" }).click();
  await expect(stepper.getByRole("button", { name: "增加出图数量" })).toBeDisabled();
  await expect(page.locator(".workbench-plan li")).toHaveCount(4);
});

test("canvas-first workbench remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ecommerce-design?tool=shoot");

  await expect(page.locator(".commerce-workbench.is-shoot")).toBeVisible();
  await expect(page.locator(".mobile-pane-switch button")).toHaveCount(2);
  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(
    page.getByRole("radiogroup", { name: "拍摄方向" }).getByRole("radio"),
  ).toHaveCount(4);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  const generate = page.getByRole("button", { name: /^生成商拍成片/ });
  await generate.scrollIntoViewIfNeeded();
  await expect(generate).toBeVisible();
});

test("desktop ecommerce workspace reaches the product library and recovers from an empty search", async ({
  page,
}) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto("/ecommerce-design?tool=listing");
  await expect(page.locator(".commerce-studio")).toBeVisible();
  await expect(page.locator(".main-content")).toHaveAttribute(
    "data-route-motion-mode",
    "custom",
  );
  await expect(
    page.locator(".main-content > [data-route-motion-target]"),
  ).toHaveCount(0);
  await expect(page.locator(".commerce-studio")).toHaveAttribute(
    "data-ecommerce-page-motion-state",
    "entered",
  );
  await expect(page.locator(".commerce-studio")).toHaveAttribute(
    "data-ecommerce-content-motion-state",
    "entered",
  );
  await expect(page.locator("[data-commerce-page-motion-target]")).toHaveCount(
    3,
  );
  await expect(page.locator(".commerce-canvas")).toHaveCSS("opacity", "1");
  await expect(page.locator(".commerce-canvas")).toHaveCSS("transform", "none");
  await expect(page.locator(".commerce-workspace-title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新建任务" })).toHaveCount(0);
  await expect(page.locator(".commerce-workbench.is-listing")).toBeVisible();

  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "商品库" })
    .click();
  await expect(page.locator(".commerce-products h2")).toHaveText("商品库");

  const search = page.getByRole("searchbox", { name: "搜索商品库" });
  await search.fill("不存在的商品");
  await expect(page.getByText("没有匹配的商品", { exact: true })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("English ecommerce workspace keeps labels in one locale", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("starclouds-locale", "en"),
  );
  await page.goto("/ecommerce-design?tool=listing");

  await expect(page.locator(".commerce-workbench.is-listing")).toBeVisible();
  await expect(
    page.locator(".commerce-header__actions button").first(),
  ).toHaveText("Creative studio");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "Product library" })
    .click();
  await expect(page.locator(".commerce-products h2")).toHaveText(
    "Product library",
  );

  const search = page.getByRole("searchbox", {
    name: "Search product library",
  });
  await search.fill("missing product");
  await expect(
    page.getByText("No matching products", { exact: true }),
  ).toBeVisible();
});

test("reduced motion keeps the ecommerce canvas immediately visible", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/ecommerce-design?tool=listing");

  const studio = page.locator(".commerce-studio");
  await expect(studio).toHaveAttribute(
    "data-ecommerce-page-motion-state",
    "entered",
  );
  await expect(studio).toHaveAttribute(
    "data-ecommerce-content-motion-state",
    "entered",
  );
  await expect(page.locator(".commerce-canvas")).toHaveCSS("opacity", "1");
  await expect(
    page.locator("[data-commerce-page-motion-target]").first(),
  ).toHaveCSS("transform", "none");
});

test("minimum desktop ecommerce workspace stays usable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/ecommerce-design?tool=listing");

  await expect(page.locator(".commerce-layout")).toBeVisible();
  await expect(page.locator(".commerce-studio")).toHaveAttribute(
    "data-ecommerce-page-motion-state",
    "entered",
  );
  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(page.locator(".commerce-canvas")).toBeVisible();
  await expect(page.locator(".commerce-workbench.is-listing")).toBeVisible();
  await expect(page.locator(".canvas-facts")).toHaveCount(0);
  await expect(page.locator(".listing-plan__list > li")).toHaveCount(7);
  await expect(page.getByRole("button", { name: /从商品库选择/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".commerce-rail button")).toHaveCount(12);
  await expect(page.locator(".commerce-rail__rule")).toHaveCount(2);
  await expect(page.locator(".commerce-rail button").first()).toContainText(
    "虚拟试衣",
  );
  expect(
    await page
      .locator(".commerce-rail a, .commerce-rail button")
      .evaluateAll((tabs) =>
        tabs.every((tab, index) => {
          if (index === 0) return true;
          return (
            tab.getBoundingClientRect().top >=
            tabs[index - 1].getBoundingClientRect().bottom
          );
        }),
      ),
  ).toBe(true);
  await expect(page.locator(".commerce-rail")).toContainText("AI 商拍");
  await expect(page.locator(".commerce-rail")).toContainText("商品阴影");
  await expect(page.locator(".commerce-rail")).toContainText("清晰增强");
  await expect(page.getByText("更多工具", { exact: true })).toHaveCount(0);
  await expect(page.locator(".commerce-rail")).toHaveClass(/is-at-start/);
  const shootTab = page
    .locator(".commerce-rail button")
    .filter({ hasText: "AI 商拍" });
  await shootTab.hover();
  await expect
    .poll(() =>
      shootTab
        .locator(".commerce-rail__icon")
        .evaluate((icon) => Number.parseFloat(getComputedStyle(icon).opacity)),
    )
    .toBeGreaterThan(0.7);
  const hoverStyles = await shootTab.evaluate((tab) => ({
    shadow: getComputedStyle(tab).boxShadow,
    labelWeight: getComputedStyle(tab.querySelector(".commerce-rail__label"))
      .fontWeight,
    iconOpacity: Number.parseFloat(
      getComputedStyle(tab.querySelector(".commerce-rail__icon")).opacity,
    ),
    iconTransform: getComputedStyle(tab.querySelector(".commerce-rail__icon"))
      .transform,
  }));
  expect(hoverStyles.shadow).toBe("none");
  expect(hoverStyles.labelWeight).toBe("800");
  expect(hoverStyles.iconOpacity).toBeGreaterThan(0.7);
  expect(hoverStyles.iconOpacity).toBeLessThanOrEqual(0.8);
  // 侧栏 hover 只做颜色 / 透明度反馈，不再位移图标
  expect(hoverStyles.iconTransform).toBe("none");
  await shootTab.click();
  await expect(page).toHaveURL(/tool=shoot/);
  await expect(page.locator(".commerce-studio")).toHaveAttribute(
    "data-ecommerce-content-motion-state",
    "entered",
  );
  expect(
    await page.locator(".commerce-rail__scroll").evaluate((scroll) => {
      const styles = getComputedStyle(scroll);
      return (
        styles.overflowY === "auto" && scroll.scrollHeight > scroll.clientHeight
      );
    }),
  ).toBe(true);
  await page.locator(".commerce-rail__scroll").evaluate((scroll) => {
    scroll.scrollTop = scroll.scrollHeight;
  });
  await expect(page.locator(".commerce-rail")).toHaveClass(/is-at-end/);
  await expect(page.locator(".commerce-workbench.is-shoot")).toBeVisible();
  await expect(page.locator(".handheld-frame")).toBeVisible();
  await expect(page.locator(".mobile-pane-switch")).toBeHidden();

  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fitsViewport).toBe(true);
});

test("ecommerce workspace uses layered atelier surfaces in light and dark", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=campaign");
  await expect(page.locator(".commerce-studio")).toBeVisible();
  await expect(page.locator(".commerce-atmosphere")).toBeVisible();
  await expect(page.locator(".workbench-toolbar")).toBeVisible();

  const surfaceTokens = async () =>
    page.evaluate(() => {
      const studio = document.querySelector(".commerce-studio");
      const styles = getComputedStyle(studio);
      return {
        canvas: styles.getPropertyValue("--commerce-canvas").trim(),
        accent: styles.getPropertyValue("--commerce-accent").trim(),
        settingsRadius: styles
          .getPropertyValue("--commerce-settings-radius")
          .trim(),
        headerRadius: getComputedStyle(
          document.querySelector(".commerce-header"),
        ).borderRadius,
        railRadius: getComputedStyle(document.querySelector(".commerce-rail"))
          .borderRadius,
        canvasRadius: getComputedStyle(
          document.querySelector(".commerce-canvas"),
        ).borderRadius,
        hasAtmosphere: Boolean(document.querySelector(".commerce-atmosphere")),
        hasSettingsAside: Boolean(document.querySelector(".commerce-settings")),
        stepCount: document.querySelectorAll(".workbench-empty__steps li")
          .length,
      };
    });

  expect(await surfaceTokens()).toEqual({
    canvas: "#f3f1f8",
    accent: "#6d5cff",
    settingsRadius: "20px",
    headerRadius: "18px",
    railRadius: "18px",
    canvasRadius: "20px",
    hasAtmosphere: true,
    hasSettingsAside: false,
    stepCount: 3,
  });
  await page.evaluate(() =>
    document.documentElement.classList.add("color-scheme-dark"),
  );
  expect(await surfaceTokens()).toMatchObject({
    canvas: "#0c0a12",
    accent: "#8b7bff",
    settingsRadius: "20px",
    hasAtmosphere: true,
    stepCount: 3,
  });
});

test("desktop ecommerce layout stays aligned across common workspaces", async ({
  page,
}) => {
  for (const viewport of [
    { width: 1920, height: 1080, name: "1920" },
    { width: 1440, height: 900, name: "1440" },
    { width: 1024, height: 768, name: "1024" },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await page.goto("/ecommerce-design?tool=campaign");
    await expect(page.locator(".commerce-settings")).toHaveCount(0);
    await expect(page.locator(".commerce-rail")).toBeVisible();
    await expect(page.locator(".commerce-canvas")).toBeVisible();
    await expect(page.locator(".commerce-workbench.is-campaign")).toBeVisible();
    await expect(page.locator(".commerce-studio")).toHaveAttribute(
      "data-ecommerce-page-motion-state",
      "entered",
    );

    const layout = await page.evaluate(() => {
      const rect = (selector) => {
        const value = document.querySelector(selector)?.getBoundingClientRect();
        return value
          ? {
              left: value.left,
              right: value.right,
              top: value.top,
              bottom: value.bottom,
            }
          : null;
      };
      return {
        rail: rect(".commerce-rail"),
        canvas: rect(".commerce-canvas"),
        workbench: rect(".workbench-output"),
        refs: rect(".workbench-refs"),
        frame: rect(".handheld-frame"),
        plan: rect(".workbench-plan"),
        history: rect(".handheld-history"),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(layout.rail).toBeTruthy();
    expect(layout.canvas).toBeTruthy();
    expect(layout.workbench).toBeTruthy();
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(layout.canvas.left - layout.rail.right).toBeGreaterThanOrEqual(4);
    expect(layout.canvas.left - layout.rail.right).toBeLessThanOrEqual(12);
    expect(layout.workbench.left).toBeGreaterThanOrEqual(layout.canvas.left);
    expect(layout.workbench.right).toBeLessThanOrEqual(layout.canvas.right + 1);
    if (viewport.width >= 1440) {
      // 桌面宽屏：结果画框整幅落在工作台内；画布优先：参考区 → 结果画框 → 出图结构 → 历史，从左到右不重叠
      expect(layout.frame.bottom).toBeLessThanOrEqual(layout.workbench.bottom + 1);
      expect(layout.frame.left).toBeGreaterThanOrEqual(layout.refs.right - 1);
      expect(layout.plan.left).toBeGreaterThanOrEqual(layout.frame.right - 1);
      expect(layout.history.left).toBeGreaterThanOrEqual(layout.plan.right - 1);
    }
    if (viewport.width === 1024) {
      await expect(page.locator(".nav-mobile-toggle")).toBeVisible();
      await expect(page.locator(".main-nav")).toBeHidden();
      await page.locator(".nav-mobile-toggle").click();
      await expect(page.locator(".main-nav")).toBeVisible();
      await page.locator(".nav-mobile-toggle").click();
      await expect(page.locator(".main-nav")).toBeHidden();
    }
  }
});

test("mobile ecommerce workspace keeps settings and canvas readable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ecommerce-design?tool=listing");

  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(page.locator(".commerce-workbench.is-listing")).toBeVisible();
  await expect(page.getByRole("tab", { name: "创作台" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传商品" }).first()).toBeVisible();
  // 自由组合默认 2 张主图 + 5 张详情页，策划方案里逐张可见
  await expect(page.locator(".listing-selected > li")).toHaveCount(7);
  await expect(page.locator(".listing-plan__list > li")).toHaveCount(7);
  const generate = page.getByRole("button", { name: "开始 AI 智能策划并生成" });
  await generate.scrollIntoViewIfNeeded();
  await expect(generate).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await page.getByRole("tab", { name: "历史" }).click();
  await expect(page.locator(".commerce-workbench")).toHaveCount(0);
  await page.getByRole("tab", { name: "创作台" }).click();
  await expect(page.locator(".commerce-workbench.is-listing")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("best-seller recreation supports an optional replacement product", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=clone");

  await expect(page.locator(".commerce-workspace-title")).toHaveCount(0);
  const workbench = page.locator(".commerce-workbench.is-clone");
  await expect(workbench).toBeVisible();
  const reference = workbench.locator(".workbench-slot--left");
  const product = workbench.locator(".workbench-slot--right");
  await expect(reference).toContainText("爆款参考");
  await expect(reference).not.toContainText("可选");
  await expect(product).toContainText("你的商品 · 可选");
  // 商品槽位在参考图上传前保持锁定，引导用户先放爆款参考
  await expect(product).toHaveClass(/is-locked/);
  await expect(product.locator(".handheld-ref-card__hit")).toBeDisabled();
  await expect(product.locator(".handheld-ref-card__actions")).toBeHidden();
  await expect(product).toContainText("先上传");
  await expect(
    page.getByRole("button", { name: /^生成爆款复刻/ }),
  ).toBeDisabled();
  await expect(page.locator(".workbench-empty__steps")).toContainText(
    "上传爆款参考图",
  );

  // 对齐 seeany：爆款复刻不再有自造的“复刻类型 / 复刻程度”，改为细节补充 + 参考图
  await expect(page.getByRole("button", { name: /^复刻方式/ })).toHaveCount(0);
  const note = workbench.getByRole("textbox", { name: "细节补充" });
  await expect(note).toBeVisible();
  await note.fill("保留参考图的斜角构图，换成木质桌面");
  await expect(workbench.locator(".workbench-note__count")).toContainText("/2000");

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "reference.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(reference).toHaveClass(/has-file/);
  await expect(product).not.toHaveClass(/is-locked/);
  await expect(product.locator(".handheld-ref-card__hit")).toBeEnabled();
  await expect(product.locator(".handheld-ref-card__actions")).toBeVisible();
  await expect(page.getByRole("button", { name: /^生成爆款复刻/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /从素材库选择/ })).toHaveCount(
    0,
  );
});

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("listing studio plans a free combination and lets the seller edit it before generating", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  const plan = page.locator(".listing-studio__plan");
  await expect(studio).toBeVisible();
  // 平台 / 市场 / 语种 / 风格、商品信息都在套图工作台里，顶栏不再重复
  await expect(page.getByRole("button", { name: /^投放设置，当前：/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^商品信息，当前：/ })).toHaveCount(0);
  await expect(studio.getByRole("combobox", { name: "视觉风格" })).toBeVisible();

  // 默认 2 张主图（1:1）+ 5 张详情页（3:4）
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(7);
  await expect(studio.locator(".listing-stage__head")).toContainText("主图 2 张（1:1）");
  await expect(studio.locator(".listing-stage__head")).toContainText("详情页 5 张（3:4）");

  // 调整张数：核心卖点图 ×2 → 8 张；移除规格参数图 → 7 张
  await studio.getByRole("button", { name: "增加 核心卖点图" }).click();
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(8);
  await studio.getByRole("button", { name: "减少 规格参数图" }).click();
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(7);

  // 类型库：46 种推荐类型分 4 组，可加自定义方向
  await studio.getByRole("button", { name: /添加出图类型或自定义/ }).click();
  const library = page.getByRole("dialog", { name: "添加出图类型" });
  await expect(library).toBeVisible();
  for (const group of ["商品主图", "核心转化详情页", "信任背书详情页", "营销素材"]) {
    await expect(library.getByRole("region", { name: group })).toBeVisible();
  }
  const detailGroup = library.getByRole("region", { name: "核心转化详情页" });
  await expect(detailGroup.getByRole("button", { name: /高频问题 FAQ 图/ })).toHaveCount(0);
  await detailGroup.getByRole("button", { name: /^更多/ }).click();
  await detailGroup.getByRole("button", { name: /高频问题 FAQ 图/ }).click();
  await library.getByRole("textbox", { name: "自定义方向标题" }).fill("圣诞礼盒氛围图");
  await library.getByRole("button", { name: "添加", exact: true }).click();
  await expect(library.getByRole("list", { name: "已添加的自定义方向" })).toContainText("圣诞礼盒氛围图");
  await library.getByRole("button", { name: "完成选择" }).click();
  await expect(library).toHaveCount(0);
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(9);
  await expect(plan).toContainText("圣诞礼盒氛围图");

  // 逐步确认：先策划（不出图），策划结果按 id 对齐进方案，可逐张修改或移除
  await studio.getByRole("radio", { name: "逐步确认" }).click();
  let planRequest = null;
  await page.route("**/api/v1/commerce/listing-plans", async (route) => {
    planRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          summary: "以清晨厨房光线串起整套图",
          items: [
            { id: "hero", headline: "一杯，唤醒清晨", subline: "三档温控", direction: "商品居中，晨光斜射" },
            { id: "selling", headline: "6 小时长效保温", subline: "", direction: "局部放大杯盖密封圈" },
            { id: "faq", headline: "常见问题", subline: "", direction: "问答卡片" },
          ],
        },
      }),
    });
  });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: PIXEL_PNG,
  });
  await expect(studio.locator(".listing-tile")).toHaveCount(9);
  await studio.getByRole("textbox", { name: "产品信息" }).fill("保温杯，6 小时保温");
  await studio.getByRole("combobox", { name: "视觉风格" }).fill("高级质感风");
  const launch = studio.getByRole("button", { name: "开始 AI 智能策划" });
  await expect(launch).toBeEnabled();
  await launch.click();
  await expect(plan).toContainText("以清晨厨房光线串起整套图");
  await expect(plan).toContainText("一杯，唤醒清晨");
  expect(planRequest?.types?.map((item) => item.id)).toEqual([
    "white",
    "scene-hero",
    "hero",
    "selling",
    "selling~2",
    "scene",
    "craft",
    "faq",
    expect.stringMatching(/^custom-/),
  ]);
  expect(planRequest?.types?.find((item) => item.id === "white")?.role).toBe("main");
  expect(planRequest?.style).toBe("高级质感风");
  expect(planRequest?.sellingPoints).toBe("保温杯，6 小时保温");
  expect(planRequest?.inputKeys).toEqual(["uploads/e2e-user-1/product.png"]);

  // 修改第 3 张的标题，移除 FAQ，确认按钮随张数更新
  await plan.getByRole("button", { name: "修改第 3 张策划" }).click();
  await plan.getByRole("textbox", { name: "主标题" }).fill("晨光一杯");
  await expect(plan).toContainText("晨光一杯");
  await plan.getByRole("button", { name: "从本套移除第 8 张" }).click();
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(8);
  await expect(studio.getByRole("button", { name: "确认方案，生成 8 张" })).toBeEnabled();
  await plan.getByRole("button", { name: "恢复已移除的 1 张" }).click();
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(9);

  // 清除策划回到未策划状态
  await plan.getByRole("button", { name: "清除" }).click();
  await expect(plan).not.toContainText("一杯，唤醒清晨");
  await expect(studio.getByRole("button", { name: "开始 AI 智能策划" })).toBeVisible();
});

test("listing studio smart grouping lets AI pick types and category templates build a shot list", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  const plan = page.locator(".listing-studio__plan");

  // 智能组图：设定张数，AI 从候选类型里挑选；极速出图不可用
  await studio.getByRole("tab", { name: "智能组图" }).click();
  await expect(studio.getByRole("radio", { name: "极速出图" })).toHaveCount(0);
  await studio.getByRole("button", { name: "增加主图数量" }).click();
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(7);
  let planRequest = null;
  await page.route("**/api/v1/commerce/listing-plans", async (route) => {
    planRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          summary: "极简白调",
          items: [
            { id: "main-1", type: "white", role: "main", headline: "", direction: "纯白正面" },
            { id: "main-2", type: "selling-hero", role: "main", headline: "三档温控" },
            ...[1, 2, 3, 4, 5].map((index) => ({
              id: `detail-${index}`,
              type: ["hero", "painpoint", "scene", "spec", "service"][index - 1],
              role: "detail",
              headline: `详情 ${index}`,
            })),
          ],
        },
      }),
    });
  });
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: PIXEL_PNG,
  });
  await studio.getByRole("radio", { name: "逐步确认" }).click();
  await studio.getByRole("button", { name: "开始 AI 智能策划" }).click();
  await expect(plan).toContainText("卖点主图");
  await expect(plan).toContainText("客户痛点展示");
  expect(planRequest?.smart).toEqual({ mainCount: 2, detailCount: 5 });
  expect(planRequest?.candidates?.length).toBe(46);
  expect(planRequest?.types).toBeUndefined();
  await expect(studio.getByRole("button", { name: "确认方案，生成 7 张" })).toBeEnabled();
  // 改张数会作废旧策划
  await studio.getByRole("button", { name: "减少详情页数量" }).click();
  await expect(plan).not.toContainText("客户痛点展示");

  // 品类模板：从模板库挑选，分镜进入方案
  await studio.getByRole("tab", { name: "品类模板" }).click();
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(0);
  await studio.getByRole("button", { name: /打开模板库挑选/ }).click();
  const templates = page.getByRole("dialog", { name: "选择品类套图模板" });
  await expect(templates).toBeVisible();
  await templates.getByRole("button", { name: /手机数码/ }).click();
  await templates.getByRole("button", { name: "蓝牙耳机", exact: true }).click();
  await templates.getByRole("button", { name: /蓝牙耳机标准套图/ }).click();
  await templates.getByRole("button", { name: "确定选择" }).click();
  await expect(templates).toHaveCount(0);
  await expect(studio.getByRole("list", { name: "已选模板" })).toContainText("蓝牙耳机标准套图");
  await expect(plan.locator(".listing-plan__list > li")).toHaveCount(10);
  await expect(plan).toContainText("接口与细节特写");
});

test("listing studio smart direct output plans then generates each shot at its own ratio", async ({
  page,
}) => {
  const created = [];
  await page.route("**/api/v1/tasks", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = request.postDataJSON();
    created.push(body);
    await fulfill(route, {
      id: `e2e-listing-task-${created.length}`,
      type: "ecommerce_design",
      status: "queued",
      prompt: body.prompt,
      params: body.params,
      count: 1,
      outputUrls: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
  let planCalls = 0;
  await page.route("**/api/v1/commerce/listing-plans", async (route) => {
    planCalls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          summary: "晨光厨房",
          items: [{ id: "hero", headline: "一杯，唤醒清晨", subline: "", direction: "晨光斜射" }],
        },
      }),
    });
  });

  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: PIXEL_PNG,
  });
  await studio.getByRole("combobox", { name: "视觉风格" }).fill("国风古韵风");
  // 智能直出：一次点击 = 策划 + 自动出图（仍走费用确认）
  await studio.getByRole("button", { name: "开始 AI 智能策划并生成" }).click();
  const dialog = page.getByRole("dialog", { name: "确认生成费用" });
  await expect(dialog).toBeVisible();
  expect(planCalls).toBe(1);
  await page.locator(".ai-cost-confirm-btn.primary").click();

  await expect.poll(() => created.length).toBe(7);
  const byIndex = [...created].sort((a, b) => a.params.batchIndex - b.params.batchIndex);
  expect(byIndex.map((item) => item.params.aspectRatio)).toEqual([
    "1:1",
    "1:1",
    "3:4",
    "3:4",
    "3:4",
    "3:4",
    "3:4",
  ]);
  expect(byIndex.map((item) => item.params.viewId)).toEqual([
    "white",
    "scene-hero",
    "hero",
    "selling",
    "scene",
    "craft",
    "spec",
  ]);
  expect(byIndex[2].prompt).toContain("画面标题文案：「一杯，唤醒清晨」");
  expect(byIndex[0].prompt).not.toContain("画面标题文案");
  expect(byIndex.every((item) => item.prompt.includes("整套视觉风格：国风古韵"))).toBe(true);
  expect(byIndex.every((item) => item.prompt.includes("整套图视觉主线：晨光厨房"))).toBe(true);
});

test("listing studio fast mode skips planning", async ({ page }) => {
  let planCalls = 0;
  await page.route("**/api/v1/commerce/listing-plans", async (route) => {
    planCalls += 1;
    await route.abort();
  });
  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: PIXEL_PNG,
  });
  await studio.getByRole("radio", { name: "极速出图" }).click();
  await studio.getByRole("button", { name: "开始生成 7 张套图" }).click();
  await expect(page.getByRole("dialog", { name: "确认生成费用" })).toBeVisible();
  expect(planCalls).toBe(0);
});

test("listing studio AI write fills product info after confirmation", async ({
  page,
}) => {
  let briefRequest = null;
  await page.route("**/api/v1/commerce/product-briefs", async (route) => {
    briefRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          productName: "不锈钢保温杯",
          sellingPoints:
            "产品名称：不锈钢保温杯\n核心卖点：\n6 小时保温\n适用人群：通勤上班族\n期望场景：办公室、户外\n具体参数：容量 500ml",
        },
      }),
    });
  });
  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  const aiWrite = studio.getByRole("button", { name: "AI 帮写" });
  await expect(aiWrite).toBeDisabled();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: PIXEL_PNG,
  });
  await studio.getByRole("textbox", { name: "产品信息" }).fill("容量 500ml");
  await expect(aiWrite).toBeEnabled();
  await aiWrite.click();
  const dialog = page.getByRole("dialog", { name: "生成商品名称和卖点" });
  await expect(dialog.getByRole("textbox", { name: "产品信息" })).toHaveValue(/适用人群：通勤上班族/);
  expect(briefRequest?.detailed).toBe(true);
  expect(briefRequest?.currentInfo).toContain("容量 500ml");
  await dialog.getByRole("button", { name: "确认填入" }).click();
  await expect(studio.getByRole("textbox", { name: "商品名称" })).toHaveValue("不锈钢保温杯");
  await expect(studio.getByRole("textbox", { name: "产品信息" })).toHaveValue(/期望场景：办公室、户外/);
});

test("AI product brief waits for confirmation and supports regeneration", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=campaign");
  const productMenu = await openWorkbenchMenu(page, "商品信息");
  const brief = productMenu.getByRole("button", { name: "AI 帮写卖点" });
  await expect(brief).toBeDisabled();

  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.locator(".workbench-refs .handheld-ref-card.has-file")).toHaveCount(1);
  await expect(brief).toBeEnabled();

  await brief.click();
  const dialog = page.getByRole("dialog", { name: "生成商品名称和卖点" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "商品名称" })).toHaveValue(
    "第一版商品名称",
  );
  await expect(productMenu.getByLabel("商品名称")).toHaveValue("");

  await dialog.getByRole("button", { name: "重新生成" }).click();
  await expect(dialog.getByRole("textbox", { name: "商品名称" })).toHaveValue(
    "第二版商品名称",
  );
  await dialog.getByRole("button", { name: "确认填入" }).click();

  await expect(productMenu.getByLabel("商品名称")).toHaveValue(
    "第二版商品名称",
  );
  await expect(productMenu.getByLabel("核心卖点与要求")).toHaveValue(
    "第二版卖点一\n第二版卖点二",
  );
  await expect(
    page.getByRole("button", { name: "商品信息，当前：已填写" }),
  ).toBeVisible();
});

test("fashion try-on separates garment, model, and scene choices", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=tryon");

  await expect(page.getByRole("heading", { name: "衣服" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "模特" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "拍摄场景" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "上身效果" })).toHaveCount(0);
  await expect(page.getByLabel("选择衣服类型")).toBeVisible();
  await expect(page.getByLabel("选择衣服类型")).toContainText("上装");
  await page.getByLabel("选择衣服类型").click();
  await expect(
    page.getByRole("option", { name: "上装", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "下装", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "全身", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tryon-upload-slot")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传服装" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传模特" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传场景" })).toBeVisible();
  await expect(page.locator(".tryon-model-tiles")).toHaveCount(0);
  await expect(page.getByLabel("选择模特")).toBeVisible();
  await expect(page.getByRole("button", { name: "更多模特" })).toBeVisible();
  await expect(page.getByRole("button", { name: "更多模特" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "更多模特" }).click();
  await expect(page.getByRole("dialog", { name: "选择模特" })).toBeVisible();
  await expect(page.getByRole("button", { name: "更多模特" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await page
    .getByRole("dialog", { name: "选择模特" })
    .getByRole("button", { name: "关闭" })
    .click();
  await expect(page.getByRole("dialog", { name: "选择模特" })).toHaveCount(0);
  await page.getByRole("button", { name: "更多模特" }).click();
  await expect(page.getByRole("dialog", { name: "选择模特" })).toBeVisible();
  await expect(page.locator(".tryon-model-popup")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "东亚女性", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "欧美男性", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "选择模特" })).toHaveCount(0);
  await expect(page.locator(".tryon-stage__model")).toHaveAttribute(
    "data-model",
    "欧美男性",
  );
  await expect(page.getByLabel("选择目标市场")).toHaveCount(0);
  await expect(page.getByLabel("选择视觉风格")).toHaveCount(0);
  await expect(page.getByLabel("选择画面比例")).toBeVisible();
  // 试衣比例按电商平台常用规格排序，默认 3:4（亚马逊、天猫、小红书主图）
  await expect(page.getByLabel("选择画面比例")).toContainText("3:4");
  await page.getByLabel("选择画面比例").click();
  await expect(page.getByRole("option")).toHaveText([
    /^3:4.*亚马逊/,
    /^1:1.*TikTok/,
    /^4:5/,
    /^9:16/,
    // 2:3 不在当前模型的后台画幅配置里，不展示
    /^16:9/,
  ]);
  await page.keyboard.press("Escape");
  await expect(page.getByText("补充要求")).toHaveCount(0);
  await expect(page.getByLabel("选择拍摄场景")).toBeVisible();
  await expect(page.getByRole("button", { name: "更多场景" })).toBeVisible();
  await expect(
    page.locator(".choice-chip-grid button", { hasText: "纯色棚拍" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("选择模特人群")).toHaveCount(0);
  await expect(page.getByLabel("选择模特姿态")).toHaveCount(0);
  await expect(page.getByLabel("选择生成张数")).toHaveCount(0);
  // 镜头改为由每个机位自带，顶栏不再提供全局镜头选择
  await expect(page.getByLabel("选择摄影镜头")).toHaveCount(0);
  await expect(page.getByLabel("选择光影调整")).toBeVisible();
  await page.getByLabel("选择光影调整").click();
  await expect(page.getByRole("option", { name: /^补光塑形/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^现场光/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /^轮廓分离/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "正面站姿" })).toHaveCount(0);
  await expect(page.locator(".commerce-header__brand")).toHaveCount(0);
  await expect(page.locator(".commerce-header__model")).toBeVisible();
  await expect(page.getByLabel("选择生成模型")).toBeVisible();
  await expect(page.locator(".generate-button")).toContainText("1张");
  await expect(page.locator(".generate-bar")).toHaveCount(0);
  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /一键生成AI 虚拟试衣/ }),
  ).toHaveCount(0);
  await expect(page.locator(".tryon-stage")).toBeVisible();
  await expect(page.locator(".tryon-compose")).toBeVisible();
  await expect(page.locator(".tryon-compose__link")).toHaveCount(3);
  await expect(page.locator(".tryon-compose__arrow")).toHaveCount(0);
  // 没有历史时历史栏收起，把宽度让给结果区
  await expect(page.locator(".tryon-stage")).toHaveClass(/is-history-empty/);
  await expect(page.getByLabel("生成历史")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "补充说明当前结果" }),
  ).toHaveCount(0);
  await expect(page.locator(".tryon-stage__frame")).toHaveAttribute(
    "data-scene",
    "纯色棚拍",
  );
  await expect(page.locator(".tryon-stage__result")).toHaveAttribute(
    "data-ratio",
    "3:4",
  );
  await expect(page.getByRole("button", { name: /一键生成/ })).toBeVisible();
  await expect(page.locator(".tryon-generate")).toContainText("生成");
  await expect(page.locator(".tryon-stage__model")).toBeVisible();
  await expect(page.locator(".tryon-stage__garment")).toBeVisible();
  await expect(page.locator(".tryon-stage__garment")).toHaveAttribute(
    "data-apparel",
    "上装",
  );
  await expect(page.locator(".tryon-stage__scene-card")).toBeVisible();
  await expect(page.locator(".tryon-stage__scene-photo")).toBeVisible();
  await page.getByRole("button", { name: "查看模特大图" }).click();
  const preview = page.getByRole("dialog", { name: /全屏预览/ });
  await expect(preview).toBeVisible();
  const previewImage = preview.locator("img");
  await expect(previewImage).toBeVisible();
  await expect
    .poll(async () =>
      previewImage.evaluate((image) => {
        const box = image.getBoundingClientRect();
        const maxWidth = Math.max(120, window.innerWidth - 48);
        const maxHeight = Math.max(120, window.innerHeight - 48);
        const scale = Math.min(
          1,
          maxWidth / image.naturalWidth,
          maxHeight / image.naturalHeight,
        );
        const expectedWidth = Math.round(image.naturalWidth * scale);
        return (
          image.naturalWidth > 0 &&
          Math.abs(box.width - expectedWidth) <= 2 &&
          box.width < window.innerWidth - 20
        );
      }),
    )
    .toBe(true);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.getByRole("dialog", { name: /全屏预览/ })).toHaveCount(0);
  await page.getByRole("button", { name: "更多场景" }).click();
  await expect(
    page.getByRole("dialog", { name: "选择拍摄场景" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "都市街头", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "选择拍摄场景" })).toHaveCount(
    0,
  );
  await expect(page.locator(".tryon-stage__frame")).toHaveAttribute(
    "data-scene",
    "都市街头",
  );
  const inputBox = page.locator(".tryon-stage__frame");
  const inputBefore = await inputBox.boundingBox();
  await page.getByLabel("选择画面比例").click();
  await page.getByRole("option", { name: /^16:9/ }).click();
  await expect(page.locator(".tryon-stage__result")).toHaveAttribute(
    "data-ratio",
    "16:9",
  );
  const inputAfterWide = await inputBox.boundingBox();
  expect(
    Math.abs((inputAfterWide?.width || 0) - (inputBefore?.width || 0)),
  ).toBeLessThan(2);
  expect(
    Math.abs((inputAfterWide?.height || 0) - (inputBefore?.height || 0)),
  ).toBeLessThan(2);
  await page.getByLabel("选择画面比例").click();
  await page.getByRole("option", { name: /^3:4/ }).click();
  await expect(page.locator(".tryon-stage__result")).toHaveAttribute(
    "data-ratio",
    "3:4",
  );
  await expect(page.locator(".showcase-demo")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /从素材库选择/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "选择服装图片" }),
  ).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "garment.jpg",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAP/2Q==",
        "base64",
      ),
    });
  await expect(page.locator(".tryon-stage__garment.is-empty")).toHaveCount(0);
  await expect(page.locator(".tryon-stage__garment img")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看服装大图" }),
  ).toBeVisible();
  await expect(page.locator(".tryon-stage__notice")).toHaveCount(0);
});

// 侧栏每个模块是独立会话（按模块重新挂载），但页面外壳保持连续：
// 切换时不重播入场动画，页头和侧栏立即可见
test("commerce sidebar switches businesses without replaying the page shell entrance", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=tryon");
  const studio = page.locator(".commerce-studio");
  await expect(studio).toHaveAttribute("data-ecommerce-page-motion-state", "entered");

  await page.getByRole("button", { name: "手持商品图" }).click();
  await expect(page).toHaveURL(/tool=handheld/);
  await expect(studio).toHaveAttribute("data-ecommerce-business", "handheld");
  await expect(studio).toHaveAttribute("data-ecommerce-page-motion-state", "entered");
  await expect(page.locator(".commerce-rail")).toHaveCSS("opacity", "1");
  await expect(page.locator(".commerce-header")).toHaveCSS("opacity", "1");
  await expect(page.getByLabel("选择生成模型")).toBeVisible();
});

test("try-on generation timer resumes from the server start time", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=tryon&seedResult=runningTryon");

  const timer = page.locator(".tryon-generating__time strong");
  await expect(timer).toBeVisible();
  const before = Number(await timer.textContent());
  expect(before).toBeGreaterThanOrEqual(10);

  await page.getByRole("button", { name: "手持商品图" }).click();
  await expect(page).toHaveURL(/tool=handheld/);
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "AI 虚拟试衣" }).click();
  await expect(page).toHaveURL(/tool=tryon/);
  await expect(timer).toBeVisible();
  await expect
    .poll(async () => Number(await timer.textContent()))
    .toBeGreaterThan(before);
});

test("fashion try-on stays empty when the catalog is unavailable", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=tryon&emptyCatalog=1");

  await expect(page.locator(".tryon-stage__model.is-empty")).toBeVisible();
  await expect(page.locator(".tryon-stage__scene-card.is-empty")).toBeVisible();
  await expect(page.locator(".tryon-stage__garment.is-empty")).toBeVisible();
  await expect(page.locator(".tryon-stage__frame")).toHaveAttribute(
    "data-scene",
    "",
  );
  await expect(page.getByRole("button", { name: "更多模特" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "更多场景" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "东亚女性" })).toHaveCount(0);
  await expect(page.getByText("选择模特", { exact: true })).toBeVisible();
  await expect(page.getByText("选择场景", { exact: true })).toBeVisible();
});

test("handheld product uses a setup board instead of the try-on stage", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=handheld");

  await expect(page.locator(".tryon-stage")).toHaveCount(0);
  await expect(page.locator(".tryon-compose")).toHaveCount(0);
  await expect(page.locator(".commerce-header__tryon")).toHaveCount(0);
  await expect(page.locator(".commerce-header__brand")).toHaveCount(0);
  await expect(page.getByLabel("选择生成模型")).toBeVisible();
  await expect(page.locator(".commerce-header__platform")).toHaveCount(0);
  await expect(page.getByLabel("选择投放渠道")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-platform")).toBeVisible();
  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(page.locator(".showcase-demo")).toHaveCount(0);
  await expect(page.locator(".handheld-plinth")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "衣服" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "试衣" })).toHaveCount(0);
  await expect(page.getByLabel("选择衣服类型")).toHaveCount(0);
  await expect(page.getByLabel("选择摄影镜头")).toHaveCount(0);
  await expect(page.getByLabel("选择模特", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("选择拍摄场景")).toHaveCount(0);
  await expect(page.getByLabel("选择光影调整")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "更多模特", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "更多场景", exact: true }),
  ).toHaveCount(0);

  await expect(page.getByLabel("手持商品工作台")).toBeVisible();
  await expect(page.locator(".handheld-product .handheld-ref-card__tag")).toContainText("商品图");
  // 商品下方可补同一件商品的其他角度，没传正面前不可用
  await expect(page.getByRole("button", { name: "上传商品侧面" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "上传商品背面" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传商品Logo" })).toBeVisible();
  // 品类与实物尺寸角标在上传商品后才出现
  await expect(
    page.getByRole("button", { name: "填写品类与实物尺寸" }),
  ).toHaveCount(0);
  await expect(page.locator(".handheld-out .handheld-product")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-product")).toHaveCount(0);
  await expect(page.locator(".handheld-out .handheld-scene")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-scene")).toHaveCount(0);
  await expect(page.getByLabel("选择出图任务")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-brief")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-pack")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-pack")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "出镜范围" })).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-hand")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-hand")).toHaveCount(0);
  await expect(page.getByText("握持姿势", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "更多商品图" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "清空商品图" })).toHaveCount(0);
  await expect(
    page.locator(".handheld-product").getByRole("button", { name: "上传商品图" }),
  ).toBeVisible();
  // 必填/选填写在卡片上，选填卡片写明不传会怎样
  await expect(page.locator(".handheld-product .handheld-ref-card__tag")).toContainText("必填");
  await expect(page.locator(".handheld-scene .handheld-ref-card__tag")).toContainText("选填");
  await expect(page.locator(".handheld-scene")).toContainText("自动：浅灰白棚拍背景");
  await expect(page.locator(".handheld-hand")).toContainText("自动：AI 生成手");
  // 生成按钮直接告诉用户还差哪一步
  await expect(page.locator(".handheld-submit")).toHaveAccessibleName("上传商品图");
  await expect(page.locator(".handheld-submit")).toContainText("完成后即可生成");
  await expect(page.getByLabel("选择画面文案语言")).toHaveCount(0);
  // 没有结果时画布先告诉用户这次会出什么
  await expect(page.getByText("还没有结果")).toBeVisible();
  await expect(page.getByText("本次会生成 1 张")).toBeVisible();
  await expect(page.locator(".handheld-plan__shots li")).toHaveText(["01手持主图"]);

  await expect(
    page.getByRole("button", { name: "使用说明", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "打开手持商品操作说明" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "使用说明", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "手持商品操作说明" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "最快四步" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "操作说明目录" })
    .getByRole("button", { name: "出图任务" })
    .click();
  await expect(
    page.getByRole("heading", { name: "出图任务怎么选" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭操作说明" }).click();
  await expect(
    page.getByRole("dialog", { name: "手持商品操作说明" }),
  ).toHaveCount(0);

  await expect(
    page.getByRole("button", { name: "高级", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("选择画面方案")).toBeHidden();
  await expect(page.getByLabel("选择景深与距离")).toBeHidden();
  await page.getByRole("button", { name: "高级", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "高级选项" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择画面方案")).toBeVisible();
  await expect(page.getByRole("radio", { name: /商品主图/ })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: /生活种草/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /功能展示/ })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: /材质特写 突出工艺/ }),
  ).toBeVisible();
  await expect(page.getByLabel("选择视觉风格")).toBeVisible();
  // 焦段、景深等摄影参数默认收在「更多参数」里
  await expect(page.getByLabel("选择景深与距离")).toHaveCount(0);
  await page.getByRole("button", { name: /更多参数/ }).click();
  await expect(page.getByLabel("选择景深与距离")).toBeVisible();
  await expect(page.getByLabel("选择镜头")).toBeVisible();
  await expect(page.getByLabel("选择机位")).toBeVisible();
  await expect(page.getByLabel("选择光影")).toBeVisible();
  await expect(page.getByLabel("选择视觉焦点")).toBeVisible();
  // 「生成方式」只是一句提示词，不再作为选项
  await expect(page.getByLabel("选择生成方式")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "高级选项" })).toHaveCount(
    0,
  );

  await expect(page.getByLabel("选择出图任务")).toBeVisible();
  await expect(page.getByRole("radio", { name: /单张主图/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /详情套图/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /社媒投放包/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /开箱套图/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /主图对比/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /同姿势换色/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /复刻构图/ })).toHaveCount(0);
  await expect(page.locator(".handheld-pack-summary")).toHaveCount(0);

  const cropSwitch = page.getByRole("radiogroup", { name: "出镜范围" });
  await expect(cropSwitch).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-crop")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-crop")).toHaveCount(0);
  await expect(
    cropSwitch.getByRole("radio", { name: "手腕", exact: true }),
  ).toBeChecked();
  for (const name of ["手指", "手腕", "禁脸", "半身", "全身"]) {
    await expect(cropSwitch.getByRole("radio", { name, exact: true })).toBeVisible();
  }

  await expect(page.locator(".handheld-out .handheld-hand")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-model")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传手指图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传模特模板" })).toHaveCount(
    0,
  );
  await cropSwitch.getByRole("radio", { name: "半身", exact: true }).click();
  await expect(
    cropSwitch.getByRole("radio", { name: "半身", exact: true }),
  ).toBeChecked();
  await expect(page.locator(".handheld-out .handheld-model")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-hand")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "上传模特模板" }),
  ).toBeVisible();
  await cropSwitch.getByRole("radio", { name: "手腕", exact: true }).click();
  await expect(
    cropSwitch.getByRole("radio", { name: "手腕", exact: true }),
  ).toBeChecked();
  await expect(page.locator(".handheld-out .handheld-hand")).toBeVisible();
  await expect(page.getByRole("button", { name: "上传手指图" })).toBeVisible();

  await expect(
    page.getByRole("button", { name: "握持姿势", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("选择握持姿势")).toBeHidden();
  await page.getByRole("button", { name: "握持姿势", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "握持姿势选项" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择握持姿势")).toBeVisible();
  await expect(page.getByLabel("选择握持姿势")).toContainText("自然握持");
  await expect(page.getByRole("radio", { name: "自然握持" })).not.toBeChecked();
  await expect(page.getByLabel("选择左右手")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "握持姿势选项" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "商品信息", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("选择商品品类")).toBeHidden();
  await expect(page.getByLabel("商品名")).toBeHidden();
  await page.getByRole("button", { name: "商品信息", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "商品信息选项" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择商品品类")).toBeVisible();
  await expect(page.getByLabel("选择包装状态")).toBeVisible();
  await expect(page.getByLabel("商品名")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "商品信息选项" })).toHaveCount(
    0,
  );

  await expect(page.getByRole("button", { name: "上传模特模板" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "上传手指图" })).toBeVisible();
  await expect(
    page.getByRole("option", { name: "欧美男性", exact: true }),
  ).toHaveCount(0);

  await expect(page.getByLabel("选择画面比例")).toHaveCount(0);
  await expect(page.getByLabel("选择目标市场")).toHaveCount(0);
  await expect(page.getByLabel("选择模特人群")).toHaveCount(0);
  await expect(page.getByLabel("选择模特姿态")).toHaveCount(0);
  await expect(page.getByLabel("选择生成张数")).toHaveCount(0);
  await expect(page.getByText("补充要求")).toHaveCount(0);

  await page.getByRole("button", { name: "高级", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "高级选项" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择视觉风格")).toBeVisible();
  await expect(
    page.getByRole("radio", { name: "电商主图风" }),
  ).not.toBeChecked();
  await expect(page.getByRole("radio", { name: "自然纪实" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "高级感" })).toBeVisible();
  await expect(page.getByRole("radio", { name: "种草风" })).toBeVisible();
  await page.getByRole("radio", { name: /生活种草/ }).click();
  await expect(page.getByRole("radio", { name: "环境中景" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "使用动作" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "现场光" })).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "高级选项" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("选择场景", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "更多手持场景" }).click();
  await expect(page.getByRole("dialog", { name: "选择场景" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "都市街头", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("dialog", { name: "选择场景" })
    .getByRole("button", { name: "关闭" })
    .click();
  await expect(page.getByRole("dialog", { name: "选择场景" })).toHaveCount(0);
  await expect(page.getByLabel("选择生成模型")).toBeVisible();
  await expect(page.getByLabel("选择投放渠道")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "商品信息", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("选择商品品类")).toBeHidden();
  await expect(page.getByRole("button", { name: "上传参考模特" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "上传手指图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传场景" })).toBeVisible();
  await expect(page.locator(".handheld-submit--dock")).toHaveCount(0);
  await expect(page.locator(".handheld-frame .handheld-submit")).toBeVisible();
  await expect(page.locator(".handheld-submit")).toHaveCount(1);
  await expect(page.getByText("本次会生成 1 张")).toBeVisible();
  await expect(page.locator(".handheld-shots")).toHaveAttribute(
    "data-count",
    "1",
  );
  await expect(page.locator(".handheld-frame")).toHaveCount(1);
  await expect(page.locator(".handheld-frame__thumbs")).toHaveCount(0);
  await page
    .getByLabel("选择出图任务")
    .getByRole("radio", { name: /详情套图/ })
    .click();
  await expect(page.locator(".handheld-submit")).toHaveCount(1);
  await expect(page.getByText("本次会生成 4 张")).toBeVisible();
  await expect(page.locator(".handheld-shots")).toHaveAttribute(
    "data-count",
    "1",
  );
  await expect(page.locator(".handheld-frame")).toHaveCount(1);
  await expect(page.getByLabel("本次套图")).toBeVisible();
  await expect(page.locator(".handheld-frame__thumb")).toHaveCount(4);
  await expect(page.locator(".handheld-pack-summary")).toHaveCount(0);
  // 只有正面图时，套图里转角度的几张提醒补图
  await expect(page.locator(".handheld-conflicts")).toContainText("只有正面图");
  await expect(page.locator(".handheld-plan__shots li")).toHaveCount(4);
  await page
    .getByLabel("选择出图任务")
    .getByRole("radio", { name: /单张主图/ })
    .click();
  await expect(page.locator(".handheld-submit")).toHaveCount(1);
  await expect(page.getByText("本次会生成 1 张")).toBeVisible();
  await expect(page.locator(".handheld-shots")).toHaveAttribute(
    "data-count",
    "1",
  );
  await expect(page.locator(".handheld-frame")).toHaveCount(1);
  await expect(page.locator(".handheld-frame__thumbs")).toHaveCount(0);
  // 构图参考是进阶选项：收在商品下方的补图栏里，不再占一整张卡片
  await expect(page.locator(".handheld-layout")).toHaveCount(0);
  await expect(
    page.locator(".handheld-angles").getByRole("button", { name: "上传构图参考" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "清空构图参考" })).toHaveCount(0);
  await expect(page.getByLabel("手持生成历史")).toBeVisible();
  await expect(page.locator(".handheld-history__empty")).toContainText(
    "暂无记录",
  );
  await expect(page.locator(".handheld-frame")).toHaveAttribute(
    "data-ratio",
    "4:5",
  );

  await expect(
    page.getByRole("button", { name: "选择商品图片" }),
  ).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "product.jpg",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAP/2Q==",
        "base64",
      ),
    });
  await expect(page.locator(".handheld-product.has-file")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "填写品类与实物尺寸" }),
  ).toBeVisible();
  // 商品到位后，按钮回到「生成」
  await expect(page.locator(".handheld-submit")).toHaveAccessibleName(/生成手持商品图/);
  await expect(
    page.getByRole("button", { name: "查看商品大图" }),
  ).toBeVisible();
  await expect(page.locator(".handheld-pane__notice")).toHaveCount(0);

  // 补一张侧面：同一件商品的其他角度，可查看、可移除
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传商品侧面" }).click();
  await (await chooser).setFiles({
    name: "side.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAP/2Q==",
      "base64",
    ),
  });
  await expect(page.getByRole("button", { name: "查看商品侧面" })).toBeVisible();
  await page.getByRole("button", { name: "移除商品侧面" }).click();
  await expect(page.getByRole("button", { name: "上传商品侧面" })).toBeVisible();
});

test("handheld result: 只改这张 redraws one shot with one change", async ({
  page,
}) => {
  const jobBodies = [];
  const quoteBodies = [];
  await page.route("**/api/v1/commerce/handheld/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path.endsWith("/handheld/product-classifications")) {
      await fulfill(route, {
        category: "cup",
        label: "白色马克杯",
        sizeMm: { length: 80, width: 80, height: 95 },
      });
      return;
    }
    if (path.endsWith("/handheld/quotes")) {
      quoteBodies.push(request.postDataJSON());
      await fulfill(route, { unitPriceCents: 3, itemCount: 1, authoritative: true });
      return;
    }
    if (path.endsWith("/handheld/projects") && request.method() === "POST") {
      await fulfill(route, { id: "e2e-handheld-project" });
      return;
    }
    if (path.endsWith("/handheld/jobs") && request.method() === "POST") {
      const body = request.postDataJSON();
      jobBodies.push(body);
      const imageUrl = "/api/v1/files/mock-product.png?handheld=regen";
      await fulfill(route, {
        id: "e2e-handheld-regen",
        status: "completed",
        items: [
          {
            task: {
              id: "e2e-handheld-regen-task",
              type: "ecommerce_design",
              status: "succeeded",
              prompt: body.spec.shots[0].prompt,
              params: {
                _kind: "ui-design-ecommerce-handheld-generation",
                aspectRatio: "1:1",
                batchId: "e2e-handheld-regen",
                batchIndex: 0,
                batchSize: 1,
                batchCreatedAt: "2026-01-01T00:05:00.000Z",
                handheldSpec: body.spec,
              },
              count: 1,
              originalUrls: [imageUrl],
              outputUrls: [imageUrl],
              createdAt: "2026-01-01T00:05:00.000Z",
              finishedAt: "2026-01-01T00:06:00.000Z",
            },
          },
        ],
      });
      return;
    }
    await fulfill(route, {});
  });
  await page.goto("/ecommerce-design?tool=handheld&seedResult=handheld");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "product.jpg",
      mimeType: "image/jpeg",
      buffer: Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAP/2Q==",
        "base64",
      ),
    });
  await expect(page.locator(".handheld-product.has-file")).toBeVisible();
  // 上传后自动识别品类与尺寸，握法跟着品类走
  await expect(
    page.getByRole("button", { name: "实物尺寸 80×80×95mm，点击修改" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "握持姿势" })).toContainText("就口");
  await page
    .getByLabel("手持生成历史")
    .locator("button")
    .first()
    .click();
  await expect(page.getByLabel("本次套图")).toBeVisible();
  await page
    .getByLabel("本次套图")
    .getByRole("listitem", { name: "使用瞬间" })
    .click();

  const tweak = page.getByRole("button", { name: "只改这张" });
  await expect(tweak).toBeEnabled();
  await tweak.click();
  const menu = page.getByRole("dialog", { name: "只改「使用瞬间」" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("button", { name: /设置不变，再来一张/ })).toBeVisible();
  await expect(menu.getByRole("group", { name: "换握法" })).toBeVisible();
  // 口红默认两指捏，菜单里标出当前握法
  await expect(
    menu.getByRole("button", { name: "两指捏", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(menu.getByRole("button", { name: "都市街头" })).toBeVisible();

  await menu.getByRole("button", { name: "三指捏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "确认生成费用" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ai-cost-confirm-total")).toContainText("× 1 张");
  await page.locator(".ai-cost-confirm-btn.primary").click();

  await expect.poll(() => jobBodies.length).toBe(1);
  expect(quoteBodies.at(-1).itemCount).toBe(1);
  const spec = jobBodies[0].spec;
  expect(spec.pack).toBe("listing");
  expect(spec.pose).toBe("pinch");
  expect(spec.shots.map((shot) => shot.id)).toEqual(["use"]);
  expect(spec.shots[0].prompt).toContain("握持姿势：三指捏");
  expect(spec.sizeMm).toEqual({ length: 20, width: 20, height: 80 });
  // 这一批只有重画的那一张：画布显示它本身，不会把它当成整套的第 1 张
  await expect(page.locator(".handheld-frame__label")).toHaveText("使用瞬间");
  await expect(page.getByLabel("本次套图")).toHaveCount(0);

  // 下载默认按投放平台尺寸导出，也可以下原图
  await page.getByRole("button", { name: "下载", exact: true }).click();
  const downloadMenu = page.getByRole("menu", { name: "下载" });
  await expect(downloadMenu.getByRole("menuitem", { name: /按淘宝尺寸/ })).toBeVisible();
  await expect(downloadMenu.getByRole("menuitem", { name: /原图/ })).toBeVisible();
});

test("accessory mode exposes commercial wearing controls and a four-shot PDP pack", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=accessory");

  await expect(page.getByLabel("饰品商业出图工作台")).toBeVisible();
  await expect(page.locator(".commerce-canvas")).toHaveCSS(
    "border-radius",
    "20px",
  );
  await expect(page.locator(".commerce-canvas")).toHaveCSS(
    "overflow",
    "hidden",
  );
  await expect(page.locator(".accessory-panel")).toHaveCount(0);
  await expect(page.getByLabel("饰品画布输入")).toBeVisible();
  await expect(page.getByLabel("饰品结果操作")).toHaveCount(0);
  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(page.locator(".tryon-stage")).toHaveCount(0);
  await expect(page.locator(".handheld-studio")).toHaveCount(0);
  await expect(page.getByLabel("饰品顶部设置")).toBeVisible();
  await expect(page.locator(".commerce-header__copy")).toHaveCount(0);
  await expect(
    page.getByText("饰品图是唯一商品真值", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByLabel("选择出图任务")).toBeVisible();
  await expect(page.getByRole("radio", { name: /详情页套图/ })).toBeChecked();
  await expect(page.locator(".accessory-studio .handheld-packs em")).toHaveText([
    "1张",
    "4张",
    "4张",
    "3张",
  ]);
  await expect(page.getByLabel("饰品生成历史")).toBeVisible();
  await expect(page.locator(".accessory-studio .handheld-history__empty")).toContainText(
    "暂无记录",
  );
  await expect(page.getByText("身份参考", { exact: true })).toHaveCount(0);
  await expect(page.getByText("商品真值", { exact: true })).toBeVisible();
  await expect(page.getByText("商业画面", { exact: true })).toBeVisible();
  await expect(
    page.locator(".accessory-toolbar__trigger").filter({ hasText: "商品信息" }),
  ).toBeVisible();
  await expect(page.locator(".accessory-panel .accessory-details")).toHaveCount(
    0,
  );
  await expect(page.getByText("生产预检", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "上传饰品参考图" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传模特参考图" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传场景参考图" }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /包袋/ })).toHaveCount(0);
  await expect(page.getByRole("radio", { name: /帽子/ })).toHaveCount(0);

  await expect(page.getByRole("radio", { name: /详情页套图/ })).toBeChecked();
  await expect(page.getByLabel("饰品套图结构")).toHaveCount(0);

  await page
    .locator(".accessory-toolbar__trigger")
    .filter({ hasText: "佩戴品类" })
    .click();
  await page.getByRole("radio", { name: /戒指/ }).click();
  await expect(page.getByRole("radio", { name: /戒指/ })).toBeChecked();
  await page
    .locator(".accessory-toolbar__trigger")
    .filter({ hasText: "商业画面" })
    .click();
  await expect(page.getByRole("radio", { name: "微距特写" })).toBeChecked();
  await page
    .locator(".accessory-toolbar__trigger")
    .filter({ hasText: "商品信息" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "商品信息设置" }),
  ).toBeVisible();
  await page.getByPlaceholder("例如：18K 玫瑰金吊坠").fill("测试戒指");
  await expect(
    page.locator(".accessory-toolbar__trigger").filter({ hasText: "商品信息" }),
  ).toHaveAttribute("title", "商品信息：已填写");

  await expect(page.getByLabel("质检硬门槛")).toHaveCount(0);

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "ring.jpg",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAP/2Q==",
        "base64",
      ),
    });
  await expect(
    page.getByRole("button", { name: "查看饰品参考图" }),
  ).toBeVisible();
  await expect(page.getByText("配置完成，可以生成")).toBeVisible();
  await expect(page.getByText("生产预检", { exact: true })).toHaveCount(0);

  await page.getByRole("radio", { name: /单张佩戴主图/ }).click();
  await expect(page.locator(".accessory-studio .handheld-frame")).toHaveAttribute(
    "data-ratio",
    "4:5",
  );

  await page.waitForTimeout(450);
  await page.reload();
  await expect(page.getByLabel("饰品商业出图工作台")).toBeVisible();
  await page
    .locator(".accessory-toolbar__trigger")
    .filter({ hasText: "佩戴品类" })
    .click();
  await expect(page.getByRole("radio", { name: /戒指/ })).toBeChecked();
  await expect(
    page.getByRole("button", { name: "查看饰品参考图" }),
  ).toBeVisible();
});

test("switching ecommerce tabs starts an isolated business session", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  await studio
    .getByRole("textbox", { name: "商品名称" })
    .fill("只属于商品套图的测试商品");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "listing-only.jpg",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(
        "/9j/4AAQSkZJRgABAQAAAQABAAD/2wAAAAD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAP/2Q==",
        "base64",
      ),
    });
  await expect(studio.locator(".listing-upload .handheld-ref-card.has-file")).toHaveCount(1);

  await page.getByRole("button", { name: /饰品穿戴/ }).click();
  await expect(page).toHaveURL(/tool=accessory/);
  await expect(page.getByLabel("饰品商业出图工作台")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传饰品参考图" }),
  ).toBeVisible();
  await page.getByText("商品信息", { exact: true }).click();
  await expect(page.getByLabel("饰品名称")).toHaveValue("");
  await expect(page.locator(".workbench-refs .handheld-ref-card.has-file")).toHaveCount(0);

  // 回到商品套图：本模块自己的草稿原样恢复（其他模块的内容不会带过来）
  await page.getByRole("button", { name: /商品套图/ }).click();
  await expect(page).toHaveURL(/tool=listing/);
  await expect(studio.getByRole("textbox", { name: "商品名称" })).toHaveValue(
    "只属于商品套图的测试商品",
  );
  await expect(studio.locator(".listing-upload .handheld-ref-card.has-file")).toHaveCount(1);
});

test("all ecommerce side tabs resolve to their own business session", async ({
  page,
}) => {
  const businessIds = [
    "shoot",
    "listing",
    "clone",
    "detail",
    "campaign",
    "background",
    "outpaint",
    "enhance",
    "tryon",
    "handheld",
    "accessory",
    "backdrop",
    "shadow",
  ];

  for (const businessId of businessIds) {
    await page.goto(`/ecommerce-design?tool=${businessId}`);
    await expect(page.locator(".commerce-studio")).toHaveAttribute(
      "data-ecommerce-business",
      businessId,
    );
  }
});

test("accessory results support asset and download actions", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=accessory&seedResult=multi");

  await expect(
    page.getByRole("button", { name: "查看饰品生成结果" }),
  ).toBeVisible();
  await expect(
    page.locator('.accessory-studio .handheld-frame__shot img[alt="饰品生成结果"]'),
  ).toBeVisible();
  await page.getByRole("button", { name: "查看饰品生成结果" }).click();
  await expect(
    page.getByRole("button", { name: "查看饰品生成结果" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".tryon-flip-lightbox")).toBeVisible();
  await expect(page.locator(".ecommerce-fullscreen-preview")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭预览" }).click();
  await expect(page.getByLabel("饰品结果操作")).toBeVisible();
  await expect(page.getByRole("button", { name: "验收" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "驳回" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /存入素材库/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /下载套图/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /交付清单/ })).toHaveCount(0);

  await expect(page.getByText("当前成图质检", { exact: true })).toHaveCount(0);
  await expect(page.getByText("共 4 张", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("本次饰品套图")).toBeVisible();
  await expect(page.locator(".accessory-studio .handheld-frame")).toHaveCSS(
    "border-radius",
    "16px",
  );
  await expect(page.locator(".accessory-studio .handheld-frame__thumb")).toHaveCount(4);
  await expect(page.locator(".accessory-studio .handheld-history__item")).toHaveCount(1);
  await expect(page.locator(".accessory-studio .handheld-history__count")).toHaveText("4");
  if (process.env.CAPTURE_ACCESSORY_GRID === "1") {
    await page.screenshot({
      path: "../../.artifacts/accessory-multi-grid.png",
    });
  }
  await expect(page.getByRole("button", { name: /存入素材库/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /下载套图/ })).toBeEnabled();

  await page.getByRole("listitem", { name: "补充角度" }).click();
  await page
    .locator(".accessory-toolbar__trigger")
    .filter({ hasText: "佩戴品类" })
    .click();
  await expect(page.getByRole("radio", { name: /戒指/ })).toBeChecked();
  await page.getByText("商品信息", { exact: true }).click();
  await expect(
    page.locator('input[placeholder="用于追踪本次成图"]'),
  ).toHaveValue("E2E-RING");
});

test("detail page offers seeany-style directions, custom directions and Amazon-only advanced options", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail");
  // 与其他工作台同一套画布：左参考卡 + 选项卡、中舞台、右策划卡、历史栏
  const workbench = page.locator(".commerce-workbench.is-detail");
  await expect(workbench).toBeVisible();
  await expect(workbench.locator(".workbench-slot--left")).toHaveCount(2);
  await expect(workbench.locator(".handheld-platform")).toBeVisible();
  await expect(workbench.locator(".handheld-pack")).toBeVisible();
  await expect(workbench.locator(".detail-frame")).toBeVisible();
  await expect(workbench.locator(".handheld-history")).toBeVisible();
  await expect(page.locator(".detail-frame__demo")).toHaveAttribute(
    "src",
    /detail-preview/,
  );

  // 出图方向：芯片 + “更多”弹层里列出全部 16 个内置方向
  const picker = workbench.locator(".workbench-types");
  await expect(picker.locator(".handheld-brief__meta")).toHaveText("已选 5/16");
  await picker.getByRole("button", { name: /^更多/ }).click();
  const popover = page.getByRole("dialog", { name: "更多出图方向" });
  const grid = popover.locator(".workbench-types__grid");
  await expect(grid.getByRole("checkbox")).toHaveCount(16);
  await expect(grid.getByRole("checkbox", { name: /品牌理念图/ })).toBeVisible();
  await expect(grid.getByRole("checkbox", { name: /售后与发货图/ })).toBeVisible();
  await expect(grid.getByRole("checkbox", { name: /权威认证图/ })).toBeVisible();
  await expect(grid.locator('[aria-checked="true"]')).toHaveCount(5);

  // 自定义方向：回车添加，默认勾选，可删除；最多 4 个
  const custom = popover.getByRole("textbox", { name: "自定义出图方向" });
  await custom.fill("特定圣诞礼盒展示图");
  await custom.press("Enter");
  await expect(grid.locator("button.is-custom")).toHaveCount(1);
  await expect(grid.locator("button.is-custom")).toHaveAttribute("aria-checked", "true");
  await expect(picker.locator(".handheld-brief__meta")).toHaveText("已选 6/17");
  await expect(custom).toHaveValue("");
  for (const label of ["节日礼赠", "开箱体验", "尺码对照"]) {
    await custom.fill(label);
    await popover.getByRole("button", { name: "添加" }).click();
  }
  await expect(grid.locator("button.is-custom")).toHaveCount(4);
  await expect(custom).toBeDisabled();
  await popover.getByRole("button", { name: "删除自定义方向 开箱体验" }).click();
  await expect(grid.locator("button.is-custom")).toHaveCount(3);
  await expect(custom).toBeEnabled();
  await popover.getByRole("button", { name: "关闭" }).click();
  await expect(popover).toHaveCount(0);
  // 自定义芯片直接出现在选项卡里
  await expect(
    picker.locator(".workbench-types__chips button.is-custom"),
  ).toHaveCount(3);

  // 补充参考图槽 / 补充描述 / 清晰度 / 自动直出开关都在
  await expect(page.getByRole("button", { name: "上传补充参考图" })).toBeVisible();
  await page.getByRole("textbox", { name: /补充描述/ }).fill("突出节能，禁止出现人物");
  await expect(page.locator(".detail-note__count")).toHaveText("11/2000");
  // 清晰度只列出模型支持的档位（E2E 模型只支持 1K）
  const resolution = page.getByRole("radiogroup", { name: "选择清晰度" });
  await expect(resolution.getByRole("radio")).toHaveCount(1);
  await expect(resolution.getByRole("radio", { name: "1K" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(
    page.getByRole("checkbox", { name: "策划完毕后自动直接生成" }),
  ).toBeChecked();
  await expect(
    page.getByRole("button", { name: /开始 AI 智能策划并生成/ }),
  ).toBeVisible();

  // 默认平台 Amazon：右侧 A+ 卡可见，画幅锁定官方尺寸
  await expect(page.locator(".detail-amazon")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "ASIN", exact: true })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "选择详情页画幅" })).toHaveCount(0);
  await expect(workbench.locator(".detail-official")).toContainText("A+ 官方尺寸");
  await expect(page.locator(".detail-frame__title em")).toContainText("Amazon US A+");
  // 基础版最多 5 个模块：多勾的方向按顺序截断
  await expect(page.locator(".detail-generate small")).toContainText("5张");

  // 切到淘宝：Amazon 卡收起，画幅可选，出图数按勾选数量
  await page.getByRole("button", { name: /^投放设置/ }).click();
  await page.getByRole("button", { name: "选择详情投放平台" }).click();
  await page.getByRole("option", { name: "淘宝 / 天猫 / 1688" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator(".detail-amazon")).toHaveCount(0);
  const ratios = page.getByRole("radiogroup", { name: "选择详情页画幅" });
  await expect(ratios).toBeVisible();
  await expect(ratios.getByRole("radio", { name: /^3:4/ })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await ratios.getByRole("radio", { name: /^1:1/ }).click();
  await expect(page.locator(".detail-frame__title span")).toContainText("1:1");
  await expect(page.locator(".detail-frame__title em")).toContainText("淘宝 / 天猫 / 1688 详情页");
  await expect(page.locator(".detail-generate small")).toContainText("8张");
});

test("detail page plans copy before generating and can stop for review", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail");
  let planRequest = null;
  await page.route("**/api/v1/commerce/detail-plans", async (route) => {
    planRequest = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          summary: "暖调居家质感串起整页",
          painPoints: ["够不够亮", "刺眼吗", "装不装得上"],
          items: [
            { id: "hero", headline: "一盏灯点亮整间屋", subline: "暖光 3000K", direction: "商品居中，暖色台面" },
            { id: "pain", headline: "夜里起身总是摸黑", subline: "", direction: "昏暗卧室，人物摸索开关" },
          ],
        },
      }),
    });
  });

  // 只保留 2 个方向，关掉“策划完毕后自动直接生成”
  const chips = page.locator(".workbench-types__chips");
  for (const label of [/核心卖点图/, /细节工艺图/, /生活场景图/]) {
    await chips.getByRole("checkbox", { name: label }).click();
  }
  await expect(chips.locator('[aria-checked="true"]')).toHaveCount(2);
  await expect(page.locator(".detail-plan li")).toHaveCount(2);
  const autoGenerate = page.getByRole("checkbox", { name: "策划完毕后自动直接生成" });
  await autoGenerate.click();
  await expect(autoGenerate).not.toBeChecked();
  await expect(page.locator(".detail-generate")).toContainText("AI 智能策划");
  await expect(page.locator(".detail-generate")).not.toContainText("并生成");

  const planButton = page.locator(".detail-plan__run");
  await expect(planButton).toBeDisabled();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(planButton).toBeEnabled();

  // 底部主按钮此时只做策划，不计费
  await expect(page.locator(".detail-generate small")).toContainText("不计费");
  await page.locator(".detail-generate").click();
  const result = page.locator(".detail-plan__result");
  await expect(result).toContainText("买家痛点");
  await expect(result).toContainText("够不够亮");
  await expect(result).toContainText("暖调居家质感串起整页");
  await expect(result).toContainText("一盏灯点亮整间屋");
  await expect(result).toContainText("夜里起身总是摸黑");
  expect(planRequest?.types?.map((item) => item.id)).toEqual(["hero", "pain"]);
  expect(planRequest?.inputKeys).toEqual(["uploads/e2e-user-1/product.png"]);
  expect(planRequest?.amazon?.marketplaceId).toBe("US");

  // 舞台按策划文案预排版块（与商品套图同一套：大图 + 侧边缩略图条）；主按钮变成生成
  await expect(page.locator(".detail-frame")).toHaveClass(/is-planned/);
  await expect(page.locator(".detail-frame__thumbs .handheld-frame__thumb")).toHaveCount(2);
  await expect(page.locator(".detail-aplus__slot strong").first()).toHaveText(
    "一盏灯点亮整间屋",
  );
  await page.locator(".detail-frame__thumbs .handheld-frame__thumb").nth(1).click();
  await expect(page.locator(".detail-aplus__slot strong").first()).toHaveText(
    "夜里起身总是摸黑",
  );
  await expect(page.locator(".detail-generate")).toContainText("生成 2 张详情图");
  await expect(page.getByRole("button", { name: "重新策划" })).toBeVisible();

  // 清除后回到策划前
  await page.getByRole("button", { name: "清除策划方案" }).click();
  await expect(result).toHaveCount(0);
  await expect(page.locator(".detail-generate")).toContainText("AI 智能策划");
});

test("detail page keeps result actions and continuous optimization inside the frame", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail&seedResult=1");

  const frame = page.locator(".detail-frame");
  await expect(frame).toHaveClass(/has-image/);
  await expect(frame.locator(".detail-page__shot")).toHaveCount(1);
  await expect(frame.locator(".detail-frame__module")).toContainText("970×600");
  const actions = page.getByLabel("结果操作");
  await expect(actions.getByRole("button", { name: "局部修正" })).toBeEnabled();
  await expect(actions.getByRole("button", { name: "下载", exact: true })).toBeEnabled();
  await expect(actions.getByRole("button", { name: "导出图片+文案" })).toBeEnabled();
  await expect(page.getByLabel("选择调整方向")).toHaveCount(0);

  await actions.getByRole("button", { name: "连续优化" }).click();
  const revision = page.getByRole("dialog", { name: "继续调整当前成品" });
  await expect(revision).toBeVisible();
  await expect(page.getByLabel("选择调整方向")).toBeVisible();
  await revision.getByRole("button", { name: "收起连续优化" }).click();
  await expect(revision).toHaveCount(0);

  // 侧边缩略图条列出本次全部版块：切到未生成的版块只换画框内容，结果与操作不丢
  const thumbs = frame.locator("..").locator(".detail-frame__thumbs .handheld-frame__thumb");
  await expect(thumbs).toHaveCount(5);
  await thumbs.nth(1).click();
  await expect(frame.locator(".detail-frame__module")).toContainText("痛点困扰图");
  await thumbs.nth(0).click();
  await expect(frame.locator(".detail-page__shot")).toHaveCount(1);
  await expect(actions.getByRole("button", { name: "下载", exact: true })).toBeEnabled();
});

test("product library loads a product into the current task", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  await expect(studio.getByRole("textbox", { name: "商品名称" })).toHaveValue("");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "商品库" })
    .click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".commerce-products")).toHaveAttribute(
    "data-products-content-motion-state",
    "entered",
  );

  await page.locator(".commerce-product-card__actions .is-primary").click();
  await expect(page.locator(".commerce-workbench.is-listing")).toBeVisible();
  await expect(studio.locator(".listing-upload .handheld-ref-card.has-file")).toHaveCount(1);
  await expect(studio.getByRole("textbox", { name: "商品名称" })).toHaveValue(
    "延迟返回的测试商品",
  );
});

test("listing studio shows a finished set as tiles with result actions", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing&seedResult=multi");
  const studio = page.locator(".listing-studio");
  await expect(studio.locator(".listing-stage__head")).toContainText("创作结果");
  const tiles = studio.locator(".listing-tile");
  await expect(tiles).toHaveCount(4);
  await expect(tiles.locator("img")).toHaveCount(4);
  const actions = studio.getByRole("group", { name: "结果操作" });
  for (const name of ["连续优化", "局部修正", "存入素材库", "下载套图"]) {
    await expect(actions.getByRole("button", { name })).toBeEnabled();
  }
  await expect(actions.getByRole("button", { name: "下载", exact: true })).toBeEnabled();

  // 第一次点选中，连续优化作用于选中的那张
  await tiles.nth(2).getByRole("button").click();
  await expect(tiles.nth(2)).toHaveClass(/is-selected/);
  await actions.getByRole("button", { name: "连续优化" }).click();
  const revision = page.getByRole("dialog", { name: "继续调整当前成品" });
  await expect(revision).toBeVisible();
  await expect(revision.getByRole("button", { name: /生成 V2/ })).toBeDisabled();
  await revision.getByRole("textbox").fill("标题换成白色，其他保持不变");
  await expect(revision.getByRole("button", { name: /生成 V2/ })).toBeEnabled();
  await revision.getByRole("button", { name: "收起连续优化" }).click();
  await expect(revision).toHaveCount(0);

  const historyCard = page
    .getByLabel("商品套图历史")
    .getByRole("listitem", { name: "商品套图，共 4 张" });
  await expect(historyCard).toHaveAttribute("aria-pressed", "true");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
});

test("generate asks for credit confirmation before submitting", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "商品库" })
    .click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toBeVisible();
  await page.locator(".commerce-product-card__actions .is-primary").click();
  const generateButton = page.getByRole("button", { name: /智能策划并生成/ });
  await expect(generateButton).toBeEnabled();

  await generateButton.click();
  const dialog = page.getByRole("dialog", { name: "确认生成费用" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ai-cost-confirm-total")).toContainText(
    "15 积分",
  );
  await expect(dialog.locator(".ai-cost-confirm-total")).toContainText(
    "3 积分 / 张 × 5 张",
  );
  await expect(dialog.locator(".ai-cost-confirm-balance")).toContainText(
    "120 积分",
  );
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);

  await generateButton.click();
  await expect(
    page.getByRole("dialog", { name: "确认生成费用" }),
  ).toBeVisible();
  await page.locator(".ai-cost-confirm-btn.primary").click();
  await expect(page.getByRole("dialog", { name: "确认生成费用" })).toHaveCount(
    0,
  );
});

test("product deletion stays inside an accessible confirmation dialog", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "商品库" })
    .click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toBeVisible();

  await page.locator('[aria-label="删除商品"]').click();
  const dialog = page.locator('[role="alertdialog"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[aria-label="取消删除"]')).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.locator(".commerce-delete-dialog__danger")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator('[aria-label="取消删除"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[aria-label="删除商品"]')).toBeFocused();

  await page.locator('[aria-label="删除商品"]').click();
  await page.locator(".commerce-delete-dialog__danger").click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toHaveCount(0);
});

test("product library archives and restores a product", async ({ page }) => {
  await page.goto("/ecommerce-design?tool=detail");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "商品库" })
    .click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "归档商品" }).click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "已归档" }).click();
  await expect(page.locator(".commerce-product-card strong")).toContainText(
    "延迟返回的测试商品",
  );
  await expect(page.locator(".commerce-product-card em")).toHaveText("已归档");

  await page.getByRole("button", { name: "恢复商品" }).click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "使用中" }).click();
  await expect(
    page.getByText("延迟返回的测试商品", { exact: true }),
  ).toBeVisible();
});

test("product editor warns before discarding unsaved changes", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "商品库" })
    .click();
  await expect(page.locator(".commerce-products h2")).toHaveText("商品库");
  await page
    .locator(".commerce-products__header .commerce-products__primary")
    .click();
  await page
    .locator(".commerce-product-editor__fields input")
    .first()
    .fill("未保存商品");

  await page
    .locator(".commerce-products__header .commerce-products__icon-button")
    .last()
    .click();
  await expect(page.locator('[role="alertdialog"]')).toBeVisible();
  await page.locator(".commerce-delete-dialog__danger").click();
  await expect(page.locator(".commerce-product-editor")).toHaveCount(0);
});

test("history loading exposes a retryable error instead of an empty state", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail&failHistory=1");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "电商历史" })
    .click();

  const historyError = page.locator(".workspace-library__inline-error");
  await expect(historyError).toContainText("历史记录读取失败");
  await historyError.locator("button").click();
  await expect(page.locator(".workspace-empty")).toBeVisible();
  await expect(historyError).toHaveCount(0);
});

test("ecommerce history exposes deletion and removes the record", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail&seedResult=1");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "电商历史" })
    .click();

  await expect(page.locator(".asset-card")).toHaveCount(1);
  await expect(page.locator(".commerce-studio")).toHaveAttribute(
    "data-commerce-library-motion-state",
    "entered",
  );
  await page.getByRole("button", { name: "删除A+ 详情历史记录" }).click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "如果其他结果由它继续生成，也会一并删除",
  );
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator(".asset-card")).toHaveCount(0);
  await expect(page.locator(".workspace-empty")).toBeVisible();
});

test("workbench keeps result actions reachable after loading history", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=campaign&seedResult=multi");
  const workbench = page.locator(".commerce-workbench.is-campaign");
  await expect(workbench).toBeVisible();
  const frame = workbench.locator(".handheld-frame");
  await expect(frame).toHaveClass(/has-image/);
  await expect(page.locator(".result-workspace")).toHaveCount(0);
  await expect(frame.locator(".handheld-frame__shot img")).toHaveCSS(
    "object-fit",
    "contain",
  );
  const resultFitsStage = await page.evaluate(() => {
    const stage = document.querySelector(".workbench-output");
    const card = document.querySelector(".handheld-frame");
    if (!stage || !card) return false;
    const stageRect = stage.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    return (
      cardRect.top >= stageRect.top &&
      cardRect.left >= stageRect.left &&
      cardRect.right <= stageRect.right &&
      cardRect.bottom <= stageRect.bottom
    );
  });
  expect(resultFitsStage).toBe(true);

  await expect(page.getByRole("button", { name: "查看营销图" })).toBeVisible();
  const actions = page.getByLabel("结果操作");
  await expect(actions.getByRole("button", { name: "连续优化" })).toBeVisible();
  await expect(actions.getByRole("button", { name: "局部修正" })).toBeEnabled();
  await expect(actions.getByRole("button", { name: "下载", exact: true })).toBeEnabled();
  await expect(actions.getByRole("button", { name: "存入素材库" })).toBeEnabled();
  await expect(actions.getByRole("button", { name: "下载套图" })).toBeEnabled();

  const revisionToggle = actions.getByRole("button", { name: "连续优化" });
  await revisionToggle.focus();
  await expect(revisionToggle).toBeFocused();
  await page.keyboard.press("Enter");
  const revision = page.getByRole("dialog", { name: "继续调整当前成品" });
  await expect(revision).toBeVisible();
  await expect(revision.getByRole("button", { name: /生成 V2/ })).toBeDisabled();
  await revision.getByRole("textbox").fill("商品再放大 15%，背景改为浅灰影棚");
  await expect(revision.getByRole("button", { name: /生成 V2/ })).toBeEnabled();
  await revision.getByRole("button", { name: "收起连续优化" }).click();
  await expect(revision).toHaveCount(0);

  const historyCard = page
    .getByLabel("营销图历史")
    .getByRole("listitem", { name: "营销图，共 4 张" });
  await expect(historyCard).toBeVisible();
  await expect(historyCard).toHaveAttribute("aria-pressed", "true");
});

test("multi-image results render as a stable thumb strip beside the frame", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=campaign&seedResult=multi");
  const frame = page.locator(".handheld-frame");
  await expect(frame).toHaveClass(/has-image/);
  const thumbs = page.getByRole("list", { name: "本次套图" }).getByRole("listitem");
  await expect(thumbs).toHaveCount(4);
  await expect(thumbs.locator("img")).toHaveCount(4);
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".commerce-canvas")).toHaveCSS("transform", "none");

  const snapshot = () =>
    thumbs.evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
  const initial = await snapshot();
  const frameBox = await frame.boundingBox();
  // 缩略图在画框右侧纵向排列，互不重叠
  expect(initial.every((rect) => rect.x >= frameBox.x + frameBox.width - 1)).toBe(
    true,
  );
  expect(
    initial.every((rect, index) =>
      index === 0 ? true : rect.y >= initial[index - 1].y + initial[index - 1].height - 0.5,
    ),
  ).toBe(true);
  expect(initial.every((rect) => Math.abs(rect.x - initial[0].x) < 0.5)).toBe(true);
  const bounds = await page.evaluate(() => {
    const canvas = document.querySelector(".commerce-canvas")?.getBoundingClientRect();
    const stage = document.querySelector(".workbench-output");
    const stageRect = stage?.getBoundingClientRect();
    return {
      canvas,
      stage: stageRect,
      scrollWidth: stage?.scrollWidth || 0,
      clientWidth: stage?.clientWidth || 0,
    };
  });
  expect(bounds.stage.right).toBeLessThanOrEqual(bounds.canvas.right + 1);
  expect(bounds.stage.bottom).toBeLessThanOrEqual(bounds.canvas.bottom + 1);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);

  await thumbs.nth(2).click();
  await expect(thumbs.nth(2)).toHaveAttribute("aria-pressed", "true");
  await expect(thumbs.first()).toHaveAttribute("aria-pressed", "false");
  await page.waitForTimeout(300);
  await thumbs.first().hover();
  await page.waitForTimeout(100);
  const settled = await snapshot();
  expect(
    settled.every((rect, index) =>
      Object.keys(rect).every(
        (key) => Math.abs(rect[key] - initial[index][key]) < 0.5,
      ),
    ),
  ).toBe(true);
});

async function mockEcommerceApis(page) {
  let failedHistoryRequests = 0;
  let productStatus = "active";
  let productBriefAttempts = 0;
  let runningTryonSeeded = false;
  // 通用工作台（营销图）运行中的任务：已经跑了 45 秒，刷新后读秒要从这里续接
  const runningCampaignStartedAt = new Date(Date.now() - 45_000).toISOString();
  const runningCampaignTask = () => ({
    id: "e2e-running-campaign",
    type: "ecommerce_design",
    status: "running",
    prompt: "测试运行中的营销图任务",
    params: {
      _kind: "ui-design-ecommerce-campaign-generation",
      aspectRatio: "1:1",
      batchId: "e2e-running-campaign-batch",
      batchIndex: 0,
      batchSize: 1,
      batchCreatedAt: runningCampaignStartedAt,
    },
    count: 1,
    originalUrls: [],
    outputUrls: [],
    createdAt: runningCampaignStartedAt,
    startedAt: runningCampaignStartedAt,
  });
  const runningTryonStartedAt = new Date(Date.now() - 12_000).toISOString();
  const runningTryonTask = () => ({
    id: "e2e-running-tryon",
    type: "ecommerce_design",
    status: "running",
    prompt: "测试运行中的虚拟试衣任务",
    params: {
      _kind: "ui-design-ecommerce-tryon-generation",
      aspectRatio: "2:3",
      batchId: "e2e-running-tryon-batch",
      batchIndex: 0,
      batchSize: 1,
      batchCreatedAt: runningTryonStartedAt,
    },
    count: 1,
    originalUrls: [],
    outputUrls: [],
    createdAt: runningTryonStartedAt,
    startedAt: runningTryonStartedAt,
  });
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/v1/auth/session") {
      await fulfill(route, { user: USER });
      return;
    }
    if (path === "/api/v1/runtime-config") {
      await fulfill(route, {
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
      return;
    }
    if (path === "/api/v1/pricing") {
      await fulfill(route, { taskPointPrices: { ecommerce_design: 3 } });
      return;
    }
    if (path === "/api/v1/me/wallet") {
      await fulfill(route, { availableCents: 120, balanceCents: 120 });
      return;
    }
    if (path === "/api/v1/me/profile" && request.method() === "PATCH") {
      await fulfill(route, { user: { ...USER, requireCostConfirm: false } });
      return;
    }
    if (path === "/api/v1/uploads" && request.method() === "POST") {
      await fulfill(route, {
        key: "uploads/e2e-user-1/product.png",
        url: "/api/v1/files/mock-product.png",
      });
      return;
    }
    if (
      path === "/api/v1/commerce/catalog" ||
      path === "/api/v1/commerce/tryon-catalog"
    ) {
      const empty =
        new URL(page.url()).searchParams.get("emptyCatalog") === "1";
      const imageUrl = "/api/v1/files/mock-product.png";
      await fulfill(route, {
        models: empty
          ? []
          : [
              {
                id: "east-asian-female",
                label: "东亚女性",
                imageUrl,
              },
              {
                id: "european-male",
                label: "欧美男性",
                imageUrl,
              },
            ],
        scenes: empty
          ? []
          : [
              { id: "studio", label: "纯色棚拍", imageUrl },
              { id: "street", label: "都市街头", imageUrl },
            ],
        garments: [],
        hands: [],
      });
      return;
    }
    if (
      path === "/api/v1/commerce/product-briefs" &&
      request.method() === "POST"
    ) {
      productBriefAttempts += 1;
      await fulfill(route, {
        productName:
          productBriefAttempts === 1 ? "第一版商品名称" : "第二版商品名称",
        sellingPoints:
          productBriefAttempts === 1
            ? "第一版卖点一\n第一版卖点二"
            : "第二版卖点一\n第二版卖点二",
      });
      return;
    }
    if (path === "/api/v1/files/mock-product.png") {
      await route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
      return;
    }
    if (
      path === "/api/v1/commerce/products/e2e-product-1" &&
      request.method() === "PATCH"
    ) {
      const payload = request.postDataJSON() || {};
      productStatus = payload.status || productStatus;
      await fulfill(route, {
        id: "e2e-product-1",
        title: "延迟返回的测试商品",
        status: productStatus,
        sellingPoints: "真实卖点",
        assets: [
          {
            id: "e2e-asset-1",
            title: "商品正面",
            url: "/api/v1/files/mock-product.png",
            thumbnailUrl: "/api/v1/files/mock-product.png",
          },
        ],
        assetIds: ["e2e-asset-1"],
        protectedElements: [],
      });
      return;
    }
    if (path === "/api/v1/commerce/products") {
      const query = url.searchParams.get("q") || "";
      if (!query) {
        await new Promise((resolve) => setTimeout(resolve, 350));
        await fulfill(route, {
          items:
            url.searchParams.get("status") === productStatus ||
            !url.searchParams.get("status")
              ? [
                  {
                    id: "e2e-product-1",
                    title: "延迟返回的测试商品",
                    status: productStatus,
                    sellingPoints: "真实卖点",
                    assets: [
                      {
                        id: "e2e-asset-1",
                        title: "商品正面",
                        url: "/api/v1/files/mock-product.png",
                        thumbnailUrl: "/api/v1/files/mock-product.png",
                      },
                    ],
                    assetIds: ["e2e-asset-1"],
                    protectedElements: [],
                  },
                ]
              : [],
          nextCursor: null,
        });
      } else {
        await fulfill(route, { items: [], nextCursor: null });
      }
      return;
    }
    if (path === "/api/v1/tasks") {
      const seedResult = new URL(page.url()).searchParams.get("seedResult");
      if (seedResult === "runningTryon") runningTryonSeeded = true;
      if (seedResult === "runningCampaign") {
        await fulfill(route, { items: [runningCampaignTask()], nextCursor: null });
        return;
      }
      if (runningTryonSeeded) {
        await fulfill(route, { items: [runningTryonTask()], nextCursor: null });
        return;
      }
      if (seedResult === "handheld") {
        const shots = [
          { id: "hero", label: "手持主图" },
          { id: "present", label: "递出展示" },
          { id: "use", label: "使用瞬间" },
          { id: "detail", label: "材质特写" },
        ];
        await fulfill(route, {
          items: shots.map((shot, index) => {
            const imageUrl = `/api/v1/files/mock-product.png?handheld=${index + 1}`;
            return {
              id: `e2e-handheld-task-${index + 1}`,
              type: "ecommerce_design",
              status: "succeeded",
              prompt: "测试手持商品结果",
              params: {
                _kind: "ui-design-ecommerce-handheld-generation",
                aspectRatio: "1:1",
                batchId: "e2e-handheld-batch-1",
                batchIndex: index,
                batchSize: shots.length,
                batchCreatedAt: "2026-01-01T00:00:00.000Z",
                handheldSpec: {
                  crop: "wrist",
                  pack: "listing",
                  platform: "taobao",
                  aspectRatio: "1:1",
                  category: "lipstick",
                  shots,
                },
              },
              count: 1,
              originalUrls: [imageUrl],
              outputUrls: [imageUrl],
              createdAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:01:00.000Z",
            };
          }),
          nextCursor: null,
        });
        return;
      }
      if (seedResult === "1" || seedResult === "multi") {
        const count = seedResult === "multi" ? 4 : 1;
        const requestedTool = new URL(page.url()).searchParams.get("tool");
        const mode =
          requestedTool === "accessory"
            ? "accessory"
            : seedResult === "multi"
              ? requestedTool === "campaign"
                ? "campaign"
                : "listing"
              : "detail";
        await fulfill(route, {
          items: Array.from({ length: count }, (_, index) => {
            const imageUrl = `/api/v1/files/mock-product.png?result=${index + 1}`;
            return {
              id: `e2e-result-task-${index + 1}`,
              type: "ecommerce_design",
              status: "succeeded",
              prompt: "测试电商结果",
              params: {
                _kind: `ui-design-ecommerce-${mode}-generation`,
                aspectRatio: seedResult === "multi" ? "1:1" : "3:4",
                batchId: "e2e-result-batch-1",
                batchIndex: index,
                batchSize: count,
                batchCreatedAt: "2026-01-01T00:00:00.000Z",
                ...(mode === "accessory"
                  ? {
                      accessorySpec: {
                        schemaVersion: 1,
                        category: "ring",
                        pack: "pdp",
                        material: "gemstone",
                        scale: "visual",
                        sizeMm: "",
                        occlusion: "natural",
                        crop: "macro",
                        style: "catalog",
                        platform: "独立站",
                        market: "中国大陆",
                        aspectRatio: "4:5",
                        productName: "测试戒指",
                        sku: "E2E-RING",
                        sellingPoints: "六枚镶爪",
                        hasModel: false,
                        hasScene: false,
                        shotId: ["hero", "angle", "scale", "macro"][index],
                        shotLabel: [
                          "佩戴主图",
                          "补充角度",
                          "比例说明",
                          "工艺微距",
                        ][index],
                      },
                    }
                  : {}),
              },
              count: 1,
              originalUrls: [imageUrl],
              outputUrls: [imageUrl],
              createdAt: "2026-01-01T00:00:00.000Z",
              finishedAt: "2026-01-01T00:01:00.000Z",
            };
          }),
          nextCursor: null,
        });
        return;
      }
      const shouldFail =
        new URL(page.url()).searchParams.get("failHistory") === "1" &&
        failedHistoryRequests < 6;
      if (shouldFail) {
        failedHistoryRequests += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            success: false,
            message: "history unavailable",
          }),
        });
        return;
      }
      await fulfill(route, { items: [], nextCursor: null });
      return;
    }
    if (
      path === "/api/v1/tasks/e2e-running-tryon" &&
      request.method() === "GET"
    ) {
      await fulfill(route, runningTryonTask());
      return;
    }
    if (
      path === "/api/v1/tasks/e2e-running-campaign" &&
      request.method() === "GET"
    ) {
      await fulfill(route, runningCampaignTask());
      return;
    }
    if (
      path === "/api/v1/tasks/e2e-result-task-1" &&
      request.method() === "DELETE"
    ) {
      if (url.searchParams.get("cascade") !== "true") {
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: "{}",
        });
        return;
      }
      await fulfill(route, { deletedTaskIds: ["e2e-result-task-1"] });
      return;
    }
    if (path === "/api/v1/me/assets") {
      await fulfill(route, { items: [], nextCursor: null });
      return;
    }
    if (path === "/api/v1/me/asset-groups") {
      await fulfill(route, {
        items: [],
        ungroupedCount: 0,
        totalAssetCount: 0,
      });
      return;
    }
    await fulfill(route, {});
  });
}

async function fulfill(route, data) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ success: true, data }),
  });
}

test("each ecommerce module keeps its own references and only the model is shared", async ({
  page,
}) => {
  const historyKinds = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/tasks" && request.method() === "GET") {
      historyKinds.push(url.searchParams.get("kind") || "");
    }
  });
  await page.goto("/ecommerce-design?tool=campaign");
  const workbench = page.locator(".commerce-workbench.is-campaign");
  await expect(workbench).toBeVisible();
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "campaign-product.png",
    mimeType: "image/png",
    buffer: PIXEL_PNG,
  });
  await expect(page.locator(".workbench-refs .handheld-ref-card.has-file")).toHaveCount(1);
  await workbench.getByRole("textbox", { name: "细节补充" }).fill("只属于营销图的补充");
  await expect.poll(() => historyKinds).toContain("ui-design-ecommerce-campaign-generation");

  // 换到另一个模块：参考图和补充说明都不带过去
  await page.getByRole("button", { name: /AI 背景图/ }).click();
  await expect(page).toHaveURL(/tool=background/);
  const background = page.locator(".commerce-workbench.is-background");
  await expect(background).toBeVisible();
  await expect(page.locator(".workbench-refs .handheld-ref-card.has-file")).toHaveCount(0);
  await expect(background.getByRole("textbox", { name: "细节补充" })).toHaveValue("");
  await expect.poll(() => historyKinds).toContain("ui-design-ecommerce-background-generation");
  // 顶部生成模型是唯一共享的设置
  await expect(page.getByLabel("选择生成模型")).toContainText("E2E 图片模型");

  // 回到营销图：参考图与补充说明原样恢复
  await page.getByRole("button", { name: /AI 营销图/ }).click();
  await expect(page).toHaveURL(/tool=campaign/);
  await expect(page.locator(".workbench-refs .handheld-ref-card.has-file")).toHaveCount(1);
  await expect(
    page.locator(".commerce-workbench.is-campaign").getByRole("textbox", { name: "细节补充" }),
  ).toHaveValue("只属于营销图的补充");
});

test("listing references and product info survive a page refresh", async ({ page }) => {
  await page.goto("/ecommerce-design?tool=listing");
  const studio = page.locator(".listing-studio");
  await page.locator('input[type="file"]').first().setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: PIXEL_PNG,
  });
  await studio.getByRole("textbox", { name: "商品名称" }).fill("刷新后还在的保温杯");
  await expect(studio.locator(".listing-upload .handheld-ref-card.has-file")).toHaveCount(1);
  // 草稿防抖写入后再刷新
  await page.waitForTimeout(800);
  await page.reload();
  await expect(studio.getByRole("textbox", { name: "商品名称" })).toHaveValue("刷新后还在的保温杯");
  await expect(studio.locator(".listing-upload .handheld-ref-card.has-file")).toHaveCount(1);
});

test("a running workbench batch keeps counting after a refresh", async ({ page }) => {
  await page.goto("/ecommerce-design?tool=campaign&seedResult=runningCampaign");
  const stage = page.locator(".commerce-workbench.is-campaign [role=status]").filter({
    hasText: /./,
  });
  // 任务 45 秒前创建：读秒从创建时间续接，而不是从 0 开始
  await expect
    .poll(async () => {
      const label = await page
        .locator(".commerce-workbench.is-campaign [aria-label*='已等待']")
        .first()
        .getAttribute("aria-label")
        .catch(() => "");
      const match = String(label || "").match(/已等待 (\d+) 秒/);
      return match ? Number(match[1]) : -1;
    })
    .toBeGreaterThanOrEqual(44);
  await expect(stage.first()).toBeVisible();
});
