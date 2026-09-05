import { serializeApiParams } from "./request";
import { starcloudsRequest } from "@/services/starclouds-api";

export type Prompt = {
    id: string;
    title: string;
    prompt: string;
    description: string;
    preview: string;
    tags: string[];
    coverUrl: string;
    referenceImageUrls: string[];
    createdAt: string;
    updatedAt: string;
    sourceId: "starclouds";
    category: string;
    githubUrl: string;
    taskType: string;
};

export const ALL_PROMPTS_OPTION = "全部";

export type PromptCategoryOption = {
    value: string;
    label: string;
};

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
    nextCursor?: string;
};

type SitePrompt = {
    id?: unknown;
    title?: unknown;
    prompt?: unknown;
    taskType?: unknown;
    category?: unknown;
    tags?: unknown;
    coverUrl?: unknown;
};

type SitePromptPage = {
    items?: SitePrompt[];
    nextCursor?: unknown;
    categoryCounts?: Record<string, unknown>;
    tags?: unknown;
    total?: unknown;
};

type SitePromptCategory = {
    key?: unknown;
    label?: unknown;
};

type SitePromptCategoriesResponse = {
    items?: SitePromptCategory[];
};

function mapPrompt(raw: SitePrompt): Prompt {
    const coverUrl = typeof raw.coverUrl === "string" ? raw.coverUrl : "";
    return {
        id: String(raw.id || ""),
        title: String(raw.title || "").trim(),
        prompt: String(raw.prompt || "").trim(),
        description: "",
        preview: "",
        tags: Array.isArray(raw.tags) ? raw.tags.map(String).filter(Boolean) : [],
        coverUrl,
        referenceImageUrls: coverUrl ? [coverUrl] : [],
        createdAt: "",
        updatedAt: "",
        sourceId: "starclouds",
        category: String(raw.category || "").trim() || "其他",
        githubUrl: "",
        taskType: String(raw.taskType || ""),
    };
}

export async function fetchPrompts({
    keyword = "",
    tag = [],
    category = ALL_PROMPTS_OPTION,
    type = "infinite_canvas",
    cursor = "",
    page: _page = 1,
    pageSize = 20,
}: {
    keyword?: string;
    tag?: string[];
    category?: string;
    type?: string;
    cursor?: string;
    page?: number;
    pageSize?: number;
} = {}): Promise<PromptListResponse> {
    void _page;
    const query = serializeApiParams({
        type: type || undefined,
        search: keyword.trim() || undefined,
        tag,
        category: isActiveOption(category) ? category : undefined,
        cursor: cursor || undefined,
        limit: Math.max(1, Math.min(100, pageSize)),
        sort: "recommended",
    });
    const data = await starcloudsRequest<SitePromptPage>(`/prompts?${query.toString()}`);
    const categories = Object.keys(data.categoryCounts || {}).filter((item) => item && item !== "all");
    return {
        items: (Array.isArray(data.items) ? data.items : []).map(mapPrompt).filter((item) => item.id && item.prompt),
        tags: Array.isArray(data.tags) ? data.tags.map(String).filter(Boolean) : [],
        categories,
        total: Math.max(0, Number(data.total) || 0),
        nextCursor: data.nextCursor ? String(data.nextCursor) : undefined,
    };
}

export async function fetchPromptCategories(type = ""): Promise<PromptCategoryOption[]> {
    const query = serializeApiParams({ type: type || undefined });
    const data = await starcloudsRequest<SitePromptCategoriesResponse>(`/prompts/categories?${query.toString()}`);
    return (Array.isArray(data.items) ? data.items : [])
        .map((item) => ({ value: String(item.key || "").trim(), label: String(item.label || "").trim() }))
        .filter((item) => item.value && item.label && !["all", "today", "latest", "favorites", "my-favorites"].includes(item.value));
}

function isActiveOption(value: string) {
    return Boolean(value && value !== ALL_PROMPTS_OPTION && value !== "all");
}

export function formatPromptDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
