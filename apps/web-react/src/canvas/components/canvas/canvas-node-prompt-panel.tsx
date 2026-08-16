import { useEffect, useState, type ReactNode } from "react";
import { ArrowUp, ChevronDown, Cpu, Expand, LoaderCircle, PenLine, Shrink, Settings2 } from "lucide-react";
import { Modal, Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { isCanvasGenerationModeEnabled } from "@/constant/canvas";
import { reasoningEffortLabel } from "@/components/text-settings-panel";
import { applyCanvasImageModelSettings, canvasImageSettingsFromModel } from "@/lib/canvas/canvas-image-model";
import { defaultConfig, formatModelPrice, modelOptionLabel, modelOptionMeta, modelOptionName, resolveModelForCapability, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasIconWellStyle, nodeTypeColor } from "@/lib/canvas-ui";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasPromptLibrary } from "./canvas-prompt-library";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasFieldMenu } from "./canvas-field-menu";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasPromptChipInput } from "./canvas-prompt-chip-input";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";

export type CanvasNodeGenerationMode = CanvasGenerationMode;

type CanvasNodePromptPanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    onPromptChange: (nodeId: string, prompt: string) => void;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onGenerate: (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string) => void;
    onStop: (nodeId: string) => void;
    mentionReferences?: CanvasResourceReference[];
    modeOverride?: CanvasNodeGenerationMode; // Plugin nodes set their generation type through useBuiltinPanel.mode.
};

export function CanvasNodePromptPanel({ node, isRunning, onPromptChange, onConfigChange, onGenerate, onStop, mentionReferences = [], modeOverride }: CanvasNodePromptPanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = modeOverride ?? defaultMode(node.type);
    const mediaLocked = !isCanvasGenerationModeEnabled(mode);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasTextContent = node.type === CanvasNodeType.Text && Boolean(node.metadata?.content?.trim());
    const hasImageContent = node.type === CanvasNodeType.Image && Boolean(node.metadata?.content);
    const isEditingExistingContent = hasTextContent || hasImageContent;
    const [prompt, setPrompt] = useState(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
    const [expanded, setExpanded] = useState(false);

    // Restore prompts only when switching nodes; preserve the current input after generation on the same node.
    useEffect(() => {
        setPrompt(node.metadata?.composerContent ?? node.metadata?.prompt ?? "");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node.id]);

    const updatePrompt = (value: string) => {
        setPrompt(value);
        if (isEditingExistingContent) onConfigChange(node.id, { composerContent: value });
        else onPromptChange(node.id, value);
    };

    const submit = () => {
        const text = prompt.trim();
        if (!text || isRunning || mediaLocked) return;
        onGenerate(node.id, mode, text);
    };

    const openExpandedEditor = () => {
        setExpanded(true);
    };

    return (
        <div
            data-canvas-no-zoom
            className="canvas-float-menu canvas-prompt-dock rounded-[22px] border p-3 backdrop-blur-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <CanvasPromptChipInput
                value={prompt}
                references={mentionReferences}
                onChange={updatePrompt}
                onSubmit={submit}
                className={`thin-scrollbar w-full cursor-text resize-none rounded-[16px] px-3 py-2 text-sm leading-5 outline-none ${mode === "image" ? "h-28" : "h-40"}`}
                style={{ background: "transparent", color: theme.node.text }}
                placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
            />

            <div className="mt-2 flex min-w-0 items-center gap-1.5">
                <PromptComposerTools
                    config={config}
                    mode={mode}
                    theme={theme}
                    surface={theme.toolbar.itemHover}
                    onConfigChange={onConfigChange}
                    nodeId={node.id}
                    onMissingConfig={() => openConfigDialog(true)}
                />
                <Tooltip title={t("canvas.promptPanel.expandEditor")}>
                    <button type="button" className="grid size-8 shrink-0 place-items-center rounded-full" style={{ color: theme.node.muted }} onClick={openExpandedEditor} aria-label={t("canvas.promptPanel.expandEditor")}>
                        <Expand className="size-3.5" />
                    </button>
                </Tooltip>
                <CanvasPromptLibrary onSelect={updatePrompt} />
                <PromptSendButton isRunning={isRunning} mode={mode} disabled={!isRunning && (mediaLocked || !prompt.trim())} locked={mediaLocked} onClick={() => (isRunning ? onStop(node.id) : submit())} />
            </div>
            <Modal className="canvas-prompt-editor-modal" title={null} open={expanded} centered width={720} footer={null} onCancel={() => setExpanded(false)} destroyOnHidden>
                <div data-canvas-no-zoom data-canvas-shortcuts-ignore onWheelCapture={(event) => event.stopPropagation()}>
                    <div className="mb-4 flex items-center gap-3 pr-10">
                        <span className="grid size-10 shrink-0 place-items-center rounded-[12px]" style={CanvasIconWellStyle("#6d5cff")}>
                            <PenLine className="size-4" />
                        </span>
                        <div className="min-w-0 text-[16px] font-semibold tracking-[-0.02em]" style={{ color: theme.node.text }}>
                            {t("canvas.promptPanel.editorTitle")}
                        </div>
                    </div>
                    <div className="canvas-prompt-editor-surface">
                        <CanvasPromptChipInput
                            autoFocus
                            value={prompt}
                            references={mentionReferences}
                            onChange={updatePrompt}
                            onSubmit={() => {
                                submit();
                                setExpanded(false);
                            }}
                            className="thin-scrollbar h-[min(46vh,360px)] w-full cursor-text overflow-y-auto px-4 py-3.5 text-[15px] leading-7 outline-none"
                            style={{ background: "transparent", color: theme.node.text }}
                            placeholder={t(`canvas.promptPanel.${mode === "image" && hasImageContent ? "editImage" : mode === "text" && hasTextContent ? "editText" : mode}`)}
                            placeholderClassName="left-4 top-3.5 text-[15px] leading-7"
                        />
                    </div>
                    <div className="mt-4 flex min-w-0 items-center gap-1.5">
                        <PromptComposerTools
                            config={config}
                            mode={mode}
                            theme={theme}
                            surface={theme.toolbar.itemHover}
                            onConfigChange={onConfigChange}
                            nodeId={node.id}
                            onMissingConfig={() => openConfigDialog(true)}
                        />
                        <span className="shrink-0 pr-1 text-[11px] font-medium tabular-nums" style={{ color: theme.node.faint }}>
                            {t("canvas.promptPanel.charCount", { count: prompt.trim().length })}
                        </span>
                        <CanvasPromptLibrary onSelect={updatePrompt} />
                        <Tooltip title={t("canvas.promptPanel.collapseEditor")}>
                            <button type="button" className="grid size-8 shrink-0 place-items-center rounded-full" style={{ color: theme.node.muted }} onClick={() => setExpanded(false)} aria-label={t("canvas.promptPanel.collapseEditor")}>
                                <Shrink className="size-3.5" />
                            </button>
                        </Tooltip>
                        <PromptSendButton
                            isRunning={isRunning}
                            mode={mode}
                            disabled={!isRunning && (mediaLocked || !prompt.trim())}
                            locked={mediaLocked}
                            onClick={() => {
                                if (isRunning) onStop(node.id);
                                else {
                                    submit();
                                    setExpanded(false);
                                }
                            }}
                        />
                    </div>
                </div>
            </Modal>
        </div>
    );
}

function PromptComposerTools({
    config,
    mode,
    theme,
    surface,
    nodeId,
    onConfigChange,
    onMissingConfig,
}: {
    config: AiConfig;
    mode: CanvasNodeGenerationMode;
    theme: CanvasTheme;
    surface: string;
    nodeId: string;
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onMissingConfig: () => void;
}) {
    const { t } = useTranslation();
    return (
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <PromptDockModel
                config={config}
                mode={mode}
                theme={theme}
                surface={surface}
                placeholder={t("canvas.configNode.model")}
                onChange={(model) => onConfigChange(nodeId, mode === "image" ? canvasImageSettingsFromModel(config, model) : { model })}
                onMissingConfig={onMissingConfig}
            />
            {mode === "image" ? (
                <CanvasImageSettingsPopover
                    config={config}
                    buttonClassName="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5"
                    onConfigChange={(key, value) => onConfigChange(nodeId, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                />
            ) : mode === "video" ? (
                <CanvasVideoSettingsPopover config={config} buttonClassName="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5" onConfigChange={(key, value) => onConfigChange(nodeId, videoConfigPatch(key, value))}>
                    <DockSettingsLabel theme={theme} />
                </CanvasVideoSettingsPopover>
            ) : mode === "audio" ? (
                <CanvasAudioSettingsPopover config={config} buttonClassName="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5" onConfigChange={(key, value) => onConfigChange(nodeId, audioConfigPatch(key, value))}>
                    <DockSettingsLabel theme={theme} />
                </CanvasAudioSettingsPopover>
            ) : (
                <CanvasTextSettingsPopover config={config} buttonClassName="inline-flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-full px-2.5" onConfigChange={(_, value) => onConfigChange(nodeId, { reasoningEffort: value })}>
                    <DockSettingsLabel theme={theme}>
                        {t("canvas.controls.reasoning")} · {reasoningEffortLabel(config.reasoningEffort)}
                    </DockSettingsLabel>
                </CanvasTextSettingsPopover>
            )}
        </div>
    );
}

function PromptSendButton({
    isRunning,
    mode,
    disabled,
    locked,
    onClick,
}: {
    isRunning: boolean;
    mode: CanvasNodeGenerationMode;
    disabled: boolean;
    locked: boolean;
    onClick: () => void;
}) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="grid size-9 shrink-0 place-items-center rounded-full disabled:opacity-35"
            style={{ background: isRunning ? "#ef4444" : nodeTypeColor(mode), color: "#fff" }}
            disabled={disabled}
            title={locked ? t("canvas.unavailable") : undefined}
            onClick={onClick}
            aria-label={t(isRunning ? "canvas.promptPanel.stopGeneration" : "canvas.promptPanel.generate")}
        >
            {isRunning ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
        </button>
    );
}

function PromptDockModel({
    config,
    mode,
    theme,
    surface,
    placeholder,
    onChange,
    onMissingConfig,
}: {
    config: AiConfig;
    mode: CanvasNodeGenerationMode;
    theme: CanvasTheme;
    surface: string;
    placeholder: string;
    onChange: (model: string) => void;
    onMissingConfig: () => void;
}) {
    const options = selectableModelsByCapability(config, mode);
    const current = config.model || "";

    if (!options.length) {
        return (
            <button type="button" className="flex h-8 min-w-0 max-w-[148px] items-center gap-1.5 rounded-full px-2.5 text-left" style={{ background: surface, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onMissingConfig}>
                <Cpu className="size-3.5 shrink-0 opacity-50" />
                <span className="min-w-0 truncate text-[12px] font-medium">{placeholder}</span>
            </button>
        );
    }

    return (
        <div className="min-w-0 max-w-[148px]">
            <CanvasFieldMenu
                compact
                value={current}
                options={options.map((model) => ({
                    value: model,
                    label: (
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                            <PromptModelMark model={model} />
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
                triggerClassName="!h-8 !rounded-full !px-2.5"
                menuMinWidth={280}
                onChange={onChange}
            >
                {(open) => (
                    <span className="flex w-full min-w-0 items-center gap-1.5">
                        <PromptModelMark model={current} />
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{current ? modelOptionLabel(config, current) : placeholder}</span>
                        <ChevronDown className="size-3 shrink-0 opacity-35 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "none" }} />
                    </span>
                )}
            </CanvasFieldMenu>
        </div>
    );
}

function PromptModelMark({ model }: { model: string }) {
    const name = modelOptionName(model).toLowerCase();
    const icon = name.includes("claude") || name.includes("anthropic")
        ? "/icons/claude.svg"
        : name.includes("gemini") || name.includes("google")
          ? "/icons/gemini.svg"
          : name.includes("gpt") || name.includes("openai")
            ? "/icons/openai.svg"
            : name.includes("grok")
              ? "/icons/grok.svg"
              : name.includes("deepseek")
                ? "/icons/deepseek.svg"
                : name.includes("glm")
                  ? "/icons/glm.svg"
                  : "";
    return icon ? <img src={icon} alt="" className="size-3.5 shrink-0 dark:invert" /> : <Cpu className="size-3.5 shrink-0 opacity-50" />;
}

function DockSettingsLabel({ theme, children }: { theme: CanvasTheme; children?: ReactNode }) {
    return (
        <span className="flex min-w-0 items-center gap-1.5" style={{ color: theme.node.text }}>
            <Settings2 className="size-3.5 shrink-0 opacity-55" />
            <span className="min-w-0 truncate text-[12px] font-medium">{children}</span>
        </span>
    );
}

function defaultMode(type: CanvasNodeData["type"]): CanvasNodeGenerationMode {
    return type === CanvasNodeType.Text ? "text" : type === CanvasNodeType.Video ? "video" : type === CanvasNodeType.Audio ? "audio" : "image";
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasNodeGenerationMode): AiConfig {
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
