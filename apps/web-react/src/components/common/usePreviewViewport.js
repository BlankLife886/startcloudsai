import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export const MIN_ZOOM = 1;
export const DOUBLE_CLICK_ZOOM_MAX = 3;
export const MAX_ZOOM = 5;
export const ZOOM_STEP_FACTOR = 1.25;

export function clampZoom(value) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

export function getEffectiveBounds(metrics, zoom, rotation = 0) {
  if (!metrics) return { maxOffsetX: 0, maxOffsetY: 0 };
  let scaledWidth = metrics.baseDisplayWidth * zoom;
  let scaledHeight = metrics.baseDisplayHeight * zoom;
  if (Math.abs(rotation % 180) > 0.001) {
    [scaledWidth, scaledHeight] = [scaledHeight, scaledWidth];
  }
  return {
    maxOffsetX: Math.max(0, (scaledWidth - metrics.containerWidth) / 2),
    maxOffsetY: Math.max(0, (scaledHeight - metrics.containerHeight) / 2),
  };
}

export function clampPreviewOffsets(x, y, { metrics, zoom, rotation }) {
  const bounds = getEffectiveBounds(metrics, zoom, rotation);
  return {
    x: Math.max(-bounds.maxOffsetX, Math.min(bounds.maxOffsetX, x)),
    y: Math.max(-bounds.maxOffsetY, Math.min(bounds.maxOffsetY, y)),
  };
}

export function getZoomOffsetsAroundPoint({
  previousZoom,
  nextZoom,
  offsetX,
  offsetY,
  containerRect,
  point,
}) {
  const focusX = point?.clientX ?? containerRect.left + containerRect.width / 2;
  const focusY = point?.clientY ?? containerRect.top + containerRect.height / 2;
  const localX = focusX - (containerRect.left + containerRect.width / 2);
  const localY = focusY - (containerRect.top + containerRect.height / 2);
  const zoomRatio = nextZoom / previousZoom;
  return {
    x: offsetX * zoomRatio - localX * (zoomRatio - 1),
    y: offsetY * zoomRatio - localY * (zoomRatio - 1),
  };
}

export function getVisibleSourceRect(metrics, zoom, offsetX, offsetY) {
  if (!metrics) return null;
  const scale = metrics.baseScale * zoom;
  if (!scale) return null;
  const visibleSourceWidth = Math.min(metrics.naturalWidth, metrics.containerWidth / scale);
  const visibleSourceHeight = Math.min(metrics.naturalHeight, metrics.containerHeight / scale);
  const maxSourceLeft = Math.max(0, metrics.naturalWidth - visibleSourceWidth);
  const maxSourceTop = Math.max(0, metrics.naturalHeight - visibleSourceHeight);
  return {
    ...metrics,
    scale,
    visibleSourceWidth,
    visibleSourceHeight,
    maxSourceLeft,
    maxSourceTop,
    sourceLeft: Math.max(0, Math.min(maxSourceLeft, (metrics.naturalWidth - visibleSourceWidth) / 2 - offsetX / scale)),
    sourceTop: Math.max(0, Math.min(maxSourceTop, (metrics.naturalHeight - visibleSourceHeight) / 2 - offsetY / scale)),
  };
}

export function usePreviewViewport({ imageRef, viewportRef, onActivity, getPreferredFitMode }) {
  const initialFitMode = getPreferredFitMode?.() === "cover" ? "cover" : "contain";
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [rotation, setRotation] = useState(0);
  const [baseFitMode, setBaseFitMode] = useState(initialFitMode);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [snapTransform, setSnapTransform] = useState(false);
  const dragRef = useRef(null);
  const minimapDragRef = useRef(null);
  const snapFrameRef = useRef(0);
  const stateRef = useRef({ zoom, rotation, offset, baseFitMode });
  stateRef.current = { ...stateRef.current, zoom, rotation, offset, baseFitMode };

  const getMetrics = useCallback(() => {
    const image = imageRef.current;
    const viewport = viewportRef.current;
    if (!image || !viewport) return null;
    const naturalWidth = image.naturalWidth || image.clientWidth || 0;
    const naturalHeight = image.naturalHeight || image.clientHeight || 0;
    const containerWidth = viewport.clientWidth || 0;
    const containerHeight = viewport.clientHeight || 0;
    if (!naturalWidth || !naturalHeight || !containerWidth || !containerHeight) return null;
    const containScale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
    const coverScale = Math.max(containerWidth / naturalWidth, containerHeight / naturalHeight);
    const baseScale = containScale || 1;
    return {
      naturalWidth,
      naturalHeight,
      containerWidth,
      containerHeight,
      containScale,
      coverScale,
      baseScale,
      coverZoomFactor: Math.max(1, coverScale / Math.max(baseScale, 0.0001)),
      baseDisplayWidth: naturalWidth * baseScale,
      baseDisplayHeight: naturalHeight * baseScale,
    };
  }, [imageRef, viewportRef]);

  const clampOffset = useCallback(
    (nextOffset, nextZoom = stateRef.current.zoom, nextRotation = stateRef.current.rotation) =>
      clampPreviewOffsets(nextOffset.x, nextOffset.y, {
        metrics: getMetrics(),
        zoom: nextZoom,
        rotation: nextRotation,
      }),
    [getMetrics],
  );

  const zoomAroundPoint = useCallback(
    (targetZoom, point = null) => {
      const viewport = viewportRef.current;
      const current = stateRef.current;
      const nextZoom = clampZoom(targetZoom);
      if (!viewport || Math.abs(nextZoom - current.zoom) < 0.001) return;
      let nextOffset = getZoomOffsetsAroundPoint({
        previousZoom: current.zoom,
        nextZoom,
        offsetX: current.offset.x,
        offsetY: current.offset.y,
        containerRect: viewport.getBoundingClientRect(),
        point,
      });
      if (nextZoom <= MIN_ZOOM) nextOffset = { x: 0, y: 0 };
      nextOffset = clampOffset(nextOffset, nextZoom, current.rotation);
      stateRef.current = { ...current, zoom: nextZoom, offset: nextOffset };
      setZoom(nextZoom);
      setOffset(nextOffset);
      onActivity?.();
    },
    [clampOffset, onActivity, viewportRef],
  );

  const resetZoom = useCallback(
    (fitMode = baseFitMode) => {
      const metrics = getMetrics();
      const preferredZoom = fitMode === "cover" ? clampZoom(metrics?.coverZoomFactor || 1) : MIN_ZOOM;
      stateRef.current = {
        ...stateRef.current,
        zoom: preferredZoom,
        offset: { x: 0, y: 0 },
        baseFitMode: fitMode,
      };
      setZoom(preferredZoom);
      setOffset({ x: 0, y: 0 });
    },
    [baseFitMode, getMetrics],
  );

  const toggleFitMode = useCallback(() => {
    const next = baseFitMode === "cover" ? "contain" : "cover";
    window.cancelAnimationFrame(snapFrameRef.current);
    setSnapTransform(true);
    setBaseFitMode(next);
    resetZoom(next);
    snapFrameRef.current = window.requestAnimationFrame(() => {
      setSnapTransform(false);
    });
  }, [baseFitMode, resetZoom]);

  const handleWheel = useCallback(
    (event) => {
      event.preventDefault();
      if (dragRef.current) return;
      const delta = event.deltaY || event.detail || event.wheelDelta;
      if (!Number.isFinite(delta) || delta === 0) return;
      const sensitivity = event.ctrlKey ? 0.003 : 0.0018;
      zoomAroundPoint(stateRef.current.zoom * Math.exp(-delta * sensitivity), event);
    },
    [zoomAroundPoint],
  );

  const endDrag = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;
      document.removeEventListener("pointermove", drag.move);
      document.removeEventListener("pointerup", drag.end);
      document.removeEventListener("pointercancel", drag.end);
      const current = stateRef.current;
      const constrained = clampOffset(current.offset, current.zoom, current.rotation);
      stateRef.current = { ...current, offset: constrained };
      setOffset(constrained);
      setDragging(false);
      if (drag.moved && event?.cancelable) event.preventDefault();
    },
    [clampOffset],
  );

  const startDrag = useCallback(
    (event) => {
      if (event.button !== 0 || stateRef.current.zoom <= MIN_ZOOM) return;
      event.preventDefault();
      event.stopPropagation();
      const current = stateRef.current;
      const drag = {
        startX: event.clientX,
        startY: event.clientY,
        startOffset: current.offset,
        moved: false,
      };
      drag.move = (moveEvent) => {
        moveEvent.preventDefault();
        const deltaX = moveEvent.clientX - drag.startX;
        const deltaY = moveEvent.clientY - drag.startY;
        if (!drag.moved && Math.hypot(deltaX, deltaY) > 3) drag.moved = true;
        const nextOffset = clampOffset(
          { x: drag.startOffset.x + deltaX, y: drag.startOffset.y + deltaY },
          stateRef.current.zoom,
          stateRef.current.rotation,
        );
        stateRef.current = { ...stateRef.current, offset: nextOffset };
        setOffset(nextOffset);
        onActivity?.();
      };
      drag.end = endDrag;
      dragRef.current = drag;
      stateRef.current = { ...current, dragging: true };
      setDragging(true);
      document.addEventListener("pointermove", drag.move, { passive: false });
      document.addEventListener("pointerup", drag.end);
      document.addEventListener("pointercancel", drag.end);
    },
    [clampOffset, endDrag, onActivity],
  );

  const rotate = useCallback(() => {
    const nextRotation = stateRef.current.rotation + 90;
    const nextOffset = clampOffset(stateRef.current.offset, stateRef.current.zoom, nextRotation);
    stateRef.current = { ...stateRef.current, rotation: nextRotation, offset: nextOffset };
    setRotation(nextRotation);
    setOffset(nextOffset);
  }, [clampOffset]);

  const zoomIn = useCallback(() => {
    const current = stateRef.current;
    const preferredBase = current.baseFitMode === "cover" ? getMetrics()?.coverZoomFactor || 1 : 1;
    zoomAroundPoint(Math.max(current.zoom, preferredBase) * ZOOM_STEP_FACTOR);
  }, [getMetrics, zoomAroundPoint]);

  const zoomOut = useCallback(() => {
    zoomAroundPoint(stateRef.current.zoom / ZOOM_STEP_FACTOR);
  }, [zoomAroundPoint]);

  const toggleZoom = useCallback(
    (event) => {
      const currentZoom = stateRef.current.zoom;
      if (currentZoom < DOUBLE_CLICK_ZOOM_MAX - 0.01)
        zoomAroundPoint(Math.min(DOUBLE_CLICK_ZOOM_MAX, currentZoom + 1), event);
      else resetZoom(stateRef.current.baseFitMode);
    },
    [resetZoom, zoomAroundPoint],
  );

  const resetView = useCallback((requestedFitMode) => {
    const nextFitMode = requestedFitMode === "cover" || requestedFitMode === "contain"
      ? requestedFitMode
      : getPreferredFitMode?.() === "cover" ? "cover" : "contain";
    const metrics = getMetrics();
    const nextZoom = nextFitMode === "cover" ? clampZoom(metrics?.coverZoomFactor || 1) : MIN_ZOOM;
    setBaseFitMode(nextFitMode);
    stateRef.current = { zoom: nextZoom, rotation: 0, offset: { x: 0, y: 0 }, baseFitMode: nextFitMode };
    setZoom(nextZoom);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  }, [getMetrics, getPreferredFitMode]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      const current = stateRef.current;
      const nextOffset = clampOffset(current.offset, current.zoom, current.rotation);
      setOffset(nextOffset);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [clampOffset, viewportRef]);

  const visibleSourceRect = getVisibleSourceRect(getMetrics(), zoom, offset.x, offset.y);
  const minimap = useMemo(() => {
    if (!visibleSourceRect || zoom <= 1.001 || Math.abs(rotation % 180) > 0.001) return null;
    const scale = Math.min(180 / visibleSourceRect.naturalWidth, 112 / visibleSourceRect.naturalHeight);
    const width = Math.max(72, Math.round(visibleSourceRect.naturalWidth * scale));
    const height = Math.max(72, Math.round(visibleSourceRect.naturalHeight * scale));
    const viewportWidth = Math.min(width, Math.max(18, Math.round((visibleSourceRect.visibleSourceWidth / visibleSourceRect.naturalWidth) * width)));
    const viewportHeight = Math.min(height, Math.max(18, Math.round((visibleSourceRect.visibleSourceHeight / visibleSourceRect.naturalHeight) * height)));
    return {
      width,
      height,
      viewportWidth,
      viewportHeight,
      viewportLeft: Math.max(0, Math.min(width - viewportWidth, (visibleSourceRect.sourceLeft / visibleSourceRect.naturalWidth) * width)),
      viewportTop: Math.max(0, Math.min(height - viewportHeight, (visibleSourceRect.sourceTop / visibleSourceRect.naturalHeight) * height)),
    };
  }, [offset, rotation, visibleSourceRect, zoom]);

  const updateFromMinimapDrag = useCallback(
    (drag, clientX, clientY) => {
      const { metrics, rect, sourceRect } = drag;
      const maxViewportLeft = Math.max(0, metrics.width - metrics.viewportWidth);
      const maxViewportTop = Math.max(0, metrics.height - metrics.viewportHeight);
      const left = Math.max(0, Math.min(maxViewportLeft, clientX - rect.left - drag.grabOffsetX));
      const top = Math.max(0, Math.min(maxViewportTop, clientY - rect.top - drag.grabOffsetY));
      const sourceLeft = (left / Math.max(1, maxViewportLeft)) * sourceRect.maxSourceLeft;
      const sourceTop = (top / Math.max(1, maxViewportTop)) * sourceRect.maxSourceTop;
      const nextOffset = clampOffset({
        x: ((sourceRect.naturalWidth - sourceRect.visibleSourceWidth) / 2 - sourceLeft) * sourceRect.scale,
        y: ((sourceRect.naturalHeight - sourceRect.visibleSourceHeight) / 2 - sourceTop) * sourceRect.scale,
      });
      stateRef.current = { ...stateRef.current, offset: nextOffset };
      setOffset(nextOffset);
      onActivity?.();
    },
    [clampOffset, onActivity],
  );

  const endMinimapDrag = useCallback((event) => {
    const drag = minimapDragRef.current;
    if (!drag) return;
    minimapDragRef.current = null;
    window.removeEventListener("pointermove", drag.move);
    window.removeEventListener("pointerup", drag.end);
    window.removeEventListener("pointercancel", drag.end);
    if (drag.target.hasPointerCapture?.(drag.pointerId))
      drag.target.releasePointerCapture(drag.pointerId);
    if (event?.cancelable) event.preventDefault();
  }, []);

  const startMinimapDrag = useCallback(
    (event) => {
      if (event.button !== 0 || !minimap || !visibleSourceRect) return;
      event.preventDefault();
      event.stopPropagation();
      endMinimapDrag();
      const target = event.currentTarget;
      const rect = target.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;
      const insideViewport =
        pointerX >= minimap.viewportLeft &&
        pointerX <= minimap.viewportLeft + minimap.viewportWidth &&
        pointerY >= minimap.viewportTop &&
        pointerY <= minimap.viewportTop + minimap.viewportHeight;
      const drag = {
        target,
        pointerId: event.pointerId,
        rect,
        metrics: minimap,
        sourceRect: visibleSourceRect,
        grabOffsetX: insideViewport ? pointerX - minimap.viewportLeft : minimap.viewportWidth / 2,
        grabOffsetY: insideViewport ? pointerY - minimap.viewportTop : minimap.viewportHeight / 2,
      };
      drag.move = (moveEvent) => {
        moveEvent.preventDefault();
        updateFromMinimapDrag(drag, moveEvent.clientX, moveEvent.clientY);
      };
      drag.end = endMinimapDrag;
      minimapDragRef.current = drag;
      target.setPointerCapture?.(event.pointerId);
      updateFromMinimapDrag(drag, event.clientX, event.clientY);
      window.addEventListener("pointermove", drag.move, { passive: false });
      window.addEventListener("pointerup", drag.end);
      window.addEventListener("pointercancel", drag.end);
    },
    [endMinimapDrag, minimap, updateFromMinimapDrag, visibleSourceRect],
  );

  useEffect(() => () => {
    endDrag();
    endMinimapDrag();
    window.cancelAnimationFrame(snapFrameRef.current);
  }, [endDrag, endMinimapDrag]);

  const hasTransform = Math.abs(zoom - 1) > 0.001 || Math.abs(rotation % 360) > 0.001 || Math.abs(offset.x) > 0.001 || Math.abs(offset.y) > 0.001;
  return {
    zoom,
    rotation,
    baseFitMode,
    offset,
    dragging,
    transformStyle: {
      transform: hasTransform ? `translate(${offset.x}px, ${offset.y}px) scale(${zoom}) rotate(${rotation}deg)` : "none",
      transition: dragging || snapTransform ? "none" : "transform 0.2s ease",
      backfaceVisibility: "hidden",
      transformOrigin: "center center",
    },
    cursor: dragging ? "grabbing" : zoom > 1 ? "grab" : "default",
    minimap,
    zoomAroundPoint,
    zoomIn,
    zoomOut,
    toggleZoom,
    handleWheel,
    startDrag,
    rotate,
    toggleFitMode,
    resetZoom,
    resetView,
    startMinimapDrag,
  };
}
