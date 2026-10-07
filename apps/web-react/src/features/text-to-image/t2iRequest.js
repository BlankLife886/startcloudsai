// 文生图请求的纯逻辑：模型目录解析与任务载荷组装。桌面端与手机站（apps/web-mobile）共用。
import {
  buildWallpaperSkillPrompt,
  resolveActiveWallpaperSkills,
} from "../../legacy-modules/features/ai-wallpaper/skills/wallpaperSkills.js";
import { resolveT2iOutputSize } from "../../legacy-modules/features/ai-wallpaper/composables/wallpaperStudioConstants.js";
import {
  getModelAutoAspectRatioCandidates,
  getModelAspectRatiosForResolution,
  normalizeImageModelCapabilities,
} from "../../legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { resolveModelPointPricing } from "../../legacy-modules/features/ai-shared/modelPointPricing.js";
import { normalizeModelLabel } from "../../legacy-modules/features/ai-shared/modelDisplay.js";
import { exactImageSizeParams } from "../../config/exactImageSize.js";

export function normalizePublicModel(item = {}) {
  const id = String(item.id || item.publicModelKey || item.model || "").trim();
  if (!id) return null;
  const pointPricing = resolveModelPointPricing(item);
  return {
    ...item,
    ...normalizeImageModelCapabilities(item),
    id,
    label: normalizeModelLabel(item),
    pointPricing,
    creditCost: Math.max(0, Number(pointPricing.effective ?? 0)),
  };
}

export function wallpaperFeature(config = {}) {
  const raw = config.features?.["ai.wallpaperGeneration"] || {};
  return raw.config && typeof raw.config === "object"
    ? { ...raw, ...raw.config }
    : raw;
}

export function featureModels(config) {
  const feature = wallpaperFeature(config);
  const values = Array.isArray(feature.publicModels) ? feature.publicModels : [];
  return values.map(normalizePublicModel).filter(Boolean);
}

export function backgroundRemovalModelsOf(config = {}) {
  const raw = config.features?.["ai.imageTools"] || {};
  const toolConfig = raw.config && typeof raw.config === "object" ? raw.config : raw;
  return Array.isArray(toolConfig.backgroundRemovalModels)
    ? toolConfig.backgroundRemovalModels.filter((item) => item?.id)
    : [];
}

/**
 * 组装单张文生图任务的提交载荷。settings 为当前表单选择，batch 为批次内位置与参考图。
 */
export function buildT2iPayload(settings, { sourceUrls, batchId, batchIndex, batchSize, batchCreatedAt }) {
  const {
    model,
    modelId = "",
    prompt = "",
    ratio,
    resolution,
    quality,
    imageSize = { sizeMode: "ratio" },
    outputFormat = "auto",
    moderation = "",
    transparent = false,
    polish = false,
    translate = false,
    autoRemove = false,
    backgroundRemovalModelId = "",
    selectedSkillIds = [],
    superResolutionEnabled = true,
    expectedUnitPriceCents = null,
  } = settings;
  const capabilities = normalizeImageModelCapabilities(model || {});
  const exact = imageSize.sizeMode === "exact";
  const exactParams = exact ? exactImageSizeParams(model, imageSize.exactWidth, imageSize.exactHeight) : {};
  const supportsResolution = !exact && capabilities.resolutions.includes(resolution);
  const supportsQuality = capabilities.qualities.includes(quality);
  const supportedRatios = getModelAspectRatiosForResolution(model || {}, resolution);
  const supportsRatio = !exact && supportedRatios.includes(ratio);
  const activeSkills = resolveActiveWallpaperSkills({
    outputType: "image",
    resolutionScale: supportsResolution ? resolution : "",
    superResolutionEnabled,
    selectedSkillIds,
    customSkills: [],
  });
  const skillPrompt = buildWallpaperSkillPrompt(activeSkills);
  const outputSize = exact ? `${exactParams.exactWidth}x${exactParams.exactHeight}` : supportsResolution && supportsRatio
    ? resolveT2iOutputSize(ratio, resolution)
    : "";
  const publicModelKey = model?.id || modelId;
  const kind = sourceUrls.length ? "wallpaper-image-edit" : "wallpaper-image-generation";
  const requestPrompt = [prompt.trim(), skillPrompt].filter(Boolean).join("\n\n");
  const supportedFormats = model?.outputFormats || [];
  const requestedFormat = transparent ? "png" : outputFormat;
  const effectiveOutputFormat = supportedFormats.includes(requestedFormat)
    ? requestedFormat
    : "";
  const supportedModeration = model?.moderationLevels || [];
  const effectiveModeration = supportedModeration.includes(moderation)
    ? moderation
    : "";
  const input = {
    sourceUrl: sourceUrls[0] || "",
    sourceUrls,
    ...exactParams,
    ...(supportsRatio ? { aspectRatio: ratio, requestedAspectRatio: ratio } : {}),
    ...(supportsRatio && ratio === "auto"
      ? { autoAspectRatioCandidates: getModelAutoAspectRatioCandidates(model || {}, resolution) }
      : {}),
    ...(outputSize ? { outputSize, size: outputSize } : {}),
    ...(supportsResolution ? { resolutionScale: resolution } : {}),
    ...(supportsQuality ? { quality } : {}),
    count: 1,
    n: 1,
    batchId,
    batchIndex,
    batchSize,
    batchCreatedAt,
    sourceMode: "text",
    userPrompt: prompt.trim(),
    promptPolishEnabled: polish,
    autoTranslateEnabled: translate,
    ...(capabilities.transparentBackground
      ? {
          transparentPngEnabled: transparent,
          transparentBackground: transparent,
        }
      : {}),
    autoBackgroundRemovalEnabled: autoRemove,
    autoBackgroundRemovalModelKey: autoRemove ? backgroundRemovalModelId || "" : "",
    ...(effectiveOutputFormat ? { outputFormat: effectiveOutputFormat } : {}),
    ...(effectiveModeration ? { moderationLevel: effectiveModeration } : {}),
    skills: activeSkills,
    skillIds: activeSkills.map((item) => item.id),
  };
  return {
    kind,
    clientRequestId: crypto.randomUUID(),
    prompt: requestPrompt,
    input,
    params: {
      ...input,
      providerHint: "",
      modelHint: publicModelKey,
      publicModelKey,
      executionMode: "server",
    },
    units: 1,
    expectedUnitPriceCents,
  };
}
