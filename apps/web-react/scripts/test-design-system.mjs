import assert from 'node:assert/strict'
import {
  DEFAULT_DESIGN_SPEC,
  buildCodexHandoff,
  buildDesignHandoffMarkdown,
  buildDesignSystemPrompt,
  buildDesignSystemPromptBlock,
  buildDesignTokensCss,
  getPhoneProfile,
  getPhoneProfiles,
  platformIdForDevice,
  resolveDesignSystem,
  slugFileName,
  summarizeDesignSystem,
} from '../src/features/design-workshop/designSystem.js'
import { DESIGN_DEVICE_OPTIONS } from '../src/legacy-modules/features/design-workshop/designDevices.js'

const phone = DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'phone')
const web = DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'web')
const miniapp = DESIGN_DEVICE_OPTIONS.find((item) => item.id === 'miniapp')

assert.equal(platformIdForDevice('miniapp'), 'miniapp')
assert.equal(platformIdForDevice('phone', { mobileSystem: 'android' }), 'android')
assert.equal(platformIdForDevice('phone', { mobileSystem: 'ios' }), 'ios')
assert.equal(getPhoneProfiles('ios').length, 3)
assert.equal(getPhoneProfile('iphone-16').width, 393)
assert.equal(getPhoneProfile('android-regular', 'android').width, 412)

const ios = resolveDesignSystem(phone, {
  ...DEFAULT_DESIGN_SPEC,
  mobileSystem: 'ios',
  phoneProfile: 'iphone-16',
  states: ['interaction', 'empty', 'error'],
})
assert.equal(ios.platformId, 'ios')
assert.equal(ios.viewport.width, 393)
assert.equal(ios.ratio, '393:852')
assert.equal(ios.generationRatio, '9:16')
assert.equal(ios.tokens.control.touch, 44)
assert.equal(ios.chrome.statusBar, 47)
assert.match(ios.chromeLines.join(' '), /Dynamic Island|393/)
assert.match(ios.forbidden.join(' '), /不要画 Android/)

const android = resolveDesignSystem(phone, {
  ...DEFAULT_DESIGN_SPEC,
  mobileSystem: 'android',
  phoneProfile: 'android-regular',
})
assert.equal(android.platformId, 'android')
assert.equal(android.tokens.control.touch, 48)
assert.match(android.forbidden.join(' '), /不要画 iOS/)

const wechat = resolveDesignSystem(miniapp, DEFAULT_DESIGN_SPEC)
assert.equal(wechat.platformId, 'miniapp')
assert.match(wechat.chromeLines.join(' '), /胶囊/)
assert.match(wechat.forbidden.join(' '), /不要画成独立 iOS/)

const desktop = resolveDesignSystem(web, DEFAULT_DESIGN_SPEC)
assert.equal(desktop.ratio, '16:9')
assert.equal(desktop.tokens.layout.columns, 12)
assert.equal(desktop.tokens.control.touch, 32)

const prompt = buildDesignSystemPrompt({
  device: phone,
  spec: {
    ...DEFAULT_DESIGN_SPEC,
    mobileSystem: 'ios',
    phoneProfile: 'iphone-16',
    states: ['empty', 'error'],
  },
  brief: '星云旅行行程规划',
  pageType: { id: 'dashboard', label: '仪表盘', prompt: '数据仪表盘' },
  pageTypeId: 'dashboard',
  visualStyle: { prompt: '极简留白' },
  brandColor: '#6d5cff',
  colorScheme: 'light',
  selectedDeviceLabels: ['电脑端', '手机端'],
})
assert.match(prompt, /星云旅行/)
assert.match(prompt, /iOS App/)
assert.match(prompt, /iPhone 16/)
assert.match(prompt, /393:852/)
assert.match(prompt, /最接近的 9:16/)
assert.match(prompt, /44/)
assert.match(prompt, /空状态/)
assert.match(prompt, /多端内容锁/)
assert.doesNotMatch(prompt, /PAGE ARCHETYPE|8 COL/)

const iteration = buildDesignSystemPrompt({
  device: phone,
  isIteration: true,
  iterationBrief: '主按钮改成蓝色',
})
assert.match(iteration, /受控 UI 迭代/)
assert.match(iteration, /主按钮改成蓝色/)

const block = buildDesignSystemPromptBlock(ios)
assert.match(block, /设计系统/)
assert.match(block, /必须定义的组件状态/)

const handoff = buildCodexHandoff({
  brief: '星云旅行',
  pageType: { id: 'dashboard', label: '仪表盘' },
  visualStyle: { id: 'minimal', label: '极简留白' },
  system: ios,
  prompt,
  imageUrl: '/visual/ui.png',
  sourceSize: { width: 1179, height: 2556 },
  elements: [
    { id: 'icon-1', name: '首页', type: 'icon', x: 10, y: 20, width: 24, height: 24 },
  ],
})
assert.equal(handoff.kind, 'starclouds-ui-design-system')
assert.equal(handoff.version, 2)
assert.equal(handoff.platform.id, 'ios')
assert.equal(handoff.elements[0].file, 'elements/首页.png')
assert.equal(handoff.viewport.width, 393)
assert.equal(handoff.ratio, '393:852')
assert.equal(handoff.generationRatio, '9:16')
assert.equal(handoff.coordinateSpace, 'source-image-pixels')
assert.deepEqual(handoff.source, { width: 1179, height: 2556 })
assert.equal(handoff.files.manifest, 'design-system.json')
assert.equal(handoff.files.artboard, 'design.png')
assert.match(buildDesignTokensCss(ios), /--touch-target: 44px/)
const handoffMarkdown = buildDesignHandoffMarkdown(handoff)
assert.match(handoffMarkdown, /design-system\.json/)
assert.match(handoffMarkdown, /Source image: 1179 x 2556 px/)
assert.match(handoffMarkdown, /source-image-pixels/)
assert.equal(slugFileName('首页 图标'), '首页-图标')
assert.match(summarizeDesignSystem(ios), /iPhone 16/)
