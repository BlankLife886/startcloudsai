import { starcloudsApiUrl, starcloudsJson, starcloudsRequest } from "@/services/starclouds-api";

// Public, read-only links for HTML node pages. The server serves them sandboxed (opaque origin) and out of search.

function absoluteUrl(path: string) {
    const relative = starcloudsApiUrl(path.replace(/^\/api\/v1/, ""));
    return new URL(relative, window.location.origin).href;
}

export async function publishHtmlShare(input: { html: string; title: string; shareId?: string }) {
    const result = await starcloudsJson<{ id: string; path: string }>("/canvas/html-shares", "POST", input);
    return { id: result.id, url: absoluteUrl(result.path) };
}

export async function revokeHtmlShare(shareId: string) {
    await starcloudsRequest<void>(`/canvas/html-shares/${encodeURIComponent(shareId)}`, { method: "DELETE" });
}
