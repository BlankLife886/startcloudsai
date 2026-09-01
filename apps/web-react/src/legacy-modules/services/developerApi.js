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

export async function listWebhooks({ signal } = {}) {
  const data = await apiGet("/me/webhooks", {
    signal,
    fallbackMessage: "Webhook 读取失败",
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export function createWebhook(payload) {
  return apiPost("/me/webhooks", payload, { fallbackMessage: "Webhook 创建失败" });
}

export function updateWebhook(id, payload) {
  return apiPatch(`/me/webhooks/${encodeURIComponent(id)}`, payload, {
    fallbackMessage: "Webhook 更新失败",
  });
}

export function deleteWebhook(id) {
  return apiDelete(`/me/webhooks/${encodeURIComponent(id)}`, {
    fallbackMessage: "Webhook 删除失败",
  });
}

export async function listWebhookDeliveries({ signal } = {}) {
  const data = await apiGet("/me/webhook-deliveries", {
    signal,
    fallbackMessage: "投递记录读取失败",
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export function retryWebhookDelivery(id) {
  return apiPost(`/me/webhook-deliveries/${encodeURIComponent(id)}/retry`, null, {
    fallbackMessage: "Webhook 重试失败",
  });
}
