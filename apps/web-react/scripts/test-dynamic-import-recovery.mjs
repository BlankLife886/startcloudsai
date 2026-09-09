import assert from 'node:assert/strict'
import {
  isDynamicImportFailure,
  shouldReloadDynamicImport,
} from '../src/utils/dynamicImportRecovery.js'

const chunkError = new TypeError(
  'Failed to fetch dynamically imported module: http://127.0.0.1:8080/assets/WalletView-old.js',
)

assert.equal(isDynamicImportFailure(chunkError), true)
assert.equal(shouldReloadDynamicImport(chunkError, '/wallet', ''), true)
assert.equal(
  shouldReloadDynamicImport(chunkError, '/wallet', '/wallet'),
  false,
  '同一路由只能自动刷新一次',
)
assert.equal(
  shouldReloadDynamicImport(new Error('wallet api failed'), '/wallet', ''),
  false,
  '业务接口错误不能触发整页刷新',
)

console.log('dynamic import recovery checks passed')
