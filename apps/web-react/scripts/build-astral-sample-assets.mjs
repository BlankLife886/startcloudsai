import { chromium } from '@playwright/test';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Offline graphics export through the local app's Canvas implementation. No image API is called.
const output = fileURLToPath(new URL('../public/holo-samples/astral-v1/', import.meta.url));
const appOrigin = process.env.WEB_BASE_URL || 'http://127.0.0.1:3106';
await mkdir(output, { recursive: true });
await copyFile(fileURLToPath(new URL('../public/sucai/profile-hero-character.png', import.meta.url)), `${output}/subject.png`);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/__astral-design-export', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><title>Design export</title>' }));
  await page.goto(`${appOrigin}/__astral-design-export`);
  const result = await page.evaluate(async () => {
    const { createAstralDesignLayers } = await import('/src/features/holo-card/astral-design-layers.js');
    return Object.fromEntries(Object.entries(createAstralDesignLayers()).map(([name, canvas]) => [name, canvas.toDataURL('image/png').split(',')[1]]));
  });
  for (const [name, base64] of Object.entries(result)) await writeFile(`${output}/${name}.png`, Buffer.from(base64, 'base64'));
  console.log(`Saved original design layers and unchanged portrait to ${output}`);
} finally { await browser.close(); }
