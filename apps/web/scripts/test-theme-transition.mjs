import assert from 'node:assert/strict'

const { runThemeTransition } = await import('../src/utils/themeTransition.js')
const applied = []

const first = runThemeTransition(() => applied.push('dark'), 'dark')
const second = runThemeTransition(() => applied.push('light'), 'light')
const third = runThemeTransition(() => applied.push('dark'), 'dark')

await Promise.all([first, second, third])

assert.deepEqual(applied, ['dark'])

await runThemeTransition(() => applied.push('light'), 'light')
assert.deepEqual(applied, ['dark', 'light'])

await runThemeTransition(() => {
  throw new Error('theme consumer failed')
}, 'broken')
await runThemeTransition(() => applied.push('dark-fallback'), 'dark-fallback')
assert.equal(applied.at(-1), 'dark-fallback')

console.log('theme transition checks passed')
