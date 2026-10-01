import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_DRESSUP_PROMPT_TEMPLATE,
  DRESSUP_CATEGORIES,
  DRESSUP_GROUPS,
  DRESSUP_PRESETS,
  buildDressupSourcePlan,
  dressupSelectionFromPreset,
  dressupSlotLock,
  dressupUsage,
  emptyDressupSelection,
} from '../src/views/profileStudioDressup.js'

const withText = (selection, id, text) => ({ ...selection, [id]: { ...selection[id], text } })
const withImage = (selection, id, url) => ({ ...selection, [id]: { ...selection[id], sourceUrl: url, previewUrl: url } })

test('every category belongs to exactly one group', () => {
  const grouped = DRESSUP_GROUPS.flatMap((group) => group.items)
  assert.equal(new Set(grouped).size, grouped.length)
  assert.deepEqual([...grouped].sort(), DRESSUP_CATEGORIES.map((category) => category.id).sort())
})

test('suit and top/bottom lock each other', () => {
  const selection = withText(emptyDressupSelection(), 'suit', 'JK 制服')
  assert.equal(dressupSlotLock(selection, 'top').locked, true)
  assert.equal(dressupSlotLock(selection, 'bottom').locked, true)
  assert.equal(dressupSlotLock(selection, 'suit').locked, false)
  const top = withText(emptyDressupSelection(), 'top', '卫衣')
  assert.equal(dressupSlotLock(top, 'suit').locked, true)
})

test('parts per round are capped but filled slots stay editable', () => {
  let selection = emptyDressupSelection()
  for (const id of ['hair', 'head', 'glasses', 'face']) selection = withText(selection, id, 'x')
  assert.equal(dressupUsage(selection).parts, 4)
  assert.equal(dressupSlotLock(selection, 'makeup').locked, true)
  assert.equal(dressupSlotLock(selection, 'hair').locked, false)
})

test('reference image slots follow the model limit minus the figure', () => {
  let selection = withImage(emptyDressupSelection(), 'hair', '/a.png')
  selection = withText(selection, 'shoes', '短靴')
  assert.equal(dressupUsage(selection, 2).imageLimit, 1)
  const lock = dressupSlotLock(selection, 'shoes', 2)
  assert.equal(lock.locked, false)
  assert.equal(lock.imageLocked, true)
  assert.equal(dressupSlotLock(selection, 'hair', 2).imageLocked, false)
  assert.equal(dressupSlotLock(emptyDressupSelection(), 'hair', 1).imageLocked, true)
})

test('prompt numbers reference images and fills the admin template', () => {
  let selection = withImage(emptyDressupSelection(), 'outer', '/coat.png')
  selection = withText(selection, 'hair', '双马尾')
  const plan = buildDressupSourcePlan(selection)
  assert.ok(plan.prompt.startsWith('Image 1 is the current character.'))
  assert.match(plan.prompt, /- Hairstyle: 双马尾; change only the hairstyle shape/)
  assert.match(plan.prompt, /- Outerwear: match the item shown in image 2/)
  assert.deepEqual(plan.extras, [{ url: '/coat.png' }])
  assert.ok(!plan.prompt.includes('{{items}}'))

  const custom = buildDressupSourcePlan(selection, { template: 'EDIT:\n{{items}}\nEND' })
  assert.ok(custom.prompt.startsWith('EDIT:\n- Hairstyle'))
  const invalid = buildDressupSourcePlan(selection, { template: 'no placeholder' })
  assert.ok(invalid.prompt.startsWith(DEFAULT_DRESSUP_PROMPT_TEMPLATE.split('\n')[0]))
})

test('presets stay within the per-round rules', () => {
  for (const preset of DRESSUP_PRESETS) {
    const selection = dressupSelectionFromPreset(preset)
    const usage = dressupUsage(selection)
    assert.ok(usage.parts > 0 && usage.parts <= usage.partLimit, preset.id)
    for (const id of Object.keys(preset.slots)) {
      assert.equal(dressupSlotLock(selection, id).locked, false, `${preset.id}:${id}`)
    }
  }
})

test('wardrobe keeps task originals and maps saved figures back to them', async () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  const {
    addWardrobeEntry,
    figureSourceFor,
    isTaskOriginalUrl,
    isWearingLook,
    readWardrobe,
    rememberFigureSource,
    updateWardrobeEntry,
  } = await import('../src/views/profileStudioDressup.js')
  const task = '/api/v1/files/tasks/u1/t1/original/0-a.png'
  const saved = '/api/v1/files/uploads/u1/original/fig-1.png'
  assert.equal(isTaskOriginalUrl(task), true)
  assert.equal(isTaskOriginalUrl(saved), false)

  rememberFigureSource('u1', saved, task)
  assert.equal(figureSourceFor('u1', saved), task)
  rememberFigureSource('u1', saved, '/api/v1/files/uploads/u1/original/x.png')
  assert.equal(figureSourceFor('u1', saved), task, 'non-task sources are ignored')
  assert.equal(figureSourceFor('u1', '/api/v1/files/uploads/u1/original/manual.png'), '')

  const [entry] = addWardrobeEntry('u1', { url: task, savedUrl: saved, kind: 'look', labels: ['套装'] })
  assert.equal(isWearingLook(entry, saved), true)
  assert.equal(isWearingLook(entry, task), true)
  assert.equal(isWearingLook(entry, '/api/v1/files/uploads/u1/original/other.png'), false)

  const fresh = '/api/v1/files/uploads/u1/original/fig-2.png'
  updateWardrobeEntry('u1', entry.id, { savedUrl: fresh })
  assert.equal(readWardrobe('u1')[0].savedUrl, fresh)
  assert.equal(figureSourceFor('u1', fresh), task, 'falls back to the wardrobe entry')
  delete globalThis.localStorage
})
