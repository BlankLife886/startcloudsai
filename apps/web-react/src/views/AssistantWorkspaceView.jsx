import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import "@react/legacy-styles/generated/features/ai-shared/ModelPointPrice.css";
import "./assistant-workspace-entry.css";
import { AssistantWorkspaceLayout } from "../features/assistant/AssistantWorkspaceLayout.jsx";
import { useAssistantWorkspaceController } from "../features/assistant/useAssistantWorkspaceController.js";

export function AssistantWorkspaceView() {
  const workspace = useAssistantWorkspaceController();
  return <AssistantWorkspaceLayout workspace={workspace} />;
}
