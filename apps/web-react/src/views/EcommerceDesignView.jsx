import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useSearchParams } from "react-router";
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
  prepareEcommerceInputFiles,
  supportedEcommerceModules,
} from "../features/ecommerce/ecommerceTools.js";
import { fetchRuntimeConfig } from "@legacy/services/runtimeConfig.js";
import { generateCommerceProductBrief } from "@legacy/services/ecommerceApi.js";
import { listUserAssetGroups, listUserAssets } from "@legacy/services/meApi.js";
import { uploadFile } from "@legacy/services/tasksApi.js";
import { fetchAuthenticatedMediaBlob } from "@legacy/services/authenticatedMedia.js";
import listingPreview from "@legacy/assets/ecommerce/listing-preview.webp";
import detailPreview from "@legacy/assets/ecommerce/detail-preview.webp";
import tryonPreview from "@legacy/assets/ecommerce/tryon-preview.webp";
import clonePreview from "@legacy/assets/ecommerce/clone-preview.webp";
import "@legacy/views/EcommerceDesignView.vue?react-style";
import "@legacy/components/ecommerce/EcommerceBriefAssistantDialog.vue?react-style";
import "@legacy/features/ai-wallpaper/components/DeleteHistoryConfirmDialog.vue?react-style";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";
import { CommerceSelect } from "../features/ecommerce/CommerceSelect.jsx";
import { CommerceProductLibrary } from "../features/ecommerce/CommerceProductLibrary.jsx";
import { EcommerceMaskEditor } from "../features/ecommerce/EcommerceMaskEditor.jsx";
import { EcommerceFullscreenPreview } from "../features/ecommerce/EcommerceFullscreenPreview.jsx";
import { useEcommerceJobs } from "../features/ecommerce/useEcommerceJobs.js";
import "./EcommerceDesignView.css";

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
  model: [
    "东亚女性",
    "东亚男性",
    "欧美女性",
    "欧美男性",
    "南亚女性",
    "不限定人群",
  ],
  pose: ["正面站姿", "侧身展示", "半身特写", "生活方式", "坐姿展示"],
  accessory: ["包袋", "耳饰", "项链", "戒指", "腕表", "眼镜", "帽子"],
  shadow: ["自然接触影", "柔和投影", "悬浮阴影", "长投影", "镜面倒影"],
};

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

function localeText() {
  const english = localStorage.getItem("starclouds-locale") === "en";
  return english
    ? {
        source: "Product images",
        settings: "Generation settings",
        products: "Product library",
        emptyProducts: "No matching products",
      }
    : {
        source: "商品原图",
        settings: "生成设置",
        products: "商品库",
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
        "01 商品原图",
        "02 详情长图",
        "03 主视觉",
        "04 功能细节",
        "05 使用场景",
      ],
    };
  if (["tryon", "handheld", "accessory"].includes(mode.id))
    return {
      src: tryonPreview,
      label: "服饰穿戴案例预览",
      title: "同一服装、同一模特、同场景多姿势",
      description: "上传服装并选择模特形象，生成同场景、多姿势的成套实拍图。",
      cta: "上传服装开始",
      tags: ["01 服装原图", "02 正面展示", "03 动态全身", "04 面料特写"],
    };
  if (mode.id === "clone")
    return {
      src: clonePreview,
      label: "爆款复刻案例预览",
      title: "继承成熟视觉结构，替换为你的商品",
      description:
        "上传爆款参考图，可选上传新商品，批量复刻构图、场景与视觉节奏。",
      cta: "上传爆款参考图",
      tags: ["01 爆款参考", "02 新商品", "03 场景迁移", "04 整套复刻"],
    };
  return {
    src: listingPreview,
    label: "商品套图案例预览",
    title: "一张商品图，生成统一完整的上架套图",
    description:
      "上传商品图，生成符合目标平台规范的主图、场景、细节和卖点套图。",
    cta: "上传商品图开始",
    tags: [
      "01 合规主图",
      "02 场景展示",
      "03 模特场景",
      "04 细节说明",
      "05 卖点图",
    ],
  };
}

function outputModeId(row) {
  return row.kind.match(/^ui-design-ecommerce-([a-z0-9]+)-/i)?.[1] || "detail";
}

function BriefDialog({ state, setState, onRegenerate, onConfirm, onClose }) {
  if (!state.open) return null;
  return createPortal(
    <div className="brief-dialog__backdrop light">
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
          <button
            type="button"
            aria-label="关闭"
            disabled={state.busy}
            onClick={onClose}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        {state.busy ? (
          <div className="brief-dialog__loading" role="status">
            <span>
              <i className="bi bi-stars" />
            </span>
            <strong>正在识别商品图片</strong>
            <small>AI 正在提取商品类型、可见特征与核心卖点</small>
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
        <footer>
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

export function EcommerceDesignView() {
  const [params, setParams] = useSearchParams();
  const mode = ecommerceModeById(params.get("tool") || "detail");
  const fields = useMemo(() => new Set(mode.fields || []), [mode]);
  const text = localeText();
  const fileInput = useRef(null);
  const railScroll = useRef(null);
  const [pane, setPane] = useState("settings");
  const [workspace, setWorkspace] = useState("result");
  const [railEdges, setRailEdges] = useState({ start: true, end: false });
  const [files, setFiles] = useState([]);
  const [previews, setPreviews] = useState([]);
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
  const [apparel, setApparel] = useState(OPTIONS.apparel[0]);
  const [modelProfile, setModelProfile] = useState(OPTIONS.model[0]);
  const [pose, setPose] = useState(OPTIONS.pose[0]);
  const [accessory, setAccessory] = useState(OPTIONS.accessory[0]);
  const [shadow, setShadow] = useState(OPTIONS.shadow[0]);
  const [productName, setProductName] = useState("");
  const [sellingPoints, setSellingPoints] = useState("");
  const [selectedModules, setSelectedModules] = useState(
    ECOMMERCE_MODULES.filter((item) => item.value !== "angles").map(
      (item) => item.value,
    ),
  );
  const [structureMode, setStructureMode] = useState("smart");
  const [counts, setCounts] = useState({
    white: 1,
    scene: 2,
    selling: 2,
    other: 2,
  });
  const [textStable, setTextStable] = useState(true);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionDirection, setRevisionDirection] = useState("precise");
  const [revisionBrief, setRevisionBrief] = useState("");
  const [activeUrl, setActiveUrl] = useState("");
  const [loaded, setLoaded] = useState(new Set());
  const [deleteRow, setDeleteRow] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
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
    items: [],
    groups: [],
    error: "",
  });
  const jobs = useEcommerceJobs();

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
    setAspectRatio(mode.ratio);
    setRequestedCount(mode.id === "listing" ? 7 : 1);
    if (mode.id === "tryon") setScene(OPTIONS.tryonScene[0]);
    setPane("settings");
    setWorkspace("result");
  }, [mode.id, mode.ratio]);
  useEffect(
    () => () =>
      previews.forEach((item) => item.local && URL.revokeObjectURL(item.url)),
    [previews],
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
  const customBlueprints = useMemo(
    () => listingShotBlueprintsFromCounts(counts),
    [counts],
  );
  const selectedModuleDetails = useMemo(
    () => supportedEcommerceModules(selectedModules, files.length),
    [selectedModules, files.length],
  );
  const blueprints =
    mode.id === "listing" && structureMode === "custom"
      ? customBlueprints
      : ecommerceShotBlueprints(mode.id, selectedModules);
  const maxOutputCount = Math.max(
    1,
    Math.min(mode.maxCount || 1, blueprints.length || 1),
  );
  const outputCount =
    mode.id === "listing"
      ? structureMode === "custom"
        ? customBlueprints.length
        : 7
      : Math.min(requestedCount, maxOutputCount);
  const assembledPrompt = [
    `任务：${mode.label}。${mode.prompt}`,
    `商品名称：${productName.trim() || "根据商品图片准确识别"}。`,
    sellingPoints.trim() ? `商品卖点与要求：${sellingPoints.trim()}。` : "",
    fields.has("platform") ? `适配平台：${platform}。` : "",
    fields.has("market") ? `目标市场：${market}。` : "",
    fields.has("language") ? `页面文案语言：${language}。` : "",
    fields.has("scene") ? `场景方向：${scene}。` : "",
    fields.has("tone") ? `视觉风格：${tone}。` : "",
    textStable ? "文字必须准确清晰，无法可靠生成时留白，不得输出乱码。" : "",
    "严格保持参考商品造型、颜色、比例、Logo、包装文字和材质细节一致。",
  ]
    .filter(Boolean)
    .join("\n");
  const generationPlan = buildEcommerceGenerationPlan({
    modeId: mode.id,
    count: outputCount,
    selectedModules: selectedModuleDetails.map((item) => item.value),
    basePrompt: assembledPrompt,
    referenceCount: files.length,
    shotBlueprints:
      mode.id === "listing" && structureMode === "custom"
        ? customBlueprints
        : null,
  });
  const canGenerate =
    files.length >= minimumFiles &&
    modelId &&
    (!fields.has("modules") || selectedModuleDetails.length) &&
    (mode.id !== "listing" ||
      structureMode !== "custom" ||
      customBlueprints.length === 7) &&
    !jobs.running;
  const readiness =
    files.length < minimumFiles
      ? `还需 ${minimumFiles - files.length} 张参考图`
      : mode.id === "listing" &&
          structureMode === "custom" &&
          customBlueprints.length !== 7
        ? `还需分配 ${7 - customBlueprints.length} 张套图`
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
  ];
  const modeRows = jobs.outputRows.filter(
    (row) => outputModeId(row) === mode.id,
  );
  const currentRow =
    modeRows.find((row) => row.url === activeUrl) || modeRows[0] || null;
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
  const slots = currentRow
    ? Array.from(
        { length: Math.max(currentRow.groupSize, currentGroup.length) },
        (_, index) => currentGroup.find((row) => row.index === index) || null,
      )
    : [];
  const layoutClass =
    slots.length <= 1
      ? "is-single"
      : slots.length === 2
        ? "is-double"
        : slots.length <= 4
          ? "is-quad"
          : "is-multi";

  function setMode(next) {
    if (jobs.running) return;
    setParams({ tool: next.id }, { replace: true });
  }
  function addFiles(list) {
    const prepared = prepareEcommerceInputFiles(files, list);
    if (!prepared.next.length) return;
    setSelectedProduct(null);
    setFiles((current) => [...current, ...prepared.next]);
    setPreviews((current) => [
      ...current,
      ...prepared.next.map((file) => ({
        file,
        url: URL.createObjectURL(file),
        local: true,
      })),
    ]);
  }
  function removeFile(index) {
    setFiles((current) => current.filter((_, at) => at !== index));
    setPreviews((current) => current.filter((_, at) => at !== index));
    setSelectedProduct(null);
  }
  function referenceLabel(index) {
    return mode.referenceLabels?.[index] || `角度 ${index + 1}`;
  }
  function openWorkspace(next) {
    setWorkspace(next);
    setPane("canvas");
    if (next === "assets" && !assets.loading && !assets.items.length) {
      setAssets((value) => ({ ...value, loading: true }));
      Promise.all([
        listUserAssets({ limit: 24, groupId: "all" }),
        listUserAssetGroups(),
      ])
        .then(([items, groups]) =>
          setAssets({
            loading: false,
            items: items.items,
            groups: groups.items,
            error: "",
          }),
        )
        .catch((error) =>
          setAssets({
            loading: false,
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
    setWorkspace("result");
    setPane("settings");
  }
  async function generateBrief() {
    if (!files.length) return;
    setBrief((value) => ({ ...value, open: true, busy: true, error: "" }));
    try {
      const inputKeys = await Promise.all(
        files.slice(0, 4).map(async (file) => {
          const match = String(file.sourceUrl || "").match(
            /\/api\/v1\/files\/(.+?)(?:\?|$)/,
          );
          return match
            ? decodeURIComponent(match[1])
            : (await uploadFile(file)).key;
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
  async function generate() {
    if (!canGenerate) return;
    setWorkspace("result");
    setPane("canvas");
    await jobs.createBatch({
      files,
      modelId,
      items: generationPlan.map((item) => ({
        ...item,
        kindVariant: mode.id,
        aspectRatio,
        platform: `${platform} · ${market} · ${language}`,
        quality: "high",
      })),
    });
  }
  function remoteSourceFile(url, name = "ecommerce-source.png") {
    const file = new File([new Blob()], name, { type: "image/png" });
    Object.defineProperty(file, "sourceUrl", { value: url });
    return file;
  }
  async function reviseCurrent() {
    const brief = revisionBrief.trim();
    if (!currentRow || brief.length < 4 || jobs.running) return;
    const nextVersion = currentVersion + 1;
    const prompt = buildEcommerceRevisionPrompt({
      basePrompt: assembledPrompt,
      brief,
      direction: revisionDirection,
      versionNumber: nextVersion,
    });
    await jobs.createBatch({
      files: [remoteSourceFile(currentRow.url), ...files.slice(0, 5)],
      modelId,
      items: [
        {
          prompt,
          kindVariant: mode.id,
          aspectRatio: currentRow.aspectRatio || aspectRatio,
          parentOutputUrl: currentRow.url,
          iterationMode: true,
          viewId: `${mode.id}-revision-v${nextVersion}`,
          viewLabel: `${mode.shortLabel} · V${nextVersion}`,
        },
      ],
    });
    setRevisionBrief("");
  }
  async function submitMaskedEdit({ maskFile, brief: editBrief }) {
    if (!maskRow || jobs.running) return;
    await jobs.createBatch({
      files: [remoteSourceFile(maskRow.url), maskFile, ...files.slice(0, 4)],
      modelId,
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
        },
      ],
    });
    setMaskRow(null);
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
    addFiles([file]);
    setWorkspace("result");
    setPane("settings");
  }

  const preview = modePreview(mode);
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
      key: "accessory",
      label: "饰品类型",
      options: OPTIONS.accessory,
      value: accessory,
      set: setAccessory,
      aria: "选择饰品类型",
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
    <main className="commerce-studio">
      <div className="commerce-atmosphere" aria-hidden="true">
        <span className="commerce-atmosphere__glow commerce-atmosphere__glow--a" />
        <span className="commerce-atmosphere__glow commerce-atmosphere__glow--b" />
        <span className="commerce-atmosphere__grain" />
      </div>
      <header className="commerce-header">
        <div className="commerce-header__brand">
          <span className="commerce-header__badge">
            <i className={`bi ${mode.icon}`} />
          </span>
          <div className="commerce-header__copy">
            <em>AI 电商</em>
            <strong>{mode.label}</strong>
          </div>
        </div>
        <div
          className="commerce-header__actions"
          role="tablist"
          aria-label="工作区"
        >
          {[
            ["result", "bi-easel2", "生成结果"],
            ["history", "bi-clock-history", "电商历史"],
            ["assets", "bi-collection", "资产与素材"],
            ["products", "bi-box-seam", text.products],
          ].map(([id, icon, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              className={workspace === id ? "active" : ""}
              aria-selected={workspace === id}
              disabled={jobs.running && id !== "result"}
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
      >
        <button
          type="button"
          role="tab"
          className={pane === "settings" ? "active" : ""}
          onClick={() => setPane("settings")}
        >
          参数设置
        </button>
        <button
          type="button"
          role="tab"
          className={
            pane === "canvas" && workspace === "result" ? "active" : ""
          }
          onClick={() => openWorkspace("result")}
        >
          生成结果
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
      </div>
      {pane === "settings" && (
        <nav className="mobile-tool-switch" aria-label="选择电商设计工具">
          {mobileModes.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.id === mode.id ? "active" : ""}
              onClick={() => setMode(item)}
            >
              <i className={`bi ${item.icon}`} />
              <span>{item.shortLabel || item.label}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="commerce-layout">
        <nav
          className={`commerce-rail${railEdges.start ? " is-at-start" : ""}${railEdges.end ? " is-at-end" : ""}`}
          aria-label="电商设计工具"
        >
          <div
            ref={railScroll}
            className="commerce-rail__scroll"
            onScroll={updateRail}
          >
            {ECOMMERCE_RAIL_GROUPS.map((group, groupIndex) => (
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
                    onMouseEnter={(event) => {
                      event.currentTarget.querySelector(
                        ".commerce-rail__icon",
                      ).style.transform = "translateY(-0.5px) scale(1.04)";
                    }}
                    onMouseLeave={(event) => {
                      event.currentTarget.querySelector(
                        ".commerce-rail__icon",
                      ).style.transform = "";
                    }}
                    onClick={() => setMode(item)}
                  >
                    <span className="commerce-rail__icon">
                      <i className={`bi ${item.icon}`} />
                    </span>
                    <span className="commerce-rail__label">
                      {item.shortLabel || item.label}
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>
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
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  onChange={(event) => {
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </div>
              {mode.referenceLabels?.length && (
                <div className="upload-role-guide">
                  {mode.referenceLabels.slice(0, 2).map((label, index) => (
                    <span key={label}>
                      <b>{index + 1}</b>
                      <span>
                        <strong>{label}</strong>
                        <small>{index < minimumFiles ? "必填" : "可选"}</small>
                      </span>
                    </span>
                  ))}
                </div>
              )}
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
                      <span>{item.label}</span>
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
                  <span>画面比例</span>
                  <CommerceSelect
                    value={aspectRatio}
                    options={OPTIONS.ratio}
                    onChange={setAspectRatio}
                    ariaLabel="选择画面比例"
                  />
                </label>
                {maxOutputCount > 1 && mode.id !== "listing" && (
                  <label>
                    <span>生成张数</span>
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
                  <span>生成模型</span>
                  <CommerceSelect
                    value={modelId}
                    options={models.map((item) => ({
                      value: item.id || item.publicModelKey,
                      label: item.label || item.name || item.id,
                    }))}
                    onChange={setModelId}
                    placeholder="请选择模型"
                    ariaLabel="选择生成模型"
                  />
                </label>
              </div>
              {creativeFields.some(
                (item) =>
                  fields.has(item.key) &&
                  !(item.key === "scene" && mode.id === "tryon"),
              ) && (
                <div className="select-row select-row--creative">
                  {creativeFields
                    .filter(
                      (item) =>
                        fields.has(item.key) &&
                        !(item.key === "scene" && mode.id === "tryon"),
                    )
                    .map((item) => (
                      <label key={item.key}>
                        <span>{item.label}</span>
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
            {mode.id === "tryon" && (
              <section className="settings-section tryon-scene-section">
                <h2>拍摄场景</h2>
                <div className="choice-chip-grid">
                  {OPTIONS.tryonScene.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={scene === item ? "active" : ""}
                      onClick={() => setScene(item)}
                    >
                      <i className="bi bi-check-lg" />
                      {item}
                    </button>
                  ))}
                </div>
              </section>
            )}
            {mode.id === "clone" && (
              <section className="settings-section clone-settings-section">
                <h2>复刻类型</h2>
                <div className="clone-type-grid">
                  {[
                    "电商商品图",
                    "服饰电商图",
                    "营销海报",
                    "社媒图文",
                    "创意海报",
                    "其他",
                  ].map((item) => (
                    <button key={item} type="button">
                      <i className="bi bi-bag" />
                      {item}
                    </button>
                  ))}
                </div>
                <h2 className="clone-subheading">复刻程度</h2>
                <div className="clone-fidelity-grid">
                  <button type="button" className="active">
                    <span className="structure-mode-check">
                      <i className="bi bi-check-lg" />
                    </span>
                    <span>
                      <strong>参考风格</strong>
                      <small>参考整体风格和结构，允许重构色彩与场景。</small>
                    </span>
                  </button>
                  <button type="button">
                    <span className="structure-mode-check">
                      <i className="bi bi-check-lg" />
                    </span>
                    <span>
                      <strong>高度复刻</strong>
                      <small>保持视觉结构，重点替换商品和用户文案。</small>
                    </span>
                  </button>
                </div>
              </section>
            )}
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
            {mode.id === "listing" && (
              <section className="settings-section listing-structure-section">
                <h2>套图结构配置</h2>
                <div className="structure-mode-grid">
                  {[
                    [
                      "smart",
                      "智能匹配",
                      "分析商品资料，自动组织 7 张高转化套图",
                    ],
                    ["custom", "自定义配置", "自由选择图片类型和本次生成数量"],
                  ].map(([id, label, hint]) => (
                    <button
                      key={id}
                      type="button"
                      className={structureMode === id ? "active" : ""}
                      onClick={() => setStructureMode(id)}
                    >
                      <span className="structure-mode-check">
                        <i className="bi bi-check-lg" />
                      </span>
                      <span>
                        <strong>{label}</strong>
                        <small>{hint}</small>
                      </span>
                    </button>
                  ))}
                </div>
                {structureMode === "custom" && (
                  <div className="listing-count-config">
                    {[
                      ["white", "白底图"],
                      ["scene", "场景图"],
                      ["selling", "卖点图"],
                      ["other", "其他"],
                    ].map(([key, label]) => (
                      <article key={key}>
                        <span>
                          <strong>{label}</strong>
                          <small>图片类型与数量</small>
                        </span>
                        <div
                          className="listing-stepper"
                          aria-label={`${label}数量`}
                        >
                          <button
                            type="button"
                            aria-label={`减少${label}`}
                            disabled={counts[key] <= (key === "white" ? 1 : 0)}
                            onClick={() =>
                              setCounts((value) => ({
                                ...value,
                                [key]: Math.max(
                                  key === "white" ? 1 : 0,
                                  value[key] - 1,
                                ),
                              }))
                            }
                          >
                            <i className="bi bi-dash" />
                          </button>
                          <b>{counts[key]}</b>
                          <button
                            type="button"
                            aria-label={`增加${label}`}
                            disabled={customBlueprints.length >= 7}
                            onClick={() =>
                              setCounts((value) => ({
                                ...value,
                                [key]: value[key] + 1,
                              }))
                            }
                          >
                            <i className="bi bi-plus" />
                          </button>
                        </div>
                      </article>
                    ))}
                    <footer>
                      <span>已分配 {customBlueprints.length}/7 张</span>
                      <strong
                        className={customBlueprints.length === 7 ? "ready" : ""}
                      >
                        {customBlueprints.length === 7
                          ? "结构完整"
                          : "需要分配满 7 张"}
                      </strong>
                    </footer>
                  </div>
                )}
              </section>
            )}
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
                              : current.filter((value) => value !== item.value),
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
                disabled={!canGenerate}
                title={readiness}
                onClick={generate}
              >
                <i className="bi bi-stars" />
                一键生成{mode.label}（{generationPlan.length}张）
              </button>
            )}
          </footer>
        </aside>
        <section
          className={`commerce-canvas${pane !== "canvas" ? " is-mobile-hidden" : ""}`}
        >
          {workspace === "products" ? (
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
                    <small>AI 电商资产</small>
                    <strong>电商生成历史</strong>
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
                <Link to="/materials" className="workspace-manage-link">
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
                    <Link to="/materials">去管理素材</Link>
                  </div>
                )}
              </div>
            </section>
          ) : jobs.running ? (
            <div className="canvas-generation" aria-live="polite">
              <header className="generation-status">
                <span className="generation-orbit">
                  <i />
                  <b />
                </span>
                <div>
                  <small>AI 正在处理</small>
                  <strong>正在生成电商设计</strong>
                  <span>正在锁定商品主体、文字与系列视觉</span>
                </div>
                <button type="button" onClick={jobs.cancelAll}>
                  <i className="bi bi-stop-circle" />
                  停止
                </button>
              </header>
              <div className={`generation-skeletons ${layoutClass}`}>
                {generationPlan.map((item, index) => (
                  <article
                    key={item.viewId}
                    className="generation-skeleton"
                    style={{ aspectRatio: aspectRatio.replace(":", " / ") }}
                  >
                    <span className="generation-skeleton__shine" />
                    <span className="generation-skeleton__product">
                      <i className="bi bi-box-seam" />
                    </span>
                    <footer>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{item.viewLabel.split(" · ").pop()}</strong>
                    </footer>
                  </article>
                ))}
              </div>
              <p>可离开当前页面，任务完成后结果会自动进入电商历史</p>
            </div>
          ) : currentRow ? (
            <div className="result-workspace">
              <header>
                <div>
                  <span>{mode.label}</span>
                  <strong>
                    {blueprints[currentRow.index]?.label || mode.shortLabel}
                  </strong>
                </div>
                <div className="result-header-actions">
                  <span className="version-badge">V{currentVersion}</span>
                  <button
                    type="button"
                    aria-label="放大查看当前结果"
                    onClick={() => setPreviewUrl(currentRow.url)}
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
                </div>
              </header>
              <div
                className={`result-main${revisionOpen ? " revision-is-open" : ""}`}
              >
                <div
                  className={`result-stage ${layoutClass}`}
                  data-count={slots.length}
                >
                  {slots.map((row, index) => (
                    <article
                      key={`${currentRow.groupId}-${index}`}
                      className={`result-image-card${row?.url === currentRow.url ? " active" : ""}${row && loaded.has(row.url) ? " loaded" : ""}${row ? "" : " is-pending"}`}
                      style={{
                        aspectRatio: (row?.aspectRatio || aspectRatio).replace(
                          ":",
                          " / ",
                        ),
                      }}
                    >
                      {row ? (
                        <button
                          type="button"
                          className="result-image-hit-area"
                          aria-label={`查看第 ${index + 1} 张结果细节`}
                          onClick={() => setActiveUrl(row.url)}
                          onDoubleClick={() => setPreviewUrl(row.url)}
                        >
                          {!loaded.has(row.url) && (
                            <span className="result-image-skeleton" />
                          )}
                          <AuthenticatedImage
                            src={row.url}
                            alt={`${mode.label}第 ${index + 1} 张生成结果`}
                            loading="eager"
                            maxDimension={1600}
                            onLoad={() =>
                              setLoaded((value) => new Set([...value, row.url]))
                            }
                          />
                          <span className="result-image-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                        </button>
                      ) : (
                        <div className="result-image-pending">
                          <span className="result-image-skeleton" />
                          <span className="result-image-index">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <small>等待结果</small>
                        </div>
                      )}
                    </article>
                  ))}
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
              <div className="result-strip" role="list" aria-label="生成历史">
                {modeRows.map((row) => (
                  <div
                    key={row.url}
                    className="result-strip__item"
                    role="listitem"
                  >
                    <button
                      type="button"
                      className={`result-strip__select${row.url === currentRow.url ? " active" : ""}`}
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
            </div>
          ) : (
            <div className="canvas-empty">
              <div className="canvas-intro">
                <div>
                  <h1>{mode.label}</h1>
                  <p>{preview.description}</p>
                </div>
              </div>
              <div
                className={`canvas-showcase${previews.length ? "" : " is-demo"}`}
              >
                {!previews.length ? (
                  <div className={`showcase-demo is-${mode.id}`}>
                    <div className="showcase-demo__stage">
                      <img src={preview.src} alt={preview.label} />
                      {preview.tags.map((tag, index) => (
                        <span
                          key={tag}
                          className={`showcase-demo__tag tag-${index + 1}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="showcase-demo__caption">
                      <div className="showcase-demo__caption-copy">
                        <span>
                          <i className="bi bi-stars" />
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
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      className="showcase-product has-images"
                      onClick={() => fileInput.current?.click()}
                    >
                      <img
                        src={previews[0].url}
                        alt={`${mode.label}商品参考图`}
                      />
                      <span>
                        <i className="bi bi-arrow-repeat" />
                        更换商品图
                      </span>
                    </button>
                    <span className="showcase-flow-arrow">
                      <i className="bi bi-arrow-right" />
                    </span>
                    <div
                      className={`showcase-output-grid${generationPlan.length === 1 ? " is-single" : ""}`}
                    >
                      {generationPlan.slice(0, 5).map((item, index) => (
                        <article
                          key={item.viewId}
                          className={index === 0 ? "featured" : ""}
                        >
                          <span>{String(index + 1).padStart(2, "0")}</span>
                          <i className={`bi ${mode.icon}`} />
                          <strong>{item.viewLabel.split(" · ").pop()}</strong>
                          <small>
                            {index === 0
                              ? `${platform} · ${aspectRatio}`
                              : "系列视觉统一"}
                          </small>
                        </article>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
      <BriefDialog
        state={brief}
        setState={setBrief}
        onRegenerate={generateBrief}
        onConfirm={() => {
          setProductName(brief.name);
          setSellingPoints(brief.points);
          setBrief((value) => ({ ...value, open: false }));
        }}
        onClose={() => setBrief((value) => ({ ...value, open: false }))}
      />
      <ConfirmDelete
        open={Boolean(deleteRow)}
        busy={deleting}
        onClose={() => setDeleteRow(null)}
        onConfirm={removeCurrent}
      />
      {previewUrl &&
        createPortal(
          <EcommerceFullscreenPreview
            sourceUrl={previewUrl}
            title={`${mode.label} · V${currentVersion}`}
            gallery={modeRows.map((row) => row.url)}
            onSelect={setPreviewUrl}
            onClose={() => setPreviewUrl("")}
            onDownload={(url) =>
              downloadOutput(modeRows.find((row) => row.url === url) || { url })
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
