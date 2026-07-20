import assert from 'node:assert/strict'
import {
  addUsd,
  clampUsd,
  formatUsd,
  formatMoneyDisplay,
  formatUsageCostUsd,
  isBillableUsageLog,
  mergeUsageSummary,
  resolveAvailableUsdBalance,
  resolveWalletSnapshot,
  subtractUsd,
  sumBillableUsageCost,
} from '../src/features/pricing/pricingMoney.js'

assert.equal(clampUsd(0.123456789), 0.1235)
assert.equal(addUsd(0.0001, 0.0002), 0.0003)
assert.equal(subtractUsd(100, 0.5597), 99.4403)

assert.equal(resolveAvailableUsdBalance({ balance: 100, frozenBalance: 0.3687 }), 99.6313)
assert.equal(
  resolveAvailableUsdBalance({ balance: 100, frozenBalance: 0.3687, availableBalance: 99.07 }),
  99.07,
)

const wallet = resolveWalletSnapshot({ balance: 100, frozenBalance: 0.3687, lifetimeSpent: 0.5597 })
assert.equal(wallet.availableBalance, 99.6313)
assert.equal(wallet.lifetimeSpent, 0.5597)

assert.equal(isBillableUsageLog({ status: 'success' }), true)
assert.equal(isBillableUsageLog({ status: 'reserved' }), false)
assert.equal(sumBillableUsageCost([
  { status: 'success', estimatedCostUsd: 0.1 },
  { status: 'reserved', estimatedCostUsd: 0.2 },
  { status: 'charged_failed', estimatedCostUsd: 0.05 },
]), 0.15)

assert.equal(formatUsd(99.07), '$99.0700')
assert.equal(formatUsd(0), '$0.0000')
assert.equal(formatMoneyDisplay(0.6884), '$0.6884')
assert.equal(formatUsageCostUsd(1.5), '$1.5000')

console.log('pricingMoney tests passed')
