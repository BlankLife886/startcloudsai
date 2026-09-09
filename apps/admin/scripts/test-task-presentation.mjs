import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTaskTimelineEvent, taskErrorMessage, taskStatusLabel, taskTotalDuration } from '../src/utils.ts'

const createdAt = '2026-09-06T13:15:14Z'
const task = { status: 'running', createdAt, startedAt: '2026-09-06T13:17:33Z' }

test('total duration keeps the original start across running, retry waiting and resumed execution', () => {
  const now = Date.parse('2026-09-06T13:17:35Z')
  for (const status of ['queued', 'running']) {
    for (const startedAt of [null, createdAt, task.startedAt]) {
      assert.equal(taskTotalDuration({ ...task, status, startedAt, attempt: 2 }, now), '2 分 21 秒')
    }
  }
  assert.equal(taskTotalDuration(task, now + 1000), '2 分 22 秒')
})

test('all terminal outcomes show a fixed lifetime including previous attempts', () => {
  for (const status of ['succeeded', 'failed', 'canceled']) {
    const finished = { ...task, status, finishedAt: '2026-09-06T13:18:33Z' }
    assert.equal(taskTotalDuration(finished, Date.parse('2026-09-07T13:15:14Z')), '3 分 19 秒')
  }
})

test('first queue wait and retry wait have distinct labels without changing terminal labels', () => {
  assert.equal(taskStatusLabel({ status: 'queued', attempt: 0 }), '排队中')
  assert.equal(taskStatusLabel({ status: 'queued', attempt: 2 }), '等待重试')
  assert.equal(taskStatusLabel({ status: 'running', attempt: 2 }), '生成中')
  assert.equal(taskStatusLabel({ status: 'succeeded', attempt: 2 }), '已成功')
  assert.equal(taskStatusLabel({ status: 'failed', attempt: 2 }), '已失败')
  assert.equal(taskStatusLabel({ status: 'canceled', errorCode: 'user_canceled' }), '用户已取消')
  assert.equal(taskStatusLabel({ status: 'canceled', errorCode: 'user_canceled', cancelPolicy: { upstreamSubmitted: false, canceledFrom: 'queued' } }), '排队已取消')
  assert.equal(taskStatusLabel({ status: 'canceled', errorCode: 'user_canceled', startedAt: task.startedAt, cancelPolicy: { upstreamSubmitted: false, canceledFrom: 'running' } }), '生成前已取消')
  assert.equal(taskStatusLabel({ status: 'canceled', errorCode: 'user_canceled', cancelPolicy: { upstreamSubmitted: true } }), '已停止接收')
})

test('invalid and missing terminal timestamps never produce a growing or negative lifetime', () => {
  assert.equal(taskTotalDuration({ ...task, createdAt: 'invalid' }), '-')
  assert.equal(taskTotalDuration({ ...task, status: 'failed', finishedAt: null }), '-')
  assert.equal(taskTotalDuration({ ...task, finishedAt: 'invalid' }), '-')
  assert.equal(taskTotalDuration(task, Date.parse(createdAt) - 1000), '0 秒')
  assert.equal(taskTotalDuration(task, Date.parse(createdAt) + 3660000), '1 小时 1 分')
})

test('legacy retry timelines stop presenting the accumulated age as queue wait', () => {
  const first = { stage: 'queued', durationMs: 262, message: '接单', meta: { attempt: 1 } }
  assert.equal(normalizeTaskTimelineEvent(first), first)
  const retry = { ...first, durationMs: 139000, meta: { attempt: 3 } }
  assert.deepEqual(normalizeTaskTimelineEvent(retry), {
    ...retry, stage: 'retry_started', durationMs: null, message: '开始第 3 次生成尝试',
  })
  assert.equal(retry.durationMs, 139000)
  const current = { ...first, stage: 'retry_started', durationMs: null, meta: { attempt: 3 } }
  assert.equal(normalizeTaskTimelineEvent(current), current)
})

test('old HTML gateway errors have readable summaries without hiding ordinary errors', () => {
  assert.equal(taskErrorMessage('<html><head><title>504 Gateway Time-out</title></head></html>'), '上游网关超时（HTTP 504）')
  assert.equal(taskErrorMessage('<html><h1>502 Bad Gateway</h1></html>'), '上游网关异常（HTTP 502）')
  assert.equal(taskErrorMessage('<!DOCTYPE html><h1>unavailable</h1>'), '上游服务返回异常网页')
  assert.equal(taskErrorMessage('参考图格式无效'), '参考图格式无效')
  assert.equal(taskErrorMessage(null), '')
})
