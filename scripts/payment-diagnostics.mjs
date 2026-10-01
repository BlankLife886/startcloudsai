#!/usr/bin/env node
// 支付链路诊断页（仅本机）：区分「线上环境问题」和「代码 / 配置问题」。
//
//   node scripts/payment-diagnostics.mjs        # 打开 http://127.0.0.1:8150
//
// 页面通过本服务转发请求，避免浏览器跨域限制。通讯密钥只在单次请求的内存中
// 用于计算签名，不写盘、不打印日志。服务只监听 127.0.0.1。
import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

const PORT = Number(process.env.PORT || 8150);
const md5 = value => crypto.createHash('md5').update(value, 'utf8').digest('hex');

// Plain GET/POST without following redirects, so every hop is visible.
function call(rawUrl, { method = 'GET', form = null, json = null, cookie = '', insecure = false, timeout = 15000 } = {}) {
  return new Promise(resolve => {
    let url;
    try { url = new URL(rawUrl); } catch { return resolve({ error: '地址格式不正确' }); }
    const lib = url.protocol === 'http:' ? http : https;
    const body = form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : null;
    const type = form ? 'application/x-www-form-urlencoded' : 'application/json';
    const req = lib.request(url, {
      method, timeout, rejectUnauthorized: !insecure,
      headers: { 'User-Agent': 'Java/1.8.0 payment-diagnostics', Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) } : {}) },
    }, res => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { if (text.length < 200000) text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || null, setCookie: res.headers['set-cookie'] || [], body: text }));
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('请求超时'), { code: 'TIMEOUT' })));
    req.on('error', error => resolve({ error: `${error.code || 'ERROR'}：${error.message}` }));
    if (body) req.write(body);
    req.end();
  });
}

function certificate(host) {
  return new Promise(resolve => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: 15000 }, () => {
      const cert = socket.getPeerCertificate();
      const names = String(cert.subjectaltname || '').split(',').map(s => s.trim().replace(/^DNS:/, '')).filter(Boolean);
      const matches = tls.checkServerIdentity(host, cert) === undefined;
      resolve({ subject: cert.subject?.CN || '', names, issuer: cert.issuer?.O || cert.issuer?.CN || '', validTo: cert.valid_to, authorized: socket.authorized, authorizationError: socket.authorizationError ? String(socket.authorizationError) : null, matches });
      socket.end();
    });
    socket.on('timeout', () => { socket.destroy(); resolve({ error: '连接超时' }); });
    socket.on('error', error => resolve({ error: `${error.code || 'ERROR'}：${error.message}` }));
  });
}

// Interprets the notify endpoint's answer for both the deployed (old) and the new code.
function callbackVerdict(result) {
  if (result.error) return { level: 'bad', text: `请求失败（${result.error}）。蓝鲸回调同样会失败，属于线上环境问题（域名 / 证书 / 网络）。` };
  const body = (result.body || '').trim();
  if (result.status === 400 && body === 'invalid_order') return { level: 'good', text: '回调地址可访问，签名校验通过（线上旧版代码的正常拒绝：测试订单号不存在）。回调这条路是通的。' };
  if (result.status === 200 && body === 'success') return { level: 'good', text: '回调地址可访问，签名校验通过（新版代码：测试订单已记录为无法识别并确认）。回调这条路是通的。' };
  if (result.status === 401 && body === 'error_sign') return { level: 'bad', text: '能访问到接口，但签名校验失败：线上服务器配置的通讯密钥与这里填写的（蓝鲸后台的）不一致。属于配置问题，回调会被全部拒绝。' };
  if (result.status === 503) return { level: 'bad', text: `能访问到接口，但线上支付配置不可用（${body}）：检查后台支付配置是否启用、是否填全。` };
  if (result.status === 429) return { level: 'warn', text: '被限流（同一 IP 每分钟最多 120 次），稍后再试。' };
  if (result.status === 404) return { level: 'bad', text: '返回 404：这个域名没有转发到 API（Nginx 未配置该站点或路径不对）。属于线上环境问题。' };
  if (result.status >= 300 && result.status < 400) return { level: 'bad', text: `被重定向到 ${result.location}。蓝鲸回调不会跟随跳转，请直接填写最终地址。` };
  return { level: 'warn', text: `意外的响应 HTTP ${result.status}：${body.slice(0, 120)}` };
}

const providerStates = { '-1': '订单过期（未在有效期内收到款）', 0: '等待支付', 1: '已完成（已收款，且已成功通知我们）', 2: '已收款但通知失败（回调没送到或没返回 success）' };

async function callbackProbe({ urls = [], secret = '' }) {
  if (!secret.trim()) throw new Error('请填写通讯密钥');
  const payId = `probe-${Date.now()}`;
  const [type, price, reallyPrice] = ['2', '0.01', '0.01'];
  const sign = md5(payId + payId + type + price + reallyPrice + secret.trim());
  const results = [];
  for (const raw of urls.map(u => String(u).trim()).filter(Boolean).slice(0, 5)) {
    const url = new URL(raw);
    const target = `${url.origin}${url.pathname}?${new URLSearchParams({ payId, param: payId, type, price, reallyPrice, sign })}`;
    const cert = url.protocol === 'https:' ? await certificate(url.hostname) : null;
    const strict = await call(target);
    const verdict = callbackVerdict(strict);
    let behindCertificate = null;
    if (strict.error && url.protocol === 'https:') {
      const loose = await call(target, { insecure: true });
      behindCertificate = { ...loose, verdict: loose.error ? null : callbackVerdict(loose).text };
    }
    results.push({ url: `${url.origin}${url.pathname}`, cert, strict, verdict, behindCertificate });
  }
  return { payId, results };
}

async function orderLookup({ baseUrl, orderId }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const id = String(orderId || '').trim();
  if (!base || !id) throw new Error('请填写蓝鲸地址和云端订单号');
  const [getOrder, checkOrder] = await Promise.all([
    call(`${base}/getOrder`, { method: 'POST', form: { orderId: id } }),
    call(`${base}/checkOrder`, { method: 'POST', form: { orderId: id } }),
  ]);
  const parse = r => { try { return JSON.parse(r.body); } catch { return null; } };
  const order = parse(getOrder), check = parse(checkOrder);
  const findings = [];
  if (order?.code === 1) {
    const d = order.data || {};
    findings.push({ level: [1, 2].includes(Number(d.state)) ? 'good' : 'warn', text: `渠道状态 ${d.state}：${providerStates[d.state] ?? '未知'}` });
    findings.push({ level: Number(d.price) === Number(d.reallyPrice) ? 'good' : 'warn', text: `标价 ${d.price}，实付 ${d.reallyPrice}，${Number(d.isAuto) === 0 ? '固定金额码（扫码自动带金额）' : '通用码（需手动输入金额）'}` });
    if (Number(d.state) === 2) findings.push({ level: 'bad', text: '渠道已收款但通知失败：说明回调没送达。配合上面的回调测试即可判断是地址 / 证书还是密钥问题。' });
    if ([0, -1].includes(Number(d.state))) findings.push({ level: 'warn', text: '如果用户确实付了款而这里仍是待支付 / 过期：说明手机监听端没识别到这笔收款（监听 App 掉线、通知被系统拦截或付款金额与订单不符），与我们的代码无关。' });
  } else if (order) {
    findings.push({ level: 'bad', text: `查询订单失败：${order.msg || JSON.stringify(order)}` });
  }
  if (check?.code === 1) {
    const data = String(check.data || '');
    const absolute = /^https?:\/\/[^/?#]+/i.test(data);
    findings.push({ level: absolute ? 'good' : 'bad', text: absolute
      ? '/checkOrder 返回的跳转地址带域名：线上旧代码的轮询兜底对这类订单有效。'
      : '/checkOrder 返回的跳转地址不带域名：线上旧代码的轮询兜底无法解析，已付款订单只能靠回调到账（新版不依赖此地址）。' });
  } else if (check) {
    findings.push({ level: 'warn', text: `/checkOrder：${check.msg || '未支付'}（未支付的订单查不到跳转地址；请用已付款订单测试）` });
  }
  return { getOrder: order ?? getOrder, checkOrder: check ?? checkOrder, findings };
}

async function listenerState({ baseUrl, secret }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base || !String(secret || '').trim()) throw new Error('请填写蓝鲸地址和通讯密钥');
  const t = String(Date.now());
  const raw = await call(`${base}/getState`, { method: 'POST', form: { t, sign: md5(t + String(secret).trim()) } });
  let data; try { data = JSON.parse(raw.body); } catch { return { raw, findings: [{ level: 'bad', text: raw.error || '响应无法解析' }] }; }
  if (data.code !== 1) return { raw: data, findings: [{ level: 'bad', text: `查询失败：${data.msg}${data.msg?.includes('签名') ? '（密钥填写错误）' : ''}` }] };
  const d = data.data || {};
  const heartAge = d.lastheart ? Math.round((Date.now() - Number(d.lastheart)) / 1000) : null;
  const label = { 1: '在线', 0: '掉线', '-1': '未绑定监控端' }[d.state] ?? d.state;
  return { raw: data, findings: [
    { level: String(d.state) === '1' ? 'good' : 'bad', text: `监听端状态：${label}` },
    { level: heartAge !== null && heartAge < 180 ? 'good' : 'warn', text: heartAge === null ? '没有心跳记录' : `最后心跳：${heartAge} 秒前（${new Date(Number(d.lastheart)).toLocaleString('zh-CN')}）` },
    { level: 'info', text: d.lastpay && Number(d.lastpay) > 0 ? `最后一次监听到收款：${new Date(Number(d.lastpay)).toLocaleString('zh-CN')}` : '没有收款记录' },
  ] };
}


// ---------- ④ 真实支付测试：以测试账号走线上网站的完整下单流程 ----------
// 登录 Cookie 只保存在本进程内存里，进程退出即失效。
const site = { origin: '', cookie: '', email: '' };
// 可选：预置一个已有会话（例如本地沙盒），跳过邮箱验证码登录。
//   DIAG_SITE_ORIGIN=http://127.0.0.1:8144 DIAG_SITE_COOKIE='sc_session=...' node scripts/payment-diagnostics.mjs
if (process.env.DIAG_SITE_ORIGIN && process.env.DIAG_SITE_COOKIE) {
  Object.assign(site, { origin: process.env.DIAG_SITE_ORIGIN.replace(/\/+$/, ''), cookie: process.env.DIAG_SITE_COOKIE, email: '预置会话' });
}

async function siteApi(method, path, json) {
  if (!site.origin) throw new Error('请先登录网站测试账号');
  const r = await call(site.origin + '/api/v1' + path, { method, json, cookie: site.cookie });
  if (r.error) throw new Error(r.error);
  let data; try { data = JSON.parse(r.body); } catch { throw new Error(`网站返回 HTTP ${r.status}，无法解析`); }
  if (r.status === 401) { site.cookie = ''; throw new Error('网站登录已失效，请重新登录'); }
  if (!data.success) throw Object.assign(new Error(data.error || data.message || `HTTP ${r.status}`), { code: data.code, status: r.status });
  return data.data;
}

function normalizeOrigin(raw) {
  const url = new URL(String(raw || '').trim());
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('网站地址须为 https');
  return url.origin;
}

async function siteSendCode({ origin, email }) {
  site.origin = normalizeOrigin(origin);
  site.cookie = ''; site.email = '';
  await siteApi('POST', '/auth/email-verification-codes', { email: String(email || '').trim() });
  return { ok: true };
}

async function siteLogin({ origin, email, code }) {
  site.origin = normalizeOrigin(origin);
  const r = await call(site.origin + '/api/v1/auth/session', { method: 'POST', json: { email: String(email).trim(), code: String(code).trim(), skipReferral: true } });
  if (r.error) throw new Error(r.error);
  let data; try { data = JSON.parse(r.body); } catch { throw new Error(`登录返回 HTTP ${r.status}`); }
  if (!data.success) throw new Error(data.error || '登录失败');
  site.cookie = r.setCookie.map(c => c.split(';')[0]).join('; ');
  if (!site.cookie) throw new Error('登录成功但没有拿到会话 Cookie');
  site.email = String(email).trim();
  return { email: site.email };
}

async function siteStatus() {
  if (!site.cookie) return { loggedIn: false };
  try {
    const me = await siteApi('GET', '/auth/session');
    // The endpoint answers 200 with an empty user when the cookie is not accepted.
    if (!me?.user) { site.cookie = ''; return { loggedIn: false, error: '会话无效，请重新登录' }; }
    return { loggedIn: true, email: me.user.email || site.email, origin: site.origin };
  }
  catch { return { loggedIn: false }; }
}

async function sitePlans() {
  const data = await siteApi('GET', '/plans');
  const items = (data.items || []).filter(p => p.kind === 'topup' && !p.rechargePolicy && p.priceCents > 0)
    .map(p => ({ id: p.id, name: p.name, priceCents: p.priceCents, points: (p.grantCents || 0) + (p.bonusCents || 0) }));
  return { items, paymentEnabled: data.paymentEnabled, paymentMethods: data.paymentMethods || [] };
}

async function siteCheckout({ planId, paymentMethod }) {
  try { return { order: await siteApi('POST', '/orders', { planId, paymentMethod }) }; }
  catch (error) { return { error: error.message, code: error.code }; }
}

// mode=callback 只读订单列表（旧代码不会在这里向渠道补查），用来单独验证回调；
// mode=polling 读订单详情（旧代码会向渠道查询并补单），等同于用户一直开着付款页。
async function siteWatch({ orderId, providerOrderId, mode, baseUrl }) {
  let order = null, siteError = null;
  try {
    if (mode === 'polling') order = await siteApi('GET', `/orders/${encodeURIComponent(orderId)}`);
    else order = (await siteApi('GET', '/orders?limit=20')).items?.find(o => o.id === orderId) || null;
  } catch (error) { siteError = error.message; }
  let provider = null;
  const cloudId = providerOrderId || order?.providerOrderId;
  if (cloudId && baseUrl) {
    const r = await call(String(baseUrl).replace(/\/+$/, '') + '/getOrder', { method: 'POST', form: { orderId: cloudId } });
    try { const d = JSON.parse(r.body); provider = d.code === 1 ? { state: Number(d.data.state), label: providerStates[d.data.state] ?? d.data.state } : { error: d.msg }; }
    catch { provider = { error: r.error || `HTTP ${r.status}` }; }
  }
  return { order: order && { id: order.id, status: order.status, paidAt: order.paidAt, completedAt: order.completedAt, providerOrderId: order.providerOrderId, payUrl: order.payUrl, syncError: order.syncError || order.checkError || null }, siteError, provider };
}

async function siteCancel({ orderId }) {
  try { return { order: await siteApi('POST', `/orders/${encodeURIComponent(orderId)}/close`) }; }
  catch (error) { return { error: error.message }; }
}

async function siteLogout() {
  if (site.cookie) { try { await siteApi('DELETE', '/auth/session'); } catch { /* already gone */ } }
  site.cookie = ''; site.email = '';
  return { ok: true };
}

const page = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>支付链路诊断</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#1d2129;--muted:#6b7280;--line:#e5e7eb;--good:#16794c;--goodbg:#e8f6ee;--bad:#b42318;--badbg:#fdecea;--warn:#a15c07;--warnbg:#fff4e0;--accent:#4f46e5}
@media(prefers-color-scheme:dark){:root{--bg:#121316;--card:#1c1d22;--ink:#eceef2;--muted:#9aa0aa;--line:#2c2e35;--goodbg:#13301f;--good:#6fd39b;--badbg:#3a1714;--bad:#ff8f84;--warnbg:#382810;--warn:#f5bf62}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:920px;margin:0 auto;padding:28px 16px 60px}h1{margin:0 0 4px;font-size:22px}p.lead{margin:0 0 20px;color:var(--muted)}
section{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin-bottom:16px}
h2{margin:0 0 4px;font-size:16px}h2 small{color:var(--muted);font-weight:400;margin-left:6px}.hint{margin:0 0 12px;color:var(--muted);font-size:13px}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}input,textarea{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:transparent;color:var(--ink);font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
textarea{min-height:64px;resize:vertical}button{margin-top:12px;padding:9px 18px;border:0;border-radius:9px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}button:disabled{opacity:.6;cursor:wait}
.out{margin-top:14px;display:grid;gap:8px}.f{padding:9px 12px;border-radius:9px;font-size:13px}.good{background:var(--goodbg);color:var(--good)}.bad{background:var(--badbg);color:var(--bad)}.warn{background:var(--warnbg);color:var(--warn)}.info{background:var(--bg);color:var(--muted)}
.target{border:1px solid var(--line);border-radius:10px;padding:10px 12px;display:grid;gap:6px}.target b{font:13px ui-monospace,Menlo,monospace;overflow-wrap:anywhere}
details{font-size:12px;color:var(--muted)}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:8px;border-radius:8px;margin:6px 0 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}@media(max-width:640px){.grid{grid-template-columns:1fr}}
.row{display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap}.row>div{flex:1;min-width:180px}.row button{margin-top:0}
select{width:100%;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:var(--card);color:var(--ink);font:13px inherit}
.ghost{background:transparent;color:var(--ink);border:1px solid var(--line)}.modes{display:grid;gap:6px;margin-top:10px;font-size:13px}.modes label{display:flex;gap:8px;align-items:flex-start;margin:0;color:var(--ink);font-size:13px}.modes input{width:auto;margin-top:4px}
.pay{display:grid;grid-template-columns:auto 1fr;gap:18px;align-items:start;margin-top:14px}@media(max-width:640px){.pay{grid-template-columns:1fr}}
.qr{background:#fff;padding:10px;border-radius:12px;border:1px solid var(--line);width:max-content}.qr svg{display:block;width:220px;height:220px}
.board{display:grid;gap:6px;font-size:13px}.board div{display:flex;justify-content:space-between;gap:10px;border-bottom:1px dashed var(--line);padding:4px 0}.board span{color:var(--muted)}.board b{text-align:right;overflow-wrap:anywhere}
ol.tl{margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--muted)}
</style></head><body><main>
<h1>支付链路诊断</h1><p class="lead">分三段检查：回调能不能送达、签名配置是否一致、渠道侧实际状态。只在本机运行，通讯密钥不保存、不记录。</p>
<section><div class="grid"><div><label>蓝鲸接口地址</label><input id="base" value="https://2347537.pay.lanjingzf.com"></div><div><label>通讯密钥（蓝鲸后台「系统设置」里的）</label><input id="secret" type="password" autocomplete="off" placeholder="只用于本机计算签名"></div></div></section>
<section><h2>① 回调地址测试<small>不付钱</small></h2><p class="hint">用通讯密钥签一个测试订单的回调，发到下面的地址。测试订单号不存在，不会给任何账号入账，线上回调记录表里会多一条测试记录。</p>
<label>要测试的异步回调地址（每行一个）</label><textarea id="urls">https://starcloudisai.com/api/v1/payments/lanjing/notify
https://preview.starcloudisai.com/api/v1/payments/lanjing/notify</textarea><button id="probe">开始测试</button><div class="out" id="probeOut"></div></section>
<section><h2>② 监听端状态<small>只读</small></h2><p class="hint">手机监听 App 掉线时，用户付了款渠道也不知道。</p><button id="state">查询监听端</button><div class="out" id="stateOut"></div></section>
<section><h2>③ 渠道订单查询<small>只读，不需要密钥</small></h2><p class="hint">填蓝鲸后台的「云端订单号」。建议查两笔：一笔已成功到账的，一笔出问题的。</p>
<label>云端订单号</label><input id="orderId" placeholder="例如 201901102220147500"><button id="order">查询</button><div class="out" id="orderOut"></div></section>
<section><h2>④ 真实支付测试<small>会产生一笔小额真实付款，钱进你自己的收款码</small></h2>
<p class="hint">用测试账号在线上网站下单，手机扫码付款，页面同时盯住「我们网站的订单状态」和「蓝鲸渠道状态」，自动给出结论。登录状态只保存在本机这个进程的内存里。</p>
<div class="row"><div><label>网站地址</label><input id="siteOrigin" value="https://starcloudisai.com"></div></div>
<div id="loginBox"><div class="row"><div><label>测试账号邮箱（Gmail / QQ 邮箱）</label><input id="siteEmail" placeholder="test@qq.com"></div><button id="sendCode" class="ghost">发送验证码</button></div>
<div class="row"><div><label>邮箱验证码</label><input id="siteCode" inputmode="numeric" autocomplete="one-time-code"></div><button id="siteLogin">登录</button></div></div>
<div class="out" id="loginOut"></div>
<div id="checkoutBox" hidden>
<div class="row"><div><label>固定额度包（选最便宜的）</label><select id="planSel"></select></div><div><label>支付方式</label><select id="methodSel"><option value="alipay">支付宝</option><option value="wechat">微信</option></select></div></div>
<div class="modes"><label><input type="radio" name="mode" value="callback" checked><span><b>只靠回调（推荐）</b>：只读网站订单列表，旧代码不会在这里向渠道补查。到账就说明回调送达了。模拟用户付完款马上关掉付款页。</span></label>
<label><input type="radio" name="mode" value="polling"><span><b>付款页轮询</b>：读取订单详情，旧代码会顺带向渠道查询并补单。等同于用户一直开着付款页。</span></label></div>
<div class="row"><button id="createOrder">创建订单并显示二维码</button><button id="cancelOrder" class="ghost" hidden>取消这笔订单</button><button id="stopWatch" class="ghost" hidden>停止观察</button></div>
</div>
<div id="payBox" hidden><div class="pay"><div><div class="qr" id="qr"></div><p class="hint" id="qrHint"></p></div>
<div><div class="board" id="board"></div><div class="out" id="verdict"></div><ol class="tl" id="timeline"></ol></div></div></div>
</section>
<section><h2>结论对照</h2><div class="out">
<div class="f info">① 正式域名「签名校验通过」+ ③ 出问题的订单是「已收款但通知失败」→ 之前是回调地址（preview）不通，属于线上配置问题，改地址即可。</div>
<div class="f info">① 正式域名「签名校验失败」→ 线上服务器密钥与蓝鲸不一致，属于配置问题。</div>
<div class="f info">③ 状态是「已完成」但我们的订单没到账 → 旧代码处理问题。</div>
<div class="f info">③ 状态是「等待支付 / 过期」但用户确实付了 → 手机监听端没识别到收款（配合 ②）。</div></div></section>
</main><script src="https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js"></script><script>
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const f=x=>'<div class="f '+x.level+'">'+esc(x.text)+'</div>';
const raw=(title,obj)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(JSON.stringify(obj,null,2))+'</pre></details>';
async function run(btn,out,path,body,render){btn.disabled=true;out.innerHTML='<div class="f info">请求中…</div>';try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();out.innerHTML=d.error?f({level:'bad',text:d.error}):render(d)}catch(e){out.innerHTML=f({level:'bad',text:'本地服务无响应：'+e.message})}finally{btn.disabled=false}}
$('probe').onclick=()=>run($('probe'),$('probeOut'),'/api/callback-probe',{urls:$('urls').value.split('\\n'),secret:$('secret').value},d=>d.results.map(r=>{const c=r.cert;let h='<div class="target"><b>'+esc(r.url)+'</b>';
if(c){h+=c.error?f({level:'bad',text:'证书读取失败：'+c.error}):f({level:c.matches&&c.authorized?'good':'bad',text:c.matches&&c.authorized?'证书正常：'+c.subject+'（'+c.issuer+'，到期 '+c.validTo+'）':'证书问题：服务器返回的是 '+(c.names.join(', ')||c.subject)+' 的证书'+(c.matches?'':'，与域名不符')+(c.authorizationError?'（'+c.authorizationError+'）':'')+'。蓝鲸的回调会在握手阶段失败。'})}
h+=f(r.verdict);if(r.behindCertificate){h+=f({level:'info',text:'忽略证书后：'+(r.behindCertificate.error||('HTTP '+r.behindCertificate.status+' → '+(r.behindCertificate.verdict||'')))})}
h+=raw('原始响应',{strict:r.strict,behindCertificate:r.behindCertificate,cert:r.cert});return h+'</div>'}).join('')+f({level:'info',text:'测试订单号：'+d.payId+'（可在线上 payment_callback_events 表中找到这条记录）'}));
$('state').onclick=()=>run($('state'),$('stateOut'),'/api/listener-state',{baseUrl:$('base').value,secret:$('secret').value},d=>d.findings.map(f).join('')+raw('原始响应',d.raw));
$('order').onclick=()=>run($('order'),$('orderOut'),'/api/order',{baseUrl:$('base').value,orderId:$('orderId').value},d=>d.findings.map(f).join('')+raw('/getOrder 原始响应',d.getOrder)+raw('/checkOrder 原始响应',d.checkOrder));
const post=async(path,body)=>{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});return r.json()};
const say=(el,level,text)=>{el.innerHTML=f({level,text})};
const statusLabel={pending:'待支付',uncertain:'待核实',paid:'已收款待到账',completed:'已完成（已到账）',expired:'已过期',cancelled:'已取消',failed:'失败'};
let watch=null;
async function refreshLogin(){const st=await post('/api/site/status');$('loginBox').hidden=st.loggedIn;$('checkoutBox').hidden=!st.loggedIn;
 if(st.loggedIn){$('loginOut').innerHTML=f({level:'good',text:'已登录：'+st.email+'（'+st.origin+'）'})+'<button id="siteLogout" class="ghost">退出登录</button>';$('siteLogout').onclick=async()=>{await post('/api/site/logout');stopWatch();$('payBox').hidden=true;refreshLogin()};loadPlans()}}
async function loadPlans(){const d=await post('/api/site/plans');if(d.error){say($('loginOut'),'bad',d.error);return}
 $('planSel').innerHTML=d.items.sort((a,b)=>a.priceCents-b.priceCents).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+' · ¥'+(p.priceCents/100).toFixed(2)+' · '+p.points+' 积分</option>').join('');
 const m=d.paymentMethods||[];[...$('methodSel').options].forEach(o=>o.disabled=m.length>0&&!m.includes(o.value));
 if(!d.paymentEnabled)$('loginOut').insertAdjacentHTML('beforeend',f({level:'warn',text:'网站显示支付未开放'}))}
$('sendCode').onclick=async()=>{$('sendCode').disabled=true;const d=await post('/api/site/send-code',{origin:$('siteOrigin').value,email:$('siteEmail').value});say($('loginOut'),d.error?'bad':'good',d.error||'验证码已发送，请查收邮箱');setTimeout(()=>$('sendCode').disabled=false,30000)};
$('siteLogin').onclick=async()=>{const d=await post('/api/site/login',{origin:$('siteOrigin').value,email:$('siteEmail').value,code:$('siteCode').value});if(d.error){say($('loginOut'),'bad',d.error);return}$('siteCode').value='';refreshLogin()};
function stopWatch(){if(watch){clearInterval(watch.timer);watch=null}$('stopWatch').hidden=true;$('createOrder').disabled=false}
$('stopWatch').onclick=stopWatch;
function renderQR(url){$('qr').innerHTML='';if(!url){$('qr').textContent='没有二维码';return}try{const q=qrcode(0,'M');q.addData(url);q.make();$('qr').innerHTML=q.createSvgTag({cellSize:6,margin:2,scalable:true})}catch{$('qr').textContent=url}}
function verdict(w){const o=w.order||{},p=w.provider||{},t=Math.round((Date.now()-w.start)/1000),since=k=>w.firstSeen[k]?Math.round((Date.now()-w.firstSeen[k])/1000):0;
 if(o.status==='completed'){if(w.mode==='callback')return{level:'good',text:'✅ 已到账，而且是在「只靠回调」模式下到账的：蓝鲸的回调成功送达线上，旧代码正常入账。回调链路没问题。',done:true};
  if(p.state===1)return{level:'good',text:'✅ 已到账，渠道状态为「已成功通知」：回调和入账都正常。',done:true};
  if(p.state===2)return{level:'warn',text:'⚠️ 已到账，但渠道显示「通知失败」：这次是靠付款页轮询补到账的，回调没有送达。用户如果付完就关页面，就会漏单。',done:true};
  return{level:'good',text:'✅ 已到账。',done:true}}
 if(p.state===2&&since('p2')>20)return{level:'bad',text:'❌ 渠道已收款但「通知失败」，网站没到账：回调没送达线上。检查后台「支付异步回调」配置，以及这笔订单是不是在改配置之前创建的。'};
 if(p.state===1&&since('p1')>20)return{level:'bad',text:'❌ 渠道显示「已完成，已成功通知」，网站订单却没到账：旧代码处理问题。请把下面的订单号发给我。'};
 if(p.state===-1||o.status==='expired')return{level:'warn',text:'⌛ 订单已过期。如果你确实付了款：说明手机监听端没识别到这笔收款（查看 ② 监听端状态），与网站代码无关。'};
 if(o.status==='cancelled')return{level:'info',text:'订单已取消。',done:true};
 return{level:'info',text:'等待付款… 已过 '+t+' 秒。请用手机扫码支付；付款后通常 5–30 秒内会有结果。'}}
async function tick(){if(!watch)return;const w=watch;const d=await post('/api/site/watch',{orderId:w.orderId,providerOrderId:w.providerOrderId,mode:w.mode,baseUrl:$('base').value});if(watch!==w)return;
 if(d.order){w.order=d.order;w.providerOrderId=w.providerOrderId||d.order.providerOrderId}w.provider=d.provider||w.provider;
 const sKey='网站：'+(statusLabel[w.order?.status]||w.order?.status||'未知'),pKey=d.provider?(d.provider.error?'渠道：查询失败 '+d.provider.error:'渠道：'+d.provider.state+' '+d.provider.label):null;
 for(const k of [sKey,pKey].filter(Boolean)){if(!w.seen.has(k)){w.seen.add(k);$('timeline').insertAdjacentHTML('beforeend','<li>'+new Date().toLocaleTimeString('zh-CN')+'　'+esc(k)+'</li>')}}
 if(d.provider&&!d.provider.error){if(d.provider.state===2&&!w.firstSeen.p2)w.firstSeen.p2=Date.now();if(d.provider.state===1&&!w.firstSeen.p1)w.firstSeen.p1=Date.now()}
 $('board').innerHTML=['验证方式|'+(w.mode==='callback'?'只靠回调':'付款页轮询'),'平台订单号|'+w.orderId,'云端订单号|'+(w.providerOrderId||'—'),'应付金额|¥'+w.amount,'网站订单状态|'+(statusLabel[w.order?.status]||w.order?.status||'读取中'),'蓝鲸渠道状态|'+(d.provider?(d.provider.error||d.provider.state+'：'+d.provider.label):'—'),'已等待|'+Math.round((Date.now()-w.start)/1000)+' 秒'].map(x=>{const[a,b]=x.split('|');return'<div><span>'+esc(a)+'</span><b>'+esc(b)+'</b></div>'}).join('')+(d.siteError?f({level:'warn',text:'网站查询出错：'+d.siteError}):'')+(w.order?.syncError?f({level:'warn',text:'网站返回的同步错误：'+w.order.syncError}):'');
 const v=verdict(w);$('verdict').innerHTML=f(v);if(w.order&&!['pending','uncertain','paid'].includes(w.order.status))$('qr').style.opacity=.25;
 if(v.done||Date.now()-w.start>15*60*1000){stopWatch();$('cancelOrder').hidden=true}}
$('createOrder').onclick=async()=>{stopWatch();$('createOrder').disabled=true;$('verdict').innerHTML='';$('timeline').innerHTML='';
 const mode=document.querySelector('input[name=mode]:checked').value;const d=await post('/api/site/checkout',{planId:$('planSel').value,paymentMethod:$('methodSel').value});
 if(d.error||!d.order){$('createOrder').disabled=false;say($('loginOut'),'bad','下单失败：'+(d.error||'未知错误')+(d.code==='user_unsettled_order'?'（这个账号有未处理订单，先去网站「我的订单」取消）':''));return}
 const o=d.order;$('payBox').hidden=false;$('qr').style.opacity=1;renderQR(o.payUrl);
 $('qrHint').textContent=(o.paymentMethod==='wechat'?'微信':'支付宝')+'扫码，支付 ¥'+((o.payAmountCents??o.amountCents)/100).toFixed(2)+(o.payAmountCents&&o.payAmountCents!==o.amountCents?'（注意：渠道把金额调成了这个数，需按此金额付款）':'');
 watch={orderId:o.id,providerOrderId:o.providerOrderId,mode,amount:((o.payAmountCents??o.amountCents)/100).toFixed(2),start:Date.now(),seen:new Set(),firstSeen:{},order:o,provider:null};
 watch.timer=setInterval(tick,3000);$('stopWatch').hidden=false;$('cancelOrder').hidden=false;tick()};
$('cancelOrder').onclick=async()=>{if(!watch)return;const d=await post('/api/site/cancel',{orderId:watch.orderId});say($('verdict'),d.error?'bad':'info',d.error?'取消失败：'+d.error:'已取消，网站状态：'+(statusLabel[d.order?.status]||d.order?.status));if(!d.error){stopWatch();$('cancelOrder').hidden=true}};
refreshLogin();
</script></body></html>`;

const routes = {
  '/api/callback-probe': callbackProbe, '/api/order': orderLookup, '/api/listener-state': listenerState,
  '/api/site/send-code': siteSendCode, '/api/site/login': siteLogin, '/api/site/status': siteStatus, '/api/site/logout': siteLogout,
  '/api/site/plans': sitePlans, '/api/site/checkout': siteCheckout, '/api/site/watch': siteWatch, '/api/site/cancel': siteCancel,
};

http.createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(page);
  }
  const handler = req.method === 'POST' && routes[req.url];
  if (!handler) { res.writeHead(404); return res.end('not found'); }
  let body = '';
  for await (const chunk of req) { body += chunk; if (body.length > 20000) break; }
  let result;
  try { result = await handler(JSON.parse(body || '{}')); }
  catch (error) { result = { error: error.message }; }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(result));
}).listen(PORT, '127.0.0.1', () => console.log(`支付链路诊断：http://127.0.0.1:${PORT}`));
