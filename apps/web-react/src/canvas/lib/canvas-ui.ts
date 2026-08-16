import type { ReactNode } from "react";

export const CANVAS_ACCENT = "#6d5cff";

export const NODE_TYPE_COLORS: Record<string, string> = {
    text: "#6d5cff",
    image: "#10b981",
    video: "#f97316",
    audio: "#a855f7",
    config: "#60a5fa",
    group: "#8b83a3",
};

export function colorWash(hex: string, alpha = 0.14) {
    const raw = hex.replace("#", "");
    if (raw.length !== 6) return `rgba(109,92,255,${alpha})`;
    const n = Number.parseInt(raw, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

export function nodeTypeColor(type?: string, fallback = CANVAS_ACCENT) {
    if (!type) return fallback;
    return NODE_TYPE_COLORS[type] || fallback;
}

export function CanvasIconWellStyle(color: string, alpha = 0.14) {
    return { background: colorWash(color, alpha), color };
}

export type CanvasEmptyCopy = {
    title: string;
    hint?: string;
    icon?: ReactNode;
    color?: string;
};
