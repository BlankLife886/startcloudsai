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

test('没选握法时按品类用默认握法，手动选的优先', () => {
  assert.equal(m.handheldEffectivePoseId('', 'lipstick'), 'two-finger')
  assert.equal(m.handheldEffectivePoseId('grip', 'lipstick'), 'grip')
  assert.equal(m.handheldEffectivePoseId('', ''), '')
  const prompt = m.buildHandheldTaskPrompt({ category: 'lipstick', pack: 'single', platform: 'taobao' })
  assert.match(prompt, /握持姿势：两指捏/)
  assert.match(prompt, /握持=两指捏/)
})

test('没选风格时跟随投放渠道', () => {
  assert.equal(m.handheldEffectiveStyleId('', 'xhs'), 'ugc')
  assert.equal(m.handheldEffectiveStyleId('premium', 'xhs'), 'premium')
  assert.match(m.buildHandheldTaskPrompt({ platform: 'xhs', pack: 'social' }), /视觉风格：种草风/)
})

test('渠道都有推荐套图，且推荐的套图存在', () => {
  for (const platform of m.HANDHELD_PLATFORM_OPTIONS) {
    assert.ok(m.HANDHELD_PACK_OPTIONS.some((pack) => pack.id === platform.packId), platform.id)
  }
})

test('实物尺寸：三项齐全才写进提示词', () => {
  assert.deepEqual(m.handheldDefaultSizeMm('lipstick'), { length: 20, width: 20, height: 80 })
  assert.equal(m.handheldDefaultSizeMm('other'), null)
  assert.equal(m.normalizeHandheldSizeMm({ length: '20', width: '', height: '80' }), null)
  assert.equal(m.normalizeHandheldSizeMm({ length: '0', width: '20', height: '80' }), null)
  const prompt = m.buildHandheldTaskPrompt({
    pack: 'single', platform: 'taobao',
    sizeMm: { length: '20', width: '20', height: '80' },
  })
  assert.match(prompt, /实物尺寸：约 20×20×80 mm/)
  assert.doesNotMatch(
    m.buildHandheldTaskPrompt({ pack: 'single', platform: 'taobao', sizeMm: { length: '20' } }),
    /实物尺寸/,
  )
})

test('套图没给场景和手时，整套统一背景和同一只手', () => {
  const prompt = m.buildHandheldTaskPrompt({ pack: 'listing', platform: 'taobao' })
  assert.match(prompt, /整套统一背景：每张都用浅灰白无缝影棚背景/)
  assert.match(prompt, /整套使用同一只手/)
  const withRefs = m.buildHandheldTaskPrompt({ pack: 'listing', platform: 'taobao', hasScene: true, hasHand: true })
  assert.doesNotMatch(withRefs, /整套统一背景|整套使用同一只手/)
  assert.doesNotMatch(m.buildHandheldTaskPrompt({ pack: 'single', platform: 'taobao' }), /整套/)
})

test('竖屏投放那张固定 9:16', () => {
  const story = m.handheldShotBlueprints('social').find((shot) => shot.id === 'story')
  assert.equal(story.aspectRatio, '9:16')
  assert.match(story.direction, /9:16/)
  const fullBody = m.handheldShotBlueprints('social', { crop: 'full' }).find((shot) => shot.id === 'story')
  assert.equal(fullBody.aspectRatio, '9:16')
  assert.match(fullBody.direction, /9:16/)
})

test('Amazon 只做副图：不再引导生成违规的手持主图', () => {
  const amazon = m.HANDHELD_PLATFORM_OPTIONS.find((item) => item.id === 'amazon')
  assert.equal(amazon.label, 'Amazon 副图')
  assert.doesNotMatch(amazon.prompt, /主图/)
})

test('按品类预填的尺寸只定大小，不改形状', () => {
  const prompt = m.buildHandheldTaskPrompt({
    pack: 'single', platform: 'taobao',
    sizeMm: { length: '45', width: '45', height: '130', auto: true },
  })
  assert.match(prompt, /按品类估计/)
  assert.match(prompt, /长宽比例一律以商品图为准/)
})

test('没传场景时，卡片上写的自动背景就是提示词里的背景', () => {
  assert.equal(m.handheldAutoBackdropLabel('', 'taobao'), '浅灰白棚拍背景')
  assert.equal(m.handheldAutoBackdropLabel('', 'xhs'), '温暖居家环境')
  assert.equal(m.handheldAutoBackdropLabel('premium', 'xhs'), '深色哑光台面')
  assert.match(m.buildHandheldTaskPrompt({ pack: 'single', platform: 'taobao' }), /背景：浅灰白无缝影棚背景/)
  assert.doesNotMatch(
    m.buildHandheldTaskPrompt({ pack: 'single', platform: 'taobao', hasScene: true }),
    /背景：浅灰白/,
  )
})

test('手持提示词不再带画面文字语言', () => {
  assert.doesNotMatch(m.buildHandheldTaskPrompt({ pack: 'single', platform: 'taobao' }), /画面文案语言/)
})
