import { useCallback, useEffect, useRef, useState } from "react";
import localforage from "localforage";

const referenceStore = localforage.createInstance({ name: "starclouds-t2i", storeName: "reference_drafts" });
const writes = new Map();

export function useReferenceDraft(userId) {
  const [references, updateReferences] = useState([]);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const revision = useRef(0);
  // 每个草稿 key 只记录一次读取起点：StrictMode 会重跑读取副作用，若在重跑时重新取
  // revision，就会把挂载期间写入的参考图（如创作台带入）当成旧状态而被存储草稿覆盖。
  const loadStart = useRef({ key: null, revision: 0 });
  const previewURLs = useRef(new Set());
  const setReferences = useCallback(value => { revision.current++; updateReferences(value); }, []);
  const key = userId || "guest";
  useEffect(() => {
    references.forEach(item => { if (item.preview?.startsWith("blob:")) previewURLs.current.add(item.preview); });
  }, [references]);
  useEffect(() => () => {
    previewURLs.current.forEach(url => URL.revokeObjectURL(url));
    previewURLs.current.clear();
  }, []);
  useEffect(() => {
    let active = true;
    if (loadStart.current.key !== key) loadStart.current = { key, revision: revision.current };
    const startedRevision = loadStart.current.revision;
    void (async () => {
      try {
        await writes.get(key);
        const stored = await referenceStore.getItem(key);
        if (!active || revision.current !== startedRevision || !Array.isArray(stored)) return;
        updateReferences(stored.map(item => {
          const file = item.file ? new File([item.file], item.name || "reference.png", { type: item.file.type }) : null;
          const url = item.key ? `/api/v1/files/${item.key.split("/").map(encodeURIComponent).join("/")}` : item.url || "";
          return { ...item, file, url, preview: file ? URL.createObjectURL(file) : url };
        }));
      } catch { if (active) setStorageError("参考图草稿读取失败，请重新选择参考图"); }
      finally { if (active) setReady(true); }
    })();
    return () => { active = false; };
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    const snapshot = references.map(({ id, name, key, url, file }) => ({ id, name, key, url: url?.startsWith("blob:") ? "" : url, file }));
    const save = (writes.get(key) || Promise.resolve()).catch(() => {}).then(() => referenceStore.setItem(key, snapshot));
    writes.set(key, save);
    let active = true;
    void save.then(() => { if (active) setStorageError(""); }, () => { if (active) setStorageError("参考图草稿保存失败，刷新前请保留原文件"); }).finally(() => { if (writes.get(key) === save) writes.delete(key); });
    return () => { active = false; };
  }, [key, ready, references]);
  return { references, setReferences, referencesReady: ready, referenceStorageError: storageError };
}
