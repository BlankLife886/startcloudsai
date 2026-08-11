import {
  activateLegacyStyle,
  deactivateLegacyStyle,
} from "@legacy/views/MembershipPlanView.vue?react-style";
import { MembershipPlanView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function MembershipPlanView() {
  useRouteStyle(activateLegacyStyle, deactivateLegacyStyle);
  return <View />;
}
