import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = 'http://127.0.0.1:8144'
assert.ok(process.argv.slice(2).every(arg => ['--apply', '--add-only', '--recharge-only', '--concurrency-only', '--refund-window-only'].includes(arg)), 'Unsupported argument')
const apply = process.argv.includes('--apply')
const addOnly = process.argv.includes('--add-only')
const rechargeOnly = process.argv.includes('--recharge-only')
const concurrencyOnly = process.argv.includes('--concurrency-only')
const refundWindowOnly = process.argv.includes('--refund-window-only')
assert.ok([addOnly, rechargeOnly, concurrencyOnly, refundWindowOnly].filter(Boolean).length <= 1, 'Choose one update mode')
const fixedPackCodes = ['lab-basic', 'lab-plus', 'credits-growth', 'credits-studio']
const common = { active: true, recommended: false, badge: '', bonusCents: 0 }
const policy = (tier, concurrencyBonus, allowTopupPriceLock) => ({
  version: 2, series: 'general', tier, channels: ['web', 'api'], featureKeys: [], modelIds: [],
  refundWindowHours: 3, lockModelPrices: true, concurrencyBonus, allowTopupPriceLock,
})
const sub = (code, name, description, priceCents, durationDays, dailyGrantCents, subscriptionPolicy, sort) => ({
  ...common, code, name, description, kind: 'subscription', priceCents, durationDays, dailyGrantCents,
  grantCents: 0, priceLockEligible: false, subscriptionPolicy, sort,
  features: ['每24小时重置，未用积分不结转', '网站与 API 通用'],
})
const pack = (code, name, description, priceCents, grantCents, priceLockEligible, sort) => ({
  ...common, code, name, description, kind: 'topup', priceCents, grantCents,
  durationDays: 0, dailyGrantCents: 0, priceLockEligible, sort,
  features: ['一次到账，按需使用', '订阅到期不影响剩余额度'],
})

// Sandbox recovery depends on these legacy codes; only customer-facing names and future terms change.
const catalog = [
  sub('lab-sub', '轻享 3 日订阅', '适合短期项目与轻量创作', 1990, 3, 100, policy(1, 2, false), 10),
  sub('creator-intensive-3d', '畅享 3 日订阅', '适合短期集中创作与快速交付', 2990, 3, 200, policy(2, 4, true), 15),
  sub('lab-sub-plus', '进阶 7 日订阅', '适合持续创作与每周内容更新', 3990, 7, 200, policy(2, 4, true), 20),
  sub('creator-intensive-7d', '高阶 7 日订阅', '适合高强度周度项目与批量出图', 6990, 7, 500, policy(3, 8, true), 25),
  { ...sub('creator-monthly', '专业 30 日订阅', '适合高频创作与长期项目', 12990, 30, 500, policy(3, 8, true), 30), recommended: true, badge: '长期创作' },
  sub('creator-flagship-30d', '旗舰 30 日订阅', '适合专业创作者的持续高频生产', 22990, 30, 1000, policy(4, 12, true), 40),
  { ...pack('custom-recharge', '自定义充值', '整数金额充值，最低1元', 100, 100, true, 10), rechargePolicy: { pointsPerYuan: 100, priceLockMinYuan: 30 } },
]
console.table(catalog.map(p => ({ name: p.name, yuan: p.priceCents / 100, days: p.durationDays,
  points: p.dailyGrantCents || p.grantCents, packProtection: p.kind === 'topup' ? p.priceLockEligible : p.subscriptionPolicy.allowTopupPriceLock })))
if (!apply) {
  console.log('Preview only. Use --apply to update the existing isolated sandbox; never production.')
  process.exit(0)
}

const stateResponse = await fetch(`${base}/__sandbox/state`)
assert.equal(stateResponse.status, 200)
const before = await stateResponse.json()
assert.match(before.db, /^sc_payment_lab_[a-f0-9]{12}$/)
const backup = mkdtempSync(resolve(root, '.artifacts/payment-sandbox-8144/before-commercial-plans-'))
const dumpFile = resolve(backup, 'database.dump')
const dumped = spawnSync('pg_dump', ['--format=custom', '--file', dumpFile, `postgres://localhost:5432/${before.db}?sslmode=disable`], { encoding: 'utf8' })
assert.equal(dumped.status, 0, dumped.stderr)
chmodSync(dumpFile, 0o600)
console.log(`Recoverable database backup: ${backup}`)

const login = await fetch(`${base}/api/v1/admin/auth/session`, {
  method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: before.adminEmail, password: before.adminPassword }),
})
assert.ok(login.ok, `Admin login failed: ${login.status}`)
const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
assert.ok(cookie)
async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, { method,
    headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const payload = await response.json()
  assert.ok(response.ok && payload.success !== false, `${path}: ${JSON.stringify(payload)}`)
  return payload.data ?? payload
}
const existing = (await request('/api/v1/admin/plans')).items
writeFileSync(resolve(backup, 'plans.json'), JSON.stringify(existing, null, 2), { mode: 0o600, flag: 'wx' })
if (refundWindowOnly) {
  for (const old of existing.filter(p => p.active && p.kind === 'subscription' && (p.subscriptionPolicy?.refundWindowHours ?? 24) === 24)) {
    const saved = await request(`/api/v1/admin/plans/${old.id}`, 'PATCH', { subscriptionPolicy: { ...old.subscriptionPolicy, refundWindowHours: 3 } })
    assert.equal(saved.subscriptionPolicy.refundWindowHours, 3)
    console.log(`Refund window: ${saved.name} → 3 hours (revision ${saved.revision})`)
  }
  process.exit(0)
}
const codes = new Set(catalog.map(p => p.code))
assert.ok(addOnly || rechargeOnly || concurrencyOnly || existing.every(p => !p.active || codes.has(p.code) || fixedPackCodes.includes(p.code)), 'Unexpected active plans: review them before modifying this catalog')
const targets = concurrencyOnly ? catalog.filter(p => p.kind === 'subscription' && existing.some(old => old.code === p.code)) : rechargeOnly ? catalog.filter(p => p.rechargePolicy) : addOnly ? catalog.filter(p => !existing.some(old => old.code === p.code)) : catalog
for (const p of targets) {
  const old = existing.find(item => item.code === p.code)
  if (concurrencyOnly) {
    const { taskConcurrency, assistantConcurrency, ...previous } = old.subscriptionPolicy
    const saved = await request(`/api/v1/admin/plans/${old.id}`, 'PATCH', { subscriptionPolicy: { ...previous, concurrencyBonus: p.subscriptionPolicy.concurrencyBonus } })
    console.log(`Concurrency bonus: ${saved.name} +${saved.subscriptionPolicy.concurrencyBonus}`)
    continue
  }
  if (old && Object.entries(p).every(([key, value]) => JSON.stringify(old[key]) === JSON.stringify(value))) continue
  const saved = await request(old ? `/api/v1/admin/plans/${old.id}` : '/api/v1/admin/plans', old ? 'PATCH' : 'POST', p)
  assert.equal(saved.code, p.code)
  console.log(`Configured: ${saved.name} (v${saved.revision})`)
}
const visible = (await request('/api/v1/plans')).items
const expectedCodes = new Set(existing.filter(p => p.active).map(p => p.code))
if (!concurrencyOnly) for (const p of targets) expectedCodes.add(p.code)
assert.equal(visible.length, expectedCodes.size)
const updated = (await request('/api/v1/admin/plans')).items
for (const expected of targets) {
  if (concurrencyOnly) {
    const actual = updated.find(p => p.code === expected.code)
    assert.equal(actual.subscriptionPolicy.concurrencyBonus, expected.subscriptionPolicy.concurrencyBonus)
    continue
  }
  const actual = visible.find(p => p.code === expected.code)
  assert.ok(actual)
  for (const key of ['name', 'kind', 'priceCents', 'durationDays', 'dailyGrantCents', 'grantCents', 'priceLockEligible', 'recommended']) {
    assert.deepEqual(actual[key], expected[key], `${expected.code}.${key}`)
  }
  if (expected.kind === 'subscription') assert.deepEqual(actual.subscriptionPolicy, expected.subscriptionPolicy)
  if (expected.rechargePolicy) assert.deepEqual(actual.rechargePolicy, expected.rechargePolicy)
}
if (addOnly || rechargeOnly) {
  for (const old of existing.filter(p => !rechargeOnly || p.code !== 'custom-recharge')) assert.deepEqual(updated.find(p => p.id === old.id), old, `Existing plan changed: ${old.code}`)
}
if (concurrencyOnly) for (const old of existing) {
  const current = updated.find(p => p.id === old.id)
  if (!targets.some(p => p.code === old.code)) { assert.deepEqual(current, old); continue }
  const withoutConcurrency = p => {
    const { revision, updatedAt, subscriptionPolicy, ...other } = p
    const { concurrencyBonus, taskConcurrency, assistantConcurrency, ...rights } = subscriptionPolicy
    return { ...other, subscriptionPolicy: rights }
  }
  assert.deepEqual(withoutConcurrency(current), withoutConcurrency(old), `Unrelated plan terms changed: ${old.code}`)
}
const after = await (await fetch(`${base}/__sandbox/state`)).json()
const financialState = state => state.accounts.map(a => ({ id: a.account.id, balance: a.balance, summary: a.summary, subscription: a.subscription,
  available: a.subscriptionAvailable, held: a.subscriptionHeld, spent: a.subscriptionSpent })).sort((a, b) => a.id.localeCompare(b.id))
assert.deepEqual(financialState(after), financialState(before), 'Existing customer financial data changed')
console.log(`Verified ${visible.length} public plans; existing orders, subscriptions and balances unchanged. ${base}/pricing`)
