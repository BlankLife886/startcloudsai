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
    tags?: string[];
    contentHash?: string | null;
    sourceType?: string;
    sourceId?: string | null;
    sourceMetadata?: Record<string, unknown>;
    parentAssetId?: string | null;
    deletedAt?: string | null;
    updatedAt?: string;
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
        tags: item.tags || extra?.tags || [],
        source: item.sourceType || extra?.source,
        note: extra?.note,
        createdAt: now,
        updatedAt: extra?.updatedAt || now,
        metadata: { ...(extra?.metadata || {}), ...(item.sourceMetadata || {}), cloudAssetId: item.id, groupId: item.groupId, source: "user_assets", sourceType: item.sourceType, sourceId: item.sourceId, parentAssetId: item.parentAssetId, contentHash: item.contentHash, deletedAt: item.deletedAt },
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

export async function listUserAssetsPage(options: { limit?: number; cursor?: string; signal?: AbortSignal; q?: string; tags?: string[]; groupId?: string; trash?: boolean } = {}) {
    const query = new URLSearchParams({ limit: String(options.limit || 100) });
    if (options.cursor) query.set("cursor", options.cursor);
    if (options.q) query.set("q", options.q);
    if (options.tags?.length) query.set("tags", options.tags.join(","));
    if (options.groupId) query.set("groupId", options.groupId);
    if (options.trash) query.set("trash", "true");
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

export function createUserAsset(payload: { title: string; fileKey: string; thumbnailKey: string; contentType?: string; groupId?: string; tags?: string[]; sourceType?: string; sourceId?: string; sourceMetadata?: Record<string, unknown>; parentAssetId?: string }) {
    return starcloudsJson<CloudUserAsset>("/me/assets", "POST", payload);
}

export function deleteUserAsset(id: string) {
    return starcloudsRequest(`/me/assets/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function updateCloudUserAsset(id: string, payload: { title?: string; groupId?: string | null; tags?: string[] }) {
    return starcloudsJson<CloudUserAsset>(`/me/assets/${encodeURIComponent(id)}`, "PATCH", payload);
}

export function batchCloudUserAssets(payload: { action: "update" | "trash" | "restore"; ids: string[]; groupId?: string | null; addTags?: string[]; removeTags?: string[] }) {
    return starcloudsJson<{ affected: number }>("/me/assets/batch", "POST", payload);
}

export function restoreCloudUserAsset(id: string) {
    return starcloudsJson<CloudUserAsset>(`/me/assets/${encodeURIComponent(id)}/restore`, "POST", {});
}

export function permanentlyDeleteCloudUserAsset(id: string) {
    return starcloudsRequest(`/me/assets/${encodeURIComponent(id)}/permanent`, { method: "DELETE" });
}

export type CloudUserAssetGroup = { id: string; name: string; sort: number; assetCount: number; createdAt: string; updatedAt: string };

export function listCloudUserAssetGroups() {
    return starcloudsRequest<{ items: CloudUserAssetGroup[]; ungroupedCount: number; totalAssetCount: number }>("/me/asset-groups");
}

export function createCloudUserAssetGroup(name: string, sort?: number) {
    return starcloudsJson<CloudUserAssetGroup>("/me/asset-groups", "POST", { name, ...(sort === undefined ? {} : { sort }) });
}

export function updateCloudUserAssetGroup(id: string, payload: { name?: string; sort?: number }) {
    return starcloudsJson<CloudUserAssetGroup>(`/me/asset-groups/${encodeURIComponent(id)}`, "PATCH", payload);
}

export function deleteCloudUserAssetGroup(id: string) {
    return starcloudsRequest(`/me/asset-groups/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function isExistingUserAssetError(error: unknown) {
    return error instanceof StarcloudsApiError && (error.code === "asset_exists" || error.code === "asset_duplicate_content");
}
