import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia } from "@/services/file-storage";
import { canonicalImageSrc, cloudFileUrl, cloudThumbnailUrl, storageKeyFromUrl } from "@/lib/canvas/canvas-preview-url";
import { cloudUserAssetToCanvasImage, createUserAsset, deleteUserAsset, isExistingUserAssetError, isUserUploadOriginalKey, listAllUserAssets, userUploadThumbnailKey } from "@/services/user-assets";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

export type AssetKind = "text" | "image" | "video";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type ImageAssetDraft = Omit<ImageAsset, "id" | "createdAt" | "updatedAt">;

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    addSharedImage: (asset: ImageAssetDraft) => Promise<string>;
    syncCloudImages: (signal?: AbortSignal) => Promise<void>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";
let persistAssets = true;

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        try {
            const value = await localForageStorage.getItem(name);
            if (!value) {
                persistAssets = true;
                return null;
            }
            const parsed = JSON.parse(value) as StorageValue<AssetStore>;
            let migrated = false;
            parsed.state.assets = await Promise.all(
                parsed.state.assets.map(async (asset) => {
                    if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: asset.data.url.startsWith("blob:") ? cloudFileUrl(asset.data.storageKey) || asset.data.storageKey : asset.data.url } };
                    if (asset.kind !== "image") return asset;
                    if (asset.data.storageKey)
                        return {
                            ...asset,
                            coverUrl: asset.coverUrl.startsWith("blob:") ? cloudThumbnailUrl(asset.data.storageKey) || cloudFileUrl(asset.data.storageKey) : asset.coverUrl,
                            data: { ...asset.data, dataUrl: canonicalImageSrc({ src: asset.data.dataUrl, storageKey: asset.data.storageKey }) },
                        };
                    if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                    try {
                        const image = await uploadImage(asset.data.dataUrl);
                        migrated = true;
                        return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
                    } catch (error) {
                        console.warn("Canvas asset image migration failed", error);
                        return asset;
                    }
                }),
            );
            if (migrated) {
                try {
                    await localForageStorage.setItem(name, JSON.stringify(parsed));
                } catch (error) {
                    console.warn("Canvas asset store write-back failed", error);
                }
            }
            persistAssets = true;
            return parsed;
        } catch (error) {
            persistAssets = false;
            console.error("Canvas asset store failed to hydrate", error);
            throw error;
        }
    },
    setItem: (name, value) => {
        if (!persistAssets) return;
        return localForageStorage.setItem(name, JSON.stringify(value));
    },
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            addSharedImage: async (asset) => {
                try {
                    const registered = await registerImageWithUserLibrary(asset);
                    set((state) => ({
                        assets: [registered, ...state.assets.filter((item) => item.id !== registered.id && !(item.kind === "image" && item.data.storageKey && item.data.storageKey === registered.data.storageKey))],
                    }));
                    return registered.id;
                } catch (error) {
                    if (isExistingUserAssetError(error)) {
                        await get().syncCloudImages();
                        const key = asset.data.storageKey || storageKeyFromUrl(asset.data.dataUrl || asset.coverUrl);
                        const existing = get().assets.find((item) => item.kind === "image" && item.data.storageKey === key);
                        if (existing) return existing.id;
                    }
                    return get().addAsset(asset);
                }
            },
            syncCloudImages: async (signal) => {
                try {
                    const remote = await listAllUserAssets(signal);
                    if (signal?.aborted) return;
                    const remoteImages = remote.map((item) => cloudUserAssetToCanvasImage(item));
                    const remoteKeys = new Set(remoteImages.map((item) => item.data.storageKey).filter(Boolean));
                    const remoteIds = new Set(remoteImages.map((item) => item.id));
                    const local = get().assets;
                    const leftoverImages = local.filter((item): item is ImageAsset => {
                        if (item.kind !== "image") return false;
                        const cloudId = String(item.metadata?.cloudAssetId || "");
                        return !remoteIds.has(item.id) && !remoteIds.has(cloudId) && !(item.data.storageKey && remoteKeys.has(item.data.storageKey));
                    });
                    const migrated: ImageAsset[] = [];
                    const stillLocal: ImageAsset[] = [];
                    for (const item of leftoverImages.slice(0, 20)) {
                        if (!isUserUploadOriginalKey(item.data.storageKey || "")) {
                            stillLocal.push(item);
                            continue;
                        }
                        try {
                            migrated.push(await registerImageWithUserLibrary(item));
                        } catch (error) {
                            if (!isExistingUserAssetError(error)) stillLocal.push(item);
                        }
                    }
                    leftoverImages.slice(20).forEach((item) => stillLocal.push(item));
                    const mergedImages = [...migrated, ...remoteImages].filter((item, index, list) => list.findIndex((entry) => entry.id === item.id || (entry.data.storageKey && entry.data.storageKey === item.data.storageKey)) === index);
                    set({
                        assets: [...mergedImages, ...stillLocal, ...local.filter((item) => item.kind !== "image")],
                    });
                } catch (error) {
                    if (signal?.aborted) return;
                    console.warn("Canvas asset cloud sync failed", error);
                }
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) => {
                const current = get().assets.find((asset) => asset.id === id);
                const cloudId = current?.kind === "image" ? String(current.metadata?.cloudAssetId || (isCloudAssetId(id) ? id : "")) : "";
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    if (!cloudId) get().cleanupImages({ assets });
                    return { assets };
                });
                if (cloudId) void deleteUserAsset(cloudId).catch((error) => console.warn("Canvas asset cloud delete failed", error));
            },
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) {
                    persistAssets = false;
                    console.error("Canvas asset store failed to hydrate", error);
                }
                useAssetStore.setState({ hydrated: true });
                void useAssetStore.getState().syncCloudImages();
            },
        },
    ),
);

function isCloudAssetId(id: string) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

async function registerImageWithUserLibrary(asset: ImageAsset | ImageAssetDraft): Promise<ImageAsset> {
    let fileKey = asset.data.storageKey || storageKeyFromUrl(asset.data.dataUrl || asset.coverUrl);
    let thumbnailKey = userUploadThumbnailKey(fileKey);
    let contentType = asset.data.mimeType;
    let url = asset.data.dataUrl || asset.coverUrl;
    let coverUrl = asset.coverUrl;
    if (!isUserUploadOriginalKey(fileKey) || !thumbnailKey) {
        const uploaded = await uploadImage(asset.data.dataUrl || asset.coverUrl || fileKey);
        fileKey = uploaded.storageKey;
        thumbnailKey = uploaded.thumbnailKey || userUploadThumbnailKey(uploaded.storageKey);
        contentType = uploaded.mimeType;
        url = uploaded.url;
        coverUrl = uploaded.thumbnailUrl || uploaded.url;
    }
    if (!isUserUploadOriginalKey(fileKey) || !thumbnailKey) throw new Error("image is not a user library upload");
    const created = await createUserAsset({
        title: String(asset.title || "图片").slice(0, 120),
        fileKey,
        thumbnailKey,
        contentType,
    });
    return cloudUserAssetToCanvasImage(created, {
        ...asset,
        coverUrl,
        data: { ...asset.data, dataUrl: url, storageKey: fileKey, mimeType: contentType },
    });
}
