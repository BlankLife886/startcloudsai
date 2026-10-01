import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Crop,
  Grid2x2,
  Image as ImageIcon,
  ListOrdered,
  Maximize2,
  MessageSquare,
  Music2,
  Play,
  Settings2,
  SlidersHorizontal,
  Square,
  Video,
  X,
} from "lucide-react";
import { SoftMark } from "@react/components/common/SoftMark.jsx";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import {
  videoResolutionLabel,
  videoSecondsLabel,
  videoSizeLabel,
} from "@/components/video-settings-panel";
import {
  audioFormatLabel,
  audioSpeedLabel,
  audioVoiceLabel,
} from "@/lib/audio-generation";
import { isCanvasGenerationModeEnabled } from "@/constant/canvas";
import { estimateCanvasGenerationCost } from "@/lib/canvas/canvas-generation-cost";
import {
  detectStoryboardShotCount,
  resolveBatchMode,
  resolveStoryboardParseMode,
  STORYBOARD_INPUT_LIMIT,
  type StoryboardParseMode,
  type StoryboardStyle,
} from "@/lib/canvas/storyboard-parser";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import {
  applyCanvasImageModelSettings,
  canvasExactSizeSettingsForNode,
  canvasImageSettingsFromModel,
  resolveCanvasImageModel,
} from "@/lib/canvas/canvas-image-model";
import { clampCanvasBatchCount } from "@/lib/canvas/canvas-batch-limit";
import {
  formatGenerationDuration,
  useGenerationElapsed,
} from "@/lib/canvas/canvas-generation-elapsed";
import { canvasGenerationStageLabel } from "@/lib/canvas/canvas-generation-stage";
import {
  buildAngleLabel,
  isUnsubmittedCanvasGeneration,
} from "@/lib/canvas/canvas-generation-helpers";
import {
  canvasLocalImageOperationOutputCount,
  isCanvasLocalImageOperation,
  normalizeCanvasLocalImageOperationParams,
} from "@/lib/canvas/canvas-local-image-operation";
import { CanvasOperationNodeType } from "@/lib/canvas/canvas-operation-node";
import {
  catalogModelsByCapability,
  canvasReasoningEfforts,
  defaultConfig,
  formatModelPriceParts,
  modelMaintenance,
  modelOptionLabel,
  modelOptionMeta,
  resolveCanvasReasoningEffort,
  resolveCanvasTextPrice,
  resolveModelForCapability,
  selectableModelsByCapability,
  useConfigStore,
  useEffectiveConfig,
  type AiConfig,
  type ModelReasoningEffort,
  type ReasoningEffort,
} from "@/stores/use-config-store";
import {
  ModelCatalogIcon,
  ModelMaintenanceBadge,
} from "@react/components/common/ModelCatalogIcon.jsx";
import { useThemeStore } from "@/stores/use-theme-store";
import type {
  CanvasGenerationMode,
  CanvasNodeData,
  CanvasNodeMetadata,
  StoryboardInputRole,
} from "@/types/canvas";
import { CanvasPreviewImage } from "./canvas-preview-image";
import type { NodeGenerationInput } from "./canvas-node-generation";
import "./canvas-storyboard-config.css";
import {
  CanvasAudioSettingsPopover,
  type CanvasAudioSettingKey,
} from "./canvas-audio-settings-popover";
import { AnchorPopoverPanel, AnchorPopoverTrigger, useAnchorPopover } from "./canvas-anchor-popover";
import { CanvasFieldMenu } from "./canvas-field-menu";
import {
  classifyStoryboardBatchImages,
  combineStoryboardTextInputs,
  resolveStoryboardInputSelection,
  resolveStoryboardScriptInput,
  splitStoryboardDisplayLines,
} from "@/lib/canvas/canvas-storyboard-script-editing";
import { CanvasPriceMark } from "./canvas-setting-controls";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { StudioReasoningSlider } from "@react/views/shared/StudioReasoningSlider.jsx";

const STUDIO_REASONING_EFFORT_LABELS: Record<ModelReasoningEffort, string> = {
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最大",
};

type CanvasConfigNodePanelProps = {
  node: CanvasNodeData;
  outputNode?: CanvasNodeData;
  isRunning: boolean;
  inputSummary: {
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
  };
  inputs: NodeGenerationInput[];
  onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
  onGenerate: (nodeId: string) => void;
  onStopGeneration: (nodeId: string) => void;
  onCancelQueued: (nodeId: string) => void;
  onComposerToggle: () => void;
  onConfigureOperation: (node: CanvasNodeData) => void;
};

const MODES: Array<{
  value: CanvasGenerationMode;
  icon: typeof ImageIcon;
  colorKey: string;
  labelKey: "image" | "text" | "video" | "audio";
}> = [
  { value: "image", icon: ImageIcon, colorKey: "image", labelKey: "image" },
  { value: "text", icon: MessageSquare, colorKey: "text", labelKey: "text" },
  { value: "video", icon: Video, colorKey: "video", labelKey: "video" },
  { value: "audio", icon: Music2, colorKey: "audio", labelKey: "audio" },
];

const VISIBLE_MODES = MODES.filter((item) => isCanvasGenerationModeEnabled(item.value));
const MODE_TAB_COLS =
  VISIBLE_MODES.length >= 4 ? "grid-cols-4" : VISIBLE_MODES.length === 3 ? "grid-cols-3" : "grid-cols-2";

const FIELD_CLASS =
  "canvas-config-field flex h-9 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] transition-colors";

export function CanvasConfigNodePanel({
  node,
  outputNode,
  isRunning,
  inputSummary,
  inputs,
  onConfigChange,
  onGenerate,
  onStopGeneration,
  onCancelQueued,
  onComposerToggle,
  onConfigureOperation,
}: CanvasConfigNodePanelProps) {
  const panel = node.metadata?.storyboardConfig ? (
    <CanvasStoryboardConfigNodePanel
      node={node}
      isRunning={isRunning}
      inputs={inputs}
      onConfigChange={onConfigChange}
      onGenerate={onGenerate}
      onStopGeneration={onStopGeneration}
    />
  ) : isCanvasLocalImageOperation(node.metadata?.localImageOperation) ? (
    <CanvasLocalImageOperationPanel
      node={node}
      isRunning={isRunning}
      inputSummary={inputSummary}
      inputs={inputs}
      onGenerate={onGenerate}
      onStopGeneration={onStopGeneration}
      onCancelQueued={onCancelQueued}
      onConfigureOperation={onConfigureOperation}
    />
  ) : node.type === CanvasOperationNodeType.Angle ||
    node.type === CanvasOperationNodeType.ReversePrompt ? (
    <CanvasAiOperationPanel
      node={node}
      isRunning={isRunning}
      inputSummary={inputSummary}
      inputs={inputs}
      onConfigChange={onConfigChange}
      onGenerate={onGenerate}
      onStopGeneration={onStopGeneration}
      onCancelQueued={onCancelQueued}
      onConfigureOperation={onConfigureOperation}
    />
  ) : (
    <CanvasGenerationConfigNodePanel
      node={node}
      isRunning={isRunning}
      inputSummary={inputSummary}
      inputs={inputs}
      onConfigChange={onConfigChange}
      onGenerate={onGenerate}
      onStopGeneration={onStopGeneration}
      onCancelQueued={onCancelQueued}
      onComposerToggle={onComposerToggle}
      onConfigureOperation={onConfigureOperation}
    />
  );

  if (!node.metadata?.inlineOutputNodeId) return panel;
  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="h-[414px] shrink-0">{panel}</div>
      <CanvasInlineOutputPreview
        outputNode={outputNode}
        mode={node.metadata.generationMode || "image"}
      />
    </div>
  );
}

/** Fully-automatic storyboard config: text in → recognize/polish → images out. */
const STORYBOARD_PARSE_MODE_LABELS: Record<StoryboardParseMode, string> = {
  lines: "canvas.storyboard.parseModeLines",
  paragraphs: "canvas.storyboard.parseModeParagraphs",
  markers: "canvas.storyboard.parseModeMarkers",
  prose: "canvas.storyboard.parseModeProse",
};

function CanvasStoryboardConfigNodePanel({
  node,
  isRunning,
  inputs,
  onConfigChange,
  onGenerate,
  onStopGeneration,
}: Pick<
  CanvasConfigNodePanelProps,
  | "node"
  | "isRunning"
  | "inputs"
  | "onConfigChange"
  | "onGenerate"
  | "onStopGeneration"
>) {
  const { t } = useTranslation();
  const globalConfig = useEffectiveConfig();
  const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const inputSelection = useMemo(
    () => resolveStoryboardInputSelection(inputs, node.metadata),
    [inputs, node.metadata?.batchMode, node.metadata?.storyboardInputNodeIds, node.metadata?.storyboardInputRoles, node.metadata?.storyboardPrimaryTextNodeId],
  );
  const connectedScript = combineStoryboardTextInputs(
    inputs.filter((input) => input.type === "text" && inputSelection.selectedNodeIds.has(input.nodeId)),
    inputSelection.roles,
  );
  const metadataScript = String(
    node.metadata?.storyboardScript ??
      node.metadata?.composerContent ??
      node.metadata?.prompt ??
      "",
  );
  const [scriptDraft, setScriptDraft] = useState(() => metadataScript || connectedScript);
  const initialScriptInput = resolveStoryboardScriptInput({
    connectedScript,
    localScript: metadataScript,
    inputMode: node.metadata?.storyboardInputMode,
  });
  const scriptEditedLocallyRef = useRef(Boolean(metadataScript.trim()) && !initialScriptInput.followsConnectedScript);
  const set = (patch: Partial<CanvasNodeMetadata>) => onConfigChange(node.id, patch);
  useEffect(() => {
    const resolved = resolveStoryboardScriptInput({
      connectedScript,
      localScript: metadataScript,
      inputMode: node.metadata?.storyboardInputMode,
    });
    scriptEditedLocallyRef.current = !resolved.followsConnectedScript;
  }, [connectedScript, metadataScript, node.metadata?.storyboardInputMode]);
  useEffect(() => {
    if (connectedScript && !scriptEditedLocallyRef.current) {
      setScriptDraft((current) => (current === connectedScript ? current : connectedScript));
      if (String(node.metadata?.storyboardScript || "") !== connectedScript) {
        onConfigChange(node.id, {
          storyboardScript: connectedScript,
          composerContent: connectedScript,
          prompt: connectedScript,
          storyboardInputMode: "linked",
        });
      }
      return;
    }
    const next = String(node.metadata?.storyboardScript ?? "");
    if (!next) {
      if (!scriptEditedLocallyRef.current) setScriptDraft("");
      return;
    }
    setScriptDraft((current) => (current === next ? current : next));
  }, [connectedScript, node.id, node.metadata?.storyboardScript, onConfigChange]);
  const script = scriptDraft;
  const scriptOverLimit = script.length > STORYBOARD_INPUT_LIMIT;
  const followsConnectedScript = Boolean(connectedScript) && !scriptEditedLocallyRef.current;
  const hasStaleConnectedScript = Boolean(
    connectedScript
      && scriptEditedLocallyRef.current
      && metadataScript.trim()
      && metadataScript.trim() !== connectedScript.trim(),
  );
  const followConnectedScript = () => {
    if (!connectedScript) return;
    scriptEditedLocallyRef.current = false;
    setScriptDraft(connectedScript);
    set({
      storyboardScript: connectedScript,
      composerContent: connectedScript,
      prompt: connectedScript,
      storyboardInputMode: "linked",
    });
  };
  const style = (node.metadata?.storyboardStyle || "cinematic") as StoryboardStyle;
  const parseMode = resolveStoryboardParseMode(node.metadata?.storyboardParseMode);
  const batchMode = resolveBatchMode(node.metadata?.batchMode);
  const batchMaxCount = useConfigStore((state) => state.batchMaxCount);
  const variantCount = clampCanvasBatchCount(node.metadata?.batchVariantCount, 4, batchMaxCount);
  const selectedImageInputs = useMemo(
    () =>
      inputs.filter(
        (input) =>
          Boolean(input.image) &&
          inputSelection.selectedNodeIds.has(input.nodeId),
      ),
    [inputs, inputSelection.selectedNodeIds],
  );
  const classifiedImages = useMemo(
    () => classifyStoryboardBatchImages(selectedImageInputs, inputSelection.roles, batchMode),
    [batchMode, inputSelection.roles, selectedImageInputs],
  );
  const driverImages = batchMode === "refs" ? classifiedImages.inputImages : selectedImageInputs;
  const designatedReferenceImages = batchMode === "refs" ? classifiedImages.referenceImages : [];
  const referenceImages = batchMode === "refs" ? designatedReferenceImages : selectedImageInputs;
  const setImageRole = (nodeId: string, role: StoryboardInputRole) => {
    set({
      storyboardInputRoles: {
        ...(node.metadata?.storyboardInputRoles || inputSelection.roles),
        [nodeId]: role,
      },
    });
  };
  const toggleImageAsReference = (nodeId: string, currentlyReference: boolean) => {
    setImageRole(nodeId, currentlyReference ? "input" : "reference");
  };
  const autoShotCount = useMemo(() => {
    if (batchMode === "variants") return variantCount;
    // 后台「画布批量生成上限」同样约束按参考图/按脚本拆分的镜头数。
    if (batchMode === "refs") return Math.min(batchMaxCount, driverImages.length);
    return Math.min(batchMaxCount, detectStoryboardShotCount(script, style, parseMode) || (script.trim() ? 1 : 0));
  }, [batchMode, variantCount, batchMaxCount, driverImages.length, script, style, parseMode]);
  const promptPreviewRows = useMemo(() => {
    if (batchMode === "variants" || batchMode === "refs") {
      const trimmed = script.trim();
      return trimmed ? [trimmed] : [];
    }
    return splitStoryboardDisplayLines(script, { style, mode: parseMode });
  }, [batchMode, parseMode, script, style]);
  const generationStage = node.metadata?.generationStage;
  const executionStatus = node.metadata?.executionStatus;
  const running =
    isRunning ||
    executionStatus === "running" ||
    generationStage === "formatting" ||
    generationStage === "analyzing" ||
    generationStage === "generating";
  const failed = executionStatus === "failed" || generationStage === "failed";
  const completed = !running && (executionStatus === "succeeded" || generationStage === "completed");
  const canceled = !running && (executionStatus === "canceled" || generationStage === "canceled");
  const accent = theme.node.activeStroke;
  const imageConfig = buildNodeConfig(globalConfig, node, "image");
  const stopLabel = t("canvas.storyboard.configStopGenerate");
  const imageParamsSummary = [
    imageConfig.size ? imageSizeLabel(imageConfig.size, imageConfig.resolution) : "",
    imageConfig.quality ? imageQualityLabel(imageConfig.quality) : "",
  ]
    .filter(Boolean)
    .join(" · ") || t("canvas.configNode.params");
  const parseOptions = useMemo(
    () =>
      (["lines", "paragraphs", "markers"] as StoryboardParseMode[]).map((mode) => ({
        value: mode,
        label: t(STORYBOARD_PARSE_MODE_LABELS[mode]),
      })),
    [t],
  );
  const surface = colorWash(theme.node.text, theme.scheme === "dark" ? 0.08 : 0.05);

  return (
    <div
      data-canvas-no-zoom
      data-canvas-shortcuts-ignore
      className="canvas-config-node canvas-storyboard-config-node flex h-full w-full cursor-move flex-col gap-2 px-3 py-2.5"
      style={{ color: theme.node.text }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className={`canvas-batch-mode-switch grid grid-cols-3 gap-1 rounded-xl p-1 ${running ? "pointer-events-none opacity-55" : ""}`}
        style={{ background: theme.toolbar.itemHover }}
      >
        {([
          { id: "split" as const, label: t("canvas.storyboard.batchModeSplit") },
          { id: "variants" as const, label: t("canvas.storyboard.batchModeVariants") },
          { id: "refs" as const, label: t("canvas.storyboard.batchModeRefs") },
        ]).map((mode) => {
          const active = batchMode === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              className="canvas-batch-mode-switch-btn"
              style={{
                background: active ? (theme.scheme === "dark" ? "rgba(255,255,255,.1)" : "#ffffff") : "transparent",
                color: active ? theme.node.text : theme.node.muted,
                fontWeight: active ? 600 : 500,
                boxShadow: active && theme.scheme !== "dark" ? "0 1px 3px rgba(20,16,40,.12)" : "none",
                transition: "background .2s ease, color .2s ease, box-shadow .2s ease",
              }}
              aria-pressed={active}
              title={mode.label}
              onClick={() => set({ batchMode: mode.id })}
            >
              {mode.label}
            </button>
          );
        })}
      </div>

      <div className={running ? "pointer-events-none opacity-55" : ""}>
        <StoryboardModelParamsRow
          theme={theme}
          config={imageConfig}
          mode="image"
          modelPlaceholder={t("canvas.configNode.model")}
          paramsSummary={imageParamsSummary}
          onModelChange={(model) => set(canvasImageSettingsFromModel(imageConfig, model))}
          onMissingConfig={() => openConfigDialog(true)}
        >
          <ImageSettingsPanel
            config={imageConfig}
            theme={theme}
            showTitle={false}
            embedded
            showDimensions={false}
            showAspectRatio
            showCount={false}
            onConfigChange={(key, value) =>
              set(
                key === "size"
                  ? { size: value, storyboardAspectRatio: value }
                  : { [key]: value },
              )
            }
          />
        </StoryboardModelParamsRow>
      </div>

      <div
        className={`canvas-storyboard-script-field min-h-0 flex-1 rounded-[14px] px-2.5 pt-2 pb-2 ${running ? "is-locked" : ""}`}
        style={{ background: theme.toolbar.itemHover, opacity: running ? 0.72 : 1 }}
      >
        <div className="canvas-storyboard-script-field-head shrink-0">
          <span className="canvas-storyboard-script-field-label" style={{ color: theme.node.muted }}>
            {t("canvas.storyboard.configPromptAria")}
          </span>
          <div className="canvas-storyboard-script-field-meta">
            {autoShotCount ? (
              <span className="canvas-storyboard-shot-count" style={{ color: accent }}>
                {t("canvas.storyboard.configShots", { count: autoShotCount })}
              </span>
            ) : null}
            {hasStaleConnectedScript ? (
              <button
                type="button"
                className="canvas-storyboard-sync-source"
                title={t("canvas.storyboard.configSyncConnectedTitle")}
                onClick={followConnectedScript}
              >
                {t("canvas.storyboard.configSyncConnected")}
              </button>
            ) : followsConnectedScript ? (
              <span className="canvas-storyboard-connected-badge">{t("canvas.storyboard.configConnectedBadge")}</span>
            ) : null}
          </div>
        </div>
        {scriptOverLimit ? (
          <span className="mb-1 shrink-0 px-0.5 text-[10px] leading-4 text-amber-500" role="alert">
            {t("canvas.storyboard.scriptTooLong", { max: STORYBOARD_INPUT_LIMIT })}
          </span>
        ) : null}
        <div
          className={`canvas-storyboard-script-shots is-preview thin-scrollbar min-h-0 flex-1 text-left${batchMode !== "split" ? " is-single-prompt" : ""}`}
          aria-label={t("canvas.storyboard.configPromptAria")}
        >
          {promptPreviewRows.length ? (
            batchMode !== "split" ? (
              <div className="canvas-storyboard-single-prompt">
                <p className="canvas-storyboard-single-prompt-text">{promptPreviewRows[0]}</p>
              </div>
            ) : (
              promptPreviewRows.map((row, index) => (
                <div key={`${index}-${row.slice(0, 24)}`} className="canvas-storyboard-script-shot">
                  <span className="canvas-storyboard-script-shot-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="canvas-storyboard-script-shot-text">{row}</span>
                </div>
              ))
            )
          ) : (
            <div className="canvas-storyboard-empty-shot">
              <ListOrdered className="size-4" />
              <span className="canvas-storyboard-empty-shot-title">
                {t(
                  batchMode === "split"
                    ? "canvas.storyboard.configPlaceholder"
                    : batchMode === "refs"
                      ? "canvas.storyboard.configRefsPlaceholder"
                      : "canvas.storyboard.configVariantsPlaceholder",
                )}
              </span>
              <span className="canvas-storyboard-empty-shot-hint">
                {t(
                  batchMode === "split"
                    ? "canvas.storyboard.configSplitHint"
                    : batchMode === "refs"
                      ? "canvas.storyboard.configRefsPromptHint"
                      : "canvas.storyboard.configVariantsHint",
                )}
              </span>
            </div>
          )}
        </div>
        {batchMode === "split" ? (
          <div className="canvas-storyboard-script-field-foot">
            <CanvasFieldMenu
              value={parseMode}
              options={parseOptions}
              onChange={(mode) => set({ storyboardParseMode: mode })}
              theme={theme}
              surface={surface}
              compact
              menuMinWidth={148}
              title={t("canvas.storyboard.parseMode")}
              triggerClassName="canvas-storyboard-script-toolbar-chip"
            >
              {(menuOpen) => (
                <>
                  <span className="min-w-0 flex-1 truncate">{t(STORYBOARD_PARSE_MODE_LABELS[parseMode])}</span>
                  <ChevronDown className={`size-3 shrink-0 opacity-45 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
                </>
              )}
            </CanvasFieldMenu>
          </div>
        ) : batchMode === "variants" ? (
          <div className="canvas-storyboard-script-field-foot">
            <span className="canvas-storyboard-script-field-foot-label" style={{ color: theme.node.muted }}>
              {t("canvas.storyboard.configVariantCount")}
            </span>
            <StoryboardCountStepper
              value={variantCount}
              max={batchMaxCount}
              disabled={running}
              label={t("canvas.storyboard.configVariantCountAria")}
              theme={theme}
              onChange={(next) => set({ batchVariantCount: next })}
            />
          </div>
        ) : (
          <div className="canvas-storyboard-script-field-foot">
            <span className="canvas-storyboard-script-field-foot-label" style={{ color: theme.node.muted }}>
              {t("canvas.storyboard.configRefsHint")}
            </span>
            <span className="canvas-storyboard-script-field-foot-value" style={{ color: driverImages.length ? accent : theme.node.muted }}>
              {t("canvas.configNode.images", { count: driverImages.length })}
            </span>
          </div>
        )}
      </div>

      <div className={`flex flex-col gap-2 ${running ? "pointer-events-none opacity-55" : ""}`}>
        {batchMode === "refs" ? (
          <>
            <StoryboardBatchImageRow
              label={t("canvas.storyboard.configInputImages")}
              images={driverImages}
              theme={theme}
              accent={accent}
              emptyLabel={t("canvas.storyboard.refsRequired")}
              maxThumbs={8}
              asReference={false}
              onToggleReference={toggleImageAsReference}
            />
            <StoryboardBatchImageRow
              label={t("canvas.storyboard.configReferenceImages")}
              images={designatedReferenceImages}
              theme={theme}
              accent={accent}
              emptyLabel={t("canvas.storyboard.configMarkAsReference")}
              maxThumbs={4}
              asReference
              onToggleReference={toggleImageAsReference}
              showEmpty={Boolean(driverImages.length)}
            />
          </>
        ) : referenceImages.length ? (
          <div className="canvas-storyboard-reference-row" title={t("canvas.configNode.references")}>
            <span className="canvas-storyboard-reference-label" style={{ color: theme.node.muted }}>
              {t("canvas.configNode.references")}
            </span>
            <div className="canvas-storyboard-reference-thumbs">
              {referenceImages.slice(0, 4).map((input, index) => (
                <span
                  key={`${input.nodeId}:${index}`}
                  className="canvas-storyboard-reference-thumb"
                  style={{
                    background: theme.node.fill,
                    borderColor: theme.toolbar.border,
                    zIndex: 4 - index,
                  }}
                  title={input.title || t("canvas.configNode.references")}
                >
                  <CanvasPreviewImage
                    src={input.image?.dataUrl}
                    storageKey={input.image?.storageKey}
                    alt={input.title}
                    maxEdge={96}
                    className="size-full object-cover"
                  />
                </span>
              ))}
              {referenceImages.length > 4 ? (
                <span
                  className="canvas-storyboard-reference-more"
                  style={{
                    background: theme.toolbar.panel,
                    borderColor: theme.toolbar.border,
                    color: theme.node.muted,
                  }}
                >
                  +{referenceImages.length - 4}
                </span>
              ) : null}
            </div>
            <span className="canvas-storyboard-reference-count" style={{ color: theme.node.muted }}>
              {t("canvas.configNode.images", { count: referenceImages.length })}
            </span>
          </div>
        ) : null}
      </div>

      <button
        type="button"
        className="canvas-config-generate inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[11px] text-[12px] font-semibold transition disabled:opacity-50"
        style={{
          background: running ? theme.node.text : `linear-gradient(135deg, #9b7bff 0%, ${theme.node.activeStroke} 60%, #3d7bff 100%)`,
          color: running ? theme.node.panel : "#fff",
          boxShadow: running ? "none" : "0 8px 18px rgba(109,92,255,.26)",
        }}
        disabled={!running && (!script.trim() || (batchMode === "refs" && !driverImages.length))}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => (running ? onStopGeneration(node.id) : onGenerate(node.id))}
      >
        {running
          ? stopLabel
          : completed || failed || canceled
            ? t("canvas.storyboard.configRegenerate", { count: Math.max(1, autoShotCount || 1) })
            : t("canvas.storyboard.configGenerateAuto", { count: Math.max(1, autoShotCount || 1) })}
      </button>
    </div>
  );
}


const COUNT_STEPPER_MIN = 1;
const COUNT_STEPPER_HOLD_DELAY_MS = 380;
const COUNT_STEPPER_HOLD_INTERVAL_MS = 80;

function StoryboardCountStepper({
  value,
  max,
  disabled,
  label,
  theme,
  onChange,
}: {
  value: number;
  max: number;
  disabled: boolean;
  label: string;
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  onChange: (next: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const holdRef = useRef<{ delay?: number; repeat?: number }>({});

  const endHold = useRef(() => {
    window.clearTimeout(holdRef.current.delay);
    window.clearInterval(holdRef.current.repeat);
    holdRef.current = {};
  }).current;

  useEffect(() => endHold, [endHold]);

  const nudge = (delta: number) => {
    const next = Math.min(max, Math.max(COUNT_STEPPER_MIN, valueRef.current + delta));
    if (next !== valueRef.current) onChange(next);
  };

  // Hold either arrow to keep stepping, so large counts don't need dozens of clicks.
  const beginHold = (event: ReactPointerEvent, delta: number) => {
    if (event.button !== 0) return;
    endHold();
    nudge(delta);
    holdRef.current.delay = window.setTimeout(() => {
      holdRef.current.repeat = window.setInterval(() => nudge(delta), COUNT_STEPPER_HOLD_INTERVAL_MS);
    }, COUNT_STEPPER_HOLD_DELAY_MS);
    window.addEventListener("pointerup", endHold, { once: true });
    window.addEventListener("pointercancel", endHold, { once: true });
  };

  const commitDraft = () => {
    if (draft === null) return;
    const parsed = Math.floor(Number(draft));
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    const next = Math.min(max, Math.max(COUNT_STEPPER_MIN, parsed));
    if (next !== value) onChange(next);
  };

  return (
    <div className="canvas-storyboard-count-stepper" style={{ background: colorWash(theme.node.text, 0.06) }}>
      <button
        type="button"
        disabled={disabled || value <= COUNT_STEPPER_MIN}
        aria-label={`${label} -`}
        onPointerDown={(event) => beginHold(event, -1)}
        onPointerLeave={endHold}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        style={{ color: theme.node.text }}
        value={draft ?? String(value)}
        disabled={disabled}
        aria-label={label}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => setDraft(event.target.value.replace(/\D/g, "").slice(0, 3))}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          else if (event.key === "ArrowUp") nudge(1);
          else if (event.key === "ArrowDown") nudge(-1);
          else return;
          event.preventDefault();
        }}
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        aria-label={`${label} +`}
        onPointerDown={(event) => beginHold(event, 1)}
        onPointerLeave={endHold}
      >
        +
      </button>
    </div>
  );
}

function StoryboardBatchImageRow({
  label,
  images,
  theme,
  accent,
  emptyLabel,
  maxThumbs,
  asReference,
  onToggleReference,
  showEmpty = true,
}: {
  label: string;
  images: NodeGenerationInput[];
  theme: (typeof canvasThemes)[keyof typeof canvasThemes];
  accent: string;
  emptyLabel: string;
  maxThumbs: number;
  asReference: boolean;
  onToggleReference: (nodeId: string, currentlyReference: boolean) => void;
  showEmpty?: boolean;
}) {
  const { t } = useTranslation();
  if (!images.length) {
    if (!showEmpty) return null;
    return (
      <div className="canvas-storyboard-reference-row is-empty" style={{ color: theme.node.muted }}>
        <ImageIcon className="size-3.5 shrink-0 opacity-60" />
        <span className="canvas-storyboard-reference-label" style={{ color: theme.node.muted }}>{label}</span>
        <span className="min-w-0 truncate text-[11px] font-medium">{emptyLabel}</span>
      </div>
    );
  }
  const toggleLabel = asReference
    ? t("canvas.storyboard.configMarkAsInput")
    : t("canvas.storyboard.configMarkAsReference");
  return (
    <div className="canvas-storyboard-reference-row" title={label}>
      <span className="canvas-storyboard-reference-label" style={{ color: theme.node.muted }}>{label}</span>
      <div className="canvas-storyboard-reference-thumbs is-editable">
        {images.slice(0, maxThumbs).map((input, index) => (
          <button
            key={`${input.nodeId}:${index}`}
            type="button"
            className={`canvas-storyboard-reference-thumb is-editable${asReference ? " is-reference" : ""}`}
            style={{ background: theme.node.fill, borderColor: asReference ? accent : theme.toolbar.border, zIndex: maxThumbs - index }}
            title={`${input.title || label} · ${toggleLabel}`}
            aria-label={toggleLabel}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={() => onToggleReference(input.nodeId, asReference)}
          >
            <CanvasPreviewImage
              src={input.image?.dataUrl}
              storageKey={input.image?.storageKey}
              alt={input.title}
              maxEdge={96}
              className="size-full object-cover"
            />
            <span
              className="canvas-storyboard-reference-badge"
              style={{ color: asReference ? "#fff" : accent, background: asReference ? accent : theme.toolbar.panel }}
            >
              {asReference ? t("canvas.storyboard.configReferenceImages") : t("canvas.storyboard.configInputImages")}
            </span>
          </button>
        ))}
        {images.length > maxThumbs ? (
          <span
            className="canvas-storyboard-reference-more"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.muted }}
          >
            +{images.length - maxThumbs}
          </span>
        ) : null}
      </div>
      <span className="canvas-storyboard-reference-count" style={{ color: theme.node.muted }}>
        {t("canvas.configNode.images", { count: images.length })}
      </span>
    </div>
  );
}


function StoryboardModelParamsRow({
  theme,
  config,
  mode,
  modelPlaceholder,
  paramsSummary,
  onModelChange,
  onMissingConfig,
  onTextParamsChange,
  trailing,
  children,
}: {
  theme: CanvasTheme;
  config: AiConfig;
  mode: CanvasGenerationMode;
  modelPlaceholder: string;
  paramsSummary: string;
  onModelChange: (model: string) => void;
  onMissingConfig: () => void;
  onTextParamsChange?: (value: ReasoningEffort) => void;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const { buttonRef, panelRef, open, buttonRect, updateOpen } = useAnchorPopover();
  const surface = theme.toolbar.itemHover;
  // Matches ConfigModelField's trigger so the stacked model and params rows line up.
  const paramsButtonClass = "flex h-9 w-full min-w-0 items-center gap-2.5 rounded-[10px] px-3 text-left";
  const modelMeta = modelOptionMeta(config, config.model);
  const reasoningOptions = useMemo(() => {
    if (mode !== "text") return [];
    return canvasReasoningEfforts(modelMeta).map((effort) => ({
      value: effort,
      label: STUDIO_REASONING_EFFORT_LABELS[effort] || reasoningEffortLabel(effort),
    }));
  }, [mode, modelMeta]);
  const activeReasoning =
    resolveCanvasReasoningEffort(modelMeta, config.reasoningEffort) || config.reasoningEffort || "";

  return (
    <div className="canvas-storyboard-model-params-row flex min-w-0 flex-col gap-1.5">
      <div className="min-w-0">
        <ConfigModelField
          config={config}
          mode={mode}
          theme={theme}
          surface={surface}
          placeholder={modelPlaceholder}
          menuMinWidth={300}
          onChange={onModelChange}
          onMissingConfig={onMissingConfig}
        />
      </div>
      <div className="min-w-0">
        {mode === "text" && onTextParamsChange ? (
          reasoningOptions.length ? (
            <>
              <AnchorPopoverTrigger
                buttonRef={buttonRef}
                open={open}
                onToggle={() => updateOpen(!open)}
                fullWidth
                className={paramsButtonClass}
                style={{ background: surface, color: theme.node.text }}
              >
                <span className="shrink-0 text-[13px] font-semibold">{t("canvas.configNode.params")}</span>
                <span className="min-w-0 flex-1 truncate text-right text-[11px]" style={{ color: theme.node.muted }}>
                  {paramsSummary}
                </span>
                <ChevronDown
                  className="size-3.5 shrink-0 opacity-45 transition-transform duration-200"
                  style={{ transform: open ? "rotate(180deg)" : "none" }}
                />
              </AnchorPopoverTrigger>
              {open && buttonRect ? (
                <AnchorPopoverPanel
                  buttonRect={buttonRect}
                  panelRef={panelRef}
                  placement="bottomLeft"
                  theme={theme}
                  width={312}
                  padding={0}
                  autoFlip
                  estimatedHeight={140}
                >
                  <div className="canvas-storyboard-reasoning-host">
                    <StudioReasoningSlider
                      options={reasoningOptions}
                      value={activeReasoning}
                      onChange={(value: ModelReasoningEffort) => onTextParamsChange(value)}
                      onClose={() => updateOpen(false)}
                      modelLabel={modelOptionLabel(config, config.model) || config.model}
                      style={{ position: "relative", top: "auto", left: "auto", width: "100%" }}
                      className="canvas-storyboard-reasoning-slider"
                      renderPrice={(option: { value: string }) => (
                        <StoryboardReasoningPrice model={modelMeta} effort={option?.value} />
                      )}
                    />
                  </div>
                </AnchorPopoverPanel>
              ) : null}
            </>
          ) : null
        ) : (
          <>
            <AnchorPopoverTrigger
              buttonRef={buttonRef}
              open={open}
              onToggle={() => updateOpen(!open)}
              fullWidth
              className={paramsButtonClass}
              style={{ background: surface, color: theme.node.text }}
            >
              <span className="shrink-0 text-[13px] font-semibold">{t("canvas.configNode.params")}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[11px]" style={{ color: theme.node.muted }}>
                {paramsSummary}
              </span>
              <ChevronDown
                className="size-3.5 shrink-0 opacity-45 transition-transform duration-200"
                style={{ transform: open ? "rotate(180deg)" : "none" }}
              />
            </AnchorPopoverTrigger>
            {open && buttonRect ? (
              <AnchorPopoverPanel
                buttonRect={buttonRect}
                panelRef={panelRef}
                placement="bottomLeft"
                theme={theme}
                width={320}
                padding={12}
                autoFlip
                estimatedHeight={280}
              >
                {children}
              </AnchorPopoverPanel>
            ) : null}
          </>
        )}
      </div>
      {trailing ? <div className="min-w-0">{trailing}</div> : null}
    </div>
  );
}

function StoryboardReasoningPrice({
  model,
  effort,
}: {
  model: ReturnType<typeof modelOptionMeta>;
  effort?: string;
}) {
  const cost = resolveCanvasTextPrice(model, effort);
  if (cost.effective === undefined) return null;
  const hasDiscount = cost.standard !== undefined && cost.standard > cost.effective;
  return (
    <span className={`studio-composer__model-price${hasDiscount ? " has-discount" : ""}`}>
      {hasDiscount ? (
        <>
          <strong>
            折扣 {cost.effective} 积分
          </strong>
          <del>{cost.standard} 积分</del>
        </>
      ) : (
        <strong>{cost.effective === 0 ? "免费" : `${cost.effective} 积分`}</strong>
      )}
    </span>
  );
}

function CanvasInlineOutputPreview({
  outputNode,
  mode,
}: {
  outputNode?: CanvasNodeData;
  mode: CanvasGenerationMode;
}) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const content = outputNode?.metadata?.content || "";
  const loading = outputNode?.metadata?.status === "loading";
  const error =
    outputNode?.metadata?.status === "error"
      ? outputNode.metadata.errorDetails
      : "";
  return (
    <div
      className="relative min-h-0 flex-1 overflow-hidden border-t"
      style={{
        borderColor: theme.node.stroke,
        background: theme.toolbar.itemHover,
      }}
    >
      {mode === "text" && content ? (
        <div
          className="thin-scrollbar h-full overflow-y-auto whitespace-pre-wrap break-words p-3 text-[12px] leading-5"
          style={{ color: theme.node.text }}
          data-canvas-no-zoom
        >
          {content}
        </div>
      ) : mode === "image" && content ? (
        <CanvasPreviewImage
          src={content}
          storageKey={outputNode?.metadata?.storageKey}
          thumbnailUrl={outputNode?.metadata?.thumbnailUrl}
          alt={outputNode?.title || ""}
          className="h-full w-full object-contain"
        />
      ) : (
        <div
          className="flex h-full flex-col items-center justify-center gap-2 px-5 text-center text-[12px]"
          style={{ color: error ? "#ef4444" : theme.node.muted }}
        >
          {loading ? (
            <span className="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : null}
          <span>
            {error ||
              (loading
                ? t("canvas.node.generating")
                : t("canvas.node.emptyImage"))}
          </span>
        </div>
      )}
    </div>
  );
}

function CanvasGenerationConfigNodePanel({
  node,
  isRunning,
  inputSummary,
  inputs,
  onConfigChange,
  onGenerate,
  onStopGeneration,
  onCancelQueued,
  onComposerToggle,
}: CanvasConfigNodePanelProps) {
  const { t } = useTranslation();
  const globalConfig = useEffectiveConfig();
  const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const dark = theme.scheme === "dark";
  const requestedMode = node.metadata?.generationMode || "image";
  const mode = isCanvasGenerationModeEnabled(requestedMode)
    ? requestedMode
    : "image";
  const color = nodeTypeColor(mode, undefined, theme.scheme);
  const config = buildNodeConfig(globalConfig, node, mode);
  const hasAnyInput = Boolean(
    inputSummary.textCount ||
    inputSummary.imageCount ||
    inputSummary.videoCount ||
    inputSummary.audioCount,
  );
  const hasComposerContent = Boolean(
    (node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim(),
  );
  const canGenerate =
    hasComposerContent ||
    (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);
  const stats = inputStats(mode, inputSummary, t, theme.scheme);
  const fieldStyle = {
    background: theme.toolbar.itemHover,
    color: theme.node.text,
  };
  const cost = estimateCanvasGenerationCost({
    config,
    kind: mode === "text" ? "text" : "image",
  });
  const hasPreviousOutput = Boolean(
    node.metadata?.workflowOutputNodeIds?.length,
  );
  const generateLabel = t(
    hasPreviousOutput
      ? "canvas.configNode.regenerate"
      : "canvas.configNode.generate",
  );
  const generatePrice =
    cost.total > 0 ? `${cost.total.toLocaleString()} 积分` : undefined;
  const generateComparePrice =
    cost.compareTotal && cost.compareTotal > cost.total
      ? String(cost.compareTotal)
      : undefined;
  const executionStatus = node.metadata?.executionStatus;
  const queued = isUnsubmittedCanvasGeneration(node);
  const generating = (isRunning || executionStatus === "running") && !queued;
  const elapsedMs = useGenerationElapsed(
    node.metadata?.generationStartedAt,
    node.metadata?.generationDurationMs,
    generating,
  );
  const completedAt = node.metadata?.generationCompletedAt;
  const referenceImages = inputs.filter((input) => Boolean(input.image));

  return (
    <div
      data-color-scheme={theme.scheme}
      className="canvas-config-node canvas-config-refined flex h-full w-full cursor-move flex-col rounded-[inherit] px-3 py-2.5"
      style={{
        color: theme.node.text,
        background: dark ? theme.node.fill : "#ffffff",
      }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className={`canvas-config-mode-switch grid h-9 shrink-0 ${MODE_TAB_COLS} gap-0.5 rounded-[11px] p-[3px]`} style={{ background: dark ? "rgba(255,255,255,.05)" : "#f3f1f8" }}>
        {VISIBLE_MODES.map((item) => {
          const active = mode === item.value;
          const Icon = item.icon;
          return (
            <button
              key={item.value}
              type="button"
              aria-pressed={active}
              className="relative flex items-center justify-center gap-1.5 rounded-[8px] text-[12px] transition-[background,color,box-shadow] duration-200"
              style={{
                color: active ? theme.node.text : theme.node.muted,
                fontWeight: active ? 600 : 500,
                background: active ? (dark ? "rgba(255,255,255,.1)" : "#ffffff") : "transparent",
                boxShadow: active && !dark ? "0 1px 3px rgba(20,16,40,.12)" : "none",
              }}
              onClick={() => onConfigChange(node.id, { generationMode: item.value })}
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">
                {t(`canvas.configNode.${item.labelKey}`)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="canvas-config-body mt-2 flex min-w-0 shrink-0 flex-col gap-2">
        <div className="canvas-config-model-row">
          <ConfigModelField
            config={config}
            mode={mode}
            theme={theme}
            surface="transparent"
            placeholder={t("canvas.configNode.model")}
            onChange={(model) =>
              onConfigChange(
                node.id,
                canvasImageSettingsFromModel(config, model),
              )
            }
            onMissingConfig={() => openConfigDialog(true)}
          />
        </div>
        <div className="canvas-config-parameters">
          {mode === "image" ? (
            <ImageSettingsPanel
              config={config}
              theme={theme}
              showTitle={false}
              embedded
              showDimensions={false}
              onConfigChange={(key, value) =>
                onConfigChange(
                  node.id,
                  key === "count"
                    ? { count: Number(value) || 1 }
                    : { [key]: value },
                )
              }
            />
          ) : mode === "text" ? (
            <TextSettingsPanel
              config={config}
              theme={theme}
              embedded
              onConfigChange={(_, value) =>
                onConfigChange(node.id, { reasoningEffort: value })
              }
            />
          ) : (
            <SettingsField
              mode={mode}
              config={config}
              nodeId={node.id}
              fieldStyle={fieldStyle}
              onConfigChange={onConfigChange}
            />
          )}
        </div>
      </div>

      <button
        type="button"
        className="canvas-config-input-card group mt-2.5 flex min-h-[64px] w-full min-w-0 flex-1 flex-col gap-2 rounded-[12px] px-3 py-2.5 text-left transition-colors"
        style={{
          background: dark ? "rgba(255,255,255,.035)" : "#f8f7fb",
          boxShadow: hasComposerContent || stats.some((item) => item.value > 0) ? "none" : `inset 0 0 0 1.5px ${dark ? "#3a3647" : "#e3dfee"}`,
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onComposerToggle}
      >
        <span className="flex w-full items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: theme.node.muted }}>
            {t("canvas.configNode.prompt")}
          </span>
          <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-semibold" style={{ color: hasComposerContent ? theme.node.activeStroke : theme.node.muted }}>
            {t(hasComposerContent ? "canvas.configNode.composed" : "canvas.configNode.compose")}
            <ChevronRight className="size-3.5 opacity-70 transition-transform group-hover:translate-x-0.5" />
          </span>
        </span>
        {hasComposerContent ? (
          <span className="line-clamp-3 w-full whitespace-pre-wrap break-words text-[12px] leading-[1.65]" style={{ color: theme.node.text }}>
            {(node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim()}
          </span>
        ) : (
          <span className="text-[12px] leading-[1.6]" style={{ color: theme.node.faint }}>
            {stats.some((item) => item.value > 0) ? t("canvas.configNode.composed") : t("canvas.configNode.emptyInputs")}
          </span>
        )}
        <span className="mt-auto flex w-full min-w-0 items-center gap-2">
          {referenceImages.length ? (
            <span className="flex shrink-0 -space-x-1.5">
              {referenceImages.slice(0, 4).map((input, index) => (
                <span key={`${input.nodeId}:${index}`} className="relative grid size-6 overflow-hidden rounded-[7px] border-2" style={{ borderColor: dark ? theme.node.fill : "#f8f7fb", zIndex: 4 - index }}>
                  <CanvasPreviewImage src={input.image?.dataUrl} storageKey={input.image?.storageKey} alt={input.title} maxEdge={96} className="size-full object-cover" />
                </span>
              ))}
            </span>
          ) : null}
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
            {stats.map((item) => (
              <span key={item.label} style={{ color: item.value > 0 ? theme.node.text : theme.node.muted }}>
                <b className="font-semibold">{item.value}</b> {item.label}
              </span>
            ))}
          </span>
        </span>
      </button>
      {queued ? (
        <div
          className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]"
          style={{ color: theme.node.muted }}
        >
          <Clock3 className="size-3.5" />
          <span>{t("canvas.configNode.queued")}</span>
        </div>
      ) : generating ? (
        <div
          className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]"
          style={{ color: theme.node.muted }}
        >
          <Clock3 className="size-3.5" />
          <span className="truncate">
            {canvasGenerationStageLabel(node.metadata?.generationStage)}
          </span>
          <span className="tabular-nums opacity-70">
            {formatGenerationDuration(elapsedMs)}
          </span>
        </div>
      ) : executionStatus === "succeeded" && completedAt ? (
        <div
          className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]"
          style={{ color: theme.node.muted }}
        >
          <CheckCircle2
            className="size-3.5"
            style={{ color: dark ? "#4ade80" : "#16845b" }}
          />
          <span>
            {t("canvas.configNode.generatedAt", {
              time: formatGenerationTime(completedAt),
            })}
          </span>
          <span className="opacity-45">·</span>
          <span className="tabular-nums">
            {t("canvas.configNode.duration", {
              duration: formatGenerationDuration(elapsedMs),
            })}
          </span>
        </div>
      ) : executionStatus === "failed" && completedAt ? (
        <div className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px] text-red-600">
          <Clock3 className="size-3.5" />
          <span>
            {t("canvas.configNode.failedAt", {
              time: formatGenerationTime(completedAt),
            })}
          </span>
          <span className="opacity-45">·</span>
          <span className="tabular-nums">
            {t("canvas.configNode.duration", {
              duration: formatGenerationDuration(elapsedMs),
            })}
          </span>
        </div>
      ) : executionStatus === "canceled" && completedAt ? (
        <div
          className="mt-2.5 flex h-7 shrink-0 items-center gap-1.5 px-1 text-[11px]"
          style={{ color: theme.node.muted }}
        >
          <Clock3 className="size-3.5" />
          <span>
            {t("canvas.configNode.canceledAt", {
              time: formatGenerationTime(completedAt),
            })}
          </span>
          <span className="opacity-45">·</span>
          <span className="tabular-nums">
            {t("canvas.configNode.duration", {
              duration: formatGenerationDuration(elapsedMs),
            })}
          </span>
        </div>
      ) : null}

      <button
        type="button"
        className="canvas-config-generate mt-2 inline-flex h-9 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-semibold transition disabled:cursor-not-allowed"
        style={{
          background: queued
            ? "#b97716"
            : generating
              ? theme.node.text
              : canGenerate
                ? `linear-gradient(135deg, #9b7bff 0%, ${theme.node.activeStroke} 60%, #3d7bff 100%)`
                : dark
                  ? "rgba(255,255,255,.06)"
                  : "#f1eff6",
          color: generating ? theme.node.panel : canGenerate || queued ? "#fff" : theme.node.muted,
          boxShadow: queued || generating || !canGenerate ? "none" : "0 8px 18px rgba(109,92,255,.28)",
        }}
        disabled={!queued && !generating && !canGenerate}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() =>
          queued
            ? onCancelQueued(node.id)
            : generating
              ? onStopGeneration(node.id)
              : onGenerate(node.id)
        }
      >
        {queued ? (
          <>
            <X className="size-4" />
            {t("canvas.configNode.cancelQueued")}
          </>
        ) : generating ? (
          <>
            <Square className="size-3.5 fill-current" />
            {t("canvas.configNode.stopWithDuration", {
              duration: formatGenerationDuration(elapsedMs),
            })}
          </>
        ) : (
          <>
            <Play className="size-4 fill-current" />
            {generateLabel}
            {generatePrice ? (
              <>
                <span className="opacity-40">·</span>
                <CanvasPriceMark
                  price={generatePrice}
                  comparePrice={generateComparePrice}
                />
              </>
            ) : null}
          </>
        )}
      </button>
    </div>
  );
}

function CanvasLocalImageOperationPanel({
  node,
  isRunning,
  inputSummary,
  inputs,
  onGenerate,
  onStopGeneration,
  onCancelQueued,
  onConfigureOperation,
}: Pick<
  CanvasConfigNodePanelProps,
  | "node"
  | "isRunning"
  | "inputSummary"
  | "inputs"
  | "onGenerate"
  | "onStopGeneration"
  | "onCancelQueued"
  | "onConfigureOperation"
>) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const operation = node.metadata?.localImageOperation;
  if (!isCanvasLocalImageOperation(operation)) return null;
  const Icon =
    operation === "crop" ? Crop : operation === "split" ? Grid2x2 : Maximize2;
  const label = t(`canvas.imageTools.${operation}`);
  const count = canvasLocalImageOperationOutputCount(
    operation,
    node.metadata?.localImageOperationParams,
  );
  const summary = localOperationSummary(
    operation,
    node.metadata?.localImageOperationParams,
    t,
  );
  const queued = isUnsubmittedCanvasGeneration(node);
  const executionStatus = node.metadata?.executionStatus;
  const running = (isRunning || executionStatus === "running") && !queued;
  const elapsedMs = useGenerationElapsed(
    node.metadata?.generationStartedAt,
    node.metadata?.generationDurationMs,
    running,
  );
  const hasOutput = Boolean(node.metadata?.workflowOutputNodeIds?.length);
  const canRun = inputSummary.imageCount === 1;
  const accent = nodeTypeColor("image", undefined, theme.scheme);
  const inputImage = inputs.find((input) => Boolean(input.image))?.image;
  const completedCount = Math.min(
    count,
    Math.max(0, node.metadata?.localImageOperationCompletedCount || 0),
  );

  return (
    <div
      className="canvas-config-node flex h-full w-full cursor-move flex-col px-3 py-2.5"
      style={{ color: theme.node.text }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex h-10 shrink-0 items-center gap-2.5">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-[9px]"
          style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
        >
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{label}</div>
        </div>
        <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
          {t("canvas.configNode.images", { count: inputSummary.imageCount })}
        </span>
      </div>

      <button
        type="button"
        className="group/op relative mt-1.5 min-h-0 w-full flex-1 overflow-hidden rounded-[12px] text-left"
        style={{ background: theme.toolbar.itemHover }}
        title={t("canvas.configNode.configureOperation")}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => onConfigureOperation(node)}
      >
        {inputImage ? (
          <CanvasPreviewImage
            src={inputImage.dataUrl}
            storageKey={inputImage.storageKey}
            alt={label}
            maxEdge={480}
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span
            className="absolute inset-2 flex flex-col items-center justify-center gap-1 rounded-[10px] border-[1.5px] border-dashed text-[12px] font-medium"
            style={{ borderColor: theme.scheme === "dark" ? "#3a3647" : "#dcd7e7", color: theme.node.muted }}
          >
            <ImageIcon className="size-4 opacity-70" />
            {t("canvas.configNode.operationInput")}
          </span>
        )}
        {inputImage && operation === "crop" ? <span className="pointer-events-none absolute inset-[12%_10%] rounded-[3px] border-2 border-white" style={{ boxShadow: "0 0 0 999px rgba(12,10,20,.42)" }} /> : null}
        {inputImage && operation === "split" ? (
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "linear-gradient(90deg, transparent calc(33.33% - 1px), rgba(255,255,255,.9) calc(33.33% - 1px), rgba(255,255,255,.9) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent calc(66.66% - 1px), rgba(255,255,255,.9) calc(66.66% - 1px), rgba(255,255,255,.9) calc(66.66% + 1px), transparent calc(66.66% + 1px)), linear-gradient(180deg, transparent calc(33.33% - 1px), rgba(255,255,255,.9) calc(33.33% - 1px), rgba(255,255,255,.9) calc(33.33% + 1px), transparent calc(33.33% + 1px), transparent calc(66.66% - 1px), rgba(255,255,255,.9) calc(66.66% - 1px), rgba(255,255,255,.9) calc(66.66% + 1px), transparent calc(66.66% + 1px))",
            }}
          />
        ) : null}
        <span className="absolute inset-x-2 bottom-2 flex items-center gap-1.5">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-[8px] px-2 py-1 text-[11px] font-semibold backdrop-blur-sm" style={{ background: "rgba(255,255,255,.92)", color: "#17151f" }}>
            <SlidersHorizontal className="size-3 shrink-0 opacity-70" />
            <span className="truncate">{summary}</span>
          </span>
        </span>
      </button>

      <div
        className="flex min-h-7 shrink-0 items-center gap-1.5 px-0.5 pt-2 text-[11px] tabular-nums"
        style={{
          color: executionStatus === "failed" ? "#e5484d" : running || queued ? "#b45309" : executionStatus === "succeeded" ? (theme.scheme === "dark" ? "#4ade80" : "#15803d") : theme.node.muted,
        }}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${running || queued ? "animate-pulse" : ""}`} style={{ background: "currentColor" }} />
        {queued
          ? t("canvas.configNode.queuedOperation", { operation: label })
          : running
            ? t("canvas.configNode.processingOperationProgress", {
                operation: label,
                completed: completedCount,
                count,
                duration: formatGenerationDuration(elapsedMs),
              })
            : executionStatus === "succeeded"
              ? t("canvas.configNode.operationCompleted", {
                  operation: label,
                  duration: formatGenerationDuration(elapsedMs),
                })
              : executionStatus === "failed"
                ? node.metadata?.errorDetails ||
                  t("canvas.configNode.operationFailed", {
                    operation: label,
                    duration: formatGenerationDuration(elapsedMs),
                  })
                : inputSummary.imageCount > 1
                  ? t("canvas.configNode.singleImageOnly")
                  : t("canvas.configNode.operationReadyLocal", {
                      operation: label,
                    })}
      </div>

      <button
        type="button"
        className="canvas-config-generate mt-2 inline-flex h-9 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[11px] border text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: queued ? "#d97706" : theme.toolbar.itemHover,
          borderColor: queued ? "#d97706" : theme.node.stroke,
          color: queued ? "#fff" : theme.node.text,
        }}
        disabled={!queued && !running && !canRun}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() =>
          queued
            ? onCancelQueued(node.id)
            : running
              ? onStopGeneration(node.id)
              : onGenerate(node.id)
        }
      >
        {queued ? (
          <>
            <X className="size-4" />
            {t("canvas.configNode.cancelQueued")}
          </>
        ) : running ? (
          <>
            <Square className="size-3.5 fill-current" />
            {t("canvas.configNode.stopWithDuration", {
              duration: formatGenerationDuration(elapsedMs),
            })}
          </>
        ) : (
          <>
            <Play className="size-4 fill-current" />
            {t(
              hasOutput
                ? "canvas.configNode.rerunOperation"
                : "canvas.configNode.runOperation",
              { operation: label },
            )}
          </>
        )}
      </button>
    </div>
  );
}

function CanvasAiOperationPanel({
  node,
  isRunning,
  inputSummary,
  inputs,
  onConfigChange,
  onGenerate,
  onStopGeneration,
  onCancelQueued,
  onConfigureOperation,
}: Pick<
  CanvasConfigNodePanelProps,
  | "node"
  | "isRunning"
  | "inputSummary"
  | "inputs"
  | "onConfigChange"
  | "onGenerate"
  | "onStopGeneration"
  | "onCancelQueued"
  | "onConfigureOperation"
>) {
  const { t } = useTranslation();
  const globalConfig = useEffectiveConfig();
  const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const angle = node.type === CanvasOperationNodeType.Angle;
  const mode: CanvasGenerationMode = angle ? "image" : "text";
  const label = t(
    angle
      ? "canvas.operationNodes.angle"
      : "canvas.operationNodes.reversePrompt",
  );
  const color = nodeTypeColor(
    angle ? "image" : "text",
    undefined,
    theme.scheme,
  );
  const config = buildNodeConfig(globalConfig, node, mode);
  const queued = isUnsubmittedCanvasGeneration(node);
  const executionStatus = node.metadata?.executionStatus;
  const running = (isRunning || executionStatus === "running") && !queued;
  const elapsedMs = useGenerationElapsed(
    node.metadata?.generationStartedAt,
    node.metadata?.generationDurationMs,
    running,
  );
  const instruction =
    node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
  const canRun = inputSummary.imageCount === 1 && Boolean(instruction.trim());
  const hasOutput = Boolean(node.metadata?.workflowOutputNodeIds?.length);
  const inputImage = inputs.find((input) => Boolean(input.image))?.image;
  const cost = estimateCanvasGenerationCost({
    config,
    kind: angle ? "image" : "text",
    count: 1,
  });
  const angleSummary = angle
    ? buildAngleLabel(normalizeAngleParams(node.metadata?.imageAngleParams))
    : "";

  return (
    <div
      className="canvas-config-node flex h-full w-full cursor-move flex-col px-3 py-2.5"
      style={{ color: theme.node.text }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="flex h-10 shrink-0 items-center gap-2.5">
        <span
          className="grid size-7 shrink-0 place-items-center rounded-[9px]"
          style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
        >
          {angle ? (
            <SlidersHorizontal className="size-3.5" />
          ) : (
            <MessageSquare className="size-3.5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{label}</div>
        </div>
        <span className="max-w-[55%] shrink-0 truncate text-[11px]" style={{ color: theme.node.muted }}>
          {angle ? angleSummary : t("canvas.operationNodes.reversePromptDescription")}
        </span>
      </div>

      <div className="mt-1.5">
        <ConfigModelField
          config={config}
          mode={mode}
          theme={theme}
          surface={theme.toolbar.itemHover}
          placeholder={t("canvas.configNode.model")}
          onChange={(model) =>
            onConfigChange(
              node.id,
              angle ? canvasImageSettingsFromModel(config, model) : { model },
            )
          }
          onMissingConfig={() => openConfigDialog(true)}
        />
      </div>
      {angle ? (
        <button
          type="button"
          className="mt-2 flex min-h-11 items-center justify-between rounded-xl px-3 text-left"
          style={{ background: theme.toolbar.itemHover }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={() => onConfigureOperation(node)}
        >
          <span className="min-w-0">
            <span
              className="block text-[11px]"
              style={{ color: theme.node.muted }}
            >
              {t("canvas.configNode.angleParams")}
            </span>
            <span className="mt-0.5 block truncate text-[12px] font-semibold">
              {angleSummary}
            </span>
          </span>
          <ChevronRight className="size-4 shrink-0 opacity-45" />
        </button>
      ) : (
        <label
          className="mt-2 block rounded-xl px-3 py-2"
          style={{ background: theme.toolbar.itemHover }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <span
            className="block text-[11px]"
            style={{ color: theme.node.muted }}
          >
            {t("canvas.configNode.analysisInstruction")}
          </span>
          <textarea
            value={instruction}
            rows={3}
            className="mt-1 block max-h-20 min-h-14 w-full resize-none bg-transparent text-[12px] leading-5 outline-none"
            placeholder={t("canvas.configNode.analysisInstructionPlaceholder")}
            onChange={(event) =>
              onConfigChange(node.id, {
                composerContent: event.target.value,
                prompt: event.target.value,
                status: "idle",
                executionStatus: undefined,
                errorDetails: undefined,
              })
            }
          />
        </label>
      )}
      <div
        className="mt-2 flex items-center gap-2.5 rounded-xl px-2 py-1.5"
        style={{ background: theme.toolbar.itemHover }}
      >
        <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-[9px]" style={{ background: theme.node.panel, color: theme.node.muted }}>
          {inputImage ? (
            <CanvasPreviewImage src={inputImage.dataUrl} storageKey={inputImage.storageKey} alt={label} maxEdge={96} className="size-full object-cover" />
          ) : (
            <ImageIcon className="size-4 opacity-60" />
          )}
        </span>
        <span className="flex-1 text-[12px]" style={{ color: theme.node.muted }}>
          {t("canvas.configNode.operationInput")}
        </span>
        <span
          className="text-[12px] font-semibold"
          style={{
            color:
              inputSummary.imageCount === 1
                ? color
                : inputSummary.imageCount > 1
                  ? "#ef4444"
                  : theme.node.muted,
          }}
        >
          {t("canvas.configNode.images", { count: inputSummary.imageCount })}
        </span>
      </div>
      <div
        className="mt-auto flex min-h-7 items-center gap-1.5 px-0.5 pt-3 text-[11px] tabular-nums"
        style={{
          color: executionStatus === "failed" ? "#e5484d" : running || queued ? "#b45309" : executionStatus === "succeeded" ? (theme.scheme === "dark" ? "#4ade80" : "#15803d") : theme.node.muted,
        }}
      >
        {queued
          ? t("canvas.configNode.queuedOperation", { operation: label })
          : running
            ? `${canvasGenerationStageLabel(node.metadata?.generationStage)} · ${formatGenerationDuration(elapsedMs)}`
            : executionStatus === "succeeded"
              ? t("canvas.configNode.operationCompleted", {
                  operation: label,
                  duration: formatGenerationDuration(elapsedMs),
                })
              : executionStatus === "failed"
                ? node.metadata?.errorDetails ||
                  t("canvas.configNode.operationFailed", {
                    operation: label,
                    duration: formatGenerationDuration(elapsedMs),
                  })
                : inputSummary.imageCount > 1
                  ? t("canvas.configNode.singleImageOnly")
                  : t("canvas.configNode.operationReady", { operation: label })}
      </div>
      <button
        type="button"
        className="canvas-config-generate mt-2 inline-flex h-9 w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[11px] text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
        style={{
          background: queued ? "#d97706" : `linear-gradient(135deg, #9b7bff 0%, ${theme.node.activeStroke} 60%, #3d7bff 100%)`,
          color: "#fff",
          boxShadow: queued ? "none" : "0 8px 18px rgba(109,92,255,.26)",
        }}
        disabled={!queued && !running && !canRun}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() =>
          queued
            ? onCancelQueued(node.id)
            : running
              ? onStopGeneration(node.id)
              : onGenerate(node.id)
        }
      >
        {queued ? (
          <>
            <X className="size-4" />
            {t("canvas.configNode.cancelQueued")}
          </>
        ) : running ? (
          <>
            <Square className="size-3.5 fill-current" />
            {t("canvas.configNode.stopWithDuration", {
              duration: formatGenerationDuration(elapsedMs),
            })}
          </>
        ) : (
          <>
            <Play className="size-4 fill-current" />
            {t(
              hasOutput
                ? "canvas.configNode.regenerate"
                : "canvas.configNode.generate",
            )}
            {cost.total > 0 ? (
              <>
                <span className="opacity-40">·</span>
                <CanvasPriceMark
                  price={`${cost.total.toLocaleString()} 积分`}
                />
              </>
            ) : null}
          </>
        )}
      </button>
    </div>
  );
}

function localOperationSummary(
  operation: "crop" | "split" | "upscale",
  value: unknown,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (operation === "crop") {
    const params = normalizeCanvasLocalImageOperationParams("crop", value);
    return t("canvas.configNode.cropSummary", {
      width: Math.round(params.width * 100),
      height: Math.round(params.height * 100),
    });
  }
  if (operation === "split") {
    const params = normalizeCanvasLocalImageOperationParams("split", value);
    return t("canvas.configNode.splitSummary", {
      rows: params.rows,
      columns: params.columns,
    });
  }
  const params = normalizeCanvasLocalImageOperationParams("upscale", value);
  return t("canvas.configNode.upscaleSummary", {
    size: params.targetLongEdge,
    algorithm: t(`canvas.editors.${params.algorithm}`),
  });
}

function normalizeAngleParams(value: unknown) {
  const params =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const horizontalAngle = Number(params.horizontalAngle);
  const pitchAngle = Number(params.pitchAngle);
  const cameraDistance = Number(params.cameraDistance);
  return {
    horizontalAngle: Number.isFinite(horizontalAngle)
      ? Math.max(-60, Math.min(60, horizontalAngle))
      : 45,
    pitchAngle: Number.isFinite(pitchAngle)
      ? Math.max(-45, Math.min(45, pitchAngle))
      : 0,
    cameraDistance: Number.isFinite(cameraDistance)
      ? Math.max(1, Math.min(10, cameraDistance))
      : 4.8,
    wideAngle: Boolean(params.wideAngle),
  };
}

function formatGenerationTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "--:--:--"
    : date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
}

function ConfigModelField({
  config,
  mode,
  theme,
  surface,
  placeholder,
  compact = false,
  menuMinWidth,
  onChange,
  onMissingConfig,
}: {
  config: AiConfig;
  mode: CanvasGenerationMode;
  theme: CanvasTheme;
  surface: string;
  placeholder: string;
  compact?: boolean;
  menuMinWidth?: number;
  onChange: (model: string) => void;
  onMissingConfig: () => void;
}) {
  const options = catalogModelsByCapability(config, mode);
  const availableOptions = selectableModelsByCapability(config, mode);
  const current = config.model || "";
  const meta = current ? modelOptionMeta(config, current) : undefined;
  const priceParts = formatModelPriceParts(meta, config.reasoningEffort);

  if (!availableOptions.length) {
    return (
      <button
        type="button"
        className={`canvas-config-field flex w-full min-w-0 items-center text-left ${compact ? "canvas-storyboard-script-toolbar-chip gap-1.5" : "h-9 gap-2.5 rounded-[10px] px-3"}`}
        style={{ background: surface, color: theme.node.text }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onMissingConfig}
      >
        {!compact ? <SoftMark name="cpu" size="sm" /> : null}
        <span className={`min-w-0 flex-1 truncate ${compact ? "text-[11px] font-medium" : "text-[13px] font-semibold"}`}>
          {placeholder}
        </span>
        <ChevronDown className={`${compact ? "size-3" : "size-3.5"} shrink-0 opacity-35`} />
      </button>
    );
  }

  return (
    <CanvasFieldMenu
      value={current}
      compact={compact}
      menuMinWidth={menuMinWidth ?? (compact ? 120 : 300)}
      options={options.map((model) => {
        const meta = modelOptionMeta(config, model);
        const parts = formatModelPriceParts(meta, config.reasoningEffort);
        return {
          value: model,
          label: (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <ModelMark config={config} model={model} />
              <span className="min-w-0 flex-1 truncate">
                {modelOptionLabel(config, model)}
              </span>
              <ModelMaintenanceBadge model={meta} />
              {!modelMaintenance(meta) ? (
                <CanvasPriceMark
                  price={parts.price}
                  comparePrice={parts.comparePrice}
                />
              ) : null}
            </span>
          ),
          disabled: modelMaintenance(meta),
        };
      })}
      theme={theme}
      surface={surface}
      emptyLabel={placeholder}
      triggerClassName={compact ? "canvas-storyboard-script-toolbar-chip canvas-config-field" : "!h-9 !rounded-[10px] canvas-config-field"}
      onChange={onChange}
    >
      {(open) => (
        <span className={`flex w-full min-w-0 items-center ${compact ? "gap-1.5" : "gap-2.5"}`}>
          {!compact ? <ModelMark config={config} model={current} /> : null}
          <span className={`min-w-0 flex-1 truncate ${compact ? "text-[11px] font-medium" : "text-[13px] font-semibold"}`}>
            {current ? modelOptionLabel(config, current) : placeholder}
          </span>
          {!compact && priceParts.price ? (
            <span className="shrink-0">
              <CanvasPriceMark
                price={priceParts.price}
                comparePrice={priceParts.comparePrice}
              />
            </span>
          ) : null}
          <ChevronDown
            className={`${compact ? "size-3" : "size-3.5"} shrink-0 opacity-35 transition-transform duration-200`}
            style={{ transform: open ? "rotate(180deg)" : "none" }}
          />
        </span>
      )}
    </CanvasFieldMenu>
  );
}

function ModelMark({ config, model }: { config: AiConfig; model: string }) {
  return <ModelCatalogIcon model={modelOptionMeta(config, model)} size="sm" />;
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
      <span className="min-w-0 flex-1 truncate">
        {settingsSummary(mode, config)}
      </span>
    </span>
  );
  const shared = {
    config,
    placement: "topRight" as const,
    fullWidth: true,
    buttonClassName:
      "w-full min-w-0 rounded-[14px] border-0 bg-transparent p-0 text-left text-inherit",
  };

  if (mode === "video") {
    return (
      <CanvasVideoSettingsPopover
        {...shared}
        onConfigChange={(key, value) =>
          onConfigChange(nodeId, videoConfigPatch(key, value))
        }
      >
        {trigger}
      </CanvasVideoSettingsPopover>
    );
  }
  return (
    <CanvasAudioSettingsPopover
      {...shared}
      onConfigChange={(key, value) =>
        onConfigChange(nodeId, audioConfigPatch(key, value))
      }
    >
      {trigger}
    </CanvasAudioSettingsPopover>
  );
}

function inputStats(
  mode: CanvasGenerationMode,
  inputSummary: CanvasConfigNodePanelProps["inputSummary"],
  t: (key: string) => string,
  scheme: CanvasTheme["scheme"],
) {
  if (mode === "text") {
    return [
      {
        label: t("canvas.configNode.prompt"),
        value: inputSummary.textCount,
        color: nodeTypeColor("text", undefined, scheme),
      },
    ];
  }
  if (mode === "video") {
    return [
      {
        label: t("canvas.configNode.prompt"),
        value: inputSummary.textCount,
        color: nodeTypeColor("text", undefined, scheme),
      },
      {
        label: t("canvas.configNode.references"),
        value: inputSummary.imageCount,
        color: nodeTypeColor("image", undefined, scheme),
      },
      {
        label: t("canvas.configNode.videoReferences"),
        value: inputSummary.videoCount,
        color: nodeTypeColor("video", undefined, scheme),
      },
    ];
  }
  if (mode === "audio") {
    return [
      {
        label: t("canvas.configNode.prompt"),
        value: inputSummary.textCount,
        color: nodeTypeColor("text", undefined, scheme),
      },
      {
        label: t("canvas.configNode.audioReferences"),
        value: inputSummary.audioCount,
        color: nodeTypeColor("audio", undefined, scheme),
      },
    ];
  }
  return [
    {
      label: t("canvas.configNode.prompt"),
      value: inputSummary.textCount,
      color: nodeTypeColor("text", undefined, scheme),
    },
    {
      label: t("canvas.configNode.references"),
      value: inputSummary.imageCount,
      color: nodeTypeColor("image", undefined, scheme),
    },
  ];
}

function settingsSummary(mode: CanvasGenerationMode, config: AiConfig) {
  if (mode === "video") {
    return `${videoResolutionLabel(config.vquality)} · ${videoSizeLabel(config.size)} · ${videoSecondsLabel(config.videoSeconds)}`;
  }
  return `${audioVoiceLabel(config.audioVoice)} · ${audioFormatLabel(config.audioFormat)} · ${audioSpeedLabel(config.audioSpeed)}`;
}

function buildNodeConfig(
  globalConfig: AiConfig,
  node: CanvasNodeData,
  mode: CanvasGenerationMode,
): AiConfig {
  const sizeSettings = canvasExactSizeSettingsForNode(
    globalConfig,
    node.metadata,
  );
  const next = {
    ...globalConfig,
    model:
      mode === "image"
        ? resolveCanvasImageModel(
            globalConfig,
            node.metadata?.model,
            sizeSettings.sizeMode,
          )
        : resolveModelForCapability(globalConfig, node.metadata?.model, mode),
    reasoningEffort:
      node.metadata?.reasoningEffort ||
      globalConfig.reasoningEffort ||
      defaultConfig.reasoningEffort,
    quality:
      node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
    size:
      node.metadata?.size ||
      (mode === "image" ? "" : globalConfig.size || defaultConfig.size),
    ...sizeSettings,
    resolution:
      node.metadata?.resolution ||
      globalConfig.resolution ||
      defaultConfig.resolution,
    background: node.metadata?.background ?? "",
    videoSeconds:
      node.metadata?.seconds ||
      globalConfig.videoSeconds ||
      defaultConfig.videoSeconds,
    vquality:
      node.metadata?.vquality ||
      globalConfig.vquality ||
      defaultConfig.vquality,
    videoGenerateAudio:
      node.metadata?.generateAudio ||
      globalConfig.videoGenerateAudio ||
      defaultConfig.videoGenerateAudio,
    videoWatermark:
      node.metadata?.watermark ||
      globalConfig.videoWatermark ||
      defaultConfig.videoWatermark,
    audioVoice:
      node.metadata?.audioVoice ||
      globalConfig.audioVoice ||
      defaultConfig.audioVoice,
    audioFormat:
      node.metadata?.audioFormat ||
      globalConfig.audioFormat ||
      defaultConfig.audioFormat,
    audioSpeed:
      node.metadata?.audioSpeed ||
      globalConfig.audioSpeed ||
      defaultConfig.audioSpeed,
    audioInstructions:
      node.metadata?.audioInstructions ||
      globalConfig.audioInstructions ||
      defaultConfig.audioInstructions,
    count: String(
      node.metadata?.count ||
        (mode === "image"
          ? globalConfig.canvasImageCount || globalConfig.count
          : globalConfig.count) ||
        defaultConfig.count,
    ),
  };
  return mode === "image"
    ? applyCanvasImageModelSettings(next, modelOptionMeta(next, next.model))
    : next;
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
