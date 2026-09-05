import { StatusBackButton, StatusShowcase } from "../components/status/StatusShowcase.jsx";

export function NotFoundView() {
  return (
    <StatusShowcase
      kind="notfound"
      actions={<StatusBackButton />}
    />
  );
}
