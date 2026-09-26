import assert from 'node:assert/strict'
import {
  UI_SERIES_ANCHOR_ROLE,
  adaptPageStructurePrompt,
  buildContentConsistencyLock,
  buildCrossDeviceAdaptPrompt,
  buildDeviceAdaptationBlock,
  metricsForDeviceOption,
  orderDevicesForConsistency,
  resolveNavigationPrompt,
} from '../src/legacy-modules/features/design-workshop/multiDeviceConsistency.js'
import { mapConsistencyReferenceRoles } from '../src/legacy-modules/features/creative-studios/referenceConsistency.js'
import { DESIGN_DEVICE_OPTIONS } from '../src/legacy-modules/features/design-workshop/designDevices.js'

const ordered = orderDevicesForConsistency([
  DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'phone'),
  DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'web'),
  DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'miniapp'),
])
assert.deepEqual(
  ordered.map((item) => item.id),
  ['web', 'phone', 'miniapp'],
)

const phoneNav = resolveNavigationPrompt('sidebar', 'phone')
assert.match(phoneNav, /禁止固定侧边导航|底部标签/)

const phoneDashboard = adaptPageStructurePrompt(
  'dashboard',
  '数据仪表盘：侧边导航、KPI 指标卡、趋势图表与明细数据表格',
  'phone',
)
assert.match(phoneDashboard, /不要侧边栏/)
assert.doesNotMatch(phoneDashboard, /^数据仪表盘：侧边导航/)

const phoneMetrics = metricsForDeviceOption(
  DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'phone'),
  { densityId: 'balanced', radiusLabel: '标准 8px' },
)
assert.equal(phoneMetrics.columns, 4)
assert.equal(phoneMetrics.margin, 16)
assert.notEqual(phoneMetrics.typeScale, '12 / 14 / 16 / 20 / 24 / 32')

const lock = buildContentConsistencyLock({
  brief: '星云旅行为上海生成三天行程',
  pageTypeLabel: '落地页',
  deviceLabels: ['电脑端', '手机端'],
  brandColor: '#6250e8',
})
assert.match(lock, /逐字一致/)
assert.match(lock, /星云旅行/)

const phoneDevice = DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'phone')
assert.equal(phoneDevice.ratio, '9:16')
assert.equal(phoneDevice.scrollable, undefined)

const phoneBlock = buildDeviceAdaptationBlock(phoneDevice, {
  navigationId: 'auto',
  pageTypeId: 'admin',
  pagePrompt: '管理后台：稳定侧边导航、筛选工具栏、数据表格',
  multiDevice: true,
  isAnchor: false,
})
assert.match(phoneBlock, /对齐系列视觉锚点/)
assert.doesNotMatch(phoneBlock, /可滚动长页|连续长页/)
assert.match(phoneBlock, /单列|底部/)

const adapt = buildCrossDeviceAdaptPrompt({
  deviceOption: DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'phone'),
  iterationText: '主按钮改成品牌蓝',
  navigationId: 'auto',
  pageTypeId: 'dashboard',
  pagePrompt: '数据仪表盘',
})
assert.match(adapt, /跨设备布局适配/)
assert.match(adapt, /不要.*锁定原画布比例|不是锁定原画布比例/)

assert.deepEqual(
  mapConsistencyReferenceRoles({
    roles: ['用户参考界面（身份）'],
    referenceCount: 2,
    essentialIdentityCount: 1,
    seriesAnchorApplied: true,
    seriesAnchorRole: UI_SERIES_ANCHOR_ROLE,
  }),
  ['用户参考界面（身份）', UI_SERIES_ANCHOR_ROLE],
)

console.log('test-multi-device-consistency: ok')
