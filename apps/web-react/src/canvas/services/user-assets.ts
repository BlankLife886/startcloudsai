import { cloudFileUrl, cloudThumbnailKey, storageKeyFromUrl } from "@/lib/canvas/canvas-preview-url";
import { StarcloudsApiError, starcloudsJson, starcloudsRequest } from "@/services/starclouds-api";
import type { ImageAsset } from "@/stores/use-asset-store";

export type CloudUserAsset = {
    id: string;
    title?: string;
    url?: string;
    thumbnailUrl?: string;
    contentType?: string;
    sizeBytes?: number;
    createdAt?: string;
    groupId?: string | null;
};

export function isUserUploadOriginalKey(key = "") {
    return /^uploads\/[^/]+\/original\//.test(key);
}

export function userUploadThumbnailKey(fileKey = "") {
    return cloudThumbnailKey(fileKey);
}

export function resolveUserAssetUrl(url = "") {
    if (!url) return "";
    if (url.startsWith("http") || url.startsWith("blob:") || url.startsWith("data:")) return url;
    const key = storageKeyFromUrl(url);
    return key ? cloudFileUrl(key) : url;
}

export function cloudUserAssetToCanvasImage(item: CloudUserAsset, extra?: Partial<ImageAsset>): ImageAsset {
    const fileKey = storageKeyFromUrl(item.url || "") || extra?.data?.storageKey || "";
    const thumbUrl = resolveUserAssetUrl(item.thumbnailUrl || "") || extra?.coverUrl || "";
    const url = resolveUserAssetUrl(item.url || "") || extra?.data?.dataUrl || "";
    const now = item.createdAt || extra?.createdAt || new Date().toISOString();
    return {
        id: item.id,
        kind: "image",
        title: String(item.title || extra?.title || "").trim() || "图片",
        coverUrl: thumbUrl || url,
        tags: extra?.tags || [],
        source: extra?.source,
        note: extra?.note,
        createdAt: now,
        updatedAt: extra?.updatedAt || now,
        metadata: { ...(extra?.metadata || {}), cloudAssetId: item.id, source: "user_assets" },
        data: {
            dataUrl: url,
            storageKey: fileKey,
            width: extra?.data?.width || 0,
            height: extra?.data?.height || 0,
            bytes: Number(item.sizeBytes || extra?.data?.bytes || 0),
            mimeType: item.contentType || extra?.data?.mimeType || "image/png",
        },
    };
}

export async function listUserAssetsPage(options: { limit?: number; cursor?: string; signal?: AbortSignal } = {}) {
    const query = new URLSearchParams({ limit: String(options.limit || 100) });
    if (options.cursor) query.set("cursor", options.cursor);
    const data = await starcloudsRequest<{ items?: CloudUserAsset[]; nextCursor?: string | null }>(`/me/assets?${query}`, { signal: options.signal });
    return {
        items: Array.isArray(data.items) ? data.items : [],
        nextCursor: data.nextCursor || null,
    };
}

export async function listAllUserAssets(signal?: AbortSignal) {
    const items: CloudUserAsset[] = [];
    let cursor = "";
    for (let page = 0; page < 8; page += 1) {
        const batch = await listUserAssetsPage({ limit: 100, cursor, signal });
        items.push(...batch.items);
        if (!batch.nextCursor) break;
        cursor = batch.nextCursor;
    }
    return items;
}

export function createUserAsset(payload: { title: string; fileKey: string; thumbnailKey: string; contentType?: string }) {
    return starcloudsJson<CloudUserAsset>("/me/assets", "POST", payload);
}

export function deleteUserAsset(id: string) {
    return starcloudsRequest(`/me/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function isExistingUserAssetError(error: unknown) {
    return error instanceof StarcloudsApiError && error.code === "asset_exists";
}
