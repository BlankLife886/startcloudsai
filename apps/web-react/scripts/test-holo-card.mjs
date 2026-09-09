import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { buildSubjectRequest, describeHoloGenerationError, image2Models, inspectAlphaPixels, inspectLineartPixels, isHoloSubjectTask, modelBlockReason, privateFileUrl, requestSubjectQuote, selectSubjectResolution, subjectResolutionOptions, SUBJECT_QUOTE_TIMEOUT_MS } from '../src/features/holo-card/holoCard.js';
import { containDimensions, cardCameraDistance, cardLocalParallax } from '../src/features/holo-card/holo-card-renderer.js';
import { quoteTaskPrice } from '../src/legacy-modules/services/tasksApi.js';

const model = { id: 'gpt-image-2', status: 'available', transparentBackground: true, qualities: ['high'], outputFormats: ['png'], maxReferenceImages: 1, resolutions: ['1K', '2K', '4K'], aspectRatios: ['1:1', '2:3', '3:2'] };
const jobSource = ts.createSourceFile('useHoloCardJob.js', readFileSync(new URL('../src/features/holo-card/useHoloCardJob.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
function jobFunction(name, context) {
  let declaration;
  const visit = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) declaration = node.getText(jobSource);
    ts.forEachChild(node, visit);
  };
  visit(jobSource);
  assert.ok(declaration, `missing workflow function ${name}`);
  return vm.runInNewContext(`(${declaration})`, context);
}
test('only assigned image2 models are used, with no fallback to background removal', () => {
  const config = { features: { 'ai.wallpaperGeneration': { config: { publicModels: [model, { id: 'image-20' }, { id: 'remove-bg' }, { id: 'Image2-high' }] } } } };
  assert.deepEqual(image2Models(config).map(item => item.id), ['gpt-image-2', 'Image2-high']);
  config.features['ai.wallpaperGeneration'].enabled = false;
  assert.deepEqual(image2Models(config), []);
  assert.match(modelBlockReason({ ...model, transparentBackground: false }), /透明/);
  assert.match(modelBlockReason({ ...model, qualities: ['medium'] }), /质量/);
});

test('subject requests use native alpha PNG, high fidelity and an explicit quality gate', () => {
  const request = buildSubjectRequest(model, '2K', { width: 1200, height: 1800 }, '保留细发丝');
  assert.equal(request.type, 't2i'); assert.equal(request.count, 1);
  assert.equal(request.params.publicModelKey, model.id);
  assert.equal(request.params.strictAlphaOutput, true);
  assert.equal(request.params.transparentBackground, true);
  assert.equal(request.params.inputFidelity, 'high');
  assert.equal(request.params.quality, 'high');
  assert.equal(request.params.autoBackgroundRemovalEnabled, false);
  assert.equal(request.params.outputFormat, 'png');
  assert.equal(request.params.aspectRatio, '2:3');
  assert.ok(Math.min(...request.params.size.split('x').map(Number)) >= 1024);
  assert.match(request.prompt, /保留细发丝/);
  assert.throws(() => buildSubjectRequest(model, '1K', { width: 1200, height: 1800 }), /1024/);
  assert.throws(() => buildSubjectRequest(model, '8K', {}), /分辨率/);
  assert.throws(() => buildSubjectRequest({ ...model, transparentBackground: false }, '2K', {}), /透明/);
});

test('published capability casing and resolution rules are normalized without inventing transparent support', () => {
  const published = {
    ...model, status: ' AVAILABLE ', resolutions: ['1k', '2k', '4k'], qualities: ['HIGH'], outputFormats: ['PNG'],
    aspectRatiosByResolution: { '1k': [], '2k': ['3:2'] },
  };
  const original = JSON.stringify(published);
  assert.equal(modelBlockReason(published), '');
  const request = buildSubjectRequest(published, '2k', { width: 1200, height: 1800 });
  assert.equal(request.params.resolutionScale, '2K');
  assert.equal(request.params.aspectRatio, '3:2', 'the selected tier restriction wins over the global ratios');
  assert.equal(request.params.quality, 'high');
  assert.equal(request.params.outputFormat, 'png');
  assert.equal(buildSubjectRequest({ ...model, aspectRatiosByResolution: { '2K': [] } }, '2K', { width: 1200, height: 1800 }).params.aspectRatio, '2:3');
  assert.equal(JSON.stringify(published), original, 'normalization must not mutate runtime configuration');
  for (const key of ['transparentBackground', 'qualities', 'maxReferenceImages', 'resolutions']) {
    assert.notEqual(modelBlockReason({ ...model, [key]: undefined }), '', `missing ${key} stays blocked`);
  }
});

test('the default image2 built-in format still requests a strict alpha subject without an unsupported format parameter', () => {
  const source = { width: 1200, height: 1800 };
  for (const outputFormats of [[], undefined]) {
    const builtin = { ...model, id: 'gpt-image-2-default', default: true, resolutions: ['1K'], outputFormats };
    assert.equal(modelBlockReason(builtin), '');
    const selected = image2Models({ features: { 'ai.wallpaperGeneration': { config: { publicModels: [builtin] } } } });
    assert.equal(selected.length, 1);
    assert.equal(modelBlockReason(selected[0]), '');
    const request = buildSubjectRequest(selected[0], '1K', source, '保留全部发丝');
    assert.equal(Object.hasOwn(request.params, 'outputFormat'), false, 'built-in format omits the wire key entirely');
    assert.equal(request.params.publicModelKey, builtin.id);
    assert.equal(request.params.resolutionScale, '1K', 'the submitted and quoted tier remains the actual supported tier');
    assert.equal(request.params.aspectRatio, '1:1');
    assert.equal(request.params.size, '1024x1024');
    assert.equal(request.params.outputSize, '1024x1024');
    assert.equal(request.params.quality, 'high');
    assert.equal(request.params.inputFidelity, 'high');
    assert.equal(request.params.transparentBackground, true);
    assert.equal(request.params.transparentPngEnabled, true);
    assert.equal(request.params.strictAlphaOutput, true);
    assert.equal(request.params.autoBackgroundRemovalEnabled, false);
    assert.match(request.prompt, /Remove the background/);
    assert.match(request.prompt, /transparent padding/);
    assert.match(request.prompt, /do not crop any part/);
    assert.match(request.prompt, /保留全部发丝/);
    const options = subjectResolutionOptions(selected[0], source);
    assert.equal(options.length, 1);
    assert.equal(selectSubjectResolution(options, '2K'), '1K');
    assert.equal(options[0].canvasAdjusted, true);
    assert.match(options[0].canvasNote, /1024.*1024.*透明留白/);
    assert.equal(options[0].size, request.params.size);
  }
  for (const outputFormats of [['jpeg'], ['webp'], ['tiff'], ['']]) {
    assert.match(modelBlockReason({ ...model, outputFormats }), /PNG/);
    assert.throws(() => buildSubjectRequest({ ...model, outputFormats }, '2K', source), /PNG/);
  }
  assert.equal(buildSubjectRequest({ ...model, outputFormats: ['PNG'] }, '2K', source).params.outputFormat, 'png');
});

test('output planning repairs a stale 1K selection and chooses enough pixels for the actual aspect', () => {
  const portrait = { width: 1200, height: 1800 };
  const options = subjectResolutionOptions(model, portrait);
  assert.equal(options.find(option => option.resolution === '1K').available, false);
  assert.match(options.find(option => option.resolution === '1K').reason, /1024/);
  assert.equal(selectSubjectResolution(options, '1K'), '2K');
  assert.equal(selectSubjectResolution(options, '4K'), '4K', 'an explicit valid high resolution is retained');
  for (const option of options.filter(option => option.available)) {
    const request = buildSubjectRequest(model, option.resolution, portrait);
    assert.equal(option.size, request.params.size);
    assert.equal(option.aspectRatio, request.params.aspectRatio);
    assert.ok(Math.min(option.width, option.height) >= 1024);
  }
  const panoramic = subjectResolutionOptions({ ...model, aspectRatios: ['1:1', '9:21'] }, { width: 900, height: 2100 });
  assert.equal(panoramic.find(option => option.resolution === '2K').available, false);
  assert.equal(selectSubjectResolution(panoramic, '2K'), '4K');
  assert.equal(panoramic.find(option => option.resolution === '4K').size, '1648x3840');
  const square = subjectResolutionOptions(model, { width: 1024, height: 1024 });
  assert.equal(selectSubjectResolution(square, '1k'), '1K', '1K remains available when it really meets the edge requirement');
  assert.equal(selectSubjectResolution(subjectResolutionOptions({ ...model, resolutions: ['1K'] }, portrait)), '1K');
  assert.equal(selectSubjectResolution(subjectResolutionOptions({ ...model, resolutions: ['1K'], aspectRatios: ['2:3'] }, portrait)), '', 'square padding requires that square output is actually supported');
  assert.equal(selectSubjectResolution(subjectResolutionOptions({ ...model, transparentBackground: false }, portrait)), '');
  assert.ok(options.filter(option => option.available).every(option => !option.canvasAdjusted), 'multi-tier models retain their aspect instead of masking a usable higher tier');
  assert.equal(panoramic.find(option => option.resolution === '4K').canvasAdjusted, false);
});

test('upstream alpha refusal is actionable in Chinese while the exact error remains available for diagnosis', () => {
  const originalMessage = 'Upstream request failed: {"message":"Transparent background is not supported for this model."}';
  const failure = Object.assign(new Error(originalMessage), { code: 'provider_error', taskId: 'task-17', modelId: 'gpt-image-2' });
  const description = describeHoloGenerationError(failure);
  assert.match(description.message, /这条线路拒绝了本次透明背景参数/);
  assert.match(description.message, /原图闪卡/);
  assert.match(description.message, /导入.*透明 PNG/);
  assert.equal(description.errorDetail.code, 'transparent_output_unsupported');
  assert.equal(description.errorDetail.originalCode, 'provider_error');
  assert.equal(description.errorDetail.originalMessage, originalMessage);
  assert.equal(description.errorDetail.taskId, 'task-17');
  assert.equal(description.errorDetail.modelId, 'gpt-image-2');
  assert.equal(describeHoloGenerationError(new Error('钱包余额不足')).message, '钱包余额不足');
  assert.match(describeHoloGenerationError(null).message, /主体生成失败/);
});

test('the price adapter forwards AbortSignal and keeps the existing no-options request contract', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, ...options, parsed: JSON.parse(options.body) });
    return new Response(JSON.stringify({ success: true, data: { unitPriceCents: 9, totalPriceCents: 9 } }), { status: 200 });
  });
  const request = buildSubjectRequest(model, '2K', { width: 1200, height: 1800 });
  const controller = new AbortController();
  assert.equal((await quoteTaskPrice(request, { signal: controller.signal })).unitPriceCents, 9);
  await quoteTaskPrice(request);
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(calls[1].signal, undefined);
  assert.deepEqual(calls[0].parsed, calls[1].parsed);
  assert.deepEqual(calls[0].parsed.inputKeys, [], 'quoting does not upload or reference a user file');
  assert.ok(calls.every(call => call.url === '/api/v1/tasks/quote'), 'only the non-generating quote endpoint is called');
  assert.equal(calls[0].parsed.params.strictAlphaOutput, true);
});

test('a stalled quote aborts at 20 seconds without retrying or aborting the caller lifecycle', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  let calls = 0, quotedSignal;
  const pending = requestSubjectQuote({}, (_request, { signal }) => {
    calls++;
    quotedSignal = signal;
    return new Promise(() => {}); // Even a transport that ignores cancellation must release the workflow.
  }, { signal: caller.signal });
  const rejected = assert.rejects(pending, error => error.code === 'quote_timeout' && /读取报价超时/.test(error.message));
  await Promise.resolve();
  t.mock.timers.tick(SUBJECT_QUOTE_TIMEOUT_MS - 1);
  assert.equal(quotedSignal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
  assert.equal(quotedSignal.aborted, true);
  assert.equal(caller.signal.aborted, false, 'the hook can report the timeout and clear phase/lock in finally');
  assert.equal(calls, 1, 'timeouts do not issue a second quote or generation');
  const retried = await requestSubjectQuote({}, async () => { calls++; return { unitPriceCents: 9, totalPriceCents: 9 }; }, { signal: caller.signal });
  assert.equal(retried.totalPriceCents, 9, 'a later explicit attempt works with the same still-live caller');
  assert.equal(calls, 2);
});

test('canceling a quote stops its transport; successful quotes remove timers and cancellation listeners', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const caller = new AbortController();
  let activeSignal;
  const pending = requestSubjectQuote({}, (_request, { signal }) => { activeSignal = signal; return new Promise(() => {}); }, { signal: caller.signal });
  const canceled = assert.rejects(pending, error => error.name === 'AbortError');
  await Promise.resolve();
  caller.abort();
  await canceled;
  assert.equal(activeSignal.aborted, true);
  let submitted = false;
  await assert.rejects(requestSubjectQuote({}, async () => { submitted = true; }, { signal: caller.signal }), error => error.name === 'AbortError');
  assert.equal(submitted, false);
  const completeCaller = new AbortController();
  let completeSignal;
  await requestSubjectQuote({}, async (_request, { signal }) => { completeSignal = signal; return { unitPriceCents: 2, totalPriceCents: 2 }; }, { signal: completeCaller.signal });
  completeCaller.abort();
  t.mock.timers.tick(SUBJECT_QUOTE_TIMEOUT_MS + 1);
  assert.equal(completeSignal.aborted, false, 'completion detached the caller listener and cleared its deadline');
});

test('the actual prepare workflow releases its phase and submission lock after a quote timeout', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const phases = [], errors = [], confirmations = [];
  let quotes = 0;
  const context = {
    userId: 'user-1', busy: false, confirmation: null, lock: { current: false }, mounted: { current: true },
    controllerRef: { current: null }, draftRef: { current: null }, crypto, AbortController,
    setPhase: value => phases.push(value), setError: value => { if (value) errors.push(describeHoloGenerationError(value)); },
    setConfirmation: value => confirmations.push(value), buildSubjectRequest, requestSubjectQuote,
    quoteTaskPrice: () => { quotes++; return new Promise(() => {}); },
  };
  const prepare = jobFunction('prepare', context);
  const pending = prepare({ source: { blob: new Blob(['reference'], { type: 'image/png' }), name: 'reference.png', dimensions: { width: 1200, height: 1800 } }, model, resolution: '2K' });
  await Promise.resolve();
  assert.equal(context.lock.current, true);
  assert.equal(phases.at(-1), '读取报价');
  t.mock.timers.tick(SUBJECT_QUOTE_TIMEOUT_MS);
  await pending;
  assert.equal(context.lock.current, false);
  assert.equal(context.controllerRef.current, null);
  assert.equal(phases.at(-1), '');
  assert.equal(errors.at(-1).errorDetail.code, 'quote_timeout');
  assert.equal(confirmations.length, 0);
  assert.equal(quotes, 1);
});

function recoveryFixture(record, sourceResult) {
  const controller = new AbortController(), errors = [], recovered = [], candidates = [], phases = [];
  const context = {
    taskId: record.id, signal: controller.signal, terminal: new Set(['succeeded', 'failed', 'canceled']),
    getTask: async () => record, setTask() {}, isHoloSubjectTask, recoverTaskSource: () => sourceResult,
    setPhase: value => phases.push(value), setError: value => errors.push(describeHoloGenerationError(value)),
    setConfirmation() {}, setRecoveredSource: value => recovered.push(value), setSourceWarning() {},
    privateFileUrl, taskOriginalUrl: value => value.originalUrls?.[0] || '',
    fetchAuthenticatedMediaBlob: async () => new Blob(['result'], { type: 'image/png' }),
    readCardImage: async (_blob, options) => { assert.equal(options.strictAlpha, true); return { width: 1360, height: 2048 }; },
    callbacks: { current: { onCandidate: candidate => candidates.push(candidate) } },
  };
  return { controller, errors, recovered, candidates, phases, recover: jobFunction('recover', context) };
}

test('a failed task reports the alpha refusal before restoring its original image', async () => {
  let resolveSource;
  const sourceResult = new Promise(resolve => { resolveSource = resolve; });
  const record = { id: 'failed-alpha', type: 't2i', status: 'failed', errorMessage: 'Transparent background is not supported for this model.', errorCode: 'provider_error', params: { _kind: 'holo-card-subject', _source: 'holo_card', publicModelKey: model.id } };
  const fixture = recoveryFixture(record, sourceResult);
  const pending = fixture.recover();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(fixture.errors.at(-1).errorDetail.code, 'transparent_output_unsupported');
  assert.equal(fixture.phases.at(-1), '正在恢复原图');
  assert.equal(fixture.recovered.length, 0);
  const source = { blob: new Blob(['reference']), dimensions: { width: 1200, height: 1800 }, name: '原图.png' };
  resolveSource({ source, warning: '' });
  await pending;
  assert.equal(fixture.recovered[0], source);
  assert.equal(fixture.candidates.length, 0, 'a recovered reference is never presented as a transparent subject');
  assert.equal(fixture.errors.at(-1).errorDetail.originalMessage, record.errorMessage);
});

test('late failed-source recovery cannot cross task changes, and successful subjects keep their review contract', async () => {
  let resolveSource;
  const sourceResult = new Promise(resolve => { resolveSource = resolve; });
  const record = { id: 'old-task', type: 't2i', status: 'failed', errorMessage: 'generation failed', params: { _kind: 'holo-card-subject', _source: 'holo_card' } };
  const late = recoveryFixture(record, sourceResult);
  const pending = late.recover();
  await new Promise(resolve => setImmediate(resolve));
  late.controller.abort();
  const source = { blob: new Blob(['reference']), dimensions: { width: 1200, height: 1800 } };
  resolveSource({ source, warning: '' });
  await pending;
  assert.equal(late.recovered.length, 0);
  const successful = recoveryFixture({ ...record, id: 'success-task', status: 'succeeded', originalUrls: ['/api/v1/files/subject.png'] }, Promise.resolve({ source, warning: '' }));
  await successful.recover();
  assert.equal(successful.recovered.length, 0, 'a successful task does not prematurely replace the current original');
  assert.equal(successful.candidates.length, 1);
  assert.equal(successful.candidates[0].source, source);
});

function pixels(alpha = 255) {
  const data = new Uint8ClampedArray(40 * 40 * 4);
  for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) data[(y * 40 + x) * 4 + 3] = alpha;
  return data;
}
test('real alpha is required; opaque checkerboards, empty and near-clear results are rejected', () => {
  const data = pixels();
  const before = data.slice();
  const result = inspectAlphaPixels(data, 40, 40, 40);
  assert.ok(result.transparentRatio > .5);
  assert.deepEqual(data, before);
  assert.ok(inspectAlphaPixels(pixels(120), 40, 40, 40).partialRatio > .3);
  assert.throws(() => inspectAlphaPixels(new Uint8ClampedArray(6400).fill(255), 40, 40, 40), /透明区域/);
  assert.throws(() => inspectAlphaPixels(new Uint8ClampedArray(6400), 40, 40, 40), /有效主体/);
  assert.throws(() => inspectAlphaPixels(pixels(9), 40, 40, 40), /有效主体/);
  const opaque = new Uint8ClampedArray(6400).fill(255); opaque[3] = 0;
  assert.throws(() => inspectAlphaPixels(opaque, 40, 40, 40), /透明区域/);
  assert.throws(() => inspectAlphaPixels(data, 40, 40), /1024/);
  const tiny = new Uint8ClampedArray(1024 * 1024 * 4);
  for (let i = 0; i < 2100; i++) tiny[(2048 + i) * 4 + 3] = 245;
  assert.ok(inspectAlphaPixels(tiny, 1024, 1024).transparentRatio > .99);
});

test('history and media URL guards isolate the workspace', () => {
  assert.equal(isHoloSubjectTask({ type: 't2i', params: { _kind: 'holo-card-subject', _source: 'holo_card' } }), true);
  assert.equal(isHoloSubjectTask({ type: 'background_remove' }), false);
  assert.equal(privateFileUrl('/api/v1/files/a.png'), '/api/v1/files/a.png');
  for (const value of ['javascript:alert(1)', '//example.com/api/v1/files/x', 'https://holo.invalid/api/v1/files/x', '/api/v1/files/../../auth', 'http://[', '/api/v1/files/a\nb']) assert.equal(privateFileUrl(value), '');
});

test('lineart must share the subject canvas and contain sparse monochrome strokes', () => {
  const data = new Uint8ClampedArray(40 * 40 * 4).fill(255);
  for (let y = 5; y < 35; y++) {
    const i = (y * 40 + 20) * 4;
    data[i] = 0; data[i + 1] = 0; data[i + 2] = 0;
  }
  const subject = { width: 40, height: 40 };
  assert.ok(inspectLineartPixels(data, 40, 40, subject).inkRatio > .001);
  assert.throws(() => inspectLineartPixels(data, 40, 40, { width: 41, height: 40 }), /完全一致/);
  assert.throws(() => inspectLineartPixels(new Uint8ClampedArray(6400).fill(255), 40, 40, subject), /稀疏黑色/);
  const transparent = data.slice();
  for (let i = 0; i < transparent.length; i += 4) if (transparent[i] === 255) transparent[i + 3] = 0;
  assert.equal(inspectLineartPixels(transparent, 40, 40, subject).inkRatio, 30 / 1600);
});

test('card textures contain the whole image and camera framing handles narrow viewports', () => {
  const size = containDimensions(4096, 1024);
  assert.equal(size.width / size.height, 4);
  assert.ok(size.width <= 1.82 && size.height <= 2.32);
  assert.ok(cardCameraDistance(.3) > cardCameraDistance(1));
  assert.ok(Number.isFinite(cardCameraDistance(0)));
});

test('card-local parallax has opposite signed depths and stays bounded through flips', () => {
  const view = { x: .3, y: -.2, z: .9 };
  const front = cardLocalParallax(view, .28);
  const back = cardLocalParallax(view, -.2);
  assert.ok(front.x > 0 && front.y < 0);
  assert.ok(back.x < 0 && back.y > 0);
  const flat = cardLocalParallax(view, 0);
  assert.equal(Math.abs(flat.x) + Math.abs(flat.y), 0);
  for (let angle = -180; angle <= 180; angle++) {
    const radians = angle * Math.PI / 180;
    const offset = cardLocalParallax({ x: Math.sin(radians), y: .1, z: Math.cos(radians) }, .56);
    assert.ok(Number.isFinite(offset.x) && Math.abs(offset.x) <= .035);
    assert.ok(Number.isFinite(offset.y) && Math.abs(offset.y) <= .035);
  }
});
