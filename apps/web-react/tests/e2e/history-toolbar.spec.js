import { expect, test } from "@playwright/test";
import { fulfillJson } from "./helpers/authMocks.js";

const user = {
  id: "history-test-user",
  email: "history@example.com",
  username: "历史记录用户",
};

const historyTasks = [
  {
    id: "task-1",
    type: "t2i",
    status: "succeeded",
    prompt: "赛博朋克霓虹街道",
    createdAt: new Date().toISOString(),
    outputUrls: ["/fixtures/cyberpunk.png"],
    images: [{ url: "/fixtures/cyberpunk.png", width: 1024, height: 1024 }],
  },
  {
    id: "task-2",
    type: "background_remove",
    status: "succeeded",
    prompt: "人像抠图",
    createdAt: new Date().toISOString(),
    outputUrls: ["/fixtures/portrait.png"],
    images: [{ url: "/fixtures/portrait.png", width: 800, height: 1200 }],
  },
  ...Array.from({ length: 24 }, (_, i) => ({
    id: `task-${i + 3}`,
    type: i % 2 === 0 ? "t2i" : "background_remove",
    status: "succeeded",
    prompt: `历史测试任务 ${i + 3}`,
    createdAt: new Date(Date.now() - (i + 1) * 60000).toISOString(),
    outputUrls: ["/fixtures/cyberpunk.png"],
    images: [{ url: "/fixtures/cyberpunk.png", width: 1024, height: 1024 }],
  })),
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript((sessionUser) => {
    sessionStorage.setItem(
      "sc_auth_session_cache",
      JSON.stringify({ user: sessionUser }),
    );
    localStorage.setItem("starclouds-locale", "zh-CN");
  }, user);
  await page.route("**/api/v1/auth/session", (route) =>
    fulfillJson(route, { user }),
  );
  await page.route("**/api/v1/runtime-config", (route) =>
    fulfillJson(route, {
      routes: {},
      features: {},
      blacklist: { blocked: false },
    }),
  );
  await page.route("**/api/v1/tasks**", (route) =>
    fulfillJson(route, {
      items: historyTasks,
      hasMore: false,
    }),
  );
});

test("history toolbar is merged into a single unified row with interactive controls", async ({ page }) => {
  await page.goto("/history");

  const toolbar = page.locator(".ch-toolbar--history-unified");
  await expect(toolbar).toBeVisible();

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_light_crisp.png",
    clip: { x: 0, y: 70, width: 1280, height: 120 },
  });

  // 1. Status Dropdown on the left
  const statusMenu = toolbar.locator(".ch-menu--status");
  await expect(statusMenu).toBeVisible();
  const statusTrigger = statusMenu.locator(".ch-menu__trigger");
  await expect(statusTrigger).toContainText("全部状态");

  // Open status dropdown
  await statusTrigger.click();
  const statusPanel = statusMenu.locator(".ch-menu__panel");
  await expect(statusPanel).toBeVisible();
  await expect(statusPanel.getByText("已完成")).toBeVisible();
  await statusPanel.getByText("已完成").click();
  await expect(statusPanel).not.toBeVisible();
  await expect(statusTrigger).toContainText("已完成");

  // 2. Workbench Type Chips in the middle
  const typeChips = toolbar.locator(".ch-chips--history-types");
  await expect(typeChips).toBeVisible();
  await expect(typeChips.getByText("无限画布")).toBeVisible();
  await expect(typeChips.getByText("文生图")).toBeVisible();

  // 3. Bulk Bar & Layout Dropdown
  const bulkBar = toolbar.locator(".ch-bulk-bar");
  await expect(bulkBar).toBeVisible();
  await expect(bulkBar.getByRole("button", { name: "多选" })).toBeVisible();
  await expect(bulkBar.getByRole("button", { name: "清空全部" })).toBeVisible();

  const layoutMenu = toolbar.locator(".ch-menu--layout");
  await expect(layoutMenu).toBeVisible();
  const layoutTrigger = layoutMenu.locator(".ch-menu__trigger");
  await expect(layoutTrigger).toContainText("布局");

  // Open layout dropdown and select 6 列网格
  await layoutTrigger.click();
  const layoutPanel = layoutMenu.locator(".ch-menu__panel");
  await expect(layoutPanel).toBeVisible();
  await expect(layoutPanel.getByText("6 列网格")).toBeVisible();
  await layoutPanel.getByText("6 列网格").click();
  await expect(layoutPanel).not.toBeVisible();
  await expect(layoutTrigger).toContainText("6 列");

  // 4. Interactive Search at the far right
  const searchSlot = toolbar.locator(".ch-history-search-slot");
  await expect(searchSlot).toBeVisible();
  const searchContainer = searchSlot.locator(".ch-prompt-search");
  await expect(searchContainer).not.toHaveClass(/is-expanded/);

  // Click search icon to expand
  await searchContainer.locator(".ch-prompt-search__toggle").click();
  await expect(searchContainer).toHaveClass(/is-expanded/);

  // Type in search query
  const searchInput = searchContainer.locator("input[type='search']");
  await searchInput.fill("赛博朋克");
  await expect(searchInput).toHaveValue("赛博朋克");

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_search_expanded.png",
    clip: { x: 0, y: 70, width: 1280, height: 120 },
  });

  // Clear search
  const clearBtn = searchContainer.locator(".ch-prompt-search__clear");
  await expect(clearBtn).toBeVisible();
  await clearBtn.click();
  await expect(searchInput).toHaveValue("");

  // Click outside to collapse
  await page.mouse.click(20, 250);
  await expect(searchContainer).not.toHaveClass(/is-expanded/);

  // 5. Test Multi-select does NOT expand inline, but shows bottom floating bar
  const multiSelectBtn = bulkBar.getByRole("button", { name: "多选" });
  await multiSelectBtn.click();
  await expect(bulkBar.getByRole("button", { name: "退出多选" })).toBeVisible();

  // Top toolbar bulkBar MUST NOT contain inline "全选当前"
  await expect(bulkBar.getByRole("button", { name: "全选当前" })).not.toBeVisible();

  // Floating selection bar appears at bottom
  const floatingBar = page.locator(".ch-floating-bulk-bar");
  await expect(floatingBar).toBeVisible();
  await expect(floatingBar.locator(".ch-floating-bulk-bar__badge")).toContainText(/已选.*0.*项/);
  await expect(floatingBar.getByRole("button", { name: "全选当前" })).toBeVisible();
  await expect(floatingBar.getByRole("button", { name: "打包下载" })).toBeVisible();
  await expect(floatingBar.getByRole("button", { name: /删除/ })).toBeVisible();

  // Check initial unselected state
  const selectAllBtn = floatingBar.locator(".ch-floating-bulk-bar__btn--default");
  await expect(selectAllBtn).toContainText("全选当前");
  await expect(selectAllBtn).not.toHaveClass(/is-active/);

  // Click 全选当前 on floating bar -> becomes 取消全选 with is-active
  await selectAllBtn.click();
  await expect(floatingBar.locator(".ch-floating-bulk-bar__badge")).toContainText(/已选.*2.*项/);
  await expect(selectAllBtn).toContainText("取消全选");
  await expect(selectAllBtn).toHaveClass(/is-active/);

  // Click 取消全选 -> toggles back to 全选当前 without is-active
  await selectAllBtn.click();
  await expect(floatingBar.locator(".ch-floating-bulk-bar__badge")).toContainText(/已选.*0.*项/);
  await expect(selectAllBtn).toContainText("全选当前");
  await expect(selectAllBtn).not.toHaveClass(/is-active/);

  // Re-select all
  await selectAllBtn.click();
  await expect(selectAllBtn).toContainText("取消全选");

  // Exit multi-select via floating 退出 button
  await floatingBar.getByRole("button", { name: "退出" }).click();
  await expect(floatingBar).not.toBeVisible();
  await expect(bulkBar.getByRole("button", { name: "多选" })).toBeVisible();
});

test("history toolbar renders correctly in both light and dark mode", async ({ page }) => {
  await page.goto("/history");

  const toolbar = page.locator(".ch-toolbar--history-unified");
  await expect(toolbar).toBeVisible();

  // Light mode check
  const lightBg = await toolbar.locator(".ch-menu__trigger").first().evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });
  expect(lightBg).toBeTruthy();

  // Open layout menu to show dropdown in screenshot
  await toolbar.locator(".ch-menu--layout .ch-menu__trigger").click();
  await expect(toolbar.locator(".ch-menu--layout .ch-menu__panel")).toBeVisible();

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_layout_open.png",
    clip: { x: 0, y: 70, width: 1280, height: 260 },
  });

  // Close it
  await toolbar.locator(".ch-menu--layout .ch-menu__trigger").click();

  // Capture light mode floating selection bar
  await toolbar.locator(".ch-bulk-bar").getByRole("button", { name: "多选" }).click();
  const lightFloatingBar = page.locator(".ch-floating-bulk-bar");
  await expect(lightFloatingBar).toBeVisible();

  // 1. Unselected state screenshot (全选当前)
  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_floating_bulk_bar_light_unselected.png",
    clip: { x: 300, y: 630, width: 680, height: 85 },
  });

  // 2. All-selected state screenshot (取消全选)
  await lightFloatingBar.getByRole("button", { name: "全选当前" }).click();
  await expect(lightFloatingBar.getByRole("button", { name: "取消全选" })).toBeVisible();

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_floating_bulk_bar_light.png",
    clip: { x: 300, y: 630, width: 680, height: 85 },
  });

  await lightFloatingBar.getByRole("button", { name: "退出" }).click();

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_light.png",
    clip: { x: 0, y: 70, width: 1280, height: 120 },
  });

  // Switch to dark mode
  await page.evaluate(() => {
    document.documentElement.classList.add("color-scheme-dark");
    document.documentElement.setAttribute("data-color-scheme", "dark");
  });

  const darkBg = await toolbar.locator(".ch-menu__trigger").first().evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  });
  expect(darkBg).toBeTruthy();

  // Open layout menu in dark mode
  await toolbar.locator(".ch-menu--layout .ch-menu__trigger").click();
  await expect(toolbar.locator(".ch-menu--layout .ch-menu__panel")).toBeVisible();

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_layout_dark_open.png",
    clip: { x: 0, y: 70, width: 1280, height: 260 },
  });

  // Close it
  await toolbar.locator(".ch-menu--layout .ch-menu__trigger").click();

  // Expand search in dark mode to verify zero-overlap
  const darkSearchToggle = toolbar.locator(".ch-prompt-search__toggle");
  await darkSearchToggle.click();
  const darkSearchInput = toolbar.locator(".ch-prompt-search input[type='search']");
  await darkSearchInput.fill("赛博朋克");

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_search_dark_expanded.png",
    clip: { x: 0, y: 70, width: 1280, height: 120 },
  });

  // Clear & collapse
  await toolbar.locator(".ch-prompt-search__clear").click();
  await page.mouse.click(20, 250);

  // Capture dark mode floating selection bar
  await toolbar.locator(".ch-bulk-bar").getByRole("button", { name: "多选" }).click();
  const darkFloatingBar = page.locator(".ch-floating-bulk-bar");
  await expect(darkFloatingBar).toBeVisible();

  // 1. Unselected state screenshot (全选当前)
  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_floating_bulk_bar_dark_unselected.png",
    clip: { x: 300, y: 630, width: 680, height: 85 },
  });

  // 2. All-selected state screenshot (取消全选)
  await darkFloatingBar.getByRole("button", { name: "全选当前" }).click();
  await expect(darkFloatingBar.getByRole("button", { name: "取消全选" })).toBeVisible();

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_floating_bulk_bar_dark.png",
    clip: { x: 300, y: 630, width: 680, height: 85 },
  });

  await darkFloatingBar.getByRole("button", { name: "退出" }).click();

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_dark.png",
    clip: { x: 0, y: 70, width: 1280, height: 120 },
  });

  // Scroll down to verify toolbar when scrolling (stationary wait)
  await page.evaluate(() => window.scrollTo(0, 260));
  await page.waitForTimeout(450);

  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_dark_scrolled.png",
    clip: { x: 0, y: 70, width: 1280, height: 160 },
  });
});

test("history toolbar collapses on scroll down, and expands on scroll up and when stationary", async ({ page }) => {
  await page.goto("/history");

  const stickyBar = page.locator(".ch-sticky-bar");
  await expect(stickyBar).toBeVisible();
  await expect(stickyBar).not.toHaveClass(/is-collapsed/);

  // 1. Scroll down -> collapses
  await page.evaluate(() => window.scrollTo({ top: 400, behavior: "instant" }));
  await expect(stickyBar).toHaveClass(/is-collapsed/);

  // Capture screenshot while collapsed during scroll down
  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_collapsed_scrolldown.png",
    clip: { x: 0, y: 70, width: 1280, height: 160 },
  });

  // 2. Stationary -> after 350ms idle, it automatically expands!
  await page.waitForTimeout(450);
  await expect(stickyBar).not.toHaveClass(/is-collapsed/);

  // Capture screenshot while stationary scrolled down
  await page.screenshot({
    path: "/Users/ycc/.gemini/antigravity/brain/4d489dff-5d9a-4d27-901a-2789598aa997/history_toolbar_expanded_stationary.png",
    clip: { x: 0, y: 70, width: 1280, height: 160 },
  });

  // 3. Scroll down further -> collapses again
  await page.evaluate(() => window.scrollTo({ top: 700, behavior: "instant" }));
  await expect(stickyBar).toHaveClass(/is-collapsed/);

  // 4. Scroll UP -> immediately expands without waiting
  await page.evaluate(() => window.scrollTo({ top: 500, behavior: "instant" }));
  await expect(stickyBar).not.toHaveClass(/is-collapsed/);
});


