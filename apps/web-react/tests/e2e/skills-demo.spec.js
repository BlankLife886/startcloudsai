import { expect, test } from "@playwright/test";
import { fulfillJson } from "./helpers/authMocks.js";
import { installVisualBaseline } from "./helpers/visualBaseline.js";

const otherPageState = {
  "starclouds:pending-prompt": JSON.stringify({
    version: 2,
    taskType: "assistant",
    prompt: "保留原有助手草稿",
    config: { mode: "chat" },
    at: 1786420800000,
  }),
  walleven_ai_wallpaper_studio_draft_v1: JSON.stringify({
    prompt: "保留原有文生图草稿",
  }),
};

const library = {
  items: [
    {
      id: "official-soft-light",
      name: "柔光人像",
      description: "柔和顶光，背景干净",
      instruction: "使用柔和顶光，背景纯净，主体居中。",
      taskTypes: [],
      tags: ["人像"],
      official: true,
      active: true,
    },
    {
      id: "mine-product",
      name: "商品主图",
      description: "突出材质与分区",
      instruction: "突出材质纹理，主体居中，留出标题区。",
      taskTypes: ["t2i", "ecommerce_design"],
      tags: [],
      official: false,
      active: true,
    },
  ],
  bindings: { global: ["official-soft-light"] },
  maxPerScope: 5,
};

async function openSkillsPage(page, { user = null, skills = library } = {}) {
  const businessWrites = [];
  await installVisualBaseline(page);
  await page.addInitScript((state) => {
    for (const [key, value] of Object.entries(state))
      localStorage.setItem(key, value);
    sessionStorage.setItem(
      "starclouds:pending-prompt",
      state["starclouds:pending-prompt"],
    );
  }, otherPageState);
  await page.route("**/api/v1/auth/session", (route) =>
    fulfillJson(route, { user }),
  );
  await page.route("**/api/v1/me/image-skills**", (route) =>
    fulfillJson(route, skills),
  );
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      !path.startsWith("/api/") ||
      ["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      return;
    if (/\/(?:logs?|telemetry|analytics|user-actions)(?:\/|$)/.test(path))
      return;
    businessWrites.push(`${request.method()} ${path}`);
  });
  await page.goto("/skills", { waitUntil: "domcontentloaded" });
  return businessWrites;
}

async function expectOtherPagesUntouched(page, businessWrites) {
  await expect(page).toHaveURL(/\/skills$/);
  const state = await page.evaluate(
    (keys) => ({
      local: Object.fromEntries(
        keys.map((key) => [key, localStorage.getItem(key)]),
      ),
      pendingSession: sessionStorage.getItem("starclouds:pending-prompt"),
    }),
    Object.keys(otherPageState),
  );
  expect(state.local).toEqual(otherPageState);
  expect(state.pendingSession).toBe(
    otherPageState["starclouds:pending-prompt"],
  );
  expect(businessWrites).toEqual([]);
}

test("guests can open Skill 中心 without touching other drafts", async ({
  page,
}) => {
  const businessWrites = await openSkillsPage(page);
  await expect(page.getByTestId("skills-page")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Skill 中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "登录后使用" })).toBeVisible();
  await expectOtherPagesUntouched(page, businessWrites);
});

test("signed-in users browse the library and the binding board", async ({
  page,
}) => {
  const businessWrites = await openSkillsPage(page, {
    user: { id: "skill-user", username: "创作者", email: "skill@example.com" },
  });
  await expect(page.getByTestId("skills-page")).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 柔光人像" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "柔光人像" })).toBeVisible();
  await expect(page.getByText("已对所有页面生效", { exact: false })).toBeVisible();

  await page.getByRole("tab", { name: /装载配置/ }).click();
  await expect(page.getByRole("heading", { name: "全局装载" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "文生图" })).toBeVisible();
  await expect(page.getByText("跟随全局").first()).toBeVisible();
  await expectOtherPagesUntouched(page, businessWrites);
});

test("Skill 中心 fits a narrow screen and keeps the list and detail stacked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const businessWrites = await openSkillsPage(page, {
    user: { id: "skill-user", username: "创作者" },
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "查看 商品主图" }).click();
  await expect(page.getByRole("heading", { name: "商品主图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expectOtherPagesUntouched(page, businessWrites);
});
