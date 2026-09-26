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

const localSkill = {
  id: "local-soft-portrait",
  slug: "local-soft-portrait",
  name: "本地柔光",
  description: "仅此浏览器的柔光人像",
  instruction: "使用柔和自然光，主体清晰。",
  tags: ["人像"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T08:00:00.000Z",
};

const remoteLibrary = {
  items: [
    {
      id: "official-soft-light",
      slug: "soft-light",
      name: "柔光人像",
      description: "柔和顶光，背景干净",
      instruction: "使用柔和顶光，背景纯净，主体居中。",
      tags: ["人像"],
      official: true,
      updatedAt: "2026-03-01T00:00:00.000Z",
    },
    {
      id: "mine-product",
      slug: "product-hero",
      name: "商品主图",
      description: "突出材质与分区",
      instruction: "突出材质纹理，主体居中，留出标题区。",
      tags: ["电商"],
      official: false,
      updatedAt: "2026-03-02T00:00:00.000Z",
    },
  ],
  maxOwned: 5,
};

async function openSkillsPage(page, { user = null } = {}) {
  const businessWrites = [];
  await installVisualBaseline(page);
  await page.addInitScript(
    (payload) => {
      for (const [key, value] of Object.entries(payload.other)) {
        localStorage.setItem(key, value);
      }
      sessionStorage.setItem(
        "starclouds:pending-prompt",
        payload.other["starclouds:pending-prompt"],
      );
      localStorage.setItem(
        "starclouds:local-skills:v1",
        JSON.stringify(payload.localSkills),
      );
    },
    { other: otherPageState, localSkills: [localSkill] },
  );
  await page.route("**/api/v1/auth/session", (route) =>
    fulfillJson(route, { user }),
  );
  await page.route("**/api/v1/me/image-skills**", (route) =>
    fulfillJson(route, remoteLibrary),
  );
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (
      !path.startsWith("/api/") ||
      ["GET", "HEAD", "OPTIONS"].includes(request.method())
    ) {
      return;
    }
    if (/\/(?:logs?|telemetry|analytics|user-actions)(?:\/|$)/.test(path)) {
      return;
    }
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

test("guests can browse local skills in 技能库 without touching other drafts", async ({
  page,
}) => {
  const businessWrites = await openSkillsPage(page);
  await expect(page.getByTestId("skills-page")).toBeVisible();
  await expect(page.getByRole("heading", { name: "技能库" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 本地柔光" })).toBeVisible();
  // 未登录：云端为空，配额卡提示登录。
  await expect(page.getByRole("button", { name: /^云端\s*0\/5$/ })).toBeVisible();
  await page.getByRole("button", { name: "新建技能" }).click();
  await expect(page.getByRole("button", { name: /云端（0\/5）/ })).toBeDisabled();
  await page.getByRole("button", { name: "关闭" }).click();
  // 详情里的「移到云端」未登录时可点（会弹登录），不发业务写请求。
  await page.getByRole("button", { name: "查看 本地柔光" }).click();
  await expect(page.getByRole("button", { name: "移到云端" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await expectOtherPagesUntouched(page, businessWrites);
});

test("signed-in users see local, cloud and official cards with cloud quota", async ({
  page,
}) => {
  const businessWrites = await openSkillsPage(page, {
    user: { id: "skill-user", username: "创作者", email: "skill@example.com" },
  });
  await expect(page.getByTestId("skills-page")).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 本地柔光" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 商品主图" })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 柔光人像" })).toBeVisible();
  await expect(page.locator(".skill-card")).toHaveCount(3);

  await page.getByRole("navigation", { name: "存储位置" }).getByRole("button", { name: /^云端/ }).click();
  await expect(page.getByRole("button", { name: /^云端\s*1\/5$/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".skill-card")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "查看 商品主图" })).toBeVisible();
  await expectOtherPagesUntouched(page, businessWrites);
});

test("skill detail shows @ mention and export", async ({ page }) => {
  const businessWrites = await openSkillsPage(page, {
    user: { id: "skill-user", username: "创作者" },
  });
  await page.getByRole("button", { name: "查看 柔光人像" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "柔光人像", level: 2 })).toBeVisible();
  await expect(dialog.getByText("@柔光人像")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "导出 SKILL.md" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "复制到本地" })).toBeVisible();
  await expectOtherPagesUntouched(page, businessWrites);
});

test("技能库 fits a 390-wide screen without horizontal scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const businessWrites = await openSkillsPage(page, {
    user: { id: "skill-user", username: "创作者" },
  });
  await expect(page.getByTestId("skills-page")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "查看 商品主图" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "商品主图", level: 2 })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expectOtherPagesUntouched(page, businessWrites);
});
