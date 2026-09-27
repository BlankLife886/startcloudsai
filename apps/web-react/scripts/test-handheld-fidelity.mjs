import assert from 'node:assert/strict'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))
const vite = await createServer({
  root,
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true },
})
const m = await vite.ssrLoadModule('/src/legacy-modules/features/ecommerce/handheldCommerce.js')
test.after(() => vite.close())

const base = {
  pose: 'grip', hand: 'right', crop: 'wrist', lens: 'macro', light: 'rim',
  camera: 'low', depth: 'shallow', platform: 'taobao', pack: 'listing',
  hasHand: true, hasScene: true, aspectRatio: '1:1',
}

test('用户所选放在提示词最前面，用中文名而不是英文 id', () => {
  const prompt = m.buildHandheldTaskPrompt(base)
  const lines = prompt.split('\n')
  assert.match(lines[1], /^用户已选/)
  assert.match(lines[1], /握持=自然握持/)
  assert.match(lines[1], /镜头=微距/)
  assert.doesNotMatch(lines[1], /grip|macro|rim/)
})

test('只有正面图：限制转角，禁止臆造看不见的面', () => {
  const prompt = m.buildHandheldTaskPrompt(base)
  assert.match(prompt, /只提供了正面图/)
  assert.match(prompt, /不超过 30°/)
})

test('补了侧面/背面：说明是同一件商品，角色和身份锁都带上', () => {
  const angleRoles = ['productSide', 'productBack']
  const prompt = m.buildHandheldTaskPrompt({ ...base, angleRoles })
  assert.match(prompt, /另外提供了商品侧面、商品背面参考/)
  assert.doesNotMatch(prompt, /只提供了正面图/)
  assert.deepEqual(
    m.handheldReferenceLabels({ hasHand: true, hasScene: true, angleRoles }),
    ['商品身份', '商品侧面', '商品背面', '手部身份', '场景环境'],
  )
  assert.match(m.buildHandheldIdentityLock({ hasHand: true, angleCount: 2 }), /第 2–3 张是同一件商品的其他角度/)
})

test('微距 + 场景：提示冲突并写明谁让步', () => {
  const ids = m.handheldSelectionConflicts({ ...base, angleRoles: [] }).map((c) => c.id)
  assert.ok(ids.includes('macro-scene'))
  assert.ok(ids.includes('use-sharp'))
  assert.ok(ids.includes('front-only'))
  assert.match(m.buildHandheldTaskPrompt(base), /冲突处理：已选场景参考，微距只用于拉近主体/)
})

test('全身出镜 + 微距：按标准镜头处理', () => {
  const conflicts = m.handheldSelectionConflicts({ lens: 'macro', crop: 'full', pack: 'single' })
  assert.equal(conflicts[0].id, 'macro-full')
})

test('没有冲突时不出现冲突处理', () => {
  const prompt = m.buildHandheldTaskPrompt({ pack: 'single', platform: 'taobao', crop: 'wrist', angleRoles: [] })
  assert.doesNotMatch(prompt, /冲突处理/)
  assert.deepEqual(m.handheldSelectionConflicts({ pack: 'single', crop: 'wrist' }), [])
})

test('套图：平台主图规则只严格约束主图位', () => {
  assert.match(m.buildHandheldTaskPrompt(base), /主图位严格遵守；套图其他张/)
  assert.doesNotMatch(
    m.buildHandheldTaskPrompt({ ...base, pack: 'single' }),
    /主图位严格遵守/,
  )
})
