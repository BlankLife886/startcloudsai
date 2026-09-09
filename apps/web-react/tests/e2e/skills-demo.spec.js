import { expect, test } from "@playwright/test";
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
  walleven_guest_local_walleven_ai_wallpaper_studio_draft_v1: JSON.stringify({
    prompt: "保留当前访客的文生图草稿",
  }),
  "starclouds:skill-favorites:guest": JSON.stringify([
    "existing-official-skill",
  ]),
};

async function openIsolatedDemo(page) {
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
  // The shared baseline mocks every /api/** request. Observe writes separately
  // so an accidental task, checkout, or assistant handoff cannot pass silently.
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
  await expect(page.getByTestId("skills-demo")).toBeVisible();
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

test("Skill demo keeps a reusable method while changing examples and trying a new request", async ({
  page,
}) => {
  const businessWrites = await openIsolatedDemo(page);
  await expect(page.locator(".skills-demo__card")).toHaveCount(6);
  const method = page.getByRole("region", { name: "使用方法", exact: true });
  await expect(method).toBeVisible();
  await expect(method.getByRole("listitem")).toHaveCount(3);
  const originalMethod = await method.innerText();
  const examples = page.getByRole("button", { name: /^示例：/ });
  await expect(examples).toHaveCount(2);
  const exampleResult = page.getByRole("region", {
    name: "示例结果",
    exact: true,
  });
  await examples.first().click();
  await expect(exampleResult).toBeVisible();
  const firstExample = await exampleResult.innerText();
  expect(firstExample.length).toBeGreaterThan(0);
  await examples.nth(1).click();
  await expect(exampleResult).not.toHaveText(firstExample, { useInnerText: true });
  await expect(method).toHaveText(originalMethod, { useInnerText: true });

  await page
    .getByRole("button", { name: "试用商品主图策划", exact: true })
    .click();
  const request = page.getByRole("textbox", {
    name: "这次想完成什么",
    exact: true,
  });
  await page.getByRole("button", { name: "使用示例", exact: true }).click();
  expect((await request.inputValue()).length).toBeGreaterThan(0);
  const customRequest =
    "为一款燕麦色旅行收纳包策划主图，突出分区收纳和轻便。演示隔离验证。";
  await request.fill(customRequest);
  await page.getByRole("button", { name: "生成演示结果", exact: true }).click();
  const result = page.getByRole("region", { name: "演示结果", exact: true });
  await expect(result).toBeVisible();
  await expect(result).toContainText("燕麦色旅行收纳包");
  await expect(request).toBeVisible();
  await expect(request).toHaveValue(customRequest);
  await page.getByRole("button", { name: "方法与示例", exact: true }).click();
  await expect(method).toHaveText(originalMethod, { useInnerText: true });
  await expectOtherPagesUntouched(page, businessWrites);
});

test("Skill demo search and added skills stay within the current demo session", async ({
  page,
}) => {
  const businessWrites = await openIsolatedDemo(page);
  const search = page.getByRole("textbox", { name: "搜索 Skill" });
  await search.fill("商品主图策划");
  await expect(page.locator(".skills-demo__card")).toHaveCount(1);
  await page
    .getByRole("button", { name: "添加商品主图策划", exact: true })
    .click();
  await search.clear();
  const added = page.getByRole("button", { name: "已添加", exact: true });
  await added.click();
  await expect(added).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".skills-demo__card")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "移除商品主图策划", exact: true }),
  ).toBeVisible();
  await expectOtherPagesUntouched(page, businessWrites);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("skills-demo")).toBeVisible();
  await page.getByRole("button", { name: "已添加", exact: true }).click();
  await expect(page.locator(".skills-demo__card")).toHaveCount(0);
  await expectOtherPagesUntouched(page, businessWrites);
});

test("Skill demo fits a narrow screen and keeps results separate when switching skills", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const businessWrites = await openIsolatedDemo(page);
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect(
    page.getByRole("region", { name: "使用方法", exact: true }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "查看商品主图策划", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "使用方法", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "试用商品主图策划", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "这次想完成什么", exact: true })
    .fill("为薄荷绿随行杯设计主图，仅用于手机隔离演示。");
  await page.getByRole("button", { name: "生成演示结果", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "演示结果", exact: true }),
  ).toContainText("薄荷绿随行杯");
  await page.getByRole("button", { name: "返回技能库", exact: true }).click();
  await page
    .getByRole("button", { name: "查看生图提示词优化", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "演示结果", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "试用生图提示词优化", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "这次想完成什么", exact: true }),
  ).toHaveValue("");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.getByRole("button", { name: "返回技能库", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "查看商品主图策划", exact: true }),
  ).toBeVisible();
  await expectOtherPagesUntouched(page, businessWrites);
});
