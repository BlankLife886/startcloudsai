import {
  activateLegacyStyle,
  deactivateLegacyStyle,
} from "@legacy/views/SuggestionAdoptionView.vue?react-style";
import { SuggestionAdoptionView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function SuggestionAdoptionView() {
  useRouteStyle(activateLegacyStyle, deactivateLegacyStyle);
  return <View />;
}
