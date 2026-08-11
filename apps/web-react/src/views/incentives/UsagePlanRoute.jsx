import {
  activateLegacyStyle,
  deactivateLegacyStyle,
} from "@legacy/views/UsagePlanView.vue?react-style";
import { UsagePlanView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function UsagePlanView() {
  useRouteStyle(activateLegacyStyle, deactivateLegacyStyle);
  return <View />;
}
