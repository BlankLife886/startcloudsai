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
const ex = await vite.ssrLoadModule('/src/features/ecommerce/handheld/handheldExport.js')
const m = await vite.ssrLoadModule('/src/legacy-modules/features/ecommerce/handheldCommerce.js')
test.after(() => vite.close())

test('导出尺寸：宽度取平台推荐值，高度跟原图比例', () => {
  assert.deepEqual(ex.handheldExportSize('taobao', 1254, 1254), { width: 800, height: 800 })
  assert.deepEqual(ex.handheldExportSize('xhs', 1086, 1448), { width: 1080, height: 1440 })
  // 小红书套图里的竖屏那张保持 9:16
  assert.deepEqual(ex.handheldExportSize('xhs', 941, 1672), { width: 1080, height: 1920 })
  assert.deepEqual(ex.handheldExportSize('douyin', 940, 1672), { width: 1080, height: 1920 })
  // 不接近任何标准比例时保持原比例
  assert.deepEqual(ex.handheldExportSize('shop', 1000, 1250), { width: 1080, height: 1350 })
  assert.deepEqual(ex.handheldExportSize('shop', 1000, 1400), { width: 1080, height: 1512 })
  assert.deepEqual(ex.handheldExportSize('amazon', 1254, 1254), { width: 1600, height: 1600 })
  assert.equal(ex.handheldExportSize('taobao', 0, 10), null)
})

test('每个投放渠道都有导出规格', () => {
  for (const platform of m.HANDHELD_PLATFORM_OPTIONS) {
    assert.ok(ex.HANDHELD_EXPORT_SPECS[platform.id], platform.id)
  }
})

test('文件名带商品、平台、序号、镜头和尺寸，去掉非法字符', () => {
  assert.equal(
    ex.handheldExportFilename({ productName: '夏令营 渔夫帽/迷彩', platform: 'taobao', index: 0, label: '手持主图', width: 800, height: 800 }),
    '夏令营-渔夫帽-迷彩_淘宝_01-手持主图_800x800.jpg',
  )
  assert.equal(
    ex.handheldExportFilename({ platform: 'douyin', index: 2, label: '', width: 1080, height: 1920 }),
    '手持商品_抖音_03-图_1080x1920.jpg',
  )
})

test('套图缺场景或手的参考时先出主图再统一', () => {
  assert.equal(m.handheldUseAnchorHero({ shotCount: 4 }), true)
  assert.equal(m.handheldUseAnchorHero({ shotCount: 4, hasScene: true }), true)
  assert.equal(m.handheldUseAnchorHero({ shotCount: 4, hasScene: true, hasPerson: true }), false)
  assert.equal(m.handheldUseAnchorHero({ shotCount: 1 }), false)
  const ids = m.handheldSelectionConflicts({ pack: 'listing' }).map((item) => item.id)
  assert.ok(ids.includes('anchor-hero'))
  assert.ok(!m.handheldSelectionConflicts({ pack: 'single' }).some((item) => item.id === 'anchor-hero'))
})
