import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia } from "@/services/file-storage";
import { canonicalImageSrc, cloudFileUrl, cloudThumbnailUrl } from "@/lib/canvas/canvas-preview-url";
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

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
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
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
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
            },
        },
    ),
);
