import routeCss from "@react/legacy-styles/generated/views/FriendGroupView.css?inline";
import { FriendGroupView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function FriendGroupView() {
  useRouteStyle("react-route-style-friend-group", routeCss);
  return <View />;
}
