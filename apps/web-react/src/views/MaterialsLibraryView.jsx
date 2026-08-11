import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createUserAsset,
  createUserAssetGroup,
  deleteUserAsset,
  deleteUserAssetGroup,
  listUserAssetGroups,
  listUserAssets,
  updateUserAsset,
  updateUserAssetGroup,
} from "@legacy/services/meApi.js";
import { uploadFile } from "@legacy/services/tasksApi.js";
import notificationService from "@legacy/services/notification.js";
import "@legacy/views/MaterialsLibraryView.vue?react-style";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { ProgressiveAuthenticatedImage } from "../components/ProgressiveAuthenticatedImage.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import "./MaterialsLibraryView.css";

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function displayTitle(title) {
  const raw = String(title || "").trim();
  if (!raw) return "未命名素材";
  if (/^[a-f0-9]{16,}$/i.test(raw) || /^[A-Za-z0-9_-]{20,}$/.test(raw))
    return `${raw.slice(0, 8)}…`;
  return raw;
}

function materialTitle(file) {
  return String(file?.name || "个人素材")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim()
    .slice(0, 120);
}

export function MaterialsLibraryView() {
  const isDark = useIsDark();
  const mountedRef = useRef(true);
  const assetsControllerRef = useRef(null);
  const groupsControllerRef = useRef(null);
  const uploadControllerRef = useRef(null);
  const loadingRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const cursorRef = useRef(null);
  const materialsRef = useRef([]);
  const filterRef = useRef("all");
  const materialInputRef = useRef(null);
  const editInputRef = useRef(null);
  const groupNameInputRef = useRef(null);

  const [materials, setMaterials] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [totalAssetCount, setTotalAssetCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [previewMaterial, setPreviewMaterial] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadGroupId, setUploadGroupId] = useState("");
  const [pendingUploadFiles, setPendingUploadFiles] = useState([]);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [pendingGroupDelete, setPendingGroupDelete] = useState(null);
  const [editAsset, setEditAsset] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingGroupId, setEditingGroupId] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [moveMenuId, setMoveMenuId] = useState(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [showGroupComposer, setShowGroupComposer] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [renamingGroupName, setRenamingGroupName] = useState("");

  const applyMaterials = useCallback((next) => {
    const value =
      typeof next === "function" ? next(materialsRef.current) : next;
    materialsRef.current = value;
    if (mountedRef.current) setMaterials(value);
    return value;
  }, []);

  const applyCursor = useCallback((next) => {
    cursorRef.current = next || null;
    if (mountedRef.current) setCursor(next || null);
  }, []);

  const groupNameOf = useCallback(
    (asset) => {
      if (!asset?.groupId) return "未分组";
      return groups.find((group) => group.id === asset.groupId)?.name || "分组";
    },
    [groups],
  );

  const loadGroups = useCallback(async () => {
    groupsControllerRef.current?.abort();
    const controller = new AbortController();
    groupsControllerRef.current = controller;
    if (mountedRef.current) setGroupsLoading(true);
    try {
      const result = await listUserAssetGroups({ signal: controller.signal });
      if (!mountedRef.current || controller.signal.aborted) return;
      setGroups(result.items);
      setUngroupedCount(result.ungroupedCount);
      setTotalAssetCount(result.totalAssetCount);
    } catch (error) {
      if (error?.name !== "AbortError") console.warn(error);
    } finally {
      if (groupsControllerRef.current === controller) {
        groupsControllerRef.current = null;
        if (mountedRef.current) setGroupsLoading(false);
      }
    }
  }, []);

  const loadList = useCallback(
    async ({ append = false } = {}) => {
      if (append) {
        if (loadingMoreRef.current || !cursorRef.current) return;
        loadingMoreRef.current = true;
        if (mountedRef.current) setLoadingMore(true);
      } else {
        if (loadingRef.current) assetsControllerRef.current?.abort();
        loadingRef.current = true;
        if (mountedRef.current) setLoading(true);
      }
      const controller = new AbortController();
      assetsControllerRef.current = controller;
      try {
        const result = await listUserAssets({
          limit: 24,
          cursor: append ? cursorRef.current || "" : "",
          groupId: filterRef.current || "all",
          signal: controller.signal,
        });
        if (!mountedRef.current || controller.signal.aborted) return;
        applyMaterials(
          append ? [...materialsRef.current, ...result.items] : result.items,
        );
        applyCursor(result.nextCursor);
        setLoaded(true);
        if (!append && !result.nextCursor) {
          if (filterRef.current === "all")
            setTotalAssetCount((count) =>
              result.items.length > count ? result.items.length : count,
            );
          if (filterRef.current === "ungrouped")
            setUngroupedCount(result.items.length);
        }
      } catch (error) {
        if (error?.name !== "AbortError" && mountedRef.current)
          notificationService.error(error?.message || "素材库读取失败");
      } finally {
        if (assetsControllerRef.current === controller) {
          assetsControllerRef.current = null;
          loadingRef.current = false;
          loadingMoreRef.current = false;
          if (mountedRef.current) {
            setLoading(false);
            setLoadingMore(false);
          }
        }
      }
    },
    [applyCursor, applyMaterials],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadGroups();
    return () => {
      mountedRef.current = false;
      assetsControllerRef.current?.abort();
      groupsControllerRef.current?.abort();
      uploadControllerRef.current?.abort();
    };
  }, [loadGroups]);

  useEffect(() => {
    filterRef.current = activeFilter;
    setMoveMenuId(null);
    setEditAsset(null);
    applyCursor(null);
    applyMaterials([]);
    setLoaded(false);
    loadingRef.current = false;
    void loadList();
  }, [activeFilter, applyCursor, applyMaterials, loadList]);

  useEffect(() => {
    if (!editAsset) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editAsset]);

  useEffect(() => {
    if (showGroupComposer) groupNameInputRef.current?.focus();
  }, [showGroupComposer]);

  const empty = loaded && !loading && !materials.length;
  const canUpload = !uploading && totalAssetCount < 200;
  const canCreateGroup = groups.length < 50;
  const boardMeta = `${materials.length}${cursor ? "+" : ""} 项 · ${
    totalAssetCount > 0 ? `${totalAssetCount} / 200` : "上限 200"
  }`;
  const uploadTargetLabel =
    groups.find((group) => group.id === uploadGroupId)?.name ||
    (uploadGroupId ? "分组" : "未分组");

  const defaultUploadGroupId = () =>
    activeFilter !== "all" && activeFilter !== "ungrouped" ? activeFilter : "";

  const refreshAll = async () => {
    setMoveMenuId(null);
    loadingRef.current = false;
    await Promise.all([loadGroups(), loadList()]);
  };

  const openUpload = () => {
    if (!canUpload) return;
    setMoveMenuId(null);
    setUploadGroupId(defaultUploadGroupId());
    setPendingUploadFiles([]);
    setUploadOpen(true);
  };

  const closeUpload = () => {
    if (uploading) return;
    setUploadOpen(false);
    setPendingUploadFiles([]);
  };

  const onMaterialsSelected = (event) => {
    const files = Array.from(event.target?.files || []);
    if (event.target) event.target.value = "";
    if (!files.length || uploading) return;
    if (files.length > 6) {
      notificationService.warning("单次最多上传 6 张素材");
      return;
    }
    const invalid = files.find(
      (file) =>
        !file.type.startsWith("image/") ||
        file.size <= 0 ||
        file.size > 10 * 1024 * 1024,
    );
    if (invalid) {
      notificationService.warning("仅支持 10MB 以内的 PNG、JPEG 或 WebP 图片");
      return;
    }
    if (totalAssetCount + files.length > 200) {
      notificationService.warning("素材库最多保存 200 项");
      return;
    }
    setPendingUploadFiles(files);
    if (!uploadOpen) {
      setUploadGroupId(defaultUploadGroupId());
      setUploadOpen(true);
    }
  };

  const confirmUpload = async () => {
    if (!pendingUploadFiles.length) {
      materialInputRef.current?.click();
      return;
    }
    if (uploading) return;
    setUploading(true);
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    let completed = 0;
    const targetGroupId = uploadGroupId || null;
    try {
      for (const file of pendingUploadFiles) {
        const uploaded = await uploadFile(file, { signal: controller.signal });
        const payload = {
          title: materialTitle(file),
          fileKey: uploaded.key,
          thumbnailKey: uploaded.thumbnailKey,
          contentType: uploaded.contentType || file.type,
        };
        if (targetGroupId) payload.groupId = targetGroupId;
        const asset = await createUserAsset(payload);
        if (!mountedRef.current) return;
        const matchesFilter =
          filterRef.current === "all" ||
          (filterRef.current === "ungrouped" && !asset.groupId) ||
          asset.groupId === filterRef.current;
        if (matchesFilter)
          applyMaterials([
            asset,
            ...materialsRef.current.filter((item) => item.id !== asset.id),
          ]);
        completed += 1;
        setTotalAssetCount((count) => count + 1);
      }
      if (!mountedRef.current) return;
      setLoaded(true);
      setPendingUploadFiles([]);
      setUploadOpen(false);
      await loadGroups();
      const groupName = targetGroupId
        ? groups.find((group) => group.id === targetGroupId)?.name || "分组"
        : "";
      notificationService.success(
        groupName
          ? `已添加 ${completed} 项素材到「${groupName}」`
          : `已添加 ${completed} 项素材`,
      );
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        notificationService.error(
          error?.message || `已添加 ${completed} 项，其余素材上传失败`,
        );
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        if (mountedRef.current) setUploading(false);
      }
    }
  };

  const confirmDelete = async () => {
    const asset = pendingDelete;
    setPendingDelete(null);
    if (!asset) return;
    try {
      await deleteUserAsset(asset.id);
      if (!mountedRef.current) return;
      applyMaterials(
        materialsRef.current.filter((item) => item.id !== asset.id),
      );
      if (previewMaterial?.id === asset.id) setPreviewMaterial(null);
      if (editAsset?.id === asset.id) setEditAsset(null);
      setTotalAssetCount((count) => Math.max(0, count - 1));
      await loadGroups();
      notificationService.success("素材已删除");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "素材删除失败");
    }
  };

  const applyAssetUpdate = (updated) => {
    applyMaterials(
      materialsRef.current.map((item) =>
        item.id === updated.id ? { ...item, ...updated } : item,
      ),
    );
    if (previewMaterial?.id === updated.id)
      setPreviewMaterial((item) => ({ ...item, ...updated }));
    if (editAsset?.id === updated.id)
      setEditAsset((item) => ({ ...item, ...updated }));
  };

  const openEdit = (asset) => {
    setMoveMenuId(null);
    setEditAsset(asset);
    setEditingTitle(asset.title || "");
    setEditingGroupId(asset.groupId || "");
  };

  const closeEdit = () => {
    if (savingEdit) return;
    setEditAsset(null);
    setEditingTitle("");
    setEditingGroupId("");
  };

  const saveEdit = async (event) => {
    event?.preventDefault();
    if (!editAsset) return;
    const title = editingTitle.trim();
    if (!title) {
      notificationService.warning("标题不能为空");
      return;
    }
    const nextGroupId = editingGroupId || null;
    const titleChanged = title !== editAsset.title;
    const groupChanged = (editAsset.groupId || null) !== nextGroupId;
    if (!titleChanged && !groupChanged) {
      closeEdit();
      return;
    }
    setSavingEdit(true);
    try {
      const payload = {};
      if (titleChanged) payload.title = title;
      if (groupChanged) payload.groupId = nextGroupId;
      const updated = await updateUserAsset(editAsset.id, payload);
      if (!mountedRef.current) return;
      applyAssetUpdate(updated);
      const stillVisible =
        filterRef.current === "all" ||
        (filterRef.current === "ungrouped" && !updated.groupId) ||
        updated.groupId === filterRef.current;
      if (!stillVisible)
        applyMaterials(
          materialsRef.current.filter((item) => item.id !== updated.id),
        );
      if (groupChanged) await loadGroups();
      setEditAsset(null);
      setEditingTitle("");
      setEditingGroupId("");
      notificationService.success("素材已更新");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "素材更新失败");
    } finally {
      if (mountedRef.current) setSavingEdit(false);
    }
  };

  const moveToGroup = async (asset, groupId) => {
    const next = groupId || null;
    setMoveMenuId(null);
    if ((asset.groupId || null) === next) return;
    try {
      const updated = await updateUserAsset(asset.id, { groupId: next });
      if (!mountedRef.current) return;
      applyAssetUpdate(updated);
      const stillVisible =
        filterRef.current === "all" ||
        (filterRef.current === "ungrouped" && !updated.groupId) ||
        updated.groupId === filterRef.current;
      if (!stillVisible)
        applyMaterials(
          materialsRef.current.filter((item) => item.id !== asset.id),
        );
      await loadGroups();
      notificationService.success(next ? "已移入分组" : "已移出分组");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "素材更新失败");
    }
  };

  const submitCreateGroup = async (event) => {
    event.preventDefault();
    const name = newGroupName.trim();
    if (!name) {
      notificationService.warning("请输入分组名称");
      return;
    }
    setCreatingGroup(true);
    try {
      const group = await createUserAssetGroup({ name });
      if (!mountedRef.current) return;
      setGroups((items) => [...items, group]);
      setShowGroupComposer(false);
      setNewGroupName("");
      setActiveFilter(group.id);
      notificationService.success("分组已创建");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "分组创建失败");
    } finally {
      if (mountedRef.current) setCreatingGroup(false);
    }
  };

  const saveRenameGroup = async (event, group) => {
    event.preventDefault();
    const name = renamingGroupName.trim();
    if (!name) {
      notificationService.warning("请输入分组名称");
      return;
    }
    if (name === group.name) {
      setRenamingGroupId(null);
      setRenamingGroupName("");
      return;
    }
    try {
      const updated = await updateUserAssetGroup(group.id, { name });
      if (!mountedRef.current) return;
      setGroups((items) =>
        items.map((item) =>
          item.id === group.id ? { ...item, ...updated } : item,
        ),
      );
      setRenamingGroupId(null);
      setRenamingGroupName("");
      notificationService.success("分组已重命名");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "分组更新失败");
    }
  };

  const confirmDeleteGroup = async () => {
    const group = pendingGroupDelete;
    setPendingGroupDelete(null);
    if (!group) return;
    try {
      await deleteUserAssetGroup(group.id);
      if (!mountedRef.current) return;
      setGroups((items) => items.filter((item) => item.id !== group.id));
      if (filterRef.current === group.id) setActiveFilter("all");
      await refreshAll();
      notificationService.success("分组已删除");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "分组删除失败");
    }
  };

  const uploadDialog = uploadOpen
    ? createPortal(
        <div
          className={`ml-edit-backdrop${!isDark ? " is-light" : ""}`}
          onMouseDown={(event) =>
            event.target === event.currentTarget && closeUpload()
          }
        >
          <section
            className="ml-edit ml-upload"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ml-upload-title"
            onKeyDown={(event) => event.key === "Escape" && closeUpload()}
          >
            <header className="ml-edit__head">
              <h2 id="ml-upload-title">添加素材</h2>
              <button
                type="button"
                aria-label="关闭"
                disabled={uploading}
                onClick={closeUpload}
              >
                <i className="bi bi-x-lg" />
              </button>
            </header>
            <div className="ml-upload__body">
              <label className="ml-upload__field">
                <span>添加到分组</span>
                <select
                  value={uploadGroupId}
                  disabled={uploading}
                  onChange={(event) => setUploadGroupId(event.target.value)}
                >
                  <option value="">未分组</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ml-upload__picker">
                <button
                  type="button"
                  className="ml-upload__drop"
                  disabled={uploading}
                  onClick={() => materialInputRef.current?.click()}
                >
                  <i className="bi bi-image" aria-hidden="true" />
                  <strong>
                    {pendingUploadFiles.length ? "重新选择图片" : "选择图片"}
                  </strong>
                  <small>PNG / JPEG / WebP · 单张 ≤ 10MB · 最多 6 张</small>
                </button>
                {pendingUploadFiles.length > 0 && (
                  <ul className="ml-upload__files">
                    {pendingUploadFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`}>
                        <span title={file.name}>{file.name}</span>
                        <em>{formatBytes(file.size)}</em>
                        <button
                          type="button"
                          aria-label="移除"
                          disabled={uploading}
                          onClick={() =>
                            setPendingUploadFiles((files) =>
                              files.filter(
                                (_, fileIndex) => fileIndex !== index,
                              ),
                            )
                          }
                        >
                          <i className="bi bi-x" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <footer className="ml-edit__actions">
                <button
                  type="button"
                  className="ml-btn is-ghost"
                  disabled={uploading}
                  onClick={closeUpload}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="ml-btn is-primary"
                  disabled={uploading || !canUpload}
                  onClick={confirmUpload}
                >
                  {uploading && (
                    <i className="bi bi-arrow-repeat spin" aria-hidden="true" />
                  )}
                  {uploading
                    ? "上传中…"
                    : pendingUploadFiles.length
                      ? uploadGroupId
                        ? `上传到「${uploadTargetLabel}」`
                        : `上传 ${pendingUploadFiles.length} 项`
                      : "选择图片"}
                </button>
              </footer>
            </div>
          </section>
        </div>,
        document.body,
      )
    : null;

  const editDialog = editAsset
    ? createPortal(
        <div
          className={`ml-edit-backdrop${!isDark ? " is-light" : ""}`}
          onMouseDown={(event) =>
            event.target === event.currentTarget && closeEdit()
          }
        >
          <section
            className="ml-edit"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ml-edit-title"
            onKeyDown={(event) => event.key === "Escape" && closeEdit()}
          >
            <header className="ml-edit__head">
              <h2 id="ml-edit-title">编辑素材</h2>
              <button
                type="button"
                aria-label="关闭"
                disabled={savingEdit}
                onClick={closeEdit}
              >
                <i className="bi bi-x-lg" />
              </button>
            </header>
            <div className="ml-edit__body">
              <div className="ml-edit__thumb">
                <AuthenticatedImage
                  src={editAsset.thumbnailUrl}
                  alt={editAsset.title}
                  loading="eager"
                />
              </div>
              <form className="ml-edit__form" onSubmit={saveEdit}>
                <label>
                  <span>标题</span>
                  <input
                    ref={editInputRef}
                    value={editingTitle}
                    maxLength={120}
                    placeholder="素材标题"
                    disabled={savingEdit}
                    onChange={(event) => setEditingTitle(event.target.value)}
                  />
                </label>
                <label>
                  <span>分组</span>
                  <select
                    value={editingGroupId}
                    disabled={savingEdit}
                    onChange={(event) => setEditingGroupId(event.target.value)}
                  >
                    <option value="">未分组</option>
                    {groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="ml-edit__hint">
                  {formatBytes(editAsset.sizeBytes)} · 点击卡片可预览原图
                </p>
                <footer className="ml-edit__actions">
                  <button
                    type="button"
                    className="ml-btn is-ghost"
                    disabled={savingEdit}
                    onClick={closeEdit}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="ml-btn is-primary"
                    disabled={savingEdit}
                  >
                    {savingEdit && (
                      <i
                        className="bi bi-arrow-repeat spin"
                        aria-hidden="true"
                      />
                    )}
                    {savingEdit ? "保存中…" : "保存"}
                  </button>
                </footer>
              </form>
            </div>
          </section>
        </div>,
        document.body,
      )
    : null;

  const lightbox = previewMaterial
    ? createPortal(
        <div
          className={`ml-lightbox${!isDark ? " is-light" : ""}`}
          tabIndex={-1}
          onMouseDown={(event) =>
            event.target === event.currentTarget && setPreviewMaterial(null)
          }
          onKeyDown={(event) =>
            event.key === "Escape" && setPreviewMaterial(null)
          }
        >
          <button
            type="button"
            className="ml-lightbox__close"
            aria-label="关闭"
            onClick={() => setPreviewMaterial(null)}
          >
            <i className="bi bi-x-lg" />
          </button>
          <div
            className="ml-lightbox__stage"
            onMouseDown={(event) =>
              event.target === event.currentTarget && setPreviewMaterial(null)
            }
          >
            <ProgressiveAuthenticatedImage
              src={previewMaterial.url}
              previewSrc={previewMaterial.thumbnailUrl}
              alt={previewMaterial.title}
              loading="eager"
              fetchPriority="high"
              loadOriginal
            />
          </div>
          <footer className="ml-lightbox__bar">
            <div className="ml-lightbox__copy">
              <strong title={previewMaterial.title}>
                {previewMaterial.title}
              </strong>
              <small>
                {formatBytes(previewMaterial.sizeBytes)} ·{" "}
                {groupNameOf(previewMaterial)}
              </small>
            </div>
            <div className="ml-lightbox__actions">
              <button
                type="button"
                className="ml-btn is-ghost"
                onClick={() => openEdit(previewMaterial)}
              >
                <i className="bi bi-pencil" /> 编辑
              </button>
              <button
                type="button"
                className="ml-btn is-danger-ghost"
                onClick={() => setPendingDelete(previewMaterial)}
              >
                <i className="bi bi-trash3" /> 删除
              </button>
            </div>
          </footer>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className={`ml-page ${isDark ? "is-dark" : "is-light"}`}
      onClick={() => setMoveMenuId(null)}
    >
      <div className="ml-atmosphere" aria-hidden="true">
        <div className="ml-atmosphere__wash" />
        <div className="ml-atmosphere__orb ml-atmosphere__orb--a" />
        <div className="ml-atmosphere__orb ml-atmosphere__orb--b" />
      </div>
      <div className="ml-shell">
        <header className="ml-hero">
          <div className="ml-hero__copy">
            <h1>素材库</h1>
            <p>整理可复用的个人视觉素材，随时拖进创作。</p>
          </div>
          <div className="ml-hero__actions">
            <button
              type="button"
              className="ml-btn is-primary"
              disabled={!canUpload}
              onClick={openUpload}
            >
              <i
                className={`bi ${uploading ? "bi-arrow-repeat spin" : "bi-plus-lg"}`}
              />
              {uploading ? "上传中…" : "添加素材"}
            </button>
            <button
              type="button"
              className="ml-btn is-ghost"
              aria-label="刷新"
              disabled={loading || groupsLoading}
              onClick={refreshAll}
            >
              <i
                className={`bi bi-arrow-repeat${
                  loading || groupsLoading ? " spin" : ""
                }`}
              />
            </button>
            <input
              ref={materialInputRef}
              className="ml-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={onMaterialsSelected}
            />
          </div>
        </header>
        <div
          className="ml-filters"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            className={`ml-chip${activeFilter === "all" ? " is-active" : ""}`}
            onClick={() => setActiveFilter("all")}
          >
            全部 {totalAssetCount > 0 && <em>{totalAssetCount}</em>}
          </button>
          <button
            type="button"
            className={`ml-chip${
              activeFilter === "ungrouped" ? " is-active" : ""
            }`}
            onClick={() => setActiveFilter("ungrouped")}
          >
            未分组 {ungroupedCount > 0 && <em>{ungroupedCount}</em>}
          </button>
          {groups.map((group) => (
            <div key={group.id} className="ml-chip-wrap">
              {renamingGroupId !== group.id ? (
                <button
                  type="button"
                  className={`ml-chip${
                    activeFilter === group.id ? " is-active" : ""
                  }`}
                  onClick={() => setActiveFilter(group.id)}
                  onDoubleClick={() => {
                    setRenamingGroupId(group.id);
                    setRenamingGroupName(group.name || "");
                  }}
                >
                  {group.name}{" "}
                  {group.assetCount > 0 && <em>{group.assetCount}</em>}
                </button>
              ) : (
                <form
                  className="ml-chip-edit"
                  onSubmit={(event) => saveRenameGroup(event, group)}
                >
                  <input
                    value={renamingGroupName}
                    maxLength={64}
                    aria-label="分组名称"
                    autoFocus
                    onChange={(event) =>
                      setRenamingGroupName(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setRenamingGroupId(null);
                        setRenamingGroupName("");
                      }
                    }}
                  />
                  <button type="submit" aria-label="保存">
                    <i className="bi bi-check-lg" />
                  </button>
                </form>
              )}
              {renamingGroupId !== group.id && activeFilter === group.id && (
                <div className="ml-chip-ops">
                  <button
                    type="button"
                    aria-label="重命名分组"
                    onClick={() => {
                      setRenamingGroupId(group.id);
                      setRenamingGroupName(group.name || "");
                    }}
                  >
                    <i className="bi bi-pencil" />
                  </button>
                  <button
                    type="button"
                    aria-label="删除分组"
                    onClick={() => setPendingGroupDelete(group)}
                  >
                    <i className="bi bi-trash3" />
                  </button>
                </div>
              )}
            </div>
          ))}
          {showGroupComposer ? (
            <form className="ml-chip-create" onSubmit={submitCreateGroup}>
              <input
                ref={groupNameInputRef}
                value={newGroupName}
                maxLength={64}
                placeholder="分组名称"
                aria-label="新建分组名称"
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setShowGroupComposer(false);
                    setNewGroupName("");
                  }
                }}
              />
              <button type="submit" disabled={creatingGroup}>
                {creatingGroup ? "…" : "创建"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowGroupComposer(false);
                  setNewGroupName("");
                }}
              >
                取消
              </button>
            </form>
          ) : (
            canCreateGroup && (
              <button
                type="button"
                className="ml-chip is-ghost"
                onClick={() => setShowGroupComposer(true)}
              >
                <i className="bi bi-plus-lg" /> 新建分组
              </button>
            )
          )}
        </div>
        <section className="ml-board" aria-live="polite">
          <div className="ml-board__meta">
            <span>{boardMeta}</span>
            <span>单张 ≤ 10MB · 单次最多 6 张</span>
          </div>
          {loading && !materials.length ? (
            <div className="ml-grid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="ml-skel" />
              ))}
            </div>
          ) : materials.length ? (
            <div className="ml-grid">
              {materials.map((asset) => (
                <article
                  key={asset.id}
                  className={`ml-card${moveMenuId === asset.id ? " is-menu" : ""}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className="ml-card__media">
                    <button
                      type="button"
                      className="ml-card__cover"
                      onClick={() => setPreviewMaterial(asset)}
                    >
                      <AuthenticatedImage
                        src={asset.thumbnailUrl}
                        alt={asset.title}
                        loading="lazy"
                        rootMargin="180px 0px"
                      />
                    </button>
                    <div className="ml-card__toolbar">
                      <button
                        type="button"
                        title="编辑"
                        onClick={() => openEdit(asset)}
                      >
                        <i className="bi bi-pencil" />
                      </button>
                      <button
                        type="button"
                        title="移动到分组"
                        className={moveMenuId === asset.id ? "is-on" : ""}
                        onClick={() =>
                          setMoveMenuId((id) =>
                            id === asset.id ? null : asset.id,
                          )
                        }
                      >
                        <i className="bi bi-folder" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        className="is-danger"
                        onClick={() => setPendingDelete(asset)}
                      >
                        <i className="bi bi-trash3" />
                      </button>
                    </div>
                    {moveMenuId === asset.id && (
                      <div
                        className="ml-card__menu"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className={!asset.groupId ? "is-active" : ""}
                          onClick={() => moveToGroup(asset, "")}
                        >
                          未分组
                        </button>
                        {groups.map((group) => (
                          <button
                            key={group.id}
                            type="button"
                            className={
                              asset.groupId === group.id ? "is-active" : ""
                            }
                            onClick={() => moveToGroup(asset, group.id)}
                          >
                            {group.name}
                          </button>
                        ))}
                        {!groups.length && (
                          <p className="ml-card__menu-empty">
                            还没有分组，先在上方新建
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="ml-card__meta">
                    <strong title={asset.title}>
                      {displayTitle(asset.title)}
                    </strong>
                    <small>
                      {formatBytes(asset.sizeBytes)}
                      {activeFilter === "all" && asset.groupId
                        ? ` · ${groupNameOf(asset)}`
                        : ""}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          ) : empty ? (
            <div className="ml-empty">
              <i className="bi bi-collection" aria-hidden="true" />
              <strong>
                {activeFilter === "all" ? "还没有素材" : "这个分组是空的"}
              </strong>
              <p>
                {activeFilter === "all"
                  ? "上传 PNG、JPEG 或 WebP，单张不超过 10MB。"
                  : "上传到这里，或把其它素材移进来。"}
              </p>
              <button
                type="button"
                className="ml-btn is-primary"
                onClick={openUpload}
              >
                {activeFilter === "all" ? "添加素材" : "上传到此分组"}
              </button>
            </div>
          ) : null}
          {cursor && (
            <button
              type="button"
              className="ml-btn is-ghost ml-more"
              disabled={loadingMore}
              onClick={() => loadList({ append: true })}
            >
              {loadingMore ? "加载中…" : "加载更多"}
            </button>
          )}
        </section>
      </div>
      {uploadDialog}
      {editDialog}
      {lightbox}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        heading="删除这项素材？"
        description="素材原图和缩略图都会移除，删除后无法恢复。"
        confirmLabel="确认删除"
        icon="bi-trash3"
        light={!isDark}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={Boolean(pendingGroupDelete)}
        heading="删除这个分组？"
        description="分组内的素材不会删除，只会移到未分组。"
        confirmLabel="确认删除"
        icon="bi-folder-x"
        light={!isDark}
        onConfirm={confirmDeleteGroup}
        onClose={() => setPendingGroupDelete(null)}
      />
    </div>
  );
}
