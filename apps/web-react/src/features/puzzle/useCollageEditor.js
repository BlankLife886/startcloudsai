import { useCallback, useMemo, useRef, useState } from "react";
import {
  BACKGROUND_PRESETS,
  COLLAGE_TEMPLATES,
  getBackgroundPresetById,
  getTemplateById,
  resolveBoardRatio,
} from "@react/legacy-modules/features/ai-puzzle/domain/collageTemplates.js";

const HISTORY_LIMIT = 60;

function createCellState(src = "") {
  return { src, scale: 1, offsetX: 0, offsetY: 0, filterId: "none" };
}

function cellsForTemplate(template, previous = []) {
  return template.cells.map((_, index) => ({
    ...createCellState(),
    ...(previous[index] || {}),
  }));
}

function cloneSnapshot(state) {
  return {
    ...state,
    cells: state.cells.map((cell) => ({ ...cell })),
    caption: { ...state.caption },
  };
}

const initialTemplate = COLLAGE_TEMPLATES[0];
const initialEditor = {
  templateId: initialTemplate.id,
  ratioId: "auto",
  cells: cellsForTemplate(initialTemplate),
  selectedCell: 0,
  gap: 8,
  radius: 6,
  padding: 0,
  backgroundId: "white",
  customBgColor: "",
  caption: {
    enabled: false,
    content: "",
    position: "bottom",
    color: "#ffffff",
    size: 5,
    shadow: true,
  },
};

export function useCollageEditor() {
  const [editor, setEditor] = useState(initialEditor);
  const [uploads, setUploads] = useState([]);
  const [zoom, setZoom] = useState(85);
  const [exporting, setExporting] = useState(false);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const editorRef = useRef(editor);
  editorRef.current = editor;

  const commit = useCallback((mutate, { history = true } = {}) => {
    setEditor((current) => {
      if (history) {
        undoStack.current.push(cloneSnapshot(current));
        if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift();
        redoStack.current = [];
      }
      const next = mutate(cloneSnapshot(current));
      editorRef.current = next;
      return next;
    });
  }, []);

  const template = useMemo(() => getTemplateById(editor.templateId), [editor.templateId]);
  const boardRatio = useMemo(
    () => resolveBoardRatio(template, editor.ratioId),
    [template, editor.ratioId],
  );
  const background = useMemo(
    () =>
      editor.customBgColor
        ? { type: "solid", color: editor.customBgColor }
        : getBackgroundPresetById(editor.backgroundId),
    [editor.backgroundId, editor.customBgColor],
  );
  const filledCount = useMemo(
    () => editor.cells.filter((cell) => cell.src).length,
    [editor.cells],
  );

  const setTemplate = useCallback(
    (id) => {
      if (editorRef.current.templateId === id) return;
      commit((current) => {
        const nextTemplate = getTemplateById(id);
        return {
          ...current,
          templateId: id,
          cells: cellsForTemplate(nextTemplate, current.cells),
          selectedCell:
            current.selectedCell < nextTemplate.cells.length ? current.selectedCell : 0,
        };
      });
    },
    [commit],
  );

  const updateField = useCallback(
    (field, value, options) => commit((current) => ({ ...current, [field]: value }), options),
    [commit],
  );

  const addUpload = useCallback((src, label = "") => {
    if (!src) return null;
    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      src,
      label,
    };
    setUploads((current) => [item, ...current]);
    return item;
  }, []);

  const assignImageToCell = useCallback(
    (index, src) => {
      if (!src) return;
      commit((current) => {
        if (index < 0 || index >= current.cells.length) return current;
        const cells = current.cells.map((cell, cellIndex) =>
          cellIndex === index ? createCellState(src) : cell,
        );
        return { ...current, cells, selectedCell: index };
      });
    },
    [commit],
  );

  const assignImageSmart = useCallback(
    (src, preferredIndex) => {
      if (!src) return;
      commit((current) => {
        const count = current.cells.length;
        const preferred = Math.max(
          0,
          Math.min(preferredIndex ?? current.selectedCell, Math.max(0, count - 1)),
        );
        let target = preferred;
        if (current.cells[target]?.src) {
          for (let offset = 1; offset <= count; offset += 1) {
            const candidate = (preferred + offset) % count;
            if (!current.cells[candidate]?.src) {
              target = candidate;
              break;
            }
          }
        }
        const cells = current.cells.map((cell, index) =>
          index === target ? createCellState(src) : cell,
        );
        let nextSelection = target;
        for (let offset = 1; offset <= count; offset += 1) {
          const candidate = (target + offset) % count;
          if (!cells[candidate]?.src) {
            nextSelection = candidate;
            break;
          }
        }
        return { ...current, cells, selectedCell: nextSelection };
      });
    },
    [commit],
  );

  const removeUpload = useCallback(
    (id) => {
      setUploads((current) => {
        const removed = current.find((item) => item.id === id);
        if (removed?.src && editorRef.current.cells.some((cell) => cell.src === removed.src)) {
          commit((state) => ({
            ...state,
            cells: state.cells.map((cell) =>
              cell.src === removed.src ? createCellState() : cell,
            ),
          }));
        }
        return current.filter((item) => item.id !== id);
      });
    },
    [commit],
  );

  const updateCell = useCallback(
    (index, patch, options = {}) => {
      commit(
        (current) => ({
          ...current,
          cells: current.cells.map((cell, cellIndex) =>
            cellIndex === index ? { ...cell, ...patch } : cell,
          ),
        }),
        { history: options.history !== false },
      );
    },
    [commit],
  );

  const clearCell = useCallback(
    (index) => updateCell(index, createCellState()),
    [updateCell],
  );

  const clearAllCells = useCallback(
    () =>
      commit((current) => ({
        ...current,
        cells: current.cells.map(() => createCellState()),
      })),
    [commit],
  );

  const autoFillFromUploads = useCallback(() => {
    if (!uploads.length) return;
    commit((current) => {
      let uploadIndex = 0;
      const cells = current.cells.map((cell) => {
        if (cell.src || uploadIndex >= uploads.length) return cell;
        return createCellState(uploads[uploadIndex++].src);
      });
      return { ...current, cells };
    });
  }, [commit, uploads]);

  const shuffleCells = useCallback(() => {
    commit((current) => {
      const filled = current.cells.filter((cell) => cell.src).map((cell) => ({ ...cell }));
      if (filled.length < 2) return current;
      for (let index = filled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [filled[index], filled[swapIndex]] = [filled[swapIndex], filled[index]];
      }
      let cursor = 0;
      return {
        ...current,
        cells: current.cells.map((cell) => (cell.src ? filled[cursor++] : cell)),
      };
    });
  }, [commit]);

  const swapCells = useCallback(
    (from, to) => {
      commit((current) => {
        if (from === to || from < 0 || to < 0 || from >= current.cells.length || to >= current.cells.length) {
          return current;
        }
        const cells = current.cells.map((cell) => ({ ...cell }));
        [cells[from], cells[to]] = [cells[to], cells[from]];
        return { ...current, cells, selectedCell: to };
      });
    },
    [commit],
  );

  const undo = useCallback(() => {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(cloneSnapshot(editorRef.current));
    editorRef.current = previous;
    setEditor(previous);
  }, []);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(cloneSnapshot(editorRef.current));
    editorRef.current = next;
    setEditor(next);
  }, []);

  return {
    ...editor,
    template,
    boardRatio,
    background,
    filledCount,
    uploads,
    zoom,
    exporting,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    BACKGROUND_PRESETS,
    setZoom,
    setExporting,
    setTemplate,
    setRatio: (value) => updateField("ratioId", value),
    setGap: (value, options) => updateField("gap", value, options),
    setRadius: (value, options) => updateField("radius", value, options),
    setPadding: (value, options) => updateField("padding", value, options),
    setSelectedCell: (value) => updateField("selectedCell", value, { history: false }),
    setBackground: (value) =>
      commit((current) => ({ ...current, backgroundId: value, customBgColor: "" })),
    setCustomBgColor: (value) =>
      commit((current) => ({ ...current, customBgColor: value })),
    setCaption: (value, options) =>
      commit(
        (current) => ({
          ...current,
          caption: typeof value === "function" ? value(current.caption) : value,
        }),
        options,
      ),
    addUpload,
    removeUpload,
    assignImageToCell,
    assignImageSmart,
    clearCell,
    clearAllCells,
    updateCell,
    resetCellFraming: (index) =>
      updateCell(index, { scale: 1, offsetX: 0, offsetY: 0 }),
    setCellFilter: (index, filterId) => updateCell(index, { filterId }),
    applyFilterToAll: (filterId) =>
      commit((current) => ({
        ...current,
        cells: current.cells.map((cell) => ({ ...cell, filterId })),
      })),
    autoFillFromUploads,
    shuffleCells,
    swapCells,
    undo,
    redo,
  };
}
