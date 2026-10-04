// AI 助手的图片查看与编辑器（参照 ChatGPT 的图片编辑界面）：左侧版本、顶部五个工具
// （标注 / 评论 / 去背景 / 擦除 / 调整尺寸）、底部“描述修改”。每次修改都作为一轮出图
// 发到当前对话里，完成后作为新版本出现在左侧并自动选中。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildImageEditMaskPayload, paintCommentPins } from "./domain/imageEditMask.js";
import { penPath, renderMarkupFile } from "./domain/imageMarkup.js";
import { MarkupLayer, MarkupSizeSlider, MarkupToolbar, SizeSlider, StudioIcon, useImageMarkup, useMarkupShortcuts } from "./AssistantImageMarkup.jsx";
import { menuKeyDown, useStudioMenu } from "./useStudioMenu.js";
import { getModelAspectRatiosForResolution, normalizeImageModelCapabilities } from "@react/legacy-modules/features/ai-shared/modelImageCapabilities.js";
import "./assistant-image-studio.css";

const TOOLS = [
  { id: "markup", label: "标注", icon: "markup", hint: "在图上画线、写字或画图形标出要改的地方，再补充怎么改" },
  { id: "comment", label: "评论", icon: "comment", hint: "点图片添加评论，每条评论只改它所在的位置" },
  { id: "removeBg", label: "去背景", icon: "removeBg", hint: "去掉背景，输出透明 PNG" },
  { id: "erase", label: "擦除", icon: "eraser", hint: "涂抹要去掉的东西，会用周围的画面补全" },
  { id: "resize", label: "调整尺寸", icon: "resize", hint: "换一个比例，新增的部分自动补全" },
];
// 缩放：倍数是相对原图像素的，“适应窗口”按窗口算。放大缩小都以窗口中心（滚轮时以鼠标位置）为准。
const ZOOM_PRESETS = [0.5, 1, 2];
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;
// 擦除画笔大小（0-100）记在本机，下次打开沿用。
const ERASE_SIZE_KEY = "starclouds-assistant-erase-size";
function readEraseSize() {
  try {
    const value = Number(window.localStorage.getItem(ERASE_SIZE_KEY));
    return Number.isFinite(value) && value > 0 ? Math.min(100, value) : 30;
  } catch {
    return 30;
  }
}
// 笔迹粗细按画布长边的千分之几存（和蒙版画布的画法一致）。
const eraseBrush = (size) => 10 + size * 1.1;
const ERASE_HOLD_MS = 1000;
const ERASE_PROMPT = "去掉涂抹区域里的内容，用周围的背景自然补全，其余画面保持不变。";
const REMOVE_BG_PROMPT = "去掉背景，只保留主体，主体的外形、颜色、文字和细节保持原样不变，背景完全透明。";
const MAX_MASK_SIDE = 1600;

// 图片尺寸按地址缓存：切换时等新图解码好再一次换上，画面不会先塌再跳。
const imageSizes = new Map();
const loadedSizes = new Map();

function loadImageSize(src) {
  if (!src) return Promise.resolve({ width: 0, height: 0 });
  if (!imageSizes.has(src)) {
    const image = new Image();
    image.decoding = "async";
    image.src = src;
    const read = () => ({ width: image.naturalWidth, height: image.naturalHeight });
    const pending = (image.decode ? image.decode() : Promise.reject(new Error("no decode")))
      .then(read, () => new Promise((resolve) => {
        if (image.complete) resolve(read());
        else { image.onload = () => resolve(read()); image.onerror = () => resolve({ width: 0, height: 0 }); }
      }))
      .then((size) => {
        if (size.width) loadedSizes.set(src, size);
        else imageSizes.delete(src);
        return size;
      });
    imageSizes.set(src, pending);
  }
  return imageSizes.get(src);
}

function imageSource(item = {}) {
  return String(item.displayUrl || item.dataUrl || item.url || item.thumbUrl || "").trim();
}

function imageOriginal(item = {}) {
  return String(item.dataUrl || item.url || item.displayUrl || "").trim();
}

function imageThumb(item = {}) {
  return String(item.thumbUrl || item.thumbnailUrl || item.displayUrl || item.dataUrl || "").trim();
}

function imageKey(item = {}) {
  return String(item.id || item.fileKey || imageOriginal(item));
}

async function loadOriginal(item) {
  const response = await fetch(imageOriginal(item), { credentials: "same-origin" });
  if (!response.ok) throw new Error("原图读取失败，请稍后重试");
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    return { image, blob, release: () => URL.revokeObjectURL(url) };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function versionMeta(version) {
  return { ...version.meta, messageId: version.message?.id, runId: version.message?.runId };
}

// 擦除时看到的涂抹区域：一整片半透明的蓝，重叠处不会更深。还没按满 1 秒的那一笔先画得淡一些。
// 坐标和蒙版画布一致：点是 0-1，粗细是画布长边的千分之几。
function EraseView({ strokes, tick, width, height }) {
  const paths = useMemo(() => {
    const side = Math.max(width, height) / 1000;
    return strokes.map((stroke) => ({
      d: penPath(stroke.points.map((point) => [point.x * width, point.y * height])),
      width: stroke.size * side,
      pending: Boolean(stroke.pending),
    }));
  // tick：画的过程中点是直接追加到同一个数组里的，靠它重新算路径。
  }, [height, strokes, tick, width]);
  if (!paths.length) return null;
  const layer = (list) => list.map((path, index) => (
    <path key={index} d={path.d} fill="none" stroke="#2b7cff" strokeWidth={path.width} strokeLinecap="round" strokeLinejoin="round" />
  ));
  return (
    <svg className="ais-erase-view" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <g className="ais-erase-fill">{layer(paths.filter((path) => !path.pending))}</g>
      <g className="ais-erase-fill is-pending">{layer(paths.filter((path) => path.pending))}</g>
    </svg>
  );
}

// 比例小图标：长边 18px。
function ratioIconSize(ratio) {
  const value = ratioValue(ratio);
  return value >= 1 ? { width: 18, height: Math.round(18 / value) } : { width: Math.round(18 * value), height: 18 };
}

function ratioValue(ratio) {
  const [width, height] = String(ratio).split(":").map(Number);
  return width > 0 && height > 0 ? width / height : 0;
}

// 比例的叫法按形状来：正方形、竖版、竖屏长图、横版、宽屏。排序是方的在前，竖的由宽到窄，横的由窄到宽。
function ratioOptions(ratios) {
  const named = ratios.map((ratio) => {
    const value = ratioValue(ratio);
    const label = Math.abs(value - 1) < 0.01 ? "正方形"
      : value < 1 ? (value <= 0.6 ? "竖屏长图" : "竖版")
        : (value >= 1.7 ? "宽屏" : "横版");
    const group = Math.abs(value - 1) < 0.01 ? 0 : value < 1 ? 1 : 2;
    return { ratio, label, value, group };
  });
  return named.sort((a, b) => a.group - b.group || (a.group === 1 ? b.value - a.value : a.value - b.value));
}

export function AssistantImageStudio({
  value,
  messages = [],
  imageModels = [],
  currentModel = "",
  busy = false,
  dark = false,
  onClose,
  onEdit,
  onDownload,
  onCopyPrompt,
  onUseReference,
  onFavorite,
  onPublish,
  onDelete,
}) {
  // 在编辑器里切换图片只改这里的状态：放到页面上会让整个对话重新渲染，点侧边会卡。
  // 外面重新打开（value 变了）时回到打开的那张。
  const [picked, setPicked] = useState(null);
  useEffect(() => { setPicked(null); }, [value]);
  const select = useCallback((image, imageMeta = null) => {
    if (image) setPicked({ item: image, meta: imageMeta });
  }, []);
  const item = picked?.item || value?.item || null;
  const rawMeta = picked ? picked.meta || value?.baseMeta || value?.meta : value?.meta;
  const meta = useMemo(() => (rawMeta && typeof rawMeta === "object" ? rawMeta : {}), [rawMeta]);
  const gallery = useMemo(() => {
    const list = Array.isArray(value?.gallery) && value.gallery.length ? value.gallery : value?.item ? [value.item] : [];
    return list.filter((entry) => imageSource(entry));
  }, [value?.gallery, value?.item]);
  const [tool, setTool] = useState("");
  const [zoom, setZoom] = useState("fit");
  const zoomMenu = useStudioMenu();
  const moreMenu = useStudioMenu();
  const zoomOpen = zoomMenu.open;
  const moreOpen = moreMenu.open;
  const setZoomOpen = zoomMenu.setOpen;
  const setMoreOpen = moreMenu.setOpen;
  // 下载：进行中显示转圈，完成后短暂显示对勾。
  const [downloadState, setDownloadState] = useState("");
  const [eraseSize, setEraseSize] = useState(readEraseSize);
  const brush = eraseBrush(eraseSize);
  useEffect(() => {
    try { window.localStorage.setItem(ERASE_SIZE_KEY, String(eraseSize)); } catch { /* 存不了就只在这次有效 */ }
  }, [eraseSize]);
  // 擦除的重做栈、画的过程中的刷新计数（笔迹点直接追加，不每次 setState）。
  const [redoStrokes, setRedoStrokes] = useState([]);
  const [strokeTick, setStrokeTick] = useState(0);
  const tickRef = useRef(0);
  const [eraseCursor, setEraseCursor] = useState(null);
  const resizeMenu = useStudioMenu();
  const [resizeAnchor, setResizeAnchor] = useState(null);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("");
  const [pins, setPins] = useState([]);
  const [activePin, setActivePin] = useState("");
  const [strokes, setStrokes] = useState([]);
  // 正在显示的图：新图解码完成前继续显示上一张。
  const [shown, setShown] = useState({ key: "", src: "", width: 0, height: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 有标注时退出标注或关闭编辑器先确认：{ action: "exit" | "close" }。
  const [confirmLeave, setConfirmLeave] = useState(null);
  // 本次打开期间发出的修改：{ id: 助手消息 id, source: 来源图片 key, label, meta }。
  const [versions, setVersions] = useState([]);
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const stageRef = useRef(null);
  const railRef = useRef(null);
  const [imageBox, setImageBox] = useState({ width: 0, height: 0 });
  const [stageBox, setStageBox] = useState({ width: 0, height: 0 });
  const drawingRef = useRef(null);

  const currentKey = item ? imageKey(item) : "";
  // 和提交修改时选模型的规则一致：套图用当前选的生图模型，其他图沿用生成它的模型。
  const model = useMemo(() => {
    const id = String((meta.commerceSetId ? "" : meta.model) || currentModel || "").trim();
    return imageModels.find((entry) => entry.model === id || entry.id === id) || imageModels[0] || null;
  }, [currentModel, imageModels, meta.commerceSetId, meta.model]);
  const supportsTransparent = model?.transparentBackground === true;
  // 可选比例全部来自模型配置（按这张图的分辨率取），没有就不提供调整尺寸。
  const ratios = useMemo(() => {
    if (!model) return [];
    const resolution = meta.resolution || normalizeImageModelCapabilities(model).resolutions?.[0] || "";
    const list = getModelAspectRatiosForResolution(model, resolution)
      .map((entry) => String(entry || "").trim())
      .filter((entry) => ratioValue(entry) > 0 && entry !== "auto");
    return [...new Set(list)];
  }, [meta.resolution, model]);

  // 版本：对话里对应消息的状态和出图。
  const versionEntries = useMemo(() => versions.map((version) => {
    const message = messages.find((entry) => entry.id === version.id);
    const image = message?.images?.find((entry) => imageSource(entry)) || null;
    const failed = Boolean(message && !message.pending && !image && (message.error || message.statusStage === "failed"));
    return { ...version, message, image, failed, pending: !image && !failed };
  }), [messages, versions]);

  const resetEditing = useCallback(() => {
    setStrokes([]);
    setRedoStrokes([]);
    setPins([]);
    setActivePin("");
    setError("");
  }, []);

  // 切换图片时清掉上一张的标注。
  useEffect(() => {
    resetEditing();
  }, [currentKey, resetEditing]);

  const currentSrc = item ? imageSource(item) : "";

  // 对比原图：对话里的改图结果带着 editSource；在这里改出来的版本，原图就是它的来源图。
  const compareSource = useMemo(() => {
    if (!item) return null;
    if (item.editSource && imageSource(item.editSource)) return item.editSource;
    const version = versionEntries.find((entry) => entry.image && imageKey(entry.image) === currentKey);
    if (!version?.source) return null;
    return gallery.find((entry) => imageKey(entry) === version.source)
      || versionEntries.find((entry) => entry.image && imageKey(entry.image) === version.source)?.image
      || null;
  }, [currentKey, gallery, item, versionEntries]);
  const [comparing, setComparing] = useState(false);
  const [comparePosition, setComparePosition] = useState(50);
  useEffect(() => {
    setComparing(false);
    setComparePosition(50);
  }, [currentKey]);
  useEffect(() => {
    if (!currentSrc) return undefined;
    let cancelled = false;
    loadImageSize(currentSrc).then((size) => {
      if (!cancelled) setShown({ key: currentKey, src: currentSrc, ...size });
    });
    return () => { cancelled = true; };
  }, [currentKey, currentSrc]);
  // 看过或预加载过的图尺寸已知，直接显示，不等下一次渲染。
  const known = loadedSizes.get(currentSrc);
  const display = shown.key === currentKey && shown.src === currentSrc ? shown
    : known ? { key: currentKey, src: currentSrc, ...known } : shown;
  const ready = display.src === currentSrc && display.key === currentKey;
  const natural = useMemo(() => (ready ? { width: display.width, height: display.height } : { width: 0, height: 0 }), [ready, display.width, display.height]);
  const markup = useImageMarkup({ width: natural.width, height: natural.height });
  const resetMarkup = markup.reset;
  useEffect(() => { resetMarkup(); }, [currentKey, resetMarkup]);
  useMarkupShortcuts(markup, tool === "markup");

  // 修改完成后自动切到新版本。
  const announcedRef = useRef(new Set());
  useEffect(() => {
    for (const version of versionEntries) {
      if (!version.image || announcedRef.current.has(version.id)) continue;
      announcedRef.current.add(version.id);
      select(version.image, versionMeta(version));
    }
  }, [select, versionEntries]);

  // 打开另一组图片时，本次的修改记录和工具状态重新开始。
  useEffect(() => {
    setVersions([]);
    setTool("");
    setPrompt("");
    setRatio("");
  }, [value?.gallery]);

  // 涂抹层和评论图钉叠在图片实际显示的区域上。
  useEffect(() => {
    const element = imageRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => setImageBox({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [display.src, display.width]);

  // 适应窗口：按图片区实际可用的大小算出显示尺寸，竖图横图都完整显示、不放大超过原图。
  useEffect(() => {
    const element = stageRef.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const style = window.getComputedStyle(element);
      setStageBox({
        width: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        height: element.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [item]);

  // 画布：笔迹按图片比例存成 0-1 坐标，换缩放也能对齐。
  const maskSize = useMemo(() => {
    if (!natural.width || !natural.height) return { width: 0, height: 0 };
    const scale = Math.min(1, MAX_MASK_SIDE / Math.max(natural.width, natural.height));
    return { width: Math.round(natural.width * scale), height: Math.round(natural.height * scale) };
  }, [natural]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !maskSize.width) return;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#000";
    const scale = Math.max(canvas.width, canvas.height);
    for (const stroke of strokes) {
      context.lineWidth = stroke.size * (scale / 1000);
      context.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * canvas.width;
        const y = point.y * canvas.height;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      });
      if (stroke.points.length === 1) context.lineTo(stroke.points[0].x * canvas.width + 0.1, stroke.points[0].y * canvas.height);
      context.stroke();
    }
  }, [maskSize.width, strokes]);

  useEffect(() => { redraw(); }, [redraw, tool]);

  const relativePoint = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const startStroke = (event) => {
    if (tool !== "markup" && tool !== "erase") return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const stroke = { size: brush, points: [relativePoint(event)] };
    drawingRef.current = stroke;
    if (tool === "erase") {
      // 擦除要按住 1 秒以上才算：点一下或一扫而过不会留下一块。没到 1 秒先画得淡一些。
      stroke.pending = true;
      stroke.timer = window.setTimeout(() => {
        stroke.pending = false;
        setStrokeTick((value) => value + 1);
      }, ERASE_HOLD_MS);
    } else {
      setRedoStrokes([]);
    }
    setStrokes((current) => [...current, stroke]);
  };

  const moveStroke = (event) => {
    if (tool === "erase") {
      const rect = event.currentTarget.getBoundingClientRect();
      setEraseCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    const stroke = drawingRef.current;
    if (!stroke) return;
    stroke.points.push(relativePoint(event));
    redraw();
    // 浅蓝色的涂抹区域每帧最多刷新一次。
    if (!tickRef.current) {
      tickRef.current = window.requestAnimationFrame(() => {
        tickRef.current = 0;
        setStrokeTick((value) => value + 1);
      });
    }
  };

  const undoStroke = () => {
    if (!strokes.length) return;
    setRedoStrokes([strokes[strokes.length - 1], ...redoStrokes]);
    setStrokes(strokes.slice(0, -1));
  };
  const redoStroke = () => {
    if (!redoStrokes.length) return;
    setStrokes([...strokes, redoStrokes[0]]);
    setRedoStrokes(redoStrokes.slice(1));
  };

  const endStroke = () => {
    const stroke = drawingRef.current;
    if (!stroke) return;
    drawingRef.current = null;
    if (stroke.timer) window.clearTimeout(stroke.timer);
    if (stroke.pending) {
      setStrokes((current) => current.filter((entry) => entry !== stroke));
      return;
    }
    if (tool === "erase") setRedoStrokes([]);
    setStrokes((current) => [...current]);
  };

  const addPin = (event) => {
    if (tool !== "comment" || event.target.closest(".ais-pin")) return;
    const point = relativePoint(event);
    const pin = { id: `pin-${Date.now()}`, x: point.x, y: point.y, text: "" };
    // 上一条还没写就点了别处：丢掉那条空的。
    setPins((current) => [...current.filter((entry) => entry.id !== activePin || entry.text.trim()), pin]);
    setActivePin(pin.id);
  };

  const pickTool = (id) => {
    setError("");
    setMoreOpen(false);
    setZoomOpen(false);
    if (id === "removeBg") {
      void submit("removeBg");
      return;
    }
    setTool((current) => (current === id ? "" : id));
  };

  // 调整尺寸是个下拉：按钮下面弹出比例列表，点一个就直接按这个比例生成。
  const resizeOptions = useMemo(() => ratioOptions(ratios), [ratios]);
  const currentRatio = (() => {
    const fromMeta = String(meta.ratio || "");
    if (resizeOptions.some((entry) => entry.ratio === fromMeta)) return fromMeta;
    if (!natural.width || !natural.height) return "";
    const value = natural.width / natural.height;
    return resizeOptions.find((entry) => Math.abs(ratioValue(entry.ratio) - value) / value < 0.03)?.ratio || "";
  })();
  const toggleResize = (event) => {
    setError("");
    setMoreOpen(false);
    setZoomOpen(false);
    const rect = event.currentTarget.getBoundingClientRect();
    setResizeAnchor({ top: rect.bottom + 8, left: Math.max(8, Math.min(rect.left, window.innerWidth - 268)) });
    resizeMenu.toggle(event);
  };

  const filledPins = pins.filter((pin) => pin.text.trim());
  const text = prompt.trim();
  const canSubmit = !busy && !submitting && Boolean(item) && (
    tool === "markup" ? markup.hasMarks
      : tool === "erase" ? strokes.length > 0
        : tool === "comment" ? filledPins.length > 0
          : tool === "resize" ? Boolean(ratio)
            : Boolean(text)
  );

  const buildRegion = async (selection, regionPrompt) => {
    const original = await loadOriginal(item);
    try {
      return await buildImageEditMaskPayload({
        image: original.image,
        selection,
        prompt: regionPrompt,
        sourceBlob: item.fileKey ? null : original.blob,
      });
    } finally {
      original.release();
    }
  };

  const submit = async (kind = tool, options = {}) => {
    if (!item || busy || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      let request = null;
      if (kind === "removeBg") {
        request = { kind, prompt: REMOVE_BG_PROMPT, displayText: "去背景", transparent: true };
      } else if (kind === "resize") {
        const target = options.ratio || ratio;
        const extra = text ? `新增区域：${text}。` : "";
        request = {
          kind,
          ratio: target,
          prompt: `把画面扩展为 ${target} 比例：原有主体、文字和内容保持原样不变，只自然补全新增的画面区域。${extra}`,
          displayText: `调整尺寸为 ${target}${text ? `：${text}` : ""}`,
        };
      } else if (kind === "markup") {
        // 标注不当蒙版用：箭头、文字是“说明”。原图叠上标注导出一张图，和原图一起作为参考图。
        const original = await loadOriginal(item);
        let annotatedFile;
        try {
          annotatedFile = await renderMarkupFile(original.image, markup.items, natural);
        } finally {
          original.release();
        }
        request = { kind, prompt: text, displayText: `标注修改${text ? `：${text}` : ""}`, annotatedFile };
      } else if (kind === "erase") {
        const regionPrompt = text ? `${ERASE_PROMPT}${text}` : ERASE_PROMPT;
        request = {
          kind,
          prompt: regionPrompt,
          displayText: `擦除${text ? `：${text}` : ""}`,
          region: await buildRegion(canvasRef.current, regionPrompt),
        };
      } else if (kind === "comment") {
        const selection = document.createElement("canvas");
        selection.width = maskSize.width || 1000;
        selection.height = maskSize.height || 1000;
        paintCommentPins(selection, filledPins);
        const lines = filledPins.map((pin, index) => `${index + 1}. ${pin.text.trim()}`);
        const regionPrompt = `按图上评论的位置修改：\n${lines.join("\n")}${text ? `\n整体要求：${text}` : ""}`;
        request = { kind, prompt: regionPrompt, displayText: `评论修改：${filledPins.map((pin) => pin.text.trim()).join("；")}`, region: await buildRegion(selection, regionPrompt) };
        selection.width = selection.height = 1;
      } else {
        request = {
          kind: "describe",
          prompt: `在这张图的基础上修改：${text}。其余画面保持不变。`,
          displayText: text,
        };
      }
      const messageId = await onEdit?.({ ...request, item, meta });
      if (!messageId) return;
      setVersions((current) => [...current, {
        id: messageId,
        source: currentKey,
        label: request.displayText,
        meta: { ...meta, ratio: request.ratio || meta.ratio, prompt: request.displayText },
      }]);
      setPrompt("");
      resetEditing();
      markup.reset();
      setTool("");
    } catch (caught) {
      setError(caught?.message || "修改提交失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  // 退出标注或关闭编辑器：画了标注就先问一下，不直接丢掉。
  const leaveNow = useCallback((action) => {
    setConfirmLeave(null);
    markup.reset();
    resetEditing();
    setTool("");
    if (action === "close") onClose?.();
  }, [markup, onClose, resetEditing]);
  // 标注、擦除、评论里有没提交的内容时，退出或关闭前先确认。
  const unsent = tool === "markup" ? (markup.hasMarks ? "画好的标注" : "")
    : tool === "erase" ? (strokes.length ? "涂好的擦除区域" : "")
      : tool === "comment" ? (pins.some((pin) => pin.text.trim()) ? "写好的评论" : "")
        : "";
  const leave = useCallback((action) => {
    if (unsent) setConfirmLeave({ action, what: unsent });
    else leaveNow(action);
  }, [leaveNow, unsent]);

  // 左侧所有可看的图：原图在前，本次修改出的版本在后。
  const strip = useMemo(() => [
    ...gallery.map((image) => ({ image, meta: image.studioMeta || null })),
    ...versionEntries.filter((entry) => entry.image).map((entry) => ({ image: entry.image, meta: versionMeta(entry) })),
  ], [gallery, versionEntries]);
  const stripIndex = strip.findIndex((entry) => imageKey(entry.image) === currentKey);
  const go = useCallback((step) => {
    if (stripIndex < 0 || strip.length < 2) return;
    const next = strip[(stripIndex + step + strip.length) % strip.length];
    select(next.image, next.meta);
  }, [select, strip, stripIndex]);

  // 当前那张在侧边栏里始终可见（图多、用键盘切换时）。
  useEffect(() => {
    railRef.current?.querySelector(".is-current")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [currentKey]);

  // 预先加载前后两张，点侧边或左右切换时直接出图。
  useEffect(() => {
    if (stripIndex < 0 || strip.length < 2) return;
    for (const step of [1, -1]) {
      const entry = strip[(stripIndex + step + strip.length) % strip.length];
      void loadImageSize(imageSource(entry.image));
    }
  }, [strip, stripIndex]);

  const fitScale = display.width && stageBox.width > 0 && stageBox.height > 0
    ? Math.min(1, stageBox.width / display.width, stageBox.height / display.height) : 0;
  const zoomScale = zoom === "fit" ? 0 : zoom;
  const shownScale = zoomScale || fitScale;
  const frameRef = useRef(null);
  const anchorRef = useRef(null);
  const panRef = useRef(null);
  const [panning, setPanning] = useState(false);
  const scaleRef = useRef({ shown: shownScale, fit: fitScale });
  scaleRef.current = { shown: shownScale, fit: fitScale };

  // 换一张图回到适应窗口。
  useEffect(() => { setZoom("fit"); }, [currentKey]);

  // anchor 是屏幕坐标；缩放后滚动图片区，让 anchor 下面还是同一处画面。
  const applyZoom = useCallback((next, anchor = null, snapToFit = false) => {
    if (next === "fit") {
      anchorRef.current = null;
      setZoom("fit");
      return;
    }
    const { fit } = scaleRef.current;
    const scale = Math.min(ZOOM_MAX, Math.max(Math.min(0.1, fit || 0.1), next));
    // 滚轮或连续放大缩小经过“适应窗口”附近时吸附过去；离得远就照常缩放（可以比适应窗口更小）。
    if (snapToFit && fit && Math.abs(scale - fit) <= fit * 0.02) {
      anchorRef.current = null;
      setZoom("fit");
      return;
    }
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (stage && frame) {
      const rect = frame.getBoundingClientRect();
      const box = stage.getBoundingClientRect();
      const point = anchor || { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      const clamp = (value) => Math.min(1, Math.max(0, value));
      anchorRef.current = { point, fx: clamp((point.x - rect.left) / rect.width), fy: clamp((point.y - rect.top) / rect.height) };
    }
    setZoom(scale);
  }, []);
  const zoomBy = useCallback((factor, anchor = null) => {
    applyZoom(scaleRef.current.shown * factor, anchor, true);
  }, [applyZoom]);
  useLayoutEffect(() => {
    const pending = anchorRef.current;
    anchorRef.current = null;
    const stage = stageRef.current;
    const frame = frameRef.current;
    if (!pending || !stage || !frame) return;
    const rect = frame.getBoundingClientRect();
    stage.scrollLeft += rect.left + pending.fx * rect.width - pending.point.x;
    stage.scrollTop += rect.top + pending.fy * rect.height - pending.point.y;
  }, [zoom]);

  // ⌘/Ctrl + 滚轮、触控板双指捏合：以鼠标位置缩放。普通滚轮在放大后用来移动画面。
  const hasItem = Boolean(item);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.01), { x: event.clientX, y: event.clientY });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [hasItem, zoomBy]);

  // 放大后、没选编辑工具时，按住拖动移动画面。
  const startPan = (event) => {
    if (!zoomScale || tool || event.button !== 0 || event.target.closest?.("button, .ais-pin")) return;
    const stage = stageRef.current;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    panRef.current = { x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    setPanning(true);
  };
  const movePan = (event) => {
    const pan = panRef.current;
    if (!pan) return;
    stageRef.current.scrollLeft = pan.left - (event.clientX - pan.x);
    stageRef.current.scrollTop = pan.top - (event.clientY - pan.y);
  };
  const endPan = () => {
    panRef.current = null;
    setPanning(false);
  };
  // 双击图片：适应窗口和实际大小之间切换（图本来就不大时放到 2 倍）。
  const toggleZoom = (event) => {
    if (tool) return;
    if (zoom === "fit") applyZoom(fitScale < 0.98 ? 1 : 2, { x: event.clientX, y: event.clientY });
    else applyZoom("fit");
  };

  // 键盘：Esc 关闭，左右切换。
  useEffect(() => {
    if (!item) return undefined;
    const onKey = (event) => {
      const typing = event.target?.closest?.("textarea, input");
      if (event.key === "Escape") {
        if (zoomOpen || moreOpen || resizeMenu.open) { setZoomOpen(false); setMoreOpen(false); resizeMenu.close(); }
        else if (activePin) setActivePin("");
        else if (tool === "markup" && (markup.selectedId || markup.menu)) { markup.setSelectedId(""); markup.setMenu(""); }
        else if (confirmLeave) setConfirmLeave(null);
        else if (comparing) setComparing(false);
        else if (tool) leave("exit");
        else onClose?.();
        return;
      }
      if (!typing && (event.metaKey || event.ctrlKey) && ["=", "+", "-", "0"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") applyZoom("fit");
        else zoomBy(event.key === "-" ? 1 / ZOOM_STEP : ZOOM_STEP);
        return;
      }
      if (typing || tool) return;
      const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : 0;
      if (step) go(step);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePin, applyZoom, comparing, confirmLeave, go, item, leave, markup, moreOpen, onClose, resizeMenu, tool, zoomBy, zoomOpen]);

  if (!item || !imageSource(item)) return null;
  const title = String(meta.title || meta.prompt || item.revisedPrompt || item.name || "图片").trim();
  const activeTool = TOOLS.find((entry) => entry.id === tool);
  const painting = tool === "erase";
  const zoomLabel = `${Math.round(shownScale * 100)}%`;
  const frameStyle = shownScale ? { width: Math.round(display.width * shownScale), height: Math.round(display.height * shownScale) } : undefined;
  const placeholder = tool === "markup" ? "补充修改说明（可选）"
    : tool === "erase" ? "可选：说明擦掉后补成什么"
      : tool === "comment" ? "可选：补充整体要求"
        : tool === "resize" ? "可选：说明新增的部分放什么"
          : "描述想怎么改这张图";
  const busyText = submitting ? "正在提交…" : busy ? "正在生成，完成后可继续修改" : "";

  // 挂到 body 上，盖住站点顶栏；主题由外面传进来。
  return createPortal(
    <div className={`ais${dark ? " is-dark" : ""}${tool === "markup" ? " is-markup" : ""}`} role="dialog" aria-modal="true" aria-label="图片查看与编辑" onClick={(event) => event.stopPropagation()}>
      <header className="ais-top">
        <div className="ais-top-left">
          <button type="button" className="ais-icon" aria-label="关闭预览" title="关闭 (Esc)" onClick={() => leave("close")}><i className="bi bi-x-lg" /></button>
          <h2 className="ais-title" title={title}>{title}</h2>
          {strip.length > 1 && stripIndex >= 0 && <span className="ais-count">{`${stripIndex + 1}/${strip.length}`}</span>}
        </div>
        <div className="ais-top-right">
          {compareSource && !tool ? (
            <button type="button" className={`ais-compare-toggle${comparing ? " is-active" : ""}`} aria-pressed={comparing}
              title={comparing ? "退出对比 (Esc)" : "和改之前的原图对比"} onClick={() => setComparing((value) => !value)}>
              <i className={`bi ${comparing ? "bi-x-lg" : "bi-layout-split"}`} aria-hidden="true" />{comparing ? "退出对比" : "对比原图"}
            </button>
          ) : null}
          <div className="ais-menu-wrap" ref={zoomMenu.wrapRef}>
            <button type="button" className={`ais-zoom${zoomOpen ? " is-open" : ""}`} aria-haspopup="menu" aria-expanded={zoomOpen} aria-label={`缩放：${zoom === "fit" ? "适应窗口" : zoomLabel}`}
              onClick={(event) => { zoomMenu.toggle(event); setMoreOpen(false); }}>
              <span className="ais-zoom-value">{zoomLabel}</span><i className="bi bi-chevron-down ais-chevron" aria-hidden="true" />
            </button>
            {zoomMenu.mounted && (
              <div className={`ais-menu is-right is-zoom${zoomMenu.closing ? " is-closing" : ""}`} role="menu" aria-label="缩放" onKeyDown={menuKeyDown}
                // 放大 / 缩小要能连续点：关掉全站的防重复点击（它会吞掉 500ms 内的第二次点击）。
                data-click-guard="off">
                <button type="button" role="menuitem" disabled={shownScale >= ZOOM_MAX} onClick={() => zoomBy(ZOOM_STEP)}>
                  <i className="bi bi-zoom-in" />放大<kbd>⌘ +</kbd>
                </button>
                <button type="button" role="menuitem" onClick={() => zoomBy(1 / ZOOM_STEP)}>
                  <i className="bi bi-zoom-out" />缩小<kbd>⌘ −</kbd>
                </button>
                <span className="ais-menu-sep" aria-hidden="true" />
                <button type="button" role="menuitemradio" aria-checked={zoom === "fit"} onClick={() => { applyZoom("fit"); setZoomOpen(false); }}>
                  适应窗口<kbd>⌘ 0</kbd><i className="bi bi-check2 ais-check" aria-hidden="true" />
                </button>
                {ZOOM_PRESETS.map((value) => (
                  <button key={value} type="button" role="menuitemradio" aria-checked={zoom === value} onClick={() => { applyZoom(value); setZoomOpen(false); }}>
                    {value * 100}%<i className="bi bi-check2 ais-check" aria-hidden="true" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            className={`ais-icon ais-download${downloadState ? ` is-${downloadState}` : ""}`}
            aria-label={downloadState === "busy" ? "正在下载" : "下载图片"}
            title="下载"
            disabled={downloadState === "busy"}
            onClick={async () => {
              setDownloadState("busy");
              try {
                await onDownload?.(item, meta);
                setDownloadState("done");
                window.setTimeout(() => setDownloadState((current) => (current === "done" ? "" : current)), 1400);
              } catch {
                setDownloadState("");
              }
            }}
          >
            {downloadState === "busy" ? <span className="ais-spinner" aria-hidden="true" />
              : <i className={`bi ${downloadState === "done" ? "bi-check2" : "bi-download"}`} aria-hidden="true" />}
          </button>
          <div className="ais-menu-wrap" ref={moreMenu.wrapRef}>
            <button type="button" className={`ais-icon${moreOpen ? " is-open" : ""}`} aria-label="更多操作" aria-haspopup="menu" aria-expanded={moreOpen}
              onClick={(event) => { moreMenu.toggle(event); setZoomOpen(false); }}><i className="bi bi-three-dots" /></button>
            {moreMenu.mounted && (
              <div className={`ais-menu is-right${moreMenu.closing ? " is-closing" : ""}`} role="menu" aria-label="更多操作" onKeyDown={menuKeyDown}>
                {onCopyPrompt && meta.prompt && <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onCopyPrompt(item, meta); }}><i className="bi bi-clipboard" />复制提示词</button>}
                {onUseReference && <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onUseReference(item, meta); }}><i className="bi bi-image" />用作参考图</button>}
                {onFavorite && item.fileKey && <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onFavorite(item, meta); }}><i className="bi bi-bookmark-plus" />收藏到资产</button>}
                {onPublish && meta.runId && <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); onPublish(item, meta); }}><i className="bi bi-send" />发布作品</button>}
                {onDelete && meta.messageId && <><span className="ais-menu-sep" aria-hidden="true" /><button type="button" role="menuitem" className="is-danger" onClick={() => { setMoreOpen(false); onDelete(item, meta); }}><i className="bi bi-trash3" />删除图片</button></>}
              </div>
            )}
          </div>
        </div>
      </header>

      {tool === "markup" ? (
        <MarkupToolbar markup={markup} onExit={() => leave("exit")} />
      ) : tool === "erase" ? (
        <nav className="ais-toolbar ais-action-bar" role="toolbar" aria-label="擦除工具" data-click-guard="off">
          <button type="button" className="ais-action-icon" aria-label="撤销" title="撤销" disabled={!strokes.length || submitting} onClick={undoStroke}><i className="bi bi-arrow-counterclockwise" aria-hidden="true" /></button>
          <button type="button" className="ais-action-icon" aria-label="重做" title="重做" disabled={!redoStrokes.length || submitting} onClick={redoStroke}><i className="bi bi-arrow-clockwise" aria-hidden="true" /></button>
          <button type="button" className="ais-action-send" disabled={!canSubmit} onClick={() => void submit("erase")} data-click-guard-ms="800">
            {submitting ? <span className="ais-spinner" aria-hidden="true" /> : "发送"}
          </button>
          <button type="button" className="ais-action-icon" aria-label="退出擦除" title="退出擦除" onClick={() => leave("exit")}><i className="bi bi-x-lg" aria-hidden="true" /></button>
        </nav>
      ) : tool === "comment" ? (
        <nav className="ais-toolbar ais-action-bar" role="toolbar" aria-label="评论工具" data-click-guard="off">
          <span className="ais-action-hint">{pins.length ? `${filledPins.length} 条评论` : "点击图片添加评论"}</span>
          <button type="button" className="ais-action-send" disabled={!canSubmit} onClick={() => void submit("comment")}>
            {submitting ? <span className="ais-spinner" aria-hidden="true" /> : "发送"}
          </button>
          <button type="button" className="ais-action-icon" aria-label="退出评论" title="退出评论" onClick={() => leave("exit")}><i className="bi bi-x-lg" aria-hidden="true" /></button>
        </nav>
      ) : (
      <nav className="ais-toolbar" role="toolbar" aria-label="编辑工具">
        {TOOLS.map((entry) => {
          const unavailable = (entry.id === "removeBg" && !supportsTransparent) || (entry.id === "resize" && !resizeOptions.length);
          const unavailableReason = entry.id === "resize" ? "当前图片模型没有可选的比例" : "当前图片模型不支持透明背景";
          return (
            <button
              key={entry.id}
              type="button"
              className={tool === entry.id || (entry.id === "resize" && resizeMenu.open) ? "is-active" : ""}
              aria-pressed={entry.id === "resize" ? undefined : tool === entry.id}
              aria-haspopup={entry.id === "resize" ? "menu" : undefined}
              aria-expanded={entry.id === "resize" ? resizeMenu.open : undefined}
              ref={entry.id === "resize" ? resizeMenu.wrapRef : undefined}
              disabled={busy || submitting || unavailable}
              title={unavailable ? unavailableReason : entry.hint}
              onClick={(event) => (entry.id === "resize" ? toggleResize(event) : pickTool(entry.id))}
            >
              <StudioIcon name={entry.icon} size={19} />{entry.label}
            </button>
          );
        })}
      </nav>
      )}

      {resizeMenu.mounted && resizeAnchor && (
        <div ref={resizeMenu.popRef} className={`ais-menu is-resize${resizeMenu.closing ? " is-closing" : ""}`} role="menu" aria-label="调整尺寸"
          style={{ top: resizeAnchor.top, left: resizeAnchor.left }} onKeyDown={menuKeyDown}>
          <p className="ais-menu-title">按新的比例重新生成这张图</p>
          {resizeOptions.map((entry) => {
            const current = entry.ratio === currentRatio;
            return (
              <button key={entry.ratio} type="button" role="menuitem" disabled={current}
                onClick={() => { resizeMenu.close(); void submit("resize", { ratio: entry.ratio }); }}>
                <span className="ais-ratio-icon" aria-hidden="true"><i style={ratioIconSize(entry.ratio)} /></span>
                {entry.label}<span className="ais-menu-muted">{entry.ratio}</span>
                {current && <span className="ais-menu-tag">当前</span>}
              </button>
            );
          })}
        </div>
      )}

      {tool === "markup" ? (
        <div className="ais-versions ais-markup-side"><MarkupSizeSlider markup={markup} /></div>
      ) : tool === "erase" ? (
        <div className="ais-versions ais-markup-side"><SizeSlider value={eraseSize} label="画笔大小" onChange={setEraseSize} /></div>
      ) : tool === "comment" ? (
        <div className="ais-versions ais-markup-side" />
      ) : (
      <aside ref={railRef} className="ais-versions" aria-label="图片版本" data-click-guard="off">
        {gallery.map((entry, index) => (
          <button key={imageKey(entry) || index} type="button" className={imageKey(entry) === currentKey ? "is-current" : ""} aria-label={`查看第 ${index + 1} 张`} aria-current={imageKey(entry) === currentKey} onClick={() => select(entry, entry.studioMeta || null)}>
            <img src={imageThumb(entry)} alt="" decoding="async" />
          </button>
        ))}
        {versionEntries.map((version, index) => (
          <button
            key={version.id}
            type="button"
            className={`is-version${version.image && imageKey(version.image) === currentKey ? " is-current" : ""}${version.pending ? " is-pending" : ""}${version.failed ? " is-failed" : ""}`}
            aria-label={version.pending ? `修改 ${index + 1} 生成中` : version.failed ? `修改 ${index + 1} 失败` : `查看修改 ${index + 1}`}
            title={version.label}
            disabled={!version.image}
            onClick={() => version.image && select(version.image, versionMeta(version))}
          >
            {version.image ? <img src={imageThumb(version.image)} alt="" /> : version.failed ? <i className="bi bi-exclamation-circle" /> : <span className="ais-spinner" aria-hidden="true" />}
          </button>
        ))}
      </aside>
      )}

      <main
        ref={stageRef}
        className={`ais-stage${zoomScale ? " is-zoomed" : ""}${zoomScale && !tool ? " can-pan" : ""}${panning ? " is-panning" : ""}`}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onDoubleClick={(event) => {
          // 拖动画面时指针被图片区接管，双击事件落在这里；只在图片上双击才切换。
          const rect = frameRef.current?.getBoundingClientRect();
          if (rect && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) toggleZoom(event);
        }}
      >
        <div className="ais-pan">
        {!ready && <span className="ais-loading" aria-label="正在加载图片"><span className="ais-spinner" aria-hidden="true" /></span>}
        <div ref={frameRef} className={`ais-frame${ready ? "" : " is-loading"}${painting ? " is-painting" : ""}${tool === "comment" ? " is-commenting" : ""}`} style={frameStyle}>
          <img
            ref={imageRef}
            className="ais-image"
            src={display.src || currentSrc}
            alt={title}
            draggable={false}
          />
          {comparing && compareSource && ready && !tool ? (
            <div className="ais-compare" style={{ "--compare-position": `${comparePosition}%` }}
              onPointerDown={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
              <img className="ais-compare-before" src={imageSource(compareSource)} alt="原图" draggable={false} />
              <span className="ais-compare-line" aria-hidden="true"><i className="bi bi-arrow-left-right" /></span>
              <span className="ais-compare-tag is-before">原图</span>
              <span className="ais-compare-tag is-after">改后</span>
              <input type="range" min="0" max="100" step="0.5" value={comparePosition} aria-label="拖动对比原图和改后"
                onChange={(event) => setComparePosition(Number(event.target.value))} />
            </div>
          ) : null}
          <div className="ais-overlay" style={{ width: imageBox.width, height: imageBox.height }}>
          {tool === "markup" && ready && natural.width > 0 && (
            <MarkupLayer markup={markup} width={natural.width} height={natural.height} scale={imageBox.width / natural.width} />
          )}
          {tool !== "markup" && ready && maskSize.width > 0 && (
            <canvas
              ref={canvasRef}
              className={`ais-mask is-${tool || "idle"}`}
              width={maskSize.width}
              height={maskSize.height}
              aria-label={painting ? (tool === "erase" ? "涂抹要擦除的区域" : "涂抹要修改的区域") : undefined}
              onPointerDown={startStroke}
              onPointerMove={moveStroke}
              onPointerUp={endStroke}
              onPointerCancel={endStroke}
              onPointerLeave={() => setEraseCursor(null)}
              onClick={addPin}
            />
          )}
          {tool === "erase" && ready && maskSize.width > 0 && (
            <EraseView strokes={strokes} tick={strokeTick} width={maskSize.width} height={maskSize.height} />
          )}
          {tool === "erase" && eraseCursor && (
            <span className="ais-markup-cursor is-eraser"
              style={{ left: eraseCursor.x, top: eraseCursor.y, width: brush * Math.max(imageBox.width, imageBox.height) / 1000, height: brush * Math.max(imageBox.width, imageBox.height) / 1000 }}
              aria-hidden="true" />
          )}
          {tool === "comment" && pins.map((pin, index) => {
            const open = activePin === pin.id;
            const removePin = () => { setPins((current) => current.filter((entry) => entry.id !== pin.id)); setActivePin(""); };
            return (
              <div key={pin.id} className={`ais-pin${open ? " is-open" : ""}${pin.x > 0.62 ? " is-left" : ""}`} style={{ left: `${pin.x * 100}%`, top: `${pin.y * 100}%` }}>
                <button type="button" className="ais-pin-dot" aria-label={`评论 ${index + 1}`} title={pin.text || undefined} onClick={() => setActivePin(open ? "" : pin.id)}>{index + 1}</button>
                {open && (
                  <form className="ais-pin-card" onSubmit={(event) => { event.preventDefault(); if (pin.text.trim()) setActivePin(""); }}>
                    <input
                      autoFocus
                      value={pin.text}
                      placeholder="描述修改"
                      aria-label={`评论 ${index + 1} 的内容`}
                      onChange={(event) => setPins((current) => current.map((entry) => (entry.id === pin.id ? { ...entry, text: event.target.value } : entry)))}
                      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (pin.text.trim()) setActivePin(""); else removePin(); } }}
                    />
                    <button type="submit" className="ais-pin-ok" aria-label="确认这条评论" disabled={!pin.text.trim()}><i className="bi bi-check-lg" aria-hidden="true" /></button>
                    <span className="ais-pin-sep" aria-hidden="true" />
                    <button type="button" className="ais-pin-remove" aria-label="删除这条评论" onClick={removePin}><i className="bi bi-x-lg" aria-hidden="true" /></button>
                  </form>
                )}
              </div>
            );
          })}
          </div>
        </div>
        </div>
      </main>

      {confirmLeave && (
        <div className="ais-confirm-layer" onPointerDown={(event) => { if (event.target === event.currentTarget) setConfirmLeave(null); }}>
          <div className="ais-confirm" role="alertdialog" aria-modal="true" aria-labelledby="ais-confirm-title">
            <h3 id="ais-confirm-title">{confirmLeave.action === "close" ? "关闭编辑器？" : `退出${activeTool?.label || "编辑"}？`}</h3>
            <p>{confirmLeave.what}还没有提交，{confirmLeave.action === "close" ? "关闭" : "退出"}后会被丢掉。</p>
            <div className="ais-confirm-actions">
              <button type="button" className="ais-confirm-cancel" autoFocus onClick={() => setConfirmLeave(null)}>继续{activeTool?.label || "编辑"}</button>
              <button type="button" className="ais-confirm-ok" onClick={() => leaveNow(confirmLeave.action)}>丢弃</button>
            </div>
          </div>
        </div>
      )}

      <footer className="ais-bottom">
        {(error || busyText) && (
          <div className="ais-context">
            {busyText && <span className="ais-note">{busyText}</span>}
            {error && <span className="ais-error" role="alert">{error}</span>}
          </div>
        )}
        {/* 擦除和评论在顶部发送，底部输入框只隐藏不移除，图片区高度不变、图片不跳 */}
        <form className={`ais-composer${tool === "erase" || tool === "comment" ? " is-hidden" : ""}`} aria-hidden={tool === "erase" || tool === "comment" ? true : undefined} onSubmit={(event) => { event.preventDefault(); if (canSubmit) void submit(); }}>
          <textarea
            rows={1}
            value={prompt}
            placeholder={placeholder}
            aria-label="描述修改"
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSubmit) void submit();
              }
            }}
          />
          <button type="submit" className="ais-send" aria-label="生成修改" disabled={!canSubmit}>
            {submitting ? <span className="ais-spinner" aria-hidden="true" /> : <i className="bi bi-arrow-up" />}
          </button>
        </form>
      </footer>
    </div>,
    document.body,
  );
}
