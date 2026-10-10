import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

assert.deepEqual(process.argv.slice(2), ['--confirm'], 'Explicit reset required: node scripts/reset-payment-sandbox.mjs --confirm')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, '.artifacts/payment-sandbox-8144')
const base = 'http://127.0.0.1:8144'
const statePath = resolve(output, 'session-state.json')
const response = await fetch(`${base}/__sandbox/state`)
assert.equal(response.status, 200)
const before = await response.json()
assert.match(before.db, /^sc_payment_lab_[a-f0-9]{12}$/)
const manifest = JSON.parse(readFileSync(resolve(output, 'processes.json'), 'utf8'))
assert.equal(manifest.base, base)
assert.equal(manifest.processes.length, 3)
for (const child of manifest.processes) {
  const result = spawnSync('ps', ['-p', String(child.pid), '-o', 'command='], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(result.stdout.trim(), [child.command, ...child.args].join(' '), 'Refusing to stop an unrelated process')
}
const ids = before.accounts.map(item => item.account.id)
for (const id of ids) assert.match(id, /^[a-f0-9-]{36}$/)
const connection = `postgres://localhost:5432/${before.db}?sslmode=disable`
const backup = mkdtempSync(resolve(output, 'before-reset-'))
let stopped = false
try {
  for (const child of manifest.processes) process.kill(child.pid, 'SIGTERM')
  stopped = true
  for (let attempt = 0; ; attempt++) {
    const alive = manifest.processes.some(child => {
      const result = spawnSync('ps', ['-p', String(child.pid), '-o', 'command='], { encoding: 'utf8' })
      return result.status === 0 && result.stdout.trim() === [child.command, ...child.args].join(' ')
    })
    if (!alive) break
    assert.ok(attempt < 100, 'Sandbox processes did not stop; database was not reset')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const saved = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(saved.db, before.db)
  writeFileSync(resolve(backup, 'session-state.json'), JSON.stringify(saved, null, 2), { mode: 0o600, flag: 'wx' })
  writeFileSync(resolve(backup, 'summary.json'), JSON.stringify(before, null, 2), { mode: 0o600, flag: 'wx' })
  const dump = spawnSync('pg_dump', ['--format=custom', '--file', resolve(backup, 'database.dump'), connection], { encoding: 'utf8' })
  assert.equal(dump.status, 0, dump.stderr)
  const sql = `BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF current_database()<>'${before.db}' THEN RAISE EXCEPTION 'unexpected database'; END IF;
 IF EXISTS(SELECT 1 FROM users WHERE id NOT IN (${ids.map(id => `'${id}'::uuid`).join(',')}))
 OR (SELECT count(*) FROM users)<>${ids.length} THEN RAISE EXCEPTION 'unexpected accounts'; END IF;
 IF EXISTS(SELECT 1 FROM tasks) OR EXISTS(SELECT 1 FROM assistant_runs) THEN
  RAISE EXCEPTION 'non-billing work exists; refusing to reset its funding';
 END IF;
END $$;
DELETE FROM notification_reads;
DELETE FROM notification_dismissals;
DELETE FROM notifications WHERE user_id IS NOT NULL;
DELETE FROM payment_callback_events;
DELETE FROM payment_reconciliations;
DELETE FROM security_blocks;
DELETE FROM security_risk_events;
DELETE FROM admin_audit_logs;
DELETE FROM referral_rewards;
DELETE FROM billing_decisions;
DELETE FROM topup_credit_allocations;
DELETE FROM topup_credit_lots;
DELETE FROM subscription_credit_allocations;
DELETE FROM subscription_credit_lots;
DELETE FROM subscription_periods;
UPDATE orders SET subscription_change_id=NULL;
DELETE FROM subscription_changes;
DELETE FROM subscriptions;
DELETE FROM orders;
DELETE FROM task_credit_reservations;
DELETE FROM credit_reservations;
DELETE FROM wallet_ledger;
UPDATE wallets SET balance_cents=0,frozen_cents=0,trial_balance_cents=0,trial_frozen_cents=0,trial_feature_key=NULL,updated_at=now();
COMMIT;`
  const reset = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', connection], { input: sql, encoding: 'utf8' })
  assert.equal(reset.status, 0, reset.stderr)
  writeFileSync(statePath, JSON.stringify({ ...saved, clock: new Date().toISOString(), creates: 0, gateways: [], mode: 'normal' }, null, 2), { mode: 0o600 })
  console.log(`Reset ${before.accounts.reduce((n, item) => n + item.summary.total, 0)} orders. Recoverable backup: ${backup}`)
} finally {
  if (stopped) {
    const start = spawnSync(process.execPath, [resolve(root, 'scripts/payment-sandbox.mjs')], { cwd: root, stdio: 'inherit' })
    assert.equal(start.status, 0, 'Sandbox restart failed; backups remain available')
  }
}
const after = await (await fetch(`${base}/__sandbox/state`)).json()
assert.equal(after.db, before.db)
assert.equal(after.creates, 0)
assert.equal(after.gateways.length, 0)
for (const item of after.accounts) {
  assert.equal(item.balance, 0)
  assert.equal(item.summary.total, 0)
  assert.equal(item.subscription, null)
}
console.log(`Verified: ${after.accounts.length} retained accounts, no orders/subscriptions, zero balances. ${base}/__sandbox/`)
