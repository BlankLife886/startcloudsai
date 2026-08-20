import localforage from "localforage";

import { nanoid } from "nanoid";
import i18n from "@/i18n";
import { readImageSizeFromBlob } from "@/lib/image-utils";
import { cloudFileUrl, cloudThumbnailKey, cloudThumbnailUrl, isLocalImageKey, storageKeyFromUrl } from "@/lib/canvas/canvas-preview-url";
import { StarcloudsApiError, fetchCloudFileBlob, starcloudsFileUrl, uploadCloudFile } from "@/services/starclouds-api";

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

function uploadedFromCloudKey(storageKey: string, url = ""): UploadedImage {
    return {
        url: cloudFileUrl(storageKey) || url,
        storageKey,
        thumbnailKey: cloudThumbnailKey(storageKey) || undefined,
        thumbnailUrl: cloudThumbnailUrl(storageKey) || undefined,
        width: 1024,
        height: 1024,
        bytes: 0,
        mimeType: "image/png",
    };
}

export async function adoptGeneratedImage(image: { dataUrl?: string; storageKey?: string }): Promise<UploadedImage> {
    const key = (image.storageKey && isCloudStorageKey(image.storageKey) && image.storageKey) || storageKeyFromUrl(image.dataUrl || image.storageKey || "");
    if (key && isCloudStorageKey(key)) return uploadedFromCloudKey(key, image.dataUrl);
    if (!image.dataUrl) throw new Error(i18n.t("common.imageReadFailed"));
    return uploadImage(image.dataUrl);
}

export async function uploadImage(input: string | Blob): Promise<UploadedImage> {
    if (typeof input === "string") {
        const storageKey = storageKeyFromUrl(input);
        if (storageKey && isCloudStorageKey(storageKey)) return uploadedFromCloudKey(storageKey, input);
    }
    const source = typeof input === "string" ? await fetchSourceBlob(input) : input;
    const blob = await ensureUploadableImageBlob(source);
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
        if (error instanceof StarcloudsApiError && error.code === "unsupported_file") throw new Error(i18n.t("common.unsupportedImage"));
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
    if (isCloudStorageKey(storageKey)) return fallback || starcloudsFileUrl(storageKey);
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (isCloudStorageKey(storageKey)) return fetchCloudFileBlob(storageKey);
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    if (isCloudStorageKey(storageKey)) return starcloudsFileUrl(storageKey);
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
    await store.setItem(storageKey, blob);
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    const localKey = [image.storageKey, image.dataUrl].find((value) => value && isLocalImageKey(value)) || "";
    if (localKey) {
        const blob = await getImageBlob(localKey);
        if (!blob) throw new Error(i18n.t("common.imageReadFailed"));
        return blobToDataUrl(blob);
    }
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await fetchSourceBlob(url));
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

function hasIncompleteCanvasDocuments(value: unknown): boolean {
    if (!value || typeof value !== "object") return false;
    if ("documentPending" in value && value.documentPending) return true;
    if ("documentStale" in value && value.documentStale) return true;
    return Object.values(value).some((item) => (Array.isArray(item) ? item.some(hasIncompleteCanvasDocuments) : hasIncompleteCanvasDocuments(item)));
}

export async function cleanupUnusedImages(usedData: unknown) {
    if (hasIncompleteCanvasDocuments(usedData)) return;
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

function sniffUploadKind(bytes: Uint8Array): "image" | "video" | "" {
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";
    if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image";
    if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
        const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
        if (["isom", "iso2", "iso4", "iso5", "iso6", "mp41", "mp42", "avc1", "av01", "dash", "M4V "].includes(brand)) return "video";
        return "";
    }
    if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return "video";
    return "";
}

async function fetchSourceBlob(src: string) {
    if (isLocalImageKey(src)) {
        const blob = await store.getItem<Blob>(src);
        if (!blob) throw new Error(i18n.t("common.imageReadFailed"));
        return blob;
    }
    const credentials = src.startsWith("blob:") || src.startsWith("data:") ? ("omit" as const) : ("include" as const);
    const response = await fetch(src, { credentials });
    if (!response.ok) throw new Error(i18n.t("common.imageReadFailed"));
    return response.blob();
}

async function transcodeToPng(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, bitmap.width);
    canvas.height = Math.max(1, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) {
        bitmap.close();
        throw new Error(i18n.t("common.imageReadFailed"));
    }
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    canvas.width = 0;
    canvas.height = 0;
    if (!png) throw new Error(i18n.t("common.unsupportedImage"));
    return png;
}

async function ensureUploadableImageBlob(blob: Blob) {
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const kind = sniffUploadKind(bytes);
    if (kind === "image") return blob;
    if (kind === "video") throw new Error(i18n.t("common.unsupportedImage"));
    try {
        return await transcodeToPng(blob);
    } catch {
        throw new Error(i18n.t("common.unsupportedImage"));
    }
}
