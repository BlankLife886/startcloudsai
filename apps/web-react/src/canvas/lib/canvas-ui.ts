import type { ReactNode } from "react";

import type { CanvasTheme } from "@/lib/canvas-theme";

export const CANVAS_ACCENT = "#6d5cff";

export const NODE_TYPE_COLORS: Record<string, string> = {
    text: "#6d5cff",
    image: "#10b981",
    video: "#f97316",
    audio: "#a855f7",
    config: "#60a5fa",
    group: "#9aa3b8",
};

const NODE_TYPE_COLORS_DARK: Record<string, string> = {
    text: "#8b7cff",
    image: "#22c55e",
    video: "#fb923c",
    audio: "#c084fc",
    config: "#7dd3fc",
    group: "#8b93a8",
};

export function colorWash(hex: string, alpha = 0.14) {
    const raw = hex.replace("#", "");
    if (raw.length !== 6) return `rgba(109,92,255,${alpha})`;
    const n = Number.parseInt(raw, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function nodeTypeColor(type?: string, fallback = CANVAS_ACCENT, scheme?: CanvasTheme["scheme"]) {
    if (!type) return fallback;
    const map = scheme === "dark" ? NODE_TYPE_COLORS_DARK : NODE_TYPE_COLORS;
    return map[type] || fallback;
}

export function CanvasIconWellStyle(color: string, alpha = 0.14) {
    return { background: colorWash(color, alpha), color };
}

export function canvasRaisedStyle(theme: CanvasTheme) {
    if (theme.scheme === "dark") {
        return {
            background: "rgba(255,255,255,.08)",
            boxShadow: "none",
        };
    }
    return {
        background: theme.node.panel,
        boxShadow: "0 1px 2px rgba(42, 37, 64, 0.06)",
    };
}

export function canvasSelectedControlStyle(theme: CanvasTheme) {
    if (theme.scheme === "dark") {
        return {
            background: "rgba(255,255,255,.08)",
            color: "#f2f4fa",
            boxShadow: "none",
        };
    }
    return {
        background: theme.node.panel,
        color: theme.node.text,
        boxShadow: "0 1px 2px rgba(42, 37, 64, 0.06)",
    };
}

export function canvasNodeShadow(theme: CanvasTheme, state: "idle" | "related" | "active" | "drop") {
    const accent = theme.node.activeStroke;
    if (theme.scheme === "dark") {
        return "none";
    }
    const glow = "rgba(49,32,107,.08)";
    if (state === "drop") return `0 0 0 1.5px ${accent}55, 0 10px 24px ${glow}`;
    if (state === "active") return `0 0 0 1.5px ${accent}88, 0 10px 24px ${glow}`;
    if (state === "related") return `0 0 0 1px ${theme.node.muted}40, 0 8px 18px ${glow}`;
    return `0 8px 18px ${glow}`;
}

export type CanvasEmptyCopy = {
    title: string;
    hint?: string;
    icon?: ReactNode;
    color?: string;
};
