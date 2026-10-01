function apiBaseUrl() {
    try {
        return String((import.meta as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || "").replace(/\/$/, "");
    } catch {
        return "";
    }
}

function fileUrl(key: string) {
    return `${apiBaseUrl()}/api/v1/files/${key}`;
}

const FILE_MARKER = "/api/v1/files/";

function assistantVariantKey(key: string, variant: "thumb" | "display") {
    const match = key.match(/^(tasks\/[^/]+\/assistant\/[^/]+)\/([^/]+)$/i);
    if (!match) return "";
    const baseName = match[2]
        .replace(/-(?:thumb|display)$/i, "")
        .replace(/\.[^/.]+$/, "");
    return baseName ? `${match[1]}/${baseName}-${variant}` : "";
}

export function softMissingFileUrl(value = "") {
    if (!value || !value.includes(FILE_MARKER) || /(?:^|[?&])soft_missing=/.test(value)) return value;
    const hashIndex = value.indexOf("#");
    const base = hashIndex >= 0 ? value.slice(0, hashIndex) : value;
    const hash = hashIndex >= 0 ? value.slice(hashIndex) : "";
    return `${base}${base.includes("?") ? "&" : "?"}soft_missing=1${hash}`;
}

export function storageKeyFromUrl(value = "") {
    if (!value) return "";
    if (value.startsWith("uploads/") || value.startsWith("tasks/") || value.startsWith("canvas-template-assets/")) return value;
    const index = value.indexOf(FILE_MARKER);
    return index >= 0 ? decodeURIComponent(value.slice(index + FILE_MARKER.length).split(/[?#]/, 1)[0] || "") : "";
}

export function cloudThumbnailKey(storageKeyOrUrl = "") {
    const key = storageKeyFromUrl(storageKeyOrUrl);
    if (!key) return "";
    // 已是小图 key：新式不带扩展名，旧数据为 .jpg，都原样返回。
    if (/\/thumb\/[^/]+$/i.test(key)) return key;
    const assistant = assistantVariantKey(key, "thumb");
    if (assistant) return assistant;
    // 新式小图 key 不带扩展名（格式可在后台切换，内容类型由对象元数据决定）。
    const upload = key.match(/^(uploads\/[^/]+)\/original\/(.+)\.([^/.]+)$/);
    if (upload) return `${upload[1]}/thumb/${upload[2]}`;
    const task = key.match(/^(tasks\/[^/]+\/[^/]+)\/original\/(.+)\.([^/.]+)$/);
    if (task) return `${task[1]}/thumb/${task[2]}`;
    return "";
}

export function cloudThumbnailUrl(storageKeyOrUrl = "") {
    const key = cloudThumbnailKey(storageKeyOrUrl);
    return key ? fileUrl(key) : "";
}

/** 展示图（服务端压缩大图）key：由原图 key 推导，与后端约定一致。 */
export function cloudDisplayKey(storageKeyOrUrl = "") {
    const key = storageKeyFromUrl(storageKeyOrUrl);
    if (!key) return "";
    if (/\/display\/[^/]+$/i.test(key)) return key;
    const assistant = assistantVariantKey(key, "display");
    if (assistant) return assistant;
    const upload = key.match(/^(uploads\/[^/]+)\/original\/(.+)\.([^/.]+)$/);
    if (upload) return `${upload[1]}/display/${upload[2]}`;
    const task = key.match(/^(tasks\/[^/]+\/[^/]+)\/original\/(.+)\.([^/.]+)$/);
    if (task) return `${task[1]}/display/${task[2]}`;
    return "";
}

export function cloudDisplayUrl(storageKeyOrUrl = "") {
    const key = cloudDisplayKey(storageKeyOrUrl);
    return key ? fileUrl(key) : "";
}

export function isCloudThumbnailUrl(value = "") {
    return /(?:\/thumb\/[^/]+|\/assistant\/[^/]+\/[^/]+-thumb)$/i.test(storageKeyFromUrl(value) || value);
}

export function isLocalImageKey(value = "") {
    return value.startsWith("image:");
}

export function cloudFileUrl(storageKeyOrUrl = "") {
    const key = storageKeyFromUrl(storageKeyOrUrl);
    return key && !isLocalImageKey(key) ? fileUrl(key) : "";
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
    const thumbnailKey = storageKeyFromUrl(input.thumbnailUrl || "");
    const originalKey = storageKeyFromUrl(input.storageKey || input.src || "");
    const explicitThumbnail = Boolean(input.thumbnailUrl && thumbnailKey && thumbnailKey !== originalKey);
    const thumbnail = input.thumbnailUrl && (explicitThumbnail || isDisplayPreviewUrl(input.thumbnailUrl) || !isHeavyImageSource(input.thumbnailUrl)) ? input.thumbnailUrl : "";
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
