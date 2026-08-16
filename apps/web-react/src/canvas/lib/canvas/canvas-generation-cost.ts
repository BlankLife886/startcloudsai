import { getCanvasBackgroundRemovalTool } from "@/lib/canvas/canvas-background-removal-tool";
import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { modelOptionLabel, modelOptionMeta, type AiConfig } from "@/stores/use-config-store";

export type CanvasCostKind = "image" | "text" | "background_remove";

export type CanvasCostEstimate = {
    kind: CanvasCostKind;
    modelLabel: string;
    unit: number;
    generationUnit: number;
    removalUnit: number;
    count: number;
    total: number;
    unitLabel: "image" | "text" | "run";
    pricingUnavailable: boolean;
};

export function estimateCanvasGenerationCost(options: { config: AiConfig; kind: CanvasCostKind; count?: number; unitOverride?: number; modelLabel?: string; backgroundRemovalPricePoints?: number }): CanvasCostEstimate {
    const count = Math.max(1, Math.floor(options.count || getGenerationCount(options.config.count)));
    const model = modelOptionMeta(options.config, options.config.model);
    const generationUnit = Math.max(0, Number((options.unitOverride !== undefined ? options.unitOverride : model?.pricePoints) ?? 0));
    const removalTool = getCanvasBackgroundRemovalTool();
    const wantsTransparent = options.kind === "image" && options.config.background === "transparent";
    const removalPrice = options.backgroundRemovalPricePoints ?? removalTool?.pricePoints;
    const wantsRemoval = wantsTransparent && Boolean(removalTool?.id || options.backgroundRemovalPricePoints !== undefined);
    const removalUnit = wantsRemoval ? Math.max(0, Number(removalPrice ?? 0)) : 0;
    const unit = generationUnit + removalUnit;
    return {
        kind: options.kind,
        modelLabel: options.modelLabel || modelOptionLabel(options.config, options.config.model) || options.config.model,
        unit,
        generationUnit,
        removalUnit,
        count,
        total: unit * count,
        unitLabel: options.kind === "text" ? "text" : options.kind === "background_remove" ? "run" : "image",
        pricingUnavailable: options.kind === "background_remove" ? options.unitOverride === undefined : model?.pricePoints === undefined || (wantsTransparent && Boolean(removalTool?.id) && removalPrice === undefined),
    };
}
