import routeCss from "@react/legacy-styles/generated/views/SuggestionAdoptionView.css?inline";
import { SuggestionAdoptionView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function SuggestionAdoptionView() {
  useRouteStyle("react-route-style-suggestion-adoption", routeCss);
  return <View />;
}
