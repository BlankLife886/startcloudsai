import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { useAuthPrompt } from "../auth/AuthPromptContext.jsx";
import { useAuth } from "../auth/AuthContext.jsx";
import { useIsDark } from "../hooks/useIsDark.js";
import { useLocale } from "../i18n/index.js";
import {
  buildEcommerceGenerationPlan,
  buildEcommerceRevisionPrompt,
  ECOMMERCE_DETAIL_MODULES,
  ECOMMERCE_MODULES,
  ECOMMERCE_MODES,
  ECOMMERCE_RAIL_GROUPS,
  ECOMMERCE_RAIL_MODES,
  ECOMMERCE_REVISION_DIRECTIONS,
  ecommerceModeById,
  ecommerceShotBlueprints,
  listingShotBlueprintsFromCounts,
  coerceEcommerceImageFile,
  attachEcommerceUploadKey,
  isReusableTaskImageKey,
  normalizeTaskImageKey,
  ECOMMERCE_IMAGE_ACCEPT,
  ECOMMERCE_IMAGE_MAX_BYTES,
  ECOMMERCE_IMAGE_TARGET_BYTES,
  ecommerceUploadRejectMessage,
  prepareEcommerceInputFiles,
  sniffEcommerceImageBytes,
  supportedEcommerceModules,
  TRYON_LENS_OPTIONS,
  buildTryonPhotographyPrompt,
  tryonLensById,
  TRYON_LIGHT_OPTIONS,
  buildTryonLightingPrompt,
  tryonLightById,
  buildTryonMentions,
  buildTryonRevisionPlan,
  HANDHELD_ARCHITECTURE_OPTIONS,
  HANDHELD_CAMERA_OPTIONS,
  HANDHELD_DEPTH_OPTIONS,
  HANDHELD_FOCUS_OPTIONS,
  HANDHELD_MATERIAL_INTERACTION_OPTIONS,
  HANDHELD_PHOTO_PRESET_OPTIONS,
  HANDHELD_CATEGORY_OPTIONS,
  HANDHELD_CROP_OPTIONS,
  HANDHELD_HAND_OPTIONS,
  HANDHELD_LANGUAGE_OPTIONS,
  HANDHELD_LENS_OPTIONS,
  HANDHELD_LIGHT_OPTIONS,
  HANDHELD_PACK_OPTIONS,
  HANDHELD_PACK_STATE_OPTIONS,
  HANDHELD_PLATFORM_OPTIONS,
  HANDHELD_POSE_OPTIONS,
  HANDHELD_STYLE_OPTIONS,
  buildHandheldIdentityLock,
  buildHandheldOutputConstraints,
  buildHandheldTaskPrompt,
  handheldCategoryById,
  handheldCropById,
  handheldCropNeedsPerson,
  handheldEffectiveArchitecture,
  handheldArchitectureById,
  handheldCameraById,
  handheldDepthById,
  handheldFocusById,
  handheldHandById,
  handheldLensById,
  handheldLightById,
  handheldMaterialInteractionById,
  handheldPackById,
  handheldPackStateById,
  handheldPlatformById,
  handheldPhotoPresetById,
  handheldPoseById,
  handheldStyleById,
  handheldReferenceLabels,
  handheldShotBlueprints,
  normalizeHandheldAnnotations,
} from "../features/ecommerce/ecommerceTools.js";
import { compressEcommerceUploadFile } from "@react/legacy-modules/features/ecommerce/compressEcommerceUpload.js";
import {
  loadTryonDraft,
  saveTryonDraft,
} from "@react/legacy-modules/features/ecommerce/tryonDraftStorage.js";
import {
  loadHandheldDraft,
  saveHandheldDraft,
} from "@react/legacy-modules/features/ecommerce/handheldDraftStorage.js";
import {
  loadAccessoryDraft,
  saveAccessoryDraft,
} from "@react/legacy-modules/features/ecommerce/accessoryDraftStorage.js";
import { fetchRuntimeConfig } from "@react/legacy-modules/services/runtimeConfig.js";
import {
  generateAplusPlan,
  generateCommerceProductBrief,
  listTryonCatalog,
} from "@react/legacy-modules/services/ecommerceApi.js";
import {
  createHandheldProject,
  listHandheldCatalog,
  quoteHandheldJob,
  saveHandheldItemAsset,
  updateHandheldProjectDraft,
} from "../features/ecommerce/handheld/handheldApi.js";
import {
  listUserAssetGroups,
  listUserAssets,
  createUserAsset,
  getWallet,
  updateProfile,
} from "@react/legacy-modules/services/meApi.js";
import { downloadHistoryImagesAsZip } from "@react/legacy-modules/services/historyMediaTools.js";
import { uploadFile } from "@react/legacy-modules/services/tasksApi.js";
import { fetchAuthenticatedMediaBlob } from "@react/legacy-modules/services/authenticatedMedia.js";
import listingPreview from "@react/legacy-static/assets/ecommerce/listing-preview.webp";
import detailPreview from "@react/legacy-static/assets/ecommerce/detail-preview.webp";
import tryonPreview from "@react/legacy-static/assets/ecommerce/tryon-preview.webp";
import clonePreview from "@react/legacy-static/assets/ecommerce/clone-preview.webp";
import "@react/legacy-styles/generated/views/EcommerceDesignView.css";
import "@react/legacy-styles/generated/components/ecommerce/EcommerceBriefAssistantDialog.css";
import "@react/legacy-styles/generated/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.css";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { DialogMotion } from "../components/motion/DialogMotion.jsx";
import { useContentReveal } from "../components/motion/useContentReveal.js";
import { CommerceSelect } from "../features/ecommerce/CommerceSelect.jsx";
import { HandheldGuideDialog } from "../features/ecommerce/HandheldGuideDialog.jsx";
import {
  HandheldStudio,
  HandheldTunePopover,
  HandheldProductPopover,
  HandheldPosePopover,
} from "../features/ecommerce/HandheldStudio.jsx";
import { AccessoryStudio } from "../features/ecommerce/AccessoryStudio.jsx";
import { DetailStudio } from "../features/ecommerce/DetailStudio.jsx";
import { DetailTopToolbar } from "../features/ecommerce/businesses/detail/DetailTopToolbar.jsx";
import {
  aplusCategoryById,
  aplusChecklistCsv,
  aplusExportChecklist,
  aplusMarketplaceById,
  aplusShotBlueprintsFromPlan,
  buildAplusTaskPrompt,
  buildDefaultAplusPlan,
  parseAplusAsinList,
} from "../features/ecommerce/aplus/amazonAplus.js";
import {
  ACCESSORY_CATEGORY_OPTIONS,
  ACCESSORY_CROP_OPTIONS,
  ACCESSORY_DEFAULT_CROP_ID,
  ACCESSORY_MATERIAL_OPTIONS,
  ACCESSORY_OCCLUSION_OPTIONS,
  ACCESSORY_PACK_OPTIONS,
  ACCESSORY_SCALE_OPTIONS,
  ACCESSORY_STYLE_OPTIONS,
  accessoryCategoryById,
  accessoryReferencesFromSlots,
  accessoryReferenceRoles,
  accessoryShotBlueprints,
  accessorySlotPresence,
  buildAccessoryIdentityLock,
  buildAccessorySpec,
  buildAccessoryTaskPrompt,
  nextEmptyAccessorySlot,
  packAccessorySlotFiles,
} from "../features/ecommerce/accessory/accessoryCommerce.js";
import { CommerceProductLibrary } from "../features/ecommerce/CommerceProductLibrary.jsx";
import { CommerceOperationsWorkspace } from "../features/ecommerce/CommerceOperationsWorkspace.jsx";
import {
  CREATIVE_SHOOT_SHOTS,
  CreativeShootWorkspace,
} from "../features/ecommerce/CreativeShootWorkspace.jsx";
import { EcommerceMaskEditor } from "../features/ecommerce/EcommerceMaskEditor.jsx";
import { canOpenWallevenImagePreview, WallevenImagePreview } from "../components/common/WallevenImagePreview.jsx";
import { TryonFlipLightbox } from "../features/ecommerce/TryonFlipLightbox.jsx";
import { useEcommerceJobs } from "../features/ecommerce/useEcommerceJobs.js";
import { useTryonBusinessState } from "../features/ecommerce/businesses/tryon/useTryonBusinessState.js";
import {
  TryonChoicePicker,
  TryonLiveStage,
} from "../features/ecommerce/businesses/tryon/TryonBusinessWorkspace.jsx";
import {
  ecommerceElapsedSeconds,
  firstReturnedOutputUrl,
} from "../features/ecommerce/businesses/shared/generationTiming.js";
import {
  HANDHELD_MODEL_CATALOG,
  HANDHELD_SCENE_CATALOG,
} from "../features/ecommerce/businesses/handheld/catalog.js";
import { useAccessoryBusinessState } from "../features/ecommerce/businesses/accessory/useAccessoryBusinessState.js";
import { AccessoryTopToolbar } from "../features/ecommerce/businesses/accessory/AccessoryTopToolbar.jsx";
import { HANDHELD_ACTIVE_BATCH_STORAGE_KEY } from "../features/ecommerce/businesses/handheld/storageKeys.js";
import { useHandheldBusinessState } from "../features/ecommerce/businesses/handheld/useHandheldBusinessState.js";
import { CloneBusinessSettings } from "../features/ecommerce/businesses/clone/CloneBusinessSettings.jsx";
import { ListingBusinessSettings } from "../features/ecommerce/businesses/listing/ListingBusinessSettings.jsx";
import "./EcommerceDesignView.css";

gsap.registerPlugin(useGSAP);

function ecommerceAnimationsDisabled() {
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations")
  );
}

const OPTIONS = {
  platform: [
    "Amazon",
    "淘宝 / 天猫 / 1688",
    "Temu",
    "TikTok Shop",
    "拼多多",
    "抖音电商",
    "京东",
    "Shopify",
    "独立站",
  ],
  market: [
    "美国",
    "欧洲",
    "中国大陆",
    "俄罗斯",
    "东南亚",
    "英国",
    "日本",
    "德国",
    "法国",
    "西班牙",
  ],
  language: [
    "英文",
    "简体中文",
    "日文",
    "韩文",
    "德文",
    "法文",
    "西班牙文",
    "葡萄牙文",
    "印度尼西亚文",
    "泰文",
    "无文字",
  ],
  ratio: [
    { value: "1:1", label: "1:1 方图" },
    { value: "4:5", label: "4:5 竖图" },
    { value: "3:4", label: "3:4 详情" },
    { value: "16:9", label: "16:9 横图" },
    { value: "9:16", label: "9:16 竖屏" },
  ],
  tryonRatio: [
    { value: "1:1", label: "1:1" },
    { value: "2:3", label: "2:3" },
    { value: "3:2", label: "3:2" },
    { value: "16:9", label: "16:9" },
    { value: "9:16", label: "9:16" },
  ],
  handheldRatio: [
    { value: "1:1", label: "1:1" },
    { value: "3:4", label: "3:4" },
    { value: "4:5", label: "4:5" },
    { value: "9:16", label: "9:16" },
  ],
  scene: [
    "纯色影棚",
    "家居生活",
    "自然户外",
    "都市街景",
    "科技空间",
    "节日氛围",
  ],
  tryonScene: [
    "纯色棚拍",
    "都市街头",
    "街角咖啡",
    "自然草坪",
    "度假海滩",
    "温馨居家",
    "艺术展馆",
  ],
  tone: [
    "极简高级",
    "清新明亮",
    "真实自然",
    "轻奢质感",
    "潮流活力",
    "科技未来",
  ],
  campaign: ["新品首发", "日常种草", "限时促销", "节日活动", "品牌宣传"],
  apparel: ["上装", "下装", "连衣裙", "连体服", "套装", "外套"],
  tryonApparel: ["上装", "下装", "全身"],
  model: [
    "东亚女性",
    "东亚男性",
    "欧美女性",
    "欧美男性",
    "南亚女性",
    "不限定人群",
  ],
  pose: ["正面站姿", "侧身展示", "半身特写", "生活方式", "坐姿展示"],
  shadow: ["自然接触影", "柔和投影", "悬浮阴影", "长投影", "镜面倒影"],
};

const SHOOT_USE_CASE_LABELS = {
  listing: "商品上架",
  social: "社媒种草",
  ads: "广告投放",
  brand: "品牌视觉",
};

const SHOOT_GOAL_LABELS = {
  conversion: "促进转化",
  premium: "建立质感",
  explain: "解释功能",
  launch: "新品传播",
};

function isTryonMode(id) {
  return id === "tryon";
}

function isHandheldMode(id) {
  return id === "handheld";
}

function isAccessoryMode(id) {
  return id === "accessory";
}

function isShootMode(id) {
  return id === "shoot";
}

function isDetailMode(id) {
  return id === "detail";
}

function hidesCommerceSettings(id) {
  return (
    isShootMode(id) ||
    isTryonMode(id) ||
    isHandheldMode(id) ||
    isAccessoryMode(id) ||
    isDetailMode(id)
  );
}

function catalogOptionById(catalog, id) {
  return catalog.find((item) => item.id === id) || null;
}

function catalogForRole(role, catalogs) {
  if (role === "model") return catalogs.models;
  if (role === "scene") return catalogs.scenes;
  return catalogs.garments;
}

function matchingRatio(value, options) {
  const ratio = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[x×/]/gi, ":");
  return options.some((item) => item.value === ratio) ? ratio : "";
}

function snapRatio(width, height, options, fallback = "") {
  const ratio = Number(width) / Number(height);
  if (!Number.isFinite(ratio) || ratio <= 0) return fallback;
  let best = fallback;
  let bestDiff = Infinity;
  for (const item of options) {
    const [w, h] = String(item.value || "")
      .split(":")
      .map(Number);
    if (!w || !h) continue;
    const diff = Math.abs(w / h - ratio);
    if (diff < bestDiff) {
      best = item.value;
      bestDiff = diff;
    }
  }
  return best;
}

function coerceRatioValue(value, options, fallback = "") {
  const exact = matchingRatio(value, options);
  if (exact) return exact;
  const raw = String(value || "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[x×/]/gi, ":");
  const [width, height] = raw.split(":").map(Number);
  return snapRatio(width, height, options, fallback);
}

function commerceModelOptions(list, fallbackPrice) {
  const fallback = Number(fallbackPrice);
  return (list || []).map((item) => {
    const cost = Number(item?.creditCost ?? item?.pricePoints ?? fallback);
    return {
      value: item.id || item.publicModelKey,
      label: item.label || item.name || item.id,
      hint: Number.isFinite(cost) ? `${cost} 积分/张` : "",
    };
  });
}

function builtinCatalogSlot(file, option, extra = {}) {
  const preferred = isReusableTaskImageKey(extra.uploadKey)
    ? extra.uploadKey
    : normalizeTaskImageKey(option?.image);
  attachEcommerceUploadKey(file, preferred);
  return {
    file,
    url: extra.url || URL.createObjectURL(file),
    local: true,
    managed: "slot",
    source: "builtin",
    catalogId: option?.id,
    uploadKey: isReusableTaskImageKey(file.uploadKey) ? file.uploadKey : "",
  };
}

function ecommerceOverlayRoot() {
  const id = "react-ecommerce-overlay-root";
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement("div");
    root.id = id;
    document.body.appendChild(root);
  }
  return root;
}

function previewOriginFromEvent(event) {
  return (
    event?.currentTarget?.querySelector?.("img") || event?.currentTarget || null
  );
}

function localeText() {
  const english = localStorage.getItem("starclouds-locale") === "en";
  return english
    ? {
        source: "Product images",
        settings: "Generation settings",
        products: "Product library",
        creative: "Creative studio",
        operations: "Operations",
        operationsMobile: "Ops",
        emptyProducts: "No matching products",
      }
    : {
        source: "商品原图",
        settings: "生成设置",
        products: "商品库",
        creative: "创作台",
        operations: "业务中心",
        operationsMobile: "业务",
        emptyProducts: "没有匹配的商品",
      };
}

function modePreview(mode) {
  if (mode.id === "detail")
    return {
      src: detailPreview,
      label: "详情页案例预览",
      title: "从商品多角度图到完整详情视觉",
      description: "上传商品多角度图，生成符合目标平台规范的完整详情页视觉。",
      cta: "上传商品图开始",
      tags: [
        { label: "01 商品原图", x: 10, y: 7 },
        { label: "02 详情长图", x: 10, y: 52 },
        { label: "03 主视觉", x: 48, y: 18 },
        { label: "04 功能细节", x: 48, y: 72 },
        { label: "05 使用场景", x: 86, y: 72 },
      ],
    };
  if (mode.id === "tryon")
    return {
      src: tryonPreview,
      label: "虚拟试衣案例预览",
      title: "衣服、模特、拍摄场景",
      description: "上传服装，选择上装/下装/全身和模特人群，再选拍摄场景。",
      cta: "上传服装开始",
      tags: [
        { label: "01 上身主图", x: 12.5, y: 7 },
        { label: "02 版型侧面", x: 37.5, y: 7 },
        { label: "03 穿着场景", x: 62.5, y: 7 },
        { label: "04 面料细节", x: 87.5, y: 7 },
      ],
    };
  if (mode.id === "handheld")
    return {
      src: tryonPreview,
      label: "服饰穿戴案例预览",
      title: "同一商品、同一模特、同场景多姿势",
      description: "上传商品并选择模特形象，生成同场景、多姿势的成套实拍图。",
      cta: "上传商品图开始",
      tags: [
        { label: "01 商品原图", x: 12.5, y: 7 },
        { label: "02 正面展示", x: 37.5, y: 7 },
        { label: "03 动态全身", x: 62.5, y: 7 },
        { label: "04 面料特写", x: 87.5, y: 7 },
      ],
    };
  if (mode.id === "accessory")
    return {
      src: tryonPreview,
      label: "饰品穿戴案例预览",
      title: "商品真值、人体锚点、商业套图",
      description:
        "上传饰品并按需添加模特和场景，生成可审核的佩戴主图、比例图与工艺特写。",
      cta: "上传饰品开始",
      tags: [
        { label: "01 饰品身份", x: 12.5, y: 7 },
        { label: "02 佩戴主图", x: 37.5, y: 7 },
        { label: "03 比例说明", x: 62.5, y: 7 },
        { label: "04 工艺微距", x: 87.5, y: 7 },
      ],
    };
  if (mode.id === "clone")
    return {
      src: clonePreview,
      label: "爆款复刻案例预览",
      title: "继承成熟视觉结构，替换为你的商品",
      description:
        "上传爆款参考图，可选上传新商品，批量复刻构图、场景与视觉节奏。",
      cta: "上传爆款参考图",
      tags: [
        { label: "01 爆款参考", x: 12.5, y: 8 },
        { label: "02 新商品", x: 62.5, y: 8 },
        { label: "03 场景迁移", x: 12.5, y: 58 },
        { label: "04 整套复刻", x: 87.5, y: 58 },
      ],
    };
  return {
    src: listingPreview,
    label: "商品套图案例预览",
    title: "一张商品图，生成统一完整的上架套图",
    description:
      "上传商品图，生成符合目标平台规范的主图、场景、细节和卖点套图。",
    cta: "上传商品图开始",
    tags: [
      { label: "01 合规主图", x: 25, y: 7 },
      { label: "02 场景展示", x: 62.5, y: 7 },
      { label: "03 模特场景", x: 87.5, y: 7 },
      { label: "04 细节说明", x: 62.5, y: 56 },
      { label: "05 卖点图", x: 87.5, y: 56 },
    ],
  };
}

function outputModeId(row) {
  return (
    String(row?.kind || "").match(/^ui-design-ecommerce-([a-z0-9]+)-/i)?.[1] ||
    "detail"
  );
}

function CostConfirmDialog({ cost, light = false, onCancel, onConfirm }) {
  const [skipEveryTime, setSkipEveryTime] = useState(false);
  const costRef = useRef(cost);
  if (cost) costRef.current = cost;
  useEffect(() => {
    if (cost) setSkipEveryTime(false);
  }, [cost]);
  const activeCost = costRef.current;
  if (!activeCost) return null;
  const total = Math.max(0, Number(activeCost.total || 0));
  const count = Math.max(1, Number(activeCost.count || 1));
  const available = Number.isFinite(Number(activeCost.available))
    ? Math.max(0, Number(activeCost.available))
    : null;
  const insufficient = available != null && total > available;
  const remaining = available == null ? null : Math.max(0, available - total);
  return (
    <DialogMotion
      open={Boolean(cost)}
      layerClassName={`ai-cost-confirm-layer is-elevated${light ? " is-light" : ""}`}
      panelClassName="ai-cost-confirm-panel is-credits"
      ariaLabelledby="ecommerce-cost-confirm-title"
      ariaDescribedby="ecommerce-cost-confirm-summary"
      onClose={onCancel}
    >
      <header className="ai-cost-confirm-head">
        <span className="ai-cost-confirm-icon">
          <i className="bi bi-coin" />
        </span>
        <div className="ai-cost-confirm-titles">
          <span className="ai-cost-confirm-eyebrow">AI 电商</span>
          <h5 id="ecommerce-cost-confirm-title">确认生成费用</h5>
        </div>
        <button
          className="ai-cost-confirm-close"
          type="button"
          aria-label="关闭费用确认"
          title="关闭"
          onClick={onCancel}
        >
          <i className="bi bi-x-lg" />
        </button>
      </header>
      <p
        id="ecommerce-cost-confirm-summary"
        className="ai-cost-confirm-summary"
      >
        提交后先冻结预计费用，任务完成后按实际生成结果结算。
      </p>
      <div className="ai-cost-confirm-card">
        <div className="ai-cost-confirm-total">
          <div className="ai-cost-confirm-total__copy">
            <span>本次预计</span>
            <small>
              {activeCost.unit} 积分 / 张 × {count} 张
            </small>
          </div>
          <strong>
            {total > 0
              ? `${total.toLocaleString("zh-CN")} 积分`
              : "按实际用量结算"}
          </strong>
        </div>
        <div className="ai-cost-confirm-balance">
          <div>
            <span>当前可用</span>
            <strong>
              {available == null
                ? "读取中"
                : `${available.toLocaleString("zh-CN")} 积分`}
            </strong>
          </div>
          <i className="bi bi-arrow-right" />
          <div className={insufficient ? "danger" : ""}>
            <span>支付后余额</span>
            <strong>
              {available == null
                ? "待计算"
                : insufficient
                  ? "余额不足"
                  : `${remaining.toLocaleString("zh-CN")} 积分`}
            </strong>
          </div>
        </div>
      </div>
      {insufficient && (
        <p className="ai-cost-confirm-warn is-danger">
          <i className="bi bi-exclamation-circle" />
          钱包余额不足，请兑换积分后再提交任务。
        </p>
      )}
      <footer className="ai-cost-confirm-footer">
        <label className="ai-cost-confirm-preference">
          <input
            type="checkbox"
            checked={skipEveryTime}
            onChange={(event) => setSkipEveryTime(event.target.checked)}
          />
          <span>不再每次确认</span>
        </label>
        <div className="ai-cost-confirm-actions">
          <button
            type="button"
            className="ai-cost-confirm-btn ghost"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="ai-cost-confirm-btn primary"
            disabled={insufficient}
            onClick={() => onConfirm({ skipEveryTime })}
          >
            确认
          </button>
        </div>
      </footer>
    </DialogMotion>
  );
}

function BriefDialog({
  state,
  setState,
  onRegenerate,
  onConfirm,
  onClose,
  dark,
}) {
  if (!state.open) return null;
  return createPortal(
    <div className={`brief-dialog__backdrop${dark ? "" : " light"}`}>
      <section
        className="brief-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ecommerce-brief-title"
      >
        <header>
          <span>
            <i className="bi bi-stars" />
          </span>
          <div>
            <small>AI 商品识别</small>
            <h2 id="ecommerce-brief-title">生成商品名称和卖点</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </header>
        {state.busy ? (
          <div className="brief-dialog__loading" role="status">
            <div className="brief-dialog__loading-mark" aria-hidden="true">
              <span>
                <i className="bi bi-stars" />
              </span>
              <i className="brief-dialog__loading-orbit" />
            </div>
            <div className="brief-dialog__loading-copy">
              <strong>正在识别商品图片</strong>
              <small>正在提取商品类型、可见特征与核心卖点</small>
            </div>
            <div className="brief-dialog__progress" aria-hidden="true">
              <span className="is-active">
                <i className="bi bi-image" />
                读取图片
              </span>
              <span>
                <i className="bi bi-search" />
                识别特征
              </span>
              <span>
                <i className="bi bi-lightbulb" />
                整理卖点
              </span>
            </div>
          </div>
        ) : (
          <div className="brief-dialog__content">
            {state.error && (
              <p className="brief-dialog__error" role="alert">
                <i className="bi bi-exclamation-circle" />
                {state.error}
              </p>
            )}
            <label>
              <span>商品名称</span>
              <input
                aria-label="商品名称"
                value={state.name}
                onChange={(event) =>
                  setState((value) => ({ ...value, name: event.target.value }))
                }
              />
            </label>
            <label>
              <span>核心卖点</span>
              <textarea
                aria-label="核心卖点"
                value={state.points}
                onChange={(event) =>
                  setState((value) => ({
                    ...value,
                    points: event.target.value,
                  }))
                }
              />
              <small>{state.points.length}/1200</small>
            </label>
          </div>
        )}
        <footer className={state.busy ? "is-busy" : ""}>
          <button
            type="button"
            className="brief-dialog__regenerate"
            disabled={state.busy}
            onClick={onRegenerate}
          >
            <i className="bi bi-arrow-repeat" />
            {state.name || state.points ? "重新生成" : "重试"}
          </button>
          <button
            type="button"
            className="brief-dialog__confirm"
            disabled={state.busy || !state.name.trim() || !state.points.trim()}
            onClick={onConfirm}
          >
            <i className="bi bi-check-lg" />
            确认填入
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ConfirmDelete({ open, busy, onClose, onConfirm }) {
  if (!open) return null;
  return createPortal(
    <div className="commerce-delete-dialog__backdrop">
      <section
        className="commerce-delete-dialog"
        role="alertdialog"
        aria-modal="true"
      >
        <header>
          <span>
            <i className="bi bi-trash3" />
          </span>
          <button type="button" aria-label="取消删除" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <div>
          <small>删除生成记录</small>
          <h2>删除这条记录及后续结果？</h2>
          <p>
            将删除这张图片；如果其他结果由它继续生成，也会一并删除。删除后无法恢复。
          </p>
        </div>
        <footer>
          <button
            type="button"
            className="commerce-products__ghost"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="commerce-delete-dialog__danger"
            disabled={busy}
            onClick={onConfirm}
          >
            <i className="bi bi-trash3" />
            确认删除
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function EcommerceBusinessSession({
  businessId,
  availableModeIds = [],
  moduleUnavailable = false,
}) {
  const auth = useAuth();
  const isDark = useIsDark();
  const { t } = useLocale();
  const { requestAuth } = useAuthPrompt();
  const [params, setParams] = useSearchParams();
  const mode = ecommerceModeById(businessId);
  const availableModeIdSet = useMemo(
    () =>
      new Set(
        availableModeIds.length
          ? availableModeIds
          : ECOMMERCE_MODES.map((item) => item.id),
      ),
    [availableModeIds],
  );
  const fields = useMemo(() => new Set(mode.fields || []), [mode]);
  const text = localeText();
  const fileInput = useRef(null);
  const modelFileInput = useRef(null);
  const sceneFileInput = useRef(null);
  const layoutFileInput = useRef(null);
  const previewUrlsRef = useRef([]);
  const tryonNoticeTimer = useRef(0);
  const compressControllerRef = useRef(null);
  const uploadPrefetchRef = useRef(new Map());
  const railScroll = useRef(null);
  const pageRef = useRef(null);
  const canvasRef = useRef(null);
  const pendingCostRunRef = useRef(null);
  const taskLaunchPendingRef = useRef(false);
  useEffect(() => {
    if (!moduleUnavailable || !pageRef.current) return undefined;
    const guarded = pageRef.current.querySelectorAll(
      ".commerce-header, .commerce-settings, .commerce-canvas",
    );
    guarded.forEach((node) => {
      node.inert = true;
      node.setAttribute("aria-hidden", "true");
    });
    return () => {
      guarded.forEach((node) => {
        node.inert = false;
        node.removeAttribute("aria-hidden");
      });
    };
  }, [mode.id, moduleUnavailable]);
  const [pane, setPane] = useState(
    hidesCommerceSettings(businessId) ? "canvas" : "settings",
  );
  const [workspace, setWorkspace] = useState("result");
  const [railEdges, setRailEdges] = useState({ start: true, end: false });
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
  const {
    tryonSlots,
    setTryonSlots,
    tryonUploadNotice,
    setTryonUploadNoticeState,
    tryonDraftReady,
    setTryonDraftReady,
    tryonStarting,
    setTryonStarting,
    featuredTryonModelId,
    setFeaturedTryonModelId,
    tryonModelBusy,
    setTryonModelBusy,
    featuredTryonSceneId,
    setFeaturedTryonSceneId,
    tryonSceneBusy,
    setTryonSceneBusy,
    tryonModelCatalog,
    setTryonModelCatalog,
    tryonSceneCatalog,
    setTryonSceneCatalog,
    tryonGarmentCatalog,
    setTryonGarmentCatalog,
    featuredTryonGarmentId,
    setFeaturedTryonGarmentId,
    tryonGarmentBusy,
    setTryonGarmentBusy,
    tryonLens,
    setTryonLens,
    tryonLight,
    setTryonLight,
    tryonPreview,
    setTryonPreview,
  } = useTryonBusinessState();
  const {
    handheldUploadNotice,
    setHandheldUploadNoticeState,
    handheldStarting,
    setHandheldStarting,
    handheldGuideOpen,
    setHandheldGuideOpen,
    handheldPreview,
    setHandheldPreview,
    handheldActionBusy,
    setHandheldActionBusy,
    handheldProjectId,
    setHandheldProjectId,
    handheldRetryingByIndex,
    setHandheldRetryingByIndex,
    handheldModelBusy,
    setHandheldModelBusy,
    handheldSceneBusy,
    setHandheldSceneBusy,
    handheldSlots,
    setHandheldSlots,
    handheldModelCatalog,
    setHandheldModelCatalog,
    handheldHandCatalog,
    setHandheldHandCatalog,
    handheldSceneCatalog,
    setHandheldSceneCatalog,
    handheldDraftReady,
    setHandheldDraftReady,
    featuredHandheldModelId,
    setFeaturedHandheldModelId,
    featuredHandheldHandId,
    setFeaturedHandheldHandId,
    featuredHandheldSceneId,
    setFeaturedHandheldSceneId,
    handheldPose,
    setHandheldPose,
    handheldStyle,
    setHandheldStyle,
    handheldCrop,
    setHandheldCrop,
    handheldPack,
    setHandheldPack,
    handheldHand,
    setHandheldHand,
    handheldLanguage,
    setHandheldLanguage,
    handheldAnnotations,
    setHandheldAnnotations,
    handheldCategory,
    setHandheldCategory,
    handheldPlatform,
    setHandheldPlatform,
    handheldLens,
    setHandheldLens,
    handheldLight,
    setHandheldLight,
    handheldCamera,
    setHandheldCamera,
    handheldDepth,
    setHandheldDepth,
    handheldFocus,
    setHandheldFocus,
    handheldMaterialInteraction,
    setHandheldMaterialInteraction,
    handheldPhotoPreset,
    setHandheldPhotoPreset,
    handheldPackState,
    setHandheldPackState,
    handheldArchitecture,
    setHandheldArchitecture,
    handheldPromptEdits,
    setHandheldPromptEdits,
    handheldSku,
    setHandheldSku,
  } = useHandheldBusinessState();
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [platform, setPlatform] = useState("Amazon");
  const [market, setMarket] = useState("美国");
  const [language, setLanguage] = useState("英文");
  const [aspectRatio, setAspectRatio] = useState(mode.ratio);
  const [requestedCount, setRequestedCount] = useState(1);
  const [modelId, setModelId] = useState("");
  const [models, setModels] = useState([]);
  const [unitPrice, setUnitPrice] = useState(3);
  const [scene, setScene] = useState(
    mode.id === "tryon" ? OPTIONS.tryonScene[0] : OPTIONS.scene[0],
  );
  const [tone, setTone] = useState(OPTIONS.tone[0]);
  const [campaign, setCampaign] = useState(OPTIONS.campaign[0]);
  const [apparel, setApparel] = useState(OPTIONS.tryonApparel[0]);
  const [tryonBriefs, setTryonBriefs] = useState({});
  const [modelProfile, setModelProfile] = useState(OPTIONS.model[0]);
  const [pose, setPose] = useState(OPTIONS.pose[0]);
  const {
    accessoryCategory,
    setAccessoryCategory,
    accessoryPack,
    setAccessoryPack,
    accessoryMaterial,
    setAccessoryMaterial,
    accessoryScale,
    setAccessoryScale,
    accessorySizeMm,
    setAccessorySizeMm,
    accessoryOcclusion,
    setAccessoryOcclusion,
    accessoryCrop,
    setAccessoryCrop,
    accessoryStyle,
    setAccessoryStyle,
    accessorySku,
    setAccessorySku,
    accessorySlots,
    setAccessorySlots,
    accessoryDraftReady,
    setAccessoryDraftReady,
    accessoryActionBusy,
    setAccessoryActionBusy,
    accessoryNotice,
    setAccessoryNotice,
    accessoryPreview,
    setAccessoryPreview,
    accessoryUploadRoleRef,
  } = useAccessoryBusinessState();
  const [shadow, setShadow] = useState(OPTIONS.shadow[0]);
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [shootUseCase, setShootUseCase] = useState("listing");
  const [shootGoal, setShootGoal] = useState("conversion");
  const [shootAudience, setShootAudience] = useState("");
  const [shootSku, setShootSku] = useState("");
  const [shootProtectedElements, setShootProtectedElements] = useState(
    "商品外形与比例、颜色与材质、Logo、包装文字、接口位置、部件和配件数量",
  );
  const [shootShotIds, setShootShotIds] = useState([
    "hero",
    "lifestyle",
    "detail",
    "selling",
  ]);
  const [selectedModules, setSelectedModules] = useState(
    ECOMMERCE_MODULES.filter((item) => item.value !== "angles").map(
      (item) => item.value,
    ),
  );
  const [aplusAsin, setAplusAsin] = useState("");
  const [aplusCompetitorAsin, setAplusCompetitorAsin] = useState("");
  const [aplusCategoryId, setAplusCategoryId] = useState("generic");
  const [aplusMarketplaceId, setAplusMarketplaceId] = useState("US");
  const [aplusTier, setAplusTier] = useState("basic");
  const [aplusDisclosure, setAplusDisclosure] = useState(true);
  const [aplusBatchText, setAplusBatchText] = useState("");
  const [aplusLivePlan, setAplusLivePlan] = useState(null);
  const [aplusPlanning, setAplusPlanning] = useState(false);
  const [aplusAnalyzeError, setAplusAnalyzeError] = useState("");
  const [structureMode, setStructureMode] = useState("smart");
  const [counts, setCounts] = useState({
    white: 1,
    scene: 2,
    selling: 2,
    other: 2,
  });
  const [cloneType, setCloneType] = useState("电商商品图");
  const [cloneFidelity, setCloneFidelity] = useState("style");
  const [textStable, setTextStable] = useState(true);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionDirection, setRevisionDirection] = useState("precise");
  const [revisionBrief, setRevisionBrief] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [loaded, setLoaded] = useState(new Set());
  const [sessionCount, setSessionCount] = useState(0);
  const [sessionBatchId, setSessionBatchId] = useState("");
  const currentModeIdRef = useRef(mode.id);
  const sessionBatchIdRef = useRef(sessionBatchId);
  currentModeIdRef.current = mode.id;
  sessionBatchIdRef.current = sessionBatchId;
  const handheldRestoreBatchRef = useRef("");
  const tryonRatioHydratedRef = useRef(false);
  const tryonInferredRatiosRef = useRef({});
  const [submitError, setSubmitError] = useState("");
  const [costConfirm, setCostConfirm] = useState(null);
  const [taskLaunchPending, setTaskLaunchPending] = useState(false);
  const [deleteRow, setDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");

  function openImagePreview(url) {
    if (url && canOpenWallevenImagePreview()) setPreviewUrl(url);
  }
  const [maskRow, setMaskRow] = useState(null);
  const [brief, setBrief] = useState({
    open: false,
    busy: false,
    error: "",
    name: "",
    points: "",
    attempt: 0,
  });
  const [assets, setAssets] = useState({
    loading: false,
    hydrated: false,
    items: [],
    groups: [],
    error: "",
  });
  const jobs = useEcommerceJobs({
    taskKind: `ui-design-ecommerce-${mode.id}-generation`,
    models,
  });

  useGSAP(
    (context, contextSafe) => {
      const root = pageRef.current;
      if (!root) return undefined;
      const targets = gsap.utils.toArray(
        "[data-commerce-page-motion-target]",
        root,
      );
      root.dataset.ecommercePageMotionState = "entering";
      if (!targets.length || ecommerceAnimationsDisabled()) {
        gsap.set(targets, {
          autoAlpha: 1,
          clearProps: "opacity,visibility,transform",
        });
        root.dataset.ecommercePageMotionState = "entered";
        return undefined;
      }

      const finish = (contextSafe || ((callback) => callback))(() => {
        root.dataset.ecommercePageMotionState = "entered";
      });
      const timeline = gsap.timeline({
        defaults: { duration: 0.34, ease: "power2.out" },
        onComplete: finish,
      });
      const header = root.querySelector(".commerce-header");
      const mobileControls = root.querySelectorAll(
        ".mobile-pane-switch, .mobile-tool-switch",
      );
      const rail = root.querySelector(".commerce-rail");
      if (header) {
        timeline.fromTo(
          header,
          { autoAlpha: 0, y: -8 },
          { autoAlpha: 1, y: 0, clearProps: "opacity,visibility,transform" },
          0,
        );
      }
      if (mobileControls.length) {
        timeline.fromTo(
          mobileControls,
          { autoAlpha: 0, y: -6 },
          {
            autoAlpha: 1,
            y: 0,
            stagger: 0.04,
            clearProps: "opacity,visibility,transform",
          },
          0.04,
        );
      }
      if (rail) {
        timeline.fromTo(
          rail,
          { autoAlpha: 0, x: -10 },
          { autoAlpha: 1, x: 0, clearProps: "opacity,visibility,transform" },
          0.08,
        );
      }
      return () => timeline.kill();
    },
    { scope: pageRef },
  );

  useGSAP(
    (context, contextSafe) => {
      const root = pageRef.current;
      if (!root) return undefined;
      const selectors =
        workspace === "result"
          ? [
              ".settings-scroll > .settings-section",
              ".settings-scroll > .selected-product-context",
              ".canvas-intro > div:first-child",
              ".showcase-demo__caption",
              ".result-workspace > header",
              ".revision-panel > header",
            ]
          : workspace === "products"
            ? [".commerce-products__header"]
            : [".workspace-library__header"];
      const targets = gsap.utils
        .toArray(selectors.join(","), root)
        .slice(0, 14);
      targets.forEach((target) =>
        target.setAttribute("data-commerce-content-motion-target", ""),
      );
      root.dataset.ecommerceContentMotionState = "entering";
      if (!targets.length || ecommerceAnimationsDisabled()) {
        gsap.set(targets, {
          autoAlpha: 1,
          clearProps: "opacity,visibility,transform",
        });
        root.dataset.ecommerceContentMotionState = "entered";
        return undefined;
      }

      const finish = (contextSafe || ((callback) => callback))(() => {
        root.dataset.ecommerceContentMotionState = "entered";
      });
      const animation = gsap.fromTo(
        targets,
        { autoAlpha: 0, y: 8 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.32,
          stagger: 0.025,
          ease: "power2.out",
          clearProps: "opacity,visibility,transform",
          onComplete: finish,
        },
      );
      return () => {
        animation.kill();
        gsap.set(targets, {
          autoAlpha: 1,
          clearProps: "opacity,visibility,transform",
        });
      };
    },
    {
      dependencies: [workspace],
      scope: pageRef,
      revertOnUpdate: true,
    },
  );

  useGSAP(
    () => {
      const root = pageRef.current;
      const body = root?.querySelector(".revision-panel__body");
      if (!body || !revisionOpen || ecommerceAnimationsDisabled()) return;
      gsap.fromTo(
        body,
        { autoAlpha: 0, x: 8 },
        {
          autoAlpha: 1,
          x: 0,
          duration: 0.24,
          ease: "power2.out",
          clearProps: "opacity,visibility,transform",
        },
      );
    },
    {
      dependencies: [revisionOpen],
      scope: pageRef,
      revertOnUpdate: true,
    },
  );

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      fetchRuntimeConfig(),
      fetch("/api/v1/pricing", { signal: controller.signal }).then((response) =>
        response.json(),
      ),
    ]).then(([runtime, pricing]) => {
      if (controller.signal.aborted) return;
      if (runtime.status === "fulfilled") {
        const feature = runtime.value.features?.["ai.ecommerceDesign"] || {};
        const list =
          feature.config?.publicModels ||
          feature.publicModels ||
          runtime.value.aiModelCatalog?.featurePublicModels ||
          [];
        setModels(list);
        setModelId(
          String(
            list.find((item) => item.default)?.id ||
              list[0]?.id ||
              list[0]?.publicModelKey ||
              "",
          ),
        );
      }
      if (pricing.status === "fulfilled")
        setUnitPrice(
          Number(pricing.value?.data?.taskPointPrices?.ecommerce_design || 3),
        );
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const selected = models.find((item) =>
      [item?.id, item?.publicModelKey, item?.model]
        .map(String)
        .includes(String(modelId)),
    );
    const price = Number(selected?.creditCost ?? selected?.pricePoints);
    if (Number.isFinite(price)) setUnitPrice(Math.max(0, price));
  }, [modelId, models]);

  useEffect(() => {
    tryonRatioHydratedRef.current = false;
    setAspectRatio(
      mode.id === "tryon"
        ? OPTIONS.tryonRatio.some((item) => item.value === mode.ratio)
          ? mode.ratio
          : "2:3"
        : mode.id === "handheld"
          ? OPTIONS.handheldRatio.some((item) => item.value === mode.ratio)
            ? mode.ratio
            : "4:5"
          : mode.ratio,
    );
    setRequestedCount(mode.id === "listing" ? 7 : 1);
    if (mode.id === "tryon") {
      setApparel((current) =>
        OPTIONS.tryonApparel.includes(current)
          ? current
          : OPTIONS.tryonApparel[0],
      );
    }
    setPane(hidesCommerceSettings(mode.id) ? "canvas" : "settings");
    setWorkspace("result");
    setFiles([]);
    setPreviews([]);
    setSelectedProduct(null);
    setSessionCount(0);
    setSessionBatchId("");
    setSubmitError("");
    setTryonPreview(null);
    setHandheldPreview(null);
    setAccessoryPreview(null);
    setTryonUploadNoticeState("");
    setHandheldUploadNoticeState("");
    compressControllerRef.current?.abort();
    compressControllerRef.current = null;
  }, [mode.id, mode.ratio]);
  useEffect(() => {
    if (mode.id === "handheld" && sessionBatchId) {
      try {
        sessionStorage.setItem(
          HANDHELD_ACTIVE_BATCH_STORAGE_KEY,
          sessionBatchId,
        );
      } catch {
        // Storage is optional; task history remains the fallback.
      }
    }
  }, [mode.id, sessionBatchId]);
  useEffect(() => {
    if (mode.id !== "handheld" || sessionBatchId || jobs.historyLoading) return;
    let persistedBatchId = "";
    try {
      persistedBatchId = String(
        sessionStorage.getItem(HANDHELD_ACTIVE_BATCH_STORAGE_KEY) || "",
      );
    } catch {
      persistedBatchId = "";
    }
    const latest = jobs.tasks.find(
      (task) =>
        task.kind === "ui-design-ecommerce-handheld-generation" &&
        String(task.batchId || task.params?.batchId || ""),
    );
    const restoredBatchId =
      persistedBatchId ||
      String(latest?.batchId || latest?.params?.batchId || "");
    if (!restoredBatchId) return;
    const tasksForBatch = (batchId) =>
      jobs.tasks.filter(
        (task) =>
          task.kind === "ui-design-ecommerce-handheld-generation" &&
          String(task.batchId || task.params?.batchId || "") === batchId,
      );
    const applyRestoredBatch = (batchId, restoredTasks) => {
      if (
        currentModeIdRef.current !== "handheld" ||
        sessionBatchIdRef.current ||
        !batchId ||
        !restoredTasks.length
      ) {
        return;
      }
      const restoredTask = restoredTasks[0];
      const restoredSpec = restoredTask?.params?.handheldSpec;
      if (restoredSpec && typeof restoredSpec === "object") {
        if (
          HANDHELD_PACK_OPTIONS.some((item) => item.id === restoredSpec.pack)
        ) {
          setHandheldPack(restoredSpec.pack);
        }
        if (
          HANDHELD_PLATFORM_OPTIONS.some(
            (item) => item.id === restoredSpec.platform,
          )
        ) {
          setHandheldPlatform(restoredSpec.platform);
        }
        if (
          OPTIONS.handheldRatio.some(
            (item) => item.value === restoredSpec.aspectRatio,
          )
        ) {
          setAspectRatio(restoredSpec.aspectRatio);
        }
      }
      setSessionBatchId(batchId);
      setSessionCount(
        Math.max(
          restoredTasks.length,
          Number(
            restoredTask?.batchSize || restoredTask?.params?.batchSize || 1,
          ),
        ),
      );
    };
    const restoredTasks = tasksForBatch(restoredBatchId);
    if (!restoredTasks.length && persistedBatchId) {
      if (handheldRestoreBatchRef.current === restoredBatchId) return;
      handheldRestoreBatchRef.current = restoredBatchId;
      void jobs
        .hydrateHandheldBatch(restoredBatchId)
        .then((result) => {
          applyRestoredBatch(
            String(result?.batchId || restoredBatchId),
            result?.tasks || [],
          );
        })
        .catch(() => {
          try {
            sessionStorage.removeItem(HANDHELD_ACTIVE_BATCH_STORAGE_KEY);
          } catch {
            // Ignore unavailable storage and fall back to general history.
          }
          const fallbackBatchId = String(
            latest?.batchId || latest?.params?.batchId || "",
          );
          applyRestoredBatch(fallbackBatchId, tasksForBatch(fallbackBatchId));
        })
        .finally(() => {
          if (handheldRestoreBatchRef.current === restoredBatchId) {
            handheldRestoreBatchRef.current = "";
          }
        });
      return;
    }
    applyRestoredBatch(restoredBatchId, restoredTasks);
  }, [
    mode.id,
    sessionBatchId,
    jobs.historyLoading,
    jobs.tasks,
    jobs.hydrateHandheldBatch,
  ]);
  const tryonUrlsRef = useRef({ garment: null, model: null, scene: null });
  const handheldUrlsRef = useRef({
    product: null,
    model: null,
    scene: null,
    layout: null,
  });
  const handheldClearedRef = useRef({
    product: false,
    model: false,
    scene: false,
    layout: false,
  });
  useEffect(() => {
    const next = {
      garment: tryonSlots.garment?.local ? tryonSlots.garment.url : null,
      model: tryonSlots.model?.local ? tryonSlots.model.url : null,
      scene: tryonSlots.scene?.local ? tryonSlots.scene.url : null,
    };
    for (const role of ["garment", "model", "scene"]) {
      const previous = tryonUrlsRef.current[role];
      if (previous && previous !== next[role]) URL.revokeObjectURL(previous);
    }
    tryonUrlsRef.current = next;
  }, [tryonSlots]);
  useEffect(() => {
    const next = {
      product: handheldSlots.product?.local ? handheldSlots.product.url : null,
      model: handheldSlots.model?.local ? handheldSlots.model.url : null,
      scene: handheldSlots.scene?.local ? handheldSlots.scene.url : null,
      layout: handheldSlots.layout?.local ? handheldSlots.layout.url : null,
    };
    for (const role of ["product", "model", "scene", "layout"]) {
      const previous = handheldUrlsRef.current[role];
      if (previous && previous !== next[role]) URL.revokeObjectURL(previous);
    }
    handheldUrlsRef.current = next;
  }, [handheldSlots]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      let models = [];
      let scenes = [];
      let garments = [];
      try {
        const [draft, handheldDraft, remote, handheldRemote] =
          await Promise.all([
            loadTryonDraft(),
            loadHandheldDraft(),
            listTryonCatalog().catch(() => null),
            listHandheldCatalog().catch(() => null),
          ]);
        if (!alive) return;
        if (remote?.models?.length) models = remote.models;
        if (remote?.scenes?.length) scenes = remote.scenes;
        if (remote?.garments?.length) garments = remote.garments;
        setTryonModelCatalog(models);
        setTryonSceneCatalog(scenes);
        setTryonGarmentCatalog(garments);
        const handheldModels = handheldRemote?.models?.length
          ? handheldRemote.models
          : HANDHELD_MODEL_CATALOG;
        const handheldHands = handheldRemote?.hands?.length
          ? handheldRemote.hands
          : [];
        const handheldScenes = handheldRemote?.scenes?.length
          ? handheldRemote.scenes
          : HANDHELD_SCENE_CATALOG;
        setHandheldModelCatalog(handheldModels);
        setHandheldHandCatalog(handheldHands);
        setHandheldSceneCatalog(handheldScenes);
        const tryonCatalogs = { models, scenes, garments };
        const handheldCatalogs = {
          models: handheldModels,
          hands: handheldHands,
          scenes: handheldScenes,
          garments: [],
        };
        if (draft) {
          if (OPTIONS.tryonApparel.includes(draft.apparel))
            setApparel(draft.apparel);
          if (catalogOptionById(models, draft.featuredTryonModelId)) {
            setFeaturedTryonModelId(draft.featuredTryonModelId);
          } else {
            setFeaturedTryonModelId(models[0]?.id || "");
          }
          if (catalogOptionById(scenes, draft.featuredTryonSceneId)) {
            setFeaturedTryonSceneId(draft.featuredTryonSceneId);
          } else {
            setFeaturedTryonSceneId(scenes[0]?.id || "");
          }
          if (catalogOptionById(garments, draft.featuredTryonGarmentId)) {
            setFeaturedTryonGarmentId(draft.featuredTryonGarmentId);
          }
          if (draft.scene) setScene(draft.scene);
          if (draft.modelProfile) setModelProfile(draft.modelProfile);
          if (
            currentModeIdRef.current === "tryon" &&
            !tryonRatioHydratedRef.current &&
            matchingRatio(draft.aspectRatio, OPTIONS.tryonRatio)
          ) {
            setAspectRatio(draft.aspectRatio);
          }
          const restored = { garment: null, model: null, scene: null };
          for (const role of ["garment", "model", "scene"]) {
            const item = draft.slots?.[role];
            if (item?.file instanceof Blob && item.file.size > 0) {
              restored[role] = {
                file: item.file,
                url: URL.createObjectURL(item.file),
                local: true,
                managed: "slot",
                source: "upload",
                uploadKey: item.uploadKey || "",
              };
              continue;
            }
            if (item?.source !== "builtin" || !item.catalogId) continue;
            const option = catalogOptionById(
              catalogForRole(role, tryonCatalogs),
              item.catalogId,
            );
            if (!option) continue;
            try {
              const file = await fileFromCatalogImage(
                option.image,
                `tryon-${role}-${option.id}.jpg`,
              );
              if (!alive) return;
              restored[role] = builtinCatalogSlot(file, option, {
                uploadKey: item.uploadKey,
              });
            } catch {
              restored[role] = null;
            }
          }
          if (alive) setTryonSlots(restored);
        } else {
          setFeaturedTryonModelId(models[0]?.id || "");
          setFeaturedTryonSceneId(scenes[0]?.id || "");
        }
        if (handheldDraft) {
          const optionalSelectionVersion = Number(
            handheldDraft.optionalSelectionVersion || 0,
          );
          const restorePicturePlan = optionalSelectionVersion >= 2;
          const restoreProductAndPose = optionalSelectionVersion >= 3;
          if (
            restoreProductAndPose &&
            HANDHELD_POSE_OPTIONS.some(
              (item) => item.id === handheldDraft.poseId,
            )
          ) {
            setHandheldPose(handheldDraft.poseId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_STYLE_OPTIONS.some(
              (item) => item.id === handheldDraft.styleId,
            )
          ) {
            setHandheldStyle(handheldDraft.styleId);
          }
          if (handheldDraft.cropId) {
            setHandheldCrop(handheldCropById(handheldDraft.cropId).id);
          }
          if (
            HANDHELD_PACK_OPTIONS.some(
              (item) => item.id === handheldDraft.packId,
            )
          ) {
            setHandheldPack(handheldDraft.packId);
          }
          if (
            restoreProductAndPose &&
            HANDHELD_HAND_OPTIONS.some(
              (item) => item.id === handheldDraft.handId,
            )
          ) {
            setHandheldHand(handheldDraft.handId);
          }
          if (
            restoreProductAndPose &&
            HANDHELD_CATEGORY_OPTIONS.some(
              (item) => item.id === handheldDraft.categoryId,
            )
          ) {
            setHandheldCategory(handheldDraft.categoryId);
          }
          if (
            HANDHELD_PLATFORM_OPTIONS.some(
              (item) => item.id === handheldDraft.platformId,
            )
          ) {
            setHandheldPlatform(handheldDraft.platformId);
          }
          const restoredPlatform = HANDHELD_PLATFORM_OPTIONS.find(
            (item) => item.id === handheldDraft.platformId,
          );
          const restoredRatio = OPTIONS.handheldRatio.some(
            (item) => item.value === handheldDraft.aspectRatio,
          )
            ? handheldDraft.aspectRatio
            : restoredPlatform?.ratio;
          if (restoredRatio && currentModeIdRef.current === "handheld") {
            setAspectRatio(restoredRatio);
          }
          if (
            HANDHELD_LANGUAGE_OPTIONS.some(
              (item) => item.id === handheldDraft.languageId,
            )
          ) {
            setHandheldLanguage(handheldDraft.languageId);
          }
          setHandheldAnnotations(handheldDraft.annotations || []);
          if (
            restorePicturePlan &&
            HANDHELD_LENS_OPTIONS.some(
              (item) => item.id === handheldDraft.lensId,
            )
          ) {
            setHandheldLens(handheldDraft.lensId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_LIGHT_OPTIONS.some(
              (item) => item.id === handheldDraft.lightId,
            )
          ) {
            setHandheldLight(handheldDraft.lightId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_CAMERA_OPTIONS.some(
              (item) => item.id === handheldDraft.cameraId,
            )
          ) {
            setHandheldCamera(handheldDraft.cameraId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_DEPTH_OPTIONS.some(
              (item) => item.id === handheldDraft.depthId,
            )
          ) {
            setHandheldDepth(handheldDraft.depthId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_FOCUS_OPTIONS.some(
              (item) => item.id === handheldDraft.focusId,
            )
          ) {
            setHandheldFocus(handheldDraft.focusId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_MATERIAL_INTERACTION_OPTIONS.some(
              (item) => item.id === handheldDraft.materialInteractionId,
            )
          ) {
            setHandheldMaterialInteraction(handheldDraft.materialInteractionId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_PHOTO_PRESET_OPTIONS.some(
              (item) => item.id === handheldDraft.photoPresetId,
            )
          ) {
            setHandheldPhotoPreset(handheldDraft.photoPresetId);
          }
          if (
            restoreProductAndPose &&
            HANDHELD_PACK_STATE_OPTIONS.some(
              (item) => item.id === handheldDraft.packStateId,
            )
          ) {
            setHandheldPackState(handheldDraft.packStateId);
          }
          if (
            restorePicturePlan &&
            HANDHELD_ARCHITECTURE_OPTIONS.some(
              (item) => item.id === handheldDraft.architectureId,
            )
          ) {
            setHandheldArchitecture(handheldDraft.architectureId);
          }
          if (handheldDraft.sku) setHandheldSku(handheldDraft.sku);
          if (
            catalogOptionById(handheldModels, handheldDraft.featuredModelId)
          ) {
            setFeaturedHandheldModelId(handheldDraft.featuredModelId);
          } else if (handheldModels[0]) {
            setFeaturedHandheldModelId(handheldModels[0].id);
          }
          if (catalogOptionById(handheldHands, handheldDraft.featuredHandId)) {
            setFeaturedHandheldHandId(handheldDraft.featuredHandId);
          }
          if (
            catalogOptionById(handheldScenes, handheldDraft.featuredSceneId)
          ) {
            setFeaturedHandheldSceneId(handheldDraft.featuredSceneId);
          } else if (handheldScenes[0]) {
            setFeaturedHandheldSceneId(handheldScenes[0].id);
          }
          if (handheldDraft.scene) setScene(handheldDraft.scene);
          if (handheldDraft.modelProfile)
            setModelProfile(handheldDraft.modelProfile);
          const restoredHandheld = {
            product: null,
            model: null,
            scene: null,
            layout: null,
          };
          for (const role of ["product", "model", "scene", "layout"]) {
            const item = handheldDraft.slots?.[role];
            if (item?.file instanceof Blob && item.file.size > 0) {
              restoredHandheld[role] = {
                file: item.file,
                url: URL.createObjectURL(item.file),
                local: true,
                managed: "slot",
                source: "upload",
                uploadKey: item.uploadKey || "",
              };
              continue;
            }
            if (
              item?.source !== "builtin" ||
              !item.catalogId ||
              !restorePicturePlan ||
              role === "product" ||
              role === "layout"
            )
              continue;
            const option = catalogOptionById(
              catalogForRole(role, handheldCatalogs),
              item.catalogId,
            );
            if (!option) continue;
            try {
              const file = await fileFromCatalogImage(
                option.image,
                `handheld-${role}-${option.id}.jpg`,
              );
              if (!alive) return;
              restoredHandheld[role] = builtinCatalogSlot(file, option, {
                uploadKey: item.uploadKey,
              });
            } catch {
              restoredHandheld[role] = null;
            }
          }
          if (alive) setHandheldSlots(restoredHandheld);
        }
      } catch {
        /* empty canvas still works */
      } finally {
        if (alive) {
          setTryonDraftReady(true);
          setHandheldDraftReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (mode.id !== "tryon" || !tryonDraftReady) return undefined;
    const model =
      catalogOptionById(tryonModelCatalog, featuredTryonModelId) ||
      tryonModelCatalog[0];
    const scene =
      catalogOptionById(tryonSceneCatalog, featuredTryonSceneId) ||
      tryonSceneCatalog[0];
    if (!model && !scene) return undefined;
    let alive = true;
    void (async () => {
      try {
        const [modelFile, sceneFile] = await Promise.all([
          model
            ? fileFromCatalogImage(model.image, `tryon-model-${model.id}.jpg`)
            : Promise.resolve(null),
          scene
            ? fileFromCatalogImage(scene.image, `tryon-scene-${scene.id}.jpg`)
            : Promise.resolve(null),
        ]);
        if (!alive) return;
        setTryonSlots((current) => {
          const next = { ...current };
          if (modelFile && !current.model?.file) {
            next.model = builtinCatalogSlot(modelFile, model);
          }
          if (sceneFile && !current.scene?.file) {
            next.scene = builtinCatalogSlot(sceneFile, scene);
          }
          return next;
        });
      } catch {
        /* generate still fetches catalog files on demand */
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    mode.id,
    featuredTryonModelId,
    featuredTryonSceneId,
    tryonDraftReady,
    tryonModelCatalog,
    tryonSceneCatalog,
  ]);
  useEffect(() => {
    if (mode.id !== "tryon") return;
    for (const role of ["garment", "model", "scene"]) {
      const slot = tryonSlots[role];
      if (
        slot?.file instanceof Blob &&
        slot.file.size > 0 &&
        !isReusableTaskImageKey(slot.uploadKey)
      ) {
        void prefetchSlotUpload(role, slot.file);
      }
    }
  }, [mode.id, tryonSlots]);
  useEffect(() => {
    if (mode.id !== "handheld") return;
    for (const role of ["product", "model", "scene", "layout"]) {
      const slot = handheldSlots[role];
      if (
        slot?.file instanceof Blob &&
        slot.file.size > 0 &&
        !isReusableTaskImageKey(slot.uploadKey)
      ) {
        void prefetchSlotUpload(role, slot.file, setHandheldSlots);
      }
    }
  }, [mode.id, handheldSlots]);
  useEffect(() => {
    if (!tryonDraftReady) return undefined;
    const timer = window.setTimeout(() => {
      void saveTryonDraft({
        slots: tryonSlots,
        apparel,
        featuredTryonModelId,
        featuredTryonSceneId,
        featuredTryonGarmentId,
        scene,
        modelProfile,
        aspectRatio,
      }).catch(() => {});
    }, 280);
    return () => window.clearTimeout(timer);
  }, [
    tryonDraftReady,
    tryonSlots,
    apparel,
    featuredTryonModelId,
    featuredTryonSceneId,
    featuredTryonGarmentId,
    scene,
    modelProfile,
    aspectRatio,
  ]);
  useEffect(() => {
    if (!handheldDraftReady) return undefined;
    const timer = window.setTimeout(() => {
      void saveHandheldDraft({
        slots: handheldSlots,
        poseId: handheldPose,
        styleId: handheldStyle,
        cropId: handheldCrop,
        packId: handheldPack,
        handId: handheldHand,
        categoryId: handheldCategory,
        platformId: handheldPlatform,
        aspectRatio,
        languageId: handheldLanguage,
        annotations: handheldAnnotations,
        lensId: handheldLens,
        lightId: handheldLight,
        cameraId: handheldCamera,
        depthId: handheldDepth,
        focusId: handheldFocus,
        materialInteractionId: handheldMaterialInteraction,
        photoPresetId: handheldPhotoPreset,
        packStateId: handheldPackState,
        architectureId: handheldArchitecture,
        sku: handheldSku,
        featuredModelId: featuredHandheldModelId,
        featuredHandId: featuredHandheldHandId,
        featuredSceneId: featuredHandheldSceneId,
        scene,
        modelProfile,
      }).catch(() => {});
    }, 280);
    return () => window.clearTimeout(timer);
  }, [
    handheldDraftReady,
    handheldSlots,
    handheldPose,
    handheldStyle,
    handheldCrop,
    handheldPack,
    handheldHand,
    handheldCategory,
    handheldPlatform,
    aspectRatio,
    handheldLanguage,
    handheldAnnotations,
    handheldLens,
    handheldLight,
    handheldCamera,
    handheldDepth,
    handheldFocus,
    handheldMaterialInteraction,
    handheldPhotoPreset,
    handheldPackState,
    handheldArchitecture,
    handheldSku,
    featuredHandheldModelId,
    featuredHandheldHandId,
    featuredHandheldSceneId,
    scene,
    modelProfile,
  ]);
  useEffect(() => {
    if (mode.id !== "accessory" || accessoryDraftReady) return undefined;
    let alive = true;
    void loadAccessoryDraft()
      .then((draft) => {
        if (!alive) return;
        if (draft) {
          if (
            ACCESSORY_CATEGORY_OPTIONS.some(
              (item) => item.id === draft.category,
            )
          )
            setAccessoryCategory(draft.category);
          if (ACCESSORY_PACK_OPTIONS.some((item) => item.id === draft.pack))
            setAccessoryPack(draft.pack);
          if (
            ACCESSORY_MATERIAL_OPTIONS.some(
              (item) => item.id === draft.material,
            )
          )
            setAccessoryMaterial(draft.material);
          if (ACCESSORY_SCALE_OPTIONS.some((item) => item.id === draft.scale))
            setAccessoryScale(draft.scale);
          if (
            ACCESSORY_OCCLUSION_OPTIONS.some(
              (item) => item.id === draft.occlusion,
            )
          )
            setAccessoryOcclusion(draft.occlusion);
          if (ACCESSORY_CROP_OPTIONS.some((item) => item.id === draft.crop))
            setAccessoryCrop(draft.crop);
          if (ACCESSORY_STYLE_OPTIONS.some((item) => item.id === draft.style))
            setAccessoryStyle(draft.style);
          if (draft.sizeMm) setAccessorySizeMm(draft.sizeMm);
          if (draft.sku) setAccessorySku(draft.sku);
          if (draft.productName) setProductName(draft.productName);
          if (draft.sellingPoints) setSellingPoints(draft.sellingPoints);
          if (OPTIONS.platform.includes(draft.platform))
            setPlatform(draft.platform);
          if (OPTIONS.market.includes(draft.market)) setMarket(draft.market);
          if (
            OPTIONS.handheldRatio.some(
              (item) => item.value === draft.aspectRatio,
            )
          )
            setAspectRatio(draft.aspectRatio);
          if (draft.slots) {
            setAccessorySlots({
              product: draft.slots.product || null,
              model: draft.slots.model || null,
              scene: draft.slots.scene || null,
            });
          } else if (draft.references?.length) {
            setAccessorySlots({
              product: draft.references[0] || null,
              model: draft.references[1] || null,
              scene: draft.references[2] || null,
            });
          }
        }
        setAccessoryDraftReady(true);
      })
      .catch(() => {
        if (alive) setAccessoryDraftReady(true);
      });
    return () => {
      alive = false;
    };
  }, [mode.id, accessoryDraftReady]);
  useEffect(() => {
    if (mode.id !== "accessory" || !accessoryDraftReady) return undefined;
    const timer = window.setTimeout(() => {
      void saveAccessoryDraft({
        category: accessoryCategory,
        pack: accessoryPack,
        material: accessoryMaterial,
        scale: accessoryScale,
        sizeMm: accessorySizeMm,
        occlusion: accessoryOcclusion,
        crop: accessoryCrop,
        style: accessoryStyle,
        sku: accessorySku,
        productName,
        sellingPoints,
        platform,
        market,
        aspectRatio,
        slots: accessorySlots,
      }).catch(() => {});
    }, 320);
    return () => window.clearTimeout(timer);
  }, [
    mode.id,
    accessoryDraftReady,
    accessoryCategory,
    accessoryPack,
    accessoryMaterial,
    accessoryScale,
    accessorySizeMm,
    accessoryOcclusion,
    accessoryCrop,
    accessoryStyle,
    accessorySku,
    productName,
    sellingPoints,
    platform,
    market,
    aspectRatio,
    accessorySlots,
  ]);
  useEffect(
    () => () => {
      Object.values(tryonUrlsRef.current).forEach(
        (url) => url && URL.revokeObjectURL(url),
      );
      Object.values(handheldUrlsRef.current).forEach(
        (url) => url && URL.revokeObjectURL(url),
      );
      window.clearTimeout(tryonNoticeTimer.current);
      compressControllerRef.current?.abort();
    },
    [],
  );
  useEffect(() => {
    const keep = new Set(
      previews
        .filter((item) => item.local && item.managed !== "slot")
        .map((item) => item.url)
        .filter(Boolean),
    );
    previewUrlsRef.current.forEach((url) => {
      if (!keep.has(url)) URL.revokeObjectURL(url);
    });
    previewUrlsRef.current = [...keep];
  }, [previews]);
  useEffect(
    () => () => {
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current = [];
    },
    [],
  );

  const updateRail = useCallback(() => {
    const node = railScroll.current;
    if (!node) return;
    const max = Math.max(0, node.scrollHeight - node.clientHeight);
    setRailEdges({
      start: node.scrollTop <= 2,
      end: max <= 2 || node.scrollTop >= max - 2,
    });
  }, []);
  useEffect(() => {
    updateRail();
    window.addEventListener("resize", updateRail);
    return () => window.removeEventListener("resize", updateRail);
  }, [updateRail]);

  const minimumFiles = Number(mode.minFiles || 1);
  const accessoryPresence = useMemo(
    () => accessorySlotPresence(accessorySlots),
    [accessorySlots],
  );
  const inputFiles =
    mode.id === "tryon"
      ? tryonSlots.garment?.file
        ? [
            tryonSlots.garment.file,
            ...(tryonSlots.model?.file ? [tryonSlots.model.file] : []),
            ...(tryonSlots.scene?.file ? [tryonSlots.scene.file] : []),
          ]
        : []
      : mode.id === "handheld"
        ? handheldSlots.product?.file
          ? [
              handheldSlots.product.file,
              ...(handheldSlots.model?.file ? [handheldSlots.model.file] : []),
              ...(handheldSlots.scene?.file ? [handheldSlots.scene.file] : []),
              ...(handheldSlots.layout?.file
                ? [handheldSlots.layout.file]
                : []),
            ]
          : []
        : mode.id === "accessory"
          ? packAccessorySlotFiles(accessorySlots)
          : files;
  const customBlueprints = useMemo(
    () => listingShotBlueprintsFromCounts(counts),
    [counts],
  );
  const selectedModuleDetails = useMemo(
    () => supportedEcommerceModules(selectedModules, inputFiles.length),
    [selectedModules, inputFiles.length],
  );
  const tryonBlueprints = useMemo(
    () => ecommerceShotBlueprints("tryon").slice(0, 1),
    [],
  );
  const handheldBlueprints = useMemo(
    () => handheldShotBlueprints(handheldPack, { crop: handheldCrop }),
    [handheldCrop, handheldPack],
  );
  const accessoryBlueprints = useMemo(
    () => accessoryShotBlueprints(accessoryPack),
    [accessoryPack],
  );
  const aplusPlan = useMemo(
    () =>
      aplusLivePlan?.modules?.length
        ? aplusLivePlan
        : buildDefaultAplusPlan({
            categoryId: aplusCategoryId,
            marketplaceId: aplusMarketplaceId,
            tierId: aplusTier,
            productName,
            sellingPoints,
            asin: aplusAsin,
            competitorAsin: aplusCompetitorAsin,
            disclosure: aplusDisclosure,
            selectedModules,
          }),
    [
      aplusLivePlan,
      aplusCategoryId,
      aplusMarketplaceId,
      aplusTier,
      productName,
      sellingPoints,
      aplusAsin,
      aplusCompetitorAsin,
      aplusDisclosure,
      selectedModules,
    ],
  );
  const aplusBlueprints = useMemo(
    () => aplusShotBlueprintsFromPlan(aplusPlan),
    [aplusPlan],
  );
  const aplusMarketplace = aplusMarketplaceById(aplusMarketplaceId);
  const aplusCategory = aplusCategoryById(aplusCategoryId);
  const shootBlueprints = useMemo(
    () =>
      shootShotIds
        .map((id) => CREATIVE_SHOOT_SHOTS.find((shot) => shot.id === id))
        .filter(Boolean),
    [shootShotIds],
  );
  const blueprints =
    mode.id === "shoot"
      ? shootBlueprints
      : mode.id === "listing" && structureMode === "custom"
        ? customBlueprints
        : mode.id === "tryon"
          ? tryonBlueprints
          : mode.id === "handheld"
            ? handheldBlueprints
            : mode.id === "accessory"
              ? accessoryBlueprints
              : mode.id === "detail"
                ? aplusBlueprints
                : ecommerceShotBlueprints(mode.id, selectedModules);
  const maxOutputCount = Math.max(
    1,
    Math.min(mode.maxCount || 1, blueprints.length || 1),
  );
  const outputCount =
    mode.id === "shoot"
      ? shootBlueprints.length
      : mode.id === "listing"
        ? structureMode === "custom"
          ? customBlueprints.length
          : 7
        : mode.id === "tryon"
          ? tryonBlueprints.length
          : mode.id === "handheld"
            ? handheldBlueprints.length
            : mode.id === "accessory"
              ? accessoryBlueprints.length
              : mode.id === "detail"
                ? aplusBlueprints.length
                : Math.min(requestedCount, maxOutputCount);
  const tryonLensOption = tryonLensById(tryonLens);
  const tryonLightOption = tryonLightById(tryonLight);
  const tryonMentionModelLabel =
    tryonSlots.model?.source === "upload"
      ? "自定义模特"
      : (
          catalogOptionById(tryonModelCatalog, featuredTryonModelId) ||
          tryonModelCatalog[0]
        )?.label || "";
  const tryonMentionSceneLabel =
    tryonSlots.scene?.source === "upload"
      ? "自定义场景"
      : (
          catalogOptionById(tryonSceneCatalog, featuredTryonSceneId) ||
          tryonSceneCatalog[0]
        )?.label || "";
  const tryonMentions = isTryonMode(mode.id)
    ? buildTryonMentions({
        apparel,
        modelLabel: tryonMentionModelLabel,
        sceneLabel: tryonMentionSceneLabel,
        lens: tryonLens,
        light: tryonLight,
        aspectRatio,
      })
    : [];
  const handheldHasHandOrModel = Boolean(handheldSlots.model?.file);
  const handheldHasModel = Boolean(
    handheldHasHandOrModel && handheldCropNeedsPerson(handheldCrop),
  );
  const handheldHasHand = handheldHasHandOrModel && !handheldHasModel;
  const handheldHasScene = Boolean(handheldSlots.scene?.file);
  const handheldHasLayout = Boolean(handheldSlots.layout?.file);
  const handheldRoles = handheldReferenceLabels({
    hasModel: handheldHasModel,
    hasHand: handheldHasHand,
    hasScene: handheldHasScene,
    hasLayout: handheldHasLayout,
  });
  const accessoryHasModel = accessoryPresence.hasModel;
  const accessoryHasScene = accessoryPresence.hasScene;
  const accessoryHasSize = Number.parseFloat(accessorySizeMm) > 0;
  const assembledPrompt = isHandheldMode(mode.id)
    ? buildHandheldTaskPrompt({
        productName,
        sellingPoints,
        sku: handheldSku,
        category: handheldCategory,
        packState: handheldPackState,
        pose: handheldPose,
        style: handheldStyle,
        crop: handheldCrop,
        hand: handheldHand,
        platform: handheldPlatform,
        lens: handheldLens,
        light: handheldLight,
        camera: handheldCamera,
        depth: handheldDepth,
        focus: handheldFocus,
        materialInteraction: handheldMaterialInteraction,
        architecture: handheldArchitecture,
        pack: handheldPack,
        hasModel: handheldHasModel,
        hasHand: handheldHasHand,
        hasScene: handheldHasScene,
        hasLayout: handheldHasLayout,
        aspectRatio,
        language: handheldLanguage,
        annotations: handheldAnnotations,
      })
    : isAccessoryMode(mode.id)
      ? buildAccessoryTaskPrompt({
          productName,
          sku: accessorySku,
          sellingPoints,
          category: accessoryCategory,
          pack: accessoryPack,
          material: accessoryMaterial,
          scale: accessoryScale,
          sizeMm: accessorySizeMm,
          occlusion: accessoryOcclusion,
          crop: accessoryCrop,
          style: accessoryStyle,
          platform,
          market,
          aspectRatio,
          hasModel: accessoryHasModel,
          hasScene: accessoryHasScene,
        })
      : isDetailMode(mode.id)
        ? buildAplusTaskPrompt({
            plan: aplusPlan,
            marketplace: aplusMarketplace,
            category: aplusCategory,
            productName,
            sellingPoints,
            tone,
          })
      : [
          `任务：${mode.label}。${mode.prompt}`,
          isTryonMode(mode.id)
            ? ""
            : `商品名称：${productName.trim() || "根据商品图片准确识别"}。`,
          mode.id === "shoot"
            ? `商业任务：${SHOOT_USE_CASE_LABELS[shootUseCase] || "商品上架"}；目标渠道：${platform}；目标市场：${market}；商业目标：${SHOOT_GOAL_LABELS[shootGoal] || "促进转化"}。`
            : "",
          mode.id === "shoot" && shootAudience.trim()
            ? `目标人群：${shootAudience.trim()}。`
            : "",
          mode.id === "shoot" && shootSku.trim()
            ? `商品 SKU / 型号：${shootSku.trim()}。`
            : "",
          mode.id === "shoot" && shootProtectedElements.trim()
            ? `商品事实硬锁：以下元素绝对不能改变：${shootProtectedElements.trim()}。创意、场景和构图必须服从这些商品事实。`
            : "",
          isTryonMode(mode.id)
            ? ""
            : sellingPoints.trim()
              ? `商品卖点与要求：${sellingPoints.trim()}。`
              : "",
          fields.has("platform") ? `适配平台：${platform}。` : "",
          fields.has("market") ? `目标市场：${market}。` : "",
          fields.has("language") ? `页面文案语言：${language}。` : "",
          fields.has("apparel") ? `服装类型：${apparel}。` : "",
          mode.id === "tryon" && apparel === "上装"
            ? "按上装穿着生成，重点展示上半身版型，不要改成连衣裙或全身套装。"
            : mode.id === "tryon" && apparel === "下装"
              ? "按下装穿着生成，完整展示腰线到裤脚/裙摆的穿着关系，不要改成连衣裙。"
              : mode.id === "tryon" && apparel === "全身"
                ? "按全身造型生成，上下装作为完整穿着关系一起展示。"
                : "",
          isTryonMode(mode.id)
            ? "人物身份只以第 2 张模特参考图为准，不要根据人群标签另造人物。"
            : fields.has("model")
              ? `模特人群：${modelProfile}。`
              : "",
          mode.id === "tryon"
            ? buildTryonPhotographyPrompt(tryonLensOption)
            : fields.has("pose")
              ? `模特姿态：${pose}。`
              : "",
          isTryonMode(mode.id)
            ? buildTryonLightingPrompt(tryonLightOption)
            : "",
          isTryonMode(mode.id)
            ? tryonLightOption.id === "available"
              ? "环境、光线、材质与空间以第 3 张场景参考图为准；禁止把场景图中的人物或商品带入结果，也不要用文字场景名另造布景。"
              : "空间、色温和环境以第 3 张场景参考图为准；禁止把场景图中的人物或商品带入结果。主光仍来自该场景，只用所选光影手法塑形，不要换一套棚灯或改成另一个时段。"
            : fields.has("scene")
              ? `拍摄场景：${scene}。`
              : "",
          isTryonMode(mode.id) || mode.id === "shoot"
            ? `画面比例：${aspectRatio}。`
            : "",
          fields.has("tone") ? `视觉风格：${tone}。` : "",
          !isTryonMode(mode.id) && textStable
            ? "文字必须准确清晰，无法可靠生成时留白，不得输出乱码。"
            : "",
          mode.id === "clone" ? `复刻类型：${cloneType}。` : "",
          mode.id === "clone"
            ? cloneFidelity === "strict"
              ? "复刻程度：高度复刻。保持参考图的构图、主体占比、信息层级和光线结构，只替换商品与用户提供的文案。"
              : "复刻程度：参考风格。继承整体风格与结构，允许重构色彩、场景和次要元素。"
            : "",
          "严格保持参考商品造型、颜色、比例、Logo、包装文字和材质细节一致。",
        ]
          .filter(Boolean)
          .join("\n");
  const generationPlan = buildEcommerceGenerationPlan({
    modeId: mode.id,
    count: outputCount,
    selectedModules: selectedModuleDetails.map((item) => item.value),
    basePrompt: assembledPrompt,
    referenceCount: isHandheldMode(mode.id)
      ? Math.max(1, inputFiles.length)
      : isAccessoryMode(mode.id)
        ? Math.max(1, Math.min(3, inputFiles.length))
        : mode.id === "shoot"
          ? inputFiles.length
          : hidesCommerceSettings(mode.id)
            ? 3
            : inputFiles.length,
    referenceRoles: isHandheldMode(mode.id)
      ? handheldRoles
      : isAccessoryMode(mode.id)
        ? accessoryReferenceRoles(inputFiles.length)
        : null,
    identityLock: isHandheldMode(mode.id)
      ? buildHandheldIdentityLock({
          hasModel: handheldHasModel,
          hasHand: handheldHasHand,
          hasScene: handheldHasScene,
          hasLayout: handheldHasLayout,
        })
      : isAccessoryMode(mode.id)
        ? buildAccessoryIdentityLock({
            hasModel: accessoryHasModel,
            hasScene: accessoryHasScene,
          })
        : "",
    hasPersonIdentity: isHandheldMode(mode.id)
      ? handheldHasModel
      : isAccessoryMode(mode.id)
        ? accessoryHasModel
        : undefined,
    finalConstraints: isHandheldMode(mode.id)
      ? buildHandheldOutputConstraints({
          crop: handheldCrop,
          hand: handheldHand,
          hasModel: handheldHasModel,
          hasScene: handheldHasScene,
        })
      : "",
    shotBlueprints:
      mode.id === "shoot"
        ? shootBlueprints
        : mode.id === "listing" && structureMode === "custom"
          ? customBlueprints
          : mode.id === "tryon"
            ? tryonBlueprints
            : mode.id === "handheld"
              ? handheldBlueprints
              : mode.id === "accessory"
                ? accessoryBlueprints
                : mode.id === "detail"
                  ? aplusBlueprints
                  : null,
  });
  function handheldPromptForShot(shot, index) {
    const shotId = String(shot?.id || `shot-${index + 1}`);
    const basePrompt = String(generationPlan[index]?.prompt || "").trim();
    const edit = handheldPromptEdits[shotId];
    return {
      basePrompt,
      prompt:
        edit?.basePrompt === basePrompt && String(edit.prompt || "").trim()
          ? String(edit.prompt).trim()
          : basePrompt,
    };
  }
  const handheldCurrentRunning =
    handheldStarting ||
    jobs.tasks.some((task) => {
      if (task.kind !== "ui-design-ecommerce-handheld-generation") return false;
      if (
        !["queued", "running", "waiting_provider"].includes(
          String(task.status || "").toLowerCase(),
        )
      ) {
        return false;
      }
      const batchId = String(task.batchId || task.params?.batchId || "");
      return sessionBatchId && batchId === sessionBatchId;
    });
  const canGenerate =
    (mode.id === "tryon"
      ? Boolean(tryonSlots.garment && tryonSlots.model && tryonSlots.scene)
      : mode.id === "handheld"
        ? Boolean(handheldSlots.product) &&
          (!handheldCropNeedsPerson(handheldCrop) || handheldHasModel)
        : mode.id === "accessory"
          ? accessoryPresence.hasProduct
          : inputFiles.length >= minimumFiles) &&
    modelId &&
    (!fields.has("modules") || selectedModuleDetails.length) &&
    (mode.id !== "listing" ||
      structureMode !== "custom" ||
      customBlueprints.length >= 1) &&
    (mode.id !== "accessory" ||
      (accessoryPresence.hasProduct &&
        (accessoryScale !== "true" || accessoryHasSize))) &&
    (mode.id === "handheld"
      ? !handheldCurrentRunning
      : !jobs.running && !tryonStarting);
  const readiness =
    mode.id === "tryon" && !tryonSlots.garment
      ? "还需上传服装"
      : mode.id === "tryon" && !tryonSlots.model
        ? "还需选择模特"
        : mode.id === "tryon" && !tryonSlots.scene
          ? "还需选择场景"
          : mode.id === "accessory" && !accessoryPresence.hasProduct
        ? "还需上传饰品"
        : mode.id === "accessory" &&
            accessoryScale === "true" &&
            !accessoryHasSize
          ? "还需填写真实毫米尺寸"
          : mode.id === "handheld" && !handheldSlots.product
            ? "还需上传商品"
            : mode.id === "handheld" &&
                handheldCropNeedsPerson(handheldCrop) &&
                !handheldHasModel
              ? "还需选择模特"
              : inputFiles.length < minimumFiles
                ? `还需 ${minimumFiles - inputFiles.length} 张参考图`
                : mode.id === "listing" &&
                    structureMode === "custom" &&
                    customBlueprints.length < 1
                  ? "请至少分配 1 张套图"
                  : "配置完成，可以生成";
  const costLabel = `${Math.max(1, generationPlan.length) * unitPrice} 积分`;
  const detailedCostLabel =
    generationPlan.length > 1
      ? `预计 ${generationPlan.length * unitPrice} 积分（${unitPrice} 积分 / 张 × ${generationPlan.length}）`
      : `${unitPrice} 积分 / 张`;
  const mobileModes = [
    ...ECOMMERCE_RAIL_MODES,
    ...ECOMMERCE_MODES.filter(
      (item) =>
        !ECOMMERCE_RAIL_MODES.some((railMode) => railMode.id === item.id),
    ),
  ].filter((item) => availableModeIdSet.has(item.id));
  const railGroups = ECOMMERCE_RAIL_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => availableModeIdSet.has(item.id)),
  })).filter((group) => group.items.length > 0);
  const modeRows = jobs.outputRows.filter(
    (row) => outputModeId(row) === mode.id,
  );
  const latestTryonUrl = isTryonMode(mode.id) ? modeRows[0]?.url || "" : "";
  const latestTryonRatio = isTryonMode(mode.id)
    ? coerceRatioValue(modeRows[0]?.aspectRatio, OPTIONS.tryonRatio)
    : "";
  useEffect(() => {
    if (
      !isTryonMode(mode.id) ||
      jobs.historyLoading ||
      tryonRatioHydratedRef.current
    ) {
      return;
    }
    if (!latestTryonRatio) return;
    tryonRatioHydratedRef.current = true;
    setAspectRatio(latestTryonRatio);
  }, [mode.id, jobs.historyLoading, latestTryonUrl, latestTryonRatio]);
  useContentReveal({
    rootRef: pageRef,
    selector: ".workspace-library .asset-card",
    ready:
      (workspace === "history" && !jobs.historyLoading) ||
      (workspace === "assets" && !assets.loading),
    resetKey: workspace,
    contentKey:
      workspace === "history"
        ? modeRows.map((row) => row.url).join("|")
        : assets.items.map((asset) => asset.id).join("|"),
    stateAttribute: "data-commerce-library-motion-state",
  });
  const currentRow =
    modeRows.find((row) => row.url === activeUrl) || modeRows[0] || null;
  const tryonBriefKey = isTryonMode(mode.id) ? currentRow?.url || "" : "";
  const tryonBrief = tryonBriefKey ? tryonBriefs[tryonBriefKey] || "" : "";
  function updateCurrentTryonBrief(value) {
    if (!tryonBriefKey) return;
    const text = String(value || "").trim();
    setTryonBriefs((current) => {
      if (current[tryonBriefKey] === text) return current;
      const next = { ...current };
      if (text) next[tryonBriefKey] = text;
      else delete next[tryonBriefKey];
      return next;
    });
  }
  function clearTryonBrief(key, expected) {
    if (!key) return;
    setTryonBriefs((current) => {
      if (!(key in current) || current[key] !== expected) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }
  useEffect(() => {
    if (!isTryonMode(mode.id)) return;
    if (matchingRatio(aspectRatio, OPTIONS.tryonRatio)) return;
    const next =
      coerceRatioValue(currentRow?.aspectRatio, OPTIONS.tryonRatio) ||
      tryonInferredRatiosRef.current[currentRow?.url] ||
      coerceRatioValue(aspectRatio, OPTIONS.tryonRatio) ||
      "2:3";
    setAspectRatio(next);
  }, [mode.id, aspectRatio, currentRow?.url, currentRow?.aspectRatio]);
  const rowsByUrl = new Map(modeRows.map((row) => [row.url, row]));
  function rowVersion(row) {
    let version = 1;
    let cursor = row;
    const visited = new Set();
    while (
      cursor?.parentOutputUrl &&
      !visited.has(cursor.url) &&
      version < 20
    ) {
      visited.add(cursor.url);
      cursor = rowsByUrl.get(cursor.parentOutputUrl);
      version += 1;
    }
    return version;
  }
  const currentVersion = currentRow ? rowVersion(currentRow) : 1;
  const currentGroup = currentRow
    ? modeRows
        .filter((row) => row.groupId === currentRow.groupId)
        .sort((a, b) => a.index - b.index)
    : [];
  const activeTask = jobs.tasks.find(
    (task) =>
      outputModeId(task) === mode.id &&
      ["queued", "running", "waiting_provider"].includes(
        String(task.status || "").toLowerCase(),
      ),
  );
  const liveGroupId = String(
    sessionBatchId || activeTask?.batchId || currentRow?.groupId || "",
  );
  const liveGroupByIndex = new Map();
  for (const row of liveGroupId
    ? modeRows.filter((item) => item.groupId === liveGroupId)
    : currentGroup) {
    const index = Number(row.index || 0);
    if (!liveGroupByIndex.has(index)) liveGroupByIndex.set(index, row);
  }
  const liveGroup = Array.from(liveGroupByIndex.values()).sort(
    (a, b) => a.index - b.index,
  );
  const liveTasks = liveGroupId
    ? jobs.tasks.filter(
        (task) =>
          outputModeId(task) === mode.id &&
          String(task.batchId || task.params?.batchId || "") === liveGroupId,
      )
    : [];
  const liveActiveTask = liveTasks.find((task) =>
    ["queued", "running", "waiting_provider"].includes(
      String(task.status || "").toLowerCase(),
    ),
  );
  const handheldHistorySpec =
    currentRow?.task?.params?.handheldSpec &&
    typeof currentRow.task.params.handheldSpec === "object"
      ? currentRow.task.params.handheldSpec
      : null;
  const handheldSessionSpec = liveTasks.find(
    (task) =>
      task.params?.handheldSpec && typeof task.params.handheldSpec === "object",
  )?.params?.handheldSpec;
  const handheldDisplaySpec = handheldSessionSpec || handheldHistorySpec;
  const handheldHistoryShots = Array.isArray(handheldDisplaySpec?.shots)
    ? handheldDisplaySpec.shots
    : [];
  const handheldViewBlueprints =
    handheldHistoryShots.length > 1
      ? handheldHistoryShots
      : liveGroup.length > 1
        ? liveGroup.map((row, index) => ({
            id: `${row.groupId || "shot"}-${index}`,
            label: handheldBlueprints[index]?.label || `第 ${index + 1} 张`,
          }))
        : handheldBlueprints;
  const plannedCount = previews.length ? generationPlan.length : 0;
  const displayCount =
    liveActiveTask || sessionCount
      ? Math.max(
          sessionCount,
          Number(liveActiveTask?.batchSize || 0),
          liveGroup.length,
          liveTasks.length,
        )
      : currentRow
        ? Math.max(Number(currentRow.groupSize || 0), currentGroup.length)
        : plannedCount;
  const slots = Array.from({ length: displayCount }, (_, index) => {
    const row = liveGroup.find((item) => item.index === index) || null;
    const task =
      liveTasks.find((item) => Number(item.batchIndex) === index) || null;
    const failed =
      !row &&
      ["failed", "canceled", "cancelled"].includes(
        String(task?.status || "").toLowerCase(),
      );
    return {
      index,
      row,
      task,
      failed,
      error: failed ? task?.error || "这张生成失败" : "",
    };
  });
  const layoutClass =
    displayCount <= 1
      ? "is-single"
      : displayCount === 2
        ? "is-double"
        : displayCount <= 4
          ? "is-quad"
          : "is-multi";
  const completedCount = slots.filter((slot) => slot.row).length;
  const failedCount = slots.filter((slot) => slot.failed).length;
  const progressRatio = displayCount > 0 ? completedCount / displayCount : 0;
  const boardError = submitError || jobs.lastError || "";
  const tryonSessionBatchId = String(
    sessionBatchId || (isTryonMode(mode.id) ? activeTask?.batchId || "" : ""),
  );
  const tryonSessionTasks = tryonSessionBatchId
    ? jobs.tasks.filter(
        (task) =>
          String(task.batchId || task.params?.batchId || "") ===
          tryonSessionBatchId,
      )
    : [];
  const tryonTimingTask =
    tryonSessionTasks.find((task) =>
      ["queued", "running", "waiting_provider"].includes(task.status),
    ) ||
    activeTask ||
    currentRow?.task ||
    null;
  const tryonSessionFailed = tryonSessionTasks.filter((task) =>
    ["failed", "canceled", "cancelled"].includes(
      String(task.status || "").toLowerCase(),
    ),
  );
  const tryonRunFailed =
    hidesCommerceSettings(mode.id) &&
    !jobs.running &&
    !tryonStarting &&
    (Boolean(submitError) ||
      (tryonSessionTasks.length > 0 &&
        tryonSessionFailed.length === tryonSessionTasks.length));
  const tryonFailCancelled =
    tryonRunFailed &&
    !submitError &&
    tryonSessionFailed.length > 0 &&
    tryonSessionFailed.every((task) =>
      ["canceled", "cancelled"].includes(
        String(task.status || "").toLowerCase(),
      ),
    );
  const tryonFailMessage = String(
    submitError ||
      tryonSessionFailed.find((task) => task.error)?.error ||
      jobs.lastError ||
      (tryonFailCancelled ? "已停止本次生成" : "请检查网络或稍后重试"),
  ).trim();
  const tryonBusy = jobs.running || tryonStarting;
  const tryonResultUrl =
    tryonRunFailed && !activeUrl
      ? ""
      : tryonBusy
        ? modeRows.find((row) => row.groupId === tryonSessionBatchId)?.url || ""
        : currentRow?.url || "";
  const handheldSessionTaskCandidates = sessionBatchId
    ? jobs.tasks.filter(
        (task) =>
          task.kind === "ui-design-ecommerce-handheld-generation" &&
          String(task.batchId || task.params?.batchId || "") === sessionBatchId,
      )
    : [];
  const handheldTaskKeys = new Set();
  const handheldSessionTasks = handheldSessionTaskCandidates.filter((task) => {
    const key = String(
      task.params?.handheldItemId || `index:${Number(task.batchIndex) || 0}`,
    );
    if (handheldTaskKeys.has(key)) return false;
    handheldTaskKeys.add(key);
    return true;
  });
  const handheldSessionFailed = handheldSessionTasks.filter((task) =>
    ["failed", "canceled", "cancelled"].includes(
      String(task.status || "").toLowerCase(),
    ),
  );
  const handheldBusy =
    handheldStarting ||
    Object.values(handheldRetryingByIndex).some(Boolean) ||
    handheldSessionTasks.some((task) =>
      ["queued", "running", "waiting_provider"].includes(task.status),
    );
  const handheldSessionOutputs = modeRows.filter(
    (row) => row.groupId === sessionBatchId && row.url,
  );
  const handheldHasOutput = Boolean(
    firstReturnedOutputUrl(handheldSessionOutputs),
  );
  const handheldRunFailed =
    !handheldBusy &&
    !handheldHasOutput &&
    (Boolean(submitError) ||
      (handheldSessionTasks.length > 0 &&
        handheldSessionFailed.length === handheldSessionTasks.length));
  const handheldFailCancelled =
    handheldRunFailed &&
    !submitError &&
    handheldSessionFailed.length > 0 &&
    handheldSessionFailed.every((task) =>
      ["canceled", "cancelled"].includes(String(task.status).toLowerCase()),
    );
  const handheldFailMessage = String(
    submitError ||
      handheldSessionFailed.find((task) => task.error)?.error ||
      jobs.lastError ||
      (handheldFailCancelled ? "已停止本次生成" : "请检查网络或稍后重试"),
  ).trim();
  const handheldFirstReturnedUrl = firstReturnedOutputUrl(
    handheldSessionOutputs,
  );
  const handheldResultUrl = handheldRunFailed
    ? ""
    : handheldBusy
      ? activeUrl || handheldFirstReturnedUrl
      : currentRow?.url || "";
  useEffect(() => {
    if (mode.id !== "handheld" || !handheldBusy || activeUrl) return;
    if (!handheldFirstReturnedUrl) return;
    setActiveUrl(handheldFirstReturnedUrl);
  }, [mode.id, handheldBusy, activeUrl, handheldFirstReturnedUrl]);
  const currentHandheldItem = currentRow?.task?.params?.handheldItemId
    ? {
        task: currentRow.task,
        itemId: String(currentRow.task.params.handheldItemId),
      }
    : null;
  const showResultBoard =
    Boolean(activeTask) ||
    tryonStarting ||
    handheldStarting ||
    Boolean(currentRow) ||
    sessionCount > 0 ||
    Boolean(boardError) ||
    (!hidesCommerceSettings(mode.id) && previews.length > 0);
  const handheldSessionResultRatio = modeRows.find(
    (row) => row.groupId === sessionBatchId,
  )?.aspectRatio;
  const shotRatio = String(
    mode.id === "handheld"
      ? handheldBusy
        ? handheldSessionResultRatio || aspectRatio || "4:5"
        : currentRow?.aspectRatio ||
          handheldHistorySpec?.aspectRatio ||
          aspectRatio ||
          "4:5"
      : isTryonMode(mode.id)
        ? aspectRatio || latestTryonRatio || "2:3"
        : aspectRatio || "2:3",
  );
  const [shotRatioW, shotRatioH] = shotRatio.split(":").map(Number);
  const shotRatioStyle = {
    "--commerce-shot-ratio": `${shotRatioW > 0 ? shotRatioW : 2} / ${shotRatioH > 0 ? shotRatioH : 3}`,
    "--ratio-w": shotRatioW > 0 ? shotRatioW : 2,
    "--ratio-h": shotRatioH > 0 ? shotRatioH : 3,
  };

  function setMode(next) {
    if (
      next.id !== mode.id &&
      (taskLaunchPendingRef.current ||
        jobs.submitting ||
        tryonStarting ||
        handheldStarting)
    ) {
      return;
    }
    setParams({ tool: next.id }, { replace: true });
  }
  function showTryonUploadNotice(message) {
    setTryonUploadNoticeState(message);
    window.clearTimeout(tryonNoticeTimer.current);
    if (message) {
      tryonNoticeTimer.current = window.setTimeout(
        () => setTryonUploadNoticeState(""),
        4200,
      );
    }
  }
  function showHandheldUploadNotice(message) {
    setHandheldUploadNoticeState(message);
  }
  function appendEcommerceFiles(list) {
    const next = Array.from(list || []).filter(Boolean);
    if (!next.length) return;
    setSelectedProduct(null);
    setFiles((current) => [...current, ...next]);
    setPreviews((current) => [
      ...current,
      ...next.map((file) => ({
        file,
        url: URL.createObjectURL(file),
        local: true,
      })),
    ]);
  }
  function commitTryonSlot(role, file) {
    const url = URL.createObjectURL(file);
    setTryonSlots((current) => ({
      ...current,
      [role]: {
        file,
        url,
        local: true,
        managed: "slot",
        ...(role === "model" || role === "scene" || role === "garment"
          ? { source: "upload" }
          : {}),
      },
    }));
    if (role === "model") setModelProfile("不限定人群");
    if (role === "scene") setScene("自定义场景");
    setSelectedProduct(null);
    void prefetchSlotUpload(role, file);
  }
  function commitHandheldSlot(role, file) {
    handheldClearedRef.current[role] = false;
    const url = URL.createObjectURL(file);
    setHandheldSlots((current) => ({
      ...current,
      [role]: {
        file,
        url,
        local: true,
        managed: "slot",
        source: "upload",
      },
    }));
    if (role === "model") setModelProfile("不限定人群");
    if (role === "scene") setScene("自定义场景");
    setSelectedProduct(null);
    if (role === "product") setHandheldAnnotations([]);
    void prefetchSlotUpload(role, file, setHandheldSlots);
  }
  async function prepareUploadFile(file, signal) {
    if (Number(file?.size || 0) <= ECOMMERCE_IMAGE_TARGET_BYTES) return file;
    return compressEcommerceUploadFile(file, {
      targetBytes: ECOMMERCE_IMAGE_TARGET_BYTES,
      quality: 50,
      signal,
    });
  }
  async function prefetchSlotUpload(role, file, setSlots = setTryonSlots) {
    if (!(file instanceof Blob) || !file.size) return "";
    const cached = normalizeTaskImageKey(file.uploadKey || "");
    if (isReusableTaskImageKey(cached)) return cached;
    const cacheKey = `${role}:${file.name}:${file.size}`;
    const inflight = uploadPrefetchRef.current.get(cacheKey);
    if (inflight) {
      const key = await inflight;
      attachEcommerceUploadKey(file, key);
      return key;
    }
    const pending = (async () => {
      const ready = await prepareUploadFile(file);
      const uploaded = await uploadFile(ready);
      const key = normalizeTaskImageKey(uploaded?.key || uploaded?.url || "");
      if (!isReusableTaskImageKey(key)) {
        throw new Error("图片上传未返回有效文件，请重试");
      }
      attachEcommerceUploadKey(file, key);
      setSlots((current) => {
        if (current[role]?.file !== file) return current;
        return { ...current, [role]: { ...current[role], uploadKey: key } };
      });
      return key;
    })();
    uploadPrefetchRef.current.set(cacheKey, pending);
    try {
      return await pending;
    } catch {
      uploadPrefetchRef.current.delete(cacheKey);
      return "";
    }
  }
  function addFiles(list) {
    if (mode.id === "tryon") {
      void setTryonSlot("garment", list);
      return;
    }
    if (mode.id === "handheld") {
      void setHandheldSlot("product", list);
      return;
    }
    if (mode.id === "accessory") {
      const role =
        accessoryUploadRoleRef.current ||
        nextEmptyAccessorySlot(accessorySlots);
      accessoryUploadRoleRef.current = "product";
      void setAccessorySlot(role, list);
      return;
    }
    const incoming = Array.from(list || []);
    const prepared = prepareEcommerceInputFiles(files, incoming, {
      maxBytes: ECOMMERCE_IMAGE_MAX_BYTES,
      skipSizeCap: true,
    });
    if (!prepared.next.length) return;
    void (async () => {
      compressControllerRef.current?.abort();
      const controller = new AbortController();
      compressControllerRef.current = controller;
      try {
        const next = [];
        for (const file of prepared.next) {
          next.push(await prepareUploadFile(file, controller.signal));
        }
        if (controller.signal.aborted) return;
        appendEcommerceFiles(next);
      } catch (error) {
        if (error?.name === "AbortError") return;
        showTryonUploadNotice(error?.message || "压缩失败，请换一张更小的图片");
      }
    })();
  }
  async function setAccessorySlot(role, list) {
    const slotRole = ["product", "model", "scene"].includes(role)
      ? role
      : "product";
    const incoming = Array.from(list || []);
    const prepared = prepareEcommerceInputFiles([], incoming, {
      limit: 1,
      maxBytes: ECOMMERCE_IMAGE_MAX_BYTES,
      skipSizeCap: true,
    });
    if (!prepared.next.length) return;
    void (async () => {
      compressControllerRef.current?.abort();
      const controller = new AbortController();
      compressControllerRef.current = controller;
      try {
        const file = await prepareUploadFile(
          prepared.next[0],
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(file);
        setAccessorySlots((current) => {
          const previous = current[slotRole];
          if (previous?.local && previous.url)
            URL.revokeObjectURL(previous.url);
          return {
            ...current,
            [slotRole]: { file, url, local: true },
          };
        });
        setSelectedProduct(null);
        void prefetchSlotUpload(slotRole, file, setAccessorySlots);
      } catch (error) {
        if (error?.name === "AbortError") return;
        showAccessoryNotice(error?.message || "压缩失败，请换一张更小的图片");
      }
    })();
  }
  function clearAccessorySlot(role) {
    setAccessorySlots((current) => {
      const previous = current[role];
      if (previous?.local && previous.url) URL.revokeObjectURL(previous.url);
      return { ...current, [role]: null };
    });
    setSelectedProduct(null);
  }
  function requestAccessoryUpload(role) {
    accessoryUploadRoleRef.current =
      role || nextEmptyAccessorySlot(accessorySlots);
    fileInput.current?.click();
  }
  async function setTryonSlot(role, list) {
    const incoming = Array.from(list || []);
    const prepared = prepareEcommerceInputFiles([], incoming, {
      limit: 1,
      maxBytes: ECOMMERCE_IMAGE_MAX_BYTES,
      skipSizeCap: true,
    });
    let file = prepared.next[0];
    if (!file && incoming[0]) {
      file = await coerceEcommerceImageFile(incoming[0]);
    }
    if (!file) {
      showTryonUploadNotice(
        ecommerceUploadRejectMessage(
          prepared,
          incoming[0],
          ECOMMERCE_IMAGE_MAX_BYTES,
        ),
      );
      return;
    }
    showTryonUploadNotice("");
    compressControllerRef.current?.abort();
    const controller = new AbortController();
    compressControllerRef.current = controller;
    try {
      const next = await prepareUploadFile(file, controller.signal);
      if (controller.signal.aborted) return;
      commitTryonSlot(role, next);
    } catch (error) {
      if (error?.name === "AbortError") return;
      showTryonUploadNotice(error?.message || "压缩失败，请换一张更小的图片");
    }
  }
  async function setHandheldSlot(role, list) {
    const incoming = Array.from(list || []);
    const prepared = prepareEcommerceInputFiles([], incoming, {
      limit: 1,
      maxBytes: ECOMMERCE_IMAGE_MAX_BYTES,
      skipSizeCap: true,
    });
    let file = prepared.next[0];
    if (!file && incoming[0]) {
      file = await coerceEcommerceImageFile(incoming[0]);
    }
    if (!file) {
      showHandheldUploadNotice(
        ecommerceUploadRejectMessage(
          prepared,
          incoming[0],
          ECOMMERCE_IMAGE_MAX_BYTES,
        ),
      );
      return;
    }
    showHandheldUploadNotice("");
    compressControllerRef.current?.abort();
    const controller = new AbortController();
    compressControllerRef.current = controller;
    try {
      const next = await prepareUploadFile(file, controller.signal);
      if (controller.signal.aborted) return;
      commitHandheldSlot(role, next);
    } catch (error) {
      if (error?.name === "AbortError") return;
      showHandheldUploadNotice(
        error?.message || "压缩失败，请换一张更小的图片",
      );
    }
  }
  function clearHandheldSlot(role) {
    handheldClearedRef.current[role] = true;
    setHandheldSlots((current) => {
      const currentSlot = current[role];
      if (currentSlot?.local && currentSlot.url) {
        URL.revokeObjectURL(currentSlot.url);
      }
      return { ...current, [role]: null };
    });
  }
  function clearTryonSlot(role) {
    setTryonSlots((current) => ({ ...current, [role]: null }));
    if (role === "scene") {
      const option =
        catalogOptionById(tryonSceneCatalog, featuredTryonSceneId) ||
        tryonSceneCatalog[0];
      if (option) setScene(option.label);
    }
    setSelectedProduct(null);
  }
  async function applyBuiltinTryonModel(option) {
    if (tryonModelBusy) return;
    const setSlots = setTryonSlots;
    setFeaturedTryonModelId(option.id);
    setModelProfile(option.label);
    setTryonModelBusy(true);
    try {
      const file = await fileFromCatalogImage(
        option.image,
        `tryon-model-${option.id}.jpg`,
      );
      setSlots((current) => ({
        ...current,
        model: builtinCatalogSlot(file, option),
      }));
      void prefetchSlotUpload("model", file, setSlots);
    } catch {
      setSlots((current) => ({ ...current, model: null }));
    } finally {
      setTryonModelBusy(false);
    }
  }
  async function applyBuiltinHandheldModel(option) {
    if (handheldModelBusy) return;
    handheldClearedRef.current.model = false;
    setFeaturedHandheldModelId(option.id);
    setHandheldModelBusy(true);
    try {
      const file = await fileFromCatalogImage(
        option.image,
        `handheld-model-${option.id}.jpg`,
      );
      setHandheldSlots((current) => ({
        ...current,
        model: builtinCatalogSlot(file, option),
      }));
      void prefetchSlotUpload("model", file, setHandheldSlots);
    } catch {
      setHandheldSlots((current) => ({ ...current, model: null }));
    } finally {
      setHandheldModelBusy(false);
    }
  }
  async function applyBuiltinHandheldHand(option) {
    if (handheldModelBusy) return;
    handheldClearedRef.current.model = false;
    setFeaturedHandheldHandId(option.id);
    setHandheldModelBusy(true);
    try {
      const file = await fileFromCatalogImage(
        option.image,
        `handheld-hand-${option.id}.jpg`,
      );
      setHandheldSlots((current) => ({
        ...current,
        model: builtinCatalogSlot(file, option),
      }));
      void prefetchSlotUpload("model", file, setHandheldSlots);
    } catch {
      setHandheldSlots((current) => ({ ...current, model: null }));
    } finally {
      setHandheldModelBusy(false);
    }
  }
  async function applyBuiltinTryonScene(option) {
    if (tryonSceneBusy) return;
    const setSlots = setTryonSlots;
    setFeaturedTryonSceneId(option.id);
    setScene(option.label);
    setTryonSceneBusy(true);
    try {
      const file = await fileFromCatalogImage(
        option.image,
        `tryon-scene-${option.id}.jpg`,
      );
      setSlots((current) => ({
        ...current,
        scene: builtinCatalogSlot(file, option),
      }));
      void prefetchSlotUpload("scene", file, setSlots);
    } catch {
      setSlots((current) => ({ ...current, scene: null }));
    } finally {
      setTryonSceneBusy(false);
    }
  }
  async function applyBuiltinHandheldScene(option) {
    if (handheldSceneBusy) return;
    handheldClearedRef.current.scene = false;
    setFeaturedHandheldSceneId(option.id);
    setHandheldSceneBusy(true);
    try {
      const file = await fileFromCatalogImage(
        option.image,
        `handheld-scene-${option.id}.jpg`,
      );
      setHandheldSlots((current) => ({
        ...current,
        scene: builtinCatalogSlot(file, option),
      }));
      void prefetchSlotUpload("scene", file, setHandheldSlots);
    } catch {
      setHandheldSlots((current) => ({ ...current, scene: null }));
    } finally {
      setHandheldSceneBusy(false);
    }
  }
  async function applyBuiltinTryonGarment(option) {
    if (tryonGarmentBusy) return;
    setFeaturedTryonGarmentId(option.id);
    if (OPTIONS.tryonApparel.includes(option.apparel)) {
      setApparel(option.apparel);
    }
    setTryonGarmentBusy(true);
    try {
      const file = await fileFromCatalogImage(
        option.image,
        `tryon-garment-${option.id}.jpg`,
      );
      setTryonSlots((current) => ({
        ...current,
        garment: builtinCatalogSlot(file, option),
      }));
      void prefetchSlotUpload("garment", file);
    } catch {
      setTryonSlots((current) => ({ ...current, garment: null }));
    } finally {
      setTryonGarmentBusy(false);
    }
  }
  function removeFile(index) {
    setFiles((current) => current.filter((_, at) => at !== index));
    setPreviews((current) => current.filter((_, at) => at !== index));
    setSelectedProduct(null);
  }
  function toggleShootShot(shotId) {
    setShootShotIds((current) => {
      if (current.includes(shotId)) {
        return current.length > 1
          ? current.filter((id) => id !== shotId)
          : current;
      }
      return current.length < 4 ? [...current, shotId] : current;
    });
  }
  function moveShootShot(shotId, offset) {
    setShootShotIds((current) => {
      const from = current.indexOf(shotId);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }
  function referenceLabel(index) {
    return mode.referenceLabels?.[index] || `角度 ${index + 1}`;
  }
  function openWorkspace(next) {
    if (
      next !== "result" &&
      requestAuth({
        featureLabel:
          next === "operations"
            ? text.operations
            : next === "history"
              ? "AI 电商历史"
              : next === "assets"
                ? "我的资产"
                : "电商商品库",
      })
    )
      return;
    setWorkspace(next);
    setPane("canvas");
    if (next === "assets" && !assets.loading && !assets.hydrated) {
      setAssets((value) => ({ ...value, loading: true }));
      Promise.all([
        listUserAssets({ limit: 24, groupId: "all" }),
        listUserAssetGroups(),
      ])
        .then(([items, groups]) =>
          setAssets({
            loading: false,
            hydrated: true,
            items: items.items,
            groups: groups.items,
            error: "",
          }),
        )
        .catch((error) =>
          setAssets({
            loading: false,
            hydrated: false,
            items: [],
            groups: [],
            error: error.message || "素材库读取失败",
          }),
        );
    }
  }
  async function applyProduct(product) {
    setSelectedProduct(product);
    setProductName(product.title || "");
    setSellingPoints(product.sellingPoints || "");
    const productAssets = (product.assets || []).slice(0, 6);
    const nextFiles = productAssets.map((asset, index) => {
      const file = new File([new Blob()], `product-${index + 1}.png`, {
        type: "image/png",
      });
      Object.defineProperty(file, "sourceUrl", { value: asset.url });
      return file;
    });
    setFiles(nextFiles);
    setPreviews(
      productAssets.map((asset, index) => ({
        file: nextFiles[index],
        url: asset.thumbnailUrl || asset.url,
        local: false,
      })),
    );
    if (mode.id === "detail") {
      if (product.sku) setAplusAsin(String(product.sku).toUpperCase());
      if (product.category) {
        const nextCategory = aplusCategoryById(product.category);
        if (nextCategory?.id) setAplusCategoryId(nextCategory.id);
      }
      setAplusLivePlan(null);
    }
    if (mode.id === "tryon") {
      setTryonSlots({
        garment: productAssets[0]
          ? {
              file: nextFiles[0],
              url: productAssets[0].thumbnailUrl || productAssets[0].url,
              local: false,
              managed: "slot",
            }
          : null,
        model: productAssets[1]
          ? {
              file: nextFiles[1],
              url: productAssets[1].thumbnailUrl || productAssets[1].url,
              local: false,
              managed: "slot",
              source: "upload",
            }
          : null,
        scene: null,
      });
    }
    if (mode.id === "handheld") {
      setHandheldSku(product.sku || "");
      setHandheldSlots({
        product: productAssets[0]
          ? {
              file: nextFiles[0],
              url: productAssets[0].thumbnailUrl || productAssets[0].url,
              local: false,
              managed: "slot",
              source: "upload",
            }
          : null,
        model: handheldSlots.model,
        scene: handheldSlots.scene,
        layout: handheldSlots.layout,
      });
    }
    if (mode.id === "accessory") {
      setAccessorySku(product.sku || "");
      setAccessorySlots((current) => {
        if (current.product?.local && current.product.url) {
          URL.revokeObjectURL(current.product.url);
        }
        if (current.model?.local && current.model.url) {
          URL.revokeObjectURL(current.model.url);
        }
        return {
          product: productAssets[0]
            ? {
                file: nextFiles[0],
                url: productAssets[0].thumbnailUrl || productAssets[0].url,
                local: false,
              }
            : null,
          model: productAssets[1]
            ? {
                file: nextFiles[1],
                url: productAssets[1].thumbnailUrl || productAssets[1].url,
                local: false,
              }
            : null,
          scene: current.scene,
        };
      });
    }
    setWorkspace("result");
    setPane(hidesCommerceSettings(mode.id) ? "canvas" : "settings");
  }
  async function uploadAplusInputKeys(files = []) {
    const keys = [];
    for (const file of files) {
      const cached = normalizeTaskImageKey(file?.uploadKey || "");
      if (isReusableTaskImageKey(cached)) {
        keys.push(cached);
        continue;
      }
      const source = String(file?.sourceUrl || "").trim();
      let blob = file;
      if (!(file instanceof Blob) || !file.size) {
        if (!source) continue;
        blob = await fetchAuthenticatedMediaBlob(source, { cache: "no-store" });
      }
      const ready = await prepareUploadFile(blob);
      const uploaded = await uploadFile(ready);
      const key = normalizeTaskImageKey(uploaded?.key || uploaded?.url || "");
      if (!isReusableTaskImageKey(key)) continue;
      attachEcommerceUploadKey(file, key);
      keys.push(key);
    }
    return keys;
  }
  async function runAplusPlanner(files = []) {
    const keys = await uploadAplusInputKeys(files);
    if (!keys.length) throw new Error("请先上传商品参考图");
    const planned = await generateAplusPlan({
      inputKeys: keys,
      asin: aplusAsin,
      competitorAsin: aplusCompetitorAsin,
      categoryId: aplusCategoryId,
      marketplaceId: aplusMarketplaceId,
      language,
      tier: aplusTier,
      productName,
      sellingPoints,
      selectedModules,
      disclosure: aplusDisclosure,
    });
    if (!planned?.modules?.length) {
      throw new Error("AI 未能给出有效的 A+ 模块结构");
    }
    setAplusLivePlan(planned);
    return planned;
  }
  async function analyzeAplus() {
    if (requestAuth({ featureLabel: "A+ 分析" })) return;
    if (!inputFiles.length || aplusPlanning || jobs.running) return;
    setAplusAnalyzeError("");
    setAplusPlanning(true);
    try {
      await runAplusPlanner(inputFiles);
    } catch (error) {
      setAplusAnalyzeError(error?.message || "AI 分析失败，请重试");
    } finally {
      setAplusPlanning(false);
    }
  }
  async function generateBrief() {
    if (requestAuth({ featureLabel: "AI 商品识别" })) return;
    if (!inputFiles.length) return;
    setBrief((value) => ({ ...value, open: true, busy: true, error: "" }));
    try {
      const inputKeys = await Promise.all(
        inputFiles.slice(0, 4).map(async (file) => {
          const match = String(file.sourceUrl || "").match(
            /\/api\/v1\/files\/(.+?)(?:\?|$)/,
          );
          return match
            ? decodeURIComponent(match[1])
            : (await uploadFile(await prepareUploadFile(file))).key;
        }),
      );
      const result = await generateCommerceProductBrief({
        inputKeys,
        platform,
        market,
        language,
        previousProductName: brief.attempt ? brief.name : "",
        previousSellingPoints: brief.attempt ? brief.points : "",
      });
      setBrief((value) => ({
        ...value,
        busy: false,
        name: result.productName || "",
        points: result.sellingPoints || "",
        attempt: value.attempt + 1,
      }));
    } catch (error) {
      setBrief((value) => ({
        ...value,
        busy: false,
        error: error.message || "AI 商品识别失败，请重试",
      }));
    }
  }
  function beginTaskLaunch() {
    if (taskLaunchPendingRef.current) return false;
    taskLaunchPendingRef.current = true;
    setTaskLaunchPending(true);
    return true;
  }
  function finishTaskLaunch() {
    taskLaunchPendingRef.current = false;
    setTaskLaunchPending(false);
  }
  async function requestCostThenRun(
    run,
    count,
    quotedUnit = unitPrice,
    lockHeld = false,
  ) {
    if (!lockHeld && !beginTaskLaunch()) return;
    if (requestAuth({ featureLabel: "AI 电商" })) {
      finishTaskLaunch();
      return;
    }
    if (auth.user?.requireCostConfirm === false) {
      try {
        await run();
      } finally {
        finishTaskLaunch();
      }
      return;
    }
    let available = null;
    try {
      const wallet = await getWallet();
      const value = Number(
        wallet?.availableCents ??
          wallet?.balanceCents ??
          wallet?.availablePoints,
      );
      if (Number.isFinite(value)) available = Math.max(0, value);
    } catch {
      /* the task service remains authoritative */
    }
    const shotCount = Math.max(1, Number(count) || 1);
    pendingCostRunRef.current = async () => {
      try {
        await run();
      } finally {
        finishTaskLaunch();
      }
    };
    setCostConfirm({
      unit: quotedUnit,
      count: shotCount,
      total: shotCount * quotedUnit,
      available,
    });
  }
  async function confirmCost({ skipEveryTime = false } = {}) {
    const run = pendingCostRunRef.current;
    pendingCostRunRef.current = null;
    setCostConfirm(null);
    if (skipEveryTime) {
      try {
        const result = await updateProfile({ requireCostConfirm: false });
        auth.setUser((current) => ({
          ...(current || {}),
          ...(result?.user || { requireCostConfirm: false }),
        }));
      } catch {
        /* Preference persistence must not block the confirmed generation. */
      }
    }
    if (run) await run();
    else finishTaskLaunch();
  }
  async function generate() {
    if (requestAuth({ featureLabel: "AI 电商" })) return;
    if (!canGenerate) return;
    if (!beginTaskLaunch()) return;
    if (mode.id === "handheld") {
      try {
        const reservedRoles =
          (handheldSlots.model?.file ? 1 : 0) +
          (handheldSlots.scene?.file ? 1 : 0) +
          (handheldHasLayout ? 1 : 0);
        const productInputs = selectedProduct?.id
          ? Math.min(Math.max(1, files.length), 6 - reservedRoles)
          : 1;
        const quote = await quoteHandheldJob({
          modelId,
          aspectRatio,
          inputCount: productInputs + reservedRoles,
          itemCount: generationPlan.length,
        });
        const quotedUnit = Number(quote?.unitPriceCents);
        if (Number.isFinite(quotedUnit)) setUnitPrice(quotedUnit);
        await requestCostThenRun(
          executeGenerate,
          generationPlan.length,
          Number.isFinite(quotedUnit) ? quotedUnit : unitPrice,
          true,
        );
        return;
      } catch (error) {
        finishTaskLaunch();
        setSubmitError(error?.message || "手持商品报价失败，请重试");
        return;
      }
    }
    let quotedUnit = unitPrice;
    try {
      const quote = await jobs.quoteBatch({
        modelId,
        items: generationPlan.map((item) => ({
          ...item,
          kindVariant: mode.id,
          aspectRatio: item.aspectRatio || aspectRatio,
        })),
      });
      const value = Number(quote?.unitPriceCents);
      if (Number.isFinite(value)) {
        quotedUnit = Math.max(0, value);
        setUnitPrice(quotedUnit);
      }
    } catch (error) {
      finishTaskLaunch();
      setSubmitError(error?.message || "任务价格读取失败，请刷新后重试");
      return;
    }
    if (mode.id === "tryon" && currentRow && tryonBrief.trim()) {
      const sourceRow = currentRow;
      const brief = tryonBrief.trim();
      await requestCostThenRun(
        () =>
          executeTryonBriefRevision({
            sourceRow,
            brief,
            briefKey: sourceRow.url,
            expectedUnitPriceCents: quotedUnit,
          }),
        1,
        quotedUnit,
        true,
      );
      return;
    }
    await requestCostThenRun(
      () => executeGenerate({ expectedUnitPriceCents: quotedUnit }),
      generationPlan.length,
      quotedUnit,
      true,
    );
  }
  async function fileFromCatalogImage(url, name) {
    const imageUrl =
      typeof url === "string"
        ? url
        : String(url?.src || url?.default || url?.href || "").trim();
    if (!imageUrl) throw new Error("内置参考图读取失败");
    let buffer;
    if (imageUrl.includes("/api/")) {
      const blob = await fetchAuthenticatedMediaBlob(imageUrl, {
        cache: "no-store",
      });
      buffer = await blob.arrayBuffer();
    } else {
      const response = await fetch(imageUrl, { cache: "no-store" });
      if (!response.ok) throw new Error("内置参考图读取失败");
      buffer = await response.arrayBuffer();
    }
    const sniffed = sniffEcommerceImageBytes(new Uint8Array(buffer));
    if (!buffer.byteLength || !sniffed) {
      throw new Error("内置参考图格式无效，请重新选择模特或场景");
    }
    const file = new File([buffer], name, { type: sniffed.type });
    attachEcommerceUploadKey(file, imageUrl);
    return file;
  }
  async function resolveTryonInputFiles() {
    if (!tryonSlots.garment?.file) {
      throw new Error("请先上传服装");
    }
    const next = { ...tryonSlots };
    if (!next.model?.file) {
      if (!featuredTryonModel?.image) {
        throw new Error("请先选择模特");
      }
      const file = await fileFromCatalogImage(
        featuredTryonModel.image,
        `tryon-model-${featuredTryonModel.id}.jpg`,
      );
      next.model = builtinCatalogSlot(file, featuredTryonModel);
    }
    if (!next.scene?.file) {
      if (!featuredTryonScene?.image) {
        throw new Error("请先选择场景");
      }
      const file = await fileFromCatalogImage(
        featuredTryonScene.image,
        `tryon-scene-${featuredTryonScene.id}.jpg`,
      );
      next.scene = builtinCatalogSlot(file, featuredTryonScene);
    }
    const files = [next.garment.file, next.model.file, next.scene.file].filter(
      (file) => file instanceof Blob && file.size > 0,
    );
    if (files.length < 3) {
      throw new Error("模特、衣服或场景未准备好，请重新选择后再生成");
    }
    attachEcommerceUploadKey(files[0], next.garment.uploadKey);
    attachEcommerceUploadKey(files[1], next.model.uploadKey);
    attachEcommerceUploadKey(files[2], next.scene.uploadKey);
    await Promise.all([
      prefetchSlotUpload("garment", files[0]),
      prefetchSlotUpload("model", files[1]),
      prefetchSlotUpload("scene", files[2]),
    ]);
    if (next.model !== tryonSlots.model || next.scene !== tryonSlots.scene) {
      setTryonSlots(next);
    }
    return files;
  }
  async function resolveHandheldInputFiles() {
    if (!handheldSlots.product?.file) {
      throw new Error("请先上传商品图");
    }
    const includeModel = Boolean(handheldSlots.model?.file);
    const next = { ...handheldSlots };
    const files = [
      next.product.file,
      ...(includeModel && next.model?.file ? [next.model.file] : []),
      ...(next.scene?.file ? [next.scene.file] : []),
      ...(next.layout?.file ? [next.layout.file] : []),
    ].filter((file) => file instanceof Blob && file.size > 0);
    if (!files.length) {
      throw new Error("商品未准备好，请重新上传后再生成");
    }
    attachEcommerceUploadKey(files[0], next.product.uploadKey);
    if (includeModel && next.model?.file) {
      attachEcommerceUploadKey(next.model.file, next.model.uploadKey);
    }
    if (next.scene?.file) {
      attachEcommerceUploadKey(next.scene.file, next.scene.uploadKey);
    }
    if (next.layout?.file) {
      attachEcommerceUploadKey(next.layout.file, next.layout.uploadKey);
    }
    await Promise.all([
      prefetchSlotUpload("product", next.product.file, setHandheldSlots),
      includeModel && next.model?.file
        ? prefetchSlotUpload("model", next.model.file, setHandheldSlots)
        : Promise.resolve(""),
      next.scene?.file
        ? prefetchSlotUpload("scene", next.scene.file, setHandheldSlots)
        : Promise.resolve(""),
      next.layout?.file
        ? prefetchSlotUpload("layout", next.layout.file, setHandheldSlots)
        : Promise.resolve(""),
    ]);
    return { files, slots: next, includeModel };
  }
  async function resolveLiveStageInputFiles() {
    if (mode.id === "handheld") return resolveHandheldInputFiles();
    if (mode.id === "tryon") return resolveTryonInputFiles();
    return inputFiles;
  }
  async function prepareHandheldBatchRequest(shots) {
    const resolved = await resolveHandheldInputFiles();
    const extraRoles = [
      ...(resolved.includeModel && resolved.slots.model?.file
        ? [{ role: "hand_or_model", file: resolved.slots.model.file }]
        : []),
      ...(resolved.slots.scene?.file
        ? [{ role: "scene", file: resolved.slots.scene.file }]
        : []),
      ...(resolved.slots.layout?.file
        ? [{ role: "layout", file: resolved.slots.layout.file }]
        : []),
    ];
    const productCandidates = selectedProduct?.id
      ? files.filter((file) => file instanceof Blob)
      : [resolved.slots.product.file];
    const productRoleNames = [
      "product_front",
      "product_side",
      "product_back",
      "logo_detail",
      "colorway",
      "colorway",
    ];
    const productRoles = productCandidates
      .slice(0, Math.max(1, 6 - extraRoles.length))
      .map((file, index) => ({
        role: productRoleNames[index] || "logo_detail",
        file,
      }));
    const handheldSpec = {
      crop: handheldCrop,
      pack: handheldPack,
      platform: handheldPlatform,
      aspectRatio,
      ...(handheldLanguage ? { language: handheldLanguage } : {}),
      ...(normalizeHandheldAnnotations(handheldAnnotations).length
        ? {
            annotations: normalizeHandheldAnnotations(handheldAnnotations),
          }
        : {}),
      ...(handheldPose ? { pose: handheldPose } : {}),
      ...(handheldHand ? { hand: handheldHand } : {}),
      ...(handheldPackState ? { packState: handheldPackState } : {}),
      ...(handheldCategory ? { category: handheldCategory } : {}),
      ...(handheldLens ? { lens: handheldLens } : {}),
      ...(handheldLight ? { light: handheldLight } : {}),
      ...(handheldCamera ? { camera: handheldCamera } : {}),
      ...(handheldDepth ? { depth: handheldDepth } : {}),
      ...(handheldFocus ? { focus: handheldFocus } : {}),
      ...(handheldMaterialInteraction
        ? { materialInteraction: handheldMaterialInteraction }
        : {}),
      ...(handheldArchitecture
        ? {
            architecture: handheldEffectiveArchitecture(
              handheldArchitecture,
              Boolean(resolved.slots.layout?.file),
            ),
          }
        : {}),
      ...(handheldStyle ? { style: handheldStyle } : {}),
      ...(handheldSku ? { sku: handheldSku } : {}),
      ...(productName.trim() ? { productName: productName.trim() } : {}),
      ...(sellingPoints.trim() ? { sellingPoints: sellingPoints.trim() } : {}),
      shots,
    };
    let projectId = handheldProjectId;
    if (!projectId) {
      const project = await createHandheldProject({
        ...(selectedProduct?.id ? { productId: selectedProduct.id } : {}),
        name: productName || "手持商品项目",
        draft: handheldSpec,
      });
      projectId = String(project?.id || "");
      setHandheldProjectId(projectId);
    } else {
      await updateHandheldProjectDraft(projectId, handheldSpec).catch(() => {});
    }
    return {
      roleFiles: [...productRoles, ...extraRoles],
      projectId,
      productId: selectedProduct?.id || "",
      spec: handheldSpec,
    };
  }
  async function executeGenerate({ expectedUnitPriceCents = null } = {}) {
    const batchId = crypto.randomUUID();
    const count = generationPlan.length;
    setSubmitError("");
    jobs.clearError();
    setSessionBatchId(batchId);
    setSessionCount(count);
    setWorkspace("result");
    setPane("canvas");
    setActiveUrl("");
    if (mode.id === "tryon") setTryonStarting(true);
    if (mode.id === "handheld") {
      setHandheldRetryingByIndex({});
      setHandheldStarting(true);
    }
    try {
      if (mode.id === "handheld") {
        const prepared = await prepareHandheldBatchRequest(
          handheldBlueprints.map((shot, index) => ({
            id: shot.id || `shot-${index + 1}`,
            label: shot.label || `手持商品图 ${index + 1}`,
            direction: shot.direction || "",
            aspectRatio,
            prompt: handheldPromptForShot(shot, index).prompt,
          })),
        );
        const result = await jobs.createHandheldBatch({
          ...prepared,
          modelId,
        });
        setSessionBatchId(result.batchId);
      } else {
        const resolvedFiles =
          mode.id === "tryon" ? await resolveTryonInputFiles() : inputFiles;
        const accessorySpecBase =
          mode.id === "accessory"
            ? buildAccessorySpec({
                category: accessoryCategory,
                pack: accessoryPack,
                material: accessoryMaterial,
                scale: accessoryScale,
                sizeMm: accessorySizeMm,
                occlusion: accessoryOcclusion,
                crop: accessoryCrop,
                style: accessoryStyle,
                platform,
                market,
                aspectRatio,
                productName,
                sku: accessorySku,
                sellingPoints,
                hasModel: accessoryHasModel,
                hasScene: accessoryHasScene,
              })
            : null;
        let planItems = generationPlan;
        if (mode.id === "detail") {
          try {
            const planned = aplusLivePlan?.modules?.length
              ? aplusLivePlan
              : await runAplusPlanner(resolvedFiles);
            if (planned?.modules?.length) {
              const shots = aplusShotBlueprintsFromPlan(planned);
              planItems = buildEcommerceGenerationPlan({
                modeId: mode.id,
                count: shots.length,
                selectedModules,
                basePrompt: buildAplusTaskPrompt({
                  plan: planned,
                  marketplace: aplusMarketplaceById(planned.marketplaceId),
                  category: aplusCategoryById(planned.categoryId),
                  productName,
                  sellingPoints,
                  tone,
                }),
                referenceCount: resolvedFiles.length,
                shotBlueprints: shots,
              });
            }
          } catch {
            /* 文本规划失败时仍按品类模板出图 */
          }
        }
        await jobs.createBatch({
          files: resolvedFiles,
          modelId,
          batchId,
          batchSize: planItems.length,
          expectedUnitPriceCents,
          items: planItems.map((item, index) => ({
            ...item,
            kindVariant: mode.id,
            aspectRatio:
              mode.id === "detail"
                ? item.aspectRatio || aspectRatio
                : aspectRatio,
            platform: `${platform} · ${market} · ${language}`,
            batchIndex: index,
            ...(item.outputSize ? { outputSize: item.outputSize } : {}),
            ...(item.aplusSpec ? { aplusSpec: item.aplusSpec } : {}),
            ...(accessorySpecBase
              ? {
                  accessorySpec: {
                    ...accessorySpecBase,
                    shotId: item.viewId || "",
                    shotLabel:
                      String(item.viewLabel || "")
                        .split(" · ")
                        .pop() || "",
                  },
                }
              : {}),
          })),
        });
      }
    } catch (error) {
      if (error?.name !== "AbortError") {
        setSubmitError(error?.message || "生成失败，请检查网络后重试");
      }
    } finally {
      setTryonStarting(false);
      setHandheldStarting(false);
      setAplusPlanning(false);
    }
  }
  async function executeTryonBriefRevision({
    sourceRow,
    brief,
    briefKey,
    expectedUnitPriceCents = null,
  } = {}) {
    const text = String(brief || "").trim();
    if (!sourceRow?.url || !text || jobs.running) return;
    const nextVersion = rowVersion(sourceRow) + 1;
    const revision = buildTryonRevisionPlan({
      basePrompt: assembledPrompt,
      brief: text,
      apparel,
      modelLabel: tryonMentionModelLabel,
      sceneLabel: tryonMentionSceneLabel,
      lens: tryonLens,
      light: tryonLight,
      aspectRatio: aspectRatio || sourceRow.aspectRatio,
      versionNumber: nextVersion,
    });
    const batchId = crypto.randomUUID();
    setSubmitError("");
    jobs.clearError();
    setSessionBatchId(batchId);
    setSessionCount(1);
    setWorkspace("result");
    setPane("canvas");
    setActiveUrl("");
    setTryonStarting(true);
    if (revision.aspectRatio) setAspectRatio(revision.aspectRatio);
    try {
      const sourceFiles = await resolveTryonInputFiles();
      await jobs.createBatch({
        files: [
          remoteSourceFile(sourceRow.url, "tryon-current-result.png"),
          ...sourceFiles,
        ],
        modelId,
        batchId,
        batchSize: 1,
        expectedUnitPriceCents,
        items: [
          {
            prompt: revision.prompt,
            kindVariant: mode.id,
            aspectRatio:
              revision.aspectRatio || sourceRow.aspectRatio || aspectRatio,
            parentOutputUrl: sourceRow.url,
            iterationMode: true,
            viewId: `tryon-revision-v${nextVersion}`,
            viewLabel: `${mode.shortLabel} · V${nextVersion}`,
            batchIndex: 0,
          },
        ],
      });
      clearTryonBrief(briefKey, text);
    } catch (error) {
      setActiveUrl(sourceRow.url);
      if (error?.name !== "AbortError") {
        setSubmitError(error?.message || "试衣结果修改失败，请重试");
      }
    } finally {
      setTryonStarting(false);
    }
  }
  function applyTryonRatio(value, { hydrate = false } = {}) {
    const ratio = coerceRatioValue(value, OPTIONS.tryonRatio);
    if (!ratio) return false;
    if (hydrate) tryonRatioHydratedRef.current = true;
    setAspectRatio(ratio);
    return true;
  }
  function selectTryonHistory(url) {
    if (!url) return;
    setActiveUrl(url);
    const row = modeRows.find((item) => item.url === url);
    if (applyTryonRatio(row?.aspectRatio, { hydrate: true })) return;
    applyTryonRatio(tryonInferredRatiosRef.current[url], { hydrate: true });
  }
  function applyTryonImageSize(url, width, height) {
    if (!url || !isTryonMode(mode.id)) return;
    const snapped = snapRatio(width, height, OPTIONS.tryonRatio);
    if (!snapped) return;
    tryonInferredRatiosRef.current[url] = snapped;
    const row = modeRows.find((item) => item.url === url);
    if (matchingRatio(row?.aspectRatio, OPTIONS.tryonRatio)) return;
    const viewing = url === (activeUrl || currentRow?.url || latestTryonUrl);
    if (!viewing) return;
    applyTryonRatio(snapped, { hydrate: true });
  }
  function selectHandheldHistory(url) {
    if (!url) return;
    setActiveUrl(url);
    const row = modeRows.find((item) => item.url === url);
    if (row?.groupId) {
      setSessionBatchId(String(row.groupId));
      setSessionCount(Math.max(1, Number(row.groupSize || 1)));
    }
    const spec = row?.task?.params?.handheldSpec;
    if (!spec || typeof spec !== "object") return;
    if (spec.pack) setHandheldPack(handheldPackById(spec.pack).id);
    if (spec.platform) {
      const option = handheldPlatformById(spec.platform);
      setHandheldPlatform(option.id);
      if (option.ratio) setAspectRatio(option.ratio);
    }
    if (OPTIONS.handheldRatio.some((item) => item.value === spec.aspectRatio)) {
      setAspectRatio(spec.aspectRatio);
    }
    setHandheldLanguage(
      HANDHELD_LANGUAGE_OPTIONS.some((item) => item.id === spec.language)
        ? spec.language
        : "",
    );
    setHandheldAnnotations(
      Array.isArray(spec.annotations)
        ? spec.annotations.map((item) => ({ ...item, enabled: true }))
        : [],
    );
    if (spec.crop) setHandheldCrop(handheldCropById(spec.crop).id);
    if (spec.pose) setHandheldPose(handheldPoseById(spec.pose).id);
    if (spec.style) setHandheldStyle(handheldStyleById(spec.style).id);
    if (spec.hand) setHandheldHand(handheldHandById(spec.hand).id);
    if (spec.category)
      setHandheldCategory(handheldCategoryById(spec.category).id);
    if (spec.lens) setHandheldLens(handheldLensById(spec.lens).id);
    if (spec.light) setHandheldLight(handheldLightById(spec.light).id);
    if (spec.camera) setHandheldCamera(handheldCameraById(spec.camera).id);
    if (spec.depth) setHandheldDepth(handheldDepthById(spec.depth).id);
    if (spec.focus) setHandheldFocus(handheldFocusById(spec.focus).id);
    if (spec.materialInteraction) {
      setHandheldMaterialInteraction(
        handheldMaterialInteractionById(spec.materialInteraction).id,
      );
    }
    if (spec.packState) {
      setHandheldPackState(handheldPackStateById(spec.packState).id);
    }
    if (spec.architecture) {
      setHandheldArchitecture(handheldArchitectureById(spec.architecture).id);
    }
  }
  function currentAccessorySpec(extra = {}) {
    return buildAccessorySpec({
      category: accessoryCategory,
      pack: accessoryPack,
      material: accessoryMaterial,
      scale: accessoryScale,
      sizeMm: accessorySizeMm,
      occlusion: accessoryOcclusion,
      crop: accessoryCrop,
      style: accessoryStyle,
      platform,
      market,
      aspectRatio,
      productName,
      sku: accessorySku,
      sellingPoints,
      hasModel: accessoryHasModel,
      hasScene: accessoryHasScene,
      ...extra,
    });
  }
  function selectAccessoryHistory(url) {
    if (!url) return;
    setActiveUrl(url);
    const row = modeRows.find((item) => item.url === url);
    if (row?.groupId) {
      setSessionBatchId(String(row.groupId));
      setSessionCount(Math.max(1, Number(row.groupSize || 1)));
    }
    const spec = row?.task?.params?.accessorySpec;
    if (!spec || typeof spec !== "object") return;
    if (ACCESSORY_CATEGORY_OPTIONS.some((item) => item.id === spec.category)) {
      setAccessoryCategory(spec.category);
    }
    if (ACCESSORY_PACK_OPTIONS.some((item) => item.id === spec.pack)) {
      setAccessoryPack(spec.pack);
    }
    if (ACCESSORY_MATERIAL_OPTIONS.some((item) => item.id === spec.material)) {
      setAccessoryMaterial(spec.material);
    }
    if (ACCESSORY_SCALE_OPTIONS.some((item) => item.id === spec.scale)) {
      setAccessoryScale(spec.scale);
    }
    if (
      ACCESSORY_OCCLUSION_OPTIONS.some((item) => item.id === spec.occlusion)
    ) {
      setAccessoryOcclusion(spec.occlusion);
    }
    if (ACCESSORY_CROP_OPTIONS.some((item) => item.id === spec.crop)) {
      setAccessoryCrop(spec.crop);
    }
    if (ACCESSORY_STYLE_OPTIONS.some((item) => item.id === spec.style)) {
      setAccessoryStyle(spec.style);
    }
    if (typeof spec.sizeMm === "string" || typeof spec.sizeMm === "number") {
      setAccessorySizeMm(String(spec.sizeMm || ""));
    }
    if (typeof spec.sku === "string") setAccessorySku(spec.sku);
    if (typeof spec.productName === "string" && spec.productName) {
      setProductName(spec.productName);
    }
    if (typeof spec.sellingPoints === "string" && spec.sellingPoints) {
      setSellingPoints(spec.sellingPoints);
    }
    if (OPTIONS.platform.includes(spec.platform)) setPlatform(spec.platform);
    if (OPTIONS.market.includes(spec.market)) setMarket(spec.market);
    if (OPTIONS.handheldRatio.some((item) => item.value === spec.aspectRatio)) {
      setAspectRatio(spec.aspectRatio);
    }
  }
  function handheldItemForUrl(url) {
    const row = url ? modeRows.find((item) => item.url === url) : currentRow;
    if (!row?.task?.params?.handheldItemId) return null;
    return {
      task: row.task,
      itemId: String(row.task.params.handheldItemId),
      row,
    };
  }
  async function saveCurrentHandheldAsset(url) {
    const item = handheldItemForUrl(url) || currentHandheldItem;
    const itemId = item?.itemId;
    if (!itemId || handheldActionBusy) return;
    if (url) setActiveUrl(url);
    setHandheldActionBusy(true);
    try {
      const saved = await saveHandheldItemAsset(itemId, {
        title: `${productName || "手持商品图"} · ${item.row?.index + 1 || 1}`,
      });
      if (saved?.id) {
        setAssets((current) => ({
          ...current,
          error: "",
          items: [
            saved,
            ...current.items.filter((asset) => asset.id !== saved.id),
          ],
        }));
      }
      showHandheldUploadNotice("已存入素材库");
    } catch (error) {
      setSubmitError(error?.message || "保存素材失败");
    } finally {
      setHandheldActionBusy(false);
    }
  }
  async function retrySlot(index) {
    const item = generationPlan[index];
    if (!item || jobs.running) return;
    await requestCostThenRun(() => executeRetrySlot(index), 1);
  }
  async function retryHandheldShot(index) {
    const failedTask = handheldSessionTasks.find(
      (task) => Number(task.batchIndex) === Number(index),
    );
    const status = String(failedTask?.status || "").toLowerCase();
    const itemId = String(failedTask?.params?.handheldItemId || "").trim();
    if (
      !itemId ||
      !["failed", "canceled", "cancelled"].includes(status) ||
      handheldRetryingByIndex[index]
    )
      return;
    try {
      const retryCost = Number(failedTask?.costCents);
      await requestCostThenRun(
        () => executeRetryHandheldShot(index),
        1,
        Number.isFinite(retryCost) ? retryCost : unitPrice,
      );
    } catch (error) {
      setSubmitError(error?.message || "失败图片重试失败，请重试");
    }
  }
  async function executeRetryHandheldShot(index) {
    const failedTask = handheldSessionTasks.find(
      (task) => Number(task.batchIndex) === Number(index),
    );
    const itemId = String(failedTask?.params?.handheldItemId || "").trim();
    if (!itemId) {
      setSubmitError("失败图片标识已失效，请刷新后重试");
      return;
    }
    setSubmitError("");
    jobs.clearError();
    setHandheldRetryingByIndex((current) => ({ ...current, [index]: true }));
    try {
      await jobs.retryHandheldItem(itemId);
    } catch (error) {
      setSubmitError(error?.message || "失败图片重试失败，请重试");
    } finally {
      setHandheldRetryingByIndex((current) => ({
        ...current,
        [index]: false,
      }));
    }
  }
  async function executeRetrySlot(index) {
    const item = generationPlan[index];
    if (!item || jobs.running) return;
    const batchId = sessionBatchId || crypto.randomUUID();
    setSubmitError("");
    jobs.clearError();
    setSessionBatchId(batchId);
    setSessionCount((value) => Math.max(value, displayCount, index + 1));
    try {
      await jobs.createBatch({
        files: hidesCommerceSettings(mode.id)
          ? await resolveLiveStageInputFiles()
          : inputFiles,
        modelId,
        batchId,
        batchSize: Math.max(sessionCount, displayCount, index + 1),
        items: [
          {
            ...item,
            kindVariant: mode.id,
            aspectRatio,
            platform: `${platform} · ${market} · ${language}`,
            batchIndex: index,
            ...(mode.id === "accessory"
              ? {
                  accessorySpec: currentAccessorySpec({
                    shotId: item.viewId || "",
                    shotLabel:
                      String(item.viewLabel || "")
                        .split(" · ")
                        .pop() || "",
                  }),
                }
              : {}),
          },
        ],
      });
    } catch (error) {
      setSubmitError(error?.message || "重新生成失败，请重试");
    }
  }
  function remoteSourceFile(url, name = "ecommerce-source.png") {
    const file = new File([new Blob()], name, { type: "image/png" });
    Object.defineProperty(file, "sourceUrl", { value: url });
    return file;
  }
  async function reviseCurrent() {
    await reviseOutput({
      brief: revisionBrief.trim(),
      direction: revisionDirection,
      clearBrief: true,
    });
  }
  async function reviseOutput({
    brief,
    direction = "precise",
    clearBrief = false,
  } = {}) {
    const text = String(brief || "").trim();
    if (!currentRow || text.length < 4 || jobs.running) return;
    await requestCostThenRun(
      () => executeReviseOutput({ brief: text, direction, clearBrief }),
      1,
    );
  }
  async function executeReviseOutput({
    brief,
    direction = "precise",
    clearBrief = false,
  } = {}) {
    const text = String(brief || "").trim();
    if (!currentRow || text.length < 4 || jobs.running) return;
    const nextVersion = currentVersion + 1;
    const prompt = buildEcommerceRevisionPrompt({
      basePrompt: assembledPrompt,
      brief: text,
      direction,
      versionNumber: nextVersion,
    });
    setSessionCount(1);
    setSubmitError("");
    try {
      const sourceFiles = hidesCommerceSettings(mode.id)
        ? await resolveLiveStageInputFiles()
        : inputFiles;
      await jobs.createBatch({
        files: [remoteSourceFile(currentRow.url), ...sourceFiles.slice(0, 5)],
        modelId,
        batchSize: 1,
        items: [
          {
            prompt,
            kindVariant: mode.id,
            aspectRatio: currentRow.aspectRatio || aspectRatio,
            parentOutputUrl: currentRow.url,
            iterationMode: true,
            viewId: `${mode.id}-revision-v${nextVersion}`,
            viewLabel: `${mode.shortLabel} · V${nextVersion}`,
            batchIndex: 0,
            ...(mode.id === "accessory"
              ? {
                  accessorySpec: currentAccessorySpec({
                    shotId: `${mode.id}-revision-v${nextVersion}`,
                    shotLabel: `V${nextVersion}`,
                  }),
                }
              : {}),
          },
        ],
      });
      if (clearBrief) setRevisionBrief("");
    } catch (error) {
      setSubmitError(error?.message || "继续优化失败，请重试");
    }
  }
  async function submitMaskedEdit({ maskFile, brief: editBrief }) {
    if (!maskRow || jobs.running) return;
    await requestCostThenRun(
      () => executeMaskedEdit({ maskFile, editBrief }),
      1,
    );
  }
  async function executeMaskedEdit({ maskFile, editBrief }) {
    if (!maskRow || jobs.running) return;
    setSessionCount(1);
    setSubmitError("");
    try {
      await jobs.createBatch({
        files: [
          remoteSourceFile(maskRow.url),
          maskFile,
          ...inputFiles.slice(0, 4),
        ],
        modelId,
        batchSize: 1,
        items: [
          {
            prompt: buildEcommerceRevisionPrompt({
              basePrompt: assembledPrompt,
              brief: `局部编辑要求：${editBrief}。只修改蒙版覆盖区域，其他商品细节、文字、构图、光影与尺寸保持不变。`,
              direction: "precise",
              versionNumber: rowVersion(maskRow) + 1,
            }),
            kindVariant: mode.id,
            aspectRatio: maskRow.aspectRatio || aspectRatio,
            parentOutputUrl: maskRow.url,
            iterationMode: true,
            maskedEdit: true,
            maskInputIndex: 1,
            batchIndex: 0,
            ...(mode.id === "accessory"
              ? {
                  accessorySpec: currentAccessorySpec({
                    shotId: `accessory-mask-v${rowVersion(maskRow) + 1}`,
                    shotLabel: "局部修正",
                  }),
                }
              : {}),
          },
        ],
      });
      setMaskRow(null);
    } catch (error) {
      setSubmitError(error?.message || "局部编辑失败，请重试");
    }
  }
  function showAccessoryNotice(message) {
    setAccessoryNotice(message);
    window.setTimeout(
      () =>
        setAccessoryNotice((current) => (current === message ? "" : current)),
      2600,
    );
  }
  async function saveCurrentAccessoryAsset() {
    if (!currentRow?.url || accessoryActionBusy) return;
    setAccessoryActionBusy(true);
    try {
      const blob = await fetchAuthenticatedMediaBlob(currentRow.url, {
        cache: "default",
      });
      const file = new File(
        [blob],
        `${accessorySku || "accessory"}-${currentRow.index + 1 || 1}.png`,
        { type: blob.type || "image/png" },
      );
      const uploaded = await uploadFile(await prepareUploadFile(file));
      await createUserAsset({
        title: `${productName || "饰品商业图"} · ${generationPlan[currentRow.index]?.viewLabel?.split(" · ").pop() || `成图 ${currentRow.index + 1 || 1}`}`,
        fileKey: uploaded.key,
        thumbnailKey: uploaded.thumbnailKey,
        contentType: uploaded.contentType || file.type,
      });
      showAccessoryNotice("已存入素材库");
    } catch (error) {
      setSubmitError(error?.message || "饰品成图保存失败");
    } finally {
      setAccessoryActionBusy(false);
    }
  }
  async function downloadAccessoryPack() {
    if (!currentGroup.length || accessoryActionBusy) return;
    setAccessoryActionBusy(true);
    try {
      await downloadHistoryImagesAsZip(
        currentGroup.map((row, index) => ({
          url: row.url,
          filename: `${accessorySku || "accessory"}-${generationPlan[row.index]?.viewId || index + 1}`,
        })),
      );
      showAccessoryNotice(`已打包 ${currentGroup.length} 张饰品图`);
    } catch (error) {
      setSubmitError(error?.message || "套图打包失败");
    } finally {
      setAccessoryActionBusy(false);
    }
  }
  async function exportAplusPack() {
    if (!currentGroup.length) return;
    const checklist = aplusExportChecklist(aplusPlan, currentGroup);
    try {
      await downloadHistoryImagesAsZip(
        currentGroup.map((row, index) => ({
          url: row.url,
          filename: `${aplusPlan.asin || "aplus"}-${String(index + 1).padStart(2, "0")}-${String(checklist[index]?.amazonModule || "module").replace(/\s+/g, "-")}`,
        })),
      );
      const csv = aplusChecklistCsv(checklist);
      const json = JSON.stringify({ plan: aplusPlan, checklist }, null, 2);
      const csvUrl = URL.createObjectURL(
        new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" }),
      );
      const jsonUrl = URL.createObjectURL(
        new Blob([json], { type: "application/json" }),
      );
      const stamp = new Date().toISOString().slice(0, 10);
      const click = (href, name) => {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = name;
        anchor.click();
      };
      click(csvUrl, `aplus-upload-${stamp}.csv`);
      click(jsonUrl, `aplus-copy-${stamp}.json`);
      window.setTimeout(() => {
        URL.revokeObjectURL(csvUrl);
        URL.revokeObjectURL(jsonUrl);
      }, 60_000);
    } catch (error) {
      setSubmitError(error?.message || "A+ 导出失败");
    }
  }
  async function downloadOutput(row) {
    if (!row?.url) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const blob = await fetchAuthenticatedMediaBlob(row.url, {
        cache: "no-store",
        signal: controller.signal,
      });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `ecommerce-${mode.id}-${Date.now()}.${blob.type.includes("png") ? "png" : blob.type.includes("webp") ? "webp" : "jpg"}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } finally {
      window.clearTimeout(timeout);
    }
  }
  async function removeCurrent() {
    if (!deleteRow) return;
    setDeleting(true);
    try {
      await jobs.remove(deleteRow.task.id);
      setDeleteRow(null);
    } finally {
      setDeleting(false);
    }
  }
  async function useRemote(url, title = "参考图") {
    const blob = await fetchAuthenticatedMediaBlob(url, { cache: "no-store" });
    const file = new File([blob], `${title}.png`, {
      type: blob.type || "image/png",
    });
    Object.defineProperty(file, "sourceUrl", { value: url });
    if (mode.id === "tryon") {
      void setTryonSlot(
        tryonSlots.garment && !tryonSlots.model ? "model" : "garment",
        [file],
      );
    } else if (mode.id === "handheld") {
      void setHandheldSlot(
        handheldSlots.product && !handheldSlots.model ? "model" : "product",
        [file],
      );
    } else {
      addFiles([file]);
    }
    setWorkspace("result");
    setPane(hidesCommerceSettings(mode.id) ? "canvas" : "settings");
  }

  const preview = modePreview(mode);
  const featuredTryonModel =
    catalogOptionById(tryonModelCatalog, featuredTryonModelId) ||
    tryonModelCatalog[0] ||
    null;
  const tryonModelPreview =
    tryonSlots.model?.source === "upload" && tryonSlots.model.url
      ? tryonSlots.model.url
      : featuredTryonModel?.image || "";
  const featuredTryonScene =
    catalogOptionById(tryonSceneCatalog, featuredTryonSceneId) ||
    tryonSceneCatalog[0] ||
    null;
  const tryonScenePreview =
    tryonSlots.scene?.source === "upload" && tryonSlots.scene.url
      ? tryonSlots.scene.url
      : featuredTryonScene?.image || "";
  const featuredTryonGarment =
    catalogOptionById(tryonGarmentCatalog, featuredTryonGarmentId) ||
    tryonGarmentCatalog[0] ||
    null;
  const tryonModelLabel =
    tryonSlots.model?.source === "upload"
      ? "自定义模特"
      : featuredTryonModel?.label || "";
  const tryonSceneLabel =
    tryonSlots.scene?.source === "upload"
      ? "自定义场景"
      : featuredTryonScene?.label || "";
  const featuredHandheldModel =
    catalogOptionById(handheldModelCatalog, featuredHandheldModelId) ||
    handheldModelCatalog[0] ||
    HANDHELD_MODEL_CATALOG[0];
  const featuredHandheldHand =
    catalogOptionById(handheldHandCatalog, featuredHandheldHandId) || null;
  const handheldModelPreview = handheldSlots.model
    ? handheldSlots.model.url ||
      featuredHandheldHand?.image ||
      featuredHandheldModel.image
    : "";
  const featuredHandheldScene =
    catalogOptionById(handheldSceneCatalog, featuredHandheldSceneId) ||
    handheldSceneCatalog[0] ||
    HANDHELD_SCENE_CATALOG[0];
  const handheldScenePreview = handheldSlots.scene
    ? handheldSlots.scene.url || featuredHandheldScene.image
    : "";
  const handheldModelLabel =
    handheldSlots.model?.source === "upload"
      ? "自定义模特"
      : featuredHandheldModel.label;
  const handheldSceneLabel =
    handheldSlots.scene?.source === "upload"
      ? "自定义场景"
      : featuredHandheldScene.label;
  const selectFields = [
    {
      key: "platform",
      label: "平台",
      options: OPTIONS.platform,
      value: platform,
      set: setPlatform,
      aria: "选择电商平台",
    },
    {
      key: "market",
      label: "市场",
      options: OPTIONS.market,
      value: market,
      set: setMarket,
      aria: "选择目标市场",
    },
    {
      key: "language",
      label: "语言",
      options: OPTIONS.language,
      value: language,
      set: setLanguage,
      aria: "选择文案语言",
    },
  ];
  const creativeFields = [
    {
      key: "scene",
      label: "场景方向",
      options: OPTIONS.scene,
      value: scene,
      set: setScene,
      aria: "选择场景方向",
    },
    {
      key: "campaign",
      label: "营销目标",
      options: OPTIONS.campaign,
      value: campaign,
      set: setCampaign,
      aria: "选择营销目标",
    },
    {
      key: "tone",
      label: "视觉风格",
      options: OPTIONS.tone,
      value: tone,
      set: setTone,
      aria: "选择视觉风格",
    },
    {
      key: "apparel",
      label: "服装类型",
      options: OPTIONS.apparel,
      value: apparel,
      set: setApparel,
      aria: "选择服装类型",
    },
    {
      key: "model",
      label: "模特人群",
      options: OPTIONS.model,
      value: modelProfile,
      set: setModelProfile,
      aria: "选择模特人群",
    },
    {
      key: "pose",
      label: "模特姿态",
      options: OPTIONS.pose,
      value: pose,
      set: setPose,
      aria: "选择模特姿态",
    },
    {
      key: "shadow",
      label: "阴影类型",
      options: OPTIONS.shadow,
      value: shadow,
      set: setShadow,
      aria: "选择阴影类型",
    },
  ];

  return (
    <main
      ref={pageRef}
      className={`commerce-studio${isShootMode(mode.id) ? " is-shoot" : ""}${isTryonMode(mode.id) ? " is-tryon" : ""}${isHandheldMode(mode.id) ? " is-handheld" : ""}${isAccessoryMode(mode.id) ? " is-accessory" : ""}${isDetailMode(mode.id) ? " is-detail" : ""}`}
      data-ecommerce-business={mode.id}
      data-ecommerce-page-motion-state="waiting"
      data-ecommerce-content-motion-state="waiting"
    >
      <div className="commerce-atmosphere" aria-hidden="true" />
      <header className="commerce-header" data-commerce-page-motion-target>
        {isTryonMode(mode.id) ? (
          <div className="commerce-header__tryon">
            <label className="commerce-header__model">
              <span>{t("模型")}</span>
              <CommerceSelect
                value={modelId}
                options={commerceModelOptions(models, unitPrice)}
                onChange={setModelId}
                placeholder="请选择模型"
                ariaLabel="选择生成模型"
                menuMinWidth={240}
                disabled={jobs.running}
              />
            </label>
            <label className="commerce-header__ratio">
              <span>{t("比例")}</span>
              <CommerceSelect
                value={
                  matchingRatio(aspectRatio, OPTIONS.tryonRatio) ||
                  coerceRatioValue(aspectRatio, OPTIONS.tryonRatio) ||
                  "2:3"
                }
                options={OPTIONS.tryonRatio}
                onChange={setAspectRatio}
                ariaLabel="选择画面比例"
                menuMinWidth={160}
                disabled={jobs.running}
              />
            </label>
            <label className="commerce-header__lens">
              <span>{t("镜头")}</span>
              <CommerceSelect
                value={tryonLens}
                options={TRYON_LENS_OPTIONS.map((item) => ({
                  value: item.id,
                  label: item.range
                    ? `${t(item.label)} ${item.range}`
                    : t(item.label),
                }))}
                onChange={setTryonLens}
                ariaLabel="选择摄影镜头"
                menuMinWidth={240}
                disabled={jobs.running}
              />
            </label>
            <label className="commerce-header__light">
              <span>{t("光影")}</span>
              <CommerceSelect
                value={tryonLight}
                options={TRYON_LIGHT_OPTIONS.map((item) => ({
                  value: item.id,
                  label: item.label,
                }))}
                onChange={setTryonLight}
                ariaLabel="选择光影调整"
                menuMinWidth={160}
                disabled={jobs.running}
              />
            </label>
          </div>
        ) : isHandheldMode(mode.id) ? (
          <div className="commerce-header__handheld">
            <label className="commerce-header__model">
              <span>{t("生成模型")}</span>
              <CommerceSelect
                value={modelId}
                options={commerceModelOptions(models, unitPrice)}
                onChange={setModelId}
                placeholder="请选择模型"
                ariaLabel="选择生成模型"
                menuMinWidth={240}
                disabled={handheldCurrentRunning}
              />
            </label>
            <HandheldTunePopover
              style={handheldStyle}
              styleOptions={HANDHELD_STYLE_OPTIONS}
              onChangeStyle={(id) => {
                setHandheldStyle((current) => (current === id ? "" : id));
                setHandheldPhotoPreset("");
              }}
              lens={handheldLens}
              lensOptions={HANDHELD_LENS_OPTIONS}
              onChangeLens={(id) => {
                setHandheldLens((current) => (current === id ? "" : id));
                setHandheldPhotoPreset("");
              }}
              camera={handheldCamera}
              cameraOptions={HANDHELD_CAMERA_OPTIONS}
              onChangeCamera={(id) => {
                setHandheldCamera((current) => (current === id ? "" : id));
                setHandheldPhotoPreset("");
              }}
              depth={handheldDepth}
              depthOptions={HANDHELD_DEPTH_OPTIONS}
              onChangeDepth={(id) => {
                setHandheldDepth((current) => (current === id ? "" : id));
                setHandheldPhotoPreset("");
              }}
              light={handheldLight}
              lightOptions={HANDHELD_LIGHT_OPTIONS}
              onChangeLight={(id) => {
                setHandheldLight((current) => (current === id ? "" : id));
                setHandheldPhotoPreset("");
              }}
              focus={handheldFocus}
              focusOptions={HANDHELD_FOCUS_OPTIONS}
              onChangeFocus={(id) => {
                setHandheldFocus((current) => (current === id ? "" : id));
                setHandheldPhotoPreset("");
              }}
              materialInteraction={handheldMaterialInteraction}
              materialInteractionOptions={HANDHELD_MATERIAL_INTERACTION_OPTIONS}
              onChangeMaterialInteraction={(id) => {
                setHandheldMaterialInteraction((current) =>
                  current === id ? "" : id,
                );
                setHandheldPhotoPreset("");
              }}
              architecture={handheldArchitecture}
              architectureOptions={HANDHELD_ARCHITECTURE_OPTIONS}
              onChangeArchitecture={(id) => {
                setHandheldArchitecture((current) =>
                  current === id ? "" : id,
                );
                setHandheldPhotoPreset("");
              }}
              photoPreset={handheldPhotoPreset}
              photoPresetOptions={HANDHELD_PHOTO_PRESET_OPTIONS}
              onChangePhotoPreset={(id) => {
                if (!id) {
                  setHandheldPhotoPreset("");
                  setHandheldStyle("");
                  setHandheldLens("");
                  setHandheldDepth("");
                  setHandheldFocus("");
                  setHandheldLight("");
                  setHandheldCamera("");
                  setHandheldMaterialInteraction("");
                  setHandheldArchitecture("");
                  return;
                }
                const preset = handheldPhotoPresetById(id);
                setHandheldPhotoPreset(preset.id);
                setHandheldStyle(preset.settings.style);
                setHandheldLens(preset.settings.lens);
                setHandheldDepth(preset.settings.depth);
                setHandheldFocus(preset.settings.focus);
                setHandheldLight(preset.settings.light);
                setHandheldCamera(preset.settings.camera);
                setHandheldMaterialInteraction(
                  preset.settings.materialInteraction,
                );
                setHandheldArchitecture(preset.settings.architecture);
              }}
              disabled={handheldCurrentRunning}
            />
            <HandheldProductPopover
              category={handheldCategory}
              categoryOptions={HANDHELD_CATEGORY_OPTIONS}
              onChangeCategory={(id) =>
                setHandheldCategory((current) => (current === id ? "" : id))
              }
              packState={handheldPackState}
              packStateOptions={HANDHELD_PACK_STATE_OPTIONS}
              onChangePackState={(id) =>
                setHandheldPackState((current) => (current === id ? "" : id))
              }
              productName={productName}
              onChangeProductName={setProductName}
              sku={handheldSku}
              onChangeSku={setHandheldSku}
              sellingPoints={sellingPoints}
              onChangeSellingPoints={setSellingPoints}
              disabled={handheldCurrentRunning}
            />
            <HandheldPosePopover
              pose={handheldPose}
              poseOptions={HANDHELD_POSE_OPTIONS}
              onChangePose={(id) =>
                setHandheldPose((current) => (current === id ? "" : id))
              }
              hand={handheldHand}
              handOptions={HANDHELD_HAND_OPTIONS}
              onChangeHand={(id) =>
                setHandheldHand((current) => (current === id ? "" : id))
              }
              disabled={handheldCurrentRunning}
            />
            <div className="commerce-header__language">
              <CommerceSelect
                value={handheldLanguage}
                options={[
                  { value: "", label: "多国语言" },
                  ...HANDHELD_LANGUAGE_OPTIONS.map((item) => ({
                    value: item.id,
                    label: item.label,
                  })),
                ]}
                onChange={setHandheldLanguage}
                ariaLabel="选择画面文案语言"
                menuMinWidth={160}
                treatEmptyAsPlaceholder
                disabled={handheldCurrentRunning}
              />
            </div>
            <button
              type="button"
              className={`commerce-header__guide${handheldGuideOpen ? " is-open" : ""}`}
              aria-haspopup="dialog"
              aria-expanded={handheldGuideOpen}
              aria-label="使用说明"
              onClick={() => setHandheldGuideOpen(true)}
            >
              <i className="bi bi-journal-text" aria-hidden="true" />
              <span>使用说明</span>
            </button>
          </div>
        ) : isAccessoryMode(mode.id) ? (
          <AccessoryTopToolbar
            modelId={modelId}
            modelOptions={commerceModelOptions(models, unitPrice)}
            onChangeModelId={setModelId}
            category={accessoryCategory}
            categoryOptions={ACCESSORY_CATEGORY_OPTIONS}
            onChangeCategory={(id) => {
              const option = accessoryCategoryById(id);
              setAccessoryCategory(id);
              setAccessoryCrop(option.defaultCrop || ACCESSORY_DEFAULT_CROP_ID);
            }}
            material={accessoryMaterial}
            materialOptions={ACCESSORY_MATERIAL_OPTIONS}
            onChangeMaterial={setAccessoryMaterial}
            scale={accessoryScale}
            scaleOptions={ACCESSORY_SCALE_OPTIONS}
            onChangeScale={setAccessoryScale}
            sizeMm={accessorySizeMm}
            onChangeSizeMm={setAccessorySizeMm}
            occlusion={accessoryOcclusion}
            occlusionOptions={ACCESSORY_OCCLUSION_OPTIONS}
            onChangeOcclusion={setAccessoryOcclusion}
            crop={accessoryCrop}
            cropOptions={ACCESSORY_CROP_OPTIONS}
            onChangeCrop={setAccessoryCrop}
            style={accessoryStyle}
            styleOptions={ACCESSORY_STYLE_OPTIONS}
            onChangeStyle={setAccessoryStyle}
            platform={platform}
            platformOptions={OPTIONS.platform}
            onChangePlatform={setPlatform}
            market={market}
            marketOptions={OPTIONS.market}
            onChangeMarket={setMarket}
            productName={productName}
            onChangeProductName={setProductName}
            sku={accessorySku}
            onChangeSku={setAccessorySku}
            sellingPoints={sellingPoints}
            onChangeSellingPoints={setSellingPoints}
            disabled={jobs.running}
          />
        ) : isDetailMode(mode.id) ? (
          <DetailTopToolbar
            modelId={modelId}
            modelOptions={commerceModelOptions(models, unitPrice)}
            onChangeModelId={setModelId}
            platform={platform}
            platformOptions={OPTIONS.platform}
            onChangePlatform={setPlatform}
            market={market}
            marketOptions={OPTIONS.market}
            onChangeMarket={setMarket}
            language={language}
            languageOptions={OPTIONS.language}
            onChangeLanguage={setLanguage}
            tone={tone}
            toneOptions={OPTIONS.tone}
            onChangeTone={setTone}
            productName={productName}
            onChangeProductName={setProductName}
            sellingPoints={sellingPoints}
            onChangeSellingPoints={setSellingPoints}
            textStable={textStable}
            onToggleTextStable={() => setTextStable((value) => !value)}
            disabled={jobs.running}
          />
        ) : (
          <div className="commerce-header__brand">
            <span className="commerce-header__badge">
              <i className={`bi ${mode.icon}`} />
            </span>
            <div className="commerce-header__copy">
              <em>AI 电商</em>
              <strong>{mode.label}</strong>
            </div>
          </div>
        )}
        <div
          className="commerce-header__actions"
          role="tablist"
          aria-label="工作区"
        >
          {(isShootMode(mode.id)
            ? [
                ["result", "bi-easel2", text.creative],
                ["history", "bi-clock-history", "电商历史"],
                ["operations", "bi-kanban", text.operations],
              ]
            : [
                ["result", "bi-easel2", text.creative],
                ["operations", "bi-kanban", text.operations],
                ["history", "bi-clock-history", "电商历史"],
                ["assets", "bi-collection", "资产与素材"],
                ["products", "bi-box-seam", text.products],
              ]
          ).map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={workspace === id ? "active" : ""}
              aria-selected={workspace === id}
              onClick={() => openWorkspace(id)}
            >
              <i className={`bi ${icon}`} />
              {label}
            </button>
          ))}
          <span className="commerce-cost">
            <i className="bi bi-coin" />
            {detailedCostLabel}
          </span>
        </div>
      </header>
      <div
        className="mobile-pane-switch"
        role="tablist"
        aria-label="工作区切换"
        data-commerce-page-motion-target
      >
        {hidesCommerceSettings(mode.id) ? null : (
          <button
            type="button"
            role="tab"
            className={pane === "settings" ? "active" : ""}
            onClick={() => setPane("settings")}
          >
            参数设置
          </button>
        )}
        <button
          type="button"
          role="tab"
          className={
            pane === "canvas" && workspace === "result" ? "active" : ""
          }
          onClick={() => openWorkspace("result")}
        >
          {text.creative}
        </button>
        <button
          type="button"
          role="tab"
          className={workspace === "history" ? "active" : ""}
          onClick={() => openWorkspace("history")}
        >
          历史
        </button>
        <button
          type="button"
          role="tab"
          className={workspace === "operations" ? "active" : ""}
          onClick={() => openWorkspace("operations")}
        >
          {text.operationsMobile}
        </button>
        {!isShootMode(mode.id) && (
          <>
            <button
              type="button"
              role="tab"
              className={workspace === "assets" ? "active" : ""}
              onClick={() => openWorkspace("assets")}
            >
              素材
            </button>
            <button
              type="button"
              role="tab"
              className={workspace === "products" ? "active" : ""}
              onClick={() => openWorkspace("products")}
            >
              商品库
            </button>
          </>
        )}
      </div>
      {pane === "settings" && (
        <nav
          className="mobile-tool-switch"
          aria-label="选择电商设计工具"
          data-commerce-page-motion-target
        >
          {mobileModes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === mode.id ? "active" : ""}
              disabled={taskLaunchPending && item.id !== mode.id}
              onClick={() => setMode(item)}
            >
              <i className={`bi ${item.icon}`} />
              <span>{t(item.shortLabel || item.label)}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="commerce-layout">
        <nav
          className={`commerce-rail${railEdges.start ? " is-at-start" : ""}${railEdges.end ? " is-at-end" : ""}`}
          aria-label="电商设计工具"
          data-commerce-page-motion-target
        >
          <div
            ref={railScroll}
            className="commerce-rail__scroll"
            onScroll={updateRail}
          >
            {railGroups.map((group, groupIndex) => (
              <div className="commerce-rail-react-group" key={group.id}>
                {groupIndex > 0 && (
                  <div
                    className="commerce-rail__rule"
                    role="separator"
                    aria-label={group.label}
                  />
                )}
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === mode.id ? "active" : ""}
                    aria-label={item.label}
                    aria-current={item.id === mode.id ? "page" : undefined}
                    disabled={taskLaunchPending && item.id !== mode.id}
                    onClick={() => setMode(item)}
                  >
                    <span className="commerce-rail__icon">
                      <i className={`bi ${item.icon}`} />
                    </span>
                    <span className="commerce-rail__label">
                      {t(item.shortLabel || item.label)}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>
        {hidesCommerceSettings(mode.id) ? (
          <>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept={ECOMMERCE_IMAGE_ACCEPT}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                if (
                  isShootMode(mode.id) ||
                  isAccessoryMode(mode.id) ||
                  isDetailMode(mode.id)
                ) {
                  addFiles(files);
                } else {
                  void (isHandheldMode(mode.id)
                    ? setHandheldSlot("product", files)
                    : setTryonSlot("garment", files));
                }
              }}
              multiple={isDetailMode(mode.id)}
            />
            <input
              ref={modelFileInput}
              hidden
              type="file"
              accept={ECOMMERCE_IMAGE_ACCEPT}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void (isHandheldMode(mode.id)
                  ? setHandheldSlot("model", files)
                  : setTryonSlot("model", files));
              }}
            />
            <input
              ref={sceneFileInput}
              hidden
              type="file"
              accept={ECOMMERCE_IMAGE_ACCEPT}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                void (isHandheldMode(mode.id)
                  ? setHandheldSlot("scene", files)
                  : setTryonSlot("scene", files));
              }}
            />
            <input
              ref={layoutFileInput}
              hidden
              type="file"
              accept={ECOMMERCE_IMAGE_ACCEPT}
              onChange={(event) => {
                const files = Array.from(event.target.files || []);
                event.target.value = "";
                if (isHandheldMode(mode.id))
                  void setHandheldSlot("layout", files);
              }}
            />
          </>
        ) : (
          <aside
            className={`commerce-settings${pane !== "settings" ? " is-mobile-hidden" : ""}`}
          >
            <div className="settings-scroll">
              <section className="settings-section">
                <div className="settings-heading settings-heading--source">
                  <h2>
                    {mode.uploadTitle || text.source}
                    <i
                      className="bi bi-question-circle"
                      title={mode.uploadHint || "同一商品可上传多个角度"}
                    />
                  </h2>
                </div>
                <div
                  className={`product-upload${previews.length ? " has-files" : ""}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    addFiles(event.dataTransfer.files);
                  }}
                >
                  {previews.length ? (
                    <div className="upload-grid">
                      {previews.map((item, index) => (
                        <figure key={`${item.url}-${index}`}>
                          <img
                            src={item.url}
                            alt={`${referenceLabel(index)}参考图`}
                          />
                          <span className="upload-role">
                            {referenceLabel(index)}
                          </span>
                          <button
                            type="button"
                            aria-label={`移除${referenceLabel(index)}参考图`}
                            onClick={() => removeFile(index)}
                          >
                            <i className="bi bi-x-lg" />
                          </button>
                        </figure>
                      ))}
                      {previews.length < 6 && (
                        <button
                          type="button"
                          className="upload-add"
                          aria-label="继续添加参考图"
                          onClick={() => fileInput.current?.click()}
                        >
                          <i className="bi bi-plus-lg" />
                        </button>
                      )}
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="upload-empty"
                      onClick={() => fileInput.current?.click()}
                    >
                      <i className="bi bi-cloud-arrow-up" />
                      <strong>上传参考图片</strong>
                      <small>
                        {mode.uploadHint || "支持 PNG、JPG、WebP，最多 6 张"}
                      </small>
                    </button>
                  )}
                  <input
                    ref={fileInput}
                    hidden
                    type="file"
                    accept={ECOMMERCE_IMAGE_ACCEPT}
                    multiple
                    onChange={(event) => {
                      addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </div>
                {mode.referenceLabels?.length ? (
                  <div className="upload-role-guide">
                    {mode.referenceLabels.slice(0, 2).map((label, index) => (
                      <span key={label}>
                        <b>{index + 1}</b>
                        <span>
                          <strong>{label}</strong>
                          <small>
                            {index < minimumFiles ? "必填" : "可选"}
                          </small>
                        </span>
                      </span>
                    ))}
                  </div>
                ) : null}
              </section>
              {selectedProduct && (
                <button
                  type="button"
                  className="selected-product-context"
                  onClick={() => openWorkspace("products")}
                >
                  <span>
                    <i className="bi bi-box-seam" />
                  </span>
                  <span>
                    <small>当前商品</small>
                    <strong>{selectedProduct.title}</strong>
                  </span>
                  <i className="bi bi-chevron-right" />
                </button>
              )}
              <section className="settings-section">
                <div className="settings-heading">
                  <h2>{text.settings}</h2>
                </div>
                <div className="select-row">
                  {selectFields
                    .filter((item) => fields.has(item.key))
                    .map((item) => (
                      <label key={item.key}>
                        <span>{t(item.label)}</span>
                        <CommerceSelect
                          value={item.value}
                          options={item.options}
                          onChange={item.set}
                          ariaLabel={item.aria}
                          disabled={jobs.running}
                        />
                      </label>
                    ))}
                </div>
                <div className="select-row select-row--output">
                  <label>
                    <span>{t("画面比例")}</span>
                    <CommerceSelect
                      value={aspectRatio}
                      options={OPTIONS.ratio}
                      onChange={setAspectRatio}
                      ariaLabel="选择画面比例"
                    />
                  </label>
                  {maxOutputCount > 1 && mode.id !== "listing" && (
                    <label>
                      <span>{t("生成张数")}</span>
                      <CommerceSelect
                        value={outputCount}
                        options={Array.from(
                          { length: maxOutputCount },
                          (_, index) => ({
                            value: index + 1,
                            label: `${index + 1} 张`,
                          }),
                        )}
                        onChange={setRequestedCount}
                        ariaLabel="选择生成张数"
                      />
                    </label>
                  )}
                  <label>
                    <span>{t("生成模型")}</span>
                    <CommerceSelect
                      value={modelId}
                      options={commerceModelOptions(models, unitPrice)}
                      onChange={setModelId}
                      placeholder="请选择模型"
                      ariaLabel="选择生成模型"
                      menuMinWidth={240}
                    />
                  </label>
                </div>
                {creativeFields.some((item) => fields.has(item.key)) && (
                  <div className="select-row select-row--creative">
                    {creativeFields
                      .filter((item) => fields.has(item.key))
                      .map((item) => (
                        <label key={item.key}>
                          <span>{t(item.label)}</span>
                          <CommerceSelect
                            value={item.value}
                            options={item.options}
                            onChange={item.set}
                            ariaLabel={item.aria}
                          />
                        </label>
                      ))}
                  </div>
                )}
              </section>
              {mode.id === "clone" ? (
                <CloneBusinessSettings
                  cloneType={cloneType}
                  cloneFidelity={cloneFidelity}
                  onChangeType={setCloneType}
                  onChangeFidelity={setCloneFidelity}
                />
              ) : null}
              {!hidesCommerceSettings(mode.id) && (
                <section className="settings-section">
                  <div className="settings-heading settings-heading--brief">
                    <h2>
                      {["listing", "detail", "campaign"].includes(mode.id)
                        ? "商品卖点与要求"
                        : "补充要求"}
                    </h2>
                    <button
                      type="button"
                      className="brief-organize"
                      onClick={generateBrief}
                    >
                      <i className="bi bi-stars" />
                      AI 生成
                    </button>
                  </div>
                  <label className="text-field">
                    <span>
                      {mode.id === "tryon"
                        ? "服装名称"
                        : mode.id === "accessory"
                          ? "饰品名称"
                          : "商品名称"}
                    </span>
                    <input
                      value={productName}
                      onChange={(event) => setProductName(event.target.value)}
                      placeholder="例如：无线降噪蓝牙耳机"
                    />
                  </label>
                  <label className="text-field">
                    <span>核心卖点</span>
                    <textarea
                      value={sellingPoints}
                      onChange={(event) => setSellingPoints(event.target.value)}
                      placeholder="填写核心卖点、适用人群、期望场景和具体参数…"
                    />
                    <small>{sellingPoints.length}/1200</small>
                  </label>
                  <button
                    type="button"
                    className={`text-stability-control${textStable ? " active" : ""}`}
                    role="switch"
                    aria-checked={textStable}
                    onClick={() => setTextStable((value) => !value)}
                  >
                    <span>
                      <i className="bi bi-fonts" />
                    </span>
                    <span>
                      <strong>文字稳定性</strong>
                      <small>锁定已提供文案，无法可靠生成时优先留白</small>
                    </span>
                    <i className="text-stability-switch">
                      <b />
                    </i>
                  </button>
                </section>
              )}
              {mode.id === "listing" ? (
                <ListingBusinessSettings
                  structureMode={structureMode}
                  counts={counts}
                  allocatedCount={customBlueprints.length}
                  onChangeStructureMode={setStructureMode}
                  onChangeCounts={setCounts}
                />
              ) : null}
              {fields.has("modules") && mode.id !== "listing" && (
                <section className="settings-section modules-section">
                  <h2>
                    视觉模块 <small>多选</small>
                  </h2>
                  <div className="module-grid">
                    {(mode.id === "detail"
                      ? ECOMMERCE_DETAIL_MODULES
                      : ECOMMERCE_MODULES
                    ).map((item) => (
                      <label key={item.value}>
                        <input
                          type="checkbox"
                          value={item.value}
                          checked={selectedModules.includes(item.value)}
                          disabled={item.value === "angles" && files.length < 2}
                          onChange={(event) =>
                            setSelectedModules((current) =>
                              event.target.checked
                                ? [...current, item.value]
                                : current.filter(
                                    (value) => value !== item.value,
                                  ),
                            )
                          }
                        />
                        <span className="module-check">
                          <i className="bi bi-check" />
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>
                            {item.value === "angles" && files.length < 2
                              ? "需要至少 2 张角度参考"
                              : item.hint}
                          </small>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              )}
              {!hidesCommerceSettings(mode.id) && (
                <section className="settings-section shot-plan-section">
                  <div className="settings-heading">
                    <h2>本次出图结构</h2>
                    <span>
                      {generationPlan.length} 张
                      {generationPlan.length > 1 ? " · 首张后并行" : ""}
                    </span>
                  </div>
                  <ol className="shot-plan-list">
                    {generationPlan.map((item, index) => (
                      <li key={item.viewId}>
                        <span>{index + 1}</span>
                        <div>
                          <strong>{item.viewLabel.split(" · ").pop()}</strong>
                          <small>{blueprints[index]?.direction}</small>
                        </div>
                      </li>
                    ))}
                  </ol>
                  {generationPlan.length > 1 && (
                    <p className="series-lock-note">
                      <i className="bi bi-link-45deg" />
                      首张锁定系列视觉后，其余图片并行生成
                    </p>
                  )}
                </section>
              )}
            </div>
            <footer className="generate-bar">
              <div className="generate-meta">
                <span className={canGenerate ? "ready" : ""}>
                  <i
                    className={`bi ${canGenerate ? "bi-check-circle-fill" : "bi-info-circle"}`}
                  />
                  {readiness}
                </span>
                <strong>{detailedCostLabel}</strong>
              </div>
              {boardError && <p>{boardError}</p>}
              {jobs.running ? (
                <button
                  type="button"
                  className="cancel-button"
                  disabled={jobs.cancelling}
                  onClick={jobs.cancelAll}
                >
                  <i className="bi bi-stop-circle" />
                  停止生成
                </button>
              ) : (
                <button
                  type="button"
                  className="generate-button"
                  disabled={auth.isAuthenticated && !canGenerate}
                  title={readiness}
                  onClick={generate}
                >
                  <i className="bi bi-images" />
                  一键生成{mode.label}（{generationPlan.length}张）
                </button>
              )}
            </footer>
          </aside>
        )}
        <section
          ref={canvasRef}
          className={`commerce-canvas${pane !== "canvas" ? " is-mobile-hidden" : ""}`}
        >
          {workspace === "operations" ? (
            <CommerceOperationsWorkspace
              english={localStorage.getItem("starclouds-locale") === "en"}
              tasks={jobs.tasks}
              historyLoading={jobs.historyLoading}
              onRefresh={jobs.refreshHistory}
              onPreview={setPreviewUrl}
              onOpenProducts={() => openWorkspace("products")}
              onOpenAssets={() => openWorkspace("assets")}
              onStartMode={(modeId) => setMode(ecommerceModeById(modeId))}
            />
          ) : workspace === "products" ? (
            <CommerceProductLibrary
              english={localStorage.getItem("starclouds-locale") === "en"}
              selectedProductId={selectedProduct?.id || ""}
              onSelect={applyProduct}
              onClearProduct={() => setSelectedProduct(null)}
              onClose={() => openWorkspace("result")}
            />
          ) : workspace === "history" ? (
            <section className="workspace-library">
              <header className="workspace-library__header">
                <div>
                  <span className="workspace-library__icon">
                    <i className="bi bi-clock-history" />
                  </span>
                  <span>
                    <small>
                      {isAccessoryMode(mode.id) ? "饰品穿戴" : "AI 电商资产"}
                    </small>
                    <strong>
                      {isAccessoryMode(mode.id)
                        ? "饰品生成历史"
                        : "电商生成历史"}
                    </strong>
                  </span>
                </div>
                <div className="workspace-library__tools">
                  <button
                    type="button"
                    className="workspace-icon-button"
                    aria-label="刷新历史"
                    onClick={jobs.refreshHistory}
                  >
                    <i className="bi bi-arrow-clockwise" />
                  </button>
                </div>
              </header>
              <div className="workspace-library__body">
                {jobs.historyError && (
                  <div className="workspace-library__inline-error" role="alert">
                    <span>
                      <i className="bi bi-exclamation-circle" />
                      {jobs.historyError}
                    </span>
                    <button type="button" onClick={jobs.refreshHistory}>
                      <i className="bi bi-arrow-clockwise" />
                      重试
                    </button>
                  </div>
                )}
                {modeRows.length ? (
                  <div className="asset-grid">
                    {modeRows.map((row) => (
                      <article key={row.url} className="asset-card">
                        <button
                          type="button"
                          className="asset-card__media"
                          onClick={() => {
                            setActiveUrl(row.url);
                            openWorkspace("result");
                          }}
                        >
                          <AuthenticatedImage
                            src={row.preview}
                            alt="电商历史结果"
                            maxDimension={420}
                          />
                          <span>V1</span>
                        </button>
                        <div className="asset-card__copy">
                          <strong>
                            {ecommerceModeById(outputModeId(row)).shortLabel}
                          </strong>
                          <small>01/01 08:01</small>
                        </div>
                        <div className="asset-card__actions">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveUrl(row.url);
                              openWorkspace("result");
                            }}
                          >
                            <i className="bi bi-eye" />
                            查看
                          </button>
                          <button
                            type="button"
                            className="primary"
                            onClick={() => useRemote(row.url)}
                          >
                            <i className="bi bi-plus-circle" />
                            作为参考
                          </button>
                          <button
                            type="button"
                            className="danger"
                            aria-label={`删除${ecommerceModeById(outputModeId(row)).shortLabel}历史记录`}
                            onClick={() => setDeleteRow(row)}
                          >
                            <i className="bi bi-trash3" />
                            删除
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  !jobs.historyError &&
                  !jobs.historyLoading && (
                    <div className="workspace-empty">
                      <span>
                        <i className="bi bi-clock-history" />
                      </span>
                      <strong>还没有{mode.label}记录</strong>
                      <small>完成生成后，成品会自动保存在这里</small>
                      <button
                        type="button"
                        onClick={() => openWorkspace("result")}
                      >
                        开始创作
                      </button>
                    </div>
                  )
                )}
              </div>
            </section>
          ) : workspace === "assets" ? (
            <section className="workspace-library">
              <header className="workspace-library__header">
                <div>
                  <span className="workspace-library__icon">
                    <i className="bi bi-collection" />
                  </span>
                  <span>
                    <small>个人资源库</small>
                    <strong>资产与素材</strong>
                  </span>
                </div>
                <Link to="/assets" className="workspace-manage-link">
                  管理素材
                </Link>
              </header>
              <div className="workspace-library__body">
                {assets.loading ? (
                  <div className="asset-skeleton-grid">
                    {Array.from({ length: 8 }, (_, index) => (
                      <span key={index} />
                    ))}
                  </div>
                ) : assets.items.length ? (
                  <div className="asset-grid">
                    {assets.items.map((asset) => (
                      <article key={asset.id} className="asset-card">
                        <button
                          type="button"
                          className="asset-card__media"
                          onClick={() => useRemote(asset.url, asset.title)}
                        >
                          <AuthenticatedImage
                            src={asset.thumbnailUrl || asset.url}
                            alt={asset.title || "个人素材"}
                          />
                        </button>
                        <div className="asset-card__copy">
                          <strong>{asset.title || "未命名素材"}</strong>
                          <small>图片</small>
                        </div>
                        <div className="asset-card__actions asset-card__actions--single">
                          <button
                            type="button"
                            className="primary"
                            onClick={() => useRemote(asset.url, asset.title)}
                          >
                            加入参考图
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="workspace-empty">
                    <span>
                      <i className="bi bi-images" />
                    </span>
                    <strong>这个分组还没有素材</strong>
                    <small>可前往素材管理上传商品、人物或场景参考图</small>
                    <Link to="/assets">去管理资产</Link>
                  </div>
                )}
              </div>
            </section>
          ) : showResultBoard && !hidesCommerceSettings(mode.id) ? (
            <div
              className={`result-workspace${jobs.running ? " is-generating" : ""}${!currentRow && !jobs.running ? " is-planned" : ""}`}
            >
              {jobs.running && (
                <div
                  className={`result-progress${completedCount === 0 ? " is-indeterminate" : ""}`}
                  aria-hidden="true"
                >
                  <i
                    style={{
                      width: `${Math.max(8, Math.round(progressRatio * 100))}%`,
                    }}
                  />
                </div>
              )}
              <header>
                <div>
                  <span>{mode.label}</span>
                  <strong aria-live="polite">
                    {jobs.running
                      ? `正在生成 ${completedCount}/${displayCount}`
                      : failedCount
                        ? `${completedCount}/${displayCount} 完成，${failedCount} 张失败`
                        : currentRow
                          ? blueprints[currentRow.index]?.label ||
                            mode.shortLabel
                          : `待生成 ${displayCount} 张`}
                  </strong>
                </div>
                <div className="result-header-actions">
                  {jobs.running ? (
                    <button
                      type="button"
                      aria-label="停止生成"
                      onClick={jobs.cancelAll}
                      disabled={jobs.cancelling}
                    >
                      <i className="bi bi-stop-circle" />
                    </button>
                  ) : currentRow ? (
                    <>
                      <span className="version-badge">V{currentVersion}</span>
                      <button
                        type="button"
                        aria-label="放大查看当前结果"
                        onClick={() => openImagePreview(currentRow.url)}
                      >
                        <i className="bi bi-arrows-fullscreen" />
                      </button>
                      <button
                        type="button"
                        aria-label="局部编辑当前结果"
                        onClick={() => setMaskRow(currentRow)}
                      >
                        <i className="bi bi-brush" />
                      </button>
                      <button
                        type="button"
                        aria-label="下载当前结果"
                        onClick={() => downloadOutput(currentRow)}
                      >
                        <i className="bi bi-download" />
                      </button>
                    </>
                  ) : null}
                </div>
              </header>
              <div
                className={`result-main${revisionOpen ? " revision-is-open" : ""}`}
              >
                <div
                  className={`result-stage ${layoutClass}${hidesCommerceSettings(mode.id) ? " is-ratio-locked" : ""}`}
                  data-count={slots.length}
                  data-ratio={
                    hidesCommerceSettings(mode.id) ? shotRatio : undefined
                  }
                  style={
                    hidesCommerceSettings(mode.id) ? shotRatioStyle : undefined
                  }
                >
                  {slots.map((slot, index) => {
                    const row = slot.row;
                    const shotLabel =
                      generationPlan[index]?.viewLabel.split(" · ").pop() ||
                      blueprints[index]?.label ||
                      "";
                    return (
                      <article
                        key={`${liveGroupId || "pending"}-${index}`}
                        className={`result-image-card${row?.url && row.url === currentRow?.url ? " active" : ""}${row && loaded.has(row.url) ? " loaded" : ""}${row ? "" : " is-pending"}${slot.failed ? " is-failed" : ""}`}
                        style={
                          mode.id === "tryon" ||
                          mode.id === "handheld" ||
                          displayCount <= 1
                            ? {
                                aspectRatio: (
                                  row?.aspectRatio || aspectRatio
                                ).replace(":", " / "),
                              }
                            : undefined
                        }
                      >
                        {row ? (
                          <button
                            type="button"
                            data-click-guard="off"
                            className="result-image-hit-area"
                            aria-label={`查看第 ${index + 1} 张结果细节`}
                            onClick={() => setActiveUrl(row.url)}
                            onDoubleClick={() => openImagePreview(row.url)}
                          >
                            <span className="result-image-skeleton" />
                            <AuthenticatedImage
                              src={row.display || row.url}
                              fallbackSrc={row.url}
                              alt={`${mode.label}第 ${index + 1} 张生成结果`}
                              loading="eager"
                              maxDimension={1600}
                              onLoad={() =>
                                setLoaded(
                                  (value) => new Set([...value, row.url]),
                                )
                              }
                              onError={() =>
                                setLoaded((value) => {
                                  const next = new Set(value);
                                  next.delete(row.url);
                                  return next;
                                })
                              }
                            />
                            <span className="result-image-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <small className="result-image-label">
                              {shotLabel}
                            </small>
                          </button>
                        ) : slot.failed ? (
                          <div className="result-image-failed">
                            <span className="result-image-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <strong>生成失败</strong>
                            <small>
                              {slot.error || shotLabel || "请重试这一张"}
                            </small>
                            <button
                              type="button"
                              onClick={() => retrySlot(index)}
                              disabled={jobs.running || !canGenerate}
                            >
                              重试
                            </button>
                          </div>
                        ) : (
                          <div className="result-image-pending">
                            <span className="result-image-skeleton" />
                            <span className="result-image-index">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <small>{shotLabel || "等待结果"}</small>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
                <aside
                  className={`revision-panel${revisionOpen ? " open" : ""}`}
                  aria-label="继续调整当前成品"
                >
                  <header>
                    <button
                      type="button"
                      className="revision-panel__toggle"
                      aria-label={
                        revisionOpen ? "收起连续优化" : "展开连续优化"
                      }
                      aria-expanded={revisionOpen}
                      disabled={jobs.running}
                      onClick={() => setRevisionOpen((value) => !value)}
                    >
                      <i
                        className={`bi ${revisionOpen ? "bi-chevron-right" : "bi-sliders2"}`}
                      />
                    </button>
                    <div className="revision-panel__title">
                      <small>连续优化</small>
                      <strong>继续调整当前成品</strong>
                    </div>
                  </header>
                  {revisionOpen && (
                    <div className="revision-panel__body">
                      <p>只描述这一轮需要改变的内容，未提及部分会继续锁定。</p>
                      <div className="version-lineage">
                        {Array.from({ length: currentVersion }, (_, index) => (
                          <span
                            key={index + 1}
                            className={
                              index + 1 === currentVersion ? "active" : ""
                            }
                          >
                            V{index + 1}
                          </span>
                        ))}
                      </div>
                      <label className="revision-field">
                        <span>调整方向</span>
                        <CommerceSelect
                          value={revisionDirection}
                          options={ECOMMERCE_REVISION_DIRECTIONS}
                          onChange={setRevisionDirection}
                          ariaLabel="选择调整方向"
                        />
                      </label>
                      <label className="revision-field revision-field--brief">
                        <span>本轮只修改</span>
                        <textarea
                          value={revisionBrief}
                          onChange={(event) =>
                            setRevisionBrief(event.target.value)
                          }
                          placeholder="例如：商品再放大 15%，背景改为浅灰影棚，其他内容保持不变"
                        />
                        <small>{revisionBrief.length}/600</small>
                      </label>
                      <div className="revision-submit-meta">
                        <span>
                          <i className="bi bi-shield-check" />
                          上一版本会保留
                        </span>
                        <strong>{unitPrice} 积分</strong>
                      </div>
                      <button
                        type="button"
                        className="revision-submit"
                        disabled={
                          revisionBrief.trim().length < 4 || jobs.running
                        }
                        onClick={reviseCurrent}
                      >
                        <i className="bi bi-arrow-repeat" />
                        生成 V{currentVersion + 1}
                      </button>
                    </div>
                  )}
                </aside>
              </div>
              {modeRows.length > 0 && (
                <div className="result-strip" role="list" aria-label="生成历史">
                  {modeRows.map((row) => (
                    <div
                      key={row.url}
                      className="result-strip__item"
                      role="listitem"
                    >
                      <button
                        type="button"
                        className={`result-strip__select${row.url === currentRow?.url ? " active" : ""}`}
                        onClick={() => setActiveUrl(row.url)}
                      >
                        <AuthenticatedImage
                          src={row.preview}
                          alt=""
                          maxDimension={180}
                        />
                        <span className="result-shot-index">
                          {String(row.index + 1).padStart(2, "0")} · V
                          {rowVersion(row)}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="result-delete"
                        aria-label={`删除第 ${row.index + 1} 张结果，第 ${rowVersion(row)} 版`}
                        onClick={() => setDeleteRow(row)}
                      >
                        <i className="bi bi-trash3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : isTryonMode(mode.id) ? (
            <TryonLiveStage
              aspectRatio={shotRatio}
              ratioStyle={shotRatioStyle}
              apparel={apparel}
              apparelOptions={OPTIONS.tryonApparel}
              onChangeApparel={setApparel}
              garment={tryonSlots.garment}
              modelImage={tryonModelPreview}
              modelLabel={tryonModelLabel}
              scene={tryonSceneLabel}
              sceneImage={tryonScenePreview}
              resultUrl={tryonResultUrl}
              history={modeRows}
              running={tryonBusy}
              failed={tryonRunFailed && !activeUrl}
              failCancelled={tryonFailCancelled}
              failMessage={
                tryonFailMessage.length > 88
                  ? `${tryonFailMessage.slice(0, 88)}…`
                  : tryonFailMessage
              }
              elapsedSeconds={ecommerceElapsedSeconds(tryonTimingTask)}
              runStartedAt={tryonTimingTask?.startedAt || ""}
              cancelling={jobs.cancelling}
              generateDisabled={auth.isAuthenticated && !canGenerate}
              generateHint={readiness}
              shotCount={generationPlan.length}
              onGenerate={generate}
              onCancel={jobs.cancelAll}
              onSelectHistory={selectTryonHistory}
              onResultImageSize={applyTryonImageSize}
              editBrief={tryonBrief}
              editMentions={tryonMentions}
              onChangeEdit={updateCurrentTryonBrief}
              revisionReady={Boolean(tryonBrief.trim())}
              onPreview={(event, payload) =>
                setTryonPreview({
                  // 点开大图优先展示图，404 回退原图
                  url: rowsByUrl.get(payload.url)?.display || payload.url,
                  fallbackUrl: rowsByUrl.has(payload.url) ? payload.url : "",
                  alt: payload.alt,
                  title: payload.title,
                  origin: previewOriginFromEvent(event),
                })
              }
              onUploadGarment={() => fileInput.current?.click()}
              onDropSlot={(role, files) => void setTryonSlot(role, files)}
              uploadNotice={tryonUploadNotice}
              modelPicker={
                <TryonChoicePicker
                  groupAria="选择模特"
                  uploadLabel="模特"
                  moreAria="更多模特"
                  popupTitle="选择模特"
                  popupHint="选择模特，画布会同步更新"
                  popupTitleId="tryon-model-popup-title"
                  popupKind="model"
                  closeScrimLabel="关闭模特选择"
                  catalog={tryonModelCatalog}
                  featured={featuredTryonModel}
                  source={tryonSlots.model?.source || ""}
                  disabled={jobs.running || tryonModelBusy}
                  onPickUpload={() => modelFileInput.current?.click()}
                  onSelectBuiltin={applyBuiltinTryonModel}
                />
              }
              scenePicker={
                <TryonChoicePicker
                  groupAria="选择拍摄场景"
                  uploadLabel="场景"
                  moreAria="更多场景"
                  popupTitle="选择拍摄场景"
                  popupHint="选择场景，画布会同步更新"
                  popupTitleId="tryon-scene-popup-title"
                  popupKind="scene"
                  closeScrimLabel="关闭拍摄场景选择"
                  catalog={tryonSceneCatalog}
                  featured={featuredTryonScene}
                  source={tryonSlots.scene?.source || ""}
                  disabled={jobs.running || tryonSceneBusy}
                  onPickUpload={() => sceneFileInput.current?.click()}
                  onSelectBuiltin={applyBuiltinTryonScene}
                />
              }
              garmentPicker={
                tryonGarmentCatalog.length && featuredTryonGarment ? (
                  <TryonChoicePicker
                    groupAria="选择服装"
                    uploadLabel="服装"
                    moreAria="更多服装"
                    popupTitle="选择服装"
                    popupHint="选择默认服装，或自行上传"
                    popupTitleId="tryon-garment-popup-title"
                    popupKind="garment"
                    closeScrimLabel="关闭服装选择"
                    catalog={tryonGarmentCatalog}
                    featured={featuredTryonGarment}
                    source={tryonSlots.garment?.source || ""}
                    disabled={jobs.running || tryonGarmentBusy}
                    onPickUpload={() => fileInput.current?.click()}
                    onSelectBuiltin={applyBuiltinTryonGarment}
                  >
                    <label className="tryon-stage__apparel">
                      <CommerceSelect
                        value={apparel}
                        options={OPTIONS.tryonApparel}
                        onChange={setApparel}
                        ariaLabel="选择衣服类型"
                        menuMinWidth={132}
                        disabled={jobs.running}
                      />
                    </label>
                  </TryonChoicePicker>
                ) : null
              }
            />
          ) : isHandheldMode(mode.id) ? (
            <HandheldStudio
              product={handheldSlots.product}
              layout={handheldSlots.layout}
              modelImage={handheldModelPreview}
              modelCatalog={handheldModelCatalog}
              featuredModel={
                handheldSlots.model?.source === "builtin" &&
                handheldCropNeedsPerson(handheldCrop)
                  ? featuredHandheldModel
                  : null
              }
              modelSource={handheldSlots.model?.source || ""}
              handCatalog={handheldHandCatalog}
              featuredHand={
                handheldSlots.model?.source === "builtin" &&
                !handheldCropNeedsPerson(handheldCrop)
                  ? featuredHandheldHand
                  : null
              }
              onSelectHand={applyBuiltinHandheldHand}
              sceneImage={handheldScenePreview}
              sceneCatalog={handheldSceneCatalog}
              featuredScene={
                handheldSlots.scene?.source === "builtin"
                  ? featuredHandheldScene
                  : null
              }
              sceneSource={handheldSlots.scene?.source || ""}
              crop={handheldCrop}
              cropOptions={HANDHELD_CROP_OPTIONS}
              onChangeCrop={setHandheldCrop}
              pack={handheldPack}
              packOptions={HANDHELD_PACK_OPTIONS}
              onChangePack={setHandheldPack}
              platform={handheldPlatform}
              platformOptions={HANDHELD_PLATFORM_OPTIONS}
              onChangePlatform={(id) => {
                setHandheldPlatform(id);
                const option = handheldPlatformById(id);
                if (option.ratio) setAspectRatio(option.ratio);
              }}
              aspectRatio={shotRatio}
              ratioStyle={shotRatioStyle}
              resultUrl={handheldResultUrl}
              shots={handheldViewBlueprints.map((shot, index) => {
                const promptRules = handheldPromptForShot(shot, index);
                const row = liveGroup.find((item) => item.index === index);
                const task = handheldSessionTasks.find(
                  (item) => Number(item.batchIndex) === index,
                );
                const status = String(task?.status || "").toLowerCase();
                const slotFailed = ["failed", "canceled", "cancelled"].includes(
                  status,
                );
                const slotRunning = [
                  "queued",
                  "running",
                  "waiting_provider",
                ].includes(status);
                return {
                  id: shot.id || `shot-${index}`,
                  label: shot.label,
                  url: row?.url || "",
                  preview: row?.preview || row?.url || "",
                  running:
                    slotRunning ||
                    Boolean(handheldRetryingByIndex[index]) ||
                    (handheldStarting && index === 0 && !task && !row),
                  failed: slotFailed,
                  error: task?.error || "",
                  startedAt:
                    task?.startedAt ||
                    task?.createdAt ||
                    row?.task?.startedAt ||
                    row?.task?.createdAt ||
                    "",
                  elapsedSeconds: ecommerceElapsedSeconds(task || row?.task),
                  basePrompt: promptRules.basePrompt,
                  prompt: promptRules.prompt,
                };
              })}
              history={modeRows}
              shotLabels={generationPlan.map((item) =>
                item.viewLabel.split(" · ").pop(),
              )}
              running={handheldBusy}
              failed={handheldRunFailed && !activeUrl}
              failCancelled={handheldFailCancelled}
              failMessage={
                handheldFailMessage.length > 88
                  ? `${handheldFailMessage.slice(0, 88)}…`
                  : handheldFailMessage
              }
              elapsedSeconds={ecommerceElapsedSeconds(currentRow?.task)}
              generateDisabled={auth.isAuthenticated && !canGenerate}
              generateHint={readiness}
              shotCount={generationPlan.length}
              costLabel={costLabel}
              shotCostLabel={`${unitPrice} 积分`}
              onGenerate={generate}
              onRetryShot={retryHandheldShot}
              onSelectHistory={selectHandheldHistory}
              onPreview={(event, payload) =>
                setHandheldPreview({
                  // 点开大图优先展示图，404 回退原图
                  url: rowsByUrl.get(payload.url)?.display || payload.url,
                  fallbackUrl: rowsByUrl.has(payload.url) ? payload.url : "",
                  alt: payload.alt,
                  title: payload.title,
                  origin: previewOriginFromEvent(event),
                })
              }
              onUploadProduct={() => fileInput.current?.click()}
              onUploadModel={() => modelFileInput.current?.click()}
              onUploadScene={() => sceneFileInput.current?.click()}
              onUploadLayout={() => layoutFileInput.current?.click()}
              onClearLayout={() => clearHandheldSlot("layout")}
              onClearModel={() => clearHandheldSlot("model")}
              onClearScene={() => clearHandheldSlot("scene")}
              onSelectModel={applyBuiltinHandheldModel}
              onSelectScene={applyBuiltinHandheldScene}
              onDropProduct={(files) => void setHandheldSlot("product", files)}
              onMaskEdit={(url) => {
                const row =
                  modeRows.find((item) => item.url === url) || currentRow;
                if (row) setMaskRow(row);
              }}
              actionBusy={handheldActionBusy}
              onSaveAsset={(url) => void saveCurrentHandheldAsset(url)}
              onChangePrompt={({ shotId, basePrompt, prompt }) => {
                setHandheldPromptEdits((current) => ({
                  ...current,
                  [shotId]: { basePrompt, prompt },
                }));
              }}
              annotations={handheldAnnotations}
              onChangeAnnotations={setHandheldAnnotations}
              needsPerson={handheldCropNeedsPerson(handheldCrop)}
              uploadNotice={handheldUploadNotice}
            />
          ) : isAccessoryMode(mode.id) ? (
            <AccessoryStudio
              references={accessoryReferencesFromSlots(accessorySlots)}
              aspectRatio={shotRatio}
              ratioStyle={shotRatioStyle}
              onChangeRatio={setAspectRatio}
              resultUrl={currentRow?.url || ""}
              history={modeRows}
              pack={accessoryPack}
              packOptions={ACCESSORY_PACK_OPTIONS}
              onChangePack={setAccessoryPack}
              crop={accessoryCrop}
              cropOptions={ACCESSORY_CROP_OPTIONS}
              onChangeCrop={setAccessoryCrop}
              running={jobs.running}
              failed={Boolean((submitError || jobs.error) && !currentRow)}
              failMessage={submitError || jobs.error || ""}
              notice={accessoryNotice}
              elapsedSeconds={ecommerceElapsedSeconds(currentRow?.task)}
              generateDisabled={auth.isAuthenticated && !canGenerate}
              generateHint={readiness}
              shotCount={generationPlan.length}
              costLabel={costLabel}
              onGenerate={generate}
              onCancel={jobs.cancelAll}
              onUploadSlot={requestAccessoryUpload}
              onRemoveReference={(role) => clearAccessorySlot(role)}
              onDropSlot={(role, files) => {
                accessoryUploadRoleRef.current = role;
                void setAccessorySlot(role, files);
              }}
              sceneIgnoredWithoutModel={
                accessoryPresence.sceneIgnoredWithoutModel
              }
              onSelectHistory={selectAccessoryHistory}
              onPreview={setPreviewUrl}
              onResultPreview={(event, payload) =>
                setAccessoryPreview({
                  // 点开大图优先展示图，404 回退原图
                  url: rowsByUrl.get(payload.url)?.display || payload.url,
                  fallbackUrl: rowsByUrl.has(payload.url) ? payload.url : "",
                  alt: payload.alt,
                  title: payload.title,
                  origin: previewOriginFromEvent(event),
                })
              }
              onMaskEdit={currentRow ? () => setMaskRow(currentRow) : undefined}
              onDownload={
                currentRow ? () => downloadOutput(currentRow) : undefined
              }
              actionBusy={accessoryActionBusy}
              onSaveAsset={
                currentRow ? () => void saveCurrentAccessoryAsset() : undefined
              }
              onDownloadPack={
                currentGroup.length > 1
                  ? () => void downloadAccessoryPack()
                  : undefined
              }
              cancelling={jobs.cancelling}
            />
          ) : isDetailMode(mode.id) ? (
            <DetailStudio
              previews={previews}
              modules={ECOMMERCE_DETAIL_MODULES}
              selectedModules={selectedModules}
              onToggleModule={(value) =>
                setSelectedModules((current) =>
                  current.includes(value)
                    ? current.filter((item) => item !== value)
                    : [...current, value],
                )
              }
              aplus={{
                asin: aplusAsin,
                onChangeAsin: setAplusAsin,
                competitorAsin: aplusCompetitorAsin,
                onChangeCompetitorAsin: setAplusCompetitorAsin,
                categoryId: aplusCategoryId,
                categoryLabel: aplusCategory.label,
                onChangeCategory: (id) => {
                  setAplusCategoryId(id);
                  setAplusLivePlan(null);
                  setAplusAnalyzeError("");
                },
                marketplaceId: aplusMarketplaceId,
                marketplaceLabel: aplusMarketplace.label,
                language: aplusMarketplace.language,
                onChangeMarketplace: (id) => {
                  const next = aplusMarketplaceById(id);
                  setAplusMarketplaceId(id);
                  setAplusLivePlan(null);
                  setAplusAnalyzeError("");
                  setLanguage(next.language);
                  setPlatform("Amazon");
                  setMarket(
                    next.id === "CN"
                      ? "中国大陆"
                      : next.id === "UK"
                        ? "英国"
                        : next.id === "DE"
                          ? "德国"
                          : next.id === "JP"
                            ? "日本"
                            : "美国",
                  );
                },
                tier: aplusTier,
                onChangeTier: (id) => {
                  setAplusTier(id);
                  setAplusLivePlan(null);
                  setAplusAnalyzeError("");
                },
                disclosure: aplusDisclosure,
                onChangeDisclosure: setAplusDisclosure,
                batchText: aplusBatchText,
                onChangeBatchText: (value) => {
                  setAplusBatchText(value);
                  const asins = parseAplusAsinList(value);
                  if (asins[0] && !aplusAsin) setAplusAsin(asins[0]);
                },
                plan: aplusPlan,
                analyzed: Boolean(aplusLivePlan?.modules?.length),
                planning: aplusPlanning,
                analyzeError: aplusAnalyzeError,
                onAnalyze: analyzeAplus,
                analyzeDisabled:
                  auth.isAuthenticated &&
                  (!inputFiles.length || aplusPlanning || jobs.running),
                analyzeHint: inputFiles.length ? "" : "还需上传商品图",
              }}
              resultUrl={currentRow?.url || ""}
              history={modeRows}
              running={jobs.running}
              failed={Boolean((submitError || jobs.error) && !currentRow)}
              failMessage={submitError || jobs.error || ""}
              elapsedSeconds={ecommerceElapsedSeconds(currentRow?.task)}
              generateDisabled={auth.isAuthenticated && !canGenerate}
              generateHint={readiness}
              shotCount={generationPlan.length}
              costLabel={costLabel}
              generateLabel={`一键生成${mode.label}`}
              onGenerate={generate}
              onCancel={jobs.cancelAll}
              onUpload={() => fileInput.current?.click()}
              onRemoveFile={removeFile}
              onDropFiles={addFiles}
              onSelectHistory={setActiveUrl}
              onPreview={setPreviewUrl}
              onResultPreview={(event, payload) =>
                openImagePreview(payload?.url || "")
              }
              onMaskEdit={currentRow ? () => setMaskRow(currentRow) : undefined}
              onDownload={
                currentRow ? () => downloadOutput(currentRow) : undefined
              }
              onExport={
                currentGroup.length ? () => void exportAplusPack() : undefined
              }
              cancelling={jobs.cancelling}
              showcaseSrc={detailPreview}
              showcaseAlt="详情页案例预览"
              revision={
                currentRow
                  ? {
                      available: true,
                      open: revisionOpen,
                      onToggle: () => setRevisionOpen((value) => !value),
                      direction: revisionDirection,
                      directionOptions: ECOMMERCE_REVISION_DIRECTIONS,
                      onChangeDirection: setRevisionDirection,
                      brief: revisionBrief,
                      onChangeBrief: setRevisionBrief,
                      onSubmit: reviseCurrent,
                      version: currentVersion,
                    }
                  : { available: false }
              }
            />
          ) : mode.id === "shoot" ? (
            <CreativeShootWorkspace
              english={localStorage.getItem("starclouds-locale") === "en"}
              productSources={previews.map((item) => item.url)}
              productName={productName}
              sellingPoints={sellingPoints}
              useCase={shootUseCase}
              goal={shootGoal}
              audience={shootAudience}
              platform={platform}
              platformOptions={OPTIONS.platform}
              sku={shootSku}
              protectedElements={shootProtectedElements}
              shots={shootShotIds}
              scene={scene}
              tone={tone}
              market={market}
              marketOptions={OPTIONS.market}
              aspectRatio={aspectRatio}
              outputCount={outputCount}
              models={models}
              modelId={modelId}
              plan={generationPlan}
              readiness={readiness}
              costLabel={detailedCostLabel}
              generateDisabled={auth.isAuthenticated && !canGenerate}
              onUpload={() => fileInput.current?.click()}
              onOpenProducts={() => openWorkspace("products")}
              onRemoveProduct={removeFile}
              onProductNameChange={setProductName}
              onSellingPointsChange={setSellingPoints}
              onUseCaseChange={setShootUseCase}
              onGoalChange={setShootGoal}
              onAudienceChange={setShootAudience}
              onPlatformChange={setPlatform}
              onSkuChange={setShootSku}
              onProtectedElementsChange={setShootProtectedElements}
              onToggleShot={toggleShootShot}
              onMoveShot={moveShootShot}
              onSelectDirection={(nextScene, nextTone) => {
                setScene(nextScene);
                setTone(nextTone);
              }}
              onAspectRatioChange={setAspectRatio}
              onMarketChange={setMarket}
              onModelChange={setModelId}
              onGenerate={generate}
            />
          ) : (
            <div className="canvas-empty">
              <div className="canvas-intro">
                <div>
                  <h1>{mode.label}</h1>
                  <p>{preview.description}</p>
                </div>
              </div>
              <div className="canvas-showcase is-demo">
                <div className={`showcase-demo is-${mode.id}`}>
                  <div className="showcase-demo__frame">
                    <div className="showcase-demo__stage">
                      <img src={preview.src} alt={preview.label} />
                      {preview.tags.map((tag, index) => (
                        <span
                          key={tag.label}
                          className={`showcase-demo__tag tag-${index + 1}`}
                          style={{ left: `${tag.x}%`, top: `${tag.y}%` }}
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="showcase-demo__caption">
                    <div className="showcase-demo__caption-copy">
                      <span>
                        <i className="bi bi-image" />
                        {preview.label}
                      </span>
                      <strong>{preview.title}</strong>
                    </div>
                    <button
                      type="button"
                      onClick={() => fileInput.current?.click()}
                    >
                      <i className="bi bi-cloud-arrow-up" />
                      {preview.cta}
                    </button>
                  </div>
                  <ol className="canvas-shot-preview" aria-label="本次出图结构">
                    {generationPlan.map((item, index) => (
                      <li key={item.viewId}>
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <strong>{item.viewLabel.split(" · ").pop()}</strong>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
      <BriefDialog
        state={brief}
        setState={setBrief}
        dark={isDark}
        onRegenerate={generateBrief}
        onConfirm={() => {
          setProductName(brief.name);
          setSellingPoints(brief.points);
          setBrief((value) => ({ ...value, open: false }));
        }}
        onClose={() => setBrief((value) => ({ ...value, open: false }))}
      />
      <HandheldGuideDialog
        open={isHandheldMode(mode.id) && handheldGuideOpen}
        onClose={() => setHandheldGuideOpen(false)}
      />
      <CostConfirmDialog
        cost={costConfirm}
        light={!isDark}
        onCancel={() => {
          pendingCostRunRef.current = null;
          setCostConfirm(null);
          finishTaskLaunch();
        }}
        onConfirm={(options) => void confirmCost(options)}
      />
      <ConfirmDelete
        open={Boolean(deleteRow)}
        busy={deleting}
        onClose={() => setDeleteRow(null)}
        onConfirm={removeCurrent}
      />
      {tryonPreview?.url &&
        createPortal(
          <TryonFlipLightbox
            origin={tryonPreview.origin}
            src={tryonPreview.url}
            fallbackSrc={tryonPreview.fallbackUrl || ""}
            alt={tryonPreview.alt}
            title={tryonPreview.title}
            onClose={() => setTryonPreview(null)}
          />,
          ecommerceOverlayRoot(),
        )}
      {handheldPreview?.url &&
        createPortal(
          <TryonFlipLightbox
            origin={handheldPreview.origin}
            src={handheldPreview.url}
            fallbackSrc={handheldPreview.fallbackUrl || ""}
            alt={handheldPreview.alt}
            title={handheldPreview.title}
            onClose={() => setHandheldPreview(null)}
          />,
          ecommerceOverlayRoot(),
        )}
      {accessoryPreview?.url &&
        createPortal(
          <TryonFlipLightbox
            origin={accessoryPreview.origin}
            src={accessoryPreview.url}
            fallbackSrc={accessoryPreview.fallbackUrl || ""}
            alt={accessoryPreview.alt}
            title={accessoryPreview.title}
            onClose={() => setAccessoryPreview(null)}
          />,
          ecommerceOverlayRoot(),
        )}
      {previewUrl &&
        createPortal(
          <WallevenImagePreview
            sourceUrl={previewUrl}
            displaySourceUrl={
              jobs.outputRows.find((row) => row.url === previewUrl)?.display ||
              ""
            }
            title={
              modeRows.some((row) => row.url === previewUrl)
                ? `${mode.label} · V${currentVersion}`
                : "查看大图"
            }
            filename="ecommerce-design.png"
            gallery={
              modeRows.some((row) => row.url === previewUrl)
                ? modeRows.map((row) => row.url)
                : [previewUrl]
            }
            displaySources={Object.fromEntries(
              modeRows.map((row) => [row.url, row.display || ""]),
            )}
            onSelect={setPreviewUrl}
            onClose={() => setPreviewUrl("")}
            onDownload={
              modeRows.some((row) => row.url === previewUrl)
                ? (url) =>
                    downloadOutput(
                      modeRows.find((row) => row.url === url) || { url },
                    )
                : undefined
            }
          />,
          ecommerceOverlayRoot(),
        )}
      {maskRow &&
        createPortal(
          <EcommerceMaskEditor
            sourceUrl={maskRow.url}
            sourceTitle={`${mode.label} · 涂抹需要调整的区域`}
            busy={jobs.running}
            onClose={() => setMaskRow(null)}
            onSubmit={submitMaskedEdit}
          />,
          ecommerceOverlayRoot(),
        )}
    </main>
  );
}
