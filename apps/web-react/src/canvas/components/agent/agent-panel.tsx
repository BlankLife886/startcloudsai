import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";

import { HostedAgentPanel } from "./hosted-agent-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
const MIN_WIDTH = 360;
const MAX_WIDTH = 760;

export function AgentPanel() {
    const { t } = useTranslation();
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const width = useAgentStore((state) => state.width);
    const [resizing, setResizing] = useState(false);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const visible = panelOpen && !panelClosing;
    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + startX - moveEvent.clientX));
            setAgentState({ width: nextWidth });
        };
        const onUp = () => {
            localStorage.setItem("canvas-agent-panel-width", String(nextWidth));
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    if (!panelMounted) return null;

    return (
        <div className="pointer-events-none absolute inset-0 z-40">
            <motion.aside
                className="canvas-agent-panel pointer-events-auto absolute bottom-3 right-3 top-16 flex flex-col overflow-hidden rounded-[22px] border backdrop-blur-xl"
                data-canvas-shortcuts-ignore
                data-canvas-no-zoom
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: visible ? 1 : 0, x: visible ? 0 : 24 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                style={{
                    width,
                    background: theme.toolbar.panel,
                    borderColor: theme.toolbar.border,
                    boxShadow: theme.toolbar.shadow,
                    color: theme.node.text,
                    colorScheme: themeName,
                    pointerEvents: visible ? "auto" : "none",
                    "--agent-surface": theme.sidebar.surface,
                    "--agent-border": theme.toolbar.border,
                    "--agent-text": theme.node.text,
                    "--agent-muted": theme.node.muted,
                    "--agent-hover": theme.toolbar.itemHover,
                    "--agent-accent": theme.toolbar.activeBg,
                    "--agent-accent-text": theme.toolbar.activeText,
                } as CSSProperties}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("agent.panel.resize")} />
                <HostedAgentPanel />
            </motion.aside>
        </div>
    );
}
