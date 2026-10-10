import { useCallback, useState } from "react";

import type { ContextMenuState, Position } from "@/types/canvas";

/**
 * Transient per-node UI surfaces (hover chrome, menus, inline editors, modals).
 *
 * These were previously sixteen useState calls in project.tsx, each dismissed by
 * hand at every site that closes canvas chrome. The three dismissal sites had
 * already drifted apart, so the reset order lives here as named operations
 * instead of being retyped per call site.
 */
export function useCanvasOverlayUi() {
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [expandedImageNodeId, setExpandedImageNodeId] = useState<string | null>(null);
    const [renameDialog, setRenameDialog] = useState<{ nodeId: string; title: string } | null>(null);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [promptListNodeId, setPromptListNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [previewImageId, setPreviewImageId] = useState<string | null>(null);

    /** Chrome that any click on empty canvas dismisses. */
    const dismissNodeOverlays = useCallback(() => {
        setContextMenu(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, []);

    /** Modal editors keyed to a node; only Escape and project teardown clear these. */
    const dismissNodeEditors = useCallback(() => {
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setSplitNodeId(null);
        setUpscaleNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setPreviewImageId(null);
    }, []);

    return {
        hoveredNodeId,
        setHoveredNodeId,
        toolbarNodeId,
        setToolbarNodeId,
        dialogNodeId,
        setDialogNodeId,
        editingNodeId,
        setEditingNodeId,
        contextMenu,
        setContextMenu,
        nodeCreatePosition,
        setNodeCreatePosition,
        expandedImageNodeId,
        setExpandedImageNodeId,
        renameDialog,
        setRenameDialog,
        cropNodeId,
        setCropNodeId,
        maskEditNodeId,
        setMaskEditNodeId,
        splitNodeId,
        setSplitNodeId,
        upscaleNodeId,
        setUpscaleNodeId,
        angleNodeId,
        setAngleNodeId,
        promptListNodeId,
        setPromptListNodeId,
        previewNodeId,
        setPreviewNodeId,
        previewImageId,
        setPreviewImageId,
        dismissNodeOverlays,
        dismissNodeEditors,
    };
}
