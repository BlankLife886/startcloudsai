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

const [
  {
    buildEcommerceGenerationPlan,
    buildEcommerceRevisionPrompt,
    ecommerceConsistencyProfile,
    ecommerceShotBlueprints,
    isReusableTaskImageKey,
    listingShotBlueprintsFromCounts,
    normalizeTaskImageKey,
    prepareEcommerceInputFiles,
    coerceEcommerceImageFile,
    ECOMMERCE_IMAGE_TARGET_BYTES,
    sniffEcommerceImageBytes,
    storageKeyFromMediaUrl,
    supportedEcommerceModules,
    TRYON_DEFAULT_LENS_ID,
    TRYON_LENS_OPTIONS,
    buildTryonPhotographyPrompt,
    ecommerceModeById,
    tryonLensById,
    TRYON_DEFAULT_LIGHT_ID,
    TRYON_LIGHT_OPTIONS,
    buildTryonLightingPrompt,
    tryonLightById,
    buildTryonMentions,
    expandTryonBriefMentions,
    buildTryonRevisionPlan,
    shiftTryonReferenceIndexes,
    tryonBriefAspectRatio,
    HANDHELD_DEFAULT_POSE_ID,
    HANDHELD_DEFAULT_STYLE_ID,
    HANDHELD_POSE_OPTIONS,
    HANDHELD_STYLE_OPTIONS,
    buildHandheldPosePrompt,
    buildHandheldStylePrompt,
    handheldPoseById,
    handheldStyleById,
    handheldShotBlueprints,
    handheldCropNeedsPerson,
    buildHandheldTaskPrompt,
    buildHandheldAnnotationPrompt,
    normalizeHandheldAnnotations,
    HANDHELD_LANGUAGE_OPTIONS,
    HANDHELD_DEFAULT_DEPTH_ID,
    HANDHELD_DEFAULT_FOCUS_ID,
    HANDHELD_DEFAULT_MATERIAL_INTERACTION_ID,
    handheldDepthById,
    handheldFocusById,
    handheldMaterialInteractionById,
    HANDHELD_PHOTO_PRESET_OPTIONS,
    handheldPhotoPresetById,
    buildHandheldIdentityLock,
    buildHandheldOutputConstraints,
    handheldReferenceLabels,
    ECOMMERCE_MENU_GROUPS,
    ECOMMERCE_RAIL_GROUPS,
  },
  {
    hasConsistencyCapacity,
    mapConsistencyReferenceRoles,
    orderConsistencyReferences,
  },
  { tryonSlotDraftRecord },
] = await Promise.all([
  vite.ssrLoadModule(
    '/src/legacy-modules/features/ecommerce/ecommerceTools.js',
  ),
  vite.ssrLoadModule(
    '/src/legacy-modules/features/creative-studios/referenceConsistency.js',
  ),
  vite.ssrLoadModule(
    '/src/legacy-modules/features/ecommerce/tryonDraftStorage.js',
  ),
])
await vite.close()

const modelMenuGroup = ECOMMERCE_MENU_GROUPS.find(
  (group) => group.id === 'model',
)
const createMenuGroup = ECOMMERCE_MENU_GROUPS.find(
  (group) => group.id === 'create',
)
assert.deepEqual(
  modelMenuGroup.items.map((item) => item.id),
  ['tryon', 'handheld', 'accessory'],
)
assert.equal(
  createMenuGroup.items.some((item) => item.id === 'handheld'),
  false,
)
assert.deepEqual(
  ECOMMERCE_RAIL_GROUPS.find((group) => group.id === 'model').items.map(
    (item) => item.id,
  ),
  ['tryon', 'handheld', 'accessory'],
)

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
  selectedModules: [
    'hero',
    'selling',
    'scene',
    'mood',
    'detail',
    'spec',
    'package',
  ],
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
  [
    'white-1',
    'scene-1',
    'scene-2',
    'scene-3',
    'selling-1',
    'selling-2',
    'other-1',
  ],
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
  supportedEcommerceModules(['hero', 'angles', 'detail'], 1).map(
    (item) => item.value,
  ),
  ['hero', 'detail'],
)
assert.deepEqual(
  supportedEcommerceModules(['hero', 'angles', 'detail'], 2).map(
    (item) => item.value,
  ),
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
assert.ok(tryonConsistency.identityLock.includes('场景参考'))

const tryonSceneConsistency = ecommerceConsistencyProfile('tryon', 3)
assert.equal(tryonSceneConsistency.essentialReferenceCount, 3)
assert.deepEqual(tryonSceneConsistency.roles, [
  '服装身份',
  '模特身份',
  '场景环境',
])
assert.ok(tryonSceneConsistency.identityLock.includes('第 2 张是模特身份'))
assert.ok(tryonSceneConsistency.identityLock.includes('禁止生成另一个相似的人'))

const tryonPlan = buildEcommerceGenerationPlan({
  modeId: 'tryon',
  count: 1,
  basePrompt: '任务：AI 虚拟试衣。',
  referenceCount: 3,
  shotBlueprints: ecommerceShotBlueprints('tryon').slice(0, 1),
})
assert.equal(tryonPlan.length, 1)
assert.ok(
  tryonPlan[0].prompt.includes('参考图角色：服装身份；模特身份；场景环境。'),
)
assert.ok(tryonPlan[0].prompt.includes('第 2 张是模特身份'))

const handheldConsistency = ecommerceConsistencyProfile('handheld', 3)
assert.equal(handheldConsistency.id, 'product-person-identity')
assert.equal(handheldConsistency.essentialReferenceCount, 3)
assert.deepEqual(handheldConsistency.roles, [
  '商品身份',
  '模特身份',
  '场景环境',
])
assert.ok(handheldConsistency.identityLock.includes('第 1 张是商品身份'))
assert.ok(handheldConsistency.identityLock.includes('第 2 张是模特身份'))
assert.ok(handheldConsistency.identityLock.includes('禁止生成另一个相似的人'))
assert.ok(handheldConsistency.identityLock.includes('只允许改变握持动作'))

const handheldPlan = buildEcommerceGenerationPlan({
  modeId: 'handheld',
  count: 1,
  basePrompt: '任务：手持商品图。',
  referenceCount: 3,
  shotBlueprints: ecommerceShotBlueprints('handheld').slice(0, 1),
})
assert.equal(handheldPlan.length, 1)
assert.ok(
  handheldPlan[0].prompt.includes('参考图角色：商品身份；模特身份；场景环境。'),
)
assert.ok(handheldPlan[0].prompt.includes('第 2 张是模特身份'))
assert.equal(ecommerceShotBlueprints('handheld').length, 6)
assert.equal(ecommerceModeById('handheld').maxCount, 4)
assert.equal(ecommerceModeById('handheld').ratio, '4:5')
assert.equal(handheldShotBlueprints('single').length, 1)
assert.equal(handheldShotBlueprints('listing').length, 4)
assert.equal(handheldShotBlueprints('social').length, 3)
assert.deepEqual(
  handheldShotBlueprints('unbox-set').map((item) => item.label),
  ['开箱取出', '手持主图', '材质特写'],
)
assert.equal(handheldShotBlueprints('ab').length, 2)
const handheldFullBodyShots = handheldShotBlueprints('social', { crop: 'full' })
assert.equal(handheldFullBodyShots.length, 3)
assert.ok(
  handheldFullBodyShots.every((item) => item.direction.includes('完整入镜')),
)
assert.ok(
  handheldFullBodyShots.every(
    (item) => !item.direction.includes('近景') && !item.direction.includes('特写'),
  ),
)
assert.equal(handheldCropNeedsPerson('hand'), false)
assert.equal(handheldCropNeedsPerson('wrist'), false)
assert.equal(handheldCropNeedsPerson('bust'), true)
assert.equal(handheldCropNeedsPerson('full'), true)
assert.equal(handheldCropNeedsPerson('noface'), true)
assert.deepEqual(handheldReferenceLabels({ hasScene: true }), [
  '商品身份',
  '场景环境',
])
assert.deepEqual(handheldReferenceLabels({ hasHand: true }), [
  '商品身份',
  '手部身份',
])
assert.ok(buildHandheldIdentityLock({}).includes('严禁编造可识别人脸'))
assert.ok(
  buildHandheldIdentityLock({ hasModel: true, hasScene: true }).includes(
    '第 2 张是模特身份',
  ),
)
const handheldOutputConstraints = buildHandheldOutputConstraints({
  crop: 'full',
  hand: 'right',
  hasModel: true,
  hasScene: true,
})
assert.ok(handheldOutputConstraints.includes('从头顶到双脚'))
assert.ok(handheldOutputConstraints.includes('参考若只有上半身'))
assert.ok(handheldOutputConstraints.includes('人物本人的右手'))
assert.ok(handheldOutputConstraints.includes('场景参考为唯一背景事实'))
const handheldConstrainedPlan = buildEcommerceGenerationPlan({
  modeId: 'handheld',
  count: 3,
  basePrompt: '任务：手持商品图。',
  referenceCount: 3,
  referenceRoles: handheldReferenceLabels({
    hasModel: true,
    hasScene: true,
  }),
  shotBlueprints: handheldShotBlueprints('social'),
  finalConstraints: handheldOutputConstraints,
})
assert.ok(
  handheldConstrainedPlan.every((item) =>
    item.prompt.endsWith(handheldOutputConstraints),
  ),
)
assert.ok(
  handheldConstrainedPlan.every((item) =>
    item.prompt.includes('所有图片并行生成'),
  ),
)
const handheldSoloPlan = buildEcommerceGenerationPlan({
  modeId: 'handheld',
  count: 1,
  basePrompt: buildHandheldTaskPrompt({ crop: 'wrist', pack: 'single' }),
  referenceCount: 1,
  referenceRoles: handheldReferenceLabels({}),
  identityLock: buildHandheldIdentityLock({}),
  hasPersonIdentity: false,
  shotBlueprints: handheldShotBlueprints('single'),
})
assert.equal(handheldSoloPlan.length, 1)
assert.ok(handheldSoloPlan[0].prompt.includes('不要生成可识别人脸'))
assert.ok(handheldSoloPlan[0].prompt.includes('质检硬约束'))
assert.ok(handheldSoloPlan[0].prompt.includes('刚性外形'))
assert.ok(handheldSoloPlan[0].prompt.includes('锐利清晰'))
assert.ok(buildHandheldOutputConstraints({}).includes('手迁就商品'))
assert.ok(buildHandheldOutputConstraints({}).includes('对焦平面必须落在商品身份面'))
assert.ok(buildHandheldOutputConstraints({}).includes('严禁生成裸露'))
assert.ok(handheldSoloPlan[0].prompt.includes('参考图角色：商品身份。'))
assert.equal(
  handheldSoloPlan[0].prompt.includes('自然握持'),
  false,
  'an unselected pose must not leak through the default shot direction',
)
const handheldAnnotationPrompt = buildHandheldTaskPrompt({
  crop: 'wrist',
  pack: 'single',
  language: 'en',
  annotations: [
    { id: 'front-copy', x: 0.42, y: 0.31, text: '保留净含量 30ml', enabled: true },
    { id: 'disabled', x: 0.8, y: 0.8, text: '不应发送', enabled: false },
    { id: 'empty', x: 0.2, y: 0.2, text: '   ', enabled: true },
  ],
})
assert.ok(handheldAnnotationPrompt.includes('画面文案语言：英文'))
assert.ok(handheldAnnotationPrompt.includes('商品图 (42%, 31%)：保留净含量 30ml'))
assert.equal(handheldAnnotationPrompt.includes('不应发送'), false)
assert.equal(buildHandheldAnnotationPrompt([]), '')
assert.deepEqual(
  normalizeHandheldAnnotations([
    { id: 'edge', x: 2, y: -1, text: ' 边缘标注 ' },
  ]),
  [{ id: 'edge', role: 'product_front', x: 1, y: 0, text: '边缘标注' }],
)
assert.ok(HANDHELD_LANGUAGE_OPTIONS.some((item) => item.id === 'zh-CN'))
const handheldListingPlan = buildEcommerceGenerationPlan({
  modeId: 'handheld',
  count: 4,
  basePrompt: '任务：手持商品图。',
  referenceCount: 2,
  referenceRoles: handheldReferenceLabels({ hasScene: true }),
  shotBlueprints: handheldShotBlueprints('listing'),
})
assert.equal(handheldListingPlan.length, 4)
assert.equal(handheldListingPlan[3].viewId, 'detail')
assert.ok(handheldListingPlan[3].viewLabel.includes('材质特写'))
assert.ok(handheldListingPlan[2].prompt.includes('禁止换成另一件货'))
assert.equal(handheldListingPlan[2].viewId, 'use')
assert.ok(handheldListingPlan[2].prompt.includes('本张使用瞬间覆盖'))
assert.ok(handheldListingPlan[2].prompt.includes('整张画面必须锐利清晰'))
assert.ok(handheldListingPlan[2].prompt.includes('禁止只让人物清晰'))
assert.ok(handheldListingPlan[3].prompt.includes('禁止换成场景中的物品'))
assert.equal(handheldListingPlan[0].prompt.includes('本张使用瞬间覆盖'), false)
assert.equal(handheldListingPlan[3].prompt.includes('本张使用瞬间覆盖'), false)
assert.ok(
  handheldListingPlan.every((item) => item.prompt.includes('系列连续性锁')),
)
assert.ok(ecommerceModeById('handheld').prompt.includes('真实毫米尺度'))

const backdropConsistency = ecommerceConsistencyProfile('backdrop', 2)
assert.equal(backdropConsistency.id, 'product-scene')
assert.equal(backdropConsistency.essentialReferenceCount, 2)
assert.ok(backdropConsistency.identityLock.includes('第二张只定义背景'))

assert.ok(
  ecommerceConsistencyProfile('background', 1).identityLock.includes(
    '逐像素对齐',
  ),
)
assert.ok(
  ecommerceConsistencyProfile('shadow', 1).identityLock.includes(
    '只允许在商品接触面',
  ),
)
assert.ok(
  ecommerceConsistencyProfile('outpaint', 1).identityLock.includes(
    '不可编辑中心区域',
  ),
)
assert.ok(
  ecommerceConsistencyProfile('enhance', 1).identityLock.includes(
    '像素级几何对齐',
  ),
)

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
  hasConsistencyCapacity({
    limit: 2,
    essentialIdentityCount: 2,
    anchorRequired: false,
  }),
  true,
)
assert.equal(
  hasConsistencyCapacity({
    limit: 1,
    essentialIdentityCount: 2,
    anchorRequired: false,
  }),
  false,
)
assert.deepEqual(
  mapConsistencyReferenceRoles({
    roles: ['商品身份', '模特身份', '补充角度'],
    referenceCount: 4,
    essentialIdentityCount: 2,
    seriesAnchorApplied: true,
  }),
  [
    '商品身份',
    '模特身份',
    '系列视觉锚点（只继承布景、光线与版式）',
    '补充角度',
  ],
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
const preparedReferences = prepareEcommerceInputFiles(
  [reusedReferenceA],
  [reusedReferenceB],
)
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
    {
      name: 'large.png',
      type: 'image/png',
      size: 31 * 1024 * 1024,
      lastModified: 5,
    },
  ],
)
assert.deepEqual(
  mixedSizeReferences.next.map((file) => file.name),
  ['valid.png'],
)
assert.equal(mixedSizeReferences.oversizedCount, 1)

const skipCapLarge = prepareEcommerceInputFiles(
  [],
  [
    {
      name: 'huge.png',
      type: 'image/png',
      size: 31 * 1024 * 1024,
      lastModified: 11,
    },
  ],
  { skipSizeCap: true },
)
assert.equal(skipCapLarge.next.length, 1)
assert.equal(skipCapLarge.oversizedCount, 1)

const overTargetJpeg = prepareEcommerceInputFiles(
  [],
  [
    {
      name: 'photo.jpg',
      type: 'image/jpeg',
      size: 3 * 1024 * 1024,
      lastModified: 9,
    },
  ],
)
assert.equal(ECOMMERCE_IMAGE_TARGET_BYTES, 2 * 1024 * 1024)
assert.equal(overTargetJpeg.next.length, 1)
assert.equal(overTargetJpeg.oversizedCount, 0)

const untypedJpeg = prepareEcommerceInputFiles(
  [],
  [{ name: 'photo.jpg', type: '', size: 2048, lastModified: 6 }],
)
assert.equal(untypedJpeg.next.length, 1)
assert.equal(untypedJpeg.invalidCount, 0)

const aliasJpeg = prepareEcommerceInputFiles(
  [],
  [{ name: 'photo.jpg', type: 'image/jpg', size: 2048, lastModified: 7 }],
)
assert.equal(aliasJpeg.next.length, 1)

const heicRejected = prepareEcommerceInputFiles(
  [],
  [{ name: 'IMG_0001.HEIC', type: 'image/heic', size: 2048, lastModified: 8 }],
)
assert.equal(heicRejected.next.length, 0)
assert.equal(heicRejected.heicCount, 1)
assert.equal(heicRejected.invalidCount, 1)

const namelessJpeg = new File(
  [
    Uint8Array.from([
      0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]),
  ],
  '',
  { type: '' },
)
const coercedNameless = await coerceEcommerceImageFile(namelessJpeg)
assert.equal(coercedNameless?.type, 'image/jpeg')

assert.equal(
  sniffEcommerceImageBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])).type,
  'image/jpeg',
)
assert.equal(
  sniffEcommerceImageBytes(
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  ).type,
  'image/png',
)
assert.equal(
  sniffEcommerceImageBytes(new TextEncoder().encode('<html>fallback</html>')),
  null,
)
assert.equal(
  storageKeyFromMediaUrl(
    '/api/v1/files/uploads/11111111-1111-1111-1111-111111111111/original/a.jpg?w=720',
  ),
  'uploads/11111111-1111-1111-1111-111111111111/original/a.jpg',
)
assert.equal(
  normalizeTaskImageKey(
    '/api/v1/files/uploads/11111111-1111-1111-1111-111111111111/original/a.jpg',
  ),
  'uploads/11111111-1111-1111-1111-111111111111/original/a.jpg',
)
assert.equal(isReusableTaskImageKey('uploads/e2e-user-1/product.png'), true)
assert.equal(
  isReusableTaskImageKey('ecommerce-catalog/4be6463a-e469-4db5-82ff-bfd3e9071f85.png'),
  true,
)
assert.equal(isReusableTaskImageKey('ecommerce-tryon/model.jpg'), true)
assert.equal(isReusableTaskImageKey('mock-product.png'), false)
assert.equal(
  isReusableTaskImageKey('/api/v1/files/uploads/e2e-user-1/product.png'),
  false,
)
assert.equal(
  normalizeTaskImageKey(
    '/api/v1/files/ecommerce-catalog/4be6463a-e469-4db5-82ff-bfd3e9071f85.png',
  ),
  'ecommerce-catalog/4be6463a-e469-4db5-82ff-bfd3e9071f85.png',
)

assert.equal(TRYON_DEFAULT_LENS_ID, 'portrait')
assert.equal(tryonLensById('portrait').range, '70–135mm')
const portraitLensPrompt = buildTryonPhotographyPrompt('portrait')
assert.ok(portraitLensPrompt.includes('必须使用中长焦 / 人像'))
assert.ok(portraitLensPrompt.includes('85mm'))
assert.ok(portraitLensPrompt.includes('面料织纹'))
assert.ok(portraitLensPrompt.includes('硬约束'))
const autoLensPrompt = buildTryonPhotographyPrompt('auto')
assert.ok(autoLensPrompt.includes('摄影质感'))
assert.ok(autoLensPrompt.includes('全画幅相机实拍'))
assert.equal(autoLensPrompt.includes('必须使用'), false)
assert.ok(ecommerceModeById('tryon').prompt.includes('全画幅相机实拍'))
assert.ok(
  ecommerceShotBlueprints('tryon')[0].direction.includes('商业时装摄影'),
)
const tryonLensPlan = buildEcommerceGenerationPlan({
  modeId: 'tryon',
  count: 1,
  basePrompt: `任务：AI 虚拟试衣。${buildTryonPhotographyPrompt('portrait')}`,
  referenceCount: 3,
  shotBlueprints: ecommerceShotBlueprints('tryon').slice(0, 1),
})
assert.ok(tryonLensPlan[0].prompt.includes('85mm'))
assert.ok(tryonLensPlan[0].prompt.includes('面料织纹'))
assert.ok(TRYON_LENS_OPTIONS.some((item) => item.id === 'auto'))
assert.equal(TRYON_DEFAULT_LIGHT_ID, 'fill')
assert.equal(tryonLightById('fill').label, '补光塑形')
const fillLightPrompt = buildTryonLightingPrompt('fill')
assert.ok(fillLightPrompt.includes('补光塑形'))
assert.ok(fillLightPrompt.includes('反光板'))
assert.ok(fillLightPrompt.includes('不是换场景重打灯'))
assert.equal(fillLightPrompt.includes('必须使用'), false)
const availableLightPrompt = buildTryonLightingPrompt('available')
assert.ok(availableLightPrompt.includes('现场光'))
assert.ok(availableLightPrompt.includes('已经存在的光线'))
assert.ok(TRYON_LIGHT_OPTIONS.some((item) => item.id === 'rim'))
const tryonLightPlan = buildEcommerceGenerationPlan({
  modeId: 'tryon',
  count: 1,
  basePrompt: `任务：AI 虚拟试衣。${buildTryonLightingPrompt('rim')}`,
  referenceCount: 3,
  shotBlueprints: ecommerceShotBlueprints('tryon').slice(0, 1),
})
assert.ok(tryonLightPlan[0].prompt.includes('轮廓分离'))
assert.ok(tryonLightPlan[0].prompt.includes('场景环境光不动'))
const nonDefaultTryonMentions = buildTryonMentions({
  apparel: '上装',
  modelLabel: '自定义模特',
  sceneLabel: '都市街头',
  lens: tryonLensById('ultra-wide'),
  light: tryonLightById('available'),
  aspectRatio: '2:3',
})
assert.equal(
  nonDefaultTryonMentions.find((item) => item.id === 'lens').hint,
  '超广角 / 鱼眼',
)
assert.equal(
  nonDefaultTryonMentions.find((item) => item.id === 'light').hint,
  '现场光',
)
assert.ok(
  expandTryonBriefMentions('@镜头 改成 35mm', nonDefaultTryonMentions).includes(
    '超广角 / 鱼眼',
  ),
)
assert.equal(
  expandTryonBriefMentions('@衣服颜色更鲜艳', nonDefaultTryonMentions),
  '@衣服颜色更鲜艳',
)
assert.equal(
  shiftTryonReferenceIndexes('第 1 张服装，第 2 张模特，第 3 张场景。'),
  '第 2 张服装，第 3 张模特，第 4 张场景。',
)
assert.equal(tryonBriefAspectRatio('@比例 改为 1：1', '2:3'), '1:1')
assert.equal(tryonBriefAspectRatio('@比例 不要改为 1:1', '2:3'), '2:3')
const tryonRevisionPlan = buildTryonRevisionPlan({
  basePrompt:
    '第 1 张是服装身份，第 2 张是模特身份，第 3 张是拍摄场景。',
  brief: '@模特 改为坐姿，@比例 改为 1:1',
  apparel: '上装',
  modelLabel: '自定义模特',
  sceneLabel: '都市街头',
  lens: 'wide',
  light: 'rim',
  aspectRatio: '2:3',
  versionNumber: 2,
})
assert.equal(tryonRevisionPlan.aspectRatio, '1:1')
assert.ok(tryonRevisionPlan.prompt.includes('第 1 张参考图是当前试衣成品'))
assert.ok(tryonRevisionPlan.prompt.includes('第 3 张参考图是模特身份依据'))
assert.ok(tryonRevisionPlan.prompt.includes('第 4 张是拍摄场景'))
assert.ok(tryonRevisionPlan.prompt.includes('本轮未明确要求修改'))
assert.equal(HANDHELD_DEFAULT_POSE_ID, 'grip')
assert.equal(handheldPoseById('present').label, '单手展示')
assert.ok(HANDHELD_POSE_OPTIONS.some((item) => item.id === 'two-hands'))
assert.ok(buildHandheldPosePrompt('grip').includes('自然握持'))
assert.equal(HANDHELD_DEFAULT_STYLE_ID, 'listing')
assert.equal(handheldStyleById('ugc').label, '种草风')
assert.ok(HANDHELD_STYLE_OPTIONS.some((item) => item.id === 'premium'))
assert.ok(buildHandheldStylePrompt('listing').includes('电商主图'))
assert.ok(ecommerceModeById('handheld').prompt.includes('真实毫米尺度'))
assert.ok(ecommerceShotBlueprints('handheld')[0].direction.includes('接触阴影'))
const handheldPosePlan = buildEcommerceGenerationPlan({
  modeId: 'handheld',
  count: 1,
  basePrompt: `任务：手持商品图。${buildHandheldPosePrompt('use')}${buildHandheldStylePrompt('premium')}`,
  referenceCount: 3,
  shotBlueprints: ecommerceShotBlueprints('handheld').slice(0, 1),
})
assert.ok(handheldPosePlan[0].prompt.includes('使用中'))
assert.ok(handheldPosePlan[0].prompt.includes('高级感'))
assert.equal(HANDHELD_DEFAULT_DEPTH_ID, 'balanced')
assert.equal(HANDHELD_DEFAULT_FOCUS_ID, 'product_identity')
assert.equal(HANDHELD_DEFAULT_MATERIAL_INTERACTION_ID, 'balanced')
assert.equal(handheldDepthById('deep').label, '全主体锐利')
assert.equal(handheldFocusById('functional_detail').label, '功能细节')
assert.equal(handheldMaterialInteractionById('metal').label, '金属')
assert.equal(HANDHELD_PHOTO_PRESET_OPTIONS.length, 4)
assert.equal(
  handheldPhotoPresetById('listing').settings.focus,
  'product_identity',
)
assert.equal(handheldPhotoPresetById('lifestyle').settings.depth, 'contextual')
assert.equal(
  handheldPhotoPresetById('function').settings.focus,
  'functional_detail',
)
assert.equal(handheldPhotoPresetById('material').settings.lens, 'macro')
const handheldSevenDimensionPrompt = buildHandheldTaskPrompt({
  depth: 'deep',
  focus: 'product_identity',
  materialInteraction: 'metal',
})
assert.ok(handheldSevenDimensionPrompt.includes('景深与距离'))
assert.ok(handheldSevenDimensionPrompt.includes('第一视觉中心'))
assert.ok(handheldSevenDimensionPrompt.includes('连续线性高光'))
assert.ok(
  buildHandheldTaskPrompt({ hasLayout: true, architecture: 'swap' }).includes(
    '只把原商品替换成当前商品',
  ),
)
assert.ok(
  !buildHandheldTaskPrompt({ hasLayout: true }).includes(
    '只把原商品替换成当前商品',
  ),
)
const handheldNoPicturePlanPrompt = buildHandheldTaskPrompt({
  category: 'other',
  packState: 'unboxed',
  pose: 'grip',
  crop: 'wrist',
  hand: 'right',
  platform: 'taobao',
  pack: 'single',
})
for (const absent of [
  '视觉风格：',
  '镜头：',
  '景深与距离：',
  '视觉焦点：',
  '光影：',
  '机位：',
  '材质交互：',
  '生成方式：',
]) {
  assert.equal(
    handheldNoPicturePlanPrompt.includes(absent),
    false,
    `unselected picture plan leaked ${absent}`,
  )
}
const handheldNoProductOrPosePrompt = buildHandheldTaskPrompt({
  crop: 'wrist',
  platform: 'taobao',
  pack: 'single',
})
for (const absent of [
  '品类：',
  '展示已取出的商品本体',
  '握持姿势：',
  '使用右手握持',
  '使用左手握持',
  '使用双手配合',
]) {
  assert.equal(
    handheldNoProductOrPosePrompt.includes(absent),
    false,
    `unselected product or pose option leaked ${absent}`,
  )
}
assert.deepEqual(
  tryonSlotDraftRecord({
    source: 'builtin',
    catalogId: 'east-asian-female',
    uploadKey: 'uploads/user/model.jpg',
  }),
  {
    source: 'builtin',
    catalogId: 'east-asian-female',
    uploadKey: 'uploads/user/model.jpg',
  },
)
assert.equal(tryonSlotDraftRecord(null), null)
assert.equal(
  tryonSlotDraftRecord({
    source: 'upload',
    file: { name: 'coat.png', type: 'image/png', size: 0 },
  }),
  null,
)
const uploadedDraft = tryonSlotDraftRecord({
  source: 'upload',
  file: new File([Uint8Array.from([1, 2, 3])], 'coat.webp', {
    type: 'image/webp',
  }),
  uploadKey: 'uploads/user/coat.webp',
})
assert.equal(uploadedDraft.source, 'upload')
assert.equal(uploadedDraft.name, 'coat.webp')
assert.equal(uploadedDraft.uploadKey, 'uploads/user/coat.webp')

console.log('ecommerce generation plan checks passed')
