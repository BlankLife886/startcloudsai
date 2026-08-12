import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

function numericAspect(value, fallback = 3 / 4) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const parts = String(value || "")
    .split(/[/:]/)
    .map((part) => Number(part.trim()));
  if (
    parts.length === 2 &&
    parts.every((part) => Number.isFinite(part) && part > 0)
  ) {
    return parts[0] / parts[1];
  }
  return fallback;
}

export function buildVirtualMasonryLayout(
  items,
  containerWidth,
  {
    gap = 14,
    minColumnWidth = 220,
    maxColumns = 4,
    bodyHeight = 178,
    fallbackAspect = 3 / 4,
    getAspect = (entry) => entry?.aspect,
  } = {},
) {
  const width = Math.max(0, Number(containerWidth) || 0);
  if (!width) {
    return { columns: 1, columnWidth: 0, height: 0, positions: [] };
  }

  const responsiveMaximum = Math.max(
    1,
    Math.floor((width + gap) / (minColumnWidth + gap)) || 1,
  );
  const columns = Math.max(1, Math.min(maxColumns, responsiveMaximum));
  const columnWidth = (width - gap * (columns - 1)) / columns;
  const heights = Array.from({ length: columns }, () => 0);
  const positions = (Array.isArray(items) ? items : []).map((entry, index) => {
    let column = 0;
    for (let candidate = 1; candidate < columns; candidate += 1) {
      if (heights[candidate] < heights[column]) column = candidate;
    }
    const aspect = Math.min(
      5,
      Math.max(0.2, numericAspect(getAspect(entry), fallbackAspect)),
    );
    const mediaHeight = Math.round(Math.max(1, columnWidth - 2) / aspect);
    const height = mediaHeight + bodyHeight + 2;
    const position = {
      ...entry,
      item: entry?.item ?? entry,
      index: Number.isInteger(entry?.index) ? entry.index : index,
      key: String(entry?.key || entry?.id || index),
      top: heights[column],
      left: column * (columnWidth + gap),
      width: columnWidth,
      height,
      mediaHeight,
    };
    heights[column] += height + gap;
    return position;
  });

  return {
    columns,
    columnWidth,
    height: Math.max(0, ...heights) - (positions.length ? gap : 0),
    positions,
  };
}

export function useVirtualMasonryFeed({
  items,
  gap = 14,
  minColumnWidth = 220,
  maxColumns = 4,
  bodyHeight = 178,
  overscan = 900,
  fallbackAspect = 3 / 4,
  getAspect,
} = {}) {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewport, setViewport] = useState([0, 0]);
  const [measuredAspects, setMeasuredAspects] = useState({});

  const scheduleViewportMeasure = useCallback(() => {
    const root = containerRef.current;
    if (!root || typeof window === "undefined") return;
    const rect = root.getBoundingClientRect();
    setContainerWidth((current) =>
      rect.width > 0 && Math.abs(current - rect.width) > 0.5
        ? rect.width
        : current,
    );
    setViewport([-rect.top, -rect.top + window.innerHeight]);
  }, []);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return undefined;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        scheduleViewportMeasure();
      });
    };
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(root);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    scheduleViewportMeasure();
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [items.length, scheduleViewportMeasure]);

  const layout = useMemo(
    () =>
      buildVirtualMasonryLayout(items, containerWidth, {
        gap,
        minColumnWidth,
        maxColumns,
        bodyHeight,
        fallbackAspect,
        getAspect: (entry) =>
          measuredAspects[String(entry?.key || entry?.id || "")] ||
          getAspect?.(entry),
      }),
    [
      bodyHeight,
      containerWidth,
      fallbackAspect,
      gap,
      getAspect,
      items,
      maxColumns,
      measuredAspects,
      minColumnWidth,
    ],
  );

  const visibleItems = useMemo(() => {
    const start = viewport[0] - overscan;
    const end = viewport[1] + overscan;
    return layout.positions.filter(
      (entry) => entry.top + entry.height >= start && entry.top <= end,
    );
  }, [layout.positions, overscan, viewport]);

  const measureFromEvent = useCallback((key, event) => {
    const image = event?.currentTarget || event?.target;
    const width = Number(image?.naturalWidth || 0);
    const height = Number(image?.naturalHeight || 0);
    if (!key || width <= 0 || height <= 0) return;
    const aspect = width / height;
    setMeasuredAspects((current) =>
      current[key] === aspect ? current : { ...current, [key]: aspect },
    );
  }, []);

  return {
    containerRef,
    columnCount: layout.columns,
    totalHeight: layout.height,
    visibleItems,
    measureFromEvent,
    scheduleViewportMeasure,
  };
}
