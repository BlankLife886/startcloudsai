import { apiDelete, apiGet, apiPatch, apiPost } from "./apiClient.js";

export async function listDeveloperModels({ signal } = {}) {
  const data = await apiGet("/me/api-models", {
    signal,
    fallbackMessage: "开放模型读取失败",
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function listAPIKeys({ signal } = {}) {
  const data = await apiGet("/me/api-keys", {
    signal,
    fallbackMessage: "API Key 读取失败",
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export function createAPIKey(payload) {
  return apiPost("/me/api-keys", payload, { fallbackMessage: "API Key 创建失败" });
}

export function updateAPIKey(id, payload) {
  return apiPatch(`/me/api-keys/${encodeURIComponent(id)}`, payload, {
    fallbackMessage: "API Key 更新失败",
  });
}

export function revokeAPIKey(id) {
  return apiDelete(`/me/api-keys/${encodeURIComponent(id)}`, {
    fallbackMessage: "API Key 撤销失败",
  });
}

export function rotateAPIKey(id) {
  return apiPost(`/me/api-keys/${encodeURIComponent(id)}/rotate`, null, {
    fallbackMessage: "API Key 轮换失败",
  });
}

export async function listAPICalls({ page = 1, key = "", signal } = {}) {
  const params = new URLSearchParams({ page: String(page), limit: "20" });
  if (key) params.set("key", key);
  const data = await apiGet(`/me/api-calls?${params}`, {
    signal,
    fallbackMessage: "调用记录读取失败",
  });
  return {
    items: Array.isArray(data?.items) ? data.items : [],
    total: Number(data?.total) || 0,
    totalCapped: Boolean(data?.totalCapped),
    pageSize: Number(data?.pageSize) || 20,
  };
}
