import {
  startTransition,
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
    uniformRows = false,
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
  const entries = Array.isArray(items) ? items : [];

  if (uniformRows) {
    const aspect = Math.min(
      5,
      Math.max(0.2, numericAspect(fallbackAspect, 3 / 4)),
    );
    const mediaHeight = Math.round(Math.max(1, columnWidth - 2) / aspect);
    const height = mediaHeight + bodyHeight + 2;
    const positions = entries.map((entry, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        ...entry,
        item: entry?.item ?? entry,
        index: Number.isInteger(entry?.index) ? entry.index : index,
        key: String(entry?.key || entry?.id || index),
        top: row * (height + gap),
        left: column * (columnWidth + gap),
        width: columnWidth,
        height,
        mediaHeight,
      };
    });
    const rows = Math.ceil(entries.length / columns);
    return {
      columns,
      columnWidth,
      height: rows ? rows * height + (rows - 1) * gap : 0,
      positions,
      rowHeight: height + gap,
    };
  }

  const heights = Array.from({ length: columns }, () => 0);
  const positions = entries.map((entry, index) => {
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
  uniformRows = false,
  enabled = true,
} = {}) {
  const containerRef = useRef(null);
  const containerTopRef = useRef(0);
  const geometryReadyRef = useRef(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const [viewport, setViewport] = useState([0, 0]);
  const [measuredAspects, setMeasuredAspects] = useState({});

  const scheduleViewportMeasure = useCallback((measureGeometry = false) => {
    const root = containerRef.current;
    if (!root || typeof window === "undefined") return;
    if (measureGeometry || !geometryReadyRef.current) {
      const rect = root.getBoundingClientRect();
      containerTopRef.current = rect.top + window.scrollY;
      geometryReadyRef.current = true;
      setContainerWidth((current) =>
        rect.width > 0 && Math.abs(current - rect.width) > 0.5
          ? rect.width
          : current,
      );
    }
    const nextTop = window.scrollY - containerTopRef.current;
    const nextBottom = nextTop + window.innerHeight;
    startTransition(() => {
      setViewport((current) =>
        Math.abs(current[0] - nextTop) < 80 &&
        Math.abs(current[1] - nextBottom) < 80
          ? current
          : [nextTop, nextBottom],
      );
    });
  }, []);

  useLayoutEffect(() => {
    if (!enabled) return undefined;
    const root = containerRef.current;
    if (!root) return undefined;
    let frame = 0;
    let geometryDirty = true;
    const schedule = (nextGeometryDirty = false) => {
      geometryDirty = geometryDirty || nextGeometryDirty;
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        scheduleViewportMeasure(geometryDirty);
        geometryDirty = false;
      });
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => schedule(true));
    observer?.observe(root);
    const onScroll = () => schedule(false);
    const onResize = () => schedule(true);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize, { passive: true });
    schedule(true);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [enabled, items.length, scheduleViewportMeasure]);

  const layout = useMemo(
    () =>
      buildVirtualMasonryLayout(items, containerWidth, {
        gap,
        minColumnWidth,
        maxColumns,
        bodyHeight,
        fallbackAspect,
        uniformRows,
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
      uniformRows,
    ],
  );

  const visibleItems = useMemo(() => {
    const start = viewport[0] - overscan;
    const end = viewport[1] + overscan;
    if (uniformRows && layout.rowHeight) {
      const firstRow = Math.max(0, Math.floor(start / layout.rowHeight));
      const lastRow = Math.max(firstRow, Math.floor(end / layout.rowHeight));
      return layout.positions.slice(
        firstRow * layout.columns,
        Math.min(layout.positions.length, (lastRow + 1) * layout.columns),
      );
    }
    return layout.positions.filter(
      (entry) => entry.top + entry.height >= start && entry.top <= end,
    );
  }, [layout, overscan, uniformRows, viewport]);

  const measureFromEvent = useCallback(
    (key, event) => {
      if (uniformRows) return;
      const image = event?.currentTarget || event?.target;
      const width = Number(image?.naturalWidth || 0);
      const height = Number(image?.naturalHeight || 0);
      if (!key || width <= 0 || height <= 0) return;
      const aspect = width / height;
      setMeasuredAspects((current) =>
        current[key] === aspect ? current : { ...current, [key]: aspect },
      );
    },
    [uniformRows],
  );

  return {
    containerRef,
    columnCount: layout.columns,
    totalHeight: layout.height,
    visibleItems,
    measureFromEvent,
    scheduleViewportMeasure,
  };
}
