import { useCallback, useEffect, useState } from "react";
import { availableCatalogModels } from "../../components/common/ModelCatalogIcon.jsx";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";

// AI 电商唯一跨模块共享的状态：顶部“生成模型”。模型列表与能力（画幅、清晰度、参考图上限）
// 来自后台模型配置；用户选中的模型按设备记住，切换侧栏模块、刷新页面都沿用。
const MODEL_STORAGE_KEY = "starclouds-ecommerce-model-v1";

function readStoredModelId() {
  try {
    return window.localStorage.getItem(MODEL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredModelId(value) {
  try {
    if (value) window.localStorage.setItem(MODEL_STORAGE_KEY, value);
    else window.localStorage.removeItem(MODEL_STORAGE_KEY);
  } catch {
    /* 存储不可用时只影响下次默认选中 */
  }
}

function modelKeys(model) {
  return [model?.id, model?.publicModelKey, model?.model].map((item) => String(item || ""));
}

export function findCommerceModel(models, modelId) {
  const id = String(modelId || "");
  if (!id) return null;
  return (models || []).find((model) => modelKeys(model).includes(id)) || null;
}

export function useCommerceModels() {
  const [models, setModels] = useState([]);
  const [modelId, setModelIdState] = useState("");
  const [defaultUnitPrice, setDefaultUnitPrice] = useState(3);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetchRuntimeConfig(),
      fetch("/api/v1/pricing", { signal: controller.signal }).then((response) =>
        response.json(),
      ),
    ]).then(([runtime, pricing]) => {
      if (controller.signal.aborted) return;
      if (runtime.status === "fulfilled") {
        const feature = runtime.value.features?.["ai.ecommerceDesign"] || {};
        const list =
          feature.config?.publicModels ||
          feature.publicModels ||
          runtime.value.aiModelCatalog?.featurePublicModels ||
          [];
        setModels(list);
        const available = availableCatalogModels(list);
        const stored = readStoredModelId();
        const keep = stored && available.some((model) => modelKeys(model).includes(stored));
        setModelIdState(
          keep
            ? stored
            : String(
                available.find((item) => item.default)?.id ||
                  available[0]?.id ||
                  available[0]?.publicModelKey ||
                  "",
              ),
        );
      }
      if (pricing.status === "fulfilled") {
        setDefaultUnitPrice(
          Number(pricing.value?.data?.taskPointPrices?.ecommerce_design || 3),
        );
      }
      setReady(true);
    });
    return () => controller.abort();
  }, []);

  const setModelId = useCallback((value) => {
    const next = String(value || "");
    setModelIdState(next);
    writeStoredModelId(next);
  }, []);

  return { models, modelId, setModelId, defaultUnitPrice, ready };
}
