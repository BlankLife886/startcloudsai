export class StarcloudsApiError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status: number) {
        super(message);
        this.name = "StarcloudsApiError";
        this.code = code;
        this.status = status;
    }
}

type ApiEnvelope<T> = { success: true; data: T } | { success: false; code?: string; error?: string };

const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");

export function starcloudsApiUrl(path: string) {
    return `${API_BASE_URL}/api/v1${path.startsWith("/") ? path : `/${path}`}`;
}

const apiUrl = starcloudsApiUrl;

function isAbortError(error: unknown) {
    return (error instanceof DOMException && error.name === "AbortError") || (error instanceof Error && error.name === "AbortError");
}

export function starcloudsFileUrl(storageKey: string) {
    return starcloudsApiUrl(`/files/${storageKey}`);
}

export async function fetchCloudFileBlob(storageKey: string, init: RequestInit = {}) {
    const response = await fetch(starcloudsFileUrl(storageKey), { ...init, credentials: "include" });
    if (!response.ok) throw new StarcloudsApiError(`http_${response.status}`, "无法读取文件", response.status);
    return response.blob();
}

export async function starcloudsRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
        response = await fetch(apiUrl(path), { ...init, credentials: "include" });
    } catch (error) {
        if (init.signal?.aborted || isAbortError(error)) throw isAbortError(error) ? error : new DOMException("Aborted", "AbortError");
        throw new StarcloudsApiError("network_error", "无法连接到服务器", 0);
    }

    if (response.status === 204) return undefined as T;

    let envelope: ApiEnvelope<T> | null = null;
    try {
        envelope = (await response.json()) as ApiEnvelope<T>;
    } catch {
        // Gateways may return HTML for transient failures.
    }

    if (response.ok && envelope?.success === true) return envelope.data;

    const code = envelope?.success === false && envelope.code ? envelope.code : `http_${response.status}`;
    const message = envelope?.success === false && envelope.error ? envelope.error : "请求失败，请稍后重试";
    throw new StarcloudsApiError(code, message, response.status);
}

export function starcloudsJson<T>(path: string, method: "POST" | "PATCH", body: unknown) {
    return starcloudsRequest<T>(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export type UploadedCloudFile = {
    key: string;
    url: string;
    thumbnailKey?: string;
    thumbnailUrl?: string;
    contentType: string;
    sizeBytes: number;
};

export async function uploadCloudFile(blob: Blob, filename: string): Promise<UploadedCloudFile> {
    const form = new FormData();
    form.append("file", blob, filename);
    return starcloudsRequest<UploadedCloudFile>("/uploads", { method: "POST", body: form });
}
