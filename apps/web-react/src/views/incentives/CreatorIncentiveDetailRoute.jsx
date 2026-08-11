import {
  activateLegacyStyle,
  deactivateLegacyStyle,
} from "@legacy/views/CreatorIncentiveDetailView.vue?react-style";
import { CreatorIncentiveDetailView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function CreatorIncentiveDetailView() {
  useRouteStyle(activateLegacyStyle, deactivateLegacyStyle);
  return <View />;
}
