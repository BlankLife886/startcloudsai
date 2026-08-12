import routeCss from "@react/legacy-styles/generated/views/UsagePlanView.css?inline";
import { UsagePlanView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function UsagePlanView() {
  useRouteStyle("react-route-style-usage-plan", routeCss);
  return <View />;
}
