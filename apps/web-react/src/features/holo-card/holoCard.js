import { normalizeGptImageOutputSize } from '../../legacy-modules/services/aiImageOutputSize.js';
import { normalizeImageModelCapabilities } from '../../legacy-modules/features/ai-shared/modelImageCapabilities.js';

export const HOLO_SOURCE = 'holo_card';
export const HOLO_KIND = 'holo-card-subject';
export const MAX_IMAGE_PIXELS = 32_000_000;
export const MIN_SUBJECT_EDGE = 1024;
export const SUBJECT_QUOTE_TIMEOUT_MS = 20_000;
const SUBJECT_RESOLUTIONS = ['1K', '2K', '4K'];
export const DEFAULT_CARD_SETTINGS = Object.freeze({
  title: '光的切片', subtitle: 'STARClouds / 001', foil: 'spectrum',
  foilStrength: 0.42, depth: 0.5, tilt: 0.55, background: '#e8ebed', paused: false,
  subjectScale: 1, backgroundDepth: -0.2, lineStrength: 0.15, flipped: false,
  pattern: 'flow', autoOrbit: false, exploded: false, orbitStyle: 'orbit', shineStyle: 'sweep',
});

function normalizeSubjectModel(model) {
  if (!model || typeof model !== 'object') return null;
  // Reuse the standard image workspace's enum and per-resolution rules while
  // keeping the explicit capability gates required for a transparent asset.
  const capabilities = normalizeImageModelCapabilities({
    ...model,
    aspectRatios: Array.isArray(model.aspectRatios) ? model.aspectRatios : [],
    resolutions: Array.isArray(model.resolutions) ? model.resolutions : [],
    qualities: Array.isArray(model.qualities) ? model.qualities : [],
    outputFormats: Array.isArray(model.outputFormats) ? model.outputFormats : [],
    transparentBackground: model.transparentBackground === true,
    maxReferenceImages: Number(model.maxReferenceImages) || 0,
  });
  return {
    ...model, ...capabilities,
    // An empty list selects the model's built-in format. Preserve an explicit
    // non-PNG list so an unsupported declared format cannot become that default.
    outputFormats: Array.isArray(model.outputFormats)
      ? model.outputFormats.map(value => String(value ?? '').trim().toLowerCase().replace(/^jpg$/, 'jpeg')) : [],
    id: String(model.id || model.publicModelKey || model.model || '').trim(),
    status: String(model.status || '').trim().toLowerCase(),
  };
}

export function image2Models(config) {
  const feature = config?.features?.['ai.wallpaperGeneration'];
  if (feature?.enabled === false) return [];
  const models = feature?.config?.publicModels;
  return (Array.isArray(models) ? models : []).map(normalizeSubjectModel).filter(Boolean).filter(model =>
    /(?:^|[^a-z])(?:gpt[\s_-]*)?image[\s_-]*2(?:$|[^0-9])/i.test(
      [model.id, model.name, model.label].join(' '),
    ),
  );
}

export function modelBlockReason(model) {
  model = normalizeSubjectModel(model);
  if (!model) return '当前工作区未配置 image2 模型';
  if (!model.id) return '该线路未提供有效模型标识';
  if (model.maintenance || (model.status && model.status !== 'available')) return '模型暂不可用';
  if (model.transparentBackground !== true) return '该线路未开放原生透明输出';
  if (model.outputFormats.length && !model.outputFormats.includes('png')) return '该线路未开放 PNG 输出';
  if (!model.qualities?.includes('high')) return '该线路未开放高质量输出';
  if (!(Number(model.maxReferenceImages) >= 1)) return '该线路未开放参考图编辑';
  if (!model.resolutions?.some(value => SUBJECT_RESOLUTIONS.includes(value))) return '该线路未提供有效分辨率';
  return '';
}

function subjectOutputPlan(model, resolution, dimensions) {
  model = normalizeSubjectModel(model);
  const reason = modelBlockReason(model);
  if (reason) throw new Error(reason);
  resolution = String(resolution || '').trim().toUpperCase();
  if (!model.resolutions.includes(resolution)) throw new Error('请选择模型支持的分辨率');
  const allowed = model.aspectRatiosByResolution?.[resolution] || model.aspectRatios || [];
  const candidates = allowed.map(value => {
    const [w, h] = value.split(':').map(Number);
    return { value, ratio: w / h };
  }).filter(item => Number.isFinite(item.ratio) && item.ratio > 0);
  if (!candidates.length) throw new Error('该线路未提供可用画幅');
  const requestedRatio = dimensions?.width / dimensions?.height;
  const sourceRatio = Number.isFinite(requestedRatio) && requestedRatio > 0 ? requestedRatio : 2 / 3;
  candidates.sort((a, b) => Math.abs(Math.log(a.ratio / sourceRatio)) - Math.abs(Math.log(b.ratio / sourceRatio)));
  let ratio = candidates[0];
  const longEdge = { '1K': 1024, '2K': 2048, '4K': 3840 }[resolution];
  let size = normalizeGptImageOutputSize(ratio.ratio >= 1 ? longEdge : longEdge * ratio.ratio,
    ratio.ratio >= 1 ? longEdge / ratio.ratio : longEdge);
  let canvasAdjusted = false;
  const square = candidates.find(candidate => candidate.value === '1:1');
  if (Math.min(size.width, size.height) < MIN_SUBJECT_EDGE && resolution === '1K'
    && model.resolutions.every(value => value === '1K') && square) {
    // The model's only tier remains 1K for both quoting and execution. A square
    // canvas can retain the full subject using transparent margins, without
    // claiming a higher resolution or weakening the output alpha checks.
    ratio = square;
    size = normalizeGptImageOutputSize(longEdge, longEdge);
    canvasAdjusted = true;
  }
  if (Math.min(size.width, size.height) < MIN_SUBJECT_EDGE) {
    throw new Error('该画幅短边不足 1024 像素，请选择更高分辨率');
  }
  return {
    model, resolution, width: size.width, height: size.height,
    size: `${size.width}x${size.height}`, aspectRatio: ratio.value, canvasAdjusted,
    canvasNote: canvasAdjusted ? '这条线路只提供 1K，已使用 1024 × 1024 方形画布；通过透明留白保留完整主体。' : '',
  };
}

export function buildSubjectRequest(model, resolution, dimensions, instructions = '') {
  const output = subjectOutputPlan(model, resolution, dimensions);
  const subjectInstructions = String(instructions || '').trim();
  return {
    type: 't2i', count: 1,
    prompt: [
      'Remove the background from the reference image and extract the main subject as a meticulous, high-fidelity RGBA PNG asset for a layered collectible card.',
      'Preserve the subject identity, face, pose, proportions, original colors, texture, small lettering and every fine detail. Do not redesign, beautify, stylize, or invent details.',
      'Keep the complete subject, all fine hair strands, fur, thin wires, lace and translucent materials. Preserve continuous partial alpha and antialiased edges. Avoid halos, opaque fringes and clipped parts.',
      'The background must be truly transparent using the PNG alpha channel. Do not draw a checkerboard, white backdrop, black backdrop, green screen or simulated transparency. Do not add a frame, shadow, reflection, text or extra objects.',
      'Retain the original viewpoint and relative placement. If the output aspect ratio differs, extend transparent margins instead of cropping or stretching the subject.',
      output.canvasAdjusted ? 'Use a 1024 x 1024 square canvas. Fit the complete subject within it using transparent padding; preserve its proportions and do not crop any part.' : '',
      subjectInstructions ? `Subject selection details: ${subjectInstructions}` : '',
    ].filter(Boolean).join('\n'),
    params: {
      _source: HOLO_SOURCE, _kind: HOLO_KIND, publicModelKey: output.model.id,
      resolutionScale: output.resolution, aspectRatio: output.aspectRatio, quality: 'high',
      inputFidelity: 'high', ...(output.model.outputFormats.includes('png') ? { outputFormat: 'png' } : {}), transparentBackground: true,
      transparentPngEnabled: true, strictAlphaOutput: true,
      autoBackgroundRemovalEnabled: false, promptPolishEnabled: false,
      autoTranslateEnabled: false, size: output.size, outputSize: output.size,
    },
  };
}

export function subjectResolutionOptions(model, dimensions) {
  const normalized = normalizeSubjectModel(model);
  return SUBJECT_RESOLUTIONS.filter(resolution => normalized?.resolutions.includes(resolution)).map(resolution => {
    try {
      const { model: _model, ...output } = subjectOutputPlan(normalized, resolution, dimensions);
      return { ...output, available: true, reason: '' };
    } catch (error) {
      return { resolution, available: false, size: '', width: 0, height: 0, aspectRatio: '', canvasAdjusted: false, canvasNote: '', reason: error.message || '该分辨率不适合当前图片' };
    }
  });
}

export function selectSubjectResolution(options, preferred = '2K') {
  const requested = String(preferred || '').trim().toUpperCase();
  const available = new Set((Array.isArray(options) ? options : []).filter(option => option.available).map(option => option.resolution));
  return [requested, '2K', '4K', '1K'].find(resolution => available.has(resolution)) || '';
}

export function describeHoloGenerationError(error, fallback = '主体生成失败，请稍后重试') {
  const originalMessage = typeof error === 'string' ? error : String(error?.message || error?.errorMessage || fallback);
  const originalCode = String(error?.code || error?.errorCode || '');
  const unsupported = /transparent\s+background\s+is\s+not\s+supported\s+for\s+this\s+model/i.test(originalMessage);
  return {
    message: unsupported ? '这条线路拒绝了本次透明背景参数。可以继续制作原图闪卡，或导入已有的透明 PNG。' : originalMessage,
    errorDetail: {
      code: unsupported ? 'transparent_output_unsupported' : originalCode || 'holo_generation_failed',
      originalCode, originalMessage,
      modelId: String(error?.modelId || ''), taskId: String(error?.taskId || ''),
      status: Number(error?.status) || 0,
    },
  };
}

// Quoting cannot create a generation task. The separate controller gives this
// read a deadline without treating a timeout as a user cancellation or retry.
export async function requestSubjectQuote(request, quotePrice, { signal, timeoutMs = SUBJECT_QUOTE_TIMEOUT_MS } = {}) {
  const canceled = () => signal?.reason instanceof Error ? signal.reason : new DOMException('已取消读取报价', 'AbortError');
  if (signal?.aborted) throw canceled();
  const controller = new AbortController();
  let rejectStopped;
  const stopped = new Promise((_, reject) => { rejectStopped = reject; });
  const stop = error => {
    if (controller.signal.aborted) return;
    controller.abort(error);
    rejectStopped(error);
  };
  const onAbort = () => stop(canceled());
  signal?.addEventListener('abort', onAbort, { once: true });
  const timeout = setTimeout(() => stop(Object.assign(
    new Error('读取报价超时，请稍后重试。尚未提交生成任务。'), { code: 'quote_timeout' },
  )), timeoutMs);
  try {
    return await Promise.race([stopped, Promise.resolve().then(() => {
      if (controller.signal.aborted) throw controller.signal.reason;
      return quotePrice(request, { signal: controller.signal });
    })]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Alpha statistics are structural checks, not a claim of semantic edge accuracy.
export function inspectAlphaPixels(data, width, height, minEdge = MIN_SUBJECT_EDGE) {
  const pixels = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || Math.min(width, height) < minEdge) {
    throw new Error(`透明主体短边至少需要 ${minEdge} 像素`);
  }
  if (pixels > MAX_IMAGE_PIXELS || data.length !== pixels * 4) throw new Error('图片像素数据无效或超过上限');
  let transparent = 0, partial = 0, opaque = 0, visibleMass = 0, borderClear = 0, borderCount = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= 8) transparent++;
      else visibleMass += (alpha - 8) / 247;
      if (alpha >= 245) opaque++;
      if (alpha > 8 && alpha < 247) partial++;
      if (x === 0 || x === width - 1 || y === 0 || y === height - 1) {
        borderCount++;
        if (alpha <= 8) borderClear++;
      }
    }
  }
  if (transparent / pixels < 0.01) throw new Error('未检测到足够的真实透明区域，白底或棋盘格不等于透明 PNG');
  if (opaque * 500 < pixels && visibleMass * 500 < pixels) throw new Error('图片接近全透明，未检测到有效主体');
  if (borderClear / borderCount < 0.2) throw new Error('透明边界不足，请检查背景残留或主体是否被裁切');
  return { width, height, transparentRatio: transparent / pixels, partialRatio: partial / pixels };
}

export function isHoloSubjectTask(task) {
  return task?.type === 't2i' && task?.params?._kind === HOLO_KIND && task?.params?._source === HOLO_SOURCE;
}

export function inspectLineartPixels(data, width, height, subject) {
  if (!subject || width !== subject.width || height !== subject.height) {
    throw new Error('线稿画布尺寸必须与透明主体完全一致');
  }
  const count = width * height;
  if (count > MAX_IMAGE_PIXELS || data.length !== count * 4) throw new Error('线稿像素数据无效');
  let dark = 0, light = 0, gray = 0;
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    const r = 255 + (data[i] - 255) * alpha;
    const g = 255 + (data[i + 1] - 255) * alpha;
    const b = 255 + (data[i + 2] - 255) * alpha;
    const luminance = (r + g + b) / 3;
    if (luminance < 80) dark++;
    if (luminance > 230) light++;
    if (Math.max(r, g, b) - Math.min(r, g, b) < 15) gray++;
  }
  if (dark / count < 0.001 || dark / count > 0.4 || light / count < 0.3 || gray / count < 0.95) {
    throw new Error('线稿需为稀疏黑色轮廓，使用白底或透明底');
  }
  return { width, height, inkRatio: dark / count };
}

export function privateFileUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('/api/v1/files/') || /[\\\r\n]/.test(value)) return '';
  try {
    const url = new URL(value, 'https://holo.invalid');
    return url.origin === 'https://holo.invalid' && url.pathname.startsWith('/api/v1/files/') ? value : '';
  } catch { return ''; }
}
