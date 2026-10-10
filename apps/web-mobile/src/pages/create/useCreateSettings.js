import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchRuntimeConfig, getDefaultRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import { useSitePriceRefresh } from "@react/hooks/useSitePriceRefresh.js";
import {
  T2I_ASPECT_OPTIONS,
  T2I_QUALITY_OPTIONS,
  T2I_RESOLUTION_OPTIONS,
} from "@react/legacy-modules/features/ai-wallpaper/composables/wallpaperStudioConstants.js";
import {
  clampImageCount,
  getModelAspectRatiosForResolution,
  imageCountChoices,
  normalizeImageModelCapabilities,
} from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import { resolveModelTierPointPricing } from "@react/legacy-modules/features/ai-shared/modelPointPricing.js";
import { availableCatalogModels } from "@react/components/common/ModelCatalogIcon.jsx";
import {
  backgroundRemovalModelsOf,
  featureModels,
  wallpaperFeature,
  modelPromptMaxChars,
} from "@react/features/text-to-image/t2iRequest.js";

const DRAFT_VERSION = 1;
const DEFAULTS = {
  prompt: "",
  modelId: "",
  ratio: "1:1",
  resolution: "1K",
  quality: "medium",
  count: 1,
  polish: false,
  translate: false,
  transparent: false,
  autoRemove: false,
};

function draftKey(userId) {
  return `starclouds-m-create-draft:${userId || "guest"}`;
}

function readDraft(userId) {
  try {
    const value = JSON.parse(localStorage.getItem(draftKey(userId)) || "null");
    return value?.version === DRAFT_VERSION ? value.settings : null;
  } catch {
    return null;
  }
}

/** 文生图表单：模型目录、参数、能力约束与本机草稿。 */
export function useCreateSettings(userId) {
  const [runtime, setRuntime] = useState(() => getDefaultRuntimeConfig());
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...readDraft(userId) }));

  // 动态调价到点重新读取价格，已选参数不变。
  useSitePriceRefresh(setRuntime);

  useEffect(() => {
    let disposed = false;
    fetchRuntimeConfig()
      .then((config) => { if (!disposed) setRuntime(config); })
      .catch(() => null)
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);

  // 只在真正换了账号时切换到该账号的草稿；首次挂载已由初始值读过，重复执行会覆盖刚带入的提示词。
  const draftOwner = useRef(userId);
  useEffect(() => {
    if (draftOwner.current === userId) return;
    draftOwner.current = userId;
    setSettings({ ...DEFAULTS, ...readDraft(userId) });
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(draftKey(userId), JSON.stringify({ version: DRAFT_VERSION, settings }));
      } catch {
        // 隐私模式等场景下写不进去，草稿只是便利功能。
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [settings, userId]);

  const update = useCallback((patch) => {
    setSettings((current) => ({ ...current, ...(typeof patch === "function" ? patch(current) : patch) }));
  }, []);

  const feature = useMemo(() => wallpaperFeature(runtime), [runtime]);
  const models = useMemo(() => availableCatalogModels(featureModels(runtime)), [runtime]);
  const model = models.find((item) => item.id === settings.modelId)
    || models.find((item) => item.default)
    || models[0]
    || null;
  const capabilities = useMemo(() => normalizeImageModelCapabilities(model || {}), [model]);
  const backgroundRemovalModels = useMemo(() => backgroundRemovalModelsOf(runtime), [runtime]);
  const backgroundRemovalModel = backgroundRemovalModels.find((item) => item.default === true)
    || backgroundRemovalModels[0]
    || null;

  // 分辨率槽位全部故障时服务端会拒单，这里直接不提供该分辨率。
  const resolutionOptions = useMemo(() => {
    const unavailable = new Set(model?.unavailableResolutions || []);
    return T2I_RESOLUTION_OPTIONS.filter((option) => capabilities.resolutions.includes(option.value) && !unavailable.has(option.value));
  }, [capabilities, model]);
  const qualityOptions = useMemo(
    () => T2I_QUALITY_OPTIONS.filter((option) => capabilities.qualities.includes(option.value)),
    [capabilities],
  );
  const ratioOptions = useMemo(() => {
    const labels = new Map(T2I_ASPECT_OPTIONS.map((option) => [option.value, option.label]));
    return getModelAspectRatiosForResolution(model || {}, settings.resolution)
      .map((value) => ({ value, label: value === "auto" ? "自动" : value, hint: labels.get(value) || value }));
  }, [model, settings.resolution]);
  const countOptions = useMemo(() => imageCountChoices(model || {}, settings.count), [model, settings.count]);

  // 模型目录加载完再校正参数，避免草稿里的选择在加载前被清空。
  useEffect(() => {
    if (loading || !model) return;
    setSettings((current) => {
      const next = { ...current };
      if (next.modelId !== model.id) next.modelId = model.id;
      if (resolutionOptions.length && !resolutionOptions.some((item) => item.value === next.resolution)) next.resolution = resolutionOptions[0].value;
      if (qualityOptions.length && !qualityOptions.some((item) => item.value === next.quality)) {
        next.quality = qualityOptions.find((item) => item.value === "medium")?.value || qualityOptions[0].value;
      }
      if (ratioOptions.length && !ratioOptions.some((item) => item.value === next.ratio)) {
        next.ratio = ratioOptions.find((item) => item.value === "1:1")?.value || ratioOptions[0].value;
      }
      next.count = clampImageCount(next.count, model, 1);
      if (!capabilities.transparentBackground) next.transparent = false;
      if (!backgroundRemovalModel) next.autoRemove = false;
      const changed = Object.keys(next).some((key) => next[key] !== current[key]);
      return changed ? next : current;
    });
  }, [backgroundRemovalModel, capabilities, loading, model, qualityOptions, ratioOptions, resolutionOptions]);

  const unitCost = Math.max(0, Number(
    model?.pointPricing?.configured
      ? resolveModelTierPointPricing(model, { resolution: settings.resolution, quality: settings.quality }).effective
      : feature.creditCost,
  ) || 0) + (settings.autoRemove ? Math.max(0, Number(backgroundRemovalModel?.pricePoints || 0)) : 0);

  return {
    loading,
    runtime,
    feature,
    settings,
    update,
    models,
    model,
    capabilities,
    backgroundRemovalModel,
    resolutionOptions,
    qualityOptions,
    ratioOptions,
    countOptions,
    maxReferences: Math.max(0, Number(model?.maxReferenceImages ?? 4)),
    promptMaxChars: modelPromptMaxChars(model, runtime?.promptInputLimits?.t2iPromptMaxChars ?? 8000),
    unitCost,
  };
}
