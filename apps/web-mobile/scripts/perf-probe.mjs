// 手机站性能探针：空闲时是否持续有工作、滑动/弹层/切 Tab 的帧耗时与长任务。
// 用法：BASE=http://<局域网IP>:3107 ENGINE=chromium|webkit THROTTLE=4 node scripts/perf-probe.mjs
// playwright 取自 apps/web-react 的依赖。
import { chromium, webkit } from "../../web-react/node_modules/playwright/index.mjs";

const BASE = process.env.BASE || "http://192.168.31.89:3107";
const ENGINE = process.env.ENGINE || "chromium";
const THROTTLE = Number(process.env.THROTTLE || 4);

const INSTRUMENT = () => {
  window.__probe = { long: [], mutations: 0, frames: [] };
  new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__probe.long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: true });
  new MutationObserver((records) => { window.__probe.mutations += records.length; }).observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
};

async function measure(page, label, action, ms = 1500) {
  await page.evaluate(() => {
    const p = window.__probe; p.long = []; p.mutations = 0; p.frames = []; p.run = true;
    let last = performance.now();
    const tick = (t) => { p.frames.push(t - last); last = t; if (p.run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await action();
  await page.waitForTimeout(ms);
  const r = await page.evaluate(() => {
    const p = window.__probe; p.run = false;
    const f = p.frames.slice(1);
    return {
      frames: f.length,
      jank: f.filter((x) => x > 25).length,
      worstFrame: Math.round(Math.max(0, ...f)),
      longTasks: p.long.length,
      longTaskMs: p.long.reduce((a, b) => a + b, 0),
      mutations: p.mutations,
    };
  });
  console.log(label.padEnd(26), JSON.stringify(r));
}

const browserType = ENGINE === "webkit" ? webkit : chromium;
const browser = await browserType.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: ENGINE !== "webkit" ? true : undefined, hasTouch: true });
const page = await context.newPage();
if (ENGINE === "chromium" && THROTTLE > 1) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
}
await page.addInitScript(INSTRUMENT);
const requests = [];
page.on("requestfinished", async (req) => {
  try {
    const res = await req.response();
    const body = await res.body().catch(() => Buffer.alloc(0));
    requests.push({ url: req.url(), type: req.resourceType(), kb: Math.round(body.length / 1024) });
  } catch {}
});

console.log(`engine=${ENGINE} cpuThrottle=${THROTTLE}x base=${BASE}`);
const t0 = Date.now();
await page.goto(`${BASE}/m/inspire`, { waitUntil: "load" });
await page.waitForSelector(".m-prompt-card", { timeout: 20000 });
console.log("inspire first cards after", Date.now() - t0, "ms");

await measure(page, "inspire idle 3s", async () => {}, 3000);
await measure(page, "inspire scroll", async () => {
  for (let i = 0; i < 20; i += 1) { await page.mouse.wheel(0, 180); await page.waitForTimeout(40); }
});
await measure(page, "inspire open detail", async () => { await page.locator(".m-prompt-cover").nth(3).click(); }, 800);
await measure(page, "inspire close detail", async () => { await page.mouse.click(195, 40); }, 800);
await measure(page, "switch to create tab", async () => { await page.locator(".m-tabbar-item", { hasText: "创作" }).click(); }, 1500);
await measure(page, "create idle 3s", async () => {}, 3000);
await measure(page, "open params sheet", async () => { await page.locator(".m-chip").nth(1).click(); }, 800);
await measure(page, "scroll inside sheet", async () => {
  await page.locator(".m-bs-content").hover();
  for (let i = 0; i < 10; i += 1) { await page.mouse.wheel(0, 120); await page.waitForTimeout(40); }
});
await measure(page, "close params sheet", async () => { await page.mouse.click(195, 40); }, 800);
await measure(page, "switch to me tab", async () => { await page.locator(".m-tabbar-item", { hasText: "我的" }).click(); }, 1200);

const imgs = requests.filter((r) => r.type === "image");
const scripts = requests.filter((r) => r.type === "script");
console.log("\nrequests:", requests.length, "scripts:", scripts.length, `${scripts.reduce((a, r) => a + r.kb, 0)}KB`, "images:", imgs.length, `${imgs.reduce((a, r) => a + r.kb, 0)}KB`);
console.log("largest images:", imgs.sort((a, b) => b.kb - a.kb).slice(0, 5).map((r) => `${r.kb}KB ${r.url.slice(0, 90)}`).join("\n  "));
await browser.close();
