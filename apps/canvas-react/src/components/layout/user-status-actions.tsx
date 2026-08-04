import type { CSSProperties } from "react";
import { BookOpen, Keyboard, Puzzle, Settings2 } from "lucide-react";
import { Tooltip } from "antd";

import { GitHubLink } from "@/components/layout/github-link";
import { VersionReleaseModal } from "@/components/layout/version-release-modal";
import { DOCS_URL } from "@/constant/env";
import { cn } from "@/lib/utils";
import { canvasThemes } from "@/lib/canvas-theme";
import { useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas" | "rail";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const canvasTheme = canvasThemes[theme];
    const rail = variant === "rail";
    const naturalIconClass = rail
        ? "inline-flex size-8 shrink-0 items-center justify-center rounded-full !text-stone-500 transition hover:bg-white/70 hover:!text-stone-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_2px_8px_rgba(28,25,23,.08)] dark:!text-stone-300 dark:hover:bg-white/10 dark:hover:!text-white dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,.12)] [&_svg]:size-4"
        : "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const versionStyle = iconStyle;
    const gitHubClassName = rail
        ? "size-8 rounded-full !text-stone-500 hover:bg-white/70 hover:!text-stone-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_2px_8px_rgba(28,25,23,.08)] dark:!text-stone-300 dark:hover:bg-white/10 dark:hover:!text-white dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,.12)] text-base"
        : "size-7 text-base";
    const gitHubStyle = iconStyle;

    return (
        <div className={cn("inline-flex shrink-0 items-center gap-1", rail && "flex-col")}>
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label="节点插件" title="节点插件">
                    <Puzzle className="size-4" />
                </button>
            ) : null}
            {rail ? (
                <Tooltip title="文档" placement="right" mouseEnterDelay={0.25}>
                    <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label="文档">
                        <BookOpen className="size-4" />
                    </a>
                </Tooltip>
            ) : (
                <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" className={naturalIconClass} style={iconStyle} aria-label="文档" title="文档">
                    <BookOpen className="size-4" />
                </a>
            )}
            {showConfig ? (
                rail ? (
                    <Tooltip title="快捷配置" placement="right" mouseEnterDelay={0.25}>
                        <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="快捷配置">
                            <Settings2 className="size-4" />
                        </button>
                    </Tooltip>
                ) : (
                    <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                        <Settings2 className="size-4" />
                    </button>
                )
            ) : null}
            <VersionReleaseModal
                className={
                    rail
                        ? "flex size-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-white/70 hover:text-stone-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_2px_8px_rgba(28,25,23,.08)] dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,.12)]"
                        : undefined
                }
                style={versionStyle}
                iconOnly={rail}
            />
            <GitHubLink className={cn("bg-transparent hover:bg-transparent dark:hover:bg-transparent", gitHubClassName)} style={gitHubStyle} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}
