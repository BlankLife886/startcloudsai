import { CheckCircle2, ChevronDown, ChevronRight, Clock3, Cpu, Crop, Grid2x2, Image as ImageIcon, Maximize2, MessageSquare, Music2, Play, Settings2, SlidersHorizontal, Square, Video, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { TextSettingsPanel } from "@/components/text-settings-panel";
import { videoResolutionLabel, videoSecondsLabel, videoSizeLabel } from "@/components/video-settings-panel";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
import { isCanvasGenerationModeEnabled } from "@/constant/canvas";
import { estimateCanvasGenerationCost } from "@/lib/canvas/canvas-generation-cost";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { canvasRaisedStyle, colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import { applyCanvasImageModelSettings, canvasImageSettingsFromModel } from "@/lib/canvas/canvas-image-model";
import { formatGenerationDuration, useGenerationElapsed } from "@/lib/canvas/canvas-generation-elapsed";
import { canvasGenerationStageLabel } from "@/lib/canvas/canvas-generation-stage";
import { buildAngleLabel, isUnsubmittedCanvasGeneration } from "@/lib/canvas/canvas-generation-helpers";
import { canvasLocalImageOperationOutputCount, isCanvasLocalImageOperation, normalizeCanvasLocalImageOperationParams } from "@/lib/canvas/canvas-local-image-operation";
import { CanvasOperationNodeType } from "@/lib/canvas/canvas-operation-node";
import { defaultConfig, formatModelPriceParts, modelOptionLabel, modelOptionMeta, modelOptionName, resolveModelForCapability, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import { CanvasPreviewImage } from "./canvas-preview-image";
import type { NodeGenerationInput } from "./canvas-node-generation";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasFieldMenu } from "./canvas-field-menu";
import { CanvasPriceMark } from "./canvas-setting-controls";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    outputNode?: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    inputs: NodeGenerationInput[];
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStopGeneration: (nodeId: string) => void;
    onCancelQueued: (nodeId: string) => void;
    onComposerToggle: () => void;
    onConfigureOperation: (node: CanvasNodeData) => void;
};

const MODES: Array<{ value: CanvasGenerationMode; icon: typeof ImageIcon; colorKey: string; labelKey: "image" | "text" | "video" | "audio" }> = [
    { value: "image", icon: ImageIcon, colorKey: "image", labelKey: "image" },
    { value: "text", icon: MessageSquare, colorKey: "text", labelKey: "text" },
    { value: "video", icon: Video, colorKey: "video", labelKey: "video" },
    { value: "audio", icon: Music2, colorKey: "audio", labelKey: "audio" },
];

const FIELD_CLASS = "canvas-config-field flex h-9 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] transition-colors";

export function CanvasConfigNodePanel({ node, outputNode, isRunning, inputSummary, inputs, onConfigChange, onGenerate, onStopGeneration, onCancelQueued, onComposerToggle, onConfigureOperation }: CanvasConfigNodePanelProps) {
    const panel = isCanvasLocalImageOperation(node.metadata?.localImageOperation) ? (
        <CanvasLocalImageOperationPanel node={node} isRunning={isRunning} inputSummary={inputSummary} onGenerate={onGenerate} onStopGeneration={onStopGeneration} onCancelQueued={onCancelQueued} onConfigureOperation={onConfigureOperation} />
    ) : node.type === CanvasOperationNodeType.Angle || node.type === CanvasOperationNodeType.ReversePrompt ? (
        <CanvasAiOperationPanel node={node} isRunning={isRunning} inputSummary={inputSummary} onConfigChange={onConfigChange} onGenerate={onGenerate} onStopGeneration={onStopGeneration} onCancelQueued={onCancelQueued} onConfigureOperation={onConfigureOperation} />
    ) : (
        <CanvasGenerationConfigNodePanel node={node} isRunning={isRunning} inputSummary={inputSummary} inputs={inputs} onConfigChange={onConfigChange} onGenerate={onGenerate} onStopGeneration={onStopGeneration} onCancelQueued={onCancelQueued} onComposerToggle={onComposerToggle} onConfigureOperation={onConfigureOperation} />
    );

    if (!node.metadata?.inlineOutputNodeId) return panel;
    return (
        <div className="flex h-full w-full flex-col overflow-hidden">
            <div className="h-[414px] shrink-0">{panel}</div>
            <CanvasInlineOutputPreview outputNode={outputNode} mode={node.metadata.generationMode || "image"} />
        </div>
    );
}

function CanvasInlineOutputPreview({ outputNode, mode }: { outputNode?: CanvasNodeData; mode: CanvasGenerationMode }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const content = outputNode?.metadata?.content || "";
    const loading = outputNode?.metadata?.status === "loading";
    const error = outputNode?.metadata?.status === "error" ? outputNode.metadata.errorDetails : "";
    return (
        <div className="relative min-h-0 flex-1 overflow-hidden border-t" style={{ borderColor: theme.node.stroke, background: theme.toolbar.itemHover }}>
            {mode === "text" && content ? (
                <div className="thin-scrollbar h-full overflow-y-auto whitespace-pre-wrap break-words p-3 text-[12px] leading-5" style={{ color: theme.node.text }} data-canvas-no-zoom>
                    {content}
                </div>
            ) : mode === "image" && content ? (
                <CanvasPreviewImage src={content} storageKey={outputNode?.metadata?.storageKey} thumbnailUrl={outputNode?.metadata?.thumbnailUrl} alt={outputNode?.title || ""} className="h-full w-full object-contain" />
            ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-[12px]" style={{ color: error ? "#ef4444" : theme.node.muted }}>
                    {loading ? <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : null}
                    <span>{error || (loading ? t("canvas.node.generating") : t("canvas.node.emptyImage"))}</span>
                </div>
            )}
        </div>
    );
}

function CanvasGenerationConfigNodePanel({ node, isRunning, inputSummary, inputs, onConfigChange, onGenerate, onStopGeneration, onCancelQueued, onComposerToggle }: CanvasConfigNodePanelProps) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const requestedMode = node.metadata?.generationMode || "image";
    const mode = isCanvasGenerationModeEnabled(requestedMode) ? requestedMode : "image";
    const modeIndex = Math.max(0, MODES.findIndex((item) => item.value === mode));
    const color = nodeTypeColor(mode, undefined, theme.scheme);
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);
    const stats = inputStats(mode, inputSummary, t, theme.scheme);
    const fieldStyle = { background: theme.toolbar.itemHover, color: theme.node.text };
    const cost = estimateCanvasGenerationCost({ config, kind: mode === "text" ? "text" : "image" });
    const hasPreviousOutput = Boolean(node.metadata?.workflowOutputNodeIds?.length);
    const generateLabel = t(hasPreviousOutput ? "canvas.configNode.regenerate" : "canvas.configNode.generate");
    const generatePrice = cost.total > 0 ? `${cost.total.toLocaleString()} 积分` : undefined;
    const generateComparePrice = cost.compareTotal && cost.compareTotal > cost.total ? String(cost.compareTotal) : undefined;
    const executionStatus = node.metadata?.executionStatus;
    const queued = isUnsubmittedCanvasGeneration(node);
    const generating = (isRunning || executionStatus === "running") && !queued;
    const elapsedMs = useGenerationElapsed(node.metadata?.generationStartedAt, node.metadata?.generationDurationMs, generating);
    const completedAt = node.metadata?.generationCompletedAt;
    const referenceImages = inputs.filter((input) => Boolean(input.image));

    return (
        <div className="canvas-config-node flex h-full w-full cursor-move flex-col px-3 py-2.5" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="canvas-config-modes relative grid h-9 shrink-0 grid-cols-4 rounded-xl p-[3px]" style={{ background: theme.toolbar.itemHover }}>
                <div
                    className="canvas-config-mode-thumb pointer-events-none absolute inset-y-[3px] rounded-[9px] transition-[left] duration-200 ease-out"
                    style={{
                        left: `calc(3px + ${modeIndex} * (100% - 6px) / 4)`,
                        width: "calc((100% - 6px) / 4)",
                        ...canvasRaisedStyle(theme),
                    }}
                />
                {MODES.map((item) => {
                    const active = mode === item.value;
                    const enabled = isCanvasGenerationModeEnabled(item.value);
                    const Icon = item.icon;
                    const itemColor = nodeTypeColor(item.colorKey, undefined, theme.scheme);
                    return (
                        <button
                            key={item.value}
                            type="button"
                            disabled={!enabled}
                            title={enabled ? undefined : t("canvas.unavailable")}
                            className="relative z-[1] flex items-center justify-center gap-1 rounded-[9px] text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35"
                            style={{ color: active ? itemColor : theme.node.muted }}
                            onClick={() => enabled && onConfigChange(node.id, { generationMode: item.value })}
                        >
                            <Icon className="size-3.5 shrink-0" />
                            <span className="truncate">{t(`canvas.configNode.${item.labelKey}`)}</span>
                        </button>
                    );
                })}
            </div>

            <div className="mt-2 flex min-w-0 shrink-0 flex-col gap-2">
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
                        showDimensions={false}
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
                    <SettingsField mode={mode} config={config} nodeId={node.id} fieldStyle={fieldStyle} onConfigChange={onConfigChange} />
                )}
            </div>

            <div className="mt-auto flex min-w-0 shrink-0 items-center gap-2 pt-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                    {referenceImages.length ? (
                        <div className="mr-0.5 flex items-center -space-x-1" title={t("canvas.configNode.references")}>
                            {referenceImages.slice(0, 4).map((input, index) => (
                                <span key={`${input.nodeId}:${index}`} className="relative grid size-7 shrink-0 place-items-center overflow-hidden rounded-lg border" style={{ background: theme.node.fill, borderColor: theme.toolbar.panel, zIndex: 4 - index }}>
                                    <CanvasPreviewImage src={input.image?.dataUrl} storageKey={input.image?.storageKey} alt={input.title} maxEdge={96} className="size-full object-cover" />
                                </span>
                            ))}
                            {referenceImages.length > 4 ? (
                                <span className="relative grid size-7 shrink-0 place-items-center rounded-lg border text-[10px] font-semibold" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.muted, zIndex: 0 }}>
                                    +{referenceImages.length - 4}
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                    {stats.length ? (
                        stats.map((item) => (
                            <span
                                key={item.label}
                                className="inline-flex h-6 max-w-full items-center gap-1 rounded-full px-2 text-[11px]"
                                style={{
                                    background: item.value > 0 ? colorWash(item.color, theme.scheme === "dark" ? 0.1 : 0.12) : "transparent",
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

            {queued ? (
                <div className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]" style={{ color: theme.node.muted }}>
                    <Clock3 className="size-3.5" />
                    <span>{t("canvas.configNode.queued")}</span>
                </div>
            ) : generating ? (
                <div className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]" style={{ color: theme.node.muted }}>
                    <Clock3 className="size-3.5" />
                    <span className="truncate">{canvasGenerationStageLabel(node.metadata?.generationStage)}</span>
					<span className="tabular-nums opacity-70">{formatGenerationDuration(elapsedMs)}</span>
                </div>
            ) : executionStatus === "succeeded" && completedAt ? (
                <div className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]" style={{ color: theme.node.muted }}>
                    <CheckCircle2 className="size-3.5" style={{ color: theme.scheme === "dark" ? "#4ade80" : undefined }} />
                    <span>{t("canvas.configNode.generatedAt", { time: formatGenerationTime(completedAt) })}</span>
                    <span className="opacity-45">·</span>
                    <span className="tabular-nums">{t("canvas.configNode.duration", { duration: formatGenerationDuration(elapsedMs) })}</span>
                </div>
            ) : executionStatus === "failed" && completedAt ? (
                <div className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px] text-red-600">
                    <Clock3 className="size-3.5" />
                    <span>{t("canvas.configNode.failedAt", { time: formatGenerationTime(completedAt) })}</span>
                    <span className="opacity-45">·</span>
                    <span className="tabular-nums">{t("canvas.configNode.duration", { duration: formatGenerationDuration(elapsedMs) })}</span>
                </div>
            ) : executionStatus === "canceled" && completedAt ? (
                <div className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]" style={{ color: theme.node.muted }}>
                    <Clock3 className="size-3.5" />
                    <span>{t("canvas.configNode.canceledAt", { time: formatGenerationTime(completedAt) })}</span>
                    <span className="opacity-45">·</span>
                    <span className="tabular-nums">{t("canvas.configNode.duration", { duration: formatGenerationDuration(elapsedMs) })}</span>
                </div>
            ) : null}

            <button
                type="button"
                className="canvas-config-generate mt-2 inline-flex h-9 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-70"
                style={{
                    background: queued ? "#d97706" : theme.scheme === "dark" ? colorWash(color, 0.16) : color,
                    color: queued ? "#fff" : theme.scheme === "dark" ? color : "#fff",
                    boxShadow: theme.scheme === "dark" && !queued ? `inset 0 0 0 1px ${colorWash(color, 0.38)}` : undefined,
                }}
                disabled={!queued && !generating && !canGenerate}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => (queued ? onCancelQueued(node.id) : generating ? onStopGeneration(node.id) : onGenerate(node.id))}
            >
                {queued ? (
                    <>
                        <X className="size-4" />
                        {t("canvas.configNode.cancelQueued")}
                    </>
                ) : generating ? (
                    <>
                        <Square className="size-3.5 fill-current" />
                        {t("canvas.configNode.stopWithDuration", { duration: formatGenerationDuration(elapsedMs) })}
                    </>
                ) : (
                    <>
                        <Play className="size-4 fill-current" />
                        {generateLabel}
                        {generatePrice ? (
                            <>
                                <span className="opacity-40">·</span>
                                <CanvasPriceMark price={generatePrice} comparePrice={generateComparePrice} />
                            </>
                        ) : null}
                    </>
                )}
            </button>
        </div>
    );
}

function CanvasLocalImageOperationPanel({ node, isRunning, inputSummary, onGenerate, onStopGeneration, onCancelQueued, onConfigureOperation }: Pick<CanvasConfigNodePanelProps, "node" | "isRunning" | "inputSummary" | "onGenerate" | "onStopGeneration" | "onCancelQueued" | "onConfigureOperation">) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const operation = node.metadata?.localImageOperation;
    if (!isCanvasLocalImageOperation(operation)) return null;
    const Icon = operation === "crop" ? Crop : operation === "split" ? Grid2x2 : Maximize2;
    const label = t(`canvas.imageTools.${operation}`);
    const count = canvasLocalImageOperationOutputCount(operation, node.metadata?.localImageOperationParams);
    const summary = localOperationSummary(operation, node.metadata?.localImageOperationParams, t);
    const queued = isUnsubmittedCanvasGeneration(node);
    const executionStatus = node.metadata?.executionStatus;
    const running = (isRunning || executionStatus === "running") && !queued;
    const elapsedMs = useGenerationElapsed(node.metadata?.generationStartedAt, node.metadata?.generationDurationMs, running);
    const hasOutput = Boolean(node.metadata?.workflowOutputNodeIds?.length);
    const canRun = inputSummary.imageCount === 1;
    const accent = nodeTypeColor("image", undefined, theme.scheme);
    const completedCount = Math.min(count, Math.max(0, node.metadata?.localImageOperationCompletedCount || 0));

    return (
        <div className="canvas-config-node flex h-full w-full cursor-move flex-col px-3 py-2.5" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="flex min-h-12 shrink-0 items-center gap-3 rounded-xl px-3" style={{ background: colorWash(accent, theme.scheme === "dark" ? 0.12 : 0.08) }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: colorWash(accent, 0.16), color: accent }}>
                    <Icon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{label}</div>
                    <div className="mt-0.5 truncate text-[11px]" style={{ color: theme.node.muted }}>{summary}</div>
                </div>
                <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:scale-105" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }} title={t("canvas.configNode.configureOperation")} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigureOperation(node)}>
                    <SlidersHorizontal className="size-3.5" />
                </button>
            </div>

            <button type="button" className="mt-2.5 flex min-h-11 items-center justify-between rounded-xl px-3 text-left" style={{ background: theme.toolbar.itemHover }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigureOperation(node)}>
                <span className="min-w-0">
                    <span className="block text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.configNode.operationParams")}</span>
                    <span className="mt-0.5 block truncate text-[12px] font-semibold">{summary}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 opacity-45" />
            </button>

            <div className="mt-2 flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: theme.toolbar.itemHover }}>
                <span className="text-[12px]" style={{ color: theme.node.muted }}>{t("canvas.configNode.operationInput")}</span>
                <span className="text-[12px] font-semibold" style={{ color: canRun ? accent : inputSummary.imageCount > 1 ? "#ef4444" : theme.node.muted }}>{t("canvas.configNode.images", { count: inputSummary.imageCount })}</span>
            </div>

            <div className="mt-auto min-h-7 px-1 pt-3 text-[11px]" style={{ color: executionStatus === "failed" ? "#ef4444" : theme.node.muted }}>
                {queued ? t("canvas.configNode.queuedOperation", { operation: label }) : running ? t("canvas.configNode.processingOperationProgress", { operation: label, completed: completedCount, count, duration: formatGenerationDuration(elapsedMs) }) : executionStatus === "succeeded" ? t("canvas.configNode.operationCompleted", { operation: label, duration: formatGenerationDuration(elapsedMs) }) : executionStatus === "failed" ? node.metadata?.errorDetails || t("canvas.configNode.operationFailed", { operation: label, duration: formatGenerationDuration(elapsedMs) }) : inputSummary.imageCount > 1 ? t("canvas.configNode.singleImageOnly") : t("canvas.configNode.operationReadyLocal", { operation: label })}
            </div>

            <button
                type="button"
                className="canvas-config-generate mt-2 inline-flex h-9 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60"
                style={{ background: queued ? "#d97706" : theme.scheme === "dark" ? colorWash(accent, 0.16) : accent, color: queued ? "#fff" : theme.scheme === "dark" ? accent : "#fff", boxShadow: theme.scheme === "dark" && !queued ? `inset 0 0 0 1px ${colorWash(accent, 0.38)}` : undefined }}
                disabled={!queued && !running && !canRun}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={() => (queued ? onCancelQueued(node.id) : running ? onStopGeneration(node.id) : onGenerate(node.id))}
            >
                {queued ? <><X className="size-4" />{t("canvas.configNode.cancelQueued")}</> : running ? <><Square className="size-3.5 fill-current" />{t("canvas.configNode.stopWithDuration", { duration: formatGenerationDuration(elapsedMs) })}</> : <><Play className="size-4 fill-current" />{t(hasOutput ? "canvas.configNode.rerunOperation" : "canvas.configNode.runOperation", { operation: label })}</>}
            </button>
        </div>
    );
}

function CanvasAiOperationPanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStopGeneration, onCancelQueued, onConfigureOperation }: Pick<CanvasConfigNodePanelProps, "node" | "isRunning" | "inputSummary" | "onConfigChange" | "onGenerate" | "onStopGeneration" | "onCancelQueued" | "onConfigureOperation">) {
    const { t } = useTranslation();
    const globalConfig = useEffectiveConfig();
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const angle = node.type === CanvasOperationNodeType.Angle;
    const mode: CanvasGenerationMode = angle ? "image" : "text";
    const label = t(angle ? "canvas.operationNodes.angle" : "canvas.operationNodes.reversePrompt");
    const color = nodeTypeColor(angle ? "image" : "text", undefined, theme.scheme);
    const config = buildNodeConfig(globalConfig, node, mode);
    const queued = isUnsubmittedCanvasGeneration(node);
    const executionStatus = node.metadata?.executionStatus;
    const running = (isRunning || executionStatus === "running") && !queued;
    const elapsedMs = useGenerationElapsed(node.metadata?.generationStartedAt, node.metadata?.generationDurationMs, running);
    const instruction = node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    const canRun = inputSummary.imageCount === 1 && Boolean(instruction.trim());
    const hasOutput = Boolean(node.metadata?.workflowOutputNodeIds?.length);
    const cost = estimateCanvasGenerationCost({ config, kind: angle ? "image" : "text", count: 1 });
    const angleSummary = angle ? buildAngleLabel(normalizeAngleParams(node.metadata?.imageAngleParams)) : "";

    return (
        <div className="canvas-config-node flex h-full w-full cursor-move flex-col px-3 py-2.5" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="flex min-h-12 shrink-0 items-center gap-3 rounded-xl px-3" style={{ background: colorWash(color, theme.scheme === "dark" ? 0.12 : 0.08) }}>
                <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: colorWash(color, 0.16), color }}>
                    {angle ? <SlidersHorizontal className="size-4" /> : <MessageSquare className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{label}</div>
                    <div className="mt-0.5 truncate text-[11px]" style={{ color: theme.node.muted }}>{angle ? angleSummary : t("canvas.operationNodes.reversePromptDescription")}</div>
                </div>
                {angle ? <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:scale-105" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }} title={t("canvas.configNode.configureOperation")} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigureOperation(node)}><SlidersHorizontal className="size-3.5" /></button> : null}
            </div>

            <div className="mt-2.5">
                <ConfigModelField config={config} mode={mode} theme={theme} surface={theme.toolbar.itemHover} placeholder={t("canvas.configNode.model")} onChange={(model) => onConfigChange(node.id, angle ? canvasImageSettingsFromModel(config, model) : { model })} onMissingConfig={() => openConfigDialog(true)} />
            </div>
            {angle ? (
                <button type="button" className="mt-2 flex min-h-11 items-center justify-between rounded-xl px-3 text-left" style={{ background: theme.toolbar.itemHover }} onMouseDown={(event) => event.stopPropagation()} onClick={() => onConfigureOperation(node)}>
                    <span className="min-w-0"><span className="block text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.configNode.angleParams")}</span><span className="mt-0.5 block truncate text-[12px] font-semibold">{angleSummary}</span></span>
                    <ChevronRight className="size-4 shrink-0 opacity-45" />
                </button>
            ) : (
                <label className="mt-2 block rounded-xl px-3 py-2" style={{ background: theme.toolbar.itemHover }} onMouseDown={(event) => event.stopPropagation()}>
                    <span className="block text-[11px]" style={{ color: theme.node.muted }}>{t("canvas.configNode.analysisInstruction")}</span>
                    <textarea
                        value={instruction}
                        rows={3}
                        className="mt-1 block max-h-20 min-h-14 w-full resize-none bg-transparent text-[12px] leading-5 outline-none"
                        placeholder={t("canvas.configNode.analysisInstructionPlaceholder")}
                        onChange={(event) => onConfigChange(node.id, { composerContent: event.target.value, prompt: event.target.value, status: "idle", executionStatus: undefined, errorDetails: undefined })}
                    />
                </label>
            )}
            <div className="mt-2 flex items-center justify-between rounded-xl px-3 py-2.5" style={{ background: theme.toolbar.itemHover }}>
                <span className="text-[12px]" style={{ color: theme.node.muted }}>{t("canvas.configNode.operationInput")}</span>
                <span className="text-[12px] font-semibold" style={{ color: inputSummary.imageCount === 1 ? color : inputSummary.imageCount > 1 ? "#ef4444" : theme.node.muted }}>{t("canvas.configNode.images", { count: inputSummary.imageCount })}</span>
            </div>
            <div className="mt-auto min-h-7 px-1 pt-3 text-[11px]" style={{ color: executionStatus === "failed" ? "#ef4444" : theme.node.muted }}>
                {queued ? t("canvas.configNode.queuedOperation", { operation: label }) : running ? `${canvasGenerationStageLabel(node.metadata?.generationStage)} · ${formatGenerationDuration(elapsedMs)}` : executionStatus === "succeeded" ? t("canvas.configNode.operationCompleted", { operation: label, duration: formatGenerationDuration(elapsedMs) }) : executionStatus === "failed" ? node.metadata?.errorDetails || t("canvas.configNode.operationFailed", { operation: label, duration: formatGenerationDuration(elapsedMs) }) : inputSummary.imageCount > 1 ? t("canvas.configNode.singleImageOnly") : t("canvas.configNode.operationReady", { operation: label })}
            </div>
            <button type="button" className="canvas-config-generate mt-2 inline-flex h-9 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium disabled:cursor-not-allowed disabled:opacity-60" style={{ background: queued ? "#d97706" : theme.scheme === "dark" ? colorWash(color, 0.16) : color, color: queued ? "#fff" : theme.scheme === "dark" ? color : "#fff" }} disabled={!queued && !running && !canRun} onMouseDown={(event) => event.stopPropagation()} onClick={() => queued ? onCancelQueued(node.id) : running ? onStopGeneration(node.id) : onGenerate(node.id)}>
                {queued ? <><X className="size-4" />{t("canvas.configNode.cancelQueued")}</> : running ? <><Square className="size-3.5 fill-current" />{t("canvas.configNode.stopWithDuration", { duration: formatGenerationDuration(elapsedMs) })}</> : <><Play className="size-4 fill-current" />{t(hasOutput ? "canvas.configNode.regenerate" : "canvas.configNode.generate")}{cost.total > 0 ? <><span className="opacity-40">·</span><CanvasPriceMark price={`${cost.total.toLocaleString()} 积分`} /></> : null}</>}
            </button>
        </div>
    );
}

function localOperationSummary(operation: "crop" | "split" | "upscale", value: unknown, t: (key: string, options?: Record<string, unknown>) => string) {
    if (operation === "crop") {
        const params = normalizeCanvasLocalImageOperationParams("crop", value);
        return t("canvas.configNode.cropSummary", { width: Math.round(params.width * 100), height: Math.round(params.height * 100) });
    }
    if (operation === "split") {
        const params = normalizeCanvasLocalImageOperationParams("split", value);
        return t("canvas.configNode.splitSummary", { rows: params.rows, columns: params.columns });
    }
    const params = normalizeCanvasLocalImageOperationParams("upscale", value);
    return t("canvas.configNode.upscaleSummary", { size: params.targetLongEdge, algorithm: t(`canvas.editors.${params.algorithm}`) });
}

function normalizeAngleParams(value: unknown) {
    const params = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const horizontalAngle = Number(params.horizontalAngle);
    const pitchAngle = Number(params.pitchAngle);
    const cameraDistance = Number(params.cameraDistance);
    return {
        horizontalAngle: Number.isFinite(horizontalAngle) ? Math.max(-60, Math.min(60, horizontalAngle)) : 45,
        pitchAngle: Number.isFinite(pitchAngle) ? Math.max(-45, Math.min(45, pitchAngle)) : 0,
        cameraDistance: Number.isFinite(cameraDistance) ? Math.max(1, Math.min(10, cameraDistance)) : 4.8,
        wideAngle: Boolean(params.wideAngle),
    };
}

function formatGenerationTime(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
    const priceParts = formatModelPriceParts(meta, config.reasoningEffort);

    if (!options.length) {
        return (
            <button type="button" className="canvas-config-field flex h-9 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 text-left" style={{ background: surface, color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()} onClick={onMissingConfig}>
                <Cpu className="size-4 shrink-0 opacity-50" />
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{placeholder}</span>
                <ChevronDown className="size-3.5 shrink-0 opacity-35" />
            </button>
        );
    }

    return (
        <CanvasFieldMenu
            value={current}
            options={options.map((model) => {
                const parts = formatModelPriceParts(modelOptionMeta(config, model), config.reasoningEffort);
                return {
                    value: model,
                    label: (
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                            <ModelMark model={model} />
                            <span className="min-w-0 flex-1 truncate">{modelOptionLabel(config, model)}</span>
                            <CanvasPriceMark price={parts.price} comparePrice={parts.comparePrice} />
                        </span>
                    ),
                };
            })}
            theme={theme}
            surface={surface}
            emptyLabel={placeholder}
            triggerClassName="!h-9 !rounded-[10px] canvas-config-field"
            onChange={onChange}
        >
            {(open) => (
                <span className="flex w-full min-w-0 items-center gap-2.5">
                    <ModelMark model={current} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{current ? modelOptionLabel(config, current) : placeholder}</span>
                    {priceParts.price ? (
                        <span className="shrink-0">
                            <CanvasPriceMark price={priceParts.price} comparePrice={priceParts.comparePrice} />
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
    fieldStyle,
    onConfigChange,
}: {
    mode: CanvasGenerationMode;
    config: AiConfig;
    nodeId: string;
    fieldStyle: { background: string; color: string };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
}) {
    const trigger = (
        <span className={FIELD_CLASS} style={fieldStyle}>
            <Settings2 className="size-3.5 shrink-0 opacity-55" />
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

function inputStats(mode: CanvasGenerationMode, inputSummary: CanvasConfigNodePanelProps["inputSummary"], t: (key: string) => string, scheme: CanvasTheme["scheme"]) {
    if (mode === "text") {
        return [{ label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text", undefined, scheme) }];
    }
    if (mode === "video") {
        return [
            { label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text", undefined, scheme) },
            { label: t("canvas.configNode.references"), value: inputSummary.imageCount, color: nodeTypeColor("image", undefined, scheme) },
            { label: t("canvas.configNode.videoReferences"), value: inputSummary.videoCount, color: nodeTypeColor("video", undefined, scheme) },
        ];
    }
    if (mode === "audio") {
        return [
            { label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text", undefined, scheme) },
            { label: t("canvas.configNode.audioReferences"), value: inputSummary.audioCount, color: nodeTypeColor("audio", undefined, scheme) },
        ];
    }
    return [
        { label: t("canvas.configNode.prompt"), value: inputSummary.textCount, color: nodeTypeColor("text", undefined, scheme) },
        { label: t("canvas.configNode.references"), value: inputSummary.imageCount, color: nodeTypeColor("image", undefined, scheme) },
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
