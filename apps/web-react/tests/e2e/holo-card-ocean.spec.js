import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';
import { getCardSkin } from '../../src/features/holo-card/cardSkins.js';
import { setup, subjectPath, picture, readyCard, stageState, exportCard, closeEditor,
  rawSubject, pixelsEqual, noAI, artifact, hash } from './helpers/holoTemplateHarness.js';

test.use({ video: 'off' });
const PORTRAIT_CORE = { x: .2, y: .15, width: .6, height: .55 };

async function library(page) {
  const editor = page.getByRole('dialog', { name: '闪卡编辑', exact: true });
  if (!await editor.isVisible()) await page.getByRole('button', { name: '卡片皮肤', exact: true }).click();
  else await editor.getByRole('tab', { name: '皮肤', exact: true }).click();
  return page.locator('#holo-panel-skins');
}

async function choose(page, id) {
  const panel = await library(page), skin = getCardSkin(id);
  await panel.getByRole('button', { name: `应用${skin.title}皮肤`, exact: true }).click();
  await expect.poll(async () => {
    const state = await stageState(page);
    return state?.ready && state?.designReady && state?.skinId === id && state?.requestedSkinId === id;
  }).toBe(true);
  await readyCard(page);
  return panel;
}

async function fold(panel, name) {
  const details = panel.locator('details').filter({ has: panel.page().locator('summary').filter({ hasText: name }) });
  if (!await details.evaluate(node => node.open)) await details.locator('summary').click();
  return details;
}

async function face(page, back) {
  const stage = page.locator('.holo-card-stage');
  if (await stage.getAttribute('data-holo-face') !== (back ? 'back' : 'front'))
    await page.getByRole('button', { name: back ? '翻转卡片' : '查看正面', exact: true }).click();
  await expect.poll(async () => (await stageState(page))?.pose.flip).toBe(back ? Math.PI : 0);
  await readyCard(page);
}

async function start(page) {
  const calls = await setup(page, { signedIn: false }), failedAssets = [], loadedAssets = new Set();
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (!path.startsWith('/holo-skins/v4/')) return;
    if (response.status() >= 400) failedAssets.push({ path, status: response.status() });
    else loadedAssets.add(path);
  });
  const subject = await readFile(subjectPath);
  await page.goto('/holo-card', { waitUntil: 'domcontentloaded' });
  await picture(page, 'my-original-character.png', subject); await readyCard(page);
  await page.getByRole('button', { name: '静止预览', exact: true }).click();
  return { calls, subject, failedAssets, loadedAssets };
}

async function stagePng(page) {
  await readyCard(page);
  return Buffer.from(await page.locator('.holo-card-stage canvas').evaluate(canvas => canvas.toDataURL('image/png').split(',')[1]), 'base64');
}

async function textPng(page) {
  return Buffer.from(await page.evaluate(async () => {
    const blob = await window.__templateTextPng();
    return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob); });
  }), 'base64');
}

async function frontBack(page, front, back) {
  return Buffer.from(await page.evaluate(async inputs => {
    const canvas = document.createElement('canvas'); canvas.width = 1344; canvas.height = 1120;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#081b2a'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e6f6ff'; ctx.font = '500 30px "PingFang SC",sans-serif'; ctx.fillText('海洋之心', 36, 51);
    for (const [i, data] of inputs.entries()) {
      const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
      ctx.font = '20px "PingFang SC",sans-serif'; ctx.fillStyle = '#9cbccd'; ctx.fillText(i ? '卡背' : '卡面', 36 + i * 672, 93);
      ctx.drawImage(image, 36 + i * 672, 124, 600, 900);
    }
    return canvas.toDataURL('image/png').split(',')[1];
  }, [front.toString('base64'), back.toString('base64')]), 'base64');
}

async function layerPixels(page, png, rect, inset = 0) {
  return page.evaluate(async ({ encoded, rect, inset }) => {
    const image = new Image(); image.src = `data:image/png;base64,${encoded}`; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const tile = 32, tileColumns = Math.ceil(canvas.width / tile), coverage = new Uint16Array(tileColumns * Math.ceil(canvas.height / tile));
    const result = { width: canvas.width, height: canvas.height, clear: 0, soft: 0, visible: 0, windowPixels: 0, windowVisible: 0, denseTiles: 0,
      bounds: { left: canvas.width, right: -1, top: canvas.height, bottom: -1 } };
    const left = Math.ceil(rect.x * canvas.width + inset), top = Math.ceil(rect.y * canvas.height + inset);
    const right = Math.floor((rect.x + rect.width) * canvas.width - inset), bottom = Math.floor((rect.y + rect.height) * canvas.height - inset);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const alpha = data[(y * canvas.width + x) * 4 + 3];
      if (alpha === 0) result.clear++;
      if (alpha > 0 && alpha < 255) result.soft++;
      if (alpha > 0) {
        result.visible++; result.bounds.left = Math.min(result.bounds.left, x); result.bounds.right = Math.max(result.bounds.right, x);
        result.bounds.top = Math.min(result.bounds.top, y); result.bounds.bottom = Math.max(result.bounds.bottom, y);
      }
      if (alpha >= 64) coverage[Math.floor(y / tile) * tileColumns + Math.floor(x / tile)]++;
      if (x >= left && x < right && y >= top && y < bottom) {
        result.windowPixels++; if (alpha > 0) result.windowVisible++;
      }
    }
    result.denseTiles = [...coverage].filter(count => count >= tile * tile * .85).length;
    return result;
  }, { encoded: png.toString('base64'), rect, inset });
}

async function currentOceanFrame(page) {
  return Buffer.from(await page.evaluate(async () => {
    const { createCardSkinCanvases } = await import('/src/features/holo-card/card-skin-art.js');
    const plates = createCardSkinCanvases('ocean', { width: 1024, height: 1536 });
    const encoded = plates.frame.toDataURL('image/png').split(',')[1];
    Object.values(plates).forEach(canvas => { canvas.width = 1; canvas.height = 1; });
    return encoded;
  }), 'base64');
}

test('ocean portrait exports full front and back while existing skin state remains intact', async ({ page }, testInfo) => {
  test.setTimeout(110_000);
  const { calls, subject, failedAssets, loadedAssets } = await start(page);
  const panel = await library(page);
  expect(await panel.locator('[data-card-skin]').evaluateAll(nodes => nodes.slice(0, 3).map(node => node.dataset.cardSkin)))
    .toEqual(['dopamine', 'pokemon', 'ocean']);
  await choose(page, 'ocean'); await closeEditor(page);
  const state = await stageState(page);
  expect(state.hasFrame).toBe(true); expect(state.hasBack).toBe(true); expect(state.paused).toBe(true);
  expect(state.framing.strategy).toBe('native');
  expect(state.framing.displayBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect(state.framing.uvScale).toEqual({ x: 1, y: 1 });
  expect(state.framing.uvOffset).toEqual({ x: 0, y: 0 });
  for (const [key, value] of Object.entries(getCardSkin('ocean').artworkRect)) expect(state.framing.artworkRect[key]).toBeCloseTo(value, 6);
  const front = await exportCard(page, '导出 PNG');
  await artifact(testInfo, 'ocean-front.png', front);
  console.log(JSON.stringify({ image: testInfo.outputPath('ocean-front.png'), displayBounds: state.framing.displayBounds }));
  await face(page, true);
  const back = await exportCard(page, '导出 PNG');
  await artifact(testInfo, 'ocean-back.png', back);
  await artifact(testInfo, 'ocean-front-back.png', await frontBack(page, front, back));
  await artifact(testInfo, 'ocean-framing.json', JSON.stringify(state.framing, null, 2), 'application/json');
  console.log(JSON.stringify({ back: testInfo.outputPath('ocean-back.png'), comparison: testInfo.outputPath('ocean-front-back.png') }));
  expect((await pixelsEqual(page, front, back)).changedPixels).toBeGreaterThan(500_000);
  const existingSkinReports = [];
  for (const id of ['dopamine', 'pokemon']) {
    await face(page, false); await choose(page, id); await closeEditor(page);
    const beforeFront = await stagePng(page), favoriteFront = await exportCard(page, '导出 PNG');
    await artifact(testInfo, `${id}-front.png`, favoriteFront);
    await face(page, true);
    const beforeBack = await stagePng(page), favoriteBack = await exportCard(page, '导出 PNG');
    await artifact(testInfo, `${id}-back.png`, favoriteBack);
    for (const [side, image] of [['front', favoriteFront], ['back', favoriteBack]]) {
      const report = { id, side, hash: hash(image) };
      // Local review can additionally protect existing exports; this is a
      // regression check, independent of the user's current visual reference.
      if (process.env.HOLO_EXISTING_SKINS_DIR) {
        const previous = await readFile(resolve(process.env.HOLO_EXISTING_SKINS_DIR, `${id}-${side}.png`));
        report.previousPixels = await pixelsEqual(page, previous, image);
        expect(report.previousPixels.changedPixels, `${id} ${side} previous pixels`).toBe(0);
      }
      existingSkinReports.push(report);
    }
    await choose(page, 'ocean'); await choose(page, id); await closeEditor(page);
    expect((await pixelsEqual(page, beforeBack, await stagePng(page))).changedPixels).toBe(0);
    await face(page, false);
    expect((await pixelsEqual(page, beforeFront, await stagePng(page))).changedPixels).toBe(0);
  }
  expect(await rawSubject(page)).toEqual(subject);
  expect(loadedAssets.has('/holo-skins/v4/ocean-scene.webp')).toBe(true);
  expect(failedAssets).toEqual([]); noAI(calls);
  await artifact(testInfo, 'existing-skins-regression.json', JSON.stringify(existingSkinReports, null, 2), 'application/json');
});

test('ocean transparent frame long copy mixed windows and phone saving work through the real editor', async ({ page }, testInfo) => {
  test.setTimeout(110_000);
  const { calls, subject, failedAssets } = await start(page);
  let panel = await choose(page, 'ocean'); await closeEditor(page);
  const originalCard = await exportCard(page, '导出 PNG'), frame = await currentOceanFrame(page);
  const frameAlpha = await layerPixels(page, frame, PORTRAIT_CORE);
  expect(frameAlpha.width).toBe(1024); expect(frameAlpha.height).toBe(1536);
  expect(frameAlpha.clear).toBeGreaterThan(1_000_000); expect(frameAlpha.visible).toBeGreaterThan(1000);
  expect(frameAlpha.windowVisible, 'the full-art frame leaves the central portrait genuinely transparent').toBe(0);
  await artifact(testInfo, 'ocean-frame.png', frame);
  panel = await library(page); await fold(panel, '自备素材');
  const choosing = page.waitForEvent('filechooser');
  await panel.getByRole('button', { name: '上传卡框', exact: true }).click();
  await (await choosing).setFiles({ name: 'my-ocean-frame.png', mimeType: 'image/png', buffer: frame });
  await readyCard(page);
  await expect(panel.getByRole('button', { name: '使用我的卡框', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const uploadedFrame = await panel.getByRole('button', { name: '上传卡框', exact: true }).locator('img').evaluate(async image =>
    Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())));
  expect(Buffer.from(uploadedFrame)).toEqual(frame);
  await closeEditor(page); await readyCard(page);
  expect((await pixelsEqual(page, originalCard, await exportCard(page, '导出 PNG'))).changedPixels,
    'uploading the actual Ocean frame preserves the complete card').toBe(0);
  panel = await library(page); await fold(panel, '自备素材');
  await panel.getByRole('button', { name: '恢复皮肤卡框', exact: true }).click(); await readyCard(page);
  await fold(panel, '卡面文字');
  const beforeText = await textPng(page);
  const longTitle = '让每一束深海流光都替我们保存永不褪色的蓝色心愿';
  const longCopy = { '卡片名称': longTitle, '副标题': '把星光与潮汐写成心愿让每次相遇都像蓝宝石一样闪耀',
    '角色名称': '永远珍藏的深海追光者', '编号': 'OCEAN-2026', '系列': '与你一起收藏每一片深海每一道光和每一个值得纪念的瞬间', '版本': '海洋之心特别典藏纪念版' };
  await expect(panel.locator('.holo-card-copy-fields input')).toHaveCount(6);
  for (const [name, value] of Object.entries(longCopy)) await panel.getByRole('textbox', { name, exact: true }).fill(value);
  await readyCard(page);
  const longText = await textPng(page), textAlpha = await layerPixels(page, longText, PORTRAIT_CORE);
  expect((await pixelsEqual(page, beforeText, longText)).changedPixels).toBeGreaterThan(1000);
  expect(textAlpha.visible).toBeGreaterThan(1000); expect(textAlpha.windowVisible).toBe(0);
  expect(textAlpha.visible, 'full-art typography remains sparse over the image').toBeLessThan(textAlpha.width * textAlpha.height * .2);
  expect(textAlpha.denseTiles, 'the text layer contains glyphs and strokes without large solid panels').toBeLessThanOrEqual(4);
  expect(textAlpha.bounds.left).toBeGreaterThanOrEqual(18); expect(textAlpha.bounds.top).toBeGreaterThanOrEqual(18);
  expect(textAlpha.bounds.right).toBeLessThanOrEqual(textAlpha.width - 18); expect(textAlpha.bounds.bottom).toBeLessThanOrEqual(textAlpha.height - 18);
  await artifact(testInfo, 'ocean-long-text.png', longText);
  await closeEditor(page); await artifact(testInfo, 'ocean-long-card.png', await exportCard(page, '导出 PNG'));
  panel = await library(page); await fold(panel, '自由混搭');
  const mixed = [];
  for (const [frameId, layoutId] of [['arknights', 'ocean'], ['ocean', 'astral']]) {
    await panel.getByRole('combobox', { name: '卡框', exact: true }).selectOption(frameId);
    await panel.getByRole('combobox', { name: '文字排版', exact: true }).selectOption(layoutId);
    await readyCard(page);
    const state = await stageState(page), text = await textPng(page);
    expect(state.design.frame).toBe(frameId); expect(state.design.layout).toBe(layoutId);
    const fullArt = getCardSkin(frameId).fullArt && getCardSkin(layoutId).fullArt;
    if (fullArt) {
      expect(state.framing.displayBounds).toEqual({ x: 0, y: 0, width: 1, height: 1 });
      expect(state.framing.strategy).toBe('native');
    }
    const safeArea = fullArt ? PORTRAIT_CORE : state.framing.artworkRect;
    const alpha = await layerPixels(page, text, safeArea);
    expect(alpha.windowVisible, `${frameId} frame / ${layoutId} type uses the actual resolved safe window`).toBe(0);
    expect(alpha.visible).toBeGreaterThan(1000);
    mixed.push({ frameId, layoutId, artworkRect: state.framing.artworkRect, safeArea, alpha });
    await artifact(testInfo, `mixed-${frameId}-${layoutId}-text.png`, text);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  panel = await choose(page, 'ocean');
  await expect(panel.locator('[data-card-skin="ocean"]')).toBeInViewport();
  await fold(panel, '卡面文字');
  await expect(panel.getByRole('textbox', { name: '卡片名称', exact: true })).toHaveValue(longTitle);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await artifact(testInfo, 'ocean-mobile-library.png', await page.screenshot());
  await closeEditor(page);
  const stage = await readyCard(page), bounds = await stage.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390); expect(bounds.y + bounds.height).toBeLessThanOrEqual(844);
  await expect(page.getByRole('button', { name: '导出同款闪卡', exact: true })).toBeInViewport();
  await artifact(testInfo, 'ocean-mobile.png', await page.screenshot());
  await artifact(testInfo, 'ocean-mobile-export.png', await exportCard(page, '导出 PNG'));
  expect(await rawSubject(page)).toEqual(subject);
  expect(failedAssets).toEqual([]); noAI(calls);
  await artifact(testInfo, 'ocean-layer-checks.json', JSON.stringify({ frameAlpha, textAlpha, mixed, subjectHash: hash(subject) }, null, 2), 'application/json');
});
