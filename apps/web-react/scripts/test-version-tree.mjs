import assert from 'node:assert/strict'
import {
  buildVersionForest,
  mediaIdentity,
  resolveParentOutputUrl,
} from '../src/legacy-modules/features/design-workshop/versionTree.js'

assert.equal(
  mediaIdentity('/api/v1/files/tasks/user/a.png'),
  'tasks/user/a.png',
)
assert.equal(
  mediaIdentity('https://cdn.example.com/api/v1/files/tasks/user/a.png?sig=1'),
  'tasks/user/a.png',
)
assert.equal(
  resolveParentOutputUrl('/api/v1/files/tasks/user/a.png?sig=9', [
    '/api/v1/files/tasks/user/b.png',
    '/api/v1/files/tasks/user/a.png',
  ]),
  '/api/v1/files/tasks/user/a.png',
)

const parent = '/api/v1/files/tasks/user/design.png'
const child = '/api/v1/files/tasks/user/region.png'
const tree = buildVersionForest({
  outputs: [child, parent],
  outputGroups: {
    [parent]: 'design-1',
    [child]: 'region-1',
  },
  outputGroupIndexes: {
    [parent]: 0,
    [child]: 0,
  },
  outputParents: {
    [child]: 'https://cdn.example.com/api/v1/files/tasks/user/design.png?exp=1',
  },
  outputDevices: {
    [parent]: 'web',
    [child]: 'web',
  },
})

assert.equal(tree.forest.length, 1)
assert.equal(tree.forest[0].label, 'V1')
assert.equal(tree.forest[0].children.length, 1)
assert.equal(tree.forest[0].children[0].label, 'V1.1')
assert.equal(tree.forest[0].children[0].cover, child)

console.log('version tree tests passed')
