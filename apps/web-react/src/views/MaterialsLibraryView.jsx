import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import {
  createUserAsset,
  createUserAssetGroup,
  deleteUserAsset,
  deleteUserAssetGroup,
  listUserAssetGroups,
  listUserAssets,
  updateUserAsset,
  updateUserAssetGroup,
} from "@react/legacy-modules/services/meApi.js";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import { setBodyScrollLock } from "@react/legacy-modules/utils/bodyScrollLock.js";
import notificationService from "@react/legacy-modules/services/notification.js";
import "@react/legacy-styles/generated/views/MaterialsLibraryView.css";
import "@react/legacy-static/features/creator-hub/creator-hub.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { ConfirmDialog } from "../components/ConfirmDialog.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { useContentReveal } from "../components/motion/useContentReveal.js";
import { useIsDark } from "../hooks/useIsDark.js";
import { useLocale } from "../i18n/index.js";
import "./MaterialsLibraryView.css";

gsap.registerPlugin(useGSAP);

const ASSET_PREVIEW_LOCK = "react-assets-preview";

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDimensions(size) {
  const width = Number(size?.w || size?.width || 0);
  const height = Number(size?.h || size?.height || 0);
  if (!width || !height) return "";
  return `${width} × ${height}`;
}

function displayTitle(title) {
  const raw = String(title || "").trim();
  if (!raw) return "未命名素材";
  if (/[\u4e00-\u9fff]/.test(raw) || /\s/.test(raw)) return raw;
  if (/^[a-f0-9]{8,}$/i.test(raw)) return "未命名素材";
  if (
    /^[A-Za-z0-9_-]{12,}$/.test(raw) &&
    /[A-Z]/.test(raw) &&
    /[a-z]/.test(raw) &&
    /\d/.test(raw)
  )
    return "未命名素材";
  return raw;
}

function assetDuplicateKeys(asset) {
  const keys = [];
  if (asset?.fileKey) keys.push(`file:${asset.fileKey}`);
  if (asset?.thumbnailKey) keys.push(`thumb:${asset.thumbnailKey}`);
  const title = String(asset?.title || "")
    .trim()
    .toLowerCase();
  const size = Number(asset?.sizeBytes || 0);
  if (title && size) keys.push(`meta:${title}:${size}`);
  return keys;
}

function materialTitle(file) {
  return String(file?.name || "个人资产")
    .replace(/\.[a-z0-9]+$/i, "")
    .trim()
    .slice(0, 120);
}

function motionDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

function AssetGroupMenu({ open, dropUp = false, children }) {
  const rootRef = useRef(null);
  const [present, setPresent] = useState(Boolean(open));

  useEffect(() => {
    if (open) setPresent(true);
  }, [open]);

  useGSAP(
    (context, contextSafe) => {
      const root = rootRef.current;
      if (!present || !root) return undefined;
      const items = Array.from(root.querySelectorAll("[data-group-menu-item]"));
      const targets = [root, ...items];
      const finishExit = contextSafe(() => setPresent(false));

      gsap.killTweensOf(targets);
      if (motionDisabled()) {
        gsap.set(targets, { autoAlpha: 1, clearProps: "transform" });
        if (!open) finishExit();
        return undefined;
      }

      const offset = dropUp ? 8 : -8;
      if (!open) {
        gsap
          .timeline({ onComplete: finishExit })
          .to(
            items,
            { autoAlpha: 0, y: dropUp ? 3 : -3, duration: 0.08, stagger: 0.008, ease: "power1.in" },
            0,
          )
          .to(
            root,
            { autoAlpha: 0, y: dropUp ? 6 : -6, scale: 0.98, duration: 0.16, ease: "power2.in" },
            0,
          );
        return undefined;
      }

      gsap
        .timeline({ defaults: { ease: "power3.out" } })
        .fromTo(
          root,
          { autoAlpha: 0, y: offset, scale: 0.96 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.22, clearProps: "transform" },
          0,
        )
        .fromTo(
          items,
          { autoAlpha: 0, y: 6 },
          { autoAlpha: 1, y: 0, duration: 0.18, stagger: 0.018, clearProps: "transform" },
          0.05,
        );
      return undefined;
    },
    { dependencies: [dropUp, open, present], scope: rootRef },
  );

  if (!present) return null;
  return (
    <div
      ref={rootRef}
      className="ml-card__menu"
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}

function randomDigits(length = 4) {
  const max = 10 ** length;
  return String(Math.floor(Math.random() * max)).padStart(length, "0");
}

function buildBatchTitles(prefix, count) {
  const used = new Set();
  const titles = [];
  const digits = count > 9000 ? 5 : 4;
  while (titles.length < count) {
    const suffix = randomDigits(digits);
    if (used.has(suffix)) continue;
    used.add(suffix);
    titles.push(`${prefix}${suffix}`);
  }
  return titles;
}

async function mapPool(items, worker, concurrency = 4) {
  const queue = [...items];
  const results = [];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length || 1) }, async () => {
      while (queue.length) {
        const item = queue.shift();
        results.push(await worker(item));
      }
    }),
  );
  return results;
}

export function MaterialsLibraryView() {
  const auth = useAuth();
  const { requestAuth } = useAuthPrompt();
  const { t } = useLocale();
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
  const batchRenameInputRef = useRef(null);
  const pageRef = useRef(null);
  const sentinelRef = useRef(null);

  const [materials, setMaterials] = useState([]);
  const [groups, setGroups] = useState([]);
  const [ungroupedCount, setUngroupedCount] = useState(0);
  const [totalAssetCount, setTotalAssetCount] = useState(0);
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(auth.loading);
  const [loadingMore, setLoadingMore] = useState(false);
  const [groupsLoading, setGroupsLoading] = useState(auth.loading);
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
  const [savingGroup, setSavingGroup] = useState(false);
  const [showGroupComposer, setShowGroupComposer] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [renamingGroupId, setRenamingGroupId] = useState(null);
  const [renamingGroupName, setRenamingGroupName] = useState("");
  const [query, setQuery] = useState("");
  const [showDuplicatesOnly, setShowDuplicatesOnly] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [batchMoveOpen, setBatchMoveOpen] = useState(false);
  const [batchRenameOpen, setBatchRenameOpen] = useState(false);
  const [batchRenamePrefix, setBatchRenamePrefix] = useState("");
  const [pendingBulkDelete, setPendingBulkDelete] = useState(null);
  const [assetDimensions, setAssetDimensions] = useState({});

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

  const requireAssetLogin = useCallback(
    () => requestAuth({ featureLabel: "我的资产" }),
    [requestAuth],
  );

  const groupNameOf = useCallback(
    (asset) => {
      if (!asset?.groupId) return "未分组";
      return groups.find((group) => group.id === asset.groupId)?.name || "分组";
    },
    [groups],
  );

  const loadGroups = useCallback(async () => {
    if (!auth.isAuthenticated) return;
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
  }, [auth.isAuthenticated]);

  const loadList = useCallback(
    async ({ append = false } = {}) => {
      if (!auth.isAuthenticated) return;
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
          notificationService.error(error?.message || "资产读取失败");
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
    [applyCursor, applyMaterials, auth.isAuthenticated],
  );

  useEffect(() => {
    mountedRef.current = true;
    document.documentElement.classList.add("creator-hub-sticky-page");
    return () => {
      mountedRef.current = false;
      document.documentElement.classList.remove("creator-hub-sticky-page");
      setBodyScrollLock(ASSET_PREVIEW_LOCK, false);
      assetsControllerRef.current?.abort();
      groupsControllerRef.current?.abort();
      uploadControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (auth.loading) return;
    if (!auth.isAuthenticated) {
      assetsControllerRef.current?.abort();
      groupsControllerRef.current?.abort();
      applyMaterials([]);
      applyCursor(null);
      setGroups([]);
      setUngroupedCount(0);
      setTotalAssetCount(0);
      setLoading(false);
      setGroupsLoading(false);
      setLoaded(true);
      return;
    }
    void loadGroups();
  }, [
    applyCursor,
    applyMaterials,
    auth.isAuthenticated,
    auth.loading,
    loadGroups,
  ]);

  useEffect(() => {
    if (!sentinelRef.current || !cursor || showDuplicatesOnly || query.trim()) return undefined;
    const observer = new IntersectionObserver(
      (entries) =>
        entries.some((entry) => entry.isIntersecting) &&
        loadList({ append: true }),
      { rootMargin: "160px 0px" },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [cursor, loadList, query, showDuplicatesOnly]);

  useEffect(() => {
    filterRef.current = activeFilter;
    setMoveMenuId(null);
    setEditAsset(null);
    setSelectedIds(new Set());
    setBatchMoveOpen(false);
    applyCursor(null);
    applyMaterials([]);
    setLoaded(false);
    loadingRef.current = false;
    if (!auth.loading && auth.isAuthenticated) void loadList();
    else if (!auth.loading) {
      setLoading(false);
      setLoaded(true);
    }
  }, [
    activeFilter,
    applyCursor,
    applyMaterials,
    auth.isAuthenticated,
    auth.loading,
    loadList,
  ]);

  useEffect(() => {
    if (!editAsset) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [editAsset]);

  useEffect(() => {
    if (showGroupComposer || renamingGroupId) groupNameInputRef.current?.focus();
  }, [renamingGroupId, showGroupComposer]);

  useEffect(() => {
    if (batchRenameOpen) batchRenameInputRef.current?.focus();
  }, [batchRenameOpen]);

  useEffect(() => {
    setSelectedIds((current) => {
      if (!current.size) return current;
      const alive = new Set(materials.map((item) => item.id));
      const next = new Set([...current].filter((id) => alive.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [materials]);

  useEffect(() => {
    if (!previewMaterial) {
      setBodyScrollLock(ASSET_PREVIEW_LOCK, false);
      return undefined;
    }
    setBodyScrollLock(ASSET_PREVIEW_LOCK, true, { freezeViewport: false });
    return () => setBodyScrollLock(ASSET_PREVIEW_LOCK, false);
  }, [previewMaterial]);

  const empty = loaded && !loading && !materials.length;
  const canUpload = !uploading && totalAssetCount < 200;
  const canCreateGroup = groups.length < 50;
  const showUngrouped = groups.length > 0 || activeFilter === "ungrouped";
  const visibleGroups = useMemo(
    () =>
      groups.filter(
        (group) =>
          (group.assetCount || 0) > 0 ||
          activeFilter === group.id ||
          renamingGroupId === group.id,
      ),
    [activeFilter, groups, renamingGroupId],
  );
  const editingGroup =
    groups.find((group) => group.id === renamingGroupId) || null;
  const activeCustomGroup =
    activeFilter !== "all" && activeFilter !== "ungrouped"
      ? groups.find((group) => group.id === activeFilter) || null
      : null;
  const duplicateKeys = useMemo(() => {
    const counts = new Map();
    for (const asset of materials) {
      for (const key of assetDuplicateKeys(asset)) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([key]) => key),
    );
  }, [materials]);
  const isDuplicateAsset = useCallback(
    (asset) =>
      assetDuplicateKeys(asset).some((key) => duplicateKeys.has(key)),
    [duplicateKeys],
  );
  const duplicateItemCount = useMemo(
    () => materials.filter(isDuplicateAsset).length,
    [isDuplicateAsset, materials],
  );
  const visibleMaterials = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const items = materials.filter((asset) => {
      if (showDuplicatesOnly && !isDuplicateAsset(asset)) return false;
      if (!keyword) return true;
      const title = String(asset.title || "").toLowerCase();
      const shown = displayTitle(asset.title).toLowerCase();
      const group = groupNameOf(asset).toLowerCase();
      return (
        title.includes(keyword) ||
        shown.includes(keyword) ||
        group.includes(keyword)
      );
    });
    if (!showDuplicatesOnly) return items;
    return [...items].sort((left, right) => {
      const leftTitle = String(left.title || "").toLowerCase();
      const rightTitle = String(right.title || "").toLowerCase();
      if (leftTitle !== rightTitle) return leftTitle.localeCompare(rightTitle);
      return Number(left.sizeBytes || 0) - Number(right.sizeBytes || 0);
    });
  }, [groupNameOf, isDuplicateAsset, materials, query, showDuplicatesOnly]);
  const noVisible = !empty && loaded && !loading && !visibleMaterials.length;
  const selectedAssets = useMemo(
    () => materials.filter((asset) => selectedIds.has(asset.id)),
    [materials, selectedIds],
  );
  const selectedCount = selectedAssets.length;
  const selectedGroupId = useMemo(() => {
    if (!selectedAssets.length) return undefined;
    const first = selectedAssets[0].groupId || "";
    return selectedAssets.every((asset) => (asset.groupId || "") === first)
      ? first
      : undefined;
  }, [selectedAssets]);
  const batchRenameExample = `${(batchRenamePrefix.trim() || "产品图_").slice(0, 100)}1847`;
  const previewIndex = previewMaterial
    ? visibleMaterials.findIndex((asset) => asset.id === previewMaterial.id)
    : -1;
  useContentReveal({
    rootRef: pageRef,
    selector: ".ml-grid .ml-card",
    ready: !loading,
    resetKey: activeFilter,
    contentKey: visibleMaterials.map((asset) => asset.id).join("|"),
    stateAttribute: "data-assets-content-motion-state",
  });
  const uploadTargetLabel =
    groups.find((group) => group.id === uploadGroupId)?.name ||
    (uploadGroupId ? "分组" : "未分组");

  const defaultUploadGroupId = () =>
    activeFilter !== "all" && activeFilter !== "ungrouped" ? activeFilter : "";

  const refreshAll = async () => {
    if (requireAssetLogin()) return;
    setMoveMenuId(null);
    loadingRef.current = false;
    await Promise.all([loadGroups(), loadList()]);
  };

  const openUpload = () => {
    if (requireAssetLogin()) return;
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
      notificationService.warning("单次最多上传 6 项资产");
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
      notificationService.warning("我的资产最多保存 200 项");
      return;
    }
    setPendingUploadFiles(files);
    if (!uploadOpen) {
      setUploadGroupId(defaultUploadGroupId());
      setUploadOpen(true);
    }
  };

  const confirmUpload = async () => {
    if (requireAssetLogin()) return;
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
          ? `已添加 ${completed} 项资产到「${groupName}」`
          : `已添加 ${completed} 项资产`,
      );
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        notificationService.error(
          error?.message || `已添加 ${completed} 项，其余资产上传失败`,
        );
    } finally {
      if (uploadControllerRef.current === controller) {
        uploadControllerRef.current = null;
        if (mountedRef.current) setUploading(false);
      }
    }
  };

  const confirmDelete = async () => {
    if (requireAssetLogin()) return;
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
      notificationService.success("资产已删除");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "资产删除失败");
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
    if (requireAssetLogin()) return;
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
      notificationService.success("资产已更新");
    } catch (error) {
      if (mountedRef.current)
        notificationService.error(error?.message || "资产更新失败");
    } finally {
      if (mountedRef.current) setSavingEdit(false);
    }
  };

  const moveToGroup = async (asset, groupId) => {
    if (requireAssetLogin()) return;
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
        notificationService.error(error?.message || "资产更新失败");
    }
  };

  const rememberDimensions = (id, event) => {
    const image = event.currentTarget;
    const width = Number(image?.naturalWidth || 0);
    const height = Number(image?.naturalHeight || 0);
    if (!id || !width || !height) return;
    setAssetDimensions((current) => {
      const prev = current[id];
      if (prev?.w === width && prev?.h === height) return current;
      return { ...current, [id]: { w: width, h: height } };
    });
  };

  const toggleSelected = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectMode = () => {
    setSelectMode((value) => !value);
    setSelectedIds(new Set());
    setBatchMoveOpen(false);
    setMoveMenuId(null);
    setPreviewMaterial(null);
  };

  const selectVisible = () => {
    setSelectedIds(new Set(visibleMaterials.map((asset) => asset.id)));
  };

  const applyBulkUpdates = (updatedItems) => {
    if (!updatedItems.length) return;
    const byId = new Map(updatedItems.map((item) => [item.id, item]));
    applyMaterials(
      materialsRef.current
        .map((item) => (byId.has(item.id) ? { ...item, ...byId.get(item.id) } : item))
        .filter((item) => {
          if (!byId.has(item.id)) return true;
          return (
            filterRef.current === "all" ||
            (filterRef.current === "ungrouped" && !item.groupId) ||
            item.groupId === filterRef.current
          );
        }),
    );
    setPreviewMaterial((current) =>
      current && byId.has(current.id)
        ? { ...current, ...byId.get(current.id) }
        : current,
    );
  };

  const batchMoveToGroup = async (groupId) => {
    if (requireAssetLogin()) return;
    const next = groupId || null;
    const targets = selectedAssets.filter(
      (asset) => (asset.groupId || null) !== next,
    );
    setBatchMoveOpen(false);
    if (!targets.length) {
      notificationService.info("所选资产已在该分组");
      return;
    }
    setBulkBusy(true);
    const updatedItems = [];
    let failed = 0;
    try {
      await mapPool(targets, async (asset) => {
        try {
          updatedItems.push(await updateUserAsset(asset.id, { groupId: next }));
        } catch {
          failed += 1;
        }
      });
      if (!mountedRef.current) return;
      applyBulkUpdates(updatedItems);
      setSelectedIds(new Set());
      await loadGroups();
      if (failed) {
        notificationService.error(
          `已移动 ${updatedItems.length} 项，${failed} 项失败`,
        );
      } else {
        notificationService.success(
          next
            ? `已将 ${updatedItems.length} 项移入分组`
            : `已将 ${updatedItems.length} 项移出分组`,
        );
      }
    } finally {
      if (mountedRef.current) setBulkBusy(false);
    }
  };

  const openBatchRename = () => {
    if (requireAssetLogin()) return;
    if (!selectedCount) return;
    setBatchMoveOpen(false);
    setBatchRenamePrefix("");
    setBatchRenameOpen(true);
  };

  const closeBatchRename = () => {
    if (bulkBusy) return;
    setBatchRenameOpen(false);
    setBatchRenamePrefix("");
  };

  const submitBatchRename = async (event) => {
    event.preventDefault();
    if (requireAssetLogin()) return;
    const prefix = batchRenamePrefix.trim().slice(0, 100);
    if (!prefix) {
      notificationService.warning("请输入标题前缀");
      return;
    }
    if (!selectedAssets.length) return;
    const titles = buildBatchTitles(prefix, selectedAssets.length);
    setBulkBusy(true);
    const updatedItems = [];
    let failed = 0;
    try {
      await mapPool(
        selectedAssets.map((asset, index) => ({ asset, title: titles[index] })),
        async ({ asset, title }) => {
          if (asset.title === title) {
            updatedItems.push(asset);
            return;
          }
          try {
            updatedItems.push(await updateUserAsset(asset.id, { title }));
          } catch {
            failed += 1;
          }
        },
      );
      if (!mountedRef.current) return;
      applyBulkUpdates(updatedItems);
      setSelectedIds(new Set());
      setBatchRenameOpen(false);
      setBatchRenamePrefix("");
      if (failed) {
        notificationService.error(
          `已重命名 ${updatedItems.length} 项，${failed} 项失败`,
        );
      } else {
        notificationService.success(`已重命名 ${updatedItems.length} 项`);
      }
    } finally {
      if (mountedRef.current) setBulkBusy(false);
    }
  };

  const confirmBulkDelete = async () => {
    if (requireAssetLogin()) return;
    const ids = pendingBulkDelete || [];
    if (!ids.length || bulkBusy) return;
    setBulkBusy(true);
    const removed = new Set();
    let failed = 0;
    try {
      await mapPool(ids, async (id) => {
        try {
          await deleteUserAsset(id);
          removed.add(id);
        } catch {
          failed += 1;
        }
      });
      if (!mountedRef.current) return;
      applyMaterials(
        materialsRef.current.filter((item) => !removed.has(item.id)),
      );
      if (previewMaterial && removed.has(previewMaterial.id)) {
        setPreviewMaterial(null);
      }
      if (editAsset && removed.has(editAsset.id)) setEditAsset(null);
      setTotalAssetCount((count) => Math.max(0, count - removed.size));
      setSelectedIds(new Set());
      setPendingBulkDelete(null);
      await loadGroups();
      if (failed) {
        notificationService.error(
          `已删除 ${removed.size} 项，${failed} 项失败`,
        );
      } else {
        notificationService.success(`已删除 ${removed.size} 项资产`);
      }
    } finally {
      if (mountedRef.current) setBulkBusy(false);
    }
  };

  const closeGroupDrawer = () => {
    if (creatingGroup || savingGroup) return;
    setShowGroupComposer(false);
    setNewGroupName("");
    setRenamingGroupId(null);
    setRenamingGroupName("");
  };

  const openCreateGroup = () => {
    if (requireAssetLogin()) return;
    setRenamingGroupId(null);
    setRenamingGroupName("");
    setNewGroupName("");
    setShowGroupComposer(true);
  };

  const openEditGroup = (group) => {
    if (requireAssetLogin()) return;
    if (!group) return;
    setShowGroupComposer(false);
    setNewGroupName("");
    setRenamingGroupId(group.id);
    setRenamingGroupName(group.name || "");
  };

  const submitCreateGroup = async (event) => {
    event.preventDefault();
    if (requireAssetLogin()) return;
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
    if (requireAssetLogin()) return;
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
    setSavingGroup(true);
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
    } finally {
      if (mountedRef.current) setSavingGroup(false);
    }
  };

  const confirmDeleteGroup = async () => {
    if (requireAssetLogin()) return;
    const group = pendingGroupDelete;
    setPendingGroupDelete(null);
    if (!group) return;
    try {
      await deleteUserAssetGroup(group.id);
      if (!mountedRef.current) return;
      setGroups((items) => items.filter((item) => item.id !== group.id));
      if (filterRef.current === group.id) setActiveFilter("all");
      setRenamingGroupId(null);
      setRenamingGroupName("");
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
              <h2 id="ml-upload-title">{t("添加资产")}</h2>
              <button
                type="button"
                aria-label={t("关闭")}
                disabled={uploading}
                onClick={closeUpload}
              >
                <i className="bi bi-x-lg" />
              </button>
            </header>
            <div className="ml-upload__body">
              <label className="ml-upload__field">
                <span>{t("添加到分组")}</span>
                <select
                  value={uploadGroupId}
                  disabled={uploading}
                  onChange={(event) => setUploadGroupId(event.target.value)}
                >
                  <option value="">{t("未分组")}</option>
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
                    {t(pendingUploadFiles.length ? "重新选择图片" : "选择图片")}
                  </strong>
                  <small>{t("PNG / JPEG / WebP · 单张 ≤ 10MB · 最多 6 张")}</small>
                </button>
                {pendingUploadFiles.length > 0 && (
                  <ul className="ml-upload__files">
                    {pendingUploadFiles.map((file, index) => (
                      <li key={`${file.name}-${index}`}>
                        <span title={file.name}>{file.name}</span>
                        <em>{formatBytes(file.size)}</em>
                        <button
                          type="button"
                          aria-label={t("移除")}
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
                  {t("取消")}
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
                    ? t("上传中…")
                    : pendingUploadFiles.length
                      ? uploadGroupId
                        ? t(`上传到「${uploadTargetLabel}」`)
                        : t(`上传 ${pendingUploadFiles.length} 项`)
                      : t("选择图片")}
                </button>
              </footer>
            </div>
          </section>
        </div>,
        document.body,
      )
    : null;

  const editDialog = (
    <DialogMotion
      open={Boolean(editAsset)}
      layerClassName={`ml-edit-backdrop${!isDark ? " is-light" : ""}`}
      panelClassName="ml-edit"
      ariaLabelledby="ml-edit-title"
      initialFocusRef={editInputRef}
      closeDisabled={savingEdit}
      onClose={closeEdit}
    >
      {editAsset ? (
        <>
          <header className="ml-edit__head" data-dialog-motion-item>
            <h2 id="ml-edit-title">编辑资产</h2>
            <button
              type="button"
              aria-label="关闭"
              disabled={savingEdit}
              onClick={closeEdit}
            >
              <i className="bi bi-x-lg" />
            </button>
          </header>
          <div className="ml-edit__body" data-dialog-motion-item>
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
                  placeholder="资产标题"
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
                    <i className="bi bi-arrow-repeat spin" aria-hidden="true" />
                  )}
                  {savingEdit ? "保存中…" : "保存"}
                </button>
              </footer>
            </form>
          </div>
        </>
      ) : null}
    </DialogMotion>
  );

  const showPreviewAt = (index) => {
    const next = visibleMaterials[index];
    if (next) setPreviewMaterial(next);
  };

  return (
    <main
      ref={pageRef}
      className={`ch-page ch-page--prompts ml-page ${isDark ? "is-dark" : "is-light"}`}
      onClick={() => {
        setMoveMenuId(null);
        setBatchMoveOpen(false);
      }}
    >
      <div className="ch-shell">
        <div className="ch-sticky-bar">
          <div className="ch-toolbar">
            <label className="ch-search">
              <i className="bi bi-search" aria-hidden="true" />
              <input
                type="search"
                value={query}
                placeholder="搜索标题或分组"
                aria-label="搜索标题或分组"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="ch-btn is-primary"
              disabled={auth.isAuthenticated && !canUpload}
              onClick={openUpload}
            >
              <i
                className={`bi ${uploading ? "bi-arrow-repeat spin" : "bi-plus-lg"}`}
              />
              {uploading ? "上传中…" : "添加资产"}
            </button>
            <button
              type="button"
              className="ch-btn is-ghost"
              aria-label="刷新"
              title="刷新资产"
              disabled={auth.isAuthenticated && (loading || groupsLoading)}
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
          <div className="ml-group-bar">
            <nav
              className="ch-chips"
              aria-label="资产分组"
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                className={`ch-chip${activeFilter === "all" && !showDuplicatesOnly ? " is-active" : ""}`}
                onClick={() => {
                  setShowDuplicatesOnly(false);
                  setActiveFilter("all");
                }}
              >
                全部 {totalAssetCount}
              </button>
              {showUngrouped && (
                <button
                  type="button"
                  className={`ch-chip${activeFilter === "ungrouped" ? " is-active" : ""}`}
                  onClick={() => {
                    setShowDuplicatesOnly(false);
                    setActiveFilter("ungrouped");
                  }}
                >
                  未分组 {ungroupedCount}
                </button>
              )}
              {visibleGroups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  data-click-guard="off"
                  className={`ch-chip${activeFilter === group.id ? " is-active" : ""}`}
                  onClick={() => {
                    setShowDuplicatesOnly(false);
                    setActiveFilter(group.id);
                  }}
                >
                  {group.name} {group.assetCount || 0}
                </button>
              ))}
              {duplicateKeys.size > 0 && (
                <button
                  type="button"
                  className={`ch-chip${showDuplicatesOnly ? " is-active" : ""}`}
                  onClick={() => setShowDuplicatesOnly((value) => !value)}
                >
                  重复项 {duplicateItemCount}
                </button>
              )}
            </nav>
            <div className="ml-group-bar__actions">
              <button
                type="button"
                className={`ch-chip${selectMode ? " is-active" : ""}`}
                disabled={bulkBusy}
                onClick={toggleSelectMode}
              >
                {selectMode ? "退出多选" : "多选"}
              </button>
              {activeCustomGroup && (
                <>
                  <button
                    type="button"
                    className="ch-chip"
                    onClick={() => openEditGroup(activeCustomGroup)}
                  >
                    编辑分组
                  </button>
                  <button
                    type="button"
                    className="ch-chip is-danger"
                    disabled={bulkBusy}
                    onClick={() => setPendingGroupDelete(activeCustomGroup)}
                  >
                    删除分组
                  </button>
                </>
              )}
              {canCreateGroup && (
                <button
                  type="button"
                  className="ch-chip"
                  onClick={openCreateGroup}
                >
                  + 新建分组
                </button>
              )}
            </div>
          </div>
          {selectMode && (
            <div
              className="ch-bulk-bar ml-bulk-bar"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="ml-bulk-bar__count">
                已选 {selectedCount}
              </span>
              <button
                type="button"
                className="ch-chip"
                disabled={bulkBusy || !visibleMaterials.length}
                onClick={selectVisible}
              >
                全选当前
              </button>
              <div className="ml-bulk-move">
                <button
                  type="button"
                  className={`ch-chip${batchMoveOpen ? " is-active" : ""}`}
                  disabled={bulkBusy || !selectedCount}
                  onClick={() => setBatchMoveOpen((open) => !open)}
                >
                  移入分组
                </button>
                <AssetGroupMenu open={batchMoveOpen}>
                  <button
                    type="button"
                    data-group-menu-item
                    className={selectedGroupId === "" ? "is-active" : ""}
                    disabled={bulkBusy}
                    onClick={() => batchMoveToGroup("")}
                  >
                    未分组
                  </button>
                  {groups.map((group) => (
                    <button
                      key={group.id}
                      type="button"
                      data-group-menu-item
                      className={
                        selectedGroupId === group.id ? "is-active" : ""
                      }
                      disabled={bulkBusy}
                      onClick={() => batchMoveToGroup(group.id)}
                    >
                      {group.name}
                    </button>
                  ))}
                  {!groups.length && (
                    <p className="ml-card__menu-empty" data-group-menu-item>
                      还没有分组，先在上方新建
                    </p>
                  )}
                </AssetGroupMenu>
              </div>
              <button
                type="button"
                className="ch-chip"
                disabled={bulkBusy || !selectedCount}
                onClick={openBatchRename}
              >
                批量重命名
              </button>
              <button
                type="button"
                className="ch-chip is-danger"
                disabled={bulkBusy || !selectedCount}
                onClick={() => setPendingBulkDelete([...selectedIds])}
              >
                删除所选{selectedCount ? ` (${selectedCount})` : ""}
              </button>
            </div>
          )}
        </div>

        <section className="ch-section" aria-live="polite">
          {loading && !materials.length ? (
            <div className="ch-loading">正在加载资产…</div>
          ) : visibleMaterials.length ? (
            <div className="ml-grid">
              {visibleMaterials.map((asset) => {
                const duplicate = isDuplicateAsset(asset);
                const selected = selectedIds.has(asset.id);
                const dimensions =
                  formatDimensions(asset) ||
                  formatDimensions(assetDimensions[asset.id]);
                return (
                  <article
                    key={asset.id}
                    className={`ch-card ml-card${moveMenuId === asset.id ? " is-menu" : ""}${selectMode ? " is-selecting" : ""}${selected ? " is-selected" : ""}`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {selectMode && (
                      <button
                        type="button"
                        className="ch-card__check"
                        aria-pressed={selected}
                        aria-label={selected ? "取消选择" : "选择资产"}
                        onClick={() => toggleSelected(asset.id)}
                      >
                        <i
                          className={`bi ${selected ? "bi-check-circle-fill" : "bi-circle"}`}
                        />
                      </button>
                    )}
                    <div className="ml-card__stage">
                      <button
                        type="button"
                        className="ch-card__media ml-card__cover"
                        onClick={() =>
                          selectMode
                            ? toggleSelected(asset.id)
                            : setPreviewMaterial(asset)
                        }
                      >
                        <AuthenticatedImage
                          src={asset.thumbnailUrl}
                          alt={asset.title}
                          loading="lazy"
                          rootMargin="180px 0px"
                          onLoad={(event) =>
                            rememberDimensions(asset.id, event)
                          }
                        />
                      </button>
                      <div className="ml-card__overlay">
                        {duplicate ? (
                          <span className="ml-card__overlay-flag">重复</span>
                        ) : null}
                        <div className="ml-card__overlay-bar">
                          <div className="ml-card__overlay-copy">
                            <strong
                              className="ml-card__overlay-title"
                              title={asset.title}
                            >
                              {displayTitle(asset.title)}
                            </strong>
                            <span className="ml-card__overlay-group">
                              {groupNameOf(asset)}
                            </span>
                            <span className="ml-card__overlay-meta">
                              <em>{formatBytes(asset.sizeBytes)}</em>
                              <em>{dimensions || "—"}</em>
                            </span>
                          </div>
                          {!selectMode && (
                            <div className="ch-card__actions">
                              <button
                                type="button"
                                className="is-icon"
                                title="编辑"
                                aria-label="编辑"
                                onClick={() => openEdit(asset)}
                              >
                                <i className="bi bi-pencil" aria-hidden="true" />
                              </button>
                              <div className="ml-move">
                                <button
                                  type="button"
                                  title="移动到分组"
                                  className={
                                    moveMenuId === asset.id ? "is-on" : ""
                                  }
                                  onClick={() =>
                                    setMoveMenuId((id) =>
                                      id === asset.id ? null : asset.id,
                                    )
                                  }
                                >
                                  分组
                                </button>
                                <AssetGroupMenu
                                  open={moveMenuId === asset.id}
                                  dropUp
                                >
                                  <button
                                    type="button"
                                    data-group-menu-item
                                    className={
                                      !asset.groupId ? "is-active" : ""
                                    }
                                    onClick={() => moveToGroup(asset, "")}
                                  >
                                    未分组
                                  </button>
                                  {groups.map((group) => (
                                    <button
                                      key={group.id}
                                      type="button"
                                      data-group-menu-item
                                      className={
                                        asset.groupId === group.id
                                          ? "is-active"
                                          : ""
                                      }
                                      onClick={() =>
                                        moveToGroup(asset, group.id)
                                      }
                                    >
                                      {group.name}
                                    </button>
                                  ))}
                                  {!groups.length && (
                                    <p
                                      className="ml-card__menu-empty"
                                      data-group-menu-item
                                    >
                                      还没有分组，先在上方新建
                                    </p>
                                  )}
                                </AssetGroupMenu>
                              </div>
                              <button
                                type="button"
                                className="is-icon is-danger"
                                title="删除"
                                aria-label="删除"
                                onClick={() => setPendingDelete(asset)}
                              >
                                <i
                                  className="bi bi-trash3"
                                  aria-hidden="true"
                                />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="ch-empty">
              <strong>
                {noVisible
                  ? "没有匹配的资产"
                  : !auth.isAuthenticated
                    ? "登录后管理你的资产"
                    : activeFilter === "all"
                      ? "还没有资产"
                      : "这个分组是空的"}
              </strong>
              <span>
                {noVisible
                  ? "换个关键词试试，或清空筛选。"
                  : !auth.isAuthenticated
                    ? "资产会与账号同步，并可在全站创作工具中重复使用。"
                    : activeFilter === "all"
                      ? "上传图片，建立可在全站调用的个人资产库。"
                      : "上传到这里，或把其他资产移入当前分组。"}
              </span>
              {noVisible ? (
                <button
                  type="button"
                  className="ch-btn is-ghost"
                  onClick={() => {
                    setQuery("");
                    setShowDuplicatesOnly(false);
                  }}
                >
                  清空筛选
                </button>
              ) : (
                <button
                  type="button"
                  className="ch-btn is-primary"
                  onClick={openUpload}
                >
                  {!auth.isAuthenticated
                    ? "登录后添加"
                    : activeFilter === "all"
                      ? "添加资产"
                      : "上传到此分组"}
                </button>
              )}
            </div>
          )}
          {(cursor || loadingMore) && !showDuplicatesOnly && !query.trim() && (
            <div ref={sentinelRef} className="ch-more ml-more" aria-live="polite">
              {loadingMore ? <span className="ch-more__hint">加载中…</span> : null}
            </div>
          )}
        </section>
      </div>
      {uploadDialog}
      {editDialog}
      <DialogMotion
        open={batchRenameOpen}
        layerClassName={`ml-edit-backdrop${!isDark ? " is-light" : ""}`}
        panelClassName="ml-edit ml-group-dialog"
        ariaLabelledby="ml-batch-rename-title"
        initialFocusRef={batchRenameInputRef}
        closeDisabled={bulkBusy}
        onClose={closeBatchRename}
      >
        <header className="ml-edit__head" data-dialog-motion-item>
          <h2 id="ml-batch-rename-title">批量重命名</h2>
          <button
            type="button"
            aria-label="关闭"
            disabled={bulkBusy}
            onClick={closeBatchRename}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <form
          className="ml-edit__form ml-group-dialog__form"
          data-dialog-motion-item
          onSubmit={submitBatchRename}
        >
          <label>
            <span>标题前缀</span>
            <input
              ref={batchRenameInputRef}
              value={batchRenamePrefix}
              maxLength={100}
              placeholder="例如：产品图_"
              aria-label="批量重命名前缀"
              disabled={bulkBusy}
              onChange={(event) => setBatchRenamePrefix(event.target.value)}
            />
          </label>
          <p className="ml-edit__hint">
            将为 {selectedCount} 项资产生成「前缀 + 4 位随机数字」，例如{" "}
            {batchRenameExample}
            。需要分隔可在前缀末尾加上 _ 或 -。
          </p>
          <footer className="ml-edit__actions">
            <button
              type="button"
              className="ml-btn is-ghost"
              disabled={bulkBusy}
              onClick={closeBatchRename}
            >
              取消
            </button>
            <button
              type="submit"
              className="ml-btn is-primary"
              disabled={bulkBusy || !batchRenamePrefix.trim()}
            >
              {bulkBusy ? "重命名中…" : `重命名 ${selectedCount} 项`}
            </button>
          </footer>
        </form>
      </DialogMotion>
      <DialogMotion
        open={showGroupComposer || Boolean(editingGroup)}
        layerClassName={`ml-edit-backdrop${!isDark ? " is-light" : ""}`}
        panelClassName="ml-edit ml-group-dialog"
        ariaLabelledby="ml-group-dialog-title"
        initialFocusRef={groupNameInputRef}
        closeDisabled={creatingGroup || savingGroup}
        onClose={closeGroupDrawer}
      >
        <header className="ml-edit__head" data-dialog-motion-item>
          <h2 id="ml-group-dialog-title">
            {showGroupComposer ? "新建分组" : "编辑分组"}
          </h2>
          <button
            type="button"
            aria-label="关闭"
            disabled={creatingGroup || savingGroup}
            onClick={closeGroupDrawer}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <form
          className="ml-edit__form ml-group-dialog__form"
          data-dialog-motion-item
          onSubmit={
            showGroupComposer
              ? submitCreateGroup
              : (event) => saveRenameGroup(event, editingGroup)
          }
        >
          <label>
            <span>分组名称</span>
            <input
              ref={groupNameInputRef}
              value={showGroupComposer ? newGroupName : renamingGroupName}
              maxLength={64}
              placeholder="例如：产品图"
              aria-label={showGroupComposer ? "新建分组名称" : "分组名称"}
              disabled={creatingGroup || savingGroup}
              onChange={(event) =>
                showGroupComposer
                  ? setNewGroupName(event.target.value)
                  : setRenamingGroupName(event.target.value)
              }
            />
          </label>
          <p className="ml-edit__hint">
            {editingGroup
              ? `当前 ${editingGroup.assetCount || 0} 项资产。`
              : "最多 50 个分组，创建后可把资产移入其中。"}
          </p>
          <footer className="ml-edit__actions">
            <button
              type="button"
              className="ml-btn is-ghost"
              aria-label={
                showGroupComposer ? "取消新建分组" : "取消编辑分组"
              }
              disabled={creatingGroup || savingGroup}
              onClick={closeGroupDrawer}
            >
              取消
            </button>
            <button
              type="submit"
              className="ml-btn is-primary"
              disabled={creatingGroup || savingGroup}
            >
              {showGroupComposer
                ? creatingGroup
                  ? "创建中…"
                  : "创建"
                : savingGroup
                  ? "保存中…"
                  : "保存"}
            </button>
          </footer>
        </form>
      </DialogMotion>
      <DialogMotion
        open={Boolean(previewMaterial)}
        variant="detail"
        layerClassName="ch-preview-layer ml-lightbox"
        panelClassName="ch-preview"
        ariaLabel="资产预览"
        onClose={() => setPreviewMaterial(null)}
        onExited={() => setBodyScrollLock(ASSET_PREVIEW_LOCK, false)}
        layerExtras={
          previewMaterial
            ? () => (
                <>
                  <button
                    type="button"
                    className="ch-preview__nav is-prev"
                    disabled={previewIndex <= 0}
                    aria-label="上一条"
                    onClick={() => showPreviewAt(previewIndex - 1)}
                  >
                    <i className="bi bi-chevron-left" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="ch-preview__nav is-next"
                    disabled={
                      previewIndex < 0 ||
                      previewIndex >= visibleMaterials.length - 1
                    }
                    aria-label="下一条"
                    onClick={() => showPreviewAt(previewIndex + 1)}
                  >
                    <i className="bi bi-chevron-right" aria-hidden="true" />
                  </button>
                </>
              )
            : null
        }
      >
        {previewMaterial ? (
          <>
            <div className="ch-preview__media">
              <AuthenticatedImage
                src={previewMaterial.url}
                alt={previewMaterial.title}
                loading="eager"
                onLoad={(event) =>
                  rememberDimensions(previewMaterial.id, event)
                }
              />
            </div>
            <aside className="ch-preview__body">
              <div className="ch-preview__top">
                {isDuplicateAsset(previewMaterial) ? (
                  <div className="ch-card__meta">
                    <span className="ch-pill is-status" data-status="failed">
                      重复
                    </span>
                  </div>
                ) : null}
                <h2 className="ch-card__title">
                  {displayTitle(previewMaterial.title)}
                </h2>
              </div>
              <div className="ch-preview__mid">
                <dl className="ch-preview__specs">
                  <div>
                    <dt>分组</dt>
                    <dd>{groupNameOf(previewMaterial)}</dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{formatBytes(previewMaterial.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>尺寸</dt>
                    <dd>
                      {formatDimensions(previewMaterial) ||
                        formatDimensions(assetDimensions[previewMaterial.id]) ||
                        "—"}
                    </dd>
                  </div>
                </dl>
              </div>
              <div className="ch-preview__bottom">
                <div className="ch-card__actions">
                  <button
                    type="button"
                    className="is-primary"
                    title="编辑"
                    onClick={() => openEdit(previewMaterial)}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    title="删除"
                    onClick={() => setPendingDelete(previewMaterial)}
                  >
                    删除
                  </button>
                  <button
                    type="button"
                    className="ml-lightbox__close"
                    aria-label="关闭"
                    onClick={() => setPreviewMaterial(null)}
                  >
                    关闭
                  </button>
                </div>
              </div>
            </aside>
          </>
        ) : null}
      </DialogMotion>
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        heading="删除这项资产？"
        description="资产原图和缩略图都会移除，删除后无法恢复。"
        confirmLabel="确认删除"
        icon="bi-trash3"
        light={!isDark}
        onConfirm={confirmDelete}
        onClose={() => setPendingDelete(null)}
      />
      <ConfirmDialog
        open={Boolean(pendingGroupDelete)}
        heading="删除这个分组？"
        description="分组内的资产不会删除，只会移到未分组。"
        confirmLabel="确认删除"
        icon="bi-folder-x"
        light={!isDark}
        onConfirm={confirmDeleteGroup}
        onClose={() => setPendingGroupDelete(null)}
      />
      <ConfirmDialog
        open={Boolean(pendingBulkDelete?.length)}
        busy={bulkBusy}
        heading={`删除选中的 ${pendingBulkDelete?.length || 0} 项资产？`}
        description="资产原图和缩略图都会移除，删除后无法恢复。"
        confirmLabel="删除所选"
        busyLabel="删除中…"
        icon="bi-trash3"
        light={!isDark}
        onConfirm={confirmBulkDelete}
        onClose={() => {
          if (!bulkBusy) setPendingBulkDelete(null);
        }}
      />
    </main>
  );
}
