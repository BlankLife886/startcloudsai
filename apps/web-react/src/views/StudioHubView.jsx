import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { Link, useNavigate } from "react-router";
import { fetchAssistantConfig } from "@legacy/services/assistantApi.js";
import { getWallet } from "@legacy/services/meApi.js";
import {
  listPromptLibrary,
  recordPromptEngagement,
} from "@legacy/services/promptLibrary.js";
import { getFeatureUnitPriceCents } from "@legacy/services/pricing.js";
import {
  fetchRuntimeConfig,
  getDefaultRuntimeConfig,
  normalizeRuntimeConfig,
} from "@legacy/services/runtimeConfig.js";
import { listTasks, uploadFile } from "@legacy/services/tasksApi.js";
import notificationService from "@legacy/services/notification.js";
import { imageCountFromPrompt } from "@legacy/features/assistant/domain/assistantMessages.js";
import { ECOMMERCE_MODES } from "@legacy/features/ecommerce/ecommerceTools.js";
import {
  studioLaunchDefaults,
  studioLaunchFields,
} from "@legacy/features/creator-hub/studioLaunchProfiles.js";
import {
  STUDIO_TOOLS,
  stashPendingPrompt,
} from "@legacy/features/creator-hub/studioTools.js";
import {
  taskOriginalUrl,
  taskThumbnailUrl,
} from "@legacy/features/creator-hub/taskMedia.js";
import "@react/legacy-static/features/creator-hub/creator-hub.css";
import "@react/legacy-static/features/creator-hub/studio-hub.css";
import "@react/legacy-styles/generated/features/home-commercial/components/TypeLine.css";
import "@react/legacy-styles/generated/features/ai-shared/AiCostConfirmDialog.css";
import { useAuth } from "../auth/AuthContext.jsx";
import { AuthenticatedImage } from "../components/AuthenticatedImage.jsx";

gsap.registerPlugin(useGSAP, ScrollTrigger);

const LEAD_LINES = [
  "先写下想法，再选择工具。从一句话开始，做到成品。",
  "文生图、染色、模型设计、游戏资产——一条创作流。",
  "提示词可复用，进度可回看，结果可继续迭代。",
];
const COMPOSER_TOOLS = new Set(["assistant", "t2i"]);
const TOOL_WALL_ORDER = ["assistant", "model", "t2i", "coloring", "ui", "game"];
const ECOMMERCE_MODE_IDS = [
  "shoot",
  "listing",
  "detail",
  "tryon",
  "handheld",
  "background",
];

function storedRuntimeConfig() {
  try {
    const value = JSON.parse(
      sessionStorage.getItem("walleven.runtime-config.v2") || "null",
    );
    return normalizeRuntimeConfig(value?.config || getDefaultRuntimeConfig());
  } catch {
    return getDefaultRuntimeConfig();
  }
}

function routeVisible(config, path) {
  const routes = config?.routes || {};
  const exact = routes[path];
  const parentKey = Object.keys(routes)
    .filter((key) => key !== "/" && path.startsWith(`${key}/`))
    .sort((left, right) => right.length - left.length)[0];
  const route = exact || routes[parentKey] || {};
  return route.enabled !== false || route.fallbackType === "disabled";
}

function featureEnabled(config, key) {
  return !key || config?.features?.[key]?.enabled !== false;
}

function normalizeModel(item = {}) {
  const id = String(item.id || item.publicModelKey || item.model || "").trim();
  if (!id) return null;
  return { ...item, id, label: String(item.label || item.name || id).trim() };
}

function taskPrompt(task) {
  return String(
    task?.params?.userPrompt ||
      task?.userPrompt ||
      task?.params?.prompt ||
      task?.prompt ||
      "",
  ).trim();
}

function taskAspect(task) {
  const [width, height] = String(
    task?.aspectRatio || task?.params?.aspectRatio || "",
  )
    .split(":")
    .map(Number);
  if (width > 0 && height > 0) return `${width} / ${height}`;
  const match = String(task?.outputSize || task?.params?.size || "").match(
    /(\d+)\s*[x×]\s*(\d+)/i,
  );
  return match ? `${match[1]} / ${match[2]}` : "3 / 4";
}

function aspectScore(aspect) {
  const [width, height] = String(aspect).split("/").map(Number);
  return width > 0 && height > 0
    ? 1 / Math.max(0.35, Math.min(width / height, 3.2))
    : 1;
}

function balanceColumns(items, count) {
  const columns = Array.from({ length: count }, () => []);
  const heights = Array.from({ length: count }, () => 0);
  items.forEach((item) => {
    let target = 0;
    for (let index = 1; index < count; index += 1)
      if (heights[index] < heights[target]) target = index;
    columns[target].push(item);
    heights[target] += aspectScore(item.aspect);
  });
  return columns;
}

function useColumnCount() {
  const read = () =>
    window.innerWidth <= 480
      ? 1
      : window.innerWidth <= 760
        ? 2
        : window.innerWidth <= 1100
          ? 3
          : 4;
  const [count, setCount] = useState(read);
  useEffect(() => {
    const update = () => setCount(read());
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);
  return count;
}

function StudioTypeLine({ texts }) {
  const reduced =
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.classList.contains("settings-no-animations");
  const [text, setText] = useState(reduced ? texts[0] || "" : "");
  useEffect(() => {
    if (reduced) {
      setText(texts[0] || "");
      return undefined;
    }
    let disposed = false;
    let timer = 0;
    let item = 0;
    let length = 0;
    let deleting = false;
    const step = () => {
      if (disposed) return;
      const current = texts[item] || "";
      if (deleting) {
        length -= 1;
        setText(current.slice(0, Math.max(0, length)));
        if (length <= 0) {
          deleting = false;
          item = (item + 1) % texts.length;
          timer = window.setTimeout(step, 250);
        } else timer = window.setTimeout(step, 29);
      } else {
        length += 1;
        setText(current.slice(0, length));
        if (length >= current.length) {
          deleting = true;
          timer = window.setTimeout(step, 2200);
        } else timer = window.setTimeout(step, 42);
      }
    };
    timer = window.setTimeout(step, 760);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
    };
  }, [reduced, texts]);
  return (
    <span className="type-line">
      <span className="sr-only">{texts[0]}</span>
      <span aria-hidden="true">
        {text}
        {!reduced && <i />}
      </span>
    </span>
  );
}

function StudioCostDialog({ cost, onConfirm, onCancel }) {
  if (!cost) return null;
  const count = Math.max(1, Number(cost.count || 1));
  const unitPrice = Number.isFinite(Number(cost.unitPriceCents))
    ? Math.max(0, Number(cost.unitPriceCents))
    : null;
  const total =
    unitPrice == null
      ? Math.max(0, Number(cost.unitCost || 0))
      : Math.max(0, Number(cost.totalPriceCents ?? unitPrice * count));
  const available =
    cost.creditAvailable == null
      ? null
      : Math.max(0, Number(cost.creditAvailable || 0));
  const insufficient = available != null && total > available;
  const format = (value) =>
    `${Math.round(Number(value || 0)).toLocaleString("zh-CN")} 积分`;
  return (
    <div
      className="ai-cost-confirm-layer is-elevated"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        className="ai-cost-confirm-panel is-credits"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-cost-confirm-title"
      >
        <header className="ai-cost-confirm-head">
          <span className="ai-cost-confirm-icon">
            <i className="bi bi-coin" />
          </span>
          <div className="ai-cost-confirm-titles">
            <span className="ai-cost-confirm-eyebrow">
              {cost.featureLabel || "本次 AI 功能"}
            </span>
            <h5 id="ai-cost-confirm-title">确认生成费用</h5>
          </div>
          <button
            type="button"
            className="ai-cost-confirm-close"
            aria-label="关闭费用确认"
            onClick={onCancel}
          >
            <i className="bi bi-x-lg" />
          </button>
        </header>
        <p className="ai-cost-confirm-summary">{cost.summary}</p>
        <div className="ai-cost-confirm-card">
          <div className="ai-cost-confirm-total">
            <div className="ai-cost-confirm-total__copy">
              <span>本次预计</span>
              <small>
                {unitPrice == null
                  ? `${count} ${cost.unitLabel || "张"}`
                  : `${format(unitPrice)} / ${cost.unitLabel || "张"} × ${count} ${cost.unitLabel || "张"}`}
              </small>
            </div>
            <strong>
              {unitPrice == null && !total ? "按实际用量结算" : format(total)}
            </strong>
          </div>
          <div className="ai-cost-confirm-balance">
            <div>
              <span>当前可用</span>
              <strong>
                {available == null ? "读取中" : format(available)}
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
                    : format(available - total)}
              </strong>
            </div>
          </div>
        </div>
        {unitPrice == null && (
          <p className="ai-cost-confirm-warn">
            <i className="bi bi-info-circle" />
            暂时读取不到单价，本次费用以服务端结算为准。
          </p>
        )}
        {insufficient && (
          <p className="ai-cost-confirm-warn is-danger">
            <i className="bi bi-exclamation-circle" />
            钱包余额不足，请充值后再提交任务。
          </p>
        )}
        <footer className="ai-cost-confirm-footer is-no-preference">
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
              onClick={onConfirm}
            >
              确认
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function StudioHubView() {
  const auth = useAuth();
  const navigate = useNavigate();
  const rootRef = useRef(null);
  const composerRef = useRef(null);
  const fileInputRef = useRef(null);
  const mountedRef = useRef(true);
  const recentControllerRef = useRef(null);
  const uploadControllerRef = useRef(null);
  const recognitionRef = useRef(null);
  const [runtimeConfig, setRuntimeConfig] = useState(storedRuntimeConfig);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [selectedToolId, setSelectedToolId] = useState("assistant");
  const [activePanel, setActivePanel] = useState("");
  const [launchConfigs, setLaunchConfigs] = useState(() =>
    Object.fromEntries(
      STUDIO_TOOLS.map((tool) => [tool.id, studioLaunchDefaults(tool.id)]),
    ),
  );
  const [assistantModels, setAssistantModels] = useState({
    conversation: [],
    image: [],
  });
  const [promptItems, setPromptItems] = useState({});
  const [promptLoading, setPromptLoading] = useState(false);
  const [references, setReferences] = useState([]);
  const [referenceUploading, setReferenceUploading] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [launchSubmitting, setLaunchSubmitting] = useState(false);
  const [pendingLaunch, setPendingLaunch] = useState(null);
  const [cost, setCost] = useState(null);
  const [recentTasks, setRecentTasks] = useState([]);
  const [recentLoading, setRecentLoading] = useState(false);
  const [failedThumbs, setFailedThumbs] = useState(() => new Set());
  const columnCount = useColumnCount();

  const visibleTools = useMemo(
    () =>
      STUDIO_TOOLS.filter(
        (tool) =>
          featureEnabled(runtimeConfig, tool.feature) &&
          routeVisible(runtimeConfig, tool.to),
      ),
    [runtimeConfig],
  );
  const composerTools = useMemo(
    () =>
      visibleTools.filter(
        (tool) => tool.taskType && COMPOSER_TOOLS.has(tool.id),
      ),
    [visibleTools],
  );
  const selectedTool =
    composerTools.find((tool) => tool.id === selectedToolId) ||
    composerTools[0] ||
    null;
  const selectedConfig =
    launchConfigs[selectedTool?.id || "t2i"] || studioLaunchDefaults("t2i");
  const modelOptions = useMemo(() => {
    if (!selectedTool) return [];
    if (selectedTool.id === "assistant")
      return selectedConfig.skill === "image"
        ? assistantModels.image
        : assistantModels.conversation;
    return (
      runtimeConfig?.features?.[selectedTool.feature]?.config?.publicModels ||
      []
    )
      .map(normalizeModel)
      .filter(Boolean);
  }, [assistantModels, runtimeConfig, selectedConfig.skill, selectedTool]);
  const selectedModel =
    modelOptions.find((model) => model.id === selectedConfig.model) ||
    modelOptions.find((model) => model.default) ||
    modelOptions[0] ||
    null;
  const maxReferences =
    selectedTool?.id === "assistant"
      ? 4
      : Math.max(0, Number(selectedModel?.maxReferenceImages ?? 4) || 0);
  const fields = useMemo(
    () =>
      studioLaunchFields(selectedTool?.id, selectedConfig).map((field) =>
        field.key === "model"
          ? {
              ...field,
              options: [
                {
                  value: "",
                  label: modelOptions.length ? "自动匹配" : "默认模型",
                },
                ...modelOptions.map((model) => ({
                  value: model.id,
                  label: model.label,
                })),
              ],
            }
          : field,
      ),
    [modelOptions, selectedConfig, selectedTool?.id],
  );
  const wallTools = useMemo(() => {
    const map = new Map(visibleTools.map((tool) => [tool.id, tool]));
    const ordered = TOOL_WALL_ORDER.map((id) => map.get(id)).filter(Boolean);
    return [
      ...ordered,
      ...visibleTools.filter((tool) => !TOOL_WALL_ORDER.includes(tool.id)),
    ].filter((tool) => tool.id !== "ecommerce");
  }, [visibleTools]);
  const ecommerceTool = visibleTools.find((tool) => tool.id === "ecommerce");
  const ecommerceModes = ECOMMERCE_MODE_IDS.map((id) =>
    ECOMMERCE_MODES.find((mode) => mode.id === id),
  ).filter(Boolean);
  const recentItems = recentTasks.map((task, index) => ({
    key: String(task.id),
    task,
    index,
    aspect: taskAspect(task),
    src: failedThumbs.has(String(task.id))
      ? taskOriginalUrl(task) || taskThumbnailUrl(task)
      : taskThumbnailUrl(task) || taskOriginalUrl(task),
  }));
  const columns = balanceColumns(recentItems, columnCount);

  const updateSelectedConfig = (patch) =>
    setLaunchConfigs((current) => ({
      ...current,
      [selectedTool?.id || "t2i"]: { ...selectedConfig, ...patch },
    }));
  const optionSelected = (field, value) => {
    const key = field.configKey || field.key;
    const current = selectedConfig[key];
    return field.multiple
      ? String(value) === "none"
        ? !current?.length
        : (current || []).some((item) => String(item) === String(value))
      : String(current ?? "") === String(value);
  };
  const fieldLabel = (field) => {
    const key = field.configKey || field.key;
    const current = selectedConfig[key];
    if (field.multiple) {
      if (!current?.length) return "不启用 Skill";
      if (current.length > 1) return `${current.length} 个 Skills`;
      return (
        field.options.find(
          (option) => String(option.value) === String(current[0]),
        )?.label || "1 个 Skill"
      );
    }
    return (
      field.options.find(
        (option) => String(option.value) === String(current ?? ""),
      )?.label || field.label
    );
  };
  const selectOption = (field, value) => {
    const key = field.configKey || field.key;
    if (field.multiple) {
      const current = Array.isArray(selectedConfig[key])
        ? selectedConfig[key]
        : [];
      updateSelectedConfig({
        [key]:
          String(value) === "none"
            ? []
            : current.some((item) => String(item) === String(value))
              ? current.filter((item) => String(item) !== String(value))
              : [...current, value],
      });
    } else {
      updateSelectedConfig({ [key]: value });
      setActivePanel("");
    }
  };

  const loadRecent = useCallback(async () => {
    recentControllerRef.current?.abort();
    if (!auth.isAuthenticated) {
      setRecentTasks([]);
      setRecentLoading(false);
      return;
    }
    const controller = new AbortController();
    recentControllerRef.current = controller;
    setRecentLoading(true);
    try {
      const result = await listTasks({ limit: 12, signal: controller.signal });
      if (mountedRef.current && !controller.signal.aborted)
        setRecentTasks(
          (result.items || []).filter(
            (task) =>
              taskThumbnailUrl(task) ||
              taskOriginalUrl(task) ||
              task.status === "succeeded",
          ),
        );
    } catch (error) {
      if (error?.name !== "AbortError" && mountedRef.current)
        setRecentTasks([]);
    } finally {
      if (mountedRef.current && recentControllerRef.current === controller)
        setRecentLoading(false);
    }
  }, [auth.isAuthenticated]);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();
    Promise.allSettled([
      fetchRuntimeConfig().then((config) => {
        if (mountedRef.current) setRuntimeConfig(config);
      }),
      fetchAssistantConfig(controller.signal).then((config) => {
        if (!mountedRef.current) return;
        const normalize = (items) =>
          (Array.isArray(items) ? items : [])
            .map((item) => normalizeModel({ ...item, id: item?.model }))
            .filter(Boolean);
        setAssistantModels({
          conversation: normalize(config?.conversationModels),
          image: normalize(config?.imageModels),
        });
      }),
    ]).catch(() => null);
    void loadRecent();
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onstart = () => mountedRef.current && setVoiceListening(true);
      recognition.onend = () => mountedRef.current && setVoiceListening(false);
      recognition.onerror = () => {
        if (mountedRef.current) {
          setVoiceListening(false);
          notificationService.warning("语音识别暂时不可用");
        }
      };
      recognition.onresult = (event) => {
        let transcript = "";
        for (let index = 0; index < event.results.length; index += 1)
          transcript += event.results[index]?.[0]?.transcript || "";
        if (mountedRef.current)
          setDraftPrompt(
            (current) =>
              `${current.trim()}${current.trim() && transcript ? "\n" : ""}${transcript}`,
          );
      };
      recognitionRef.current = recognition;
      setVoiceSupported(true);
    }
    return () => {
      mountedRef.current = false;
      controller.abort();
      recentControllerRef.current?.abort();
      uploadControllerRef.current?.abort();
      recognitionRef.current?.abort?.();
      recognitionRef.current = null;
    };
  }, [loadRecent]);

  useEffect(() => {
    if (
      composerTools.length &&
      !composerTools.some((tool) => tool.id === selectedToolId)
    )
      setSelectedToolId(composerTools[0].id);
  }, [composerTools, selectedToolId]);

  useGSAP(
    () => {
      const media = gsap.matchMedia();
      media.add(
        {
          reduce: "(prefers-reduced-motion: reduce)",
          motion: "(prefers-reduced-motion: no-preference)",
        },
        (context) => {
          if (context.conditions.reduce) {
            gsap.set(
              "[data-studio-enter], [data-studio-tool], [data-studio-reveal], [data-studio-orb]",
              { clearProps: "all" },
            );
            return;
          }
          gsap.from("[data-studio-enter]", {
            autoAlpha: 0,
            y: 24,
            duration: 0.65,
            ease: "power3.out",
            stagger: 0.08,
            clearProps: "transform,opacity,visibility",
          });
          gsap.from("[data-studio-tool]", {
            autoAlpha: 0,
            y: 28,
            scale: 0.985,
            duration: 0.55,
            ease: "power2.out",
            stagger: 0.05,
            delay: 0.12,
            clearProps: "transform,opacity,visibility",
          });
          gsap.utils.toArray("[data-studio-reveal]").forEach((element) =>
            gsap.from(element, {
              autoAlpha: 0,
              y: 36,
              duration: 0.7,
              ease: "power3.out",
              clearProps: "transform,opacity,visibility",
              scrollTrigger: {
                trigger: element,
                start: "top 88%",
                once: true,
                fastScrollEnd: true,
              },
            }),
          );
          gsap.utils.toArray("[data-studio-orb]").forEach((orb, index) =>
            gsap.to(orb, {
              y: index % 2 ? 12 : -14,
              x: index % 2 ? -8 : 10,
              duration: 4.8 + index * 0.6,
              ease: "sine.inOut",
              repeat: -1,
              yoyo: true,
              force3D: true,
            }),
          );
        },
      );
      return () => media.revert();
    },
    { scope: rootRef },
  );

  const openPromptLibrary = async () => {
    if (activePanel === "prompts") {
      setActivePanel("");
      return;
    }
    setActivePanel("prompts");
    if (!selectedTool?.taskType || promptItems[selectedTool.id]) return;
    setPromptLoading(true);
    try {
      const result = await listPromptLibrary(selectedTool.taskType, {
        pageNumber: 1,
        pageSize: 8,
      });
      if (mountedRef.current)
        setPromptItems((current) => ({
          ...current,
          [selectedTool.id]: (result.items || [])
            .filter((item) => item.prompt)
            .map((item) => ({
              id: item.id,
              value: `library:${item.id}`,
              label: item.title || item.label || "提示词素材",
              prompt: String(item.prompt).trim(),
            })),
        }));
    } finally {
      if (mountedRef.current) setPromptLoading(false);
    }
  };

  const addReferences = async (files) => {
    const incoming = Array.from(files || [])
      .filter((file) => file.type?.startsWith("image/"))
      .slice(0, Math.max(0, maxReferences - references.length));
    if (!incoming.length) return;
    uploadControllerRef.current?.abort();
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setReferenceUploading(true);
    try {
      const uploaded = await Promise.all(
        incoming.map(async (file) => {
          const result = await uploadFile(file, { signal: controller.signal });
          return {
            id: crypto.randomUUID(),
            name: file.name || "参考图",
            dataUrl: result.url,
            thumbnailUrl: result.thumbnailUrl || result.url,
            fileKey: result.key,
          };
        }),
      );
      if (mountedRef.current && !controller.signal.aborted)
        setReferences((current) => [...current, ...uploaded]);
    } catch (error) {
      if (error?.name !== "AbortError")
        notificationService.error(error?.message || "参考图上传失败");
    } finally {
      if (mountedRef.current) setReferenceUploading(false);
    }
  };

  const startCreate = async (event) => {
    event.preventDefault();
    const prompt = draftPrompt.trim();
    if (!selectedTool || launchSubmitting || referenceUploading) return;
    if (!prompt) {
      notificationService.info("请先输入创作内容");
      return;
    }
    const config = {
      ...selectedConfig,
      skills: [...(selectedConfig.skills || [])],
      referenceImages: references.map((item) => ({ ...item })),
      autoStart: true,
      costConfirmed: true,
    };
    if (selectedTool.id === "assistant")
      config.count =
        imageCountFromPrompt(prompt) || Math.max(1, Number(config.count) || 2);
    setLaunchSubmitting(true);
    try {
      const [wallet, unit] = await Promise.all([
        getWallet().catch(() => null),
        selectedTool.id === "assistant"
          ? Promise.resolve(null)
          : getFeatureUnitPriceCents("wallpaper"),
      ]);
      const count =
        selectedTool.id === "assistant"
          ? 1
          : Math.max(1, Math.min(4, Number(config.count) || 1));
      const assistantModel =
        assistantModels.conversation.find((item) => item.id === config.model) ||
        assistantModels.conversation[0];
      const imageModel = assistantModels.image[0];
      const assistantTotal = Math.max(
        Number(assistantModel?.pricePoints || 0),
        Number(imageModel?.pricePoints || 0) *
          Math.min(4, Number(config.count) || 2),
      );
      const unitPrice =
        selectedTool.id === "assistant"
          ? assistantTotal
          : Number(selectedModel?.pricePoints || unit || 0);
      setPendingLaunch({ tool: selectedTool, prompt, config });
      setCost({
        billingMode: "credits",
        unitCost: unitPrice * count,
        unitPriceCents: unitPrice,
        totalPriceCents: unitPrice * count,
        count,
        unitLabel: selectedTool.id === "assistant" ? "次" : "张",
        featureLabel:
          selectedTool.id === "assistant" ? "AI 助手 Agent" : "文生图",
        summary:
          selectedTool.id === "assistant"
            ? "确认后将进入一个全新的对话并立即执行；按实际路由结算，多余预留积分自动退回。"
            : "确认后将进入文生图工作台并立即执行；失败或取消时由服务端退回未结算积分。",
        creditAvailable: auth.isAuthenticated
          ? Number(
              wallet?.normalBalanceCents ??
                wallet?.availableCents ??
                wallet?.balanceCents ??
                0,
            )
          : null,
      });
    } catch (error) {
      notificationService.error(error?.message || "积分计算失败，请稍后重试");
    } finally {
      if (mountedRef.current) setLaunchSubmitting(false);
    }
  };

  const confirmLaunch = () => {
    if (!pendingLaunch) return;
    stashPendingPrompt({
      prompt: pendingLaunch.prompt,
      taskType: pendingLaunch.tool.taskType || pendingLaunch.tool.id || "t2i",
      config: pendingLaunch.config,
    });
    navigate(pendingLaunch.tool.to);
    setCost(null);
    setPendingLaunch(null);
  };

  return (
    <>
      <main
        ref={rootRef}
        className="studio-hub"
        onPointerDown={(event) => {
          if (
            !event.target.closest(
              ".studio-composer__popover, .studio-composer__field-wrap, .studio-composer__control.is-workflow, .studio-composer__control.is-library",
            )
          )
            setActivePanel("");
        }}
      >
        <div className="studio-hub__atmosphere" aria-hidden="true">
          <div className="studio-hub__aurora" />
          <div className="studio-hub__blinds" />
          <span className="studio-hub__orb is-a" data-studio-orb />
          <span className="studio-hub__orb is-b" data-studio-orb />
        </div>
        <div className="studio-hub__shell">
          <header className="studio-hero">
            <h1 className="studio-hero__brand" data-studio-enter>
              星空云绘
            </h1>
            <div className="studio-hero__lead" data-studio-enter>
              <StudioTypeLine texts={LEAD_LINES} />
            </div>
            <form
              ref={composerRef}
              className={`studio-composer${activePanel ? " has-open-panel" : ""}`}
              data-studio-enter
              onSubmit={startCreate}
            >
              <div className="studio-composer__prompt">
                <textarea
                  value={draftPrompt}
                  className="studio-composer__input"
                  rows="4"
                  maxLength="2000"
                  placeholder="描述你想做的画面、角色、风格或界面…"
                  aria-label="创作描述"
                  onChange={(event) => setDraftPrompt(event.target.value)}
                />
                {(references.length > 0 || referenceUploading) && (
                  <div
                    className="studio-composer__references"
                    aria-label="已添加的参考图"
                  >
                    {references.map((item) => (
                      <figure
                        key={item.id}
                        className="studio-composer__reference"
                      >
                        <AuthenticatedImage
                          src={item.thumbnailUrl || item.dataUrl}
                          alt={item.name}
                          maxDimension={160}
                        />
                        <button
                          type="button"
                          title="移除参考图"
                          aria-label="移除参考图"
                          onClick={() =>
                            setReferences((current) =>
                              current.filter(
                                (reference) => reference.id !== item.id,
                              ),
                            )
                          }
                        >
                          <i className="bi bi-x-lg" />
                        </button>
                      </figure>
                    ))}
                    {referenceUploading && (
                      <span className="studio-composer__reference-loading">
                        <i className="bi bi-arrow-repeat" />
                        正在上传
                      </span>
                    )}
                  </div>
                )}
                <div className="studio-composer__dock">
                  <div className="studio-composer__controls">
                    <button
                      type="button"
                      className="studio-composer__control is-workflow"
                      aria-expanded={activePanel === "tools"}
                      onClick={(event) => {
                        event.stopPropagation();
                        setActivePanel((current) =>
                          current === "tools" ? "" : "tools",
                        );
                      }}
                    >
                      <i className={`bi ${selectedTool?.icon || "bi-stars"}`} />
                      <span>{selectedTool?.label}</span>
                      <i className="bi bi-chevron-down" />
                    </button>
                    {fields.map((field) => (
                      <div
                        key={`${selectedToolId}-${field.key}`}
                        className="studio-composer__field-wrap"
                      >
                        <button
                          type="button"
                          className={`studio-composer__control studio-composer__inline-field is-${field.key}`}
                          title={field.label}
                          aria-label={field.label}
                          aria-expanded={activePanel === `field:${field.key}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActivePanel((current) =>
                              current === `field:${field.key}`
                                ? ""
                                : `field:${field.key}`,
                            );
                          }}
                        >
                          <i className={`bi ${field.icon}`} />
                          <span>{fieldLabel(field)}</span>
                          <i
                            className={`bi ${activePanel === `field:${field.key}` ? "bi-chevron-up" : "bi-chevron-down"}`}
                          />
                        </button>
                        {activePanel === `field:${field.key}` && (
                          <div
                            className="studio-composer__field-menu"
                            role="listbox"
                            aria-label={field.label}
                            aria-multiselectable={field.multiple || undefined}
                          >
                            {field.options.map((option) => (
                              <button
                                key={String(option.value)}
                                type="button"
                                role="option"
                                aria-selected={optionSelected(
                                  field,
                                  option.value,
                                )}
                                className={
                                  optionSelected(field, option.value)
                                    ? "is-selected"
                                    : ""
                                }
                                onClick={() =>
                                  selectOption(field, option.value)
                                }
                              >
                                <span>{option.label}</span>
                                {optionSelected(field, option.value) && (
                                  <i className="bi bi-check2" />
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {maxReferences > 0 && (
                      <button
                        type="button"
                        className="studio-composer__control is-reference"
                        disabled={
                          referenceUploading ||
                          references.length >= maxReferences
                        }
                        title={`添加参考图，最多 ${maxReferences} 张`}
                        aria-label="添加参考图"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <i className="bi bi-image" />
                        <span>参考图</span>
                        {references.length > 0 && <em>{references.length}</em>}
                      </button>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      hidden
                      onChange={(event) => {
                        void addReferences(event.target.files);
                        event.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="studio-composer__control is-icon is-library"
                      title="提示词库"
                      aria-label="提示词库"
                      aria-expanded={activePanel === "prompts"}
                      onClick={(event) => {
                        event.stopPropagation();
                        void openPromptLibrary();
                      }}
                    >
                      <i className="bi bi-journal-text" />
                    </button>
                  </div>
                  <div className="studio-composer__commit">
                    {voiceListening && (
                      <span className="studio-composer__voice-status">
                        正在聆听
                      </span>
                    )}
                    <span
                      className={`studio-composer__count${draftPrompt.length ? " is-visible" : ""}`}
                    >
                      {draftPrompt.length} / 2000
                    </span>
                    <button
                      type="button"
                      className={`studio-composer__control is-icon studio-composer__voice${voiceListening ? " is-listening" : ""}`}
                      disabled={!voiceSupported}
                      title={
                        voiceSupported
                          ? voiceListening
                            ? "停止语音输入"
                            : "语音输入"
                          : "当前浏览器不支持语音输入"
                      }
                      aria-label={voiceListening ? "停止语音输入" : "语音输入"}
                      aria-pressed={voiceListening}
                      onClick={() => {
                        if (voiceListening) recognitionRef.current?.stop?.();
                        else {
                          recognitionRef.current.lang = "zh-CN";
                          recognitionRef.current?.start?.();
                        }
                      }}
                    >
                      <i
                        className={`bi ${voiceListening ? "bi-stop-fill" : "bi-mic-fill"}`}
                      />
                    </button>
                    <button
                      type="submit"
                      className="studio-composer__submit"
                      disabled={
                        !selectedTool ||
                        !draftPrompt.trim() ||
                        referenceUploading ||
                        launchSubmitting
                      }
                      title="开始创作"
                      aria-label="开始创作"
                    >
                      <i className="bi bi-arrow-up" />
                    </button>
                  </div>
                </div>
              </div>
              {activePanel === "tools" && (
                <div
                  className="studio-composer__popover studio-composer__popover--tools"
                  role="menu"
                  aria-label="选择创作工具"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="studio-composer__popover-head">
                    <span>选择创作工具</span>
                    <button
                      type="button"
                      title="关闭"
                      aria-label="关闭"
                      onClick={() => setActivePanel("")}
                    >
                      <i className="bi bi-x-lg" />
                    </button>
                  </div>
                  <div className="studio-composer__tool-menu">
                    {composerTools.map((tool) => (
                      <button
                        key={tool.id}
                        type="button"
                        className={
                          selectedToolId === tool.id ? "is-active" : ""
                        }
                        role="menuitem"
                        onClick={() => {
                          setSelectedToolId(tool.id);
                          setActivePanel("");
                        }}
                      >
                        <i className={`bi ${tool.icon}`} />
                        <span>
                          <strong>{tool.label}</strong>
                          <small>{tool.tagline}</small>
                        </span>
                        {selectedToolId === tool.id && (
                          <i className="bi bi-check2" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {activePanel === "prompts" && (
                <div
                  className="studio-composer__popover studio-composer__popover--prompts"
                  role="dialog"
                  aria-label="提示词库"
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <div className="studio-composer__popover-head">
                    <span>{selectedTool?.label}提示词</span>
                    <button
                      type="button"
                      title="关闭"
                      aria-label="关闭"
                      onClick={() => setActivePanel("")}
                    >
                      <i className="bi bi-x-lg" />
                    </button>
                  </div>
                  {promptLoading ? (
                    <div className="studio-composer__prompt-empty">
                      正在加载提示词…
                    </div>
                  ) : promptItems[selectedToolId]?.length ? (
                    <div className="studio-composer__prompt-menu">
                      {promptItems[selectedToolId].map((item) => (
                        <button
                          key={item.value}
                          type="button"
                          onClick={() => {
                            setDraftPrompt(item.prompt);
                            if (item.id)
                              void recordPromptEngagement(
                                item.id,
                                "use",
                                true,
                              ).catch(() => null);
                            setActivePanel("");
                          }}
                        >
                          <strong>{item.label}</strong>
                          <span>{item.prompt}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="studio-composer__prompt-empty">
                      当前工具暂无可用提示词
                    </div>
                  )}
                </div>
              )}
            </form>
          </header>
          <section
            className="studio-section"
            aria-label="创作工具"
            data-studio-reveal
          >
            <div className="studio-section__head">
              <div>
                <h2>创作工具</h2>
              </div>
              <Link to="/prompts">去提示词库 →</Link>
            </div>
            {wallTools.length > 0 && (
              <div className="studio-bento">
                {wallTools.map((tool) => (
                  <Link
                    key={tool.id}
                    to={tool.to}
                    className={`studio-bento__item is-${tool.id}`}
                    data-studio-tool
                  >
                    {tool.cover && (
                      <img
                        src={tool.cover}
                        alt={tool.label}
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          const png = tool.cover.replace(/\.webp$/i, ".png");
                          if (png !== tool.cover) event.currentTarget.src = png;
                        }}
                      />
                    )}
                    <div className="studio-bento__copy">
                      <strong>
                        <i className={`bi ${tool.icon}`} /> {tool.label}
                      </strong>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
          {ecommerceTool && (
            <section
              className="studio-section studio-section--commerce"
              aria-label="AI 电商"
              data-studio-reveal
            >
              <div className="studio-section__head">
                <div>
                  <h2>AI 电商</h2>
                  <p>商品、人物与营销视觉独立工作流</p>
                </div>
                <Link to={ecommerceTool.to}>进入电商工作台 →</Link>
              </div>
              <div className="studio-commerce-module">
                <Link
                  to={`${ecommerceTool.to}?tool=detail`}
                  className="studio-commerce-module__hero"
                  data-studio-tool
                >
                  <img
                    src={ecommerceTool.cover}
                    alt={ecommerceTool.label}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="studio-commerce-module__badge">
                    {ecommerceTool.badge}
                  </span>
                  <span className="studio-commerce-module__hero-copy">
                    <small>COMMERCE STUDIO</small>
                    <strong>{ecommerceTool.tagline}</strong>
                    <span>
                      进入完整电商工作台 <i className="bi bi-arrow-up-right" />
                    </span>
                  </span>
                </Link>
                <div
                  className="studio-commerce-module__modes"
                  aria-label="电商工具快捷入口"
                >
                  {ecommerceModes.map((mode) => (
                    <Link
                      key={mode.id}
                      to={`${ecommerceTool.to}?tool=${mode.id}`}
                      className="studio-commerce-mode"
                      data-studio-tool
                    >
                      <span className="studio-commerce-mode__icon">
                        <i className={`bi ${mode.icon}`} />
                      </span>
                      <span className="studio-commerce-mode__copy">
                        <strong>{mode.shortLabel || mode.label}</strong>
                        <small>{mode.tagline}</small>
                      </span>
                      <i className="bi bi-chevron-right studio-commerce-mode__arrow" />
                    </Link>
                  ))}
                </div>
              </div>
            </section>
          )}
          <section
            className="studio-section studio-section--recent"
            aria-label="最近创作"
            data-studio-reveal
          >
            <div className="studio-section__head">
              <div>
                <h2>最近创作</h2>
              </div>
              <Link to="/history">查看全部 →</Link>
            </div>
            {!auth.isAuthenticated ? (
              <div className="studio-recent-login">
                <strong>登录后查看最近作品</strong>
                <span>同步云端任务进度与历史记录</span>
                <Link className="ch-btn is-primary" to="/auth?mode=login">
                  去登录
                </Link>
              </div>
            ) : recentLoading ? (
              <div className="studio-recent-loading">正在读取最近创作…</div>
            ) : !recentTasks.length ? (
              <div className="studio-recent-empty">
                <strong>还没有作品</strong>
                <span>在上方输入想法，或从工具墙开始第一次创作</span>
              </div>
            ) : (
              <div
                className="ch-masonry"
                style={{ "--ch-masonry-cols": columnCount }}
              >
                {columns.map((column, index) => (
                  <div key={index} className="ch-masonry__col">
                    {column.map((item) => (
                      <Link
                        key={item.key}
                        className="ch-card"
                        to="/history"
                        title={taskPrompt(item.task) || "查看历史"}
                      >
                        <div
                          className="ch-card__media"
                          style={{ aspectRatio: item.aspect }}
                        >
                          {item.src ? (
                            <AuthenticatedImage
                              src={item.src}
                              alt={taskPrompt(item.task) || "AI 作品"}
                              loading={
                                item.index < Math.max(4, columnCount * 2)
                                  ? "eager"
                                  : "lazy"
                              }
                              rootMargin="240px 0px"
                              retryCount={2}
                              maxDimension={
                                failedThumbs.has(item.key) ? 0 : 720
                              }
                              onError={() =>
                                setFailedThumbs(
                                  (current) => new Set([...current, item.key]),
                                )
                              }
                            />
                          ) : (
                            <div className="ch-card__placeholder">
                              <i className="bi bi-image" />
                            </div>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
      <StudioCostDialog
        cost={cost}
        onConfirm={confirmLaunch}
        onCancel={() => {
          setCost(null);
          setPendingLaunch(null);
        }}
      />
    </>
  );
}
