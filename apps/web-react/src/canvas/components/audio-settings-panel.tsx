import { useTranslation } from "react-i18next";

import { Chip, SettingRow } from "@/components/canvas/canvas-setting-controls";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { audioFormatOptions, audioSpeedLabel, audioVoiceOptions, normalizeAudioFormatValue, normalizeAudioSpeedValue, normalizeAudioVoiceValue } from "@/lib/audio-generation";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig } from "@/stores/use-config-store";

const speedOptions = ["0.75", "1", "1.25", "1.5"];

type AudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type AudioSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: AudioSettingKey, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

export function AudioSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[300px] space-y-3.5" }: AudioSettingsPanelProps) {
    const { t } = useTranslation();
    const voice = normalizeAudioVoiceValue(config.audioVoice);
    const format = normalizeAudioFormatValue(config.audioFormat);
    const speed = normalizeAudioSpeedValue(config.audioSpeed);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={`canvas-setting-panel ${className}`} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? (
                    <div className="text-[13px] font-medium tracking-wide" style={{ color: theme.node.text }}>
                        {t("settingsPanels.audio.title")}
                    </div>
                ) : null}
                <SettingRow label={t("settingsPanels.audio.voice")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                        {audioVoiceOptions.map((item) => (
                            <Chip key={item.value} selected={voice === item.value} theme={theme} onClick={() => onConfigChange("audioVoice", item.value)}>
                                {item.label}
                            </Chip>
                        ))}
                    </div>
                </SettingRow>
                <SettingRow label={t("settingsPanels.audio.format")} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-1.5">
                        {audioFormatOptions.map((item) => (
                            <Chip key={item.value} selected={format === item.value} theme={theme} onClick={() => onConfigChange("audioFormat", item.value)}>
                                {item.label}
                            </Chip>
                        ))}
                    </div>
                </SettingRow>
                <SettingRow label={t("settingsPanels.audio.speed")} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-1.5">
                        {speedOptions.map((value) => (
                            <Chip key={value} selected={speed === value} theme={theme} onClick={() => onConfigChange("audioSpeed", value)}>
                                {audioSpeedLabel(value)}
                            </Chip>
                        ))}
                    </div>
                </SettingRow>
                <SettingRow label={t("settingsPanels.audio.instructions")} color={theme.node.muted}>
                    <textarea
                        value={config.audioInstructions || ""}
                        placeholder={t("settingsPanels.audio.instructionsPlaceholder")}
                        className="thin-scrollbar h-20 w-full resize-none rounded-2xl px-3 py-2 text-[13px] leading-5 outline-none"
                        style={{ background: theme.node.fill, color: theme.node.text }}
                        onChange={(event) => onConfigChange("audioInstructions", event.target.value)}
                        onMouseDown={(event) => event.stopPropagation()}
                    />
                </SettingRow>
            </div>
        </ImageSettingsTheme>
    );
}
