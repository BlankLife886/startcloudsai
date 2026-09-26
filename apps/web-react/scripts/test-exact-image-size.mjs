import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EXACT_IMAGE_SIZE_DEFAULT_LIMITS,
  exactImageSizeParams,
  initialExactImageSize,
  normalizeExactSizeCapabilities,
  validateExactImageSize,
} from '../src/config/exactImageSize.js';
import { normalizeImageModelCapabilities } from '../src/legacy-modules/features/ai-shared/modelImageCapabilities.js';
import { createAssistantPlaceholder } from '../src/features/assistant/domain/assistantMessages.js';

const supported = (limits = {}) => ({ supportsExactSize: true, exactSizeLimits: limits });

test('exact dimensions require an explicitly enabled model', () => {
  for (const model of [undefined, null, {}, { supportsExactSize: 'true' }]) {
    assert.equal(normalizeExactSizeCapabilities(model).supportsExactSize, false);
    assert.equal(validateExactImageSize(model, 1024, 1024).valid, false);
    assert.throws(() => exactImageSizeParams(model, 1024, 1024), /不支持精确尺寸/);
  }
  assert.deepEqual(normalizeExactSizeCapabilities(supported()).exactSizeLimits, EXACT_IMAGE_SIZE_DEFAULT_LIMITS);
});

test('valid exact sizes keep the original integer pixels without rounding or rescaling', () => {
  const result = validateExactImageSize(supported(), '1237', '891');
  assert.equal(result.valid, true);
  assert.equal(result.size, '1237x891');
  assert.deepEqual(result.params, { sizeMode: 'exact', exactWidth: 1237, exactHeight: 891 });
  assert.deepEqual(exactImageSizeParams(supported(), 4096, 4096), { sizeMode: 'exact', exactWidth: 4096, exactHeight: 4096 });
});

test('invalid dimensions are rejected without coercing an input to a supported size', () => {
  for (const value of ['', '1.5', '1e3', NaN, Infinity, -1, 0, true]) {
    const result = validateExactImageSize(supported(), value, 1024);
    assert.equal(result.valid, false, String(value));
    assert.match(result.error, /整数像素/);
  }
  assert.match(validateExactImageSize(supported(), 255, 1024).error, /宽度/);
  assert.match(validateExactImageSize(supported(), 1024, 4097).error, /高度/);
  const stepped = validateExactImageSize(supported({ step: 64 }), 1033, 1024);
  assert.equal(stepped.width, 1033);
  assert.match(stepped.error, /64 px 的整数倍/);
});

test('pixel area and long-to-short-edge ratio restrictions apply together', () => {
  const model = supported({ minPixels: 1024 * 1024, maxPixels: 2048 * 2048, maxAspectRatio: 2 });
  assert.match(validateExactImageSize(model, 512, 512).error, /总像素不得少于/);
  assert.match(validateExactImageSize(model, 3072, 3072).error, /总像素不得超过/);
  assert.match(validateExactImageSize(model, 512, 3072).error, /长边与短边/);
  assert.equal(validateExactImageSize(model, 1024, 2048).valid, true);
  assert.equal(validateExactImageSize(model, 2048, 1024).valid, true);
});

test('initial dimensions satisfy configured step, area and aspect constraints', () => {
  for (const model of [supported(), supported({ minWidth: 700, maxWidth: 900, minHeight: 700, maxHeight: 900, step: 64 }), supported({ minPixels: 2097152, maxPixels: 4194304, maxAspectRatio: 1.5, step: 32 })]) {
    const size = initialExactImageSize(model);
    assert.equal(validateExactImageSize(model, size.width, size.height).valid, true);
  }
  assert.deepEqual(initialExactImageSize(supported()), { width: 1024, height: 1024 });
  assert.deepEqual(initialExactImageSize(supported({ minWidth: 256, maxWidth: 256, minHeight: 256, maxHeight: 256, minPixels: 1000000 })), { width: '', height: '' });
});

test('shared model capabilities preserve explicit exact support and configured limits', () => {
  assert.equal(normalizeImageModelCapabilities({}).supportsExactSize, false);
  const capabilities = normalizeImageModelCapabilities(supported({ step: 64, maxPixels: 4194304 }));
  assert.equal(capabilities.supportsExactSize, true);
  assert.equal(capabilities.exactSizeLimits.step, 64);
  assert.equal(capabilities.exactSizeLimits.maxPixels, 4194304);
});

test('assistant placeholders preserve exact retries and never carry exact settings into chat', () => {
  const defaults = { model: 'exact-image', sizeMode: 'exact', exactWidth: 1237, exactHeight: 891, width: 1237, height: 891, requestSize: '1237x891' };
  const previous = createAssistantPlaceholder({ prompt: '生成一张图片', responseMode: 'image', defaults });
  assert.equal(previous.sizeMode, 'exact');
  assert.equal(previous.exactWidth, 1237);
  const retry = createAssistantPlaceholder({ prompt: '生成一张图片', responseMode: 'image', previous, defaults: { model: 'exact-image' } });
  assert.equal(retry.exactHeight, 891);
  for (const responseMode of ['chat', 'agent']) {
    const message = createAssistantPlaceholder({ prompt: '你好', responseMode, previous, defaults });
    assert.equal(Object.hasOwn(message, 'sizeMode'), false);
    assert.equal(Object.hasOwn(message, 'exactWidth'), false);
  }
});
