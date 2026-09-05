import routeCss from "@react/legacy-styles/generated/views/MembershipPlanView.css?inline";
import { MembershipPlanView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function MembershipPlanView() {
  useRouteStyle("react-route-style-membership-plan", routeCss);
  return <View />;
}
