import assert from 'node:assert/strict'
import {
  serverTaskStartedAt,
  taskGenerationElapsedMs,
} from '../src/legacy-modules/features/ai-wallpaper/domain/taskGenerationTiming.js'

const createdAt = '2026-08-10T01:00:00.000Z'
const startedAt = '2026-08-10T01:05:00.000Z'
const finishedAt = '2026-08-10T01:05:12.000Z'

assert.equal(
  serverTaskStartedAt({ status: 'queued', createdAt, startedAt: null }),
  0,
  '排队任务不能用 createdAt 作为生成开始时间',
)
assert.equal(
  taskGenerationElapsedMs({ status: 'queued', createdAt, startedAt: Date.parse(createdAt) }),
  0,
  '即使旧缓存污染了 startedAt，排队任务也不能累计生成耗时',
)
assert.equal(
  taskGenerationElapsedMs(
    { status: 'running', createdAt, startedAt },
    Date.parse('2026-08-10T01:05:07.000Z'),
  ),
  7000,
  '运行任务应从 startedAt 开始计时',
)
assert.equal(
  taskGenerationElapsedMs({
    status: 'completed',
    createdAt,
    startedAt,
    finishedAt,
    durationMs: 99_000,
  }),
  12000,
  '完成任务应只计算 finishedAt - startedAt',
)

console.log('task generation timing checks passed')
