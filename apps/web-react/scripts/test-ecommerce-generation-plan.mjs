import assert from 'node:assert/strict'
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

const [{
  buildEcommerceGenerationPlan,
  buildEcommerceRevisionPrompt,
  ecommerceConsistencyProfile,
  ecommerceShotBlueprints,
  listingShotBlueprintsFromCounts,
  prepareEcommerceInputFiles,
  supportedEcommerceModules,
}, {
  hasConsistencyCapacity,
  mapConsistencyReferenceRoles,
  orderConsistencyReferences,
}] = await Promise.all([
  vite.ssrLoadModule('/src/legacy-modules/features/ecommerce/ecommerceTools.js'),
  vite.ssrLoadModule('/src/legacy-modules/features/creative-studios/referenceConsistency.js'),
])
await vite.close()

const listingPlan = buildEcommerceGenerationPlan({
  modeId: 'listing',
  count: 4,
  selectedModules: ['hero', 'selling', 'scene', 'detail'],
  basePrompt: '商品：降噪耳机。',
  referenceCount: 3,
})

assert.equal(listingPlan.length, 4)
assert.deepEqual(
  listingPlan.map((item) => item.viewId),
  ['hero', 'selling', 'scene', 'detail'],
)
assert.equal(new Set(listingPlan.map((item) => item.prompt)).size, 4)
assert.ok(listingPlan.every((item) => item.prompt.includes('系列连续性锁')))
assert.ok(listingPlan.every((item) => item.prompt.includes('商品身份锁')))
assert.ok(listingPlan.every((item) => item.prompt.includes('商品身份角度 3')))
assert.ok(listingPlan[0].prompt.includes('第 1/4 张'))
assert.ok(listingPlan[3].prompt.includes('第 4/4 张'))

const smartListingPlan = buildEcommerceGenerationPlan({
  modeId: 'listing',
  count: 7,
  selectedModules: ['hero', 'selling', 'scene', 'mood', 'detail', 'spec', 'package'],
  basePrompt: '商品：节日礼盒。',
  referenceCount: 1,
})
assert.equal(smartListingPlan.length, 7)
assert.deepEqual(
  smartListingPlan.map((item) => item.viewId),
  ['hero', 'selling', 'scene', 'mood', 'detail', 'spec', 'package'],
)

const clonePlan = buildEcommerceGenerationPlan({
  modeId: 'clone',
  count: 4,
  basePrompt: '用新商品复刻参考视觉。',
  referenceCount: 2,
})
assert.equal(clonePlan.length, 4)
assert.ok(clonePlan.every((item) => item.prompt.includes('复刻分离锁')))
assert.ok(clonePlan.every((item) => item.prompt.includes('爆款视觉参考')))
assert.ok(clonePlan.every((item) => item.prompt.includes('商品身份')))

const customListingShots = listingShotBlueprintsFromCounts({
  white: 1,
  scene: 3,
  selling: 2,
  other: 1,
})
assert.equal(customListingShots.length, 7)
assert.deepEqual(
  customListingShots.map((item) => item.id),
  ['white-1', 'scene-1', 'scene-2', 'scene-3', 'selling-1', 'selling-2', 'other-1'],
)
const customListingPlan = buildEcommerceGenerationPlan({
  modeId: 'listing',
  count: 7,
  shotBlueprints: customListingShots,
  referenceCount: 1,
})
assert.equal(customListingPlan.length, 7)
assert.equal(customListingPlan[2].viewLabel, '商品套图 · 场景图 2')

const singleReferenceClone = ecommerceConsistencyProfile('clone', 1)
assert.equal(singleReferenceClone.essentialReferenceCount, 1)
assert.ok(singleReferenceClone.identityLock.includes('单参考复刻锁'))

const detailPlan = buildEcommerceGenerationPlan({
  modeId: 'detail',
  count: 4,
  selectedModules: ['hero', 'selling'],
  basePrompt: '生成详情页。',
})
assert.equal(detailPlan.length, 1)
assert.equal(detailPlan[0].viewId, 'detail-page')

const campaignShots = ecommerceShotBlueprints('campaign')
assert.equal(campaignShots.length, 4)
assert.equal(new Set(campaignShots.map((item) => item.label)).size, 4)

const shootShots = ecommerceShotBlueprints('shoot')
assert.ok(shootShots[0].direction.includes('不得为了制造新角度'))
assert.ok(shootShots[1].direction.includes('只有参考图明确提供对应侧面信息'))

assert.deepEqual(
  supportedEcommerceModules(['hero', 'angles', 'detail'], 1).map((item) => item.value),
  ['hero', 'detail'],
)
assert.deepEqual(
  supportedEcommerceModules(['hero', 'angles', 'detail'], 2).map((item) => item.value),
  ['hero', 'angles', 'detail'],
)

const revisionPrompt = buildEcommerceRevisionPrompt({
  basePrompt: '商品是黑色降噪耳机，品牌和包装文字必须准确。',
  brief: '商品放大 15%，背景改为浅灰影棚',
  direction: 'composition',
  versionNumber: 3,
})
assert.ok(revisionPrompt.includes('第 V3 版'))
assert.ok(revisionPrompt.includes('本轮只修改：商品放大 15%，背景改为浅灰影棚'))
assert.ok(revisionPrompt.includes('禁止重新随机设计整张图片'))
assert.ok(revisionPrompt.includes('第一张参考图是当前成品'))
assert.equal(buildEcommerceRevisionPrompt({ brief: '' }), '')

const tryonConsistency = ecommerceConsistencyProfile('tryon', 2)
assert.equal(tryonConsistency.id, 'product-person-identity')
assert.equal(tryonConsistency.essentialReferenceCount, 2)
assert.deepEqual(tryonConsistency.roles, ['服装身份', '模特身份'])
assert.ok(tryonConsistency.identityLock.includes('脸型'))
assert.ok(tryonConsistency.identityLock.includes('服装设计不可变化'))

const backdropConsistency = ecommerceConsistencyProfile('backdrop', 2)
assert.equal(backdropConsistency.id, 'product-scene')
assert.equal(backdropConsistency.essentialReferenceCount, 2)
assert.ok(backdropConsistency.identityLock.includes('第二张只定义背景'))

assert.ok(ecommerceConsistencyProfile('background', 1).identityLock.includes('逐像素对齐'))
assert.ok(ecommerceConsistencyProfile('shadow', 1).identityLock.includes('只允许在商品接触面'))
assert.ok(ecommerceConsistencyProfile('outpaint', 1).identityLock.includes('不可编辑中心区域'))
assert.ok(ecommerceConsistencyProfile('enhance', 1).identityLock.includes('像素级几何对齐'))

assert.deepEqual(
  orderConsistencyReferences({
    identitySources: ['product-front', 'product-side', 'product-detail'],
    anchorSources: ['series-anchor'],
    limit: 2,
    essentialIdentityCount: 1,
  }),
  ['product-front', 'series-anchor'],
)
assert.deepEqual(
  orderConsistencyReferences({
    identitySources: ['garment', 'person'],
    anchorSources: ['series-anchor'],
    limit: 2,
    essentialIdentityCount: 2,
  }),
  ['garment', 'person'],
)
assert.deepEqual(
  orderConsistencyReferences({
    identitySources: ['product', 'person', 'extra-angle'],
    anchorSources: ['current-output'],
    limit: 3,
    essentialIdentityCount: 2,
    strategy: 'anchor-first',
  }),
  ['current-output', 'product', 'person'],
)
assert.deepEqual(
  orderConsistencyReferences({
    identitySources: ['product'],
    anchorSources: ['series-anchor'],
    limit: 1,
    essentialIdentityCount: 1,
  }),
  ['product'],
)
assert.equal(
  hasConsistencyCapacity({ limit: 2, essentialIdentityCount: 2, anchorRequired: false }),
  true,
)
assert.equal(
  hasConsistencyCapacity({ limit: 1, essentialIdentityCount: 2, anchorRequired: false }),
  false,
)
assert.deepEqual(
  mapConsistencyReferenceRoles({
    roles: ['商品身份', '模特身份', '补充角度'],
    referenceCount: 4,
    essentialIdentityCount: 2,
    seriesAnchorApplied: true,
  }),
  ['商品身份', '模特身份', '系列视觉锚点（只继承布景、光线与版式）', '补充角度'],
)

const reusedReferenceA = {
  name: 'history-a.png',
  type: 'image/png',
  size: 1024,
  lastModified: 1,
  sourceUrl: '/api/v1/files/tasks/user/output.png',
}
const reusedReferenceB = {
  ...reusedReferenceA,
  name: 'history-b.png',
  lastModified: 2,
}
const preparedReferences = prepareEcommerceInputFiles([reusedReferenceA], [reusedReferenceB])
assert.equal(preparedReferences.next.length, 0)
assert.equal(preparedReferences.duplicateCount, 1)

const emptyReference = prepareEcommerceInputFiles(
  [],
  [{ name: 'empty.png', type: 'image/png', size: 0, lastModified: 3 }],
)
assert.equal(emptyReference.next.length, 0)
assert.equal(emptyReference.invalidCount, 1)

const mixedSizeReferences = prepareEcommerceInputFiles(
  [],
  [
    { name: 'valid.png', type: 'image/png', size: 1024, lastModified: 4 },
    { name: 'large.png', type: 'image/png', size: 11 * 1024 * 1024, lastModified: 5 },
  ],
)
assert.deepEqual(
  mixedSizeReferences.next.map((file) => file.name),
  ['valid.png'],
)
assert.equal(mixedSizeReferences.oversizedCount, 1)

console.log('ecommerce generation plan checks passed')
