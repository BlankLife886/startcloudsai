import {
  activateLegacyStyle,
  deactivateLegacyStyle,
} from "@legacy/views/CreatorIncentivesView.vue?react-style";
import { CreatorIncentivesView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function CreatorIncentivesView() {
  useRouteStyle(activateLegacyStyle, deactivateLegacyStyle);
  return <View />;
}
