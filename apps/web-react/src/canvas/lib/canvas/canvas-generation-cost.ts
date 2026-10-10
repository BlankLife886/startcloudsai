import { getGenerationCount } from "@/lib/canvas/canvas-generation-helpers";
import { canvasImageMaxCount, canvasImageUnitPrice } from "@/lib/canvas/canvas-image-model";
import { modelOptionLabel, modelOptionMeta, resolveCanvasTextPrice, type AiConfig } from "@/stores/use-config-store";

export type CanvasCostKind = "image" | "text" | "background_remove" | "workflow";

export type CanvasCostEstimate = {
    kind: CanvasCostKind;
    modelLabel: string;
    unit: number;
    generationUnit: number;
    removalUnit: number;
    count: number;
    total: number;
    compareUnit?: number;
    compareTotal?: number;
    unitLabel: "image" | "text" | "run";
    pricingUnavailable: boolean;
};

export function estimateCanvasGenerationCost(options: { config: AiConfig; kind: CanvasCostKind; count?: number; unitOverride?: number; compareUnitOverride?: number; modelLabel?: string }): CanvasCostEstimate {
    const model = modelOptionMeta(options.config, options.config.model);
    const count = Math.max(1, Math.floor(options.count || getGenerationCount(options.config.count, canvasImageMaxCount(model))));
    const textPrice = options.kind === "text" ? resolveCanvasTextPrice(model, options.config.reasoningEffort) : null;
    // Image models may price by resolution × quality, so use the tier the submission will be billed at.
    const imagePrice = options.kind === "image" ? canvasImageUnitPrice(model, options.config) : null;
    const listedUnit = textPrice ? textPrice.effective : imagePrice ? imagePrice.effective : model?.pricePoints;
    const generationUnit = Math.max(0, Number((options.unitOverride !== undefined ? options.unitOverride : listedUnit) ?? 0));
    const compareGenerationUnit = options.unitOverride !== undefined ? options.compareUnitOverride : textPrice ? textPrice.standard : imagePrice ? imagePrice.standard : model?.standardPricePoints;
    const removalUnit = 0;
    const unit = generationUnit + removalUnit;
    const compareUnit = compareGenerationUnit !== undefined && compareGenerationUnit > generationUnit ? compareGenerationUnit + removalUnit : undefined;
    return {
        kind: options.kind,
        modelLabel: options.modelLabel || modelOptionLabel(options.config, options.config.model) || options.config.model,
        unit,
        generationUnit,
        removalUnit,
        count,
        total: unit * count,
        compareUnit,
        compareTotal: compareUnit === undefined ? undefined : compareUnit * count,
        unitLabel: options.kind === "text" ? "text" : options.kind === "background_remove" ? "run" : "image",
        pricingUnavailable: options.kind === "background_remove"
            ? options.unitOverride === undefined
            : options.kind === "text"
              ? textPrice?.effective === undefined
              : options.unitOverride === undefined && listedUnit === undefined,
    };
}
