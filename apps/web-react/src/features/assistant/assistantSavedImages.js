// 图片上的“已存入素材库”：同一时刻各条消息要查的图合并成一次请求，结果缓存；
// 资产库有变化时清缓存，正在显示的网格重新核对。
import { useEffect, useState } from "react";
import { ASSISTANT_ASSETS_CHANGED_EVENT, listAssistantSavedImages } from "./services/assistantApi.js";

const BATCH_LIMIT = 60;
const cache = new Map(); // fileKey -> { assetId, groupName } | null
let pending = new Set();
let flushTimer = 0;
const listeners = new Set();
let generation = 0;

function notify() {
  listeners.forEach((listener) => listener());
}

async function flush() {
  flushTimer = 0;
  const keys = [...pending];
  pending = new Set();
  const round = generation;
  for (let index = 0; index < keys.length; index += BATCH_LIMIT) {
    const chunk = keys.slice(index, index + BATCH_LIMIT);
    try {
      const result = await listAssistantSavedImages(chunk);
      if (round !== generation) return;
      const found = new Map((Array.isArray(result?.items) ? result.items : []).map((item) => [item.sourceKey, item]));
      chunk.forEach((key) => cache.set(key, found.get(key) || null));
    } catch {
      // 读不到就不显示标记，不影响看图
      chunk.forEach((key) => cache.set(key, null));
    }
  }
  notify();
}

function request(keys) {
  let added = false;
  keys.forEach((key) => {
    if (key && !cache.has(key) && !pending.has(key)) {
      pending.add(key);
      added = true;
    }
  });
  if (added && !flushTimer) flushTimer = window.setTimeout(() => void flush(), 30);
}

if (typeof window !== "undefined") {
  window.addEventListener(ASSISTANT_ASSETS_CHANGED_EVENT, () => {
    generation += 1;
    cache.clear();
    notify();
  });
}

// 返回 Map<fileKey, { assetId, groupName }>，只含已存入的图。
export function useSavedAssistantImages(keys) {
  const signature = keys.filter(Boolean).join("|");
  const [, setVersion] = useState(0);
  useEffect(() => {
    if (!signature) return undefined;
    const list = signature.split("|");
    const listener = () => {
      request(list);
      setVersion((value) => value + 1);
    };
    listeners.add(listener);
    request(list);
    return () => listeners.delete(listener);
  }, [signature]);
  const saved = new Map();
  if (signature) {
    signature.split("|").forEach((key) => {
      const item = cache.get(key);
      if (item) saved.set(key, item);
    });
  }
  return saved;
}
