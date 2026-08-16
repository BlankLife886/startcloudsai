import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { readImageSizeFromBlob } from "@/lib/image-utils";
import { cloudThumbnailKey, cloudThumbnailUrl } from "@/lib/canvas/canvas-preview-url";
import { StarcloudsApiError, uploadCloudFile } from "@/services/starclouds-api";

export type UploadedImage = {
    url: string;
    storageKey: string;
    thumbnailUrl?: string;
    thumbnailKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();

async function createPreviewObjectUrl(blob: Blob, edge = 512) {
    const source = await createImageBitmap(blob);
    const longEdge = Math.max(source.width, source.height);
    const scale = longEdge > edge ? edge / longEdge : 1;
    const bitmap =
        scale < 1
            ? await createImageBitmap(source, {
                  resizeWidth: Math.max(1, Math.round(source.width * scale)),
                  resizeHeight: Math.max(1, Math.round(source.height * scale)),
                  resizeQuality: "medium",
              })
            : source;
    if (bitmap !== source) source.close();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, bitmap.width);
    canvas.height = Math.max(1, bitmap.height);
    const context = canvas.getContext("2d", { alpha: blob.type === "image/png" || blob.type === "image/webp" });
    if (!context) {
        bitmap.close();
        return "";
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const preview = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((webp) => {
            if (webp) {
                resolve(webp);
                return;
            }
            canvas.toBlob(resolve, "image/jpeg", 0.5);
        }, "image/webp", 0.5);
    });
    canvas.width = 0;
    canvas.height = 0;
    return preview ? URL.createObjectURL(preview) : "";
}

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    if (typeof input === "string") {
        const storageKey = cloudKeyFromUrl(input);
        if (storageKey) {
            return {
                url: input,
                storageKey,
                thumbnailKey: cloudThumbnailKey(storageKey) || undefined,
                thumbnailUrl: cloudThumbnailUrl(storageKey) || undefined,
                width: 1024,
                height: 1024,
                bytes: 0,
                mimeType: "image/jpeg",
            };
        }
    }
    const blob = typeof input === "string" ? await (await fetch(input)).blob() : input;
    const meta = await readImageSizeFromBlob(blob);
    try {
        const uploaded = await uploadCloudFile(blob, imageFilename(blob));
        return {
            url: uploaded.url,
            storageKey: uploaded.key,
            thumbnailKey: uploaded.thumbnailKey || cloudThumbnailKey(uploaded.key) || undefined,
            thumbnailUrl: uploaded.thumbnailUrl || cloudThumbnailUrl(uploaded.key) || undefined,
            width: meta.width,
            height: meta.height,
            bytes: uploaded.sizeBytes,
            mimeType: uploaded.contentType || meta.mimeType,
        };
    } catch (error) {
        if (!(error instanceof StarcloudsApiError) || error.code !== "network_error") throw error;
    }

    const previewUrl = await createPreviewObjectUrl(blob);
    const storageKey = `image:${nanoid()}`;
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return { url, storageKey, thumbnailUrl: previewUrl || undefined, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType };
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
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
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
        reader.onerror = () => reject(new Error(i18n.t("common.imageReadFailed")));
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
