import { Tooltip } from "antd";
import { CloudUpload } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_PROJECT_SIZE_WARN_RATIO, formatCanvasProjectBytes } from "@/lib/canvas/canvas-project-quota-rules";
import { useThemeStore } from "@/stores/use-theme-store";

/** 画布右下角的项目大小提示（最近一次云端保存的大小 / 单项目上限），做成带用量条的小胶囊，压在节点上也看得清。 */
export function CanvasProjectSizeIndicator({ bytes, maxBytes }: { bytes: number; maxBytes: number }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    if (!(bytes > 0) || !(maxBytes > 0)) return null;
    const nearLimit = bytes >= maxBytes * CANVAS_PROJECT_SIZE_WARN_RATIO;
    const ratio = Math.min(1, bytes / maxBytes);
    const dark = theme.scheme === "dark";
    const barColor = nearLimit ? "#f59e0b" : theme.node.activeStroke;
    return (
        <div className="absolute bottom-5 right-5 z-40 select-none">
            <Tooltip title={`项目大小（最近一次云端保存）/ 单个项目上限${nearLimit ? "；已接近上限，超过后改动将无法保存到云端" : ""}`} placement="topRight">
                <span
                    className="flex h-8 items-center gap-2 rounded-full pl-2.5 pr-3 text-[11px] font-medium tabular-nums"
                    style={{
                        background: dark ? "rgba(28,26,36,.96)" : "rgba(255,255,255,.96)",
                        boxShadow: dark ? "0 0 0 1px rgba(255,255,255,.08), 0 6px 16px rgba(0,0,0,.35)" : "0 0 0 1px #ebe8f2, 0 6px 16px rgba(30,20,80,.08)",
                        color: nearLimit ? "#b45309" : theme.node.text,
                    }}
                >
                    <CloudUpload className="size-3.5 shrink-0" style={{ color: nearLimit ? "#f59e0b" : theme.node.muted }} />
                    <span className="relative h-1.5 w-12 overflow-hidden rounded-full" style={{ background: dark ? "rgba(255,255,255,.1)" : "#efedf5" }}>
                        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(4, ratio * 100)}%`, background: barColor }} />
                    </span>
                    <span>
                        {formatCanvasProjectBytes(bytes)}
                        <span style={{ color: theme.node.muted }}> / {formatCanvasProjectBytes(maxBytes)}</span>
                    </span>
                </span>
            </Tooltip>
        </div>
    );
}
