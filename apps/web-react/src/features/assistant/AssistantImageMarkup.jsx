// 图片编辑器的“标注”模式：顶部换成标注工具条（选择 / 画笔 / 文字 / 图形 / 颜色 / 橡皮擦 /
// 撤销 / 重做 / 退出），左侧是粗细滑杆，图片上叠一层 SVG。画好的标注连同原图作为参考图提交。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MARKUP_COLORS,
  MARKUP_FONT,
  MARKUP_SHAPES,
  defaultTextWidth,
  eraserWidthFor,
  fitItem,
  fontSizeFor,
  hasMarks,
  isLineShape,
  itemBounds,
  itemPath,
  moveItem,
  penPath,
  resizeBounds,
  strokeWidthFor,
  textBaseline,
  textHeight,
  textLines,
} from "./domain/imageMarkup.js";
import { menuKeyDown, useOutsideClose, usePresence } from "./useStudioMenu.js";

const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSORS = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };
const HISTORY_LIMIT = 100;
let markupId = 0;
// 用户调过的粗细（线条 / 文字 / 橡皮擦分开）、颜色和图形记在本机，下次打开直接沿用。
const PREFS_KEY = "starclouds-assistant-markup-prefs";
const DEFAULT_PREFS = { sizes: { stroke: 30, text: 30, eraser: 30 }, color: "#dc2626", shape: "rect" };

function readPrefs() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) || "null");
    if (!saved || typeof saved !== "object") return DEFAULT_PREFS;
    const sizes = { ...DEFAULT_PREFS.sizes };
    for (const key of Object.keys(sizes)) {
      const value = Number(saved.sizes?.[key]);
      if (Number.isFinite(value)) sizes[key] = Math.min(100, Math.max(0, value));
    }
    return {
      sizes,
      color: /^#[0-9a-f]{6}$/i.test(saved.color || "") ? saved.color : DEFAULT_PREFS.color,
      shape: MARKUP_SHAPES.some((entry) => entry.id === saved.shape) ? saved.shape : DEFAULT_PREFS.shape,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function sizeKind(tool, selected) {
  const type = selected?.type || "";
  if (type === "text" || (!type && tool === "text")) return "text";
  if (!type && tool === "eraser") return "eraser";
  return "stroke";
}
const nextId = () => `mk-${Date.now().toString(36)}-${(markupId += 1)}`;

export function useImageMarkup({ width, height }) {
  const [history, setHistory] = useState({ past: [], items: [], future: [] });
  const [tool, setTool] = useState("pen");
  const [prefs, setPrefs] = useState(readPrefs);
  const { shape, color, sizes } = prefs;
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // 存不了（隐私模式等）就只在这次打开里有效。
    }
  }, [prefs]);
  const setShape = useCallback((next) => setPrefs((current) => ({ ...current, shape: next })), []);
  const setColor = useCallback((next) => setPrefs((current) => ({ ...current, color: next })), []);
  const [selectedId, setSelectedId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [menu, setMenu] = useState("");
  const snapshotRef = useRef(null);
  const historyRef = useRef(history);
  historyRef.current = history;
  const base = Math.max(1, Math.min(width || 0, height || 0));
  const items = history.items;

  // 一次连续操作（画一笔、拖动、拖滑杆、改文字）只记一步撤销：开始时记下快照，结束时入栈。
  const begin = useCallback(() => {
    if (!snapshotRef.current) snapshotRef.current = historyRef.current.items;
  }, []);
  const live = useCallback((update) => {
    setHistory((current) => ({ ...current, items: update(current.items) }));
  }, []);
  const end = useCallback(() => {
    const snapshot = snapshotRef.current;
    snapshotRef.current = null;
    if (!snapshot) return;
    setHistory((current) => (current.items === snapshot ? current : {
      past: [...current.past, snapshot].slice(-HISTORY_LIMIT),
      items: current.items,
      future: [],
    }));
  }, []);
  const commit = useCallback((update) => {
    snapshotRef.current = null;
    setHistory((current) => {
      const next = update(current.items);
      return next === current.items ? current : { past: [...current.past, current.items].slice(-HISTORY_LIMIT), items: next, future: [] };
    });
  }, []);
  const undo = useCallback(() => {
    setEditingId("");
    setHistory((current) => (current.past.length ? {
      past: current.past.slice(0, -1),
      items: current.past[current.past.length - 1],
      future: [current.items, ...current.future],
    } : current));
  }, []);
  const redo = useCallback(() => {
    setEditingId("");
    setHistory((current) => (current.future.length ? {
      past: [...current.past, current.items],
      items: current.future[0],
      future: current.future.slice(1),
    } : current));
  }, []);
  const reset = useCallback(() => {
    snapshotRef.current = null;
    setHistory({ past: [], items: [], future: [] });
    setSelectedId("");
    setEditingId("");
    setMenu("");
    setTool("pen");
  }, []);

  const selected = items.find((item) => item.id === selectedId) || null;
  // 滑杆显示当前这类东西的粗细：选中了就按选中的，没选中按当前工具。
  const kind = sizeKind(tool, selected);
  const size = sizes[kind];

  const pickTool = useCallback((next) => {
    setTool(next);
    setMenu("");
    setEditingId("");
    if (next !== "select") setSelectedId("");
  }, []);

  // 颜色和粗细：同时改当前选中的那一个。
  const pickColor = useCallback((next) => {
    setColor(next);
    setMenu("");
    if (selectedId) commit((list) => list.map((item) => (item.id === selectedId && item.type !== "erase" ? { ...item, color: next } : item)));
  }, [commit, selectedId, setColor]);
  const sized = useCallback((item, value) => {
    if (item.type === "text") {
      const fontSize = fontSizeFor(value, base);
      return { ...item, size: fontSize, h: textHeight(item.text, fontSize, item.w) };
    }
    if (item.type === "pen" || item.type === "shape") return { ...item, width: strokeWidthFor(value, base) };
    return item;
  }, [base]);
  const changeSize = useCallback((value) => {
    setPrefs((current) => ({ ...current, sizes: { ...current.sizes, [kind]: value } }));
    if (selectedId) live((list) => list.map((item) => (item.id === selectedId ? sized(item, value) : item)));
  }, [kind, live, selectedId, sized]);

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit((list) => list.filter((item) => item.id !== selectedId));
    setSelectedId("");
    setEditingId("");
  }, [commit, selectedId]);

  return {
    items, base, tool, shape, color, size, sizes, selected, selectedId, editingId, menu,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    hasMarks: hasMarks(items),
    setShape, setMenu, setSelectedId, setEditingId, setTool,
    pickTool, pickColor, changeSize, removeSelected, sized,
    begin, live, end, commit, undo, redo, reset,
  };
}

// 标注工具条的图标：同一套线条图标，24 网格、1.8 线宽、圆角端点，大小一致。
const ICONS = {
  select: "M5.5 3.8 19 10.4l-6 1.9-2.6 6L5.5 3.8Z",
  pen: "M4.5 19.5 5.6 15 15.7 4.9a2.1 2.1 0 0 1 3 3L8.6 18l-4.1 1.5ZM13.8 6.8l3 3",
  text: "M5.5 6.5V5h13v1.5M12 5v14M9 19h6",
  shape: "M9.5 15A5.5 5.5 0 1 1 15 9.5M11 11h8a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-8Z",
  eraser: "M8.6 19.5h10.9M4.9 14.4l8.6-8.6a2 2 0 0 1 2.8 0l2.4 2.4a2 2 0 0 1 0 2.8l-7.3 7.3a4 4 0 0 1-2.8 1.2H8.4l-3.5-3.5a1.1 1.1 0 0 1 0-1.6ZM9.2 10.1l5.2 5.2",
  undo: "M8.5 13.5 4 9l4.5-4.5M4.5 9h9.25a5.75 5.75 0 0 1 0 11.5H10",
  redo: "M15.5 13.5 20 9l-4.5-4.5M19.5 9h-9.25a5.75 5.75 0 0 0 0 11.5H14",
  close: "M6.5 6.5l11 11M17.5 6.5l-11 11",
  // 编辑工具条
  markup: "M4.5 19.5 5.6 15 15.7 4.9a2.1 2.1 0 0 1 3 3L8.6 18l-4.1 1.5ZM13.8 6.8l3 3M13 19.5c1.6 0 2.2-1.2 3.4-1.2 1 0 1.4.8 2.6.8",
  comment: "M12 19.5c4.4 0 8-3.2 8-7.25S16.4 5 12 5s-8 3.2-8 7.25c0 1.5.5 2.9 1.4 4.1L4.8 19.6l3.5-.9c1.1.5 2.4.8 3.7.8ZM12 9.5v5.5M9.25 12.25h5.5",
  removeBg: "M4.5 8.5v-2a2 2 0 0 1 2-2h2M15.5 4.5h2a2 2 0 0 1 2 2v2M19.5 15.5v2a2 2 0 0 1-2 2h-2M8.5 19.5h-2a2 2 0 0 1-2-2v-2M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM7.8 16.8c.8-1.7 2.4-2.6 4.2-2.6s3.4.9 4.2 2.6",
  resize: "M4.5 10.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2v-7ZM14 4.5h5.5V10M19.5 4.5 15 9",
};

// 图片编辑器统一用这一套线条图标。
export function StudioIcon({ name, size = 22 }) {
  return (
    <svg className="ais-markup-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShapeIcon({ shape }) {
  const box = { x: 3, y: 3, w: 14, h: 14 };
  const item = isLineShape(shape)
    ? { type: "shape", shape, x1: 4, y1: 16, x2: 16, y2: 4, width: 1.6 }
    : { type: "shape", shape, ...box };
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <path d={itemPath(item)} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MarkupToolbar({ markup, onExit }) {
  const { tool, menu, color } = markup;
  const navRef = useRef(null);
  const shapes = usePresence(menu === "shape");
  const colors = usePresence(menu === "color");
  const setMenu = markup.setMenu;
  const closeMenu = useCallback(() => setMenu(""), [setMenu]);
  useOutsideClose(Boolean(menu), navRef, closeMenu);
  const toolButton = (id, label, icon) => (
    <button type="button" className={tool === id ? "is-active" : ""} aria-pressed={tool === id} aria-label={label} title={label} onClick={() => markup.pickTool(id)}>
      <StudioIcon name={icon} />
    </button>
  );
  return (
    // 撤销 / 重做、换工具和颜色都会连续点，不受全站防重复点击限制。
    <nav ref={navRef} data-click-guard="off" className="ais-toolbar ais-markup-bar" role="toolbar" aria-label="标注工具" onPointerDown={(event) => event.stopPropagation()}>
      {toolButton("select", "选择", "select")}
      {toolButton("pen", "画笔", "pen")}
      {toolButton("text", "文字", "text")}
      <span className="ais-markup-menu-wrap">
        {/* 点一下就进入画图形（沿用上次的图形），同时展开图形列表可以换 */}
        <button type="button" className={tool === "shape" ? "is-active" : ""} aria-pressed={tool === "shape"} aria-label="图形" title="图形" aria-haspopup="menu" aria-expanded={menu === "shape"}
          onClick={() => {
            const open = menu === "shape";
            markup.pickTool("shape");
            markup.setMenu(open ? "" : "shape");
          }}>
          <StudioIcon name="shape" />
        </button>
        {shapes.mounted && (
          <span className={`ais-markup-pop is-shapes${shapes.closing ? " is-closing" : ""}`} role="menu" aria-label="选择图形" onKeyDown={menuKeyDown}>
            {MARKUP_SHAPES.map((entry) => (
              <button key={entry.id} type="button" role="menuitemradio" aria-checked={tool === "shape" && markup.shape === entry.id} aria-label={entry.label} title={entry.label}
                className={tool === "shape" && markup.shape === entry.id ? "is-active" : ""}
                onClick={() => { markup.setShape(entry.id); markup.pickTool("shape"); }}>
                <ShapeIcon shape={entry.id} />
              </button>
            ))}
          </span>
        )}
      </span>
      <span className="ais-markup-menu-wrap">
        <button type="button" className={menu === "color" ? "is-active" : ""} aria-label="颜色" title="颜色" aria-haspopup="menu" aria-expanded={menu === "color"}
          onClick={() => markup.setMenu(menu === "color" ? "" : "color")}>
          <span className="ais-markup-swatch" style={{ background: color }} aria-hidden="true" />
        </button>
        {colors.mounted && (
          <span className={`ais-markup-pop is-colors${colors.closing ? " is-closing" : ""}`} role="menu" aria-label="选择颜色" onKeyDown={menuKeyDown}>
            <label className="ais-markup-color is-custom" title="自定义颜色">
              <input type="color" value={color} aria-label="自定义颜色" onChange={(event) => markup.pickColor(event.target.value)} />
            </label>
            {MARKUP_COLORS.map((entry) => (
              <button key={entry} type="button" role="menuitemradio" aria-checked={color === entry} aria-label={`颜色 ${entry}`}
                className={`ais-markup-color${color === entry ? " is-active" : ""}`} style={{ background: entry }} onClick={() => markup.pickColor(entry)} />
            ))}
          </span>
        )}
      </span>
      {toolButton("eraser", "橡皮擦", "eraser")}
      <span className="ais-markup-sep" aria-hidden="true" />
      <button type="button" aria-label="撤销" title="撤销 (⌘Z)" disabled={!markup.canUndo} onClick={markup.undo}><StudioIcon name="undo" /></button>
      <button type="button" aria-label="重做" title="重做 (⇧⌘Z)" disabled={!markup.canRedo} onClick={markup.redo}><StudioIcon name="redo" /></button>
      <span className="ais-markup-sep" aria-hidden="true" />
      <button type="button" aria-label="退出标注" title="退出标注" onClick={onExit}><StudioIcon name="close" /></button>
    </nav>
  );
}

// 左侧竖向滑杆（手机上横过来）：0-100。标注和擦除都用它。
export function SizeSlider({ value, label, onChange, onBegin, onEnd }) {
  const trackRef = useRef(null);
  const draggingRef = useRef(false);
  const setFromPointer = (event) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 竖着放时从下往上变大；手机上横着放时从左往右。
    const ratio = rect.width > rect.height ? (event.clientX - rect.left) / rect.width : 1 - (event.clientY - rect.top) / rect.height;
    onChange(Math.round(Math.min(100, Math.max(0, ratio * 100))));
  };
  return (
    <div className="ais-markup-size">
      <div
        ref={trackRef}
        className="ais-markup-track"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        title={label}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          draggingRef.current = true;
          onBegin?.();
          setFromPointer(event);
        }}
        onPointerMove={(event) => { if (draggingRef.current) setFromPointer(event); }}
        onPointerUp={() => { draggingRef.current = false; onEnd?.(); }}
        onPointerCancel={() => { draggingRef.current = false; onEnd?.(); }}
        onKeyDown={(event) => {
          const step = event.key === "ArrowUp" || event.key === "ArrowRight" ? 5 : event.key === "ArrowDown" || event.key === "ArrowLeft" ? -5 : 0;
          if (!step) return;
          event.preventDefault();
          event.stopPropagation();
          onBegin?.();
          onChange(Math.min(100, Math.max(0, value + step)));
          onEnd?.();
        }}
      >
        <span className="ais-markup-line" aria-hidden="true" />
        <span className="ais-markup-knob" style={{ "--size": value }} aria-hidden="true" />
      </div>
    </div>
  );
}

// 标注的滑杆：控制画笔、图形线宽、文字大小和橡皮擦大小，选中的条目跟着变。
export function MarkupSizeSlider({ markup }) {
  const label = markup.tool === "text" || markup.selected?.type === "text" ? "文字大小" : markup.tool === "eraser" ? "橡皮擦大小" : "线条粗细";
  return <SizeSlider value={markup.size} label={label} onChange={markup.changeSize} onBegin={markup.begin} onEnd={markup.end} />;
}

function renderInk(item, editingId) {
  if (item.type === "text") {
    if (item.id === editingId) return null;
    return (
      <text key={item.id} fill={item.color} fontSize={item.size} fontWeight="600" fontFamily={MARKUP_FONT}>
        {textLines(item).map((line, index) => <tspan key={index} x={item.x} y={textBaseline(item, index)}>{line || " "}</tspan>)}
      </text>
    );
  }
  return <path key={item.id} data-ink={item.id} d={itemPath(item)} fill="none" stroke={item.color} strokeWidth={item.width} strokeLinecap="round" strokeLinejoin="round" />;
}

// 橡皮擦只擦它之前画的东西：每一笔擦除把前面的内容包进一层蒙版。
function useInkLayers(items, editingId, width, height) {
  return useMemo(() => {
    const masks = [];
    let content = [];
    for (const item of items) {
      if (item.type !== "erase") {
        content.push(renderInk(item, editingId));
        continue;
      }
      const id = `ais-erase-${item.id}`;
      masks.push(
        <mask key={id} id={id} maskUnits="userSpaceOnUse" x="0" y="0" width={width} height={height}>
          <rect x="0" y="0" width={width} height={height} fill="#fff" />
          <path data-erase={item.id} d={penPath(item.points)} fill="none" stroke="#000" strokeWidth={item.width} strokeLinecap="round" strokeLinejoin="round" />
        </mask>,
      );
      content = [<g key={id} mask={`url(#${id})`}>{content}</g>];
    }
    return { masks, content };
  }, [editingId, height, items, width]);
}

export function MarkupLayer({ markup, width, height, scale }) {
  const svgRef = useRef(null);
  const gestureRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const [cursor, setCursor] = useState(null);
  const { items, tool, color, sizes, base, selected, editingId } = markup;
  const { masks, content } = useInkLayers(items, editingId, width, height);
  const unit = 1 / (scale || 1);
  const editing = items.find((item) => item.id === editingId) || null;

  const toImage = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    return [
      Math.min(width, Math.max(0, ((event.clientX - rect.left) / rect.width) * width)),
      Math.min(height, Math.max(0, ((event.clientY - rect.top) / rect.height) * height)),
    ];
  };

  // 点别处和输入框失焦都会结束编辑，只处理一次。
  const finishedRef = useRef("");
  const finishText = useCallback(() => {
    const id = markup.editingId;
    if (!id || finishedRef.current === id) return;
    finishedRef.current = id;
    markup.live((list) => list.filter((item) => item.id !== id || item.text.trim()));
    markup.end();
    markup.setEditingId("");
  }, [markup]);

  useEffect(() => { if (editingId) finishedRef.current = ""; }, [editingId]);

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    markup.setMenu("");
    const point = toImage(event);
    const target = event.target;
    if (editingId && !target.closest?.("textarea")) finishText();
    if (tool === "select") {
      const handle = target.closest?.("[data-handle]")?.getAttribute("data-handle");
      const hitId = target.closest?.("[data-hit]")?.getAttribute("data-hit");
      if (handle && selected) {
        markup.begin();
        gestureRef.current = { kind: "resize", handle, start: point, item: selected, bounds: itemBounds(selected) };
      } else if (hitId) {
        const item = items.find((entry) => entry.id === hitId);
        markup.setSelectedId(hitId);
        markup.begin();
        gestureRef.current = { kind: "move", start: point, item };
      } else {
        markup.setSelectedId("");
        return;
      }
    } else if (tool === "pen" || tool === "eraser") {
      const item = tool === "pen"
        ? { id: nextId(), type: "pen", color, width: strokeWidthFor(sizes.stroke, base), points: [point] }
        : { id: nextId(), type: "erase", width: eraserWidthFor(sizes.eraser, base), points: [point] };
      markup.begin();
      markup.live((list) => [...list, item]);
      gestureRef.current = { kind: "draw", item };
    } else if (tool === "shape") {
      gestureRef.current = { kind: "shape", start: point, end: point };
      setDraft({ start: point, end: point });
    } else if (tool === "text") {
      const hitText = target.closest?.("[data-hit]")?.getAttribute("data-hit");
      const existing = hitText && items.find((entry) => entry.id === hitText && entry.type === "text");
      event.preventDefault();
      markup.begin();
      if (existing) {
        markup.setSelectedId(existing.id);
        markup.setEditingId(existing.id);
      } else {
        const fontSize = fontSizeFor(sizes.text, base);
        const x = Math.max(0, Math.min(point[0], width - fontSize * 3));
        const w = defaultTextWidth(x, fontSize, width);
        const item = { id: nextId(), type: "text", color, size: fontSize, text: "", x, y: Math.max(0, point[1] - fontSize * 0.6), w, h: textHeight("", fontSize, w) };
        markup.live((list) => [...list, item]);
        markup.setSelectedId(item.id);
        markup.setEditingId(item.id);
      }
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event) => {
    if (tool === "pen" || tool === "eraser") {
      const rect = svgRef.current.getBoundingClientRect();
      setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    const point = toImage(event);
    if (gesture.kind === "draw") {
      // 画的过程中直接改路径，不让整层重新渲染。
      gesture.item.points.push(point);
      const selector = gesture.item.type === "erase" ? `[data-erase="${gesture.item.id}"]` : `[data-ink="${gesture.item.id}"]`;
      svgRef.current.querySelector(selector)?.setAttribute("d", penPath(gesture.item.points));
    } else if (gesture.kind === "move") {
      const dx = point[0] - gesture.start[0];
      const dy = point[1] - gesture.start[1];
      markup.live((list) => list.map((item) => (item.id === gesture.item.id ? moveItem(gesture.item, dx, dy) : item)));
    } else if (gesture.kind === "resize") {
      const { item, handle, bounds } = gesture;
      const dx = point[0] - gesture.start[0];
      const dy = point[1] - gesture.start[1];
      let next;
      if (item.type === "shape" && isLineShape(item.shape)) {
        next = handle === "a" ? { ...item, x1: item.x1 + dx, y1: item.y1 + dy } : { ...item, x2: item.x2 + dx, y2: item.y2 + dy };
      } else if (item.type === "text" && (handle === "e" || handle === "w")) {
        // 左右拉只改文字框宽度，文字重新换行，字号不变。
        const box = resizeBounds(bounds, handle, dx, 0, false, item.size * 2);
        next = { ...item, x: box.x, w: box.w, h: textHeight(item.text, item.size, box.w) };
      } else {
        next = fitItem(item, bounds, resizeBounds(bounds, handle, dx, dy, item.type === "text", 4 * unit));
      }
      markup.live((list) => list.map((entry) => (entry.id === item.id ? next : entry)));
    } else if (gesture.kind === "shape") {
      gesture.end = point;
      setDraft({ start: gesture.start, end: point });
    }
  };

  const onPointerUp = () => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture) return;
    if (gesture.kind === "draw") {
      const item = { ...gesture.item, points: [...gesture.item.points] };
      markup.live((list) => list.map((entry) => (entry.id === item.id ? item : entry)));
      markup.end();
    } else if (gesture.kind === "move" || gesture.kind === "resize") {
      markup.end();
    } else if (gesture.kind === "shape") {
      setDraft(null);
      const item = shapeFromDrag(markup.shape, gesture.start, gesture.end, { color, width: strokeWidthFor(sizes.stroke, base), unit });
      if (!item) return;
      markup.commit((list) => [...list, item]);
      // 画完一个图形就选中它，可以直接拖动和缩放。
      markup.setTool("select");
      markup.setSelectedId(item.id);
    }
  };

  // 文字输入框跟着内容变宽变高。
  const changeText = (value) => {
    markup.live((list) => list.map((item) => (item.id === editingId ? { ...item, text: value, h: textHeight(value, item.size, item.w) } : item)));
  };

  const draftItem = draft ? shapeFromDrag(markup.shape, draft.start, draft.end, { color, width: strokeWidthFor(sizes.stroke, base), unit, preview: true }) : null;
  const showCursor = cursor && (tool === "pen" || tool === "eraser");
  const cursorSize = (tool === "eraser" ? eraserWidthFor(sizes.eraser, base) : strokeWidthFor(sizes.stroke, base)) * (scale || 1);
  const framed = editing || (tool === "select" ? selected : null);

  return (
    <div className="ais-markup" style={{ width: width * (scale || 1), height: height * (scale || 1) }}>
      <svg
        ref={svgRef}
        className={`ais-markup-svg is-${tool}`}
        viewBox={`0 0 ${width} ${height}`}
        role="application"
        aria-label="标注画布"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setCursor(null)}
        onDoubleClick={(event) => {
          const hitId = event.target.closest?.("[data-hit]")?.getAttribute("data-hit");
          const item = hitId && items.find((entry) => entry.id === hitId);
          if (item?.type === "text") {
            markup.begin();
            markup.setSelectedId(item.id);
            markup.setEditingId(item.id);
          }
        }}
      >
        <defs>{masks}</defs>
        {content}
        {draftItem && <path d={itemPath(draftItem)} fill="none" stroke={draftItem.color} strokeWidth={draftItem.width} strokeLinecap="round" strokeLinejoin="round" />}
        {(tool === "select" || tool === "text") && items.map((item) => <HitTarget key={item.id} item={item} unit={unit} />)}
        {framed && <SelectionFrame item={framed} unit={unit} interactive={tool === "select" && !editing} />}
      </svg>
      {editing && (
        <textarea
          className="ais-markup-text"
          autoFocus
          value={editing.text}
          aria-label="标注文字"
          placeholder="输入文字"
          spellCheck={false}
          style={{
            left: editing.x * scale,
            top: editing.y * scale,
            width: editing.w * scale + 2,
            height: editing.h * scale + 2,
            color: editing.color,
            fontSize: editing.size * scale,
            fontFamily: MARKUP_FONT,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onChange={(event) => changeText(event.target.value)}
          onBlur={finishText}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape" || (event.key === "Enter" && (event.metaKey || event.ctrlKey))) {
              event.preventDefault();
              finishText();
            }
          }}
        />
      )}
      {showCursor && (
        <span className={`ais-markup-cursor${tool === "eraser" ? " is-eraser" : ""}`}
          style={{ left: cursor.x, top: cursor.y, width: Math.max(6, cursorSize), height: Math.max(6, cursorSize), borderColor: tool === "pen" ? color : undefined }}
          aria-hidden="true" />
      )}
    </div>
  );
}

function shapeFromDrag(shape, start, end, { color, width, unit, preview = false }) {
  const id = preview ? "draft" : nextId();
  const [x1, y1] = start;
  const [x2, y2] = end;
  // 只点了一下、没拖开：不画，图形只在拖动时跟着鼠标出现。
  if (Math.hypot(x2 - x1, y2 - y1) < 6 * unit) return null;
  if (isLineShape(shape)) return { id, type: "shape", shape, color, width, x1, y1, x2, y2 };
  return { id, type: "shape", shape, color, width, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

// 选择和文字工具下的点击区域：线条按描边命中（至少 14px 宽），封闭图形和文字整块都能点中。
function HitTarget({ item, unit }) {
  if (item.type === "erase") return null;
  if (item.type === "text") {
    return <rect data-hit={item.id} x={item.x} y={item.y} width={item.w} height={item.h} fill="transparent" className="ais-markup-hit" />;
  }
  const closed = item.type === "shape" && !isLineShape(item.shape);
  return (
    <path data-hit={item.id} d={itemPath(item)} className="ais-markup-hit" fill={closed ? "transparent" : "none"} stroke="transparent"
      strokeWidth={Math.max(item.width, 14 * unit)} strokeLinecap="round" strokeLinejoin="round" pointerEvents={closed ? "all" : "stroke"} />
  );
}

function SelectionFrame({ item, unit, interactive }) {
  const handleSize = 9 * unit;
  const pad = (item.width ? item.width / 2 : 0) + 5 * unit;
  if (item.type === "shape" && isLineShape(item.shape)) {
    const ends = [["a", item.x1, item.y1], ["b", item.x2, item.y2]];
    return (
      <g className="ais-markup-frame">
        {interactive && ends.map(([id, x, y]) => (
          <rect key={id} data-handle={id} x={x - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize}
            strokeWidth={1.5 * unit} style={{ cursor: "move" }} />
        ))}
      </g>
    );
  }
  const bounds = itemBounds(item);
  const box = { x: bounds.x - pad, y: bounds.y - pad, w: bounds.w + pad * 2, h: bounds.h + pad * 2 };
  const point = (handle) => [
    handle.includes("w") ? box.x : handle.includes("e") ? box.x + box.w : box.x + box.w / 2,
    handle.includes("n") ? box.y : handle.includes("s") ? box.y + box.h : box.y + box.h / 2,
  ];
  return (
    <g className="ais-markup-frame">
      <rect className="is-outline" x={box.x} y={box.y} width={box.w} height={box.h} strokeWidth={1.5 * unit} strokeDasharray={`${6 * unit} ${4 * unit}`} />
      {HANDLES.map((handle) => {
        const [x, y] = point(handle);
        return (
          <rect key={handle} data-handle={interactive ? handle : undefined} x={x - handleSize / 2} y={y - handleSize / 2} width={handleSize} height={handleSize}
            strokeWidth={1.5 * unit} style={{ cursor: interactive ? HANDLE_CURSORS[handle] : "default" }} />
        );
      })}
    </g>
  );
}

// 标注模式的快捷键：删除选中、撤销 / 重做。Esc 由编辑器统一处理（先取消选中，再退出标注）。
export function useMarkupShortcuts(markup, active) {
  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event) => {
      if (event.target?.closest?.("textarea, input")) return;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) markup.redo();
        else markup.undo();
      } else if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        markup.redo();
      } else if ((event.key === "Delete" || event.key === "Backspace") && markup.selectedId) {
        event.preventDefault();
        markup.removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, markup]);
}
