import {
  activateLegacyStyle,
  deactivateLegacyStyle,
} from "@legacy/views/FailureCompensationView.vue?react-style";
import { FailureCompensationView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function FailureCompensationView() {
  useRouteStyle(activateLegacyStyle, deactivateLegacyStyle);
  return <View />;
}
