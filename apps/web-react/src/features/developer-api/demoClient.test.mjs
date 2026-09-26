import test from "node:test";
import assert from "node:assert/strict";
import { createDeveloperDemoClient } from "./demoClient.js";

const now = "2026-09-09T04:00:00.000Z";
const makeClient = () => createDeveloperDemoClient({ now });
const webhookDraft = { label: "演示回调", url: "https://demo.example.com/hooks", events: ["task.succeeded"], enabled: true };

test("normal scenario covers key lifecycle, quotas, webhook status and request examples", async () => {
  const client = makeClient();
  const keys = await client.listAPIKeys();
  assert.deepEqual([...new Set(keys.map((item) => item.status))].sort(), ["active", "frozen", "revoked"]);
  assert.ok(keys.some((item) => item.expiresSoon));
  assert.ok(keys.some((item) => item.usage.todayTasks / item.dailyTaskLimit > .9));
  assert.ok((await client.listWebhooks()).some((item) => !item.enabled));
  assert.deepEqual([...new Set((await client.listWebhookDeliveries()).map((item) => item.status))].sort(), ["dead", "delivered", "pending"]);
  assert.ok((await client.listRequestSamples()).some((item) => item.statusCode === 429));
});

test("instances, payloads and returned nested values do not share mutable state", async () => {
  const first = makeClient();
  const second = makeClient();
  const keys = await first.listAPIKeys();
  keys[0].usage.todayTasks = -100;
  keys[0].scopes.length = 0;
  assert.equal((await first.listAPIKeys())[0].usage.todayTasks, 42);
  assert.equal((await first.listAPIKeys())[0].scopes.length, 4);
  const draft = { label: "新应用", scopes: ["tasks:read"] };
  const created = await first.createAPIKey(draft);
  draft.scopes.push("tasks:write");
  created.scopes.length = 0;
  assert.deepEqual((await first.listAPIKeys())[0].scopes, ["tasks:read"]);
  assert.equal((await second.listAPIKeys()).length, 5);
});

test("key creation and rotation reveal demo secret once and retain revoked history", async () => {
  const client = makeClient();
  const created = await client.createAPIKey({ label: "新应用" });
  assert.match(created.secret, /^demo_/);
  assert.equal(created.status, "active");
  assert.ok(!(await client.listAPIKeys()).some((item) => "secret" in item));
  const rotated = await client.rotateAPIKey(created.id);
  assert.notEqual(rotated.id, created.id);
  assert.notEqual(rotated.secret, created.secret);
  assert.equal((await client.listAPIKeys()).find((item) => item.id === created.id).status, "revoked");
  assert.equal(await client.revokeAPIKey(rotated.id), null);
  await assert.rejects(client.revokeAPIKey(rotated.id), { code: "api_key_not_found" });
  await assert.rejects(client.rotateAPIKey("demo_key_frozen"), { code: "api_key_not_active" });
});

test("invalid quotas, models, expiry, IPs and maximum key count are rejected without creating records", async () => {
  const client = makeClient();
  for (const payload of [
    { dailyTaskLimit: 200, monthlyTaskLimit: 100 },
    { dailySpendLimitCents: 1000, monthlySpendLimitCents: 100 },
    { dailyByteLimit: 10 }, { expiresAt: "2026-01-01" },
    { allowedModelIds: ["not-a-model"] }, { scopes: ["admin:write"] },
    { ipAllowlist: ["999.1.1.1"] }, { ipAllowlist: ["203.0.113.1/64"] },
  ]) await assert.rejects(client.createAPIKey({ label: "无效", ...payload }), { code: "validation_error" });
  assert.equal((await client.listAPIKeys()).length, 5);
  for (let i = 0; i < 6; i++) await client.createAPIKey({ label: `应用 ${i}` });
  await assert.rejects(client.createAPIKey({ label: "超额" }), { code: "api_key_limit" });
});

test("webhook CRUD never retains secrets and deleting also removes related deliveries", async () => {
  const client = makeClient();
  const created = await client.createWebhook(webhookDraft);
  assert.match(created.secret, /^demo_/);
  const edited = await client.updateWebhook(created.id, { ...webhookDraft, enabled: false });
  assert.equal(edited.enabled, false);
  assert.ok(!("secret" in edited));
  const rotated = await client.updateWebhook(created.id, { ...webhookDraft, rotateSecret: true });
  assert.match(rotated.secret, /^demo_/);
  assert.notEqual(rotated.secret, created.secret);
  assert.ok(!(await client.listWebhooks()).some((item) => "secret" in item));
  await client.deleteWebhook("demo_hook_production");
  assert.ok(!(await client.listWebhookDeliveries()).some((item) => item.endpointId === "demo_hook_production"));
  await assert.rejects(client.createWebhook({ ...webhookDraft, url: "http://example.com/hooks" }), { code: "validation_error" });
  await assert.rejects(client.createWebhook({ ...webhookDraft, url: "https://127.0.0.1/hooks" }), { code: "validation_error" });
});

test("manual retry is observable as pending then delivered and waits for enabled endpoint", async () => {
  const client = makeClient();
  const failed = (await client.listWebhookDeliveries()).find((item) => item.status === "dead");
  const hook = (await client.listWebhooks()).find((item) => item.id === failed.endpointId);
  await client.updateWebhook(hook.id, { ...hook, enabled: false });
  assert.deepEqual(await client.retryWebhookDelivery(failed.id), { status: "pending" });
  for (let i = 0; i < 3; i++) assert.equal((await client.listWebhookDeliveries()).find((item) => item.id === failed.id).status, "pending");
  await client.updateWebhook(hook.id, { ...hook, enabled: true });
  assert.equal((await client.listWebhookDeliveries()).find((item) => item.id === failed.id).status, "pending");
  const delivered = (await client.listWebhookDeliveries()).find((item) => item.id === failed.id);
  assert.equal(delivered.status, "delivered");
  assert.equal(delivered.attempts, failed.attempts + 1);
  assert.equal(delivered.lastError, null);
  assert.equal(delivered.responseStatus, 200);
  await assert.rejects(client.retryWebhookDelivery(failed.id), { code: "webhook_delivery_not_retryable" });
});

test("reset restores each scenario and empty keeps model catalog available for first key", async () => {
  const client = makeClient();
  client.reset("empty");
  for (const list of [client.listAPIKeys, client.listWebhooks, client.listWebhookDeliveries, client.listRequestSamples]) assert.deepEqual(await list(), []);
  assert.equal((await client.listDeveloperModels()).length, 3);
  await client.createAPIKey({ label: "首个应用" });
  client.reset("issues");
  assert.equal((await client.listAPIKeys()).filter((item) => item.status === "frozen").length, 2);
  assert.equal((await client.listWebhookDeliveries()).filter((item) => item.status === "dead").length, 4);
  client.reset();
  assert.equal((await client.listAPIKeys()).length, 5);
  assert.throws(() => client.reset("unknown"), { code: "validation_error" });
});

test("abort and injected clock are respected without network or browser globals", async () => {
  let clock = Date.parse(now);
  const client = createDeveloperDemoClient({ now: () => clock });
  assert.ok((await client.listAPIKeys()).find((item) => item.id === "demo_key_campaign").expiresSoon);
  clock += 4 * 86400000;
  assert.equal((await client.listAPIKeys()).find((item) => item.id === "demo_key_campaign").expiresSoon, false);
  await assert.rejects(client.listAPIKeys({ signal: { aborted: true } }), { name: "AbortError" });
});
