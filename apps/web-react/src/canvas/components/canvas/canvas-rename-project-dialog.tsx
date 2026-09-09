import { useTranslation } from "react-i18next";

import { CanvasHomeDialog } from "@/components/canvas/canvas-home-dialog";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasRenameProjectDialog() {
    const { t } = useTranslation();
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const save = () => {
        if (!editingId) return;
        renameProject(editingId, editingTitle);
        stopEditing();
    };

    return (
        <CanvasHomeDialog
            open={Boolean(editingId)}
            onClose={stopEditing}
            eyebrow={t("canvas.project.editEyebrow")}
            title={t("canvas.project.editTitle")}
            closeLabel={t("canvas.project.close")}
            footer={
                <>
                    <button type="button" className="sc-cd-btn" onClick={stopEditing}>
                        {t("common.cancel")}
                    </button>
                    <button type="button" className="sc-cd-btn is-solid" onClick={save}>
                        {t("common.save")}
                    </button>
                </>
            }
        >
            <label className="sc-cd-field">
                <span>{t("canvas.project.nameLabel")}</span>
                <input
                    value={editingTitle}
                    onChange={(event) => setEditingTitle(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && save()}
                    placeholder={t("canvas.project.namePlaceholder")}
                    autoFocus
                />
            </label>
        </CanvasHomeDialog>
    );
}
