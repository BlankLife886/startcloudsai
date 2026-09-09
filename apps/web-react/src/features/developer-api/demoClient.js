// This adapter deliberately has no API-client imports, browser storage or timers.
// Every value lives in this instance; demo_ secrets are rejected by the real API.
const SCOPES = ["models:read", "files:write", "tasks:write", "tasks:read"];
const EVENTS = ["task.succeeded", "task.failed", "task.canceled"];
const DAY = 86_400_000;
const GIB = 1024 ** 3;
const clone = (value) => JSON.parse(JSON.stringify(value));
const emptyUsage = () => ({ todayTasks: 0, monthTasks: 0, todaySpendCents: 0, monthSpendCents: 0, todayBytes: 0 });

function fail(message, code = "validation_error", status = 422) {
  throw Object.assign(new Error(message), { name: "DemoApiError", code, status });
}

function checkSignal(signal) {
  if (signal?.aborted) throw Object.assign(new Error("操作已取消"), { name: "AbortError" });
}

function labelValue(value) {
  const label = String(value || "").trim();
  if (!label || [...label].length > 80) fail("名称须为 1–80 个字符");
  return label;
}

function choices(values, allowed, field) {
  if (values != null && !Array.isArray(values)) fail(`${field}格式无效`);
  const result = [...new Set((values?.length ? values : allowed).map((value) => String(value).trim()))];
  if (result.some((value) => !allowed.includes(value))) fail(`${field}包含不支持的选项`);
  return result;
}

function integer(value, fallback, min, max, field) {
  const result = value === undefined || value === null || value === 0 ? fallback : Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) fail(`${field}须为 ${min}–${max} 之间的整数`);
  return result;
}

function validIPOrCIDR(value) {
  const [address, prefix, ...rest] = value.split("/");
  if (rest.length || (prefix !== undefined && !/^\d+$/.test(prefix))) return false;
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) && address.split(".").every((part) => Number(part) <= 255 && (part === "0" || !part.startsWith("0")));
  if (ipv4) return prefix === undefined || Number(prefix) <= 32;
  if (!address.includes(":") || address.includes("%")) return false;
  try {
    new URL(`https://[${address}]`);
    return prefix === undefined || Number(prefix) <= 128;
  } catch {
    return false;
  }
}

function webhookValues(payload = {}) {
  const label = labelValue(payload.label);
  const url = String(payload.url || "").trim();
  let parsed;
  try { parsed = new URL(url); } catch { fail("回调地址须为公网 HTTPS 地址"); }
  const host = parsed.hostname.toLowerCase();
  // No DNS lookup is performed in the demo. Reject the common local targets
  // synchronously; the real endpoint performs its own complete network guard.
  const local = host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.startsWith("[") || /^(?:0|10|127)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host);
  if (url.length > 2000 || parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.hash || local || !host.includes(".")) fail("回调地址须为公网 HTTPS 地址");
  return { label, url, events: choices(payload.events, EVENTS, "事件"), enabled: payload.enabled ?? true };
}

/**
 * Same unwrapped return values as legacy-modules/services/developerApi.js.
 * `now` accepts a Date/epoch/ISO value or a clock function for repeatable tests.
 * Retry progression is deterministic: first list shows pending, next list shows
 * delivered. A disabled endpoint pauses this progression until enabled again.
 */
export function createDeveloperDemoClient({ now = Date.now } = {}) {
  const timestamp = () => {
    const value = new Date(typeof now === "function" ? now() : now).getTime();
    if (!Number.isFinite(value)) throw new TypeError("演示时钟无效");
    return value;
  };
  const iso = (offset = 0) => new Date(timestamp() + offset).toISOString();
  let serial = 100;
  let keys = [];
  let models = [];
  let webhooks = [];
  let deliveries = [];
  let requests = [];
  const retrySteps = new Map();
  const nextID = (kind) => `demo_${kind}_${++serial}`;
  const secretFor = (id) => `${id}_preview_only_never_use_in_production`;

  const newKey = (values, id, prefix) => ({
    id, prefix, label: "", status: "active", scopes: [...SCOPES], allowedModelIds: [],
    dailyTaskLimit: 100, monthlyTaskLimit: 2000, dailySpendLimitCents: 10000,
    monthlySpendLimitCents: 200000, ipAllowlist: [], rateLimitPerMinute: 120,
    dailyByteLimit: 2 * GIB, autoFrozenAt: null, freezeReason: null,
    usage: emptyUsage(), expiresAt: null, expiresSoon: false, lastUsedAt: null,
    lastUsedIp: null, lastError: null, recentIps: [], createdAt: iso(), updatedAt: iso(),
    ...clone(values),
  });

  function reset(scenario = "normal") {
    if (!["normal", "empty", "issues"].includes(scenario)) fail("未知演示场景");
    retrySteps.clear();
    serial = 100;
    models = [
      { id: "demo-image-v1", name: "星绘 · 通用生图", kind: "image", tool: "text2img", priceCents: 20, maxImages: 4, maxReferenceImages: 4, resolutions: ["1K", "2K"], aspectRatios: ["1:1", "16:9", "9:16", "4:3"], qualities: ["standard", "high"], supportsExactSize: false, exactSizeLimits: null },
      { id: "demo-edit-v1", name: "星绘 · 图像编辑", kind: "image", tool: "image-edit", priceCents: 30, maxImages: 2, maxReferenceImages: 6, resolutions: ["1K", "2K"], aspectRatios: ["1:1", "16:9", "9:16"], qualities: ["standard", "high"], supportsExactSize: false, exactSizeLimits: null },
      { id: "demo-upscale-v1", name: "星绘 · 高清放大", kind: "image", tool: "upscale", priceCents: 15, maxImages: 1, maxReferenceImages: 1, resolutions: ["2K", "4K"], aspectRatios: [], qualities: [], supportsExactSize: false, exactSizeLimits: null },
    ];
    if (scenario === "empty") {
      keys = []; webhooks = []; deliveries = []; requests = [];
      return { scenario };
    }
    keys = [
      newKey({ label: "生产环境 · 图像服务", createdAt: iso(-28 * DAY), lastUsedAt: iso(-90_000), lastUsedIp: "203.0.113.24", ipAllowlist: ["203.0.113.24/32"], usage: { todayTasks: 42, monthTasks: 638, todaySpendCents: 840, monthSpendCents: 12760, todayBytes: Math.round(.42 * GIB) } }, "demo_key_production", "demo_prod_"),
      newKey({ label: "批量创作 · 高用量", dailyTaskLimit: 500, monthlyTaskLimit: 10000, dailySpendLimitCents: 10000, lastUsedAt: iso(-180_000), lastUsedIp: "198.51.100.42", createdAt: iso(-21 * DAY), usage: { todayTasks: 468, monthTasks: 4820, todaySpendCents: 9360, monthSpendCents: 96400, todayBytes: Math.round(1.72 * GIB) } }, "demo_key_batch", "demo_batch_"),
      newKey({ label: "短期活动 · 即将到期", expiresAt: iso(3 * DAY), expiresSoon: true, allowedModelIds: ["demo-image-v1"], lastUsedAt: iso(-1_800_000), createdAt: iso(-18 * DAY), usage: { todayTasks: 8, monthTasks: 126, todaySpendCents: 160, monthSpendCents: 2520, todayBytes: Math.round(.06 * GIB) } }, "demo_key_campaign", "demo_campaign_"),
      newKey({ label: "联调环境 · 已冻结", status: "frozen", autoFrozenAt: iso(-3_600_000), freezeReason: "请求频率持续超过限制，请联系管理员核查。", lastError: "api_key_temporarily_blocked", lastUsedAt: iso(-3_600_000), createdAt: iso(-24 * DAY), usage: { todayTasks: 17, monthTasks: 98, todaySpendCents: 340, monthSpendCents: 1960, todayBytes: Math.round(.15 * GIB) } }, "demo_key_frozen", "demo_staging_"),
      newKey({ label: "旧版接入 · 已撤销", status: "revoked", lastUsedAt: iso(-10 * DAY), createdAt: iso(-40 * DAY), updatedAt: iso(-9 * DAY) }, "demo_key_revoked", "demo_archive_"),
    ];
    webhooks = [
      { id: "demo_hook_production", label: "生产环境 · 任务通知", url: "https://api.example.com/webhooks/starcloud", events: [...EVENTS], enabled: true, createdAt: iso(-28 * DAY), updatedAt: iso(-2 * DAY) },
      { id: "demo_hook_alerts", label: "异常任务 · 告警", url: "https://alerts.example.com/hooks/tasks", events: ["task.failed"], enabled: true, createdAt: iso(-14 * DAY), updatedAt: iso(-DAY) },
      { id: "demo_hook_staging", label: "联调环境 · 已暂停", url: "https://staging.example.com/webhooks/starcloud", events: [...EVENTS], enabled: false, createdAt: iso(-7 * DAY), updatedAt: iso(-DAY) },
    ];
    deliveries = Array.from({ length: 7 }, (_, index) => {
      const status = index === 1 ? "dead" : index === 3 ? "pending" : "delivered";
      const eventType = index === 1 ? "task.failed" : index === 5 ? "task.canceled" : "task.succeeded";
      return { id: `demo_delivery_${index + 1}`, endpointId: index === 1 ? "demo_hook_alerts" : "demo_hook_production", eventType, sourceId: `demo_task_${2401 + index}`, status, attempts: status === "dead" ? 8 : status === "pending" ? 0 : 1, responseStatus: status === "dead" ? 503 : status === "delivered" ? 200 : null, lastError: status === "dead" ? "HTTP 503：回调服务暂时不可用" : null, deliveredAt: status === "delivered" ? iso(-index * 1_800_000 - 58_000) : null, createdAt: iso(-index * 1_800_000 - 60_000) };
    });
    requests = Array.from({ length: 8 }, (_, index) => {
      const statusCode = index === 2 ? 429 : index === 6 ? 422 : index % 3 === 0 ? 200 : 201;
      const method = statusCode === 200 ? "GET" : "POST";
      const path = method === "GET" ? "/api/open/v1/models" : "/api/open/v1/tasks";
      const requestId = `demo_request_${8301 + index}`;
      return { id: requestId, requestId, method, path, statusCode, durationMs: [84, 216, 32, 76, 184, 231, 47, 192][index], keyId: index === 2 ? "demo_key_batch" : "demo_key_production", keyLabel: index === 2 ? "批量创作 · 高用量" : "生产环境 · 图像服务", modelId: method === "POST" ? "demo-image-v1" : null, createdAt: iso(-index * 600_000 - 120_000), request: method === "POST" ? { type: "t2i", prompt: "清晨山谷中的玻璃小屋，柔和自然光", count: 1, params: {modelId: "demo-image-v1", aspectRatio: "16:9"} } : null, response: statusCode >= 400 ? { success: false, code: statusCode === 429 ? "api_key_daily_limit" : "validation_error", error: statusCode === 429 ? "当日任务数或积分额度已满" : "请求参数不完整" } : { success: true, data: method === "POST" ? { id: `demo_task_${2401 + index}`, status: "queued" } : { items: clone(models) } } };
    });
    if (scenario === "issues") {
      keys[0].status = "frozen";
      keys[0].autoFrozenAt = iso(-120_000);
      keys[0].freezeReason = "单日传输额度已用完，请联系管理员核查。";
      keys[0].usage.todayBytes = keys[0].dailyByteLimit;
      keys[1].usage.todayTasks = 500;
      keys[1].usage.todaySpendCents = 10000;
      keys[2].expiresAt = iso(-DAY);
      keys[2].label = "短期活动 · 已过期";
      deliveries = deliveries.map((item, index) => index < 4 ? { ...item, status: "dead", attempts: 8, responseStatus: index % 2 ? 503 : null, lastError: index % 2 ? "HTTP 503：回调服务暂时不可用" : "连接超时，请检查回调服务", deliveredAt: null } : item);
    }
    return { scenario };
  }

  function keyValues(payload = {}) {
    const label = labelValue(payload.label);
    const scopes = choices(payload.scopes, SCOPES, "权限");
    const available = models.map((item) => item.id);
    const allowedModelIds = payload.allowedModelIds?.length ? choices(payload.allowedModelIds, available, "模型") : [];
    const dailyTaskLimit = integer(payload.dailyTaskLimit, 100, 1, 100000, "每日任务额度");
    const monthlyTaskLimit = integer(payload.monthlyTaskLimit, 2000, dailyTaskLimit, 1000000, "每月任务额度");
    const dailySpendLimitCents = integer(payload.dailySpendLimitCents, 10000, 1, 1000000000, "每日积分额度");
    const monthlySpendLimitCents = integer(payload.monthlySpendLimitCents, 200000, dailySpendLimitCents, 10000000000, "每月积分额度");
    const rateLimitPerMinute = integer(payload.rateLimitPerMinute, 120, 1, 10000, "每分钟请求上限");
    const dailyByteLimit = integer(payload.dailyByteLimit, 2 * GIB, 1024 ** 2, 1024 ** 4, "每日流量额度");
    if (payload.ipAllowlist != null && !Array.isArray(payload.ipAllowlist)) fail("IP 白名单格式无效");
    const ipAllowlist = [...new Set((payload.ipAllowlist || []).map((value) => String(value).trim()).filter(Boolean))];
    if ((payload.ipAllowlist?.length || 0) > 20 || ipAllowlist.some((value) => !validIPOrCIDR(value))) fail("IP 白名单最多 20 项，仅支持 IP 或 CIDR");
    let expiresAt = null;
    if (payload.expiresAt) {
      const value = new Date(payload.expiresAt).getTime();
      if (!Number.isFinite(value) || value <= timestamp()) fail("到期时间须晚于当前时间");
      expiresAt = new Date(value).toISOString();
    }
    return { label, scopes, allowedModelIds, dailyTaskLimit, monthlyTaskLimit, dailySpendLimitCents, monthlySpendLimitCents, rateLimitPerMinute, dailyByteLimit, ipAllowlist, expiresAt };
  }

  function requireKey(id) {
    const key = keys.find((item) => item.id === id && item.status !== "revoked");
    if (!key) fail("API Key 不存在或已撤销", "api_key_not_found", 404);
    return key;
  }

  function requireWebhook(id) {
    const endpoint = webhooks.find((item) => item.id === id);
    if (!endpoint) fail("Webhook 不存在", "webhook_not_found", 404);
    return endpoint;
  }

  reset();
  return {
    reset,
    async listAPIKeys({ signal } = {}) {
      checkSignal(signal);
      return clone(keys.map((item) => ({ ...item, expiresSoon: Boolean(item.expiresAt && new Date(item.expiresAt).getTime() > timestamp() && new Date(item.expiresAt).getTime() < timestamp() + 14 * DAY) })));
    },
    async listDeveloperModels({ signal } = {}) { checkSignal(signal); return clone(models); },
    async listWebhooks({ signal } = {}) { checkSignal(signal); return clone(webhooks); },
    async listRequestSamples({ signal } = {}) { checkSignal(signal); return clone(requests); },
    async listWebhookDeliveries({ signal } = {}) {
      checkSignal(signal);
      for (const [id, remaining] of retrySteps) {
        const item = deliveries.find((delivery) => delivery.id === id);
        if (!item) { retrySteps.delete(id); continue; }
        if (!webhooks.find((endpoint) => endpoint.id === item.endpointId)?.enabled) continue;
        if (remaining > 0) { retrySteps.set(id, remaining - 1); continue; }
        Object.assign(item, { status: "delivered", attempts: item.attempts + 1, responseStatus: 200, lastError: null, deliveredAt: iso() });
        retrySteps.delete(id);
      }
      return clone(deliveries);
    },
    async createAPIKey(payload) {
      if (keys.filter((item) => item.status !== "revoked").length >= 10) fail("每个账号最多保留 10 个有效 API Key", "api_key_limit");
      const values = keyValues(payload);
      const id = nextID("key");
      const key = newKey(values, id, `${id}_`);
      keys.unshift(key);
      return clone({ ...key, secret: secretFor(id) });
    },
    async rotateAPIKey(id) {
      const current = requireKey(id);
      if (current.status !== "active") fail("仅可轮换有效 Key，已冻结的 Key 请联系管理员", "api_key_not_active", 403);
      const nextId = nextID("key");
      const replacement = { ...clone(current), id: nextId, prefix: `${nextId}_`, usage: emptyUsage(), lastUsedAt: null, lastUsedIp: null, lastError: null, recentIps: [], createdAt: iso(), updatedAt: iso() };
      current.status = "revoked";
      current.updatedAt = iso();
      keys.unshift(replacement);
      return clone({ ...replacement, secret: secretFor(nextId) });
    },
    async revokeAPIKey(id) {
      const key = requireKey(id);
      key.status = "revoked";
      key.updatedAt = iso();
      return null;
    },
    async createWebhook(payload) {
      if (webhooks.length >= 10) fail("每个账号最多配置 10 个 Webhook", "webhook_limit");
      const values = webhookValues(payload);
      const id = nextID("hook");
      const endpoint = { id, ...values, createdAt: iso(), updatedAt: iso() };
      webhooks.unshift(endpoint);
      return clone({ ...endpoint, secret: secretFor(id) });
    },
    async updateWebhook(id, payload) {
      const endpoint = requireWebhook(id);
      const values = webhookValues(payload);
      Object.assign(endpoint, values, { updatedAt: iso() });
      return clone({ ...endpoint, ...(payload.rotateSecret ? { secret: secretFor(nextID("hook_secret")) } : {}) });
    },
    async deleteWebhook(id) {
      requireWebhook(id);
      webhooks = webhooks.filter((item) => item.id !== id);
      deliveries = deliveries.filter((item) => item.endpointId !== id);
      return null;
    },
    async retryWebhookDelivery(id) {
      const delivery = deliveries.find((item) => item.id === id && item.status === "dead");
      if (!delivery) fail("投递记录不存在或当前无需重试", "webhook_delivery_not_retryable", 404);
      delivery.status = "pending";
      delivery.lastError = null;
      retrySteps.set(id, 1);
      return { status: "pending" };
    },
  };
}
