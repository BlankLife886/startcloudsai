import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { SoftMark } from "@react/components/common/SoftMark.jsx";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { canvasThemes } from "@/lib/canvas-theme";
import { colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { formatModelDiscount, formatModelPrice, modelOptionLabel, modelOptionMeta, modelOptionName, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    size?: "default" | "lg";
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, size = "default", placeholder = "选择模型", onMissingConfig }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const options = useMemo(() => Array.from(new Set(selectableModelsByCapability(config, capability))), [capability, config]);
    const current = value || "";
    const currentMeta = current ? modelOptionMeta(config, current) : undefined;
    const large = size === "lg";
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const accent = nodeTypeColor(capability || "config");

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !options.length) onMissingConfig?.();
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                hideChevron={large}
                className={cn(
                    "canvas-composer-model-picker group w-fit max-w-full gap-2.5 border border-input bg-transparent text-sm font-normal shadow-sm transition-colors",
                    large ? "h-14 rounded-[18px] px-2.5" : "h-8 rounded-full px-3",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : placeholder}
            >
                <ModelIcon model={current} capability={capability} large={large} surface={theme.node.panel} />
                {large ? (
                    <span className="canvas-model-picker-text flex min-w-0 flex-1 items-center gap-2 text-left">
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight">{current ? modelOptionLabel(config, current) : placeholder}</span>
                        {current ? (
                            <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: colorWash(accent, 0.12), color: accent }}>
                                {[formatModelPrice(currentMeta), formatModelDiscount(currentMeta)].filter(Boolean).join(" · ")}
                            </span>
                        ) : null}
                    </span>
                ) : (
                    <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? modelOptionLabel(config, current) : placeholder}</span>
                )}
                {large ? <ChevronDown className="size-3.5 shrink-0 opacity-35 transition-transform duration-200 group-data-[state=open]:rotate-180" /> : null}
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="canvas-float-menu z-[1200] w-80 max-w-[calc(100vw-24px)] rounded-2xl border p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={8}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={modelOptionLabel(config, model)} className="rounded-xl py-2">
                            <ModelLabel config={config} model={model} capability={capability} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `后台暂未分发${label}模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "后台暂未分发可用模型";
}

function ModelLabel({ config, model, capability }: { config: AiConfig; model: string; capability?: ModelCapability }) {
    const meta = modelOptionMeta(config, model);
    return (
        <span className="flex min-w-0 flex-1 items-center gap-2.5">
            <ModelIcon model={model} capability={capability} />
            <span className="min-w-0 flex-1 truncate">{modelOptionLabel(config, model)}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{formatModelPrice(meta)}</span>
            {formatModelDiscount(meta) ? <span className="shrink-0 rounded bg-red-50 px-1 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-950/40 dark:text-red-300">{formatModelDiscount(meta)}</span> : null}
        </span>
    );
}

function ModelIcon({ model, large = false, surface }: { model: string; capability?: ModelCapability; large?: boolean; surface?: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    const image = icon ? <img src={icon} alt="" className={large ? "size-5 dark:invert" : "size-4 dark:invert"} /> : <SoftMark name="cpu" size={large ? "md" : "sm"} />;
    if (!large) return <span className="shrink-0">{image}</span>;
    return (
        <span
            className="grid size-9 shrink-0 place-items-center rounded-[12px]"
            style={{
                background: surface || "#fff",
                boxShadow: "inset 0 0 0 1px rgba(109, 92, 255, 0.08)",
            }}
        >
            {image}
        </span>
    );
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok") || name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek") || name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm") || name.includes("glm")) return "/icons/glm.svg";
    return "";
}
