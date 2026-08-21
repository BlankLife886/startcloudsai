import type { CSSProperties, ReactNode } from "react";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { canvasRaisedStyle } from "@/lib/canvas-ui";

export function SettingRow({ label, color, extra, children }: { label: string; color: string; extra?: ReactNode; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="flex h-6 items-center justify-between gap-2">
                <div className="text-[11px] font-medium" style={{ color }}>
                    {label}
                </div>
                {extra}
            </div>
            {children}
        </div>
    );
}

export function Segmented({ children, compact = false, theme }: { children: ReactNode; compact?: boolean; theme: CanvasTheme }) {
    return (
        <div className={`flex rounded-full ${compact ? "h-6 p-px" : "h-8 p-0.5"}`} style={{ background: theme.toolbar.itemHover }}>
            {children}
        </div>
    );
}

export function SegmentedItem({ selected, theme, compact = false, onClick, children }: { selected: boolean; theme: CanvasTheme; compact?: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className={`${compact ? "h-full min-w-8 px-1.5 text-[10px]" : "h-full px-1 text-[12px]"} flex-1 rounded-full border-0 font-medium outline-none transition`}
            style={selected ? { ...canvasRaisedStyle(theme), color: theme.node.text } : { background: "transparent", color: theme.node.muted }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function Chip({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-8 rounded-full border-0 px-2 text-[12px] font-medium outline-none transition"
            style={{
                background: selected ? theme.toolbar.activeBg : theme.node.fill,
                color: selected ? theme.toolbar.activeText : theme.node.text,
            }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

export function SoftField({ theme, disabled, style, children }: { theme: CanvasTheme; disabled?: boolean; style?: CSSProperties; children: ReactNode }) {
    return (
        <label className="flex h-8 min-w-0 overflow-hidden rounded-full border-0 text-[13px]" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.45 : 1, ...style }}>
            {children}
        </label>
    );
}

export function floatingPanelStyle(theme: CanvasTheme, extra?: CSSProperties): CSSProperties {
    return {
        background: theme.toolbar.panel,
        border: `1px solid ${theme.toolbar.border}`,
        borderRadius: 18,
        boxShadow: theme.toolbar.shadow,
        backdropFilter: "blur(22px)",
        WebkitBackdropFilter: "blur(22px)",
        color: theme.node.text,
        ...extra,
    };
}

export function CanvasPriceMark({ price, comparePrice }: { price?: string; comparePrice?: string }) {
    if (!price) return null;
    if (!comparePrice) {
        return <span className="canvas-config-price shrink-0 text-[12px] font-semibold tabular-nums tracking-tight">{price}</span>;
    }
    return (
        <span className="canvas-config-price flex shrink-0 items-baseline gap-1 whitespace-nowrap tabular-nums">
            <span className="text-[11px] font-medium line-through opacity-45">{comparePrice}</span>
            <span className="text-[12px] font-semibold tracking-tight">{price}</span>
        </span>
    );
}
