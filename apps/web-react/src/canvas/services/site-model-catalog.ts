import { starcloudsRequest } from "@/services/starclouds-api";
import { MODEL_REASONING_EFFORTS, defaultCanvasAgentPricing, type CanvasAgentPricing, type ChannelModel, type ModelChannel, type ModelReasoningEffort, type ModelReasoningPrice } from "@/stores/use-config-store";

type SiteModel = {
    id?: unknown;
    label?: unknown;
    name?: unknown;
    kind?: unknown;
    tool?: unknown;
    default?: unknown;
    pricePoints?: unknown;
    standardPricePoints?: unknown;
    discountPricePoints?: unknown;
    resolutions?: unknown;
    aspectRatios?: unknown;
    aspectRatiosByResolution?: unknown;
    qualities?: unknown;
    transparentBackground?: unknown;
    maxReferenceImages?: unknown;
    maxImages?: unknown;
    supportedReasoningEfforts?: unknown;
    defaultReasoningEffort?: unknown;
    reasoningPrices?: unknown;
    pricing?: {
        points?: unknown;
        standardPoints?: unknown;
        discountPoints?: unknown;
    };
};

type RuntimeConfig = {
    features?: {
        "ai.infiniteCanvas"?: {
            enabled?: unknown;
            config?: {
                imageModels?: SiteModel[];
                textModels?: SiteModel[];
                agentPricing?: {
                    standardMultiplier?: unknown;
                    deepMultiplier?: unknown;
                };
            };
        };
        "ai.imageTools"?: {
            enabled?: unknown;
            config?: {
                backgroundRemovalModels?: SiteImageTool[];
            };
        };
    };
};

export type SiteImageTool = {
    id?: unknown;
    publicModelKey?: unknown;
    label?: unknown;
    name?: unknown;
    tool?: unknown;
    default?: unknown;
    pricePoints?: unknown;
    standardPricePoints?: unknown;
    discountPricePoints?: unknown;
};

export type SiteBackgroundRemovalTool = {
    id: string;
    label: string;
    tool: "background_remove";
    default: boolean;
    pricePoints?: number;
    standardPricePoints?: number;
    discountPricePoints?: number;
};

export type SiteModelCatalog = {
    channel: ModelChannel;
    defaults: Partial<Record<"image" | "text" | "video" | "audio", string>>;
    agentPricing: CanvasAgentPricing;
};

export async function fetchSiteModelCatalog(): Promise<SiteModelCatalog> {
    const runtime = await starcloudsRequest<RuntimeConfig>("/runtime-config");
    const feature = runtime.features?.["ai.infiniteCanvas"];
    const imageModels = feature?.config?.imageModels || [];
    const textModels = feature?.config?.textModels || [];
    const models = [
        ...imageModels.map((model) => mapSiteModel(model, "image")),
        ...textModels.map((model) => mapSiteModel(model, "text")),
    ].filter((item): item is ChannelModel => Boolean(item));
    const defaults: SiteModelCatalog["defaults"] = {};
    for (const model of imageModels) {
        if (model.default === true) defaults.image = String(model.id || "").trim();
    }
    for (const model of textModels) {
        if (model.default === true) defaults.text = String(model.id || model.name || "").trim();
    }
    for (const model of models) {
        if (!defaults[model.capability]) defaults[model.capability] = model.name;
    }
    return {
        channel: {
            id: "starclouds",
            name: "本站模型",
            models,
        },
        defaults,
        agentPricing: {
            standardMultiplier: positiveNumber(feature?.config?.agentPricing?.standardMultiplier) || defaultCanvasAgentPricing.standardMultiplier,
            deepMultiplier: positiveNumber(feature?.config?.agentPricing?.deepMultiplier) || defaultCanvasAgentPricing.deepMultiplier,
        },
    };
}

export async function fetchSiteBackgroundRemovalTools(): Promise<SiteBackgroundRemovalTool[]> {
    const runtime = await starcloudsRequest<RuntimeConfig>("/runtime-config");
    const feature = runtime.features?.["ai.imageTools"];
    if (feature?.enabled === false) return [];
    return (feature?.config?.backgroundRemovalModels || [])
        .map((raw): SiteBackgroundRemovalTool | null => {
            const id = String(raw.id || raw.publicModelKey || "").trim();
            const tool = String(raw.tool || "").trim();
            if (!id || tool !== "background_remove") return null;
            return {
                id,
                label: String(raw.label || raw.name || id).trim(),
                tool: "background_remove",
                default: raw.default === true,
                pricePoints: finiteNumber(raw.pricePoints),
                standardPricePoints: finiteNumber(raw.standardPricePoints),
                discountPricePoints: finiteNumber(raw.discountPricePoints),
            };
        })
        .filter((item): item is SiteBackgroundRemovalTool => Boolean(item));
}

function mapSiteModel(raw: SiteModel, capability: "image" | "text"): ChannelModel | null {
    const name = String(raw.id || raw.name || "").trim();
    if (!name) return null;
    return {
        name,
        label: String(raw.label || raw.name || name).trim(),
        capability,
        pricePoints: finiteNumber(raw.pricing?.points ?? raw.pricePoints),
        standardPricePoints: finiteNumber(raw.pricing?.standardPoints ?? raw.standardPricePoints),
        discountPricePoints: finiteNumber(raw.pricing?.discountPoints ?? raw.discountPricePoints),
        resolutions: stringList(raw.resolutions),
        aspectRatios: stringList(raw.aspectRatios),
        aspectRatiosByResolution: stringListMap(raw.aspectRatiosByResolution),
        qualities: stringList(raw.qualities),
        transparentBackground: raw.transparentBackground !== false,
        maxReferenceImages: finiteNumber(raw.maxReferenceImages),
        maxImages: finiteNumber(raw.maxImages),
        supportedReasoningEfforts: reasoningEffortList(raw.supportedReasoningEfforts),
        defaultReasoningEffort: reasoningEffort(raw.defaultReasoningEffort),
        reasoningPrices: reasoningPriceMap(raw.reasoningPrices),
    };
}

function reasoningEffort(value: unknown): ModelReasoningEffort | undefined {
    const normalized = String(value || "").trim().toLowerCase() as ModelReasoningEffort;
    return MODEL_REASONING_EFFORTS.includes(normalized) ? normalized : undefined;
}

function reasoningEffortList(value: unknown) {
    if (!Array.isArray(value)) return [];
    const efforts = value.map(reasoningEffort).filter((item): item is ModelReasoningEffort => Boolean(item));
    return [...new Set(efforts)];
}

function reasoningPriceMap(value: unknown): Partial<Record<ModelReasoningEffort, ModelReasoningPrice>> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const prices: Partial<Record<ModelReasoningEffort, ModelReasoningPrice>> = {};
    for (const [key, raw] of Object.entries(value)) {
        const effort = reasoningEffort(key);
        if (!effort || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const source = raw as Record<string, unknown>;
        prices[effort] = {
            assistantStandardPricePoints: finiteNumber(source.assistantStandardPricePoints),
            assistantPricePoints: finiteNumber(source.assistantPricePoints ?? source.assistantDiscountPricePoints),
            canvasAgentStandardPricePoints: finiteNumber(source.canvasAgentStandardPricePoints),
            canvasAgentPricePoints: finiteNumber(source.canvasAgentPricePoints ?? source.canvasAgentDiscountPricePoints),
        };
    }
    return Object.keys(prices).length ? prices : undefined;
}

function stringList(value: unknown) {
    return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : undefined;
}

function stringListMap(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? item.map((entry) => String(entry || "").trim()).filter(Boolean) : []]),
    );
}

function finiteNumber(value: unknown) {
    const number = Number(value);
    return value === null || value === undefined || !Number.isFinite(number) ? undefined : Math.max(0, number);
}

function positiveNumber(value: unknown) {
    const number = finiteNumber(value);
    return number && number > 0 ? number : undefined;
}
