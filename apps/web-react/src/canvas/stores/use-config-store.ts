import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

export type ChannelModel = {
    name: string;
    label?: string;
    pricePoints?: number;
    standardPricePoints?: number;
    discountPricePoints?: number;
    capability: ModelCapability;
    resolutions?: string[];
    aspectRatios?: string[];
    aspectRatiosByResolution?: Record<string, string[]>;
    qualities?: string[];
    transparentBackground?: boolean;
    maxReferenceImages?: number;
};

export type ModelChannel = {
    id: string;
    name: string;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote";
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    resolution: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";

export const defaultConfig: AiConfig = {
    channelMode: "remote",
    channels: [],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "medium",
    size: "1:1",
    resolution: "1K",
    background: "",
    count: "1",
    canvasImageCount: "1",
};

type ConfigStore = {
    config: AiConfig;
    isConfigOpen: boolean;
    shouldPromptContinue: boolean;
    installSiteCatalog: (channel: ModelChannel, defaults: Partial<Record<ModelCapability, string>>) => void;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

export function migrateConfigStore(persisted: unknown, persistedVersion: number) {
    const saved = (persisted || {}) as Partial<Pick<ConfigStore, "config">>;
    return {
        config: {
            ...defaultConfig,
            ...(saved.config || {}),
            ...(persistedVersion < 2 ? { canvasImageCount: "1" } : {}),
        },
    };
}

function findChannelModel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return config.channels.flatMap((channel) => channel.models).find((model) => model.name === value);
    return config.channels.find((channel) => channel.id === decoded.channelId)?.models.find((model) => model.name === decoded.model);
}

export function modelOptionMeta(config: AiConfig, value: string) {
    return findChannelModel(config, value);
}

export function formatModelPrice(model: ChannelModel | undefined) {
    return model?.pricePoints === undefined ? "价格未配置" : `${model.pricePoints} 积分${model.capability === "image" ? "/张" : ""}`;
}

export function formatModelDiscount(model: ChannelModel | undefined) {
    const price = model?.pricePoints;
    const standard = model?.standardPricePoints;
    if (price === undefined || standard === undefined || standard <= 0 || price >= standard) return "";
    return `${Number(((price / standard) * 10).toFixed(1))} 折`;
}

function modelMatchesCapability(config: AiConfig, value: string, capability: ModelCapability) {
    return findChannelModel(config, value)?.capability === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const preferred = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (preferred && modelMatchesCapability(config, preferred, capability)) return preferred;
    return selectableModelsByCapability(config, capability)[0] || "";
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set) => ({
            config: defaultConfig,
            isConfigOpen: false,
            shouldPromptContinue: false,
            installSiteCatalog: (channel, defaults) =>
                set((state) => {
                    const channels = [channel];
                    const value = (capability: ModelCapability) => (defaults[capability] ? encodeChannelModel(channel.id, defaults[capability]!) : "");
                    const imageModel = value("image");
                    const textModel = value("text");
                    return {
                        config: {
                            ...state.config,
                            channelMode: "remote",
                            channels,
                            models: modelOptionsFromChannels(channels),
                            imageModel,
                            textModel,
                            videoModel: value("video"),
                            audioModel: value("audio"),
                            model: imageModel || textModel,
                        },
                    };
                }),
            updateConfig: (key, value) => set((state) => ({ config: { ...state.config, [key]: value } })),
            isAiConfigReady: (config, model) => Boolean(model.trim() && findChannelModel(config, model)),
            openConfigDialog: (shouldPromptContinue = false) => set({ isConfigOpen: true, shouldPromptContinue }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: 2,
            partialize: (state): Pick<ConfigStore, "config"> => ({
                config: { ...state.config, channels: [], models: [], model: "", imageModel: "", videoModel: "", textModel: "", audioModel: "" },
            }),
            migrate: migrateConfigStore,
            merge: (persisted, current) => {
                const saved = (persisted || {}) as Partial<ConfigStore>;
                return {
                    ...current,
                    config: {
                        ...defaultConfig,
                        ...(saved.config || {}),
                        channelMode: "remote",
                        channels: [],
                        models: [],
                        model: "",
                        imageModel: "",
                        videoModel: "",
                        textModel: "",
                        audioModel: "",
                    },
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => {
        const imageModel = resolveModelForCapability(config, config.imageModel, "image");
        const videoModel = resolveModelForCapability(config, config.videoModel, "video");
        const textModel = resolveModelForCapability(config, config.textModel, "text");
        const audioModel = resolveModelForCapability(config, config.audioModel, "audio");
        return { ...config, imageModel, videoModel, textModel, audioModel, model: config.model || imageModel || textModel };
    }, [config]);
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === value));
    const name = decoded?.model || value;
    return channel?.models.find((model) => model.name === name)?.label || name;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return Array.from(new Set(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name)))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) return channels.some((channel) => channel.id === decoded.channelId && channel.models.some((item) => item.name === decoded.model)) ? model : "";
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model));
    return channel ? encodeChannelModel(channel.id, model) : "";
}
