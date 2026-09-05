const IMAGE_FILE_NAME = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

type ClipboardFileItem = Pick<DataTransferItem, "kind" | "type" | "getAsFile">;

type ClipboardFileData = {
    files?: ArrayLike<File> | null;
    items?: ArrayLike<ClipboardFileItem> | null;
};

function imageTypeForName(name: string) {
    const extension = name.match(IMAGE_FILE_NAME)?.[1]?.toLowerCase();
    if (!extension) return "";
    if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
    return `image/${extension}`;
}

function normalizedImageType(file: File, hintType = "") {
    const hint = String(hintType).trim().toLowerCase();
    if (hint.startsWith("image/")) return hint;
    const type = String(file.type).trim().toLowerCase();
    if (type.startsWith("image/")) return type;
    return imageTypeForName(file.name);
}

function imageExtension(type: string) {
    if (type.includes("jpeg")) return "jpg";
    if (type.includes("webp")) return "webp";
    if (type.includes("gif")) return "gif";
    if (type.includes("bmp")) return "bmp";
    if (type.includes("avif")) return "avif";
    return "png";
}

function normalizeClipboardImage(file: File, hintType = "") {
    const type = normalizedImageType(file, hintType);
    if (!type) return null;
    const name = String(file.name || "").trim() || `paste-${Date.now()}.${imageExtension(type)}`;
    if (file.type === type && file.name === name) return file;
    return new File([file], name, { type, lastModified: file.lastModified || Date.now() });
}

function isDuplicateAcrossCollections(candidate: File, hintType: string, files: File[]) {
    const candidateType = normalizedImageType(candidate, hintType);
    return files.some((file) => {
        if (file === candidate) return true;
        if (file.size !== candidate.size || file.type !== candidateType) return false;
        return !file.name || !candidate.name || file.name === candidate.name;
    });
}

export function canvasClipboardImages(clipboardData: ClipboardFileData | null | undefined) {
    if (!clipboardData) return [];

    const files = Array.from(clipboardData.files || [])
        .map((file) => normalizeClipboardImage(file))
        .filter((file): file is File => Boolean(file));
    const itemFiles: File[] = [];

    for (const item of Array.from(clipboardData.items || [])) {
        if (item.kind !== "file" || typeof item.getAsFile !== "function") continue;
        const rawFile = item.getAsFile();
        if (!rawFile) continue;
        if (isDuplicateAcrossCollections(rawFile, item.type, files)) continue;
        const file = normalizeClipboardImage(rawFile, item.type);
        if (!file) continue;
        itemFiles.push(file);
    }

    return [...files, ...itemFiles];
}
