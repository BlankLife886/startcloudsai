import { storageKeyFromUrl } from "./canvas-preview-url.ts";

/**
 * The storyboard plan stores references as strings so it can survive a
 * project round-trip. Keep the classification in one place before turning a
 * persisted value back into a ReferenceImage: local keys need IndexedDB
 * lookup, cloud keys need a file URL, while data/blob/external URLs must be
 * passed through unchanged.
 */
export type StoryboardReferenceDescriptor = {
    source: string;
    storageKey?: string;
    fallback: string;
};

const KNOWN_STORAGE_KEY = /^(?:image:|uploads\/|tasks\/|canvas-template-assets\/)/i;

function isKnownStorageKey(value: string) {
    return KNOWN_STORAGE_KEY.test(value);
}

/**
 * Describe a persisted storyboard reference without performing I/O.
 *
 * `storageKeyFromUrl` intentionally accepts any path below `/api/v1/files/`.
 * Only the storage namespaces understood by image-storage should be promoted
 * to `storageKey`; an unrelated URL containing that marker must remain a URL
 * so a retry does not attempt to fetch a relative local-forage key.
 */
export function describeStoryboardReference(value = ""): StoryboardReferenceDescriptor | null {
    const source = String(value || "").trim();
    if (!source) return null;
    let parsedKey = "";
    try {
        parsedKey = storageKeyFromUrl(source);
    } catch {
        // A malformed percent escape in an old persisted URL must not prevent
        // the rest of the storyboard from reopening. Keep the original value
        // as a URL fallback and let the request layer report any real failure.
    }
    const storageKey = isKnownStorageKey(parsedKey) ? parsedKey : isKnownStorageKey(source) ? source : undefined;
    if (!storageKey) return { source, fallback: source };

    // Local image keys have no URL fallback: an absent IndexedDB record should
    // fail closed so the caller can show "reference missing" instead of
    // submitting a request with an unusable key.
    if (storageKey.startsWith("image:")) return { source, storageKey, fallback: "" };

    // For a full cloud URL, preserve that URL as a fallback. For a bare key,
    // resolveImageUrl will construct the authenticated `/files/...` URL.
    return { source, storageKey, fallback: source === storageKey ? "" : source };
}
