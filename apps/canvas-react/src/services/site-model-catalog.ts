import { starcloudsRequest } from "@/services/starclouds-api";
import type { ChannelModel, ModelChannel } from "@/stores/use-config-store";

type SiteModel = {
    id?: unknown;
    label?: unknown;
    name?: unknown;
    kind?: unknown;
    tool?: unknown;
    default?: unknown;
    pricing?: {
        points?: unknown;
        standardPoints?: unknown;
        discountPoints?: unknown;
    };
};

type RuntimeConfig = {
    aiModelCatalog?: {
        models?: SiteModel[];
    };
    features?: {
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
};

export async function fetchSiteModelCatalog(): Promise<SiteModelCatalog> {
    const runtime = await starcloudsRequest<RuntimeConfig>("/runtime-config");
    const models = (runtime.aiModelCatalog?.models || []).map(mapSiteModel).filter((item): item is ChannelModel => Boolean(item));
    const defaults: SiteModelCatalog["defaults"] = {};
    for (const raw of runtime.aiModelCatalog?.models || []) {
        const model = mapSiteModel(raw);
        if (model && raw.default === true && !defaults[model.capability]) defaults[model.capability] = model.name;
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

function mapSiteModel(raw: SiteModel): ChannelModel | null {
    const name = String(raw.id || "").trim();
    const kind = String(raw.kind || "").trim();
    if (!name || (kind !== "image" && kind !== "chat")) return null;
    return {
        name,
        label: String(raw.label || raw.name || name).trim(),
        capability: kind === "image" ? "image" : "text",
        pricePoints: finiteNumber(raw.pricing?.points),
        standardPricePoints: finiteNumber(raw.pricing?.standardPoints),
        discountPricePoints: finiteNumber(raw.pricing?.discountPoints),
    };
}

function finiteNumber(value: unknown) {
    const number = Number(value);
    return value === null || value === undefined || !Number.isFinite(number) ? undefined : Math.max(0, number);
}
