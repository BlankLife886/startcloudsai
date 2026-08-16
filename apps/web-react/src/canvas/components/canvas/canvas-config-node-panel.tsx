import { ChevronDown, ChevronRight, Cpu, Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Square, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { TextSettingsPanel } from "@/components/text-settings-panel";
import { videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
import { isCanvasGenerationModeEnabled } from "@/constant/canvas";
import { estimateCanvasGenerationCost } from "@/lib/canvas/canvas-generation-cost";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import { useCanvasBackgroundRemovalTool } from "@/lib/canvas/canvas-background-removal-tool";
import { applyCanvasImageModelSettings, canvasImageSettingsFromModel } from "@/lib/canvas/canvas-image-model";
import { defaultConfig, formatModelDiscount, formatModelPrice, modelOptionLabel, modelOptionMeta, modelOptionName, resolveModelForCapability, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasFieldMenu } from "./canvas-field-menu";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
};

const MODES: Array<{ value: CanvasGenerationMode; icon: typeof ImageIcon; colorKey: string; labelKey: "image" | "text" | "video" | "audio" }> = [
    { value: "image", icon: ImageIcon, colorKey: "image", labelKey: "image" },
    { value: "text", icon: MessageSquare, colorKey: "text", labelKey: "text" },
    { value: "video", icon: Video, colorKey: "video", labelKey: "video" },
    { value: "audio", icon: Music2, colorKey: "audio", labelKey: "audio" },
];

const FIELD_CLASS = "flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[14px] px-3 text-left text-[13px] transition-colors";

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStop, onComposerToggle }: CanvasConfigNodePanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const requestedMode = node.metadata?.generationMode || "image";
    const mode = isCanvasGenerationModeEnabled(requestedMode) ? requestedMode : "image";
    const modeIndex = Math.max(0, MODES.findIndex((item) => item.value === mode));
    const color = nodeTypeColor(mode);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);
    const stats = inputStats(mode, inputSummary, t);
    const fieldStyle = { background: theme.toolbar.itemHover, color: theme.node.text };
    const backgroundRemovalTool = useCanvasBackgroundRemovalTool();
    const cost = estimateCanvasGenerationCost({ config, kind: mode === "text" ? "text" : "image", backgroundRemovalPricePoints: backgroundRemovalTool?.pricePoints });
    const generateLabel = cost.total > 0 ? t("canvas.configNode.generateWithCost", { count: cost.total.toLocaleString() }) : t("canvas.configNode.generate");

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3.5 py-3" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="relative grid h-10 shrink-0 grid-cols-4 rounded-[14px] p-[3px]" style={{ background: theme.toolbar.itemHover }}>
                <div
                    className="pointer-events-none absolute inset-y-[3px] rounded-[11px] transition-[left] duration-200 ease-out"
                    style={{
                        left: `calc(3px + ${modeIndex} * (100% - 6px) / 4)`,
                        width: "calc((100% - 6px) / 4)",
                        background: theme.node.panel,
                        boxShadow: "0 1px 4px rgba(42, 37, 64, 0.08)",
                    }}
                />
                {MODES.map((item) => {
                    const active = mode === item.value;
                    const enabled = isCanvasGenerationModeEnabled(item.value);
                    const Icon = item.icon;
                    const itemColor = nodeTypeColor(item.colorKey);
                    return (
                        <button
                            key={item.value}
                            type="button"
                            disabled={!enabled}
                            title={enabled ? undefined : t("canvas.unavailable")}
                            className="relative z-[1] flex items-center justify-center gap-1 rounded-[11px] text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35"
                            style={{ color: active ? itemColor : theme.node.muted }}
                            onClick={() => enabled && onConfigChange(node.id, { generationMode: item.value })}
                        >
                            <Icon className="size-3.5 shrink-0" />
                            <span className="truncate">{t(`canvas.configNode.${item.labelKey}`)}</span>
                        </button>
                    );
                })}
            </div>

            <div className="mt-2.5 flex min-w-0 shrink-0 flex-col gap-2.5">
                <ConfigModelField
                    config={config}
                    mode={mode}
                    theme={theme}
                    surface={fieldStyle.background}
                    placeholder={t("canvas.configNode.model")}
                    onChange={(model) => onConfigChange(node.id, canvasImageSettingsFromModel(config, model))}
                    onMissingConfig={() => openConfigDialog(true)}
                />
                {mode === "image" ? (
                    <ImageSettingsPanel
                        config={config}
                        theme={theme}
                        showTitle={false}
                        embedded
                        onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                    />
                ) : mode === "text" ? (
                    <TextSettingsPanel
                        config={config}
                        theme={theme}
                        embedded
                        onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })}
                    />
                ) : (
                    <SettingsField mode={mode} config={config} nodeId={node.id} color={color} fieldStyle={fieldStyle} onConfigChange={onConfigChange} />
                )}
            </div>

            <div className="mt-auto flex min-w-0 shrink-0 items-center gap-2 pt-2.5">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {stats.length ? (
                        stats.map((item) => (
                            <span
                                key={item.label}
                                className="inline-flex h-7 max-w-full items-center gap-1 rounded-full px-2.5 text-[12px]"
                                style={{
                                    background: item.value > 0 ? colorWash(item.color, 0.14) : theme.toolbar.itemHover,
                                    color: item.value > 0 ? item.color : theme.node.muted,
                                }}
                            >
                                <span className="font-semibold tabular-nums">{item.value}</span>
                                <span className="truncate">{item.label}</span>
                            </span>
                        ))
                    ) : (
                        <span className="text-[12px]" style={{ color: theme.node.muted }}>
                            {t("canvas.configNode.emptyInputs")}
                        </span>
                    )}
                </div>
                <button
                    type="button"
                    className="inline-flex h-7 shrink-0 items-center gap-0.5 text-[12px] font-medium"
                    style={{ color: hasComposerContent ? color : theme.toolbar.activeText }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={onComposerToggle}
                >
                    {t(hasComposerContent ? "canvas.configNode.composed" : "canvas.configNode.compose")}
                    <ChevronRight className="size-3.5 opacity-70" />
                </button>
            </div>

            <button
                type="button"
                className="mt-3 inline-flex h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[14px] text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: isRunning ? "#ef4444" : color, color: "#fff" }}
                disabled={!isRunning && !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => (isRunning ? onStop(node.id) : onGenerate(node.id))}
            >
                {isRunning ? (
                    <>
                        <LoaderCircle className="size-4 animate-spin" />
                        <Square className="size-3.5 fill-current" />
                        {t("canvas.configNode.stop")}
                    </>
                ) : (
                    <>
                        <Play className="size-4 fill-current" />
                        {generateLabel}
                    </>
                )}
            </button>
        </div>
    );
}

function ConfigModelField({
    config,
    mode,
    theme,
    surface,
    placeholder,
    onChange,
    onMissingConfig,
}: {
    config: AiConfig;
    mode: CanvasGenerationMode;
    theme: CanvasTheme;
    surface: string;
    placeholder: string;
    onChange: (model: string) => void;
    onMissingConfig: () => void;
}) {
    const options = selectableModelsByCapability(config, mode);
    const current = config.model || "";
    const meta = current ? modelOptionMeta(config, current) : undefined;
    const price = current ? [formatModelPrice(meta), formatModelDiscount(meta)].filter(Boolean).join(" · ") : "";
    const accent = nodeTypeColor(mode);

    if (!options.length) {
        return (
            <button type="button" className="flex h-10 w-full min-w-0 items-center gap-2.5 rounded-xl px-3 text-left" style={{ background: surface, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onMissingConfig}>
                <Cpu className="size-4 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{placeholder}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-35" />
            </button>
        );
    }

    return (
        <CanvasFieldMenu
            value={current}
            options={options.map((model) => ({
                value: model,
                label: (
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                        <ModelMark model={model} />
                        <span className="min-w-0 flex-1 truncate">{modelOptionLabel(config, model)}</span>
                        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                            {formatModelPrice(modelOptionMeta(config, model))}
                        </span>
                    </span>
                ),
            }))}
            theme={theme}
            surface={surface}
            emptyLabel={placeholder}
            onChange={onChange}
        >
            {(open) => (
                <span className="flex w-full min-w-0 items-center gap-2.5">
                    <ModelMark model={current} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{current ? modelOptionLabel(config, current) : placeholder}</span>
                    {price ? (
                        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: colorWash(accent, 0.12), color: accent }}>
                            {price}
                        </span>
                    ) : null}
                    <ChevronDown className="size-3.5 shrink-0 opacity-35 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "none" }} />
                </span>
            )}
        </CanvasFieldMenu>
    );
}

function ModelMark({ model }: { model: string }) {
    const icon = modelIcon(modelOptionName(model));
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-50" />;
}

function modelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    return "";
}

function SettingsField({
    mode,
    config,
    nodeId,
    color,
    fieldStyle,
    onConfigChange,
}: {
    mode: CanvasGenerationMode;
    config: AiConfig;
    nodeId: string;
    color: string;
    fieldStyle: { background: string; color: string };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
}) {
    const trigger = (
        <span className={FIELD_CLASS} style={fieldStyle}>
            <span className="flex size-6 shrink-0 items-center justify-center rounded-lg" style={{ background: colorWash(color, 0.16), color }}>
                <Settings2 className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate">{settingsSummary(mode, config)}</span>
        </span>
    );
    const shared = { config, placement: "topRight" as const, fullWidth: true, buttonClassName: "w-full min-w-0 rounded-[14px] border-0 bg-transparent p-0 text-left text-inherit" };

    if (mode === "video") {
        return (
            <CanvasVideoSettingsPopover {...shared} onConfigChange={(key, value) => onConfigChange(nodeId, videoConfigPatch(key, value))}>
                {trigger}
            </CanvasVideoSettingsPopover>
        );
    }
    return (
        <CanvasAudioSettingsPopover {...shared} onConfigChange={(key, value) => onConfigChange(nodeId, audioConfigPatch(key, value))}>
            {trigger}
        </CanvasAudioSettingsPopover>
    );
}

function inputStats(mode: CanvasGenerationMode, inputSummary: CanvasConfigNodePanelProps["inputSummary"], t: (key: string) => string) {
    if (mode === "text") {
        return [{ label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text") }];
    }
    if (mode === "video") {
        return [
            { label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text") },
            { label: t("canvas.configNode.references"), value: inputSummary.imageCount, color: nodeTypeColor("image") },
            { label: t("canvas.configNode.videoReferences"), value: inputSummary.videoCount, color: nodeTypeColor("video") },
        ];
    }
    if (mode === "audio") {
        return [
            { label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text") },
            { label: t("canvas.configNode.audioReferences"), value: inputSummary.audioCount, color: nodeTypeColor("audio") },
        ];
    }
    return [
        { label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text") },
        { label: t("canvas.configNode.references"), value: inputSummary.imageCount, color: nodeTypeColor("image") },
    ];
}

function settingsSummary(mode: CanvasGenerationMode, config: AiConfig) {
    if (mode === "video") {
        return `${videoResolutionLabel(config.vquality)} · ${videoSizeLabel(config.size)} · ${videoSecondsLabel(config.videoSeconds)}`;
    }
    return `${audioVoiceLabel(config.audioVoice)} · ${audioFormatLabel(config.audioFormat)} · ${audioSpeedLabel(config.audioSpeed)}`;
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): AiConfig {
    const next = {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        resolution: node.metadata?.resolution || globalConfig.resolution || defaultConfig.resolution,
        background: node.metadata?.background ?? "",
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
    return mode === "image" ? applyCanvasImageModelSettings(next, modelOptionMeta(next, next.model)) : next;
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}
