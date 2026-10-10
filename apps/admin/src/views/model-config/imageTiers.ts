/** One cell of an image model's resolution × quality price matrix (积分). */
export interface ImageTierPrice {
  priceCents: number;
  discountPriceCents: number | null;
  upstreamCostCents: number;
}

/** resolution → quality → cell */
export type ImagePricingMatrix = Record<string, Record<string, ImageTierPrice>>;

/** Primary + ordered backups for one resolution of a public image model. */
export interface ResolutionSlot {
  primaryModelId: string;
  backupModelIds: string[];
  autoFailover: boolean;
}

export type ResolutionSlots = Record<string, ResolutionSlot>;

export const TIER_RESOLUTIONS = ["1K", "2K", "4K"];
export const TIER_QUALITY_LABELS: Record<string, string> = { low: "低", medium: "中", high: "高", xhigh: "超高", max: "最高", auto: "自动" };

/** Keeps exactly the cells the model offers, filling new ones from the flat price. */
export function fitImagePricing(
  matrix: ImagePricingMatrix | null | undefined,
  resolutions: string[],
  qualities: string[],
  fallback: ImageTierPrice,
): ImagePricingMatrix {
  const out: ImagePricingMatrix = {};
  for (const resolution of resolutions) {
    const row: Record<string, ImageTierPrice> = {};
    for (const quality of qualities) {
      const cell = matrix?.[resolution]?.[quality];
      row[quality] = cell ? { ...cell } : { ...fallback };
    }
    out[resolution] = row;
  }
  return out;
}

export function effectiveTierPrice(cell: ImageTierPrice): number {
  return cell.discountPriceCents ?? cell.priceCents;
}

/** Slots for resolutions the model still offers, with a primary set. */
export function cleanResolutionSlots(slots: ResolutionSlots | null | undefined, resolutions: string[]): ResolutionSlots | null {
  const out: ResolutionSlots = {};
  for (const resolution of resolutions) {
    const slot = slots?.[resolution];
    if (!slot || (!slot.primaryModelId && !slot.backupModelIds.length)) continue;
    out[resolution] = {
      primaryModelId: slot.primaryModelId,
      backupModelIds: slot.backupModelIds.filter((id) => id && id !== slot.primaryModelId),
      autoFailover: slot.autoFailover,
    };
  }
  return Object.keys(out).length ? out : null;
}
