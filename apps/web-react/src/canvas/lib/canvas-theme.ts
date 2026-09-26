export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

const accent = "#6d5cff";

export const canvasThemes = {
    light: {
        scheme: "light" as const,
        canvas: {
            background: "#f6f5fa",
            dot: "rgba(23,21,31,.24)",
            line: "rgba(23,21,31,.08)",
            selectionStroke: accent,
            selectionFill: "rgba(109,92,255,.08)",
            connection: "rgba(137,128,172,.78)",
            connectionActive: accent,
        },
        node: {
            label: "#6b6480",
            fill: "#ffffff",
            panel: "#ffffff",
            stroke: "#e8e4f1",
            strokeHover: "#d6d0e4",
            activeRing: "rgba(109,92,255,.18)",
            port: "#c9c3d8",
            activeStroke: accent,
            placeholder: "#786d88",
            text: "#2a2540",
            muted: "#6e647f",
            faint: "#7d728d",
        },
        toolbar: {
            panel: "rgba(255,255,255,.96)",
            border: "rgba(109,92,255,.1)",
            item: "#5b556e",
            itemHover: "rgba(109,92,255,.08)",
            activeBg: "rgba(109,92,255,.12)",
            activeText: "#4c1d95",
            shadow: "0 14px 36px rgba(49,32,107,.1)",
        },
        sidebar: {
            bg: "#f7f5fc",
            surface: "#ffffff",
            border: "rgba(109,92,255,.12)",
            shadow: "0 10px 28px rgba(49, 32, 107, 0.08)",
        },
    },
    dark: {
        scheme: "dark" as const,
        canvas: {
            background: "#111016",
            dot: "rgba(255,255,255,.14)",
            line: "rgba(255,255,255,.05)",
            selectionStroke: "#8b7cff",
            selectionFill: "rgba(139,124,255,.16)",
            connection: "rgba(170,160,215,.55)",
            connectionActive: "#a394ff",
        },
        node: {
            label: "#8b93a8",
            fill: "#1c1a24",
            panel: "#1a1c24",
            stroke: "rgba(255,255,255,.09)",
            strokeHover: "rgba(255,255,255,.18)",
            activeRing: "rgba(139,124,255,.26)",
            port: "#4d4a5c",
            activeStroke: "#8b7cff",
            placeholder: "#6b7388",
            text: "#e8ebf4",
            muted: "#8b93a8",
            faint: "#929bb0",
        },
        toolbar: {
            panel: "rgba(16,18,24,.96)",
            border: "rgba(255,255,255,.08)",
            item: "#c5cad8",
            itemHover: "rgba(255,255,255,.06)",
            activeBg: "rgba(139,124,255,.18)",
            activeText: "#efeaff",
            shadow: "0 16px 40px rgba(0,0,0,.4)",
        },
        sidebar: {
            bg: "#0e1016",
            surface: "rgba(255,255,255,.055)",
            border: "rgba(255,255,255,.09)",
            shadow: "inset 0 1px 0 rgba(255,255,255,.06)",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
