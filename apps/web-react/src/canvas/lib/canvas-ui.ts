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

export function canvasNodeShadow(theme: CanvasTheme, state: "idle" | "hover" | "related" | "active" | "drop") {
    const accent = theme.node.activeStroke;
    const ring = theme.node.activeRing;
    if (theme.scheme === "dark") {
        if (state === "drop") return `0 0 0 1px ${accent}, 0 0 0 4px ${ring}`;
        if (state === "active") return `0 0 0 1px ${accent}, 0 0 0 7px ${ring}, 0 18px 40px rgba(0,0,0,.45)`;
        if (state === "hover") return "0 18px 40px rgba(0,0,0,.45)";
        return "0 10px 26px rgba(0,0,0,.3)";
    }
    if (state === "drop") return `0 0 0 1px ${accent}, 0 0 0 4px ${ring}, 0 16px 36px rgba(30,20,80,.13)`;
    if (state === "active") return `0 0 0 1px ${accent}, 0 0 0 7px ${ring}, 0 18px 40px rgba(109,74,255,.2)`;
    if (state === "hover") return "0 2px 4px rgba(30,20,80,.06), 0 16px 36px rgba(30,20,80,.13)";
    if (state === "related") return `0 0 0 1px ${theme.node.muted}40, 0 8px 22px rgba(30,20,80,.08)`;
    return "0 1px 2px rgba(30,20,80,.05), 0 8px 22px rgba(30,20,80,.07)";
}

export type CanvasEmptyCopy = {
    title: string;
    hint?: string;
    icon?: ReactNode;
    color?: string;
};
