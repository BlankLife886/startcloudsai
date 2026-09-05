import { useTranslation } from "react-i18next";

import { Segmented, SegmentedItem } from "@/components/canvas/canvas-setting-controls";
import { ImageSettingsTheme } from "@/components/image-settings-panel";
import i18n from "@/i18n";
import { canvasSelectedControlStyle } from "@/lib/canvas-ui";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { canvasReasoningEfforts, MODEL_REASONING_EFFORTS, modelOptionMeta, resolveCanvasReasoningEffort, type AiConfig, type ModelReasoningEffort, type ReasoningEffort } from "@/stores/use-config-store";

type TextSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    theme: CanvasTheme;
    className?: string;
    embedded?: boolean;
};

export function TextSettingsPanel({ config, onConfigChange, theme, className = "space-y-3.5", embedded = false }: TextSettingsPanelProps) {
    const { t } = useTranslation();
    const model = modelOptionMeta(config, config.model);
    const efforts = canvasReasoningEfforts(model) as ReasoningEffort[];
    const effort = resolveCanvasReasoningEffort(model, config.reasoningEffort) || config.reasoningEffort || "auto";

    if (!efforts.length) return null;

    if (embedded) {
        return (
            <div className="flex w-full flex-col gap-1.5" style={{ color: theme.node.text }}>
                <div className="h-4 truncate text-[11px] font-medium leading-4" style={{ color: theme.node.muted }}>
                    {t("canvas.controls.reasoning")}
                </div>
                <div className="grid h-9 gap-1 rounded-xl p-1 canvas-config-efforts" style={{ background: theme.toolbar.itemHover, gridTemplateColumns: `repeat(${efforts.length}, minmax(0, 1fr))` }}>
                    {efforts.map((value) => {
                        const selected = effort === value;
                        return (
                            <button
                                key={value}
                                type="button"
                                className={`canvas-config-effort flex items-center justify-center rounded-lg text-[12px] font-medium${selected ? " is-selected" : ""}`}
                                style={selected ? canvasSelectedControlStyle(theme) : { background: "transparent", color: theme.node.muted }}
                                onClick={() => onConfigChange("reasoningEffort", value)}
                            >
                                {reasoningEffortLabel(value)}
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
                        {efforts.map((value) => (
                            <SegmentedItem key={value} selected={effort === value} theme={theme} onClick={() => onConfigChange("reasoningEffort", value)}>
                                {reasoningEffortLabel(value)}
                            </SegmentedItem>
                        ))}
                    </Segmented>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

export function reasoningEffortLabel(value: string) {
    const effort = String(value || "").trim().toLowerCase();
    if (effort === "auto" || MODEL_REASONING_EFFORTS.includes(effort as ModelReasoningEffort)) {
        const key = `settingsPanels.common.${effort}`;
        const translated = i18n.t(key);
        if (translated !== key) return translated;
        const composerKey = `agent.composer.effort.${effort}`;
        const composer = i18n.t(composerKey);
        if (composer !== composerKey) return composer;
    }
    return value;
}
