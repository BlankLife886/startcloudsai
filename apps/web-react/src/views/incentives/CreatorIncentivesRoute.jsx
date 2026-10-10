import routeCss from "@react/legacy-styles/generated/views/CreatorIncentivesView.css?inline";
import { CreatorIncentivesView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function CreatorIncentivesView() {
  useRouteStyle("react-route-style-creator-incentives", routeCss);
  return <View />;
}
