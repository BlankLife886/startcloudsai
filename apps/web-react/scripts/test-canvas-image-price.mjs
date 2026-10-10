import assert from "node:assert/strict";
import test from "node:test";

import { canvasImageUnitPrice, formatCanvasImagePriceParts } from "../src/canvas/lib/canvas/canvas-image-model.ts";
import { resolveModelTierPointPricing } from "../src/legacy-modules/features/ai-shared/modelPointPricing.js";

const tiered = {
    name: "gpt-image-2",
    capability: "image",
    pricePoints: 3,
    standardPricePoints: 3,
    resolutions: ["1K", "2K", "4K"],
    qualities: ["low", "medium", "high"],
    defaultQuality: "medium",
    imagePricing: {
        "1K": { low: { priceCents: 2 }, medium: { priceCents: 3 }, high: { priceCents: 6 } },
        "2K": { low: { priceCents: 4 }, medium: { priceCents: 8 }, high: { priceCents: 12, discountPriceCents: 10 } },
        "4K": { low: { priceCents: 9 }, medium: { priceCents: 16 }, high: { priceCents: 24 } },
    },
};
const flat = { name: "flat", capability: "image", pricePoints: 5, standardPricePoints: 5, qualities: ["low", "high"] };

test("tiered models price at the chosen resolution and quality", () => {
    assert.equal(canvasImageUnitPrice(tiered, { resolution: "1K", quality: "high" }).effective, 6);
    assert.equal(canvasImageUnitPrice(tiered, { resolution: "4K", quality: "low" }).effective, 9);
    assert.deepEqual(canvasImageUnitPrice(tiered, { resolution: "2K", quality: "high" }), { effective: 10, standard: 12 });
    assert.equal(formatCanvasImagePriceParts(tiered, { resolution: "2K", quality: "high" }).comparePrice, "12");
});

test("auto quality follows the server's billing tier", () => {
    // A model that offers auto prices it as its own column.
    const withAuto = { ...tiered, qualities: [...tiered.qualities, "auto"], imagePricing: { ...tiered.imagePricing, "2K": { ...tiered.imagePricing["2K"], auto: { priceCents: 7 } } } };
    assert.equal(canvasImageUnitPrice(withAuto, { resolution: "2K", quality: "auto" }).effective, 7);
    // Otherwise auto bills at the default quality.
    assert.equal(resolveModelTierPointPricing(tiered, { resolution: "2K", quality: "auto" }).effective, 8);
    assert.equal(resolveModelTierPointPricing(tiered, { resolution: "2K", quality: "" }).effective, 8);
});

test("exact sizes price by pixel count", () => {
    const exact = { ...tiered, supportsExactSize: true };
    assert.equal(canvasImageUnitPrice(exact, { sizeMode: "exact", exactWidth: "2048", exactHeight: "2048", quality: "low" }).effective, 4);
    assert.equal(canvasImageUnitPrice(exact, { sizeMode: "exact", exactWidth: "4096", exactHeight: "2048", quality: "low" }).effective, 9);
});

test("flat models keep their single price", () => {
    assert.equal(canvasImageUnitPrice(flat, { resolution: "4K", quality: "high" }).effective, 5);
});
