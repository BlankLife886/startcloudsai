import assert from 'node:assert/strict'
import {
  galleryGroupTasks,
  resolveGalleryFocus,
} from '../src/legacy-modules/features/ai-wallpaper/domain/galleryFocus.js'

function image(key, batchId) {
  return { key, kind: 'image', task: { id: key, batchId } }
}

const otherGroup = image('other-0', 'other')
const batch = [0, 1, 2, 3].map((index) => image(`batch-${index}`, 'batch'))
const current = { key: batch[0].key, groupKey: 'batch' }

const afterDeletingFirst = resolveGalleryFocus([otherGroup, ...batch.slice(1)], current)
assert.equal(afterDeletingFirst.groupKey, 'batch')
assert.equal(afterDeletingFirst.key, batch[1].key)

const afterDeletingMiddle = resolveGalleryFocus([otherGroup, batch[0], batch[1], batch[3]], current)
assert.equal(afterDeletingMiddle.groupKey, 'batch')
assert.equal(afterDeletingMiddle.key, batch[0].key)

const afterDeletingLastInGroup = resolveGalleryFocus([otherGroup], {
  key: batch[3].key,
  groupKey: 'batch',
})
assert.equal(afterDeletingLastInGroup.groupKey, 'other')
assert.equal(afterDeletingLastInGroup.key, otherGroup.key)

const completedPending = resolveGalleryFocus([image('task-7-0', 'batch')], {
  key: 'pending-task-7-0',
  groupKey: 'batch',
})
assert.equal(completedPending.groupKey, 'batch')
assert.equal(completedPending.key, 'task-7-0')

const duplicatedTask = { id: 'multi-output-task' }
const groupTasks = galleryGroupTasks({
  items: [
    { task: batch[0].task },
    { task: batch[1].task },
    { task: duplicatedTask },
    { task: duplicatedTask },
  ],
})
assert.deepEqual(
  groupTasks.map((task) => task.id),
  [batch[0].task.id, batch[1].task.id, duplicatedTask.id],
)

console.log('gallery focus tests passed')
