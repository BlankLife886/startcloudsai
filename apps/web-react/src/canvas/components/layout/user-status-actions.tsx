import type { CSSProperties } from "react";
import { Keyboard } from "lucide-react";

import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    variant?: "default" | "canvas" | "rail";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const canvasTheme = canvasThemes[theme];
    const rail = variant === "rail";
    const naturalIconClass = rail
        ? "inline-flex size-8 shrink-0 items-center justify-center rounded-full !text-stone-500 transition hover:bg-white/70 hover:!text-stone-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_2px_8px_rgba(28,25,23,.08)] dark:!text-stone-300 dark:hover:bg-white/10 dark:hover:!text-white dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,.12)] [&_svg]:size-4"
        : variant === "canvas"
          ? "canvas-chrome-btn"
          : "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    return (
        <div className={cn("inline-flex shrink-0 items-center gap-1", rail && "flex-col")}>
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
