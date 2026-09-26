import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "antd";

import { AudioSettingsPanel } from "@/components/audio-settings-panel";
import { audioFormatLabel, audioSpeedLabel, audioVoiceLabel } from "@/lib/audio-generation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { AiConfig } from "@/stores/use-config-store";
import { AnchorPopoverPanel, AnchorPopoverTrigger, useAnchorPopover } from "./canvas-anchor-popover";

export type CanvasAudioSettingKey = "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions";

type CanvasAudioSettingsPopoverProps = {
    config: AiConfig;
    onConfigChange: (key: CanvasAudioSettingKey, value: string) => void;
    buttonClassName?: string;
    placement?: "topLeft" | "top" | "topRight" | "bottomLeft" | "bottom" | "bottomRight";
    fullWidth?: boolean;
    children?: ReactNode;
};

export function CanvasAudioSettingsPopover({ config, onConfigChange, buttonClassName, placement = "topLeft", fullWidth, children }: CanvasAudioSettingsPopoverProps) {
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
                            {audioVoiceLabel(config.audioVoice)} · {audioFormatLabel(config.audioFormat)} · {audioSpeedLabel(config.audioSpeed)}
                        </span>
                    </Button>
                </span>
            )}
            {open && buttonRect ? (
                <AnchorPopoverPanel buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme}>
                    <AudioSettingsPanel config={config} onConfigChange={(key, value) => onConfigChange(key, value)} theme={theme} className="space-y-3.5" />
                </AnchorPopoverPanel>
            ) : null}
        </>
    );
}
