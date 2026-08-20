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

test("AI commerce opens in a single guided commercial shoot flow", async ({
  page,
}) => {
  await page.goto("/ecommerce-design");

  await expect(page.locator(".commerce-header__copy strong")).toHaveText(
    "AI 创意商拍",
  );
  await expect(
    page.getByRole("heading", { name: "创建一组商业成片" }),
  ).toBeVisible();
  await expect(page.locator(".commerce-settings")).toHaveCount(0);
  await expect(page.locator(".commerce-header__actions button")).toHaveCount(3);
  await expect(page.locator(".creative-flow__step")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "生成商业成片" })).toHaveCount(
    1,
  );

  await page.getByRole("button", { name: "社媒种草" }).click();
  await page.getByRole("button", { name: "建立质感" }).click();
  await page
    .getByPlaceholder("例如：25-35岁城市通勤人群")
    .fill("25-35岁城市通勤人群");
  await expect(page.locator(".creative-flow__summary-title")).toContainText(
    "社媒种草",
  );

  await expect(page.locator(".creative-flow__shot-builder li")).toHaveCount(4);
  await page.getByRole("button", { name: "移除镜头 卖点表达" }).click();
  await expect(page.locator(".creative-flow__shot-builder li")).toHaveCount(3);
  await page.getByRole("button", { name: "+ 尺寸比例" }).click();
  await expect(page.locator(".creative-flow__shot-builder li")).toHaveCount(4);
  await page.getByRole("button", { name: "上移 尺寸比例" }).click();
  await expect(
    page.locator(".creative-flow__shot-builder li").nth(2),
  ).toContainText("尺寸比例");

  const lifestyle = page
    .locator(".creative-flow__directions button")
    .filter({ hasText: "生活场景" });
  await lifestyle.click();
  await expect(lifestyle).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".creative-flow__summary-title")).toContainText(
    "生活场景",
  );

  await page.getByRole("button", { name: /1:1/ }).click();
  const preview = await page.locator(".creative-flow__preview").boundingBox();
  expect(Math.abs(preview.width / preview.height - 1)).toBeLessThan(0.02);

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
  await expect(page.locator(".creative-flow__product-ready")).toBeVisible();
  await expect(page.locator(".creative-flow__truth")).toHaveAttribute(
    "open",
    "",
  );
  await expect(
    page.getByRole("button", { name: "生成商业成片" }),
  ).toBeEnabled();
});

test("guided commercial shoot remains usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ecommerce-design?tool=shoot");
  await page
    .locator(".mobile-pane-switch button")
    .filter({ hasText: "创作台" })
    .click();

  await expect(page.locator(".creative-flow")).toBeVisible();
  await expect(page.locator(".mobile-pane-switch button")).toHaveCount(3);
  await expect(page.locator(".creative-flow__directions button")).toHaveCount(
    4,
  );
  const [formBox, summaryBox] = await Promise.all([
    page.locator(".creative-flow__form").boundingBox(),
    page.locator(".creative-flow__summary").boundingBox(),
  ]);
  expect(summaryBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height - 1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.locator(".commerce-canvas").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    page.getByRole("button", { name: "生成商业成片" }),
  ).toBeVisible();
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
    4,
  );
  await expect(page.locator(".commerce-canvas")).toHaveCSS("opacity", "1");
  await expect(page.locator(".commerce-canvas")).toHaveCSS("transform", "none");
  await expect(page.locator(".commerce-workspace-title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新建任务" })).toHaveCount(0);
  await expect(page.locator(".settings-heading h2").first()).toBeVisible();

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

test("commerce operations workspace reviews and approves a commercial asset", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail&seedResult=1");
  await page
    .locator(".commerce-header__actions button")
    .filter({ hasText: "业务中心" })
    .click();

  await expect(
    page.getByRole("heading", { name: "商拍业务中心" }),
  ).toBeVisible();
  await expect(page.locator(".commerce-ops__queue-list article")).toHaveCount(
    1,
  );
  await expect(page.getByText("待质检", { exact: true }).last()).toBeVisible();

  for (const label of [
    "商品身份",
    "包装与文字",
    "颜色与材质",
    "光影与物理",
    "渠道规范",
    "权利与标识",
  ]) {
    await page
      .locator(".commerce-ops__checklist label")
      .filter({ hasText: label })
      .click();
  }
  await page.getByRole("textbox", { name: "目标渠道" }).fill("Amazon US");
  await page.getByLabel("审核意见").fill("商品事实与渠道规范已核对");
  await page.getByRole("button", { name: "批准交付" }).click();

  await expect(page.getByText("成片已批准，可进入交付")).toBeVisible();
  await expect(page.getByText("已批准", { exact: true }).last()).toBeVisible();
});

test("commerce operations workspace fits a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/ecommerce-design?tool=detail&seedResult=1");
  await page
    .locator(".mobile-pane-switch button")
    .filter({ hasText: "业务" })
    .click();
  await expect(page.locator(".commerce-ops")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await expect(page.locator(".commerce-ops__metrics")).toHaveCSS(
    "grid-template-columns",
    /.+ .+/,
  );
});

test("English ecommerce workspace keeps labels in one locale", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("starclouds-locale", "en"),
  );
  await page.goto("/ecommerce-design?tool=listing");

  await expect(page.locator(".settings-heading h2").first()).toHaveText(
    "Product images",
  );
  await expect(
    page.getByRole("heading", { name: "Generation settings" }),
  ).toBeVisible();
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
  await expect(page.locator(".commerce-settings")).toBeVisible();
  await expect(page.locator(".commerce-canvas")).toBeVisible();
  await expect(page.locator(".canvas-facts")).toHaveCount(0);
  await expect(
    page
      .locator(".settings-heading")
      .filter({ hasText: "生成设置" })
      .locator(":scope > span"),
  ).toHaveCount(0);
  await expect(page.locator(".showcase-demo img")).toHaveAttribute(
    "src",
    /listing-preview/,
  );
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
  expect(hoverStyles.iconTransform).not.toBe("none");
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
  expect(
    await page
      .locator(".creative-flow__preview img")
      .evaluate((image) => image.naturalWidth > 0),
  ).toBe(true);
  await expect(page.locator(".mobile-pane-switch")).toBeHidden();

  const fitsViewport = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1,
  );
  expect(fitsViewport).toBe(true);
});

test("ecommerce workspace uses layered atelier surfaces in light and dark", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing");
  await expect(page.locator(".commerce-studio")).toBeVisible();
  await expect(page.locator(".commerce-atmosphere")).toBeVisible();
  await expect(page.locator(".commerce-header__brand")).toContainText(
    "AI 电商",
  );

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
        settingsRadiusComputed: getComputedStyle(
          document.querySelector(".commerce-settings"),
        ).borderRadius,
        canvasRadius: getComputedStyle(
          document.querySelector(".commerce-canvas"),
        ).borderRadius,
        uploadRadius: getComputedStyle(
          document.querySelector(".product-upload"),
        ).borderRadius,
        hasAtmosphere: Boolean(document.querySelector(".commerce-atmosphere")),
        stepCount: document.querySelectorAll(".showcase-demo__tag").length,
      };
    });

  expect(await surfaceTokens()).toEqual({
    canvas: "#f3f1f8",
    accent: "#6d5cff",
    settingsRadius: "20px",
    headerRadius: "18px",
    railRadius: "18px",
    settingsRadiusComputed: "20px",
    canvasRadius: "20px",
    uploadRadius: "20px",
    hasAtmosphere: true,
    stepCount: 5,
  });
  await page.evaluate(() =>
    document.documentElement.classList.add("color-scheme-dark"),
  );
  expect(await surfaceTokens()).toMatchObject({
    canvas: "#0c0a12",
    accent: "#8b7bff",
    settingsRadius: "20px",
    hasAtmosphere: true,
    stepCount: 5,
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
    await page.goto("/ecommerce-design?tool=listing");
    await expect(page.locator(".commerce-settings")).toBeVisible();
    await expect(page.locator(".commerce-rail")).toBeVisible();
    await expect(page.locator(".commerce-canvas")).toBeVisible();
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
        settings: rect(".commerce-settings"),
        canvas: rect(".commerce-canvas"),
        showcase: rect(".canvas-showcase"),
        image: rect(".showcase-demo img"),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(layout.settings).toBeTruthy();
    expect(layout.rail).toBeTruthy();
    expect(layout.canvas).toBeTruthy();
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewport.width + 1);
    expect(layout.settings.left - layout.rail.right).toBeGreaterThanOrEqual(4);
    expect(layout.settings.left - layout.rail.right).toBeLessThanOrEqual(10);
    expect(layout.canvas.left - layout.settings.right).toBeGreaterThanOrEqual(
      4,
    );
    expect(layout.canvas.left - layout.settings.right).toBeLessThanOrEqual(12);
    expect(layout.showcase.left).toBeGreaterThanOrEqual(layout.canvas.left);
    expect(layout.showcase.right).toBeLessThanOrEqual(layout.canvas.right + 1);
    expect(layout.image.bottom).toBeLessThanOrEqual(layout.showcase.bottom + 1);
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

  await expect(page.locator(".commerce-settings")).toBeVisible();
  await expect(page.locator(".mobile-tool-switch")).toBeVisible();
  await expect(page.locator(".mobile-tool-switch button")).toHaveCount(13);
  await expect(page.locator(".mobile-tool-switch")).toContainText("AI 商拍");
  await expect(page.locator(".mobile-tool-switch")).toContainText("清晰增强");
  await expect(page.locator(".generate-button")).toContainText("7张");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await page.getByRole("tab", { name: "创作台" }).click();
  await expect(page.locator(".canvas-showcase")).toBeVisible();
  await expect(page.locator(".showcase-demo img")).toBeVisible();
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
  await expect(
    page.getByRole("heading", { name: "爆款参考与商品原图" }),
  ).toBeVisible();
  await expect(page.locator(".generate-meta")).toContainText("还需 1 张参考图");
  await expect(page.locator(".upload-role-guide")).toContainText(
    "爆款参考必填",
  );
  await expect(page.locator(".upload-role-guide")).toContainText(
    "商品原图可选",
  );
  await expect(
    page.getByRole("button", { name: /一键生成爆款图复刻/ }),
  ).toBeDisabled();
  await expect(page.getByLabel("选择文案语言")).toBeVisible();
  await expect(page.locator(".showcase-demo img")).toHaveAttribute(
    "src",
    /clone-preview/,
  );
  await expect(page.getByRole("button", { name: /从素材库选择/ })).toHaveCount(
    0,
  );
  await expect(page.locator(".canvas-intro")).toContainText("上传爆款参考图");
});

test("custom listing structure reallocates an exact seven-image set", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing");
  await expect(page.locator(".shot-plan-section")).toContainText(
    "7 张 · 首张后并行",
  );
  await expect(page.locator(".shot-plan-section")).not.toContainText(
    "顺序生成",
  );
  await page.getByRole("button", { name: /自定义配置/ }).click();

  await expect(page.locator(".listing-count-config")).toContainText(
    "已分配 7/7 张",
  );
  await expect(page.locator(".listing-count-config")).toContainText("套图已满");
  await page.getByRole("button", { name: "减少场景图" }).click();
  await expect(page.locator(".listing-count-config")).toContainText(
    "已分配 6/7 张",
  );
  await expect(page.locator(".listing-count-config")).toContainText("可以生成");
  await page.getByRole("button", { name: "增加其他" }).click();
  await expect(page.locator(".listing-count-config")).toContainText("套图已满");
  await expect(page.locator(".shot-plan-list li")).toHaveCount(7);
});

test("AI product brief waits for confirmation and supports regeneration", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing");
  await page.locator('input[type="file"]').setInputFiles({
    name: "product.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });

  await page.getByRole("button", { name: "AI 生成" }).click();
  const dialog = page.getByRole("dialog", { name: "生成商品名称和卖点" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "商品名称" })).toHaveValue(
    "第一版商品名称",
  );
  await expect(page.locator(".text-field input").first()).toHaveValue("");

  await dialog.getByRole("button", { name: "重新生成" }).click();
  await expect(dialog.getByRole("textbox", { name: "商品名称" })).toHaveValue(
    "第二版商品名称",
  );
  await dialog.getByRole("button", { name: "确认填入" }).click();

  await expect(page.locator(".text-field input").first()).toHaveValue(
    "第二版商品名称",
  );
  await expect(page.locator(".text-field textarea")).toHaveValue(
    "第二版卖点一\n第二版卖点二",
  );
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
  await expect(page.locator(".tryon-ratio-grid button")).toHaveText([
    "1:1",
    "2:3",
    "3:2",
    "16:9",
    "9:16",
  ]);
  await expect(
    page.locator(".tryon-ratio-grid button", { hasText: "2:3" }),
  ).toHaveClass(/active/);
  await expect(page.getByText("补充要求")).toHaveCount(0);
  await expect(page.getByLabel("选择拍摄场景")).toBeVisible();
  await expect(page.getByRole("button", { name: "更多场景" })).toBeVisible();
  await expect(
    page.locator(".choice-chip-grid button", { hasText: "纯色棚拍" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("选择模特人群")).toHaveCount(0);
  await expect(page.getByLabel("选择模特姿态")).toHaveCount(0);
  await expect(page.getByLabel("选择生成张数")).toHaveCount(0);
  await expect(page.getByLabel("选择摄影镜头")).toBeVisible();
  await page.getByLabel("选择摄影镜头").click();
  await expect(page.getByRole("option", { name: /超广角/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /中长焦/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /70–135mm/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("选择光影调整")).toBeVisible();
  await page.getByLabel("选择光影调整").click();
  await expect(page.getByRole("option", { name: "补光塑形" })).toBeVisible();
  await expect(page.getByRole("option", { name: "现场光" })).toBeVisible();
  await expect(page.getByRole("option", { name: "轮廓分离" })).toBeVisible();
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
  await expect(page.getByLabel("生成历史")).toBeVisible();
  await expect(page.locator(".tryon-history__empty")).toContainText("暂无记录");
  await expect(page.locator(".tryon-stage__frame")).toHaveAttribute(
    "data-scene",
    "纯色棚拍",
  );
  await expect(page.locator(".tryon-stage__result")).toHaveAttribute(
    "data-ratio",
    "2:3",
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
  await page.getByRole("button", { name: "16:9", exact: true }).click();
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
  await page.getByRole("button", { name: "2:3", exact: true }).click();
  await expect(page.locator(".tryon-stage__result")).toHaveAttribute(
    "data-ratio",
    "2:3",
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
  await expect(page.getByText("商品图", { exact: true })).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-product")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-product")).toHaveCount(0);
  await expect(page.locator(".handheld-out .handheld-scene")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-scene")).toHaveCount(0);
  await expect(page.getByLabel("选择出图任务")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-brief")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-pack")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-pack")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "选择出镜范围" }),
  ).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-hand")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-hand")).toHaveCount(0);
  await expect(page.getByText("握持姿势", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "更多商品图" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "清空商品图" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传商品图" })).toBeVisible();
  await expect(page.getByText("还没有结果")).toBeVisible();

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
    page.getByRole("button", { name: "画面方案", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("选择画面方案")).toBeHidden();
  await expect(page.getByLabel("选择景深与距离")).toBeHidden();
  await page.getByRole("button", { name: "画面方案", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "画面方案选项" }),
  ).toBeVisible();
  await expect(page.getByLabel("选择画面方案")).toBeVisible();
  await expect(page.getByRole("radio", { name: /商品主图/ })).not.toBeChecked();
  await expect(page.getByRole("radio", { name: /生活种草/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /功能展示/ })).toBeVisible();
  await expect(
    page.getByRole("radio", { name: /材质特写 突出工艺/ }),
  ).toBeVisible();
  await expect(page.getByLabel("选择景深与距离")).toBeVisible();
  await expect(page.getByLabel("选择视觉风格")).toBeVisible();
  await expect(page.getByLabel("选择镜头")).toBeVisible();
  await expect(page.getByLabel("选择机位")).toBeVisible();
  await expect(page.getByLabel("选择光影")).toBeVisible();
  await expect(page.getByLabel("选择视觉焦点")).toBeVisible();
  await expect(page.getByLabel("选择生成方式")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "画面方案选项" })).toHaveCount(
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

  await expect(
    page.getByRole("button", { name: "选择出镜范围" }),
  ).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-crop")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-crop")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "选择出镜范围" }),
  ).toContainText("手腕特写");
  await page.getByRole("button", { name: "选择出镜范围" }).click();
  await expect(page.getByRole("option", { name: "手腕特写" })).toBeVisible();
  await expect(page.getByRole("option", { name: "手指特写" })).toBeVisible();
  await expect(page.getByRole("option", { name: "半身出镜" })).toBeVisible();
  await expect(page.getByRole("option", { name: "全身出镜" })).toBeVisible();
  await expect(page.getByRole("option", { name: "半身禁脸" })).toBeVisible();

  await expect(page.locator(".handheld-out .handheld-hand")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-model")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "上传手指图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传模特模板" })).toHaveCount(
    0,
  );
  await page.getByRole("option", { name: "半身出镜" }).click();
  await expect(
    page.getByRole("button", { name: "选择出镜范围" }),
  ).toContainText("半身出镜");
  await expect(page.locator(".handheld-out .handheld-model")).toBeVisible();
  await expect(page.locator(".handheld-out .handheld-hand")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "上传模特模板" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "选择出镜范围" }).click();
  await page.getByRole("option", { name: "手腕特写" }).click();
  await expect(
    page.getByRole("button", { name: "选择出镜范围" }),
  ).toContainText("手腕特写");
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

  await page.getByRole("button", { name: "画面方案", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "画面方案选项" }),
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
  await expect(page.getByRole("dialog", { name: "画面方案选项" })).toHaveCount(
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
  await expect(
    page.getByRole("button", { name: /生成手持商品图/ }),
  ).toBeVisible();
  await expect(page.locator(".handheld-submit--dock")).toHaveCount(0);
  await expect(page.locator(".handheld-frame .handheld-submit")).toBeVisible();
  await expect(page.locator(".handheld-submit")).toHaveCount(1);
  await expect(page.locator(".handheld-submit")).toContainText("1张");
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
  await expect(page.locator(".handheld-submit")).toContainText("4张");
  await expect(page.locator(".handheld-shots")).toHaveAttribute(
    "data-count",
    "1",
  );
  await expect(page.locator(".handheld-frame")).toHaveCount(1);
  await expect(page.getByLabel("本次套图")).toBeVisible();
  await expect(page.locator(".handheld-frame__thumb")).toHaveCount(4);
  await expect(page.locator(".handheld-pack-summary")).toHaveCount(0);
  await page
    .getByLabel("选择出图任务")
    .getByRole("radio", { name: /单张主图/ })
    .click();
  await expect(page.locator(".handheld-submit")).toHaveCount(1);
  await expect(page.locator(".handheld-submit")).toContainText("1张");
  await expect(page.locator(".handheld-shots")).toHaveAttribute(
    "data-count",
    "1",
  );
  await expect(page.locator(".handheld-frame")).toHaveCount(1);
  await expect(page.locator(".handheld-frame__thumbs")).toHaveCount(0);
  await expect(page.locator(".handheld-out .handheld-layout")).toBeVisible();
  await expect(page.locator(".handheld-pane .handheld-layout")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "更多构图参考" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "清空构图参考" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传构图参考" }),
  ).toBeVisible();
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
    page.getByRole("button", { name: "查看商品大图" }),
  ).toBeVisible();
  await expect(page.locator(".handheld-pane__notice")).toHaveCount(0);
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
  await expect(page.getByText("交付任务", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".accessory-toolbar__trigger")
      .filter({ hasText: "交付任务" })
      .locator(".accessory-toolbar__trigger-badge"),
  ).toHaveText("4张");
  await expect(page.getByLabel("饰品生成历史")).toBeVisible();
  await expect(page.locator(".accessory-history__empty")).toContainText(
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

  await page
    .locator(".accessory-toolbar__trigger")
    .filter({ hasText: "交付任务" })
    .click();
  await expect(
    page.getByRole("dialog", { name: "交付任务设置" }),
  ).toBeVisible();
  await expect(page.locator(".accessory-toolbar__count")).toHaveText([
    "1张",
    "4张",
    "4张",
    "3张",
  ]);
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

  await page
    .locator(".accessory-toolbar__trigger")
    .filter({ hasText: "交付任务" })
    .click();
  await page.getByRole("radio", { name: /单张佩戴主图/ }).click();
  await expect(page.locator(".accessory-frame")).toHaveAttribute(
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
  await page.getByLabel("商品名称").fill("只属于商品套图的测试商品");
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
  await expect(page.locator(".upload-grid figure")).toHaveCount(1);

  await page.getByRole("button", { name: /饰品穿戴/ }).click();
  await expect(page).toHaveURL(/tool=accessory/);
  await expect(page.getByLabel("饰品商业出图工作台")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "上传饰品参考图" }),
  ).toBeVisible();
  await page.getByText("商品信息", { exact: true }).click();
  await expect(page.getByLabel("饰品名称")).toHaveValue("");
  await expect(page.locator(".upload-grid figure")).toHaveCount(0);

  await page.getByRole("button", { name: /商品套图/ }).click();
  await expect(page).toHaveURL(/tool=listing/);
  await expect(page.getByLabel("商品名称")).toHaveValue("");
  await expect(page.locator(".upload-grid figure")).toHaveCount(0);
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
    page.locator('.accessory-frame__shot img[alt="饰品生成结果"]'),
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
  await expect(page.locator(".accessory-frame")).toHaveCSS(
    "border-radius",
    "16px",
  );
  await expect(page.locator(".accessory-current-set__thumb")).toHaveCount(4);
  await expect(page.locator(".accessory-history__item")).toHaveCount(1);
  await expect(page.locator(".accessory-history__count")).toHaveText("4");
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

test("detail page exposes the complete commerce module catalog", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail");
  await expect(page.locator(".module-grid label")).toHaveCount(15);
  await expect(page.getByText("品牌故事图", { exact: true })).toBeVisible();
  await expect(page.getByText("售后保障图", { exact: true })).toBeVisible();
  await expect(page.locator(".showcase-demo img")).toHaveAttribute(
    "src",
    /detail-preview/,
  );
});

test("continuous optimization stays compact until the user opens it", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail&seedResult=1");

  const panel = page.locator(".revision-panel");
  await expect(panel).toBeVisible();
  await expect(panel).not.toHaveClass(/open/);
  await expect(page.getByLabel("选择调整方向")).toBeHidden();

  await page.getByRole("button", { name: "展开连续优化" }).click();
  await expect(panel).toHaveClass(/open/);
  await expect(page.getByLabel("选择调整方向")).toBeVisible();

  await page.getByRole("button", { name: "收起连续优化" }).click();
  await expect(panel).not.toHaveClass(/open/);
});

test("product library loads a product into the current task", async ({
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
  await expect(page.locator(".commerce-products")).toHaveAttribute(
    "data-products-content-motion-state",
    "entered",
  );

  await page.locator(".commerce-product-card__actions .is-primary").click();
  await expect(page.getByText("当前商品", { exact: true })).toBeVisible();
  await expect(page.locator(".upload-grid figure")).toHaveCount(1);
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
  await expect(page.getByRole("button", { name: /一键生成/ })).toBeEnabled();

  await page.getByRole("button", { name: /一键生成/ }).click();
  const dialog = page.getByRole("dialog", { name: "确认生成费用" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".ai-cost-confirm-total")).toContainText(
    "3 积分",
  );
  await expect(dialog.locator(".ai-cost-confirm-total")).toContainText(
    "3 积分 / 张 × 1 张",
  );
  await expect(dialog.locator(".ai-cost-confirm-balance")).toContainText(
    "120 积分",
  );
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole("button", { name: /一键生成/ }).click();
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

test("generated result controls remain keyboard-accessible after loading history", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=detail&seedResult=1");
  await expect(page.locator(".result-workspace")).toBeVisible();
  await expect(page.locator(".result-image-tools")).toHaveCount(0);
  await expect(page.locator(".result-image-card img")).toHaveCSS(
    "object-fit",
    "contain",
  );
  const resultFitsCanvasWithBreathingRoom = await page.evaluate(() => {
    const stage = document.querySelector(".result-stage.is-single");
    const card = stage?.querySelector(".result-image-card");
    if (!stage || !card) return false;
    const stageRect = stage.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const horizontalInset = Math.min(
      cardRect.left - stageRect.left,
      stageRect.right - cardRect.right,
    );
    const verticalInset = Math.min(
      cardRect.top - stageRect.top,
      stageRect.bottom - cardRect.bottom,
    );
    return (
      cardRect.top >= stageRect.top &&
      cardRect.left >= stageRect.left &&
      cardRect.right <= stageRect.right &&
      cardRect.bottom <= stageRect.bottom &&
      horizontalInset >= stageRect.width * 0.08 &&
      verticalInset >= stageRect.height * 0.08 &&
      stage.scrollHeight <= stage.clientHeight + 1
    );
  });
  expect(resultFitsCanvasWithBreathingRoom).toBe(true);
  await expect(
    page.getByRole("button", { name: "放大查看当前结果" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "局部编辑当前结果" }),
  ).toBeVisible();

  const deleteButton = page.locator(".result-delete");
  await expect(deleteButton).toHaveCount(1);
  await deleteButton.focus();
  await expect(deleteButton).toBeFocused();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page.locator(".result-workspace")).toHaveCount(0);
});

test("multi-image results keep fixed non-overlapping slots after load and hover", async ({
  page,
}) => {
  await page.goto("/ecommerce-design?tool=listing&seedResult=multi");
  const cards = page.locator(".result-image-card");
  await expect(cards).toHaveCount(4);
  await expect(cards.locator("img")).toHaveCount(4);
  await expect(page.locator(".commerce-canvas")).toHaveCSS("transform", "none");
  await expect(cards).toHaveClass([/loaded/, /loaded/, /loaded/, /loaded/]);

  const snapshot = () =>
    cards.evaluateAll((items) =>
      items.map((item) => {
        const rect = item.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
  const initial = await snapshot();
  expect(Math.abs(initial[0].x - initial[1].x)).toBeLessThan(0.5);
  expect(initial[1].y).toBeGreaterThan(initial[0].y);
  expect(initial[2].x).toBeGreaterThan(initial[0].x);
  expect(Math.abs(initial[2].y - initial[0].y)).toBeLessThan(0.5);
  expect(Math.abs(initial[3].x - initial[2].x)).toBeLessThan(0.5);
  expect(Math.abs(initial[3].y - initial[1].y)).toBeLessThan(0.5);
  const bounds = await page.evaluate(() => {
    const canvas = document
      .querySelector(".commerce-canvas")
      ?.getBoundingClientRect();
    const stage = document.querySelector(".result-stage");
    const stageRect = stage?.getBoundingClientRect();
    const cards = [...document.querySelectorAll(".result-image-card")].map(
      (item) => item.getBoundingClientRect(),
    );
    return {
      canvas,
      stage: stageRect,
      scrollWidth: stage?.scrollWidth || 0,
      clientWidth: stage?.clientWidth || 0,
      scrollHeight: stage?.scrollHeight || 0,
      clientHeight: stage?.clientHeight || 0,
      cards: cards.map((rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      })),
    };
  });
  expect(bounds.stage.right).toBeLessThanOrEqual(bounds.canvas.right + 1);
  expect(bounds.stage.bottom).toBeLessThanOrEqual(bounds.canvas.bottom + 1);
  expect(bounds.scrollWidth).toBeLessThanOrEqual(bounds.clientWidth + 1);
  expect(bounds.scrollHeight).toBeLessThanOrEqual(bounds.clientHeight + 1);
  expect(
    bounds.cards.every(
      (rect) =>
        rect.left >= bounds.stage.left - 0.5 &&
        rect.right <= bounds.stage.right + 0.5 &&
        rect.top >= bounds.stage.top - 0.5 &&
        rect.bottom <= bounds.stage.bottom + 0.5,
    ),
  ).toBe(true);
  expect(
    initial.every((rect, index) =>
      initial.slice(index + 1).every((other) => {
        const overlapWidth =
          Math.min(rect.x + rect.width, other.x + other.width) -
          Math.max(rect.x, other.x);
        const overlapHeight =
          Math.min(rect.y + rect.height, other.y + other.height) -
          Math.max(rect.y, other.y);
        return overlapWidth <= 0 || overlapHeight <= 0;
      }),
    ),
  ).toBe(true);

  await page.waitForTimeout(450);
  await cards.first().hover();
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
  const commerceReviews = new Map();
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
    if (path === "/api/v1/commerce/reviews" && request.method() === "GET") {
      await fulfill(route, { items: [...commerceReviews.values()] });
      return;
    }
    if (
      path.startsWith("/api/v1/commerce/reviews/") &&
      request.method() === "PUT"
    ) {
      const taskId = path.split("/").at(-1);
      const payload = request.postDataJSON() || {};
      const review = {
        id: `review-${taskId}`,
        taskId,
        status: payload.status || "pending",
        checklist: payload.checklist || {},
        note: payload.note || "",
        channel: payload.channel || "",
        reviewedAt:
          payload.status && payload.status !== "pending"
            ? "2026-01-01T00:02:00.000Z"
            : null,
        updatedAt: "2026-01-01T00:02:00.000Z",
      };
      commerceReviews.set(taskId, review);
      await fulfill(route, review);
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
      if (seedResult === "1" || seedResult === "multi") {
        const count = seedResult === "multi" ? 4 : 1;
        const requestedTool = new URL(page.url()).searchParams.get("tool");
        const mode =
          requestedTool === "accessory"
            ? "accessory"
            : seedResult === "multi"
              ? "listing"
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
