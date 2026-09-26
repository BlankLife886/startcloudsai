import { ProductGuideTour } from "../../../views/shared/ProductGuideTour.jsx";
import {
  ASSISTANT_TOUR_STEPS,
  PRODUCT_GUIDE_KEYS,
  hasSeenProductGuide,
  markProductGuideSeen,
} from "../../../views/shared/productGuides.js";

export const ASSISTANT_TOUR_STORAGE_KEY = PRODUCT_GUIDE_KEYS.assistant;

export function hasSeenAssistantTour() {
  return hasSeenProductGuide(PRODUCT_GUIDE_KEYS.assistant);
}

export function markAssistantTourSeen() {
  markProductGuideSeen(PRODUCT_GUIDE_KEYS.assistant);
}

export function AssistantOnboardingTour({ open, dark, onClose }) {
  return (
    <ProductGuideTour
      open={open}
      dark={dark}
      steps={ASSISTANT_TOUR_STEPS}
      storageKey={PRODUCT_GUIDE_KEYS.assistant}
      onClose={onClose}
      pad={8}
      cardWidth={360}
    />
  );
}
