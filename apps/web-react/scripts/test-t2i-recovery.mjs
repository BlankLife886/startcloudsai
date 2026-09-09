import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { batchQuotePayload, createSubmissionBatch, historyTaskReferences, pendingBatchEntries, submitPendingBatch } from '../src/features/text-to-image/submissionBatch.js';
import { isEmptyHistoryTask, removeEmptyHistory } from '../src/features/history/historyCleanup.js';
import { historyTaskQueryScope, historyTaskDeleteTarget, historyTaskRequiresForceMediaRemoval } from '../src/features/history/historyTaskQuery.js';
import { savePendingBatch, readPendingBatch } from '../src/features/text-to-image/pendingBatchStore.js';
import { submissionFailure, submissionTask, serverTaskCounts, LOCAL_SUBMISSION_STATUSES, QUEUE_CAPACITY_CODES, taskStatePresentation } from '../src/features/text-to-image/submissionState.js';
import { taskTimestamp, taskGenerationElapsedMs, taskTotalElapsedMs } from '../src/legacy-modules/features/ai-wallpaper/domain/taskGenerationTiming.js';

const read = (path) => ts.createSourceFile(path, fs.readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const view = read('../src/views/TextToImageView.jsx');
const hook = read('../src/features/text-to-image/useTextToImageJobs.js');
const api = read('../src/legacy-modules/services/tasksApi.js');
const adapter = read('../src/legacy-modules/services/aiWallpaper.js');
const historyView = read('../src/views/HistoryView.jsx');
const assistantController = read('../src/features/assistant/useAssistantWorkspaceController.js');
const canvasProject = read('../src/canvas/pages/canvas/project.tsx');
function declaration(source, name) {
  let found;
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) && node.name?.text === name) || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === name))) found = node.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, `missing ${name}`);
  return found;
}
function execute(source, context) {
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context;
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const buildPayload = ({ sourceUrls, batchIndex, ...batch }) => ({
  clientRequestId: crypto.randomUUID(), kind: sourceUrls.length ? 'wallpaper-image-edit' : 'wallpaper-image-generation',
  prompt: 'frozen prompt', input: { sourceUrls, batchIndex, ...batch }, params: { publicModelKey: 'model-A' }, expectedUnitPriceCents: 5,
});

function hookHarness(overrides = {}) {
  let cursor = 0;
  const cells = [], effects = [];
  const context = {
    exports: {}, console, AbortController, DOMException, setTimeout, clearTimeout, createSubmissionBatch, submitPendingBatch, removeEmptyHistory,
    savePendingBatch, readPendingBatch, pendingBatchEntries, submissionFailure, submissionTask,
    findServerAiJob: async () => ({ job: null }), prepareAiInputReference: async (item) => ({ key: item.key || 'reference-key', url: item.url }),
    listActiveServerAiJobs: async () => [],
    listServerAiJobs: async () => ({ jobs: [] }), waitForServerAiJob: async () => new Promise(() => {}),
    ...overrides,
  };
  context.useState = (initial) => {
    const index = cursor++;
    if (!cells[index]) cells[index] = { value: typeof initial === 'function' ? initial() : initial };
    return [cells[index].value, (value) => { cells[index].value = typeof value === 'function' ? value(cells[index].value) : value; }];
  };
  context.useRef = (initial) => {
    const index = cursor++;
    if (!cells[index]) cells[index] = { current: initial };
    return cells[index];
  };
  context.useCallback = (fn) => { cursor++; return fn; };
  context.useEffect = (fn, deps) => {
    const index = cursor++;
    if (!cells[index] || deps.some((dep, depIndex) => !Object.is(dep, cells[index].deps[depIndex]))) effects.push(() => {
      cells[index]?.cleanup?.();
      cells[index] = { deps, cleanup: fn() };
    });
  };
  execute([
    declaration(hook, 'ACTIVE_STATUSES'), declaration(hook, 'outputUrls'), declaration(hook, 'taskFromJob'),
    declaration(hook, 'newestFirst'), declaration(hook, 'upsertInto'), declaration(hook, 'mergeTaskPages'),
    declaration(hook, 'useTextToImageJobs'),
  ].join('\n'), context);
  return (props = { authenticated: true, userId: 'A' }) => {
    cursor = 0;
    const value = context.exports.useTextToImageJobs(props);
    for (const effect of effects.splice(0)) effect();
    return value;
  };
}

test('queued cancellation requires a second, nonrefundable confirmation after the upstream starts', async () => {
  const requests = [], messages = [];
  const context = {
    cancelTarget: { id: 'task-1', status: 'queued', cancelPolicy: { upstreamSubmitted: false } }, actionBusyId: '',
    workspaceActiveRef: { current: true }, ACTIVE_STATUSES: new Set(['queued', 'running']),
    setActionBusyId() {}, setCancelTarget: (task) => { context.cancelTarget = task; },
    jobs: {
      cancelTask: async (_task, options) => {
        requests.push(options.acknowledgeUpstream);
        if (!options.acknowledgeUpstream) throw Object.assign(new Error('confirm upstream'), { code: 'task_cancel_confirmation_required' });
        return { status: 'cancelled', cancelPolicy: { upstreamSubmitted: true, refunded: false } };
      },
      refreshTask: async () => ({ id: 'task-1', status: 'running', generationStage: 'upstream_generating', cancelPolicy: { upstreamSubmitted: true } }),
    },
    notificationService: { success: (message) => messages.push(message), warning() {}, error: (message) => { throw new Error(message); } },
  };
  execute([declaration(view, 'cancelDialogContent'), declaration(view, 'confirmCancel'), 'globalThis.run = confirmCancel; globalThis.dialog = cancelDialogContent;'].join('\n'), context);
  assert.equal(context.dialog(context.cancelTarget).acknowledgeUpstream, false);
  await context.run();
  assert.deepEqual(requests, [false]);
  assert.equal(messages.length, 0);
  assert.match(context.dialog(context.cancelTarget).description, /不会退回/);
  await context.run();
  assert.deepEqual(requests, [false, true]);
  assert.match(messages[0], /不会退回/);
  assert.doesNotMatch(messages[0], /已退回/);
});

test('cancellation success uses the returned refund policy', async () => {
  const messages = [];
  const context = {
    cancelTarget: { id: 'task-1', status: 'queued' }, actionBusyId: '', workspaceActiveRef: { current: true },
    setActionBusyId() {}, setCancelTarget() {},
    jobs: { cancelTask: async () => ({ cancelPolicy: { refunded: true, upstreamSubmitted: false } }) },
    notificationService: { success: (message) => messages.push(message), error: (message) => { throw new Error(message); } },
  };
  execute([declaration(view, 'cancelDialogContent'), declaration(view, 'confirmCancel'), 'globalThis.run = confirmCancel;'].join('\n'), context);
  await context.run();
  assert.match(messages[0], /冻结积分已退回/);
});

test('a newer running stage cannot silently turn a refund dialog into fee-forfeiting consent', async () => {
  const context = {};
  execute(declaration(view, 'cancelDialogContent') + '\nglobalThis.dialog = cancelDialogContent;', context);
  const dialog = context.dialog({
    status: 'running', generationStage: 'upstream_generating',
    cancelPolicy: { upstreamSubmitted: false, message: '取消后冻结积分会立即退回。' },
  });
  assert.match(dialog.description, /退回/);
  assert.equal(dialog.acknowledgeUpstream, false);
});

test('group confirmation authorizes only the images shown as submitted', () => {
  const context = {};
  execute(declaration(view, 'cancelDialogContent') + '\nglobalThis.dialog = cancelDialogContent;', context);
  const dialog = context.dialog({ tasks: [
    { id: 'queued', serverJobId: 'queued', status: 'queued', cancelPolicy: { upstreamSubmitted: false } },
    { id: 'sent', serverJobId: 'sent', status: 'running', cancelPolicy: { upstreamSubmitted: true } },
  ] });
  assert.equal(dialog.acknowledgeUpstream, false);
  assert.deepEqual(Array.from(dialog.acknowledgedTaskIds), ['sent']);
  assert.match(dialog.description, /1 张尚未提交/);
  assert.match(dialog.description, /1 张已提交/);
});

test('assistant deferred cancellation keeps the original fee consent and account scope', async () => {
  let pending = [];
  const calls = [];
  const context = {
    readPendingAssistantCancels: () => pending,
    writePendingAssistantCancels: items => { pending = items; },
    cancelAssistantRun: async (id, options) => {
      calls.push({ id, ...options });
      throw Object.assign(new Error('confirm required'), { code: 'assistant_cancel_confirmation_required', status: 409 });
    },
  };
  execute(['queuePendingAssistantCancel','assistantRequestIsTransient','flushPendingAssistantCancels'].map(name => declaration(assistantController,name)).join('\n') + '\nglobalThis.enqueue=queuePendingAssistantCancel;globalThis.flush=flushPendingAssistantCancels;',context);
  context.enqueue({ id:'A-run' },false,'A');
  context.enqueue({ id:'B-run' },true,'B');
  await context.flush('A');
  assert.deepEqual(calls,[{ id:'A-run',acknowledgeUpstream:false }]);
  assert.equal(pending.length,2);
  assert.equal(pending[0].acknowledgeUpstream,false);
});

test('canvas partial cancellation never finalizes a node whose server cancellation failed', async () => {
  const finalized = [], aborted = [];
  const context = {
    useCallback: fn => fn, stopConfirm: { nodeId:'parent' },stopSubmitting:false,setStopSubmitting() {},
    nodesRef:{current:[{id:'parent',metadata:{workflowOutputNodeIds:['ok','bad']}},{id:'ok',metadata:{workflowProducerNodeId:'parent'}},{id:'bad',metadata:{workflowProducerNodeId:'parent'}}]},
    generationRequestsRef:{current:new Map([['group',{targetNodeId:'parent',originNodeId:'parent',runningNodeId:'parent',controller:{abort:()=>aborted.push('group')}}]])},
    pendingCanvasTasks:()=>[{nodeId:'ok',kind:'image',taskId:'ok-task'},{nodeId:'bad',kind:'image',taskId:'bad-task'}],
    cancelPersistedCanvasTask:async id=>{if(id==='bad-task')throw new Error('network failure');return {status:'canceled'};},
    hasSubmittedCanvasTask:()=>true,
    finalizeCanceledGenerationNodes: ids=>finalized.push(...ids),setRunningNodeIds() {},setStopConfirm() {},
    message:{error() {},info() {}},t:key=>key,
  };
  execute(declaration(canvasProject,'stopRunningGeneration')+'\nglobalThis.stop=stopRunningGeneration;',context);
  await context.stop();
  assert.equal(finalized.includes('bad'),false);
  assert.deepEqual(aborted,[]);
});

test('pending cards keep their identity when the server accepts them', () => {
  const context = { ACTIVE_STATUSES: new Set(['queued', 'running', 'waiting_provider']), LOCAL_SUBMISSION_STATUSES };
  execute(['taskOutputs', 'taskThumbnailOutputs', 'taskDisplayOutputs', 'taskGroupKey', 'buildGalleryItems'].map(name => declaration(view, name)).join('\n') + '\nglobalThis.items = buildGalleryItems;', context);
  const temporary = { id: 'client', clientRequestId: 'client', serverJobId: '', status: 'submitting', batchId: 'group', batchIndex: 0, batchSize: 1 };
  const accepted = { ...temporary, id: 'server', serverJobId: 'server', status: 'queued' };
  assert.equal(context.items([temporary])[0].key, context.items([accepted])[0].key);
  assert.equal(context.items([accepted])[0].key, context.items([{ ...accepted, status: 'completed', outputs: ['image.png'] }])[0].key);
});

test('an unaccepted batch survives refresh with its original keys, parameters and rejection reason', () => {
  const data = new Map();
  const storage = { setItem: (key, value) => data.set(key, value), getItem: key => data.get(key), removeItem: key => data.delete(key) };
  const batch = createSubmissionBatch({ count: 2, sourceUrls: ['/api/v1/files/ref.png'], buildPayload });
  batch.entries[0].task = { id: 'accepted', serverJobId: 'accepted', status: 'queued' };
  batch.entries[1].error = { code: 'system_image_capacity', message: '队列已满' };
  savePendingBatch('A', batch, storage);
  const restored = readPendingBatch('A', storage);
  assert.deepEqual(restored.entries[1].payload, batch.entries[1].payload);
  assert.equal(submissionFailure(restored.entries[1].error).status, 'queue_full');
  assert.equal(readPendingBatch('B', storage), null);
  assert.equal(pendingBatchEntries(restored).length, 1);
  restored.entries[1].discarded = true;
  savePendingBatch('A', restored, storage);
  assert.equal(readPendingBatch('A', storage), null);
});

test('refresh checks accepted requests without creating any new task', async () => {
  const batch = createSubmissionBatch({ count: 2, sourceUrls: [], buildPayload });
  let created = 0;
  const render = hookHarness({
    readPendingBatch: () => batch, savePendingBatch() {},
    createServerAiJob: async () => { created++; },
    findServerAiJob: async (key) => ({ job: key === batch.entries[0].payload.clientRequestId ? { id: 'already-accepted', status: 'running' } : null }),
  });
  render();
  await settle();
  const jobs = render();
  assert.equal(created, 0);
  assert.equal(pendingBatchEntries(jobs.pendingBatch).length, 1);
  assert.ok(jobs.tasks.some(task => task.id === 'already-accepted'));
  const local = jobs.tasks.find(task => !task.serverJobId);
  assert.equal(local.status, 'submission_pending');
  assert.equal(serverTaskCounts(jobs.tasks).queued, 0);
  assert.equal(serverTaskCounts(jobs.tasks).running, 1);
});

test('refresh keeps every accepted active task beyond the recent-result page', async () => {
  const active = Array.from({ length: 80 }, (_, index) => ({ id: `queued-${index}`, status: 'queued' }));
  const render = hookHarness({
    listServerAiJobs: async () => ({ jobs: [{ id: 'recent-result', status: 'completed', originalMediaUrls: ['saved.png'] }] }),
    listActiveServerAiJobs: async () => active,
  });
  render();
  await settle();
  assert.equal(render().tasks.length, 81);
  assert.equal(serverTaskCounts(render().tasks).queued, 80);
});

test('queue capacity rejection remains unsubmitted and preserves the request for retry', async () => {
  let calls = 0;
  const render = hookHarness({ createServerAiJob: async () => {
    if (++calls === 1) return { job: { id: 'accepted-1', status: 'queued' } };
    throw Object.assign(new Error('你的任务队列已满'), { code: 'user_task_limit', status: 429 });
  } });
  await assert.rejects(render().createBatch({ count: 2, buildPayload }), { code: 'user_task_limit' });
  const jobs = render();
  assert.equal(jobs.submitting, false);
  assert.deepEqual(serverTaskCounts(jobs.tasks), { running: 0, queued: 1, submitting: 0, pending: 1 });
  assert.equal(jobs.tasks.find(task => !task.serverJobId).status, 'queue_full');
  assert.equal(pendingBatchEntries(jobs.pendingBatch).length, 1);
});

test('queued and unsubmitted cards hide seconds while completed generation time stays fixed', () => {
  const context = { LOCAL_SUBMISSION_STATUSES, ACTIVE_STATUSES: new Set(['queued', 'running', 'waiting_provider']), taskTimestamp, taskGenerationElapsedMs };
  execute([declaration(view, 'formatElapsed'), declaration(view, 'generationElapsedLabel'), 'globalThis.label = generationElapsedLabel;'].join('\n'), context);
  const createdAt = '2026-09-09T00:00:00Z';
  for (const status of ['queued', 'submitting', 'queue_full', 'submission_unknown']) assert.equal(context.label({ status, createdAt }, Date.parse(createdAt) + 60000), '');
  assert.equal(context.label({ status: 'completed', createdAt, startedAt: '2026-09-09T00:00:40Z', finishedAt: '2026-09-09T00:01:00Z' }, Date.parse(createdAt) + 120000), '0:20');
});

test('cards leaving the queue use each image start time and retain the complete total', () => {
  const context = { LOCAL_SUBMISSION_STATUSES, ACTIVE_STATUSES: new Set(['queued', 'running', 'waiting_provider']), taskTimestamp, taskGenerationElapsedMs, taskTotalElapsedMs };
  execute(['formatElapsed', 'generationElapsedLabel'].map(name => declaration(view, name)).join('\n') + '\nglobalThis.generation = generationElapsedLabel;', context);
  const createdAt = '2026-09-09T19:27:22.819+08:00';
  const now = Date.parse(createdAt) + 56_000;
  const startedTimes = ['19:28:07.439', '19:28:08.520', '19:28:14.395', '19:28:11.451'];
  const expected = ['0:11', '0:10', '0:04', '0:07'];
  startedTimes.forEach((time, index) => {
    const task = { status: 'queued', createdAt, startedAt: '' };
    assert.equal(context.generation(task, now), '');
    task.status = 'running';
    task.startedAt = `2026-09-09T${time}+08:00`;
    assert.equal(context.generation(task, now), expected[index]);
    assert.equal(taskTotalElapsedMs(task, now), 56_000);
    assert.equal(context.generation(JSON.parse(JSON.stringify(task)), now), expected[index], 'refresh must keep the server start time');
  });
  const retry = { status: 'running', createdAt, startedAt: new Date(now - 5_000).toISOString() };
  assert.equal(context.generation(retry, now), '0:05');
  assert.equal(taskTotalElapsedMs(retry, now), 56_000, 'a new attempt must not erase recorded total time');
  const completed = { ...retry, status: 'completed', finishedAt: new Date(now).toISOString() };
  assert.equal(taskTotalElapsedMs(completed, now + 60_000), 56_000, 'completed total must stop ticking');
});

test('queued recovery is distinguished from ordinary queuing and never invents a start time', () => {
  const context = { LOCAL_SUBMISSION_STATUSES, ACTIVE_STATUSES: new Set(['queued', 'running', 'waiting_provider']), taskTimestamp, taskGenerationElapsedMs, taskTotalElapsedMs };
  execute(['formatElapsed', 'generationElapsedLabel'].map(name => declaration(view, name)).join('\n') + '\nglobalThis.generation = generationElapsedLabel;', context);
  const createdAt = '2026-09-09T00:00:00Z';
  const now = Date.parse(createdAt) + 60_000;
  const task = { status: 'queued', createdAt, startedAt: '2026-09-09T00:00:40Z' };
  assert.equal(context.generation(task, now), '', 'old queued snapshots may contain a stale start time');
  task.cancelPolicy = { upstreamSubmitted: true };
  assert.equal(context.generation(task, now), '0:20');
  for (const startedAt of ['', 'invalid']) {
    assert.equal(context.generation({ ...task, startedAt }, now), '');
    assert.equal(context.generation({ ...task, status: 'running', startedAt }, now), '');
  }
});

test('empty history includes ended and stopped tasks while protecting active work and every output reference', () => {
  for (const status of ['failed', 'paused', 'canceled', 'cancelled', 'completed', 'succeeded']) {
    assert.equal(isEmptyHistoryTask({ status, inputKeys: ['source.png'] }), true);
    for (const field of ['outputKeys', 'thumbnailKeys', 'outputs', 'originalOutputs', 'thumbnailOutputs', 'displayOutputs', 'originalUrls', 'outputUrls', 'thumbnailUrls', 'displayUrls']) {
      assert.equal(isEmptyHistoryTask({ status, [field]: ['saved.png'] }), false, `${status} ${field}`);
    }
  }
  assert.equal(isEmptyHistoryTask({ status: 'succeeded', outputs: [{ url: 'saved.mp4' }] }), false);
  assert.equal(isEmptyHistoryTask({ status: 'failed', originalMediaUrl: 'saved.png' }), false);
  for (const status of ['queued', 'running', 'waiting_provider', '', 'unknown']) {
    assert.equal(isEmptyHistoryTask({ status }), false);
  }
});

test('empty history cleanup scans all pages, deduplicates, preserves images, and reports individual failures', async () => {
  const pages = [], deleted = [];
  let active = 0, maximum = 0;
  const result = await removeEmptyHistory({
    assertCurrent() {},
    listPage: async (cursor) => {
      pages.push(cursor);
      return cursor === ''
        ? { tasks: [{ id: 'stopped', status: 'cancelled' }, { id: 'late-image', status: 'completed' }, { id: 'working', status: 'running' }], nextCursor: 'older' }
        : { tasks: [{ id: 'stopped', status: 'cancelled' }, { id: 'late-image', status: 'completed', outputKeys: ['saved.png'] }, ...Array.from({ length: 8 }, (_, i) => ({ id: `failed-${i}`, status: 'failed' }))] };
    },
    removeTask: async (task, options) => {
      assert.equal(options.onlyEmpty, true);
      assert.deepEqual(pages, ['', 'older']);
      deleted.push(task.id);
      maximum = Math.max(maximum, ++active);
      await settle();
      active--;
      if (task.id === 'failed-2') throw new Error('temporary failure');
    },
  });
  assert.equal(new Set(deleted).size, 9);
  assert.equal(deleted.includes('working'), false);
  assert.equal(deleted.includes('late-image'), false);
  assert.ok(maximum <= 4);
  assert.deepEqual(result, { removed: 8, failed: 1 });
});

test('a broken history page stops cleanup before any deletion', async () => {
  let calls = 0;
  await assert.rejects(removeEmptyHistory({
    assertCurrent() {},
    listPage: async () => ({ tasks: [{ id: 'failed', status: 'failed' }], nextCursor: 'repeated' }),
    removeTask: async () => { calls++; },
  }), /分页异常/);
  assert.equal(calls, 0);
});

test('empty-task deletion skips the dialog and double-clicks, while deleting a saved image still confirms', async () => {
  const pending = deferred(), deleted = [], dialogs = [];
  const context = {
    isEmptyHistoryTask, actionBusyId: '', deletionInFlightRef: { current: false }, workspaceActiveRef: { current: true },
    setActionBusyId() {}, setActiveTaskId() {}, setDeleteTarget: (target) => dialogs.push(target),
    notificationService: { warning() {} }, jobs: { removeTask: async (task) => { deleted.push(task.id); await pending.promise; } },
  };
  execute([declaration(view, 'deleteTasks'), declaration(view, 'requestDelete'), 'globalThis.remove = requestDelete;'].join('\n'), context);
  context.remove([{ id: 'stopped', status: 'cancelled' }]);
  context.remove([{ id: 'stopped', status: 'cancelled' }]);
  assert.deepEqual(deleted, ['stopped']);
  assert.equal(dialogs.length, 0);
  pending.resolve();
  await settle();
  context.remove([{ id: 'image', serverJobId: 'image', status: 'failed', outputKeys: ['saved.png'] }]);
  assert.deepEqual(deleted, ['stopped']);
  assert.equal(dialogs.at(-1).tasks[0].id, 'image');
});

test('cleanup abandons a pending page on account change without deleting under the new account', async () => {
  const page = deferred(), deleted = [];
  const render = hookHarness({
    listServerAiJobs: async (limit) => limit === 100 ? page.promise : { jobs: [] },
    deleteServerAiJob: async (id) => { deleted.push(id); },
  });
  const cleanup = render().clearEmptyHistory();
  const rejection = assert.rejects(cleanup, { name: 'AbortError' });
  render({ authenticated: true, userId: 'B' });
  page.resolve({ jobs: [{ id: 'account-A-task', status: 'cancelled' }] });
  await rejection;
  assert.deepEqual(deleted, []);
  assert.equal(render({ authenticated: true, userId: 'B' }).clearingEmptyHistory, false);
});

test('a stale list response cannot restore a record after successful deletion', async () => {
  const page = deferred();
  const job = { id: 'deleted', status: 'failed' };
  const render = hookHarness({
    listServerAiJobs: async (limit) => limit === 30 ? page.promise : { jobs: [job] },
    deleteServerAiJob: async () => ({}),
  });
  const props = { authenticated: true, userId: 'A', historyActive: true };
  const jobs = render(props);
  await settle();
  assert.equal(render(props).historyTasks.length, 1);
  await jobs.removeTask({ id: 'deleted', serverJobId: 'deleted' });
  page.resolve({ jobs: [job] });
  await settle();
  assert.equal(render(props).tasks.length, 0);
  assert.equal(render(props).historyTasks.length, 0);
});

test('global history cleans all terminal empty records in the selected source without force-removing media', async () => {
  const queries = [], deletions = [], notices = [];
  const context = {
    bulkBusy: false, cleanupRef: { current: false }, mountedRef: { current: true },
    cleanupContextRef: { current: { userId: 'A', typeFilter: 'react_canvas' } },
    isEmptyHistoryTask, removeEmptyHistory, historyTaskQueryScope, historyTaskDeleteTarget, historyTaskRequiresForceMediaRemoval,
    DOMException, setBulkBusy() {}, setEmptyCleanupBusy() {}, setTasks() {}, setSelectedIds() {}, loadTasks: async () => {},
    notificationService: { success: (text) => notices.push(text), info: (text) => notices.push(text), warning: (text) => { throw new Error(text); }, error: (text) => { throw new Error(text); } },
    listTasks: async (query) => {
      queries.push(query);
      return query.cursor === ''
        ? { items: [{ id: 'failed', status: 'failed' }, { id: 'saved', status: 'failed', originalUrls: ['image.png'] }], nextCursor: 'page-2' }
        : { items: [{ id: 'stopped', status: 'canceled', type: 'assistant' }, { id: 'running', status: 'running' }, { id: 'empty-success', status: 'succeeded' }, { id: 'audio', status: 'succeeded', outputKeys: ['audio.mp3'] }] };
    },
    deleteTask: async (id, options) => { deletions.push({ id, ...options }); },
  };
  execute([declaration(historyView, 'isHistoryTaskDeletable'), declaration(historyView, 'deleteHistoryTask'), declaration(historyView, 'clearEmptyHistory'), 'globalThis.clear = clearEmptyHistory;'].join('\n'), context);
  await context.clear();
  assert.deepEqual(queries.map(({ cursor }) => cursor), ['', 'page-2']);
  for (const query of queries) {
    assert.equal(query.source, 'react_canvas');
    assert.equal(query.type, '');
    assert.equal(query.status, undefined);
  }
  assert.deepEqual(deletions.map(({ id }) => id), ['failed', 'stopped', 'empty-success']);
  for (const deletion of deletions) {
    assert.equal(deletion.onlyEmpty, true);
    assert.equal(deletion.history, true);
    assert.equal(deletion.forceMedia, false);
    assert.equal(deletion.cascade, false);
  }
  assert.match(notices[0], /已清除 3 条无图片数据/);
});

test('partial price change retries only the missing slot using its original model and key', async () => {
  const calls = [], accepted = new Map();
  const render = hookHarness({ createServerAiJob: async (payload) => {
    calls.push(structuredClone({ ...payload, isCurrentSession: undefined }));
    if (calls.length === 2) throw Object.assign(new Error('price changed'), { code: 'price_changed' });
    accepted.set(payload.clientRequestId, payload.expectedUnitPriceCents);
    return { job: { id: payload.clientRequestId, status: 'queued' } };
  } });
  const jobs = render();
  let rejected;
  await assert.rejects(jobs.createBatch({ count: 2, buildPayload }), (error) => { rejected = error; return error.code === 'price_changed'; });
  const recovered = render();
  assert.equal(recovered.submitting, false);
  assert.equal(pendingBatchEntries(recovered.pendingBatch).length, 1);
  assert.equal(batchQuotePayload(recovered.pendingBatch).params.publicModelKey, 'model-A');
  await recovered.createBatch({ retryBatch: rejected.batch, confirmedUnitPrice: 8, count: 4, buildPayload: () => { throw new Error('must not use newly selected model'); } });
  assert.equal(calls.length, 3);
  assert.equal(accepted.size, 2);
  assert.deepEqual([...accepted.values()], [5, 8]);
  assert.equal(calls[1].clientRequestId, calls[2].clientRequestId);
  assert.equal(calls[2].params.publicModelKey, 'model-A');
  assert.equal(render().pendingBatch, null);
});

test('replacement quote counts only missing images and quotes the saved model', async () => {
  const batch = createSubmissionBatch({ count: 2, sourceUrls: [], buildPayload });
  batch.entries[0].task = { id: 'accepted' };
  let cost, quoteInput;
  const busyStates = [];
  const context = {
    useCallback: (fn) => fn, batchQuotePayload, pendingBatchEntries, quoteRequestRef: { current: 0 }, workspaceActiveRef: { current: true },
    quoteBusyRef: { current: 0 }, setQuotingCost: value => busyStates.push(value),
    buildPayload: () => { throw new Error('must not quote current model'); }, count: 4,
    getWallet: async () => ({ availableCents: 100 }), quoteServerAiJob: async (payload) => { quoteInput = payload; return { unitPriceCents: 8 }; },
    getFeatureUnitPriceCents: async () => 99, currentModel: { id: 'model-B' }, feature: { creditCost: 99 },
    quotedUnitPriceRef: { current: null }, autoRemove: false, backgroundRemovalModel: null, backgroundRemovalModels: [],
    setCost: (value) => { cost = value; },
  };
  execute(declaration(view, 'refreshGenerationCost') + '\nglobalThis.run = refreshGenerationCost;', context);
  await context.run({ batch, authoritativeOnly: true });
  assert.equal(quoteInput.params.publicModelKey, 'model-A');
  assert.equal(cost.count, 1);
  assert.equal(cost.total, 8);
  assert.equal(cost.batch, batch);
  assert.deepEqual(busyStates, [true, false]);
  assert.equal(context.quoteBusyRef.current, 0);
});

test('lost accepted POST response replays the same payload and does not create a second image', async () => {
  const batch = createSubmissionBatch({ count: 1, sourceUrls: [], buildPayload });
  const received = [], server = new Map();
  const submit = async (payload) => {
    received.push(structuredClone(payload));
    if (!server.has(payload.clientRequestId)) {
      server.set(payload.clientRequestId, { id: 'server-accepted-once' });
      throw Object.assign(new Error('response lost'), { code: 'network_error' });
    }
    return server.get(payload.clientRequestId);
  };
  await assert.rejects(submitPendingBatch(batch, submit));
  await submitPendingBatch(batch, submit, { confirmedUnitPrice: 8 });
  assert.equal(server.size, 1);
  assert.deepEqual(received[0], received[1]);
});

test('an idempotent recovery that already completed replaces the optimistic row with its image', async () => {
  const render = hookHarness({ createServerAiJob: async () => ({ job: {
    id: 'already-completed', status: 'completed', originalMediaUrls: ['/api/v1/files/result.png'],
  } }) });
  await render().createBatch({ count: 1, buildPayload });
  const jobs = render();
  assert.equal(jobs.tasks.length, 1);
  assert.equal(jobs.tasks[0].id, 'already-completed');
  assert.equal(jobs.tasks[0].outputs[0], '/api/v1/files/result.png');
  assert.equal(jobs.historyTasks[0].id, 'already-completed');
});

test('one failed POST cannot unlock submission until all sibling POSTs have settled', async () => {
  const pending = deferred();
  let calls = 0, settled = false;
  const render = hookHarness({ createServerAiJob: async () => {
    if (++calls === 1) throw new Error('first failed');
    return pending.promise;
  } });
  const jobs = render();
  const result = jobs.createBatch({ count: 2, buildPayload }).catch((error) => { settled = true; return error; });
  await settle();
  assert.equal(settled, false);
  assert.equal(render().submitting, true);
  const joined = render().createBatch({ count: 2, buildPayload }).catch((error) => error);
  assert.equal(calls, 2);
  pending.resolve({ job: { id: 'second-accepted', status: 'queued' } });
  await Promise.all([result, joined]);
  assert.equal(render().submitting, false);
  assert.equal(pendingBatchEntries(render().pendingBatch).length, 1);
});

test('history references prefer durable keys, preserve order, and reject missing edit inputs', () => {
  const refs = historyTaskReferences({ kind: 'wallpaper-image-edit', inputKeys: ['original/A.png', 'original/B.png'], input: { sourceUrls: ['https://expired/A'] } }, (key) => `/api/v1/files/${key}`);
  assert.deepEqual(refs.map((ref) => ref.url), ['/api/v1/files/original/A.png', '/api/v1/files/original/B.png']);
  assert.deepEqual(historyTaskReferences({ kind: 'wallpaper-image-generation', input: {} }, String), []);
  assert.throws(() => historyTaskReferences({ kind: 'wallpaper-image-edit', input: {} }, String), /参考图已失效/);
  assert.throws(() => historyTaskReferences({ kind: 'wallpaper-image-edit', input: { sourceUrls: ['blob:expired'] } }, String), /参考图已失效/);
});

test('history restoration replaces unrelated references and clears references for pure generation', () => {
  let refs = [{ url: 'unrelated-B' }];
  const context = {
    useCallback: (fn) => fn, historyTaskReferences, buildApiPath: (path) => `/api/v1${path}`, registerUploadedUrl() {},
    modelId: 'M', models: [{ id: 'M' }], ratio: '1:1', resolution: '1K', quality: 'medium', outputFormat: 'auto', moderation: '',
    jobs: { discardPendingBatch() {} }, URL, window: { requestAnimationFrame: (fn) => fn() }, promptInputRef: { current: null },
    normalizeSelectedWallpaperSkillIds: (ids) => ids, WALLPAPER_SKILL_OPTIONS: [], notificationService: { error: (message) => { throw new Error(message); } },
    setReferences: (value) => { refs = typeof value === 'function' ? value(refs) : value; },
  };
  for (const name of ['Prompt', 'ModelId', 'Ratio', 'Resolution', 'ImageSize', 'Quality', 'Count', 'OutputFormat', 'Moderation', 'Polish', 'Translate', 'Transparent', 'AutoRemove', 'SelectedSkillIds', 'MainTab']) context[`set${name}`] = () => {};
  execute(declaration(view, 'applyTaskToInputs') + '\nglobalThis.run = applyTaskToInputs;', context);
  context.run({ kind: 'wallpaper-image-edit', publicModelKey: 'M', inputKeys: ['A.png'], input: {} });
  assert.equal(refs[0].url, '/api/v1/files/A.png');
  context.run({ kind: 'wallpaper-image-generation', publicModelKey: 'M', input: {} });
  assert.equal(refs.length, 0);
});

test('logout drops late private list responses instead of filling the guest workspace', async () => {
  const pending = deferred();
  const render = hookHarness({ listServerAiJobs: async () => pending.promise });
  render();
  render({ authenticated: false });
  pending.resolve({ jobs: [{ id: 'private-A', status: 'completed', prompt: 'private-A-prompt' }] });
  await settle();
  assert.equal(render({ authenticated: false }).tasks.length, 0);
});

test('A-to-B account change reloads tasks and ignores A watcher updates', async () => {
  let account = 'A';
  const watchers = new Map();
  const render = hookHarness({
    listServerAiJobs: async () => ({ jobs: [{ id: `task-${account}`, status: 'running', prompt: `${account}-prompt` }] }),
    waitForServerAiJob: (id, options) => { watchers.set(id, options); return new Promise(() => {}); },
  });
  render(); await settle();
  account = 'B';
  render({ authenticated: true, userId: 'B' }); await settle();
  watchers.get('task-A').onUpdate({ id: 'task-A', status: 'completed', prompt: 'private-A-prompt' });
  const jobs = render({ authenticated: true, userId: 'B' });
  assert.deepEqual(Array.from(jobs.tasks, (task) => task.id), ['task-B']);
});

test('in-flight task create from A cannot update B or clear B submitting state', async () => {
  const pending = deferred();
  let oldSession;
  const render = hookHarness({ createServerAiJob: async (payload) => { oldSession = payload.isCurrentSession; return pending.promise; } });
  const promise = render().createBatch({ count: 1, buildPayload }).catch((error) => error);
  await settle();
  render({ authenticated: true, userId: 'B' });
  assert.equal(oldSession(), false);
  pending.resolve({ job: { id: 'A-created', status: 'queued', prompt: 'A-private' } });
  assert.equal((await promise).name, 'AbortError');
  assert.equal(render({ authenticated: true, userId: 'B' }).tasks.length, 0);
});

test('submission queue validates account scope immediately before sending the POST', async () => {
  const queued = deferred();
  let current = true, posts = 0;
  const context = {
    exports: {}, AbortController, DOMException, setTimeout, clearTimeout, scheduleWalletRefresh() {},
    apiPost: async () => { posts++; return { task: { id: 'should-not-exist' } }; },
    withSubmissionSlot: async (operation) => { await queued.promise; return operation(); },
  };
  execute([declaration(api, 'postTaskWithRecovery'), declaration(api, 'createTask')].join('\n'), context);
  const result = context.exports.createTask({ type: 't2i', idempotencyKey: 'stable', isCurrentSession: () => current });
  current = false;
  queued.resolve();
  await assert.rejects(result, (error) => error.name === 'AbortError');
  assert.equal(posts, 0);
});

test('accepted response from an old account never triggers cancellation under the new account', async () => {
  const pending = deferred(), controller = new AbortController();
  let current = true, cancellations = 0;
  const context = {
    exports: {}, DOMException, mapJobKindToTaskType: () => 't2i', createTask: async () => pending.promise,
    resolveInputKeyForUrl: async () => '', cancelTask: async () => { cancellations++; },
    invalidateStudioCreditSnapshot() {}, taskToLegacyJob: (task) => task,
  };
  execute(declaration(adapter, 'createServerAiJob'), context);
  const result = context.exports.createServerAiJob({ kind: 'wallpaper-image-generation', signal: controller.signal, isCurrentSession: () => current });
  await settle();
  current = false; controller.abort(); pending.resolve({ id: 'old-account-task' });
  await assert.rejects(result, (error) => error.name === 'AbortError');
  assert.equal(cancellations, 0);
});

test('ordinary abort never automatically acknowledges forfeiting upstream generation fees', async () => {
  const pending = deferred(), controller = new AbortController();
  const acknowledgements = [];
  const context = {
    exports: {}, DOMException, mapJobKindToTaskType: () => 't2i', createTask: async () => pending.promise,
    resolveInputKeyForUrl: async () => '', cancelTask: async (_id, options) => { acknowledgements.push(options.acknowledgeUpstream); },
    invalidateStudioCreditSnapshot() {}, taskToLegacyJob: (task) => task,
  };
  execute(declaration(adapter, 'createServerAiJob'), context);
  const result = context.exports.createServerAiJob({ kind: 'wallpaper-image-generation', signal: controller.signal });
  await settle(); controller.abort(); pending.resolve({ id: 'accepted-task' });
  await assert.rejects(result, (error) => error.name === 'AbortError');
  assert.deepEqual(acknowledgements, [false]);
});

test('reference recovery cannot upload the previous account image after an account change', async () => {
  const download = deferred();
  let current = true, uploads = 0;
  const context = {
    DOMException, lookupKeyForUrl: () => '', fetch: async () => download.promise,
    uploadFile: async () => { uploads++; return { key: 'must-not-upload' }; },
    registerUrlKey() {}, createInputImageLostError: () => new Error('input lost'),
  };
  execute(declaration(adapter, 'resolveInputKeyForUrl') + '\nglobalThis.run = resolveInputKeyForUrl;', context);
  const result = context.run('https://old-reference', { isCurrentSession: () => current });
  current = false;
  download.resolve({ ok: true, blob: async () => ({ type: 'image/png' }) });
  await assert.rejects(result, (error) => error.name === 'AbortError');
  assert.equal(uploads, 0);
});
