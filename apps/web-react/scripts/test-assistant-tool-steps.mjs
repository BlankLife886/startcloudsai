import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  assistantToolLabel,
  assistantToolStepsSummary,
  mergeAssistantToolSteps,
  normalizeAssistantToolSteps,
  summarizeAssistantToolArguments,
} from '../src/features/assistant/domain/assistantToolSteps.js'

test('a tool lifecycle collapses into one ordered step carrying its duration', () => {
  const running = mergeAssistantToolSteps([], {
    requestId: 'call-1',
    name: 'web_search',
    arguments: '{"query":"上海明天天气"}',
    status: 'running',
  }, { at: 1_000 })

  assert.equal(running.length, 1)
  assert.equal(running[0].label, '联网搜索')
  assert.equal(running[0].summary, '上海明天天气')
  assert.equal(running[0].status, 'running')
  assert.equal(running[0].durationMs, 0)

  const completed = mergeAssistantToolSteps(running, {
    requestId: 'call-1',
    name: 'web_search',
    status: 'completed',
    result: { sources: [] },
  }, { at: 3_400 })

  assert.equal(completed.length, 1, 'the completion event updates the step instead of appending a new one')
  assert.equal(completed[0].status, 'completed')
  assert.equal(completed[0].durationMs, 2_400)
  assert.equal(completed[0].summary, '上海明天天气', 'the completion event keeps the summary from the arguments')
  assert.deepEqual(completed[0].result, { sources: [] })
})

test('a late running event cannot revive a finished step', () => {
  const finished = mergeAssistantToolSteps([], {
    requestId: 'call-1',
    name: 'files_read',
    status: 'failed',
    error: '附件已过期',
  }, { at: 1_000 })

  const replayed = mergeAssistantToolSteps(finished, {
    requestId: 'call-1',
    name: 'files_read',
    status: 'running',
  }, { at: 2_000 })

  assert.equal(replayed, finished, 'a redelivered running event must not reopen a resolved step')
  assert.equal(replayed[0].status, 'failed')
  assert.equal(replayed[0].error, '附件已过期')
})

test('distinct calls stay in execution order and events without a name are ignored', () => {
  let steps = mergeAssistantToolSteps([], { requestId: 'a', name: 'web_search', status: 'completed' }, { at: 1_000 })
  steps = mergeAssistantToolSteps(steps, { requestId: 'b', name: 'files_read', status: 'running' }, { at: 1_100 })
  steps = mergeAssistantToolSteps(steps, { requestId: 'c', name: '', status: 'running' }, { at: 1_200 })

  assert.deepEqual(steps.map((step) => step.name), ['web_search', 'files_read'])
})

test('calls without a request id are keyed by name and arguments', () => {
  let steps = mergeAssistantToolSteps([], { name: 'files_read', arguments: '{"fileId":"a"}', status: 'running' }, { at: 1_000 })
  steps = mergeAssistantToolSteps(steps, { name: 'files_read', arguments: '{"fileId":"b"}', status: 'running' }, { at: 1_000 })
  assert.equal(steps.length, 2, 'different arguments are different steps')

  steps = mergeAssistantToolSteps(steps, { name: 'files_read', arguments: '{"fileId":"a"}', status: 'completed' }, { at: 1_500 })
  assert.equal(steps.length, 2, 'the same arguments resolve the existing step')
  assert.equal(steps[0].status, 'completed')
})

test('partial or unknown tool arguments degrade without throwing', () => {
  assert.equal(summarizeAssistantToolArguments('{"query":"半截的 JSON'), '', 'streamed arguments may not be parseable yet')
  assert.equal(summarizeAssistantToolArguments(''), '')
  assert.equal(summarizeAssistantToolArguments('{"count":3}'), '', 'non-string fields make no readable summary')
  assert.equal(summarizeAssistantToolArguments('{"somethingNew":"回退到第一个字符串"}'), '回退到第一个字符串')
  assert.equal(summarizeAssistantToolArguments(`{"query":"${'长'.repeat(200)}"}`).length, 73, 'long summaries are clamped with an ellipsis')
  assert.equal(assistantToolLabel('a_tool_added_later'), 'a_tool_added_later', 'unknown tools fall back to their raw name')
})

test('persisted steps from message metadata normalize into the same shape', () => {
  const steps = normalizeAssistantToolSteps([
    { requestId: 'call-1', name: 'web_search', arguments: '{"query":"积分退款规则"}', status: 'completed', durationMs: 2_400 },
    { requestId: 'call-2', name: 'propose_image_action', status: 'failed', error: '解析失败' },
    { name: '', status: 'completed' },
  ])

  assert.equal(steps.length, 2)
  assert.equal(steps[0].label, '联网搜索')
  assert.equal(steps[0].summary, '积分退款规则')
  assert.equal(steps[0].durationMs, 2_400)
  assert.equal(steps[1].label, '整理图片方案')
  assert.equal(steps[1].status, 'failed')
  assert.deepEqual(normalizeAssistantToolSteps(steps), steps, 'normalizing live steps again changes nothing')
  assert.deepEqual(normalizeAssistantToolSteps(undefined), [])
})

test('the timeline summary reports progress and failures', () => {
  assert.equal(assistantToolStepsSummary([{ status: 'completed' }, { status: 'completed' }]), '2 个步骤')
  assert.equal(
    assistantToolStepsSummary([{ status: 'completed' }, { status: 'running' }, { status: 'failed' }]),
    '3 个步骤 · 1 个进行中 · 1 个失败',
  )
})

test('the workspace controller feeds every tool event into the timeline', async () => {
  const controller = await readFile(
    new URL('../src/features/assistant/useAssistantWorkspaceController.js', import.meta.url),
    'utf8',
  )

  assert.match(
    controller,
    /const toolSteps = event\?\.tool \? mergeAssistantToolSteps\(message\.toolSteps, event\.tool\) : message\.toolSteps/,
    'tool events other than a completed web search must also reach the timeline',
  )
  assert.match(controller, /\.\.\.\(toolSteps\?\.length \? \{ toolSteps \} : \{\}\)/)
  assert.match(
    controller,
    /toolSteps: message\.toolSteps\?\.length \? message\.toolSteps : persisted\?\.toolSteps/,
    'the terminal snapshot must not drop the richer streamed steps',
  )
})

test('the worker persists tool steps onto the assistant message', async () => {
  const worker = await readFile(new URL('../../server/internal/worker/assistant.go', import.meta.url), 'utf8')

  assert.match(worker, /metadata\["toolSteps"\] = steps/)
  assert.equal(
    worker.match(/attachAssistantToolSteps\(metadata, toolSteps\)/g)?.length,
    3,
    'the streaming checkpoint and both completion paths must attach the steps',
  )
  assert.match(
    worker,
    /Name: proposalTool\.Name, Arguments: string\(arguments\), Execution: "server", Status: "running"/,
    'the image proposal step needs a stream event to appear on the timeline',
  )
})
