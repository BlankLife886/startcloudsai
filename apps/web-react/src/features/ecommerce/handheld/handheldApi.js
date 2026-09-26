import {
  apiGet,
  apiPost,
  apiRequest,
} from "@react/legacy-modules/services/apiClient.js";

function normalizeCatalogItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      id: String(item?.id || "").trim(),
      label: String(item?.label || "").trim(),
      image: String(item?.imageUrl || item?.image || "").trim(),
      kind: String(item?.kind || "").trim(),
      metadata:
        item?.metadata && typeof item.metadata === "object"
          ? item.metadata
          : {},
    }))
    .filter((item) => item.id && item.label && item.image);
}

export async function listHandheldCatalog({ signal } = {}) {
  const data = await apiGet("/commerce/catalog", {
    signal,
    fallbackMessage: "手持商品素材读取失败",
  });
  return {
    models: normalizeCatalogItems(data?.models),
    scenes: normalizeCatalogItems(data?.scenes),
    hands: normalizeCatalogItems(data?.hands),
  };
}

export function listHandheldProjects({ signal } = {}) {
  return apiGet("/commerce/handheld/projects", {
    signal,
    fallbackMessage: "手持商品项目读取失败",
  });
}

export function createHandheldProject(payload, { signal } = {}) {
  return apiPost("/commerce/handheld/projects", payload, {
    signal,
    fallbackMessage: "手持商品项目创建失败",
  });
}

export function getHandheldProject(id, { signal } = {}) {
  return apiGet(`/commerce/handheld/projects/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: "手持商品项目读取失败",
  });
}

export function updateHandheldProjectDraft(id, draft, { signal } = {}) {
  return apiRequest(
    `/commerce/handheld/projects/${encodeURIComponent(id)}/draft`,
    {
      method: "PUT",
      body: { draft },
      signal,
      fallbackMessage: "手持商品草稿保存失败",
    },
  );
}

export function quoteHandheldJob(payload, { signal } = {}) {
  return apiPost("/commerce/handheld/quotes", payload, {
    signal,
    fallbackMessage: "手持商品报价失败",
  });
}

export function createHandheldJob(payload, { signal } = {}) {
  return apiPost("/commerce/handheld/jobs", payload, {
    signal,
    fallbackMessage: "手持商品批次创建失败",
  });
}

export function getHandheldJob(id, { signal } = {}) {
  return apiGet(`/commerce/handheld/jobs/${encodeURIComponent(id)}`, {
    signal,
    fallbackMessage: "手持商品批次读取失败",
  });
}

export function cancelHandheldJob(id) {
  return apiPost(
    `/commerce/handheld/jobs/${encodeURIComponent(id)}/cancel`,
    {},
    { fallbackMessage: "停止手持商品批次失败" },
  );
}

export function retryHandheldItem(id, { signal } = {}) {
  return apiPost(
    `/commerce/handheld/items/${encodeURIComponent(id)}/retry`,
    {},
    { signal, fallbackMessage: "失败图片重试失败" },
  );
}

export function saveHandheldItemAsset(id, payload = {}) {
  return apiPost(
    `/commerce/handheld/items/${encodeURIComponent(id)}/save-asset`,
    payload,
    { fallbackMessage: "保存手持商品图失败" },
  );
}
