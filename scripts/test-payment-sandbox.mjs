import assert from 'node:assert/strict'

// This smoke test only targets the isolated local harness, never a configurable API.
const port = 8144
assert.ok(!process.argv[2] || process.argv[2] === String(port), 'Use the single payment sandbox on port 8144')
const base = `http://127.0.0.1:${port}`
async function state() {
  const response = await fetch(`${base}/__sandbox/state`)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.match(data.db, /^sc_payment_lab_[a-f0-9]{12}$/)
  return data
}
const before = await state()
const html = await (await fetch(`${base}/__sandbox/`)).text()
const key = JSON.parse(html.match(/const key=("[a-f0-9]+");/)[1])
async function request(path, { cookie, body, form } = {}) {
  const response = await fetch(base + path, {
    method: body !== undefined || form ? 'POST' : 'GET',
    redirect: 'manual',
    headers: {
      Origin: base,
      'X-Sandbox-Key': key,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
  })
  if (form) {
    assert.equal(response.status, 303)
    return response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  }
  const data = await response.json()
  assert.ok(response.ok, `${path}: ${JSON.stringify(data)}`)
  return data.data ?? data
}
const cookie = await request('/__sandbox/enter', { form: new URLSearchParams({ key, account: 'demo', dest: '/orders' }) })
const admin = await request('/__sandbox/enter', { form: new URLSearchParams({ key, account: 'admin' }) })
const action = (action, extra = {}) => request('/__sandbox/action', { body: { action, ...extra } })
const plans = await request('/api/v1/plans')
assert.equal(plans.paymentEnabled, true)
const plan = plans.items.find(item => item.code === 'lab-basic')
const create = () => request('/api/v1/orders', { cookie, body: { planId: plan.id, paymentMethod: 'alipay' } })
const detail = id => request(`/api/v1/orders/${id}`, { cookie })
const provider = async id => (await state()).gateways.find(item => item.merchantId === id).id
const balance = async () => (await state()).accounts.find(item => item.account.key === 'demo').balance
const initial = await balance()

const normal = await create()
assert.equal(normal.status, 'pending')
assert.equal((await create()).id, normal.id)
const crossPlan = await fetch(`${base}/api/v1/orders`, {
  method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' },
  body: JSON.stringify({ planId: plans.items.find(item => item.code === 'lab-plus').id, paymentMethod: 'alipay' }),
})
assert.equal(crossPlan.status, 409)
assert.equal((await crossPlan.json()).code, 'user_unsettled_order')
console.log('PASS user-wide single unpaid order across plans')
await action('pay', { id: await provider(normal.id) })
assert.equal((await detail(normal.id)).status, 'completed')
assert.equal(await balance(), initial + 1200)
await action('callback', { id: await provider(normal.id) })
assert.equal(await balance(), initial + 1200)
console.log('PASS normal payment, pending order reuse, duplicate callback')

await action('mode', { mode: 'ambiguous' })
const uncertain = await create()
assert.equal(uncertain.status, 'uncertain')
const creates = (await state()).creates
assert.equal((await create()).id, uncertain.id)
assert.equal((await state()).creates, creates)
await request('/api/v1/admin/payment-reconciliations/run', { cookie: admin, body: { orderId: uncertain.id, providerOrderId: await provider(uncertain.id) } })
await action('pay', { id: await provider(uncertain.id) })
assert.equal((await detail(uncertain.id)).status, 'completed')
assert.equal(await balance(), initial + 2400)
console.log('PASS uncertain order reuse and administrator provider association')

await action('mode', { mode: 'not_created' })
const missing = await create()
assert.equal(missing.status, 'uncertain')
await request('/api/v1/admin/payment-reconciliations/run', { cookie: admin, body: { orderId: missing.id, resolution: 'not_created', note: 'Sandbox smoke: verified gateway did not create this order.' } })
assert.equal((await detail(missing.id)).status, 'failed')
console.log('PASS audited resolution for order never created by gateway')

const missed = await create()
await action('paid_only', { id: await provider(missed.id) })
await action('reconcile')
assert.equal((await detail(missed.id)).status, 'completed')
assert.equal(await balance(), initial + 3600)
console.log('PASS reconciliation recovers payment without callback')

const cancelled = await create()
await request(`/api/v1/orders/${cancelled.id}/close`, { cookie, body: null })
assert.equal((await detail(cancelled.id)).status, 'cancelled')
assert.equal(await balance(), initial + 3600)
console.log('PASS cancellation without credit grant')
const recovery = await request('/api/v1/admin/payment-reconciliations', { cookie: admin })
assert.equal(recovery.recoverySupported, true)
assert.ok(!recovery.items.some(item => item.orderId === missing.id && item.outcome === 'provider_id_missing'), 'manual resolution must stay out of the queue')
console.log(`PASS admin recovery capability. Demo balance: ${await balance()}. Database: ${before.db}`)
