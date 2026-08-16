import { expect, test } from "@playwright/test";
import { fulfillJson } from "./helpers/authMocks.js";

const user = {
  id: "prompt-library-user",
  email: "prompts@example.com",
  username: "提示词用户",
};

const prompts = [
  ["prompt-1", "电影感城市", "photography", 1600, 900, 23, 5],
  ["prompt-2", "竖版人物海报", "portrait", 900, 1600, 17, 3],
  ["prompt-3", "方形产品摄影", "product", 1200, 1200, 11, 2],
  ["prompt-4", "超宽场景概念", "scene", 1800, 700, 8, 1],
  ["prompt-5", "插画角色设定", "illustration", 1000, 1400, 6, 0],
  ["prompt-6", "无图排版灵感", "design", 0, 0, 4, 0],
].map(([id, title, category, coverWidth, coverHeight, useCount, favoriteCount], index) => ({
  id,
  title,
  prompt: `${title}，保留主体结构，使用第 ${index + 1} 套灯光与构图。`,
  taskType: "t2i",
  category,
  tags: [category, "精选"],
  coverUrl: coverWidth ? `/prompt-fixtures/${id}.svg` : "",
  coverWidth,
  coverHeight,
  useCount,
  favoriteCount,
  favorited: id === "prompt-2",
}));

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
  await page.route("**/api/v1/prompts/categories**", (route) =>
    fulfillJson(route, {
      items: [
        { id: "category-photography", key: "photography", label: "摄影", sort: 1 },
        { id: "category-product", key: "product", label: "产品", sort: 2 },
      ],
    }),
  );
  await page.route("**/prompt-fixtures/*.svg", async (route) => {
    const id = route.request().url().match(/(prompt-\d+)\.svg/)?.[1];
    const item = prompts.find((entry) => entry.id === id) || prompts[0];
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${item.coverWidth}" height="${item.coverHeight}" viewBox="0 0 ${item.coverWidth} ${item.coverHeight}"><rect width="100%" height="100%" fill="#dfe3ea"/><text x="40" y="80" font-size="36">${item.title}</text></svg>`,
    });
  });
});

test("matches the Vue populated masonry geometry and preview interactions", async ({ page }) => {
  const engagements = [];
  await page.route("**/api/v1/prompts/*/engagements", async (route) => {
    engagements.push(await route.request().postDataJSON());
    await fulfillJson(route, {});
  });
  await page.route("**/api/v1/prompts?**", (route) =>
    fulfillJson(route, { items: prompts, nextCursor: null, categoryCounts: { all: 6 } }),
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/prompts");
  await expect(page.locator(".ch-prompt-masonry__item")).toHaveCount(6);
  await expect(page.locator(".ch-page--prompts")).toHaveAttribute(
    "data-prompt-motion-state",
    "entered",
  );
  await expect(page.locator(".ch-prompt-masonry")).toHaveAttribute(
    "data-prompt-feed-state",
    "entered",
  );
  await expect(page.locator(".ch-prompt-card__image.is-loaded")).toHaveCount(5);
  await expect(page.getByText("电影感城市", { exact: true })).toBeVisible();

  const geometry = await page.locator(".ch-prompt-masonry__item").evaluateAll((cards) =>
    cards.map((card) => {
      const media = card.querySelector(".ch-prompt-card__media");
      const cardRect = card.getBoundingClientRect();
      const mediaRect = media.getBoundingClientRect();
      return {
        left: Math.round(cardRect.left),
        top: Math.round(cardRect.top),
        width: Math.round(cardRect.width),
        height: Math.round(cardRect.height),
        mediaHeight: Math.round(mediaRect.height),
      };
    }),
  );
  expect(new Set(geometry.map((item) => item.left)).size).toBe(5);
  expect(geometry[0].mediaHeight).toBeLessThan(geometry[2].mediaHeight);
  expect(geometry[1].mediaHeight).toBeGreaterThan(geometry[2].mediaHeight);
  for (let index = 0; index < geometry.length; index += 1) {
    for (let other = index + 1; other < geometry.length; other += 1) {
      const a = geometry[index];
      const b = geometry[other];
      const overlap =
        a.left < b.left + b.width &&
        a.left + a.width > b.left &&
        a.top < b.top + b.height &&
        a.top + a.height > b.top;
      expect(overlap).toBe(false);
    }
  }

  await page.locator(".ch-prompt-card__media").first().click();
  await expect(page.getByRole("dialog", { name: "提示词详情" })).toBeVisible();
  await expect(page.locator(".ch-preview-layer")).toHaveAttribute("data-dialog-motion-state", "entered");
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.getByRole("button", { name: "上一条" })).toBeDisabled();
  await page.getByRole("button", { name: "下一条" }).click();
  const dialog = page.getByRole("dialog", { name: "提示词详情" });
  await expect(dialog.getByRole("heading", { name: "竖版人物海报" })).toBeVisible();
  await expect(dialog.getByText("17", { exact: true })).toBeVisible();
  await expect(dialog.getByText("3", { exact: true })).toBeVisible();

  await dialog.getByRole("button", { name: "已收藏" }).click();
  await expect(dialog.getByRole("button", { name: "收藏" })).toBeVisible();
  expect(engagements).toContainEqual({ action: "favorite", active: false });

  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("heading", { name: "方形产品摄影" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".ch-preview-layer")).toHaveAttribute("data-dialog-motion-state", "exiting");
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "提示词详情" })).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  await page.getByPlaceholder("搜索标题、提示词或标签").fill("排版");
  await expect(page.locator(".ch-prompt-masonry__item")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "无图排版灵感" })).toBeVisible();
});

test("preserves scope filters, mobile columns, and prompt handoff", async ({ page }) => {
  const promptRequests = [];
  await page.route("**/api/v1/prompts/*/engagements", (route) => fulfillJson(route, {}));
  await page.route("**/api/v1/prompts?**", (route) => {
    const url = new URL(route.request().url());
    promptRequests.push(Object.fromEntries(url.searchParams));
    return fulfillJson(route, {
      items: url.searchParams.get("scope") === "today" ? prompts.slice(0, 2) : prompts,
      nextCursor: null,
      categoryCounts: { all: 6 },
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/prompts");
  await expect(page.locator(".ch-prompt-masonry__item").first()).toBeVisible();
  expect(await page.locator(".ch-prompt-masonry").evaluate((element) => element.scrollHeight)).toBeGreaterThan(2400);
  const mobileLefts = await page.locator(".ch-prompt-masonry__item").evaluateAll((cards) =>
    cards.map((card) => Math.round(card.getBoundingClientRect().left)),
  );
  expect(new Set(mobileLefts).size).toBe(1);

  await page.getByRole("button", { name: "今日最新" }).click();
  await expect(page.locator(".ch-prompt-masonry__item")).toHaveCount(2);
  await expect(page.locator(".ch-prompt-masonry")).toHaveAttribute(
    "data-prompt-feed-state",
    "entered",
  );
  await expect.poll(() => promptRequests.some((request) => request.scope === "today" && !request.category)).toBe(true);

  await page.getByRole("button", { name: "摄影" }).click();
  await expect.poll(() => promptRequests.some((request) => request.category === "photography" && !request.scope)).toBe(true);

  await page.locator(".ch-prompt-masonry__item").first().getByRole("button", { name: "去做图" }).click();
  await expect(page).toHaveURL(/\/text-to-image$/);
  await expect(page.getByRole("textbox", { name: "创作描述" })).toHaveValue(/电影感城市/);
});

test("appends the next cursor page near the masonry end", async ({ page }) => {
  const requests = [];
  const firstPage = Array.from({ length: 18 }, (_, index) => ({
    ...prompts[index % prompts.length],
    id: `page-one-${index + 1}`,
    title: `第一页灵感 ${index + 1}`,
    coverUrl: "",
  }));
  const secondPage = [
    {
      ...prompts[0],
      id: "page-two-1",
      title: "第二页新增灵感",
      coverUrl: "",
    },
  ];
  await page.route("**/api/v1/prompts?**", (route) => {
    const url = new URL(route.request().url());
    const cursor = url.searchParams.get("cursor") || "";
    requests.push(cursor);
    return fulfillJson(route, {
      items: cursor === "page-2" ? secondPage : firstPage,
      nextCursor: cursor ? null : "page-2",
      categoryCounts: { all: 19 },
    });
  });
  await page.route("**/api/v1/prompts/*/engagements", (route) => fulfillJson(route, {}));

  await page.goto("/prompts");
  await expect(page.getByRole("heading", { name: "第一页灵感 1", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect(page.getByRole("heading", { name: "第二页新增灵感" })).toBeVisible();
  expect(requests.filter((cursor) => cursor === "page-2")).toHaveLength(1);
});
