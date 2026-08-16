import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { reasoningEffortLabel, TextSettingsPanel } from "@/components/text-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig, ReasoningEffort } from "@/stores/use-config-store";
import { AnchorPopoverPanel, AnchorPopoverTrigger, useAnchorPopover } from "./canvas-anchor-popover";

type CanvasTextSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: "reasoningEffort", value: ReasoningEffort) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    fullWidth?: boolean;
    children?: ReactNode;
};

export function CanvasTextSettingsPopover({ config, onConfigChange, buttonClassName, placement = "topLeft", fullWidth, children }: CanvasTextSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { buttonRef, panelRef, open, buttonRect, updateOpen } = useAnchorPopover();

    return (
        <>
            {children ? (
                <AnchorPopoverTrigger buttonRef={buttonRef} open={open} onToggle={() => updateOpen(!open)} fullWidth={fullWidth} className={buttonClassName} style={{ background: theme.toolbar.itemHover, color: theme.node.text }}>
                    {children}
                </AnchorPopoverTrigger>
            ) : (
                <span ref={buttonRef} className="inline-flex min-w-0">
                    <Button size="small" type="text" className={buttonClassName || "!h-8 !max-w-[170px] !justify-start !rounded-full !px-2.5"} style={{ background: theme.node.fill, color: theme.node.text }} icon={<Settings2 className="size-3.5" />} onClick={() => updateOpen(!open)}>
                        <span className="truncate">
                            {t("canvas.controls.reasoning")} · {reasoningEffortLabel(config.reasoningEffort)}
                        </span>
                    </Button>
                </span>
            )}
            {open && buttonRect ? (
                <AnchorPopoverPanel buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme}>
                    <TextSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} className="space-y-3.5" />
                </AnchorPopoverPanel>
            ) : null}
        </>
    );
}
