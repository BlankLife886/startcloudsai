import { Link } from "react-router";
import { usePageControls } from "./PageControlContext.jsx";

export function PageEntryLink({ to, ...props }) {
  const { isEntryVisible } = usePageControls();
  const href = typeof to === "string"
    ? to
    : `${to?.pathname || ""}${to?.search || ""}${to?.hash || ""}`;
  return isEntryVisible(href) ? <Link to={to} {...props} /> : null;
}
