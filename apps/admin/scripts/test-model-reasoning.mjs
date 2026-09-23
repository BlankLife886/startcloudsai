import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const vue = readFileSync(new URL('../src/views/ModelConfigView.vue', import.meta.url), 'utf8')
const source = vue.split('<script setup lang="ts">')[1].split('</script>')[0]
const ast = ts.createSourceFile('model.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const names = new Set(['configuredReasoningOptions', 'defaultReasoningEffort', 'reasoningEffortEnabled', 'enabledReasoningEfforts', 'legacyReasoningEffortPrice', 'normalizeReasoningPricing', 'reasoningDiscountEnabled'])
names.add('setReasoningPrice')
names.add('toggleReasoningDiscount')
const code = ts.transpileModule(ast.statements.filter(s => ts.isFunctionDeclaration(s) && names.has(s.name?.text)).map(s => s.getText(ast)).join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
function fixture() {
  const c = { normalizePoints: n => Math.max(0, Math.round(Number(n) || 0)), REASONING_EFFORT_LABELS: { none: '', minimal: '', low: '', medium: '', high: '', xhigh: '', max: '' }, modelDraft: {} }
  vm.createContext(c); vm.runInContext(code, c)
  return c
}
test('clearing a discount keeps it enabled at zero until explicitly switched off', () => {
  const c = fixture()
  const price = { enabled: true, assistantPriceCents: 20, canvasAgentPriceCents: 60, assistantDiscountPriceCents: 10, canvasAgentDiscountPriceCents: 30 }
  c.modelDraft.reasoningPricing = { efforts: { medium: price } }
  for (const [field, scope] of [['assistantDiscountPriceCents', 'assistant'], ['canvasAgentDiscountPriceCents', 'canvas_agent']]) {
    for (const value of [0, undefined, null, 1]) {
      c.setReasoningPrice('medium', field, value)
      assert.equal(price[field], value ?? 0)
      assert.equal(c.reasoningDiscountEnabled('medium', scope), true)
      assert.equal(price.enabled, true)
    }
    c.toggleReasoningDiscount('medium', scope, false)
    assert.equal(price[field], null)
    assert.equal(c.reasoningDiscountEnabled('medium', scope), false)
  }
})
test('free standard and discounted tiers remain enabled after reload, even with a stale supported list', () => {
  const c = fixture()
  let pricing = { defaultEffort: 'high', efforts: { high: { enabled: true, assistantPriceCents: 0, assistantDiscountPriceCents: 0, canvasAgentPriceCents: 0, canvasAgentDiscountPriceCents: 0 } } }
  for (let i = 0; i < 3; i++) {
    pricing = c.normalizeReasoningPricing(JSON.parse(JSON.stringify(pricing)), ['high'], 20, null, [])
    assert.equal(pricing.efforts.high.enabled, true)
    assert.equal(pricing.efforts.high.assistantDiscountPriceCents, 0)
    assert.equal(pricing.defaultEffort, 'high')
  }
  c.modelDraft.reasoningPricing = pricing
  assert.equal(c.reasoningDiscountEnabled('high', 'assistant'), true)
})
test('new tiers are off until configured; unknown upstream names do not remove saved custom tiers', () => {
  const c = fixture()
  const model = { upstreamModel: 'my-custom-model', supportedReasoningEfforts: ['custom'], reasoningPricing: { defaultEffort: 'custom', efforts: { custom: { enabled: true, assistantPriceCents: 5, canvasAgentPriceCents: 5 } } } }
  const options = c.configuredReasoningOptions(model)
  const pricing = c.normalizeReasoningPricing(model.reasoningPricing, options, 5, null, ['custom'])
  assert.equal(pricing.efforts.custom.enabled, true)
  assert.equal(pricing.efforts.medium.enabled, false)
  assert.equal(c.enabledReasoningEfforts({ ...model, reasoningEnabled: false }).length, 0)
})
