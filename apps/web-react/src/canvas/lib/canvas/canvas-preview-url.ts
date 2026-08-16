const FILE_PREFIX = "/api/v1/files/";

export function storageKeyFromUrl(value = "") {
    if (!value) return "";
    if (value.startsWith("uploads/") || value.startsWith("tasks/")) return value;
    const index = value.indexOf(FILE_PREFIX);
    return index >= 0 ? decodeURIComponent(value.slice(index + FILE_PREFIX.length).split(/[?#]/, 1)[0] || "") : "";
}

export function cloudThumbnailKey(storageKeyOrUrl = "") {
    const key = storageKeyFromUrl(storageKeyOrUrl);
    if (!key) return "";
    if (/\/thumb\/[^/]+\.jpe?g$/i.test(key)) return key;
    const upload = key.match(/^(uploads\/[^/]+)\/original\/([^/.]+)\.[^/]+$/);
    if (upload) return `${upload[1]}/thumb/${upload[2]}.jpg`;
    const task = key.match(/^(tasks\/[^/]+\/[^/]+)\/original\/([^/.]+)\.[^/]+$/);
    if (task) return `${task[1]}/thumb/${task[2]}.jpg`;
    return "";
}

export function cloudThumbnailUrl(storageKeyOrUrl = "") {
    const key = cloudThumbnailKey(storageKeyOrUrl);
    return key ? `${FILE_PREFIX}${key}` : "";
}

export function isCloudThumbnailUrl(value = "") {
    return /\/thumb\/[^/]+\.jpe?g(?:[?#]|$)/i.test(storageKeyFromUrl(value) || value);
}

export function isLocalImageKey(value = "") {
    return value.startsWith("image:");
}

export function cloudFileUrl(storageKeyOrUrl = "") {
    const key = storageKeyFromUrl(storageKeyOrUrl);
    return key && !isLocalImageKey(key) ? `${FILE_PREFIX}${key}` : "";
}

export function isHeavyImageSource(value = "") {
    if (!value || isCloudThumbnailUrl(value) || value.startsWith("data:image/svg")) return false;
    if (isLocalImageKey(value) || value.startsWith("blob:") || value.startsWith("data:image/")) return true;
    const key = storageKeyFromUrl(value);
    return /\/original\//.test(key) || key.startsWith("uploads/") || key.startsWith("tasks/") || value.includes("/api/v1/files/");
}

export function isRemoteOriginalSource(value = "") {
    return isHeavyImageSource(value) && !isLocalImageKey(value) && !value.startsWith("blob:") && !value.startsWith("data:");
}

export function canonicalImageSrc(input: { src?: string; storageKey?: string }) {
    const src = input.src || "";
    if (isLocalImageKey(src) || isLocalImageKey(input.storageKey || "")) return input.storageKey || src;
    if (src.startsWith("blob:")) return cloudFileUrl(input.storageKey || "") || input.storageKey || "";
    return src;
}

function uniqueUrls(values: Array<string | undefined>) {
    const seen = new Set<string>();
    return values.filter((value): value is string => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

export function isDisplayPreviewUrl(value = "") {
    return Boolean(value) && (value.startsWith("blob:") || isCloudThumbnailUrl(value)) && !isRemoteOriginalSource(value);
}

export function canvasDisplayCandidates(input: { src?: string; storageKey?: string; thumbnailUrl?: string }) {
    const thumbnail = input.thumbnailUrl && (isDisplayPreviewUrl(input.thumbnailUrl) || !isHeavyImageSource(input.thumbnailUrl)) ? input.thumbnailUrl : "";
    return uniqueUrls([thumbnail, cloudThumbnailUrl(input.storageKey || ""), cloudThumbnailUrl(input.src || "")]);
}

export function isLocalCompressSource(value = "") {
    return isLocalImageKey(value) || value.startsWith("blob:") || (value.startsWith("data:image/") && !value.startsWith("data:image/svg"));
}

export function canvasCompressSource(input: { src?: string; storageKey?: string; thumbnailUrl?: string }) {
    const thumbnail = canvasDisplayCandidates(input)[0] || "";
    if (thumbnail) return thumbnail;
    if (isLocalImageKey(input.storageKey || "")) return input.storageKey || "";
    if (isLocalCompressSource(input.src || "")) return input.src || "";
    return "";
}

export function canvasPreviewCandidates(input: { src?: string; storageKey?: string; thumbnailUrl?: string }) {
    return uniqueUrls([...canvasDisplayCandidates(input), input.src]);
}
