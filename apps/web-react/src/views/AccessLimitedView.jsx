import { useSearchParams } from "react-router";
import { StatusBackButton, StatusShowcase } from "../components/status/StatusShowcase.jsx";

export function AccessLimitedView() {
  const [searchParams] = useSearchParams();
  const type = searchParams.get("type") || "hidden";
  const kind = type === "maintenance" ? "maintenance" : "unavailable";
  const reason = searchParams.get("reason") || "";

  return (
    <StatusShowcase
      kind={kind}
      reason={reason}
      actions={<StatusBackButton />}
    />
  );
}
