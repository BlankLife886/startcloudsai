import { Switch } from "antd";
import { useTranslation } from "react-i18next";

import { Chip, Segmented, SegmentedItem, SettingRow, SoftField } from "@/components/canvas/canvas-setting-controls";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import i18n from "@/i18n";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { type AiConfig } from "@/stores/use-config-store";

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const sizeOptions = [
    { value: "1280x720", labelKey: "landscape", width: 1280, height: 720 },
    { value: "720x1280", labelKey: "portrait", width: 720, height: 1280 },
    { value: "1024x1024", labelKey: "square", width: 1024, height: 1024 },
    { value: "1792x1024", labelKey: "widescreen", width: 1792, height: 1024 },
    { value: "1024x1792", labelKey: "tall", width: 1024, height: 1792 },
    { value: "auto", labelKey: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];
const seedanceRatioLabelKeys: Record<string, string> = { "16:9": "landscape", "9:16": "portrait", "1:1": "square", "4:3": "standardLandscape", "3:4": "standardPortrait", "21:9": "cinematic", adaptive: "adaptive" };

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, get label() { return i18n.t(`settingsPanels.video.sizes.${item.labelKey}`); } }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "vquality" | "size" | "videoSeconds" | "videoGenerateAudio" | "videoWatermark", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[300px] space-y-3.5" }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const seconds = config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={`canvas-setting-panel ${className}`} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <PanelTitle theme={theme}>{t("settingsPanels.video.title")}</PanelTitle> : null}
                <SettingRow label={t("settingsPanels.video.quality")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                        {resolutionOptions.map((item) => (
                            <Chip key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </Chip>
                        ))}
                        <SoftField theme={theme}>
                            <input type="number" min={1} className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={resolution} onChange={(event) => onConfigChange("vquality", event.target.value)} onMouseDown={(event) => event.stopPropagation()} />
                            <span className="grid w-7 place-items-center pr-1 text-[11px]" style={{ color: theme.node.muted }}>
                                p
                            </span>
                        </SoftField>
                    </div>
                </SettingRow>
                <SettingRow label={t("settingsPanels.video.size")} color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-xs" style={{ color: theme.node.faint }}>
                            ×
                        </span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                        {sizeOptions.map((item) => (
                            <Chip key={item.value} selected={size === item.value} theme={theme} onClick={() => onConfigChange("size", item.value)}>
                                {t(`settingsPanels.video.sizes.${item.labelKey}`)}
                            </Chip>
                        ))}
                    </div>
                </SettingRow>
                <SettingRow label={t("settingsPanels.video.seconds")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                        {secondOptions.map((value) => (
                            <Chip key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </Chip>
                        ))}
                    </div>
                </SettingRow>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const { t } = useTranslation();
    const resolution = normalizeSeedanceResolution(config.vquality);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={`canvas-setting-panel ${className}`} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <PanelTitle theme={theme}>{t("settingsPanels.video.title")}</PanelTitle> : null}
                <SettingRow label={t("settingsPanels.video.resolution")} color={theme.node.muted}>
                    <Segmented theme={theme}>
                        {seedanceResolutionOptions.map((item) => (
                            <SegmentedItem key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </SegmentedItem>
                        ))}
                    </Segmented>
                </SettingRow>
                <SettingRow label={t("settingsPanels.video.ratio")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                        {seedanceRatioOptions.map((item) => (
                            <Chip key={item.value} selected={ratio === item.value} theme={theme} onClick={() => onConfigChange("size", item.value)}>
                                {item.value === "adaptive" ? t("settingsPanels.video.adaptive") : item.value}
                            </Chip>
                        ))}
                    </div>
                    {ratio !== "adaptive" ? (
                        <div className="text-[11px]" style={{ color: theme.node.faint }}>
                            {seedancePixelLabel(resolution, ratio)}
                        </div>
                    ) : null}
                </SettingRow>
                <SettingRow label={t("settingsPanels.video.duration")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-1.5">
                        {seedanceDurationOptions.map((value) => (
                            <Chip key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value === -1 ? t("settingsPanels.video.smart") : `${value}s`}
                            </Chip>
                        ))}
                    </div>
                </SettingRow>
                <div className="space-y-1.5 rounded-2xl px-3 py-2" style={{ background: theme.node.fill }}>
                    <SwitchRow label={t("settingsPanels.video.generateAudio")} checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                    <SwitchRow label={t("settingsPanels.video.watermark")} checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function videoResolutionLabel(value: string) {
    return `${normalizeVideoResolutionValue(value)}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return i18n.t("settingsPanels.video.adaptive");
    if (ratio === value) return i18n.t(`settingsPanels.video.ratios.${seedanceRatioLabelKeys[ratio]}`);
    const size = normalizeVideoSizeValue(value);
    const option = sizeOptions.find((item) => item.value === size);
    return option ? i18n.t(`settingsPanels.video.sizes.${option.labelKey}`) : size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return i18n.t("settingsPanels.video.smart");
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function PanelTitle({ theme, children }: { theme: CanvasTheme; children: string }) {
    return (
        <div className="text-[13px] font-medium tracking-wide" style={{ color: theme.node.text }}>
            {children}
        </div>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <SoftField theme={theme} disabled={disabled}>
            <span className="grid w-7 place-items-center text-[11px] font-medium" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input type="number" min={1} disabled={disabled} className="min-w-0 flex-1 bg-transparent pr-3 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" value={value || ""} onChange={(event) => onChange(Number(event.target.value) || null)} onMouseDown={(event) => event.stopPropagation()} />
        </SoftField>
    );
}

function SwitchRow({ label, checked, theme, onChange }: { label: string; checked: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3">
            <span className="text-[13px]" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
