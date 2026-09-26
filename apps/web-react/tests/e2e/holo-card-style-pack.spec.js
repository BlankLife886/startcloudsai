import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { CARD_SKINS } from '../../src/features/holo-card/cardSkins.js';
import { setup, subjectPath, picture, readyCard, stageState, exportCard, closeEditor, rawSubject, pixelsEqual, noAI, artifact } from './helpers/holoTemplateHarness.js';

test.use({ video: 'off' });
const PACK_IDS = ['dopamine', 'pokemon', 'arknights'];
const NEW_SKINS = CARD_SKINS.filter(skin => PACK_IDS.includes(skin.id));

async function library(page) {
  const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true });
  if (!await editor.isVisible()) await page.getByRole('button', { name: '卡片皮肤', exact: true }).click();
  else await editor.getByRole('tab', { name: '皮肤', exact: true }).click();
  return page.locator('#holo-panel-skins');
}
async function choose(page, skin) {
  const panel = await library(page);
  await panel.getByRole('button', { name: `应用${skin.title}皮肤`, exact: true }).click();
  await expect.poll(async () => {
    const state = await stageState(page); return state?.ready && state?.designReady && state?.skinId === skin.id;
  }).toBe(true);
  await readyCard(page);
  return panel;
}
async function start(page, viewport) {
  const calls = await setup(page, { signedIn: false, ...(viewport ? { viewport } : {}) });
  const failedAssets = [];
  page.on('response', response => { if (response.url().includes('/holo-skins/v3/') && response.status() >= 400) failedAssets.push(response.url()); });
  const subject = await readFile(subjectPath);
  await page.goto('/holo-card', { waitUntil: 'domcontentloaded' });
  await picture(page, 'my-original-character.png', subject); await readyCard(page);
  await page.getByRole('button', { name: '静止预览', exact: true }).click();
  return { calls, subject, failedAssets };
}

test('the three requested styles lead the gallery and export complete distinct front/back designs', async ({ page }, testInfo) => {
  test.setTimeout(100_000);
  const { calls, subject, failedAssets } = await start(page);
  const panel = await library(page);
  const galleryIds = await panel.locator('[data-card-skin]').evaluateAll(nodes => nodes.map(node => node.dataset.cardSkin));
  expect(galleryIds.slice(0, 2)).toEqual(['dopamine', 'pokemon']);
  expect(galleryIds.filter(id => PACK_IDS.includes(id))).toEqual(PACK_IDS);
  const fronts = [], backs = [];
  for (const skin of NEW_SKINS) {
    await choose(page, skin); await closeEditor(page); await readyCard(page);
    const state = await stageState(page);
    expect(state.hasFrame).toBe(true); expect(state.hasBack).toBe(true); expect(state.paused).toBe(true);
    expect(state.sourceDimensions.background).toEqual({ width: 1024, height: 1536 });
    expect(state.framing.displayBounds.height).toBeGreaterThan(.58);
    const front = await exportCard(page, '导出 PNG'); fronts.push({ title: skin.title, image: front.toString('base64') });
    await artifact(testInfo, `${skin.id}-front.png`, front);
    await page.getByRole('button', { name: '翻转卡片', exact: true }).click();
    await expect.poll(async () => (await stageState(page))?.pose.flip).toBe(Math.PI);
    const back = await exportCard(page, '导出 PNG'); backs.push({ title: skin.title, image: back.toString('base64') });
    await artifact(testInfo, `${skin.id}-back.png`, back);
    expect((await pixelsEqual(page, front, back)).changedPixels).toBeGreaterThan(500_000);
    await page.getByRole('button', { name: '查看正面', exact: true }).click();
    await expect.poll(async () => (await stageState(page))?.pose.flip).toBe(0);
  }
  for (let i = 0; i < fronts.length; i++) for (let j = i + 1; j < fronts.length; j++) {
    expect((await pixelsEqual(page, Buffer.from(fronts[i].image, 'base64'), Buffer.from(fronts[j].image, 'base64'))).changedPixels).toBeGreaterThan(600_000);
  }
  for (const [name, images] of [['new-style-fronts.png', fronts], ['new-style-backs.png', backs]]) {
    const encoded = await page.evaluate(async images => {
      const canvas = document.createElement('canvas'); canvas.width = 1152; canvas.height = 704;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#10131a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#f3edf8'; ctx.font = '500 24px "PingFang SC",sans-serif'; ctx.fillText('三种风格，你的专属收藏。', 32, 45);
      for (const [index, item] of images.entries()) {
        const image = new Image(); image.src = `data:image/png;base64,${item.image}`; await image.decode();
        ctx.drawImage(image, 24 + index * 384, 90, 336, 504);
        ctx.font = '500 23px "PingFang SC",sans-serif'; ctx.fillStyle = '#ece3f4'; ctx.fillText(item.title, 45 + index * 384, 644);
      }
      return canvas.toDataURL('image/png').split(',')[1];
    }, images);
    await artifact(testInfo, name, Buffer.from(encoded, 'base64'));
  }
  expect(await rawSubject(page)).toEqual(subject);
  expect(failedAssets).toEqual([]); noAI(calls);
});

test('new parts mix with existing templates and edited words survive full outfit changes', async ({ page }) => {
  test.setTimeout(55_000);
  const { calls, subject } = await start(page);
  let panel = await choose(page, NEW_SKINS[0]);
  await panel.locator('summary').filter({ hasText: '卡面文字' }).click();
  await panel.getByRole('textbox', { name: '卡片名称', exact: true }).fill('我的潮酷伙伴');
  await panel.getByRole('textbox', { name: '技能名称', exact: true }).fill('独一无二');
  await panel.getByRole('textbox', { name: '编号', exact: true }).fill('RI-208');
  for (const skin of NEW_SKINS.slice(1)) {
    panel = await choose(page, skin);
    await expect(panel.getByRole('textbox', { name: '卡片名称', exact: true })).toHaveValue('我的潮酷伙伴');
    await expect(panel.getByRole('textbox', { name: '技能名称', exact: true })).toHaveValue('独一无二');
    await expect(panel.getByRole('textbox', { name: '编号', exact: true })).toHaveValue('RI-208');
  }
  await panel.locator('summary').filter({ hasText: '自由混搭' }).click();
  await panel.getByRole('combobox', { name: '卡框', exact: true }).selectOption('pokemon');
  await panel.getByRole('combobox', { name: '背景', exact: true }).selectOption('dopamine');
  await panel.getByRole('combobox', { name: '卡背', exact: true }).selectOption('astral');
  await readyCard(page);
  expect((await stageState(page)).design).toEqual({ background: 'dopamine', frame: 'pokemon', layout: 'arknights', effects: 'arknights', back: 'astral' });
  await closeEditor(page); await exportCard(page, '导出 PNG');
  expect(await rawSubject(page)).toEqual(subject); noAI(calls);
});

test('all three featured styles are reachable and saveable on a narrow phone', async ({ page }, testInfo) => {
  test.setTimeout(65_000);
  const { calls, failedAssets } = await start(page, { width: 390, height: 844 });
  for (const skin of NEW_SKINS) {
    const panel = await choose(page, skin);
    await expect(panel.locator(`[data-card-skin="${skin.id}"]`)).toBeInViewport();
    const bounds = await panel.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  }
  await artifact(testInfo, 'mobile-new-styles.png', await page.screenshot());
  await closeEditor(page); await readyCard(page);
  await expect(page.getByRole('button', { name: '导出同款闪卡', exact: true })).toBeInViewport();
  await exportCard(page, '导出 PNG'); expect(failedAssets).toEqual([]); noAI(calls);
});
