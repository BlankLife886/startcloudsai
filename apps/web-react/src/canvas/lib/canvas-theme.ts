export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

const accent = "#6d5cff";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f6f4fb",
            dot: "rgba(109,92,255,.16)",
            line: "rgba(109,92,255,.07)",
            selectionStroke: accent,
            selectionFill: "rgba(109,92,255,.08)",
            connection: "rgba(109,92,255,.48)",
            connectionActive: accent,
        },
        node: {
            label: "#6b6480",
            fill: "rgba(255,255,255,.9)",
            panel: "#ffffff",
            stroke: "rgba(109,92,255,.08)",
            activeStroke: accent,
            placeholder: "#9a93b0",
            text: "#2a2540",
            muted: "#8b83a3",
            faint: "#b4aec4",
        },
        toolbar: {
            panel: "rgba(255,255,255,.78)",
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
        canvas: {
            background: "#12111a",
            dot: "rgba(198,188,255,.12)",
            line: "rgba(198,188,255,.07)",
            selectionStroke: "#c4b5fd",
            selectionFill: "rgba(167,139,250,.12)",
            connection: "rgba(167,139,250,.46)",
            connectionActive: "#c4b5fd",
        },
        node: {
            label: "#c4b5fd",
            fill: "rgba(28,26,38,.9)",
            panel: "#1c1a26",
            stroke: "rgba(198,188,255,.08)",
            activeStroke: "#c4b5fd",
            placeholder: "#8b83a3",
            text: "#f4f1ff",
            muted: "#a8a1c2",
            faint: "#6b6480",
        },
        toolbar: {
            panel: "rgba(24,22,34,.78)",
            border: "rgba(198,188,255,.1)",
            item: "#d6d0ea",
            itemHover: "rgba(167,139,250,.12)",
            activeBg: "rgba(167,139,250,.18)",
            activeText: "#ede9fe",
            shadow: "0 16px 40px rgba(0,0,0,.36)",
        },
        sidebar: {
            bg: "#16141e",
            surface: "#211e2c",
            border: "rgba(198,188,255,.14)",
            shadow: "0 12px 32px rgba(0, 0, 0, 0.38)",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
