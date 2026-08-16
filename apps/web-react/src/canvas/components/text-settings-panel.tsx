import { useTranslation } from "react-i18next";

import { Segmented, SegmentedItem } from "@/components/canvas/canvas-setting-controls";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import i18n from "@/i18n";
import { type CanvasTheme } from "@/lib/canvas-theme";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";

const reasoningEffortOptions: ReasoningEffort[] = ["auto", "low", "medium", "high", "xhigh"];

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    className?: string;
    embedded?: boolean;
};

export function TextSettingsPanel({ config, onConfigChange, theme, className = "space-y-3.5", embedded = false }: TextSettingsPanelProps) {
    const { t } = useTranslation();
    const effort = config.reasoningEffort || "auto";

    if (embedded) {
        return (
            <div className="flex w-full flex-col gap-1.5" style={{ color: theme.node.text }}>
                <div className="h-4 truncate text-[11px] font-medium leading-4" style={{ color: theme.node.muted }}>
                    {t("canvas.controls.reasoning")}
                </div>
                <div className="grid h-10 grid-cols-5 gap-1 rounded-xl p-1" style={{ background: theme.toolbar.itemHover }}>
                    {reasoningEffortOptions.map((value) => {
                        const selected = effort === value;
                        return (
                            <button
                                key={value}
                                type="button"
                                className="flex items-center justify-center rounded-[10px] text-[12px] font-medium"
                                style={{
                                    background: selected ? theme.node.panel : "transparent",
                                    color: selected ? theme.node.text : theme.node.muted,
                                    boxShadow: selected ? "0 1px 4px rgba(42, 37, 64, 0.08)" : "none",
                                }}
                                onClick={() => onConfigChange("reasoningEffort", value)}
                            >
                                {t(`settingsPanels.common.${value}`)}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={`canvas-setting-panel ${className}`} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                <div className="text-[13px] font-medium tracking-wide" style={{ color: theme.node.text }}>
                    {t("settingsPanels.text.title")}
                </div>
                <div className="space-y-1.5">
                    <div className="text-[11px] font-medium" style={{ color: theme.node.muted }}>
                        {t("settingsPanels.text.reasoning")}
                    </div>
                    <Segmented theme={theme}>
                        {reasoningEffortOptions.map((value) => (
                            <SegmentedItem key={value} selected={effort === value} theme={theme} onClick={() => onConfigChange("reasoningEffort", value)}>
                                {t(`settingsPanels.common.${value}`)}
                            </SegmentedItem>
                        ))}
                    </Segmented>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function reasoningEffortLabel(value: ReasoningEffort) {
    return reasoningEffortOptions.includes(value) ? i18n.t(`settingsPanels.common.${value}`) : value;
}
