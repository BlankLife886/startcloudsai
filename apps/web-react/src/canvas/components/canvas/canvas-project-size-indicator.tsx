import { Tooltip } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_PROJECT_SIZE_WARN_RATIO, formatCanvasProjectBytes } from "@/lib/canvas/canvas-project-quota-rules";
import { useThemeStore } from "@/stores/use-theme-store";

/** 画布右下角的项目大小提示（最近一次云端保存的大小 / 单项目上限），刻意保持低调。 */
export function CanvasProjectSizeIndicator({ bytes, maxBytes }: { bytes: number; maxBytes: number }) {
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    if (!(bytes > 0) || !(maxBytes > 0)) return null;
    const nearLimit = bytes >= maxBytes * CANVAS_PROJECT_SIZE_WARN_RATIO;
    return (
        <div className="absolute bottom-5 right-5 z-40 select-none">
            <Tooltip title={`项目大小（最近一次云端保存）/ 单个项目上限${nearLimit ? "；已接近上限，超过后改动将无法保存到云端" : ""}`} placement="topRight">
                <span className="text-[11px] tabular-nums" style={{ color: nearLimit ? "#d97706" : theme.node.muted, opacity: nearLimit ? 0.9 : 0.6 }}>
                    {formatCanvasProjectBytes(bytes)} / {formatCanvasProjectBytes(maxBytes)}
                </span>
            </Tooltip>
        </div>
    );
}
