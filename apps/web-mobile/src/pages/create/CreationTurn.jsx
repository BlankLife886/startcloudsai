import { memo, useEffect, useRef, useState } from "react";
import { DotLoading } from "antd-mobile";
import { CloseCircleOutline, ExclamationCircleOutline, PictureOutline } from "antd-mobile-icons";
import { taskFailureMessage } from "@react/features/history/taskFailureMessage.js";
import { aspectNumber, cellSeconds, groupSeconds, groupSpec } from "./workGroups.js";

const LONG_PRESS_MS = 480;
// 与 App 一致：多张结果横向排开，每张高 220；单张占满宽度，最高 520。
const STRIP_HEIGHT = 220;
const SINGLE_MAX_HEIGHT = 520;
const FRAME_MAX_HEIGHT = 360;

// 长按弹出操作菜单；手指移动即视为滚动，取消长按。
function useLongPress(onLongPress) {
  const timer = useRef(0);
  const fired = useRef(false);
  const origin = useRef(null);
  const clear = () => window.clearTimeout(timer.current);
  return {
    fired,
    handlers: {
      onTouchStart(event) {
        fired.current = false;
        origin.current = { x: event.touches[0].clientX, y: event.touches[0].clientY };
        clear();
        timer.current = window.setTimeout(() => {
          fired.current = true;
          navigator.vibrate?.(15);
          onLongPress();
        }, LONG_PRESS_MS);
      },
      onTouchMove(event) {
        const start = origin.current;
        if (!start) return;
        const moved = Math.abs(event.touches[0].clientX - start.x) + Math.abs(event.touches[0].clientY - start.y);
        if (moved > 10) clear();
      },
      onTouchEnd: clear,
      onTouchCancel: clear,
      onContextMenu(event) {
        event.preventDefault();
      },
    },
  };
}

// 单张大图：先用缩略图（约 10KB），真正滑进屏幕后再在后台换成清晰图；滑过没停留的不下载大图。
function useSharpSource(cell, single, nodeRef) {
  const [sharp, setSharp] = useState(false);
  useEffect(() => {
    const node = nodeRef.current;
    if (!single || sharp || !node || cell.previewUrl === cell.thumbUrl) return undefined;
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      window.clearTimeout(timer);
      if (!entry.isIntersecting) return;
      timer = window.setTimeout(() => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => setSharp(true);
        image.src = cell.previewUrl;
        observer.disconnect();
      }, 250);
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [cell.previewUrl, cell.thumbUrl, nodeRef, sharp, single]);
  return sharp ? cell.previewUrl : cell.thumbUrl;
}

// 单张：宽度占满、按比例算高度，超过上限时按上限缩窄；多张：固定高度、按比例算宽度。
function frameStyle(aspect, single, maxHeight) {
  if (!single) return { width: STRIP_HEIGHT * aspect, height: STRIP_HEIGHT };
  return { width: `min(100%, ${maxHeight * aspect}px)`, aspectRatio: aspect };
}

function ImageSlot({ cell, single, now, onOpen, onLongPress }) {
  const [loaded, setLoaded] = useState(false);
  const buttonRef = useRef(null);
  const src = useSharpSource(cell, single, buttonRef);
  const press = useLongPress(() => onLongPress(cell));
  const seconds = cellSeconds(cell.task, now);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`m-slot is-image${loaded ? " is-loaded" : ""}`}
      style={frameStyle(aspectNumber(cell.task), single, SINGLE_MAX_HEIGHT)}
      onClick={() => {
        if (!press.fired.current) onOpen(cell);
      }}
      {...press.handlers}
    >
      <img
        // 命中缓存的图片可能在事件绑定前就已加载完，挂载时补查一次。
        ref={(node) => { if (node?.complete && node.naturalWidth) setLoaded(true); }}
        src={src}
        alt={cell.task.prompt || "作品"}
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
      />
      {seconds != null && <span className="m-slot-seconds">{seconds}s</span>}
    </button>
  );
}

function PendingSlot({ cell, single, now }) {
  const seconds = cellSeconds(cell.task, now);
  return (
    <div className="m-slot is-pending" style={frameStyle(aspectNumber(cell.task), single, FRAME_MAX_HEIGHT)}>
      <DotLoading color="currentColor" />
      <span>{seconds ?? 0}s</span>
    </div>
  );
}

function FailedSlot({ cell, single }) {
  const canceled = ["cancelled", "canceled"].includes(cell.task.status);
  return (
    <div className="m-slot is-failed" style={frameStyle(aspectNumber(cell.task), single, FRAME_MAX_HEIGHT)}>
      {canceled ? <CloseCircleOutline /> : single ? <ExclamationCircleOutline /> : <PictureOutline />}
      <strong>{canceled ? "创作已停止" : "本次创作未完成"}</strong>
      <small>{canceled ? "这次任务没有生成图片" : taskFailureMessage(cell.task) || "生成过程中遇到问题，请稍后重试"}</small>
    </div>
  );
}

function PromptBubble({ text, onLongPress }) {
  const [expanded, setExpanded] = useState(false);
  const press = useLongPress(onLongPress);
  return (
    <button
      type="button"
      className={`m-turn-prompt${expanded ? " is-expanded" : ""}`}
      onClick={() => {
        if (!press.fired.current) setExpanded((value) => !value);
      }}
      {...press.handlers}
    >
      {text}
    </button>
  );
}

/** 一次提交（一组）：右侧提示词气泡 + 结果图 + 规格与耗时，与 App 的 _CreationTurn 一致。 */
function CreationTurnView({ group, now, modelLabel, onOpenImage, onCellMenu, onPromptMenu }) {
  const single = group.cells.length === 1;
  const spec = groupSpec(group, modelLabel);
  const seconds = groupSeconds(group, now);
  const prompt = String(group.lead.prompt || "").trim();
  return (
    <article className="m-turn" data-turn={group.key}>
      {prompt && <PromptBubble text={prompt} onLongPress={() => onPromptMenu(group)} />}
      <div className={`m-turn-result${single ? " is-single" : " is-strip"}`}>
        {group.cells.map((cell) => {
          if (cell.kind === "image") return <ImageSlot key={cell.key} cell={cell} single={single} now={now} onOpen={onOpenImage} onLongPress={onCellMenu} />;
          if (cell.kind === "pending") return <PendingSlot key={cell.key} cell={cell} single={single} now={now} />;
          return <FailedSlot key={cell.key} cell={cell} single={single} />;
        })}
      </div>
      {(spec || seconds != null) && (
        <footer className="m-turn-meta">
          <span>{spec}</span>
          {seconds != null && <span>总生成耗时 {seconds} 秒</span>}
        </footer>
      )}
    </article>
  );
}

// 轮询每次都会生成新的分组对象；只有内容（签名）、计时或模型名变化时才重渲染。
// 回调都只按 id 查找最新数据，不依赖闭包里的旧分组，所以比较时可以忽略。
export const CreationTurn = memo(CreationTurnView, (prev, next) => prev.group.signature === next.group.signature
  && prev.now === next.now
  && prev.modelLabel === next.modelLabel);
