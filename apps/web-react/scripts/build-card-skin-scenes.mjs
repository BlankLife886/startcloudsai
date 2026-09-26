import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Deterministic, offline illustration export. No model or project API requests.
const pack = process.argv[2] || 'v2';
const packs = { v2: ['anime', 'pixel', 'monster', 'farm', 'duel'], v3: ['dopamine', 'pokemon', 'arknights'], v4: ['ocean'] };
if (!packs[pack]) throw new Error(`Scene pack must be ${Object.keys(packs).join(', ')}`);
const output = fileURLToPath(new URL(`../public/holo-skins/${pack}/`, import.meta.url));
const origin = process.env.WEB_BASE_URL || 'http://127.0.0.1:3106';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/__card-scene-export', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Card scenery export</title>' }));
  await page.goto(`${origin}/__card-scene-export`);
  for (const id of packs[pack]) {
    const images = await page.evaluate(async ({ id, pack }) => {
      let canvas;
      if (pack !== 'v2') {
        const { createCardSkinCanvases } = await import('/src/features/holo-card/card-skin-art.js');
        const plates = createCardSkinCanvases(id); canvas = plates.background;
        for (const part of ['frame', 'effects', 'back']) { plates[part].width = 1; plates[part].height = 1; }
      } else {
        const { createCardSkinScene } = await import('/src/features/holo-card/skin-scenes.js');
        canvas = createCardSkinScene(id);
      }
      const result = { png: canvas.toDataURL('image/png').split(',')[1], webp: canvas.toDataURL('image/webp', .94).split(',')[1] };
      const preview = document.createElement('canvas'); preview.width = 360; preview.height = 540;
      preview.getContext('2d').drawImage(canvas, 0, 0, 360, 540);
      result.preview = preview.toDataURL('image/webp', .88).split(',')[1];
      canvas.width = 1; canvas.height = 1; preview.width = 1; preview.height = 1; return result;
    }, { id, pack });
    await writeFile(`${output}${id}-scene.png`, Buffer.from(images.png, 'base64'));
    await writeFile(`${output}${id}-scene.webp`, Buffer.from(images.webp, 'base64'));
    await writeFile(`${output}${id}-preview.webp`, Buffer.from(images.preview, 'base64'));
  }
  console.log(`${packs[pack].length} original 1024×1536 scene plates saved in ${output}`);
} finally { await browser.close(); }
