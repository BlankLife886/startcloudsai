import { expect, test } from '@playwright/test';
import { fulfillJson } from './helpers/authMocks.js';

const user = { id: 'test-canvas-user', email: 'canvas-test@example.com', username: '测试用户' };

async function mockCanvasEnv(page) {
  await page.addInitScript(() => {
    localStorage.setItem('starclouds-locale', 'zh-CN');
    localStorage.removeItem('infinite-canvas:canvas_store');
    indexedDB.deleteDatabase('infinite-canvas');
  });

  await page.route('**/api/v1/auth/session', (route) => fulfillJson(route, { user }));
  await page.route('**/api/v1/runtime-config', (route) => fulfillJson(route, {
    routes: {},
    features: {
      'ai.infiniteCanvas': {
        enabled: true,
        config: {
          imageModels: [{ id: 'canvas-image-model', label: '画布生图模型', default: true, pricePoints: 2, standardPricePoints: 3 }],
          textModels: [{ id: 'canvas-text-model', label: '画布文本模型', default: true, pricePoints: 1, standardPricePoints: 1 }],
        },
      },
    },
    aiModelCatalog: { providers: [], models: [], publicModels: [], featurePublicModels: [] },
    blacklist: { blocked: false },
  }));

  await page.route('**/api/v1/canvas-projects', (route) => fulfillJson(route, { items: [] }));
}

test.describe('Infinite Canvas Redesign & Workflow Showcase Shelf', () => {
  test('renders studio header, showcase shelf, and my projects correctly', async ({ page }) => {
    await mockCanvasEnv(page);
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' });

    // 1. Studio Header
    await expect(page.getByRole('heading', { name: '无限画布', exact: true })).toBeVisible();
    await expect(page.getByText('自由连线工作流 · 多模态生成')).toBeVisible();
    await expect(page.getByRole('button', { name: '新建画布', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /模板库/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入画布' })).toBeVisible();

    // 2. Featured Showcase Shelf
    await expect(page.getByRole('heading', { name: '精选案例工作流' })).toBeVisible();
    await expect(page.getByText('工程级管线 · 一键载入')).toBeVisible();

    // 4 Showcase Cards visible by default
    const cards = page.locator('.template-card');
    await expect(cards).toHaveCount(4);

    // Each card has mini pipeline flow nodes and SVG flow-lines
    const firstCard = cards.first();
    await expect(firstCard.locator('.pipeline-flow-line')).toHaveCount(2);
    await expect(firstCard.getByText('点击一键载入')).toBeVisible();
    await expect(firstCard.getByText(/载入模板/)).toBeVisible();

    // 3. My Projects Section
    await expect(page.getByRole('heading', { name: '最近项目' })).toBeVisible();
    await expect(page.locator('.canvas-project-tile')).toBeVisible();
  });

  test('switches category tabs and updates showcased templates', async ({ page }) => {
    await mockCanvasEnv(page);
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' });

    // Switch to 行业电商 (17)
    await page.getByRole('button', { name: '行业电商 (17)' }).click();
    await expect(page.getByText('参考模板复刻生产线')).toBeVisible();
    await expect(page.getByText('美妆护肤').first()).toBeVisible();

    // Switch to 人物模特 (5)
    await page.getByRole('button', { name: '人物模特 (5)' }).click();
    await expect(page.getByText('美妆人像').first()).toBeVisible();

    // Switch to 卡牌设计 (5)
    await page.getByRole('button', { name: '卡牌设计 (5)' }).click();
    await expect(page.getByText('奇幻卡牌').first()).toBeVisible();
  });

  test('clicking "全部 43 款" opens the full template library dialog', async ({ page }) => {
    await mockCanvasEnv(page);
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: '全部 43 款' }).click();

    // Modal dialog should open
    await expect(page.locator('.ant-modal')).toBeVisible();
    await expect(page.getByText('生产工作流模板')).toBeVisible();
    await expect(page.getByText('选择一条可重复执行的生产线')).toBeVisible();
    await expect(page.getByPlaceholder('搜索行业、平台或交付物')).toBeVisible();
  });

  test('supports dark mode and light mode seamlessly', async ({ page }) => {
    await mockCanvasEnv(page);
    await page.goto('/canvas', { waitUntil: 'domcontentloaded' });

    // Dark Mode
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await expect(page.locator('.canvas-workflow-shelf')).toBeVisible();
    const darkStyle = await page.locator('.template-card').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, bgImage: s.backgroundImage };
    });
    expect(darkStyle.bgImage.includes('gradient') || darkStyle.bg !== 'rgb(255, 255, 255)').toBe(true);

    // Light Mode
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await expect(page.locator('.canvas-workflow-shelf')).toBeVisible();
    const lightStyle = await page.locator('.template-card').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return { bg: s.backgroundColor, bgImage: s.backgroundImage };
    });
    expect(lightStyle.bg).toBe('rgb(255, 255, 255)');
  });
});
