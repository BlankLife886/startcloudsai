import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { canvasAgentTaskSalt } from '../src/canvas/lib/canvas/canvas-agent-task-identity.ts';

const read = (path) => ts.createSourceFile(path, fs.readFileSync(new URL(path, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const hook = read('../src/features/text-to-image/useTextToImageJobs.js');
const adapter = read('../src/legacy-modules/services/aiWallpaper.js');
const bridge = read('../src/canvas/pages/canvas/hooks/use-agent-bridge.ts');
function declaration(source, name) {
  let found;
  const visit = (node) => {
    if ((ts.isFunctionDeclaration(node) && node.name?.text === name) || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === name))) found = node.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, `missing ${name}`);
  return found;
}
function execute(source, context) {
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context);
}

test('task watcher preserves server cancellation and opts into continued observation', async () => {
  const updates = [];
  let waitingOptions;
  const context = {
    exports: {}, console, useCallback: (fn) => fn, AbortController,
    captureScope: () => ({}), isCurrentScope: () => true,
    controllersRef: { current: new Map() },
    upsertTask: (task) => updates.push(task),
    taskFromJob: (job, patch) => ({ ...job, ...patch }),
    taskToLegacyJob: (task) => ({ ...task, status: task.status === 'canceled' ? 'cancelled' : task.status }),
    legacyResultFromTask: () => ({ outputs: [] }), formatServerAiJobStatus: (status) => status,
    waitForTask: async (_id, options) => {
      waitingOptions = options;
      options.onUpdate({ id: 'task-1', status: 'running' });
      const canceled = { id: 'task-1', status: 'canceled', errorMessage: '用户主动停止', finishedAt: '2026-09-07T00:01:40Z' };
      options.onUpdate(canceled);
      return canceled;
    },
  };
  execute(declaration(adapter, 'waitForServerAiJob') + '\n' + declaration(hook, 'watchJob') + '\nwatchJob({id:"task-1",status:"queued"});', context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(waitingOptions.maxWaitMs, null);
  assert.equal(updates.at(-1).status, 'cancelled');
  assert.equal(updates.some((task) => task.status === 'failed'), false);
  assert.equal(updates.at(-1).finishedAt, '2026-09-07T00:01:40Z');
});

test('monitor errors never manufacture failed task snapshots', async () => {
  const updates = [];
  const context = { console: { warn() {} }, useCallback: (fn) => fn, AbortController, captureScope: () => ({}), isCurrentScope: () => true, controllersRef: { current: new Map() }, upsertTask: (task) => updates.push(task), waitForServerAiJob: async () => { throw new Error('local wait interrupted'); } };
  execute(declaration(hook, 'watchJob') + '\nwatchJob({id:"task-1",status:"running"});', context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updates.length, 0);
});

test('ordinary Agent generation reuses the tool identity across replay and hook reconstruction', async () => {
  const submitted = [];
  const build = () => ({ useCallback: (fn) => fn, canvasAgentTaskSalt, nanoid: () => 'new-random', nodesRef: { current: [{ id: 'config', type: 'config', metadata: {} }] }, isCanvasExecutableNode: (node) => node.type === 'config', generateNodeRef: { current: async (...args) => { submitted.push(args); return true; } }, generationRuns: new Map(), trimRunRegistry() {} });
  const source = declaration(bridge, 'startGeneration') + '\nstartGeneration({requestId:"server-tool-1",nodeIds:["config"]});startGeneration({requestId:"server-tool-1",nodeIds:["config"]});';
  execute(source, build());
  execute(source, build());
  assert.equal(submitted.length, 2, 'same hook replays must not submit twice');
  assert.equal(submitted[0][3].taskKeySalt, submitted[1][3].taskKeySalt, 'fresh hooks must derive the same server idempotency salt');
  assert.equal(submitted[0][3].taskKeySalt, canvasAgentTaskSalt('generation-server-tool-1'));
});

test('canvas text retry keeps its conversation and idempotency key after a lost response', async () => {
  const storage = new Map();
  const bodies = [];
  let conversations = 0;
  const context = {
    exports: {}, crypto, localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    flattenMessages: () => 'prompt', collectMessageReferenceImages: () => [], modelOptionName: (model) => model,
    scheduleWalletRefresh() {}, waitForCanvasAssistantRun: async () => 'answer',
    starcloudsJson: async (path, _method, body) => {
      if (path === '/assistant/conversations') return { id: `conversation-${++conversations}` };
      bodies.push(body);
      if (bodies.length === 1) throw new Error('lost response after commit');
      return { run: { id: 'existing-run' } };
    },
  };
  const source = read('../src/canvas/services/canvas-task-api.ts');
  execute(declaration(source, 'requestCanvasAssistant'), context);
  await assert.rejects(context.exports.requestCanvasAssistant([], () => {}, { idempotencyKey: 'canvas-stable-text' }), /lost response/);
  await context.exports.requestCanvasAssistant([], () => {}, { idempotencyKey: 'canvas-stable-text' });
  assert.equal(conversations, 1);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.equal(bodies[0].idempotencyKey, 'canvas-stable-text');
});
