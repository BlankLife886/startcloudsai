import { useCallback, useEffect, useState } from "react";
import {
  LISTING_DEFAULT_DETAIL_RATIO,
  LISTING_DEFAULT_FREE_ITEMS,
  LISTING_DEFAULT_MAIN_RATIO,
  LISTING_MAX_CUSTOM_TYPES,
  LISTING_MAX_PER_TYPE,
  LISTING_MAX_SHOTS,
  LISTING_PLAN_MODES,
  LISTING_RUN_MODES,
  LISTING_SMART_MAX_DETAIL,
  LISTING_SMART_MAX_MAIN,
  listingResolveType,
  listingRunModeAllowed,
  listingTemplateById,
} from "../../listing/listingCatalog.js";
import { listingBusiness } from "./business.js";

const SAVED_TEMPLATES_KEY = `${listingBusiness.stateNamespace}.templates`;
const MAX_SAVED_TEMPLATES = 12;

const DEFAULT_CONFIG = Object.freeze({
  planMode: "free",
  runMode: "auto",
  freeItems: LISTING_DEFAULT_FREE_ITEMS,
  customTypes: [],
  smart: { main: 1, detail: 5 },
  templateIds: [],
  mainRatio: LISTING_DEFAULT_MAIN_RATIO,
  detailRatio: LISTING_DEFAULT_DETAIL_RATIO,
  style: "",
  noteOpen: false,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(Number(value) || 0)));
}

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式 / 存储已满：只影响下次打开时的默认值 */
  }
}

function sanitizeCustomTypes(list) {
  return (Array.isArray(list) ? list : [])
    .filter(
      (item) => item && /^custom-[a-z0-9]{4,16}$/.test(String(item.id || "")),
    )
    .slice(0, LISTING_MAX_CUSTOM_TYPES)
    .map((item) => ({
      id: String(item.id),
      label: String(item.label || "").slice(0, 30),
      direction: String(item.direction || "").slice(0, 300),
      role: item.role === "main" ? "main" : "detail",
    }));
}

function sanitizeFreeItems(list, customTypes) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .filter((item) => {
      const id = String(item?.id || "");
      if (!id || seen.has(id) || !listingResolveType(id, customTypes))
        return false;
      seen.add(id);
      return true;
    })
    .map((item) => ({
      id: String(item.id),
      count: clamp(item.count, 1, LISTING_MAX_PER_TYPE),
    }));
}

function sanitizeConfig(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const planMode = LISTING_PLAN_MODES.some((item) => item.id === value.planMode)
    ? value.planMode
    : DEFAULT_CONFIG.planMode;
  const runMode = LISTING_RUN_MODES.some((item) => item.id === value.runMode)
    ? value.runMode
    : DEFAULT_CONFIG.runMode;
  const customTypes = sanitizeCustomTypes(value.customTypes);
  const freeItems = Array.isArray(value.freeItems)
    ? sanitizeFreeItems(value.freeItems, customTypes)
    : DEFAULT_CONFIG.freeItems;
  return {
    planMode,
    runMode: listingRunModeAllowed(runMode, planMode) ? runMode : "auto",
    freeItems,
    customTypes,
    smart: {
      main: clamp(
        value.smart?.main ?? DEFAULT_CONFIG.smart.main,
        0,
        LISTING_SMART_MAX_MAIN,
      ),
      detail: clamp(
        value.smart?.detail ?? DEFAULT_CONFIG.smart.detail,
        0,
        LISTING_SMART_MAX_DETAIL,
      ),
    },
    templateIds: (Array.isArray(value.templateIds) ? value.templateIds : [])
      .filter((id) => listingTemplateById(id))
      .slice(0, 6),
    mainRatio: String(value.mainRatio || DEFAULT_CONFIG.mainRatio),
    detailRatio: String(value.detailRatio || DEFAULT_CONFIG.detailRatio),
    style: String(value.style || "").slice(0, 40),
    noteOpen: Boolean(value.noteOpen),
  };
}

function totalFreeShots(items) {
  return items.reduce((sum, item) => sum + (Number(item.count) || 1), 0);
}

function randomId() {
  return Math.random().toString(36).slice(2, 10).padEnd(6, "0");
}

// 商品套图业务状态：出图规划（智能组图 / 自由组合 / 品类模板）、出图方式、
// 主图与详情页画幅、视觉风格。整份配置按账号设备记住，下次打开沿用。
export function useListingBusinessState() {
  const [config, setConfig] = useState(() =>
    sanitizeConfig(readJson(listingBusiness.stateNamespace)),
  );
  const [savedTemplates, setSavedTemplates] = useState(() =>
    (readJson(SAVED_TEMPLATES_KEY) || [])
      .filter((item) => item && item.id && item.name)
      .slice(0, MAX_SAVED_TEMPLATES)
      .map((item) => {
        const customTypes = sanitizeCustomTypes(item.customTypes);
        return {
          id: String(item.id),
          name: String(item.name).slice(0, 24),
          customTypes,
          freeItems: sanitizeFreeItems(item.freeItems, customTypes),
        };
      }),
  );

  useEffect(() => {
    writeJson(listingBusiness.stateNamespace, config);
  }, [config]);
  useEffect(() => {
    writeJson(SAVED_TEMPLATES_KEY, savedTemplates);
  }, [savedTemplates]);

  const patch = useCallback((next) => {
    setConfig((current) =>
      sanitizeConfig({
        ...current,
        ...(typeof next === "function" ? next(current) : next),
      }),
    );
  }, []);

  const setPlanMode = useCallback(
    (planMode) =>
      patch((current) => ({
        planMode,
        runMode: listingRunModeAllowed(current.runMode, planMode)
          ? current.runMode
          : "auto",
      })),
    [patch],
  );

  // 勾选 / 取消一种出图类型；新勾选的追加在末尾，受整套张数上限约束
  const toggleType = useCallback(
    (id) =>
      patch((current) => {
        if (current.freeItems.some((item) => item.id === id)) {
          return {
            freeItems: current.freeItems.filter((item) => item.id !== id),
          };
        }
        if (totalFreeShots(current.freeItems) >= LISTING_MAX_SHOTS) return {};
        return { freeItems: [...current.freeItems, { id, count: 1 }] };
      }),
    [patch],
  );

  const stepTypeCount = useCallback(
    (id, delta) =>
      patch((current) => {
        const total = totalFreeShots(current.freeItems);
        return {
          freeItems: current.freeItems
            .map((item) => {
              if (item.id !== id) return item;
              const room =
                delta > 0 ? Math.max(0, LISTING_MAX_SHOTS - total) : Infinity;
              const next =
                item.count + Math.max(-item.count, Math.min(delta, room));
              return { ...item, count: next };
            })
            .filter((item) => item.count > 0),
        };
      }),
    [patch],
  );

  const moveType = useCallback(
    (id, delta) =>
      patch((current) => {
        const list = [...current.freeItems];
        const from = list.findIndex((item) => item.id === id);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= list.length) return {};
        [list[from], list[to]] = [list[to], list[from]];
        return { freeItems: list };
      }),
    [patch],
  );

  const addCustomType = useCallback(
    ({ label, direction, role }) => {
      const id = `custom-${randomId()}`;
      patch((current) => {
        if (current.customTypes.length >= LISTING_MAX_CUSTOM_TYPES) return {};
        const customTypes = [
          ...current.customTypes,
          { id, label, direction, role: role === "main" ? "main" : "detail" },
        ];
        const freeItems =
          totalFreeShots(current.freeItems) < LISTING_MAX_SHOTS
            ? [...current.freeItems, { id, count: 1 }]
            : current.freeItems;
        return { customTypes, freeItems };
      });
      return id;
    },
    [patch],
  );

  const removeCustomType = useCallback(
    (id) =>
      patch((current) => ({
        customTypes: current.customTypes.filter((item) => item.id !== id),
        freeItems: current.freeItems.filter((item) => item.id !== id),
      })),
    [patch],
  );

  const setFreeItems = useCallback(
    (freeItems) => patch({ freeItems }),
    [patch],
  );

  const setSmartCount = useCallback(
    (key, value) =>
      patch((current) => ({ smart: { ...current.smart, [key]: value } })),
    [patch],
  );

  const toggleTemplate = useCallback(
    (id) =>
      patch((current) => ({
        templateIds: current.templateIds.includes(id)
          ? current.templateIds.filter((item) => item !== id)
          : [...current.templateIds, id],
      })),
    [patch],
  );

  const saveTemplate = useCallback(
    (name) => {
      const trimmed = String(name || "")
        .trim()
        .slice(0, 24);
      if (!trimmed || !config.freeItems.length) return false;
      setSavedTemplates((current) =>
        [
          {
            id: `mine-${randomId()}`,
            name: trimmed,
            freeItems: config.freeItems,
            customTypes: config.customTypes.filter((item) =>
              config.freeItems.some((entry) => entry.id === item.id),
            ),
          },
          ...current.filter((item) => item.name !== trimmed),
        ].slice(0, MAX_SAVED_TEMPLATES),
      );
      return true;
    },
    [config.freeItems, config.customTypes],
  );

  const applySavedTemplate = useCallback(
    (id) => {
      const saved = savedTemplates.find((item) => item.id === id);
      if (!saved) return;
      patch((current) => {
        const customTypes = [
          ...current.customTypes.filter(
            (item) => !saved.customTypes.some((entry) => entry.id === item.id),
          ),
          ...saved.customTypes,
        ].slice(-LISTING_MAX_CUSTOM_TYPES);
        return { planMode: "free", customTypes, freeItems: saved.freeItems };
      });
    },
    [patch, savedTemplates],
  );

  const removeSavedTemplate = useCallback(
    (id) =>
      setSavedTemplates((current) => current.filter((item) => item.id !== id)),
    [],
  );

  return {
    listingConfig: config,
    patchListingConfig: patch,
    setListingPlanMode: setPlanMode,
    toggleListingType: toggleType,
    stepListingTypeCount: stepTypeCount,
    moveListingType: moveType,
    setListingFreeItems: setFreeItems,
    addListingCustomType: addCustomType,
    removeListingCustomType: removeCustomType,
    setListingSmartCount: setSmartCount,
    toggleListingTemplate: toggleTemplate,
    listingSavedTemplates: savedTemplates,
    saveListingTemplate: saveTemplate,
    applyListingSavedTemplate: applySavedTemplate,
    removeListingSavedTemplate: removeSavedTemplate,
  };
}
