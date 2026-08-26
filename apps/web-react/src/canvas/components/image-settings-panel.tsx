import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useRef } from "react";
import { ConfigProvider, Switch } from "antd";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
import {
    CANVAS_IMAGE_HARD_MAX_COUNT,
    aspectRatiosForResolution,
    canvasImageMaxCount,
    canvasImageModelCapabilities,
    canvasImageOutputSize,
    coerceCanvasImageSettings,
} from "@/lib/canvas/canvas-image-model";
import { modelOptionMeta, type AiConfig } from "@/stores/use-config-store";
import { CanvasFieldMenu, FieldMenuValue } from "@/components/canvas/canvas-field-menu";

const bare: CSSProperties = {
    appearance: "none",
    WebkitAppearance: "none",
    border: "none",
    outline: "none",
    boxShadow: "none",
};

type ImageSettingKey = "quality" | "size" | "resolution" | "count" | "background";

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: ImageSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    embedded?: boolean;
    showDimensions?: boolean;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "", maxCount, embedded = false, showDimensions = true }: ImageSettingsPanelProps) {
    const { t } = useTranslation();
    const model = modelOptionMeta(config, config.model);
    const capabilities = canvasImageModelCapabilities(model);
    const settings = coerceCanvasImageSettings(model, config);
    const quality = settings.quality;
    const selectedRatio = settings.size;
    const selectedResolution = settings.resolution;
    const countLimit = Math.max(1, Math.min(CANVAS_IMAGE_HARD_MAX_COUNT, Math.floor(Number(maxCount)) || canvasImageMaxCount(model)));
    const count = Math.max(1, Math.min(countLimit, Math.floor(Math.abs(Number(settings.count)) || 1)));
    const transparentBackground = settings.background === "transparent";
    const ratioOptions = aspectRatiosForResolution(model, selectedResolution).map((ratio) => ({ value: ratio, label: ratio === "auto" ? t("settingsPanels.common.auto") : ratio }));
    const resolutionOptions = capabilities.resolutions.map((resolution) => ({ value: resolution, label: resolution }));
    const qualityOptions = capabilities.qualities.map((value) => ({ value, label: imageQualityLabel(value) }));
    const dimensions = canvasImageOutputSize(selectedRatio, selectedResolution);
    const controlBg = embedded ? theme.toolbar.itemHover : theme.node.fill;
    const countRef = useRef(count);
    countRef.current = count;

    const stepCount = (delta: number) => {
        const next = Math.max(1, Math.min(countLimit, countRef.current + delta));
        if (next === countRef.current) return;
        onConfigChange("count", String(next));
    };

    const labelStyle = { color: theme.node.muted };

    const controlH = embedded ? "h-9" : "h-10";
    const triggerClass = embedded ? "!h-9 !rounded-[10px] canvas-config-field" : undefined;

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={`flex w-full flex-col ${embedded ? "gap-2" : "gap-3"} ${className}`.trim()}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && document.activeElement !== event.target && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-[13px] font-semibold leading-none">{t("settingsPanels.image.title")}</div> : null}

                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, Number(ratioOptions.length > 0) + Number(qualityOptions.length > 0) + Number(resolutionOptions.length > 0))}, minmax(0, 1fr))` }}>
                    {qualityOptions.length ? <FieldBlock label={t("settingsPanels.image.quality")} style={labelStyle}>
                        <CanvasFieldMenu compact value={quality} options={qualityOptions} theme={theme} surface={controlBg} triggerClassName={triggerClass} onChange={(value) => onConfigChange("quality", value)}>
                            {(open) => <FieldMenuValue open={open}>{imageQualityLabel(quality)}</FieldMenuValue>}
                        </CanvasFieldMenu>
                    </FieldBlock> : null}
                    {ratioOptions.length ? <FieldBlock label={t("settingsPanels.image.aspectRatio")} style={labelStyle}>
                        <CanvasFieldMenu compact value={selectedRatio} options={ratioOptions} theme={theme} surface={controlBg} triggerClassName={triggerClass} onChange={(ratio) => onConfigChange("size", ratio)}>
                            {(open) => <FieldMenuValue open={open}>{selectedRatio === "auto" ? t("settingsPanels.common.auto") : selectedRatio}</FieldMenuValue>}
                        </CanvasFieldMenu>
                    </FieldBlock> : null}
                    {resolutionOptions.length ? <FieldBlock label={t("settingsPanels.image.resolution")} style={labelStyle}>
                            <CanvasFieldMenu compact value={selectedResolution} options={resolutionOptions} theme={theme} surface={controlBg} triggerClassName={triggerClass} onChange={(resolution) => {
                                const next = coerceCanvasImageSettings(model, { ...settings, resolution });
                                onConfigChange("resolution", next.resolution);
                                if (next.size !== selectedRatio) onConfigChange("size", next.size);
                            }}>
                                {(open) => <FieldMenuValue open={open}>{selectedResolution}</FieldMenuValue>}
                            </CanvasFieldMenu>
                    </FieldBlock> : null}
                </div>

                <div className={`grid gap-1.5 ${capabilities.transparentBackground ? "grid-cols-2" : "grid-cols-1"}`}>
                    {capabilities.transparentBackground ? <div className={`canvas-config-field flex ${controlH} min-w-0 items-center justify-between rounded-[10px] px-2.5`} style={{ background: controlBg }} title={t("settingsPanels.image.transparentHint")}>
                        <span className="truncate text-[12px] font-medium">{t("settingsPanels.image.transparent")}</span>
                        <span className="shrink-0" onMouseDown={(event) => event.stopPropagation()}>
                            <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                        </span>
                    </div> : null}
                    <div className={`canvas-config-field flex ${controlH} min-w-0 items-center rounded-[10px] px-1`} style={{ background: controlBg }}>
                        <HoldButton disabled={count <= 1} theme={theme} onHold={() => stepCount(-1)}>
                            <Minus className="size-3.5" />
                        </HoldButton>
                        <span className="flex min-w-0 flex-1 items-center justify-center gap-1">
                            <span className="text-[14px] font-semibold leading-none tabular-nums">{count}</span>
                            <span className="text-[12px] leading-none" style={{ color: theme.node.muted }}>
                                {t("settingsPanels.image.countUnit")}
                            </span>
                        </span>
                        <HoldButton disabled={count >= countLimit} theme={theme} onHold={() => stepCount(1)}>
                            <Plus className="size-3.5" />
                        </HoldButton>
                    </div>
                </div>

                {showDimensions && resolutionOptions.length > 0 && dimensions ? (
                    <FieldBlock label={t("settingsPanels.image.size")} style={labelStyle}>
                        <div className="grid grid-cols-2 gap-1.5">
                            <DimensionPreview prefix="W" value={dimensions?.width} theme={theme} surface={controlBg} compact={embedded} />
                            <DimensionPreview prefix="H" value={dimensions?.height} theme={theme} surface={controlBg} compact={embedded} />
                        </div>
                    </FieldBlock>
                ) : null}
            </div>
        </ImageSettingsTheme>
    );
}

function FieldBlock({ label, style, children }: { label: string; style: CSSProperties; children: ReactNode }) {
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="h-4 truncate text-[11px] font-medium leading-4" style={style}>
                {label}
            </div>
            {children}
        </div>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ["auto", "high", "medium", "low"].includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value;
}

export function imageSizeLabel(size: string, resolution?: string) {
    const ratio = size || "auto";
    if (ratio === "auto") return i18n.t("settingsPanels.common.auto");
    return resolution && resolution !== "1K" ? `${ratio} · ${resolution}` : ratio;
}

function HoldButton({ disabled, theme, onHold, children }: { disabled?: boolean; theme: CanvasTheme; onHold: () => void; children: ReactNode }) {
    const onHoldRef = useRef(onHold);
    const delayRef = useRef<number | null>(null);
    const intervalRef = useRef<number | null>(null);
    onHoldRef.current = onHold;

    const stop = () => {
        if (delayRef.current) window.clearTimeout(delayRef.current);
        if (intervalRef.current) window.clearInterval(intervalRef.current);
        delayRef.current = null;
        intervalRef.current = null;
    };

    useEffect(() => stop, []);

    const start = (event: PointerEvent<HTMLButtonElement>) => {
        if (disabled) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        onHoldRef.current();
        delayRef.current = window.setTimeout(() => {
            intervalRef.current = window.setInterval(() => onHoldRef.current(), 80);
        }, 360);
    };

    return (
        <button
            type="button"
            disabled={disabled}
            className="flex size-8 shrink-0 items-center justify-center rounded-full disabled:opacity-35"
            style={{ ...bare, color: disabled ? theme.node.faint : theme.node.text }}
            onPointerDown={start}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
        >
            {children}
        </button>
    );
}

function DimensionPreview({ prefix, value, theme, surface, compact }: { prefix: string; value?: number; theme: CanvasTheme; surface?: string; compact?: boolean }) {
    return (
        <label className={`${compact ? "canvas-config-field" : ""} flex ${compact ? "h-9" : "h-10"} min-w-0 items-center gap-1.5 rounded-[10px] px-3`.trim()} style={{ background: surface || theme.node.fill, color: theme.node.text, opacity: value ? 1 : 0.4 }}>
            <span className="w-3 shrink-0 text-[11px] font-semibold" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <span className={`h-full min-w-0 flex-1 text-[13px] tabular-nums ${compact ? "leading-9" : "leading-10"}`} style={{ color: "inherit" }}>
                {value || "—"}
            </span>
        </label>
    );
}
