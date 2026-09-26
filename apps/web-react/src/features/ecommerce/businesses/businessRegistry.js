import {
  ECOMMERCE_MODES,
  ecommerceModeById,
} from "@react/legacy-modules/features/ecommerce/ecommerceTools.js";
import { accessoryBusiness } from "./accessory/business.js";
import { backdropBusiness } from "./backdrop/business.js";
import { backgroundBusiness } from "./background/business.js";
import { campaignBusiness } from "./campaign/business.js";
import { cloneBusiness } from "./clone/business.js";
import { detailBusiness } from "./detail/business.js";
import { enhanceBusiness } from "./enhance/business.js";
import { handheldBusiness } from "./handheld/business.js";
import { listingBusiness } from "./listing/business.js";
import { outpaintBusiness } from "./outpaint/business.js";
import { shadowBusiness } from "./shadow/business.js";
import { shootBusiness } from "./shoot/business.js";
import { tryonBusiness } from "./tryon/business.js";

const BUSINESS_OWNERS = Object.freeze([
  shootBusiness,
  listingBusiness,
  cloneBusiness,
  detailBusiness,
  campaignBusiness,
  backgroundBusiness,
  outpaintBusiness,
  enhanceBusiness,
  tryonBusiness,
  handheldBusiness,
  accessoryBusiness,
  backdropBusiness,
  shadowBusiness,
]);

export const ECOMMERCE_BUSINESSES = Object.freeze(
  BUSINESS_OWNERS.map((owner) =>
    Object.freeze({
      ...owner,
      mode: ecommerceModeById(owner.id),
    }),
  ),
);

if (ECOMMERCE_BUSINESSES.length !== ECOMMERCE_MODES.length) {
  throw new Error(
    "Every ecommerce mode must have an independent business owner",
  );
}

export function ecommerceBusinessById(id) {
  const mode = ecommerceModeById(id);
  return (
    ECOMMERCE_BUSINESSES.find((business) => business.id === mode.id) ||
    ECOMMERCE_BUSINESSES[0]
  );
}
