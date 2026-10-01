import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CanvasHomeDialog } from "@/components/canvas/canvas-home-dialog";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { t } = useTranslation();
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const projects = useCanvasStore((state) => state.projects);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const targets = projects.filter((project) => ids.includes(project.id));
    const close = () => setDeleteIds([]);
    const confirm = () => {
        deleteProjects(ids);
        cleanupImages();
        removeSelectedIds(ids);
        setDeleteIds([]);
    };

    return (
        <CanvasHomeDialog
            open={ids.length > 0}
            onClose={close}
            tone="danger"
            eyebrow={t("canvas.project.deleteEyebrow")}
            title={t("canvas.project.deleteTitle")}
            description={t("canvas.project.deleteDescription", { count: ids.length })}
            closeLabel={t("canvas.project.close")}
            footer={
                <>
                    <button type="button" className="sc-cd-btn" onClick={close}>
                        {t("common.cancel")}
                    </button>
                    <button type="button" className="sc-cd-btn is-danger" onClick={confirm}>
                        <Trash2 width={14} height={14} />
                        {t("common.delete")}
                    </button>
                </>
            }
        >
            {targets.length ? (
                <div className="sc-cd-list">
                    {targets.slice(0, 3).map((project) => (
                        <div key={project.id} className="sc-cd-item">
                            <strong>{project.title}</strong>
                            <span>{t("canvas.project.stats", { nodes: project.nodes.length, connections: project.connections.length })}</span>
                        </div>
                    ))}
                    {targets.length > 3 ? <div className="sc-cd-more">{t("canvas.project.moreCount", { count: targets.length - 3 })}</div> : null}
                </div>
            ) : null}
        </CanvasHomeDialog>
    );
}
