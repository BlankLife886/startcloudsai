import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasCostEstimate } from "@/lib/canvas/canvas-generation-cost";
import { CanvasHomeDialog } from "./canvas-home-dialog";

export type CanvasCostPayload = CanvasCostEstimate & {
    available: number | null;
};

type CanvasCostConfirmDialogProps = {
    cost: CanvasCostPayload | null;
    onCancel: () => void;
    onConfirm: (options: { skipEveryTime: boolean }) => void;
};

function unitShortKey(unitLabel: CanvasCostEstimate["unitLabel"]) {
    if (unitLabel === "text") return "canvas.costConfirm.perTextShort";
    if (unitLabel === "run") return "canvas.costConfirm.perRunShort";
    return "canvas.costConfirm.perImageShort";
}

export function CanvasCostConfirmDialog({ cost, onCancel, onConfirm }: CanvasCostConfirmDialogProps) {
    const { t } = useTranslation();
    const [skipEveryTime, setSkipEveryTime] = useState(false);
    const [displayCost, setDisplayCost] = useState(cost);

    useEffect(() => {
        if (cost) {
            setDisplayCost(cost);
            setSkipEveryTime(false);
        }
    }, [cost]);

    if (!displayCost) return null;

    const available = displayCost.available == null ? null : Math.max(0, displayCost.available);
    const insufficient = available != null && displayCost.total > available;
    const remaining = available == null ? null : Math.max(0, available - displayCost.total);
    const formatPoints = (value: number) => value.toLocaleString();
    const generationUnit = displayCost.generationUnit || displayCost.unit;
    const generationSubtotal = generationUnit * displayCost.count;
    const removalSubtotal = displayCost.removalUnit * displayCost.count;
    const priced = displayCost.total > 0 && !displayCost.pricingUnavailable;
    const generationLabel =
        displayCost.kind === "text"
            ? t("canvas.costConfirm.textItem")
            : displayCost.kind === "background_remove"
              ? t("canvas.costConfirm.backgroundRemove")
              : t("canvas.costConfirm.generation");
    const qty = (unit: number, unitLabel: CanvasCostEstimate["unitLabel"] = displayCost.unitLabel) =>
        t("canvas.costConfirm.qty", { unit: t(unitShortKey(unitLabel), { unit: formatPoints(unit) }), count: displayCost.count });

    return (
        <CanvasHomeDialog
            open={Boolean(cost)}
            variant="cost"
            tone={insufficient ? "danger" : "default"}
            title={t("canvas.costConfirm.title")}
            description={t("canvas.costConfirm.description")}
            closeLabel={t("canvas.costConfirm.cancel")}
            onClose={onCancel}
            afterOpenChange={(open) => {
                if (!open && !cost) setDisplayCost(null);
            }}
            footer={
                <>
                    <button type="button" className="sc-cd-btn" onClick={onCancel}>
                        {t("canvas.costConfirm.cancel")}
                    </button>
                    {insufficient ? (
                        <a className="sc-cd-btn is-solid" href="/wallet">
                            {t("canvas.costConfirm.recharge")}
                        </a>
                    ) : (
                        <button type="button" className="sc-cd-btn is-solid" onClick={() => onConfirm({ skipEveryTime })}>
                            {t("canvas.costConfirm.confirm")}
                        </button>
                    )}
                </>
            }
        >
            <div className={insufficient ? "sc-cd-quote is-danger" : "sc-cd-quote"}>
                <div className="sc-cd-quote-hero">
                    <span>{t("canvas.costConfirm.estimate")}</span>
                    {priced ? (
                        <p>
                            <strong>{formatPoints(displayCost.total)}</strong>
                            <em>{t("canvas.costConfirm.credits")}</em>
                        </p>
                    ) : (
                        <p className="is-pending">
                            <strong>{t("canvas.costConfirm.actual")}</strong>
                        </p>
                    )}
                </div>
                {priced ? (
                    <ul className="sc-cd-quote-lines">
                        <li>
                            <span>
                                {generationLabel}
                                {displayCost.modelLabel !== generationLabel ? <i>{displayCost.modelLabel}</i> : null}
                            </span>
                            <em>{qty(generationUnit)}</em>
                            <b>{formatPoints(generationSubtotal)}</b>
                        </li>
                        {displayCost.removalUnit > 0 ? (
                            <li>
                                <span>{t("canvas.costConfirm.transparentItem")}</span>
                                <em>{qty(displayCost.removalUnit, "image")}</em>
                                <b>{formatPoints(removalSubtotal)}</b>
                            </li>
                        ) : null}
                    </ul>
                ) : null}
                <div className="sc-cd-quote-flow">
                    <div>
                        <b>{t("canvas.costConfirm.availableLabel")}</b>
                        <strong>{available == null ? t("canvas.costConfirm.reading") : formatPoints(available)}</strong>
                    </div>
                    <ArrowRight width={16} height={16} />
                    <div>
                        <b>{t("canvas.costConfirm.remainingLabel")}</b>
                        <strong>{remaining == null ? t("canvas.costConfirm.pending") : insufficient ? t("canvas.costConfirm.insufficient") : formatPoints(remaining)}</strong>
                    </div>
                </div>
            </div>
            {displayCost.pricingUnavailable ? <p className="sc-cd-cost-note">{t("canvas.costConfirm.pricingUnavailable")}</p> : null}
            {insufficient ? <p className="sc-cd-cost-note">{t("canvas.costConfirm.insufficientHint")}</p> : null}
            <label className="sc-cd-cost-skip">
                <input type="checkbox" checked={skipEveryTime} onChange={(event) => setSkipEveryTime(event.target.checked)} />
                <span>{t("canvas.costConfirm.skip")}</span>
            </label>
        </CanvasHomeDialog>
    );
}
