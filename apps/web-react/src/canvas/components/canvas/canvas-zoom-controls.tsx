import type { CSSProperties, ReactNode } from "react";
import { Compass, Focus, HelpCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { onCanvasEvent } from "@/lib/canvas/canvas-event-bus";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasShortcutsDialog } from "./canvas-shortcuts-dialog";
import { CANVAS_VIEWPORT_LIVE_EVENT } from "./infinite-canvas";

type CanvasZoomControlsProps = {
    scale: number;
    onScaleChange: (scale: number, options?: { commit?: boolean }) => void;
    onReset: () => void;
    isMiniMapOpen: boolean;
    onToggleMiniMap: () => void;
    children?: ReactNode;
};

export function CanvasZoomControls({ scale, onScaleChange, onReset, isMiniMapOpen, onToggleMiniMap, children }: CanvasZoomControlsProps) {
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [liveScale, setLiveScale] = useState(scale);
    const liveScaleRef = useRef(scale);
    const { t } = useTranslation();

    useEffect(() => {
        liveScaleRef.current = scale;
        setLiveScale(scale);
    }, [scale]);
    useEffect(() => {
        const stop = onCanvasEvent(CANVAS_VIEWPORT_LIVE_EVENT, (payload) => {
            const next = payload && typeof payload === "object" && "k" in payload ? Number((payload as { k: number }).k) : NaN;
            if (!Number.isFinite(next) || next === liveScaleRef.current) return;
            liveScaleRef.current = next;
            setLiveScale(next);
        });
        return () => {
            stop();
        };
    }, []);
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const sidePanelWidth = useCanvasSidePanelStore((state) => state.width);
    const dockStyle = { background: theme.toolbar.panel, color: theme.toolbar.item, boxShadow: theme.toolbar.shadow };
    const percent = Math.round(liveScale * 100);

    return (
        <div
            className="absolute bottom-5 z-50"
            style={{ left: sidePanelOpen ? sidePanelWidth + 24 : 20, transition: "left 380ms cubic-bezier(0.22, 1, 0.36, 1)" }}
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="canvas-editor-chrome canvas-nav-dock overflow-hidden rounded-[20px] border backdrop-blur-2xl" data-theme={colorTheme} data-guide="canvas-nav" style={{ ...dockStyle, borderColor: theme.toolbar.border }}>
                <div className={`canvas-nav-map${isMiniMapOpen ? " is-open" : ""}`}>
                    <div className="canvas-nav-map__inner">
                        <div className="canvas-nav-map__frame" style={{ boxShadow: `inset 0 0 0 1px ${theme.toolbar.border}` }}>
                            {children}
                        </div>
                    </div>
                </div>
                <div className="canvas-nav-bar">
                    <NavIcon title={isMiniMapOpen ? t("canvas.miniMapClose") : t("canvas.miniMapOpen")} active={isMiniMapOpen} theme={theme} onClick={onToggleMiniMap}>
                        <Compass className="size-3.5" />
                    </NavIcon>
                    <Tooltip title={t("canvas.zoom")}>
                        <input
                            type="range"
                            min="5"
                            max="500"
                            step="1"
                            value={percent}
                            className="canvas-nav-slider"
                            style={{ "--zoom": `${((percent - 5) / 495) * 100}%` } as CSSProperties}
                            onInput={(event) => onScaleChange(Number(event.currentTarget.value) / 100, { commit: false })}
                            onPointerUp={(event) => onScaleChange(Number(event.currentTarget.value) / 100, { commit: true })}
                            onKeyUp={(event) => onScaleChange(Number(event.currentTarget.value) / 100, { commit: true })}
                            aria-label={t("canvas.zoom")}
                        />
                    </Tooltip>
                    <Tooltip title={t("canvas.zoomTo100")}>
                        <button type="button" className="canvas-nav-percent" style={{ color: theme.node.text }} onClick={() => onScaleChange(1)} aria-label={t("canvas.zoomTo100")}>
                            {percent}%
                        </button>
                    </Tooltip>
                    <NavIcon title={t("canvas.resetView")} theme={theme} onClick={onReset}>
                        <Focus className="size-3.5" />
                    </NavIcon>
                    <NavIcon title={t("canvas.shortcuts")} active={shortcutsOpen} theme={theme} onClick={() => setShortcutsOpen(true)}>
                        <HelpCircle className="size-3.5" />
                    </NavIcon>
                </div>
            </div>
            <CanvasShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </div>
    );
}

function NavIcon({
    title,
    active,
    theme,
    onClick,
    children,
}: {
    title: string;
    active?: boolean;
    theme: CanvasTheme;
    onClick: () => void;
    children: ReactNode;
}) {
    return (
        <Tooltip title={title}>
            <button
                type="button"
                className="canvas-nav-icon"
                style={active ? { background: theme.toolbar.activeBg, color: theme.toolbar.activeText } : { color: theme.toolbar.item }}
                onClick={onClick}
                aria-label={title}
            >
                {children}
            </button>
        </Tooltip>
    );
}
