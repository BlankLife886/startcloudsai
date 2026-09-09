import routeCss from "@react/legacy-styles/generated/views/CreatorIncentiveDetailView.css?inline";
import { CreatorIncentiveDetailView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function CreatorIncentiveDetailView() {
  useRouteStyle("react-route-style-creator-incentive-detail", routeCss);
  return <View />;
}
