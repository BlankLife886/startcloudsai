import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import "@react/legacy-styles/generated/features/ai-shared/ModelPointPrice.css";
import "./assistant-workspace-entry.css";
import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router";
import { AssistantWorkspaceLayout } from "../features/assistant/AssistantWorkspaceLayout.jsx";
import { useAssistantWorkspaceController } from "../features/assistant/useAssistantWorkspaceController.js";

// The rebuilt assistant is served at /assistant?v=2 during its gray release;
// the current assistant stays the default until v2 replaces it.
const AssistantV2 = lazy(() => import("../features/assistant-v2/AssistantV2.jsx").then((module) => ({ default: module.AssistantV2 })));

function AssistantV1() {
  const workspace = useAssistantWorkspaceController();
  return <AssistantWorkspaceLayout workspace={workspace} />;
}

export function AssistantWorkspaceView() {
  const [searchParams] = useSearchParams();
  if (searchParams.get("v") === "2") {
    return (
      <Suspense fallback={null}>
        <AssistantV2 />
      </Suspense>
    );
  }
  return <AssistantV1 />;
}
