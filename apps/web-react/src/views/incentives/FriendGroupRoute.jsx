import {
  activateLegacyStyle,
  deactivateLegacyStyle,
} from "@legacy/views/FriendGroupView.vue?react-style";
import { FriendGroupView as View } from "../IncentiveViews.jsx";
import { useRouteStyle } from "./useRouteStyle.js";

export function FriendGroupView() {
  useRouteStyle(activateLegacyStyle, deactivateLegacyStyle);
  return <View />;
}
