import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { StarcloudsApiError, uploadCloudFile } from "@/services/starclouds-api";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    if (typeof input === "string") {
        const storageKey = cloudKeyFromUrl(input);
        if (storageKey) {
            const meta = await readImageMeta(input);
            const blob = await (await fetch(input, { credentials: "include" })).blob();
            return { url: input, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
        }
    }
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    try {
        const uploaded = await uploadCloudFile(blob, imageFilename(blob));
        const meta = await readImageMeta(uploaded.url);
        return { url: uploaded.url, storageKey: uploaded.key, width: meta.width, height: meta.height, bytes: uploaded.sizeBytes, mimeType: uploaded.contentType };
    } catch (error) {
        if (!(error instanceof StarcloudsApiError) || error.code !== "network_error") throw error;
    }

    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    const meta = await readImageMeta(url);
    return { url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (isCloudStorageKey(storageKey)) return fallback || `/api/v1/files/${storageKey}`;
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (isCloudStorageKey(storageKey)) return (await fetch(`/api/v1/files/${storageKey}`, { credentials: "include" })).blob();
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (isCloudStorageKey(storageKey)) return `/api/v1/files/${storageKey}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            const url = objectUrls.get(key);
            if (url) URL.revokeObjectURL(url);
            objectUrls.delete(key);
            if (!isCloudStorageKey(key)) await store.removeItem(key);
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown) {
    const usedKeys = collectImageStorageKeys(usedData);
    const unused: string[] = [];
    await store.iterate((_value, key) => {
        if (!usedKeys.has(key)) unused.push(key);
    });
    await deleteStoredImages(unused);
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    if (!value || typeof value !== "object") return keys;
    if ("storageKey" in value && typeof value.storageKey === "string" && value.storageKey.startsWith("image:")) keys.add(value.storageKey);
    Object.values(value).forEach((item) => (Array.isArray(item) ? item.forEach((child) => collectImageStorageKeys(child, keys)) : collectImageStorageKeys(item, keys)));
    return keys;
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

function isCloudStorageKey(key: string) {
    return key.startsWith("uploads/") || key.startsWith("tasks/");
}

function imageFilename(blob: Blob) {
    const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png";
    return `canvas-${crypto.randomUUID()}.${extension}`;
}

function cloudKeyFromUrl(value: string) {
    const marker = "/api/v1/files/";
    const index = value.indexOf(marker);
    return index >= 0 ? decodeURIComponent(value.slice(index + marker.length)) : "";
}
