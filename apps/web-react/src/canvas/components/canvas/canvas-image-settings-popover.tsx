import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ImageSettingsPanel, imageQualityLabel, imageSizeLabel } from "@/components/image-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { canvasImageMaxCount } from "@/lib/canvas/canvas-image-model";
import { modelOptionMeta, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { AnchorPopoverPanel, AnchorPopoverTrigger, useAnchorPopover } from "./canvas-anchor-popover";

type CanvasImageSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    onMissingConfig?: () => void;
    onOpenChange?: (open: boolean) => void;
    buttonClassName?: string;
    getPopupContainer?: (triggerNode: HTMLElement) => HTMLElement;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    autoAdjustOverflow?: boolean;
    fullWidth?: boolean;
    children?: ReactNode;
};

export function CanvasImageSettingsPopover({ config, onConfigChange, onOpenChange, buttonClassName, placement = "topLeft", fullWidth, children }: CanvasImageSettingsPopoverProps) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { buttonRef, panelRef, open, buttonRect, updateOpen } = useAnchorPopover(onOpenChange);
    const quality = config.quality || "";
    const count = Math.max(1, Math.min(canvasImageMaxCount(modelOptionMeta(config, config.model)), Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "";
    const summary = [
        quality ? imageQualityLabel(quality) : "",
        activeSize || config.resolution ? imageSizeLabel(activeSize, config.resolution) : "",
        t("canvas.controls.images", { count }),
    ].filter(Boolean).join(" · ");

    return (
        <>
            {children ? (
                <AnchorPopoverTrigger buttonRef={buttonRef} open={open} onToggle={() => updateOpen(!open)} fullWidth={fullWidth} className={buttonClassName}>
                    {children}
                </AnchorPopoverTrigger>
            ) : (
                <span ref={buttonRef} className="inline-flex min-w-0">
                    <button
                        type="button"
                        className={buttonClassName || "inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-full px-2.5 text-left"}
                        style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => updateOpen(!open)}
                    >
                        <Settings2 className="size-3.5 shrink-0 opacity-55" />
                        <span className="min-w-0 truncate text-[12px] font-medium">{summary}</span>
                    </button>
                </span>
            )}
            {open && buttonRect ? (
                <AnchorPopoverPanel buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} width={360} padding={14}>
                    <ImageSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} showTitle={false} embedded />
                </AnchorPopoverPanel>
            ) : null}
        </>
    );
}
