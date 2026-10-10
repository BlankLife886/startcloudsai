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

const [
  {
    buildEcommerceGenerationPlan,
    ecommerceConsistencyProfile,
    ecommerceShotBlueprints,
  },
  { inspectTryonImage },
  { TRYON_SHOT_PACKS, tryonShotBlueprints },
] = await Promise.all([
  vite.ssrLoadModule('/src/legacy-modules/features/ecommerce/ecommerceTools.js'),
  vite.ssrLoadModule('/src/features/ecommerce/businesses/tryon/tryonImageCheck.js'),
  vite.ssrLoadModule('/src/legacy-modules/features/ecommerce/tryonShots.js'),
])

test.after(() => vite.close())

test('套装：四张参考图时第 4 张是下装身份，并使用套装身份锁', () => {
  const outfit = ecommerceConsistencyProfile('tryon', 4)
  assert.deepEqual(outfit.roles, ['服装身份', '模特身份', '场景环境', '下装身份'])
  assert.match(outfit.identityLock, /^套装身份锁/)
  assert.match(outfit.identityLock, /第 4 张是下装身份/)
  assert.match(outfit.identityLock, /不得合并成一件/)
})

test('单件试衣仍是三图身份锁，角色不含下装', () => {
  const single = ecommerceConsistencyProfile('tryon', 3)
  assert.deepEqual(single.roles, ['服装身份', '模特身份', '场景环境'])
  assert.match(single.identityLock, /^三图身份锁/)
  assert.doesNotMatch(single.identityLock, /下装/)
})

test('单张主图只出 1 张，且不带系列序号', () => {
  const plan = buildEcommerceGenerationPlan({
    modeId: 'tryon',
    count: 1,
    basePrompt: '基础',
    referenceCount: 3,
    shotBlueprints: tryonShotBlueprints('single', '上装'),
  })
  assert.equal(plan.length, 1)
  assert.equal(plan[0].viewId, 'front')
  assert.doesNotMatch(plan[0].prompt, /第 1\/1 张/)
})

test('上架 4 连拍生成 4 个任务，逐张标注序号和职责', () => {
  const plan = buildEcommerceGenerationPlan({
    modeId: 'tryon',
    count: 4,
    basePrompt: '基础',
    referenceCount: 3,
    shotBlueprints: tryonShotBlueprints('set', '上装'),
  })
  assert.equal(plan.length, 4)
  plan.forEach((item, index) => {
    assert.match(item.prompt, new RegExp(`第 ${index + 1}/4 张`))
    assert.equal(item.kindVariant, 'tryon')
    assert.equal(item.count, 1)
  })
  assert.match(plan[1].prompt, /本张输出职责：背面/)
})

test('套装 + 4 连拍：每张都带四图角色说明', () => {
  const plan = buildEcommerceGenerationPlan({
    modeId: 'tryon',
    count: 4,
    basePrompt: '按套装搭配生成',
    referenceCount: 4,
    shotBlueprints: tryonShotBlueprints('set', '套装'),
  })
  for (const item of plan) {
    assert.match(item.prompt, /参考图角色：服装身份；模特身份；场景环境；下装身份。/)
    assert.match(item.prompt, /套装身份锁/)
  }
})

test('上传质检：没有 createImageBitmap 的环境直接放行，不报错', async () => {
  assert.equal(typeof globalThis.createImageBitmap, 'undefined')
  assert.deepEqual(await inspectTryonImage(new Blob(['x']), 'garment'), [])
  assert.deepEqual(await inspectTryonImage(null, 'model'), [])
})


test('出图套餐：单张 1 张，上架套图与种草氛围各 4 张', () => {
  assert.deepEqual(
    TRYON_SHOT_PACKS.map((pack) => [pack.id, pack.count]),
    [['single', 1], ['set', 4], ['social', 4]],
  )
  for (const pack of TRYON_SHOT_PACKS) {
    assert.equal(tryonShotBlueprints(pack.id, '全身').length, pack.count)
  }
  assert.equal(tryonShotBlueprints('不存在', '全身').length, 1)
})

test('上架套图覆盖正面、背面、45° 侧身、工艺特写，缺一不可', () => {
  const shots = tryonShotBlueprints('set', '全身')
  assert.deepEqual(shots.map((shot) => shot.id), ['front', 'back', 'angle', 'detail'])
  assert.deepEqual(shots.map((shot) => shot.label), ['正面主图', '背面', '45° 侧身', '工艺特写'])
  const byId = Object.fromEntries(shots.map((shot) => [shot.id, shot.direction]))
  assert.match(byId.back, /背对镜头/)
  assert.match(byId.angle, /45°/)
  assert.match(byId.detail, /不得出现完整人物/)
})

test('种草氛围是动态生活感机位，与上架套图完全不重叠', () => {
  const social = tryonShotBlueprints('social', '全身')
  const listing = tryonShotBlueprints('set', '全身')
  assert.deepEqual(social.map((shot) => shot.label), ['行走抓拍', '回眸', '半身氛围', '坐姿倚靠'])
  const listingIds = new Set(listing.map((shot) => shot.id))
  for (const shot of social) assert.equal(listingIds.has(shot.id), false, shot.id)
  assert.match(social[0].direction, /行走/)
  assert.match(social[0].direction, /不能是静态站姿/)
})

test('每个机位都写明景别、姿势、场景、用途和与其他机位的区别，且互不雷同', () => {
  for (const pack of ['single', 'set', 'social']) {
    for (const apparel of ['上装', '下装', '全身', '套装']) {
      const shots = tryonShotBlueprints(pack, apparel)
      for (const shot of shots) {
        for (const part of ['景别与机位：', '姿势：', '场景：', '用途：', '与其他机位的区别：']) {
          assert.ok(shot.direction.includes(part), `${pack}/${apparel}/${shot.id} 缺 ${part}`)
        }
      }
      const frames = shots.map((shot) => shot.direction.split('。')[0])
      assert.equal(new Set(frames).size, shots.length, `${pack}/${apparel} 景别重复`)
    }
  }
})

test('按服装类型换取景和看点', () => {
  const front = (apparel) => tryonShotBlueprints('single', apparel)[0].direction
  assert.match(front('上装'), /七分身/)
  assert.match(front('下装'), /腰线到裤脚/)
  assert.match(front('全身'), /头顶到鞋子完整入画/)
  assert.match(front('套装'), /塞衣与腰线/)

  const back = (apparel) => tryonShotBlueprints('set', apparel)[1].direction
  assert.match(back('上装'), /后领/)
  assert.match(back('下装'), /后口袋/)
  assert.match(back('全身'), /拉链/)

  const detail = (apparel) => tryonShotBlueprints('set', apparel)[3].direction
  assert.match(detail('上装'), /领口、袖口/)
  assert.match(detail('下装'), /腰头、口袋/)

  // 下装没有“半身”可拍，改成坐姿/倚靠展示垂感
  const bottomSocial = tryonShotBlueprints('social', '下装').map((shot) => shot.label)
  assert.deepEqual(bottomSocial, ['行走抓拍', '回眸', '坐姿垂感', '倚靠站姿'])
})

test('纯白棚拍：所有机位改为纯白背景，85% 占比只约束正面主图', () => {
  for (const pack of ['single', 'set', 'social']) {
    const shots = tryonShotBlueprints(pack, '全身', 'white')
    for (const shot of shots) {
      assert.match(shot.direction, /RGB 255,255,255/, `${pack}/${shot.id}`)
      assert.doesNotMatch(shot.direction, /第 3 张场景/, `${pack}/${shot.id}`)
    }
  }
  const [front] = tryonShotBlueprints('single', '全身', 'white')
  assert.match(front.direction, /不少于 85%/)
  const walk = tryonShotBlueprints('social', '全身', 'white')[0]
  assert.doesNotMatch(walk.direction, /85%/)
  // 场景模式不受影响
  assert.doesNotMatch(tryonShotBlueprints('set', '全身')[0].direction, /RGB 255/)
})

test('结果引用：场景模式下装在第 4 张，纯白棚拍在第 3 张，改图任务整体后移一位', async () => {
  const { tryonRowReferences } = await vite.ssrLoadModule(
    '/src/features/ecommerce/businesses/tryon/TryonBusinessWorkspace.jsx',
  )
  const row = (keys, extra = {}) => ({ task: { params: { referenceKeys: keys, ...extra } } })
  const scene = tryonRowReferences(row(['uploads/u/top.png', 'uploads/u/m.png', 'uploads/u/s.png', 'uploads/u/pants.png']))
  assert.match(scene.garment, /top\.png$/)
  assert.match(scene.model, /m\.png$/)
  assert.match(scene.bottom, /pants\.png$/)
  const white = tryonRowReferences(row(['uploads/u/top.png', 'uploads/u/m.png', 'uploads/u/pants.png'], { tryonBackdrop: 'white' }))
  assert.match(white.bottom, /pants\.png$/)
  const revision = tryonRowReferences(row(['tasks/u/prev.png', 'uploads/u/top.png', 'uploads/u/m.png'], { parentOutputUrl: 'x' }))
  assert.match(revision.garment, /top\.png$/)
  assert.equal(tryonRowReferences(row([])), null)
})
