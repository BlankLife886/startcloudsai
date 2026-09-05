import type { ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { cn } from "@/lib/utils";
import { AnchorPopoverPanel, AnchorPopoverTrigger, useAnchorPopover, type AnchorPlacement } from "./canvas-anchor-popover";

export type CanvasFieldOption<T extends string = string> = {
    value: T;
    label: ReactNode;
};

type CanvasFieldMenuProps<T extends string> = {
    value: T;
    options: Array<CanvasFieldOption<T>>;
    onChange: (value: T) => void;
    theme: CanvasTheme;
    surface: string;
    placement?: AnchorPlacement;
    emptyLabel?: string;
    compact?: boolean;
    triggerClassName?: string;
    menuMinWidth?: number;
    children: (open: boolean) => ReactNode;
};

export function CanvasFieldMenu<T extends string>({ value, options, onChange, theme, surface, placement = "bottomLeft", emptyLabel, compact = false, triggerClassName, menuMinWidth, children }: CanvasFieldMenuProps<T>) {
    const { buttonRef, panelRef, open, buttonRect, updateOpen } = useAnchorPopover();
    const width = Math.max(menuMinWidth ?? (compact ? 120 : 168), Math.round(buttonRect?.width || 200));

    return (
        <>
            <AnchorPopoverTrigger
                buttonRef={buttonRef}
                open={open}
                onToggle={() => updateOpen(!open)}
                fullWidth
                className={`flex h-10 w-full min-w-0 items-center rounded-xl text-left ${compact ? "px-2" : "px-3"} ${triggerClassName || ""}`.trim()}
                style={{ background: surface, color: theme.node.text }}
            >
                {children(open)}
            </AnchorPopoverTrigger>
            {open && buttonRect ? (
                <AnchorPopoverPanel buttonRect={buttonRect} panelRef={panelRef} placement={placement} theme={theme} width={width} padding={6}>
                    <div className="flex flex-col gap-0.5">
                        {options.length ? (
                            options.map((option) => {
                                const selected = option.value === value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        className={cn(
                                            "flex min-h-10 w-full items-center gap-2.5 rounded-[12px] px-3 py-2 text-left text-[13px] font-medium",
                                            !selected && "hover:bg-black/[.04] dark:hover:bg-white/[.08]",
                                        )}
                                        style={{
                                            background: selected ? theme.toolbar.activeBg : "transparent",
                                            color: selected ? theme.toolbar.activeText : theme.node.text,
                                        }}
                                        onMouseDown={(event) => event.stopPropagation()}
                                        onClick={() => {
                                            onChange(option.value);
                                            updateOpen(false);
                                        }}
                                    >
                                        <span className="flex min-w-0 flex-1 items-center">{option.label}</span>
                                        {selected ? <Check className="size-3.5 shrink-0" /> : <span className="size-3.5 shrink-0" />}
                                    </button>
                                );
                            })
                        ) : (
                            <div className="px-2.5 py-2 text-[12px]" style={{ color: theme.node.muted }}>
                                {emptyLabel}
                            </div>
                        )}
                    </div>
                </AnchorPopoverPanel>
            ) : null}
        </>
    );
}

export function FieldMenuValue({ open, children, muted }: { open: boolean; children: ReactNode; muted?: string }) {
    return (
        <span className="flex min-w-0 flex-1 items-center justify-between gap-1">
            <span className="min-w-0 truncate text-[13px] font-medium">{children}</span>
            <ChevronDown className="size-3 shrink-0 opacity-35 transition-transform duration-200" style={{ transform: open ? "rotate(180deg)" : "none", color: muted }} />
        </span>
    );
}
