import { expect, test } from "@playwright/test";
import { fulfillJson } from "./helpers/authMocks.js";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("starclouds-locale", "zh-CN");
  });
  await page.route("**/api/v1/auth/session", (route) =>
    fulfillJson(route, { user: null }),
  );
  await page.route("**/api/v1/runtime-config", (route) =>
    fulfillJson(route, {
      routes: {},
      features: {},
      blacklist: { blocked: false },
    }),
  );
});

test("applies the shared entrance lifecycle to standard pages", async ({ page }) => {
  await page.goto("/pricing");
  const main = page.locator(".main-content");
  await expect(main).toHaveAttribute("data-route-motion-mode", "page");
  await expect(main).toHaveAttribute("data-route-motion-state", "entered");
  await expect(main.locator(":scope > [data-route-motion-target]")).toHaveCount(1);

  await page.goto("/app-space");
  await expect(main).toHaveAttribute("data-route-motion-mode", "page");
  await expect(main).toHaveAttribute("data-route-motion-state", "entered");
});

test("uses fade-only motion for fixed workspaces without moving layout", async ({ page }) => {
  await page.goto("/tools/image-compress");
  const main = page.locator(".main-content");
  await expect(main).toHaveAttribute("data-route-motion-mode", "fade");
  await expect(main).toHaveAttribute("data-route-motion-state", "entered");
  const target = main.locator(":scope > [data-route-motion-target]");
  await expect(target).toHaveCount(1);
  await expect(target).toHaveCSS("transform", "none");
});

test("does not stack shared motion over a page with dedicated animation", async ({ page }) => {
  await page.route("**/api/v1/prompts/categories**", (route) =>
    fulfillJson(route, { items: [] }),
  );
  await page.route("**/api/v1/prompts?**", (route) =>
    fulfillJson(route, { items: [], nextCursor: null }),
  );
  await page.goto("/prompts");
  const main = page.locator(".main-content");
  await expect(main).toHaveAttribute("data-route-motion-mode", "custom");
  await expect(main).toHaveAttribute("data-route-motion-state", "custom");
  await expect(main.locator(":scope > [data-route-motion-target]")).toHaveCount(0);
});

test("honors reduced-motion preferences", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/pricing");
  const main = page.locator(".main-content");
  await expect(main).toHaveAttribute("data-route-motion-state", "entered");
  await expect(main.locator(":scope > [data-route-motion-target]")).toHaveCSS(
    "transform",
    "none",
  );
});

test("animates the standalone authentication page without moving its backdrop", async ({ page }) => {
  await page.route("**/api/v1/auth/providers", (route) =>
    fulfillJson(route, { email: true, verificationCode: true }),
  );
  await page.goto("/auth");
  const authPage = page.locator(".auth-page");
  await expect(authPage).toHaveAttribute("data-auth-motion-state", "entered");
  await expect(page.locator(".auth-backdrop")).toHaveCSS("transform", "none");
  await expect(page.locator("[data-auth-card]")).toHaveCSS("transform", "none");
});

test("switches cleanly between shared and dedicated motion during client navigation", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route("**/api/v1/prompts/categories**", (route) =>
    fulfillJson(route, { items: [] }),
  );
  await page.route("**/api/v1/prompts?**", (route) =>
    fulfillJson(route, { items: [], nextCursor: null }),
  );
  await page.goto("/pricing");
  const main = page.locator(".main-content");
  await expect(main).toHaveAttribute("data-route-motion-state", "entered");

  await page.locator(".main-nav > .nav-link").filter({ hasText: "提示词" }).click();
  await expect(page).toHaveURL(/\/prompts$/);
  await expect(main).toHaveAttribute("data-route-motion-mode", "custom");
  await expect(main.locator(":scope > [data-route-motion-target]")).toHaveCount(0);

  await page.locator(".main-nav > .nav-link").filter({ hasText: "历史记录" }).click();
  await expect(page).toHaveURL(/\/history$/);
  await expect(main).toHaveAttribute("data-route-motion-mode", "page");
  await expect(main).toHaveAttribute("data-route-motion-state", "entered");
  await expect(main.locator(":scope > [data-route-motion-target]")).toHaveCSS(
    "transform",
    "none",
  );
});
