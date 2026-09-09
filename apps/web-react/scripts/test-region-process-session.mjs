import assert from 'node:assert/strict'
import {
  assistantRunsToRegionJobs,
  buildRegionProcessSnapshot,
  inferredParentFromRegionJobs,
  recoverRegionBoxesFromJobs,
  shouldContinueRegionProcess,
} from '../src/legacy-modules/features/design-workshop/regionProcessState.js'

const snapshot = buildRegionProcessSnapshot({
  outputUrl: '/api/v1/files/tasks/parent.png',
  selections: [
    {
      id: 'box-1',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      resultUrl: 'data:image/png;base64,aaaa',
      runId: 'run-1',
      conversationId: 'conv-1',
      elements: [{ id: 'title', name: '标题', type: 'text', x: 1, y: 2, width: 3, height: 4 }],
    },
  ],
  prompt: '移除背景',
  editAction: 'improve-icon',
  loading: true,
})

assert.equal(snapshot.outputUrl, '/api/v1/files/tasks/parent.png')
assert.equal(snapshot.selections[0].resultUrl, '')
assert.equal(snapshot.resultUrl, '')
assert.equal(snapshot.runId, 'run-1')
assert.equal(snapshot.conversationId, 'conv-1')
assert.equal(snapshot.selections[0].elements[0].id, 'title')

const parent = '/api/v1/files/tasks/parent.png'
const recovered = recoverRegionBoxesFromJobs(
  [
    {
      id: 'box-1',
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      resultUrl: '',
      runId: '',
      conversationId: '',
      marked: [],
      elements: [],
    },
  ],
  [
    {
      id: 'job-1',
      status: 'succeeded',
      kind: 'ui-design-region-edit',
      input: {
        assistantRunId: 'run-done',
        conversationId: 'conv-done',
        parentOutputUrl: 'https://cdn.example.com/api/v1/files/tasks/parent.png?sig=1',
      },
      originalMediaUrls: ['/api/v1/files/tasks/region.png'],
    },
    {
      id: 'job-2',
      status: 'running',
      kind: 'ui-design-region-edit',
      input: {
        assistantRunId: 'run-live',
        conversationId: 'conv-live',
        parentOutputUrl: parent,
      },
      originalMediaUrls: [],
    },
  ],
  parent,
)

assert.equal(recovered[0].resultUrl, '/api/v1/files/tasks/region.png')
assert.equal(recovered[0].runId, 'run-done')
assert.equal(recovered[1].runId, 'run-live')
assert.equal(recovered[1].conversationId, 'conv-live')

const fromRuns = recoverRegionBoxesFromJobs(
  [],
  assistantRunsToRegionJobs([
    {
      id: 'run-server',
      conversationId: 'conv-server',
      status: 'running',
      serviceKey: 'ui_design_asset',
      parentOutputUrl: parent,
    },
  ]),
  '',
)
assert.equal(fromRuns.length, 1)
assert.equal(fromRuns[0].runId, 'run-server')
assert.equal(
  inferredParentFromRegionJobs([
    {
      status: 'running',
      kind: 'ui-design-region-edit',
      input: { parentOutputUrl: parent },
    },
  ]),
  parent,
)

assert.equal(
  shouldContinueRegionProcess({ loading: true }, [{ id: 'a', resultUrl: '', runId: '' }]),
  true,
)
assert.equal(
  shouldContinueRegionProcess({ loading: false }, [{ id: 'a', resultUrl: '', runId: '' }]),
  false,
)
assert.equal(
  shouldContinueRegionProcess({ loading: false }, [{ id: 'a', resultUrl: '', runId: 'run-1' }]),
  true,
)
assert.equal(
  shouldContinueRegionProcess({ loading: true }, [{ id: 'a', resultUrl: '/done.png', runId: 'run-1' }]),
  false,
)

console.log('region process session tests passed')
