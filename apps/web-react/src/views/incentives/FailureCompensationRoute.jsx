import routeCss from "@react/legacy-styles/generated/views/FailureCompensationView.css?inline";
import { FailureCompensationView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function FailureCompensationView() {
  useRouteStyle("react-route-style-failure-compensation", routeCss);
  return <View />;
}
