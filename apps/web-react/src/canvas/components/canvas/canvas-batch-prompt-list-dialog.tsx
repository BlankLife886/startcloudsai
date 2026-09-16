import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ChevronDown, ListOrdered, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  joinStoryboardDisplayLines,
  splitStoryboardDisplayLines,
} from "@/lib/canvas/canvas-storyboard-script-editing";
import {
  STORYBOARD_MAX_SCENES,
  resolveStoryboardParseMode,
  type StoryboardParseMode,
  type StoryboardStyle,
} from "@/lib/canvas/storyboard-parser";
import { canvasThemes } from "@/lib/canvas-theme";
import { colorWash, nodeTypeColor } from "@/lib/canvas-ui";
import { useThemeStore } from "@/stores/use-theme-store";
import {
  CanvasEditorModal,
  EditorGhostButton,
  EditorIconButton,
  EditorPrimaryButton,
} from "./canvas-editor-modal";
import { CanvasFieldMenu } from "./canvas-field-menu";
import "./canvas-storyboard-config.css";

const PARSE_MODE_LABELS: Record<StoryboardParseMode, string> = {
  lines: "canvas.storyboard.parseModeLines",
  paragraphs: "canvas.storyboard.parseModeParagraphs",
  markers: "canvas.storyboard.parseModeMarkers",
  prose: "canvas.storyboard.parseModeProse",
};

export type CanvasBatchPromptListDialogProps = {
  open: boolean;
  script: string;
  batchMode?: "split" | "variants" | "refs";
  parseMode?: StoryboardParseMode | string;
  style?: StoryboardStyle;
  onClose: () => void;
  onSave: (next: { script: string; parseMode: StoryboardParseMode }) => void;
};

type PromptRow = {
  id: string;
  text: string;
};

let promptRowSeq = 0;
function createRow(text = ""): PromptRow {
  promptRowSeq += 1;
  return { id: `prompt-row-${promptRowSeq}`, text };
}

function rowsFromScript(script: string, style: StoryboardStyle, mode: StoryboardParseMode): PromptRow[] {
  const lines = splitStoryboardDisplayLines(script, { style, mode });
  return (lines.length ? lines : [""]).map((text) => createRow(text));
}

function PromptRowTextarea({
  value,
  placeholder,
  ariaLabel,
  autoFocus,
  onChange,
  onFocus,
  onKeyDown,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const next = Math.max(36, Math.min(160, el.scrollHeight));
    if (Math.abs(el.offsetHeight - next) > 1) el.style.height = `${next}px`;
  }, [value]);

  useEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const length = el.value.length;
    el.setSelectionRange(length, length);
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      className="canvas-storyboard-script-shot-input thin-scrollbar"
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel}
      rows={1}
      onFocus={onFocus}
      onChange={(event) => {
        const el = event.currentTarget;
        el.style.height = "auto";
        el.style.height = `${Math.max(36, Math.min(160, el.scrollHeight))}px`;
        onChange(event.target.value);
      }}
      onKeyDown={onKeyDown}
    />
  );
}

export function CanvasBatchPromptListDialog({
  open,
  script,
  batchMode = "split",
  parseMode: parseModeProp,
  style = "cinematic",
  onClose,
  onSave,
}: CanvasBatchPromptListDialogProps) {
  const { t } = useTranslation();
  const theme = canvasThemes[useThemeStore((state) => state.theme)];
  const accent = nodeTypeColor("image", undefined, theme.scheme);
  const surface = colorWash(theme.node.text, theme.scheme === "dark" ? 0.08 : 0.05);
  const storyboardVars = { "--storyboard-accent": accent } as CSSProperties;
  const isVariants = batchMode === "variants" || batchMode === "refs";
  const [parseMode, setParseMode] = useState<StoryboardParseMode>(() => resolveStoryboardParseMode(parseModeProp));
  const [rows, setRows] = useState<PromptRow[]>(() =>
    isVariants ? [createRow(script)] : rowsFromScript(script, style, resolveStoryboardParseMode(parseModeProp)),
  );
  const [singleScript, setSingleScript] = useState(script);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [focusRequestId, setFocusRequestId] = useState<string | null>(null);
  const wasOpenRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const singleRef = useRef<HTMLTextAreaElement>(null);

  // Only hydrate when the dialog opens — never wipe in-progress edits if props update.
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    const mode = resolveStoryboardParseMode(parseModeProp);
    setParseMode(mode);
    if (batchMode === "variants" || batchMode === "refs") {
      setSingleScript(script);
      setRows([createRow(script)]);
      setFocusedId(null);
      setFocusRequestId(null);
      window.requestAnimationFrame(() => {
        const el = singleRef.current;
        if (!el) return;
        el.focus();
        const length = el.value.length;
        el.setSelectionRange(length, length);
      });
      return;
    }
    const nextRows = rowsFromScript(script, style, mode);
    setRows(nextRows);
    setFocusedId(nextRows[0]?.id ?? null);
    setFocusRequestId(nextRows[0]?.id ?? null);
  }, [batchMode, open, parseModeProp, script, style]);

  const parseOptions = useMemo(
    () =>
      (["lines", "paragraphs", "markers"] as StoryboardParseMode[]).map((mode) => ({
        value: mode,
        label: t(PARSE_MODE_LABELS[mode]),
      })),
    [t],
  );

  const filledCount = isVariants
    ? singleScript.trim()
      ? 1
      : 0
    : rows.filter((row) => row.text.trim()).length;
  const canAdd = rows.length < STORYBOARD_MAX_SCENES;

  const updateRow = (id: string, value: string) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, text: value } : row)));
  };

  const focusRow = (id: string) => {
    setFocusedId(id);
    setFocusRequestId(id);
  };

  const removeRow = (id: string) => {
    setRows((current) => {
      if (current.length <= 1) return [createRow("")];
      const index = current.findIndex((row) => row.id === id);
      const next = current.filter((row) => row.id !== id);
      const fallback = next[Math.max(0, index - 1)] || next[0];
      if (fallback) {
        setFocusedId(fallback.id);
        setFocusRequestId(fallback.id);
      }
      return next;
    });
  };

  const addRow = (afterId?: string) => {
    if (!canAdd) return;
    const row = createRow("");
    setRows((current) => {
      if (!afterId) return [...current, row];
      const index = current.findIndex((item) => item.id === afterId);
      if (index < 0) return [...current, row];
      const next = [...current];
      next.splice(index + 1, 0, row);
      return next;
    });
    setFocusedId(row.id);
    setFocusRequestId(row.id);
    window.requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector(`[data-prompt-row="${row.id}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };

  const handleRowKeyDown = (id: string, event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && parseMode !== "paragraphs") {
      event.preventDefault();
      if (!canAdd) return;
      addRow(id);
      return;
    }
    if (event.key === "Backspace" && !event.currentTarget.value) {
      const index = rows.findIndex((row) => row.id === id);
      if (index <= 0 || rows.length <= 1) return;
      event.preventDefault();
      removeRow(id);
    }
  };

  const save = () => {
    if (isVariants) {
      onSave({ script: singleScript, parseMode });
      onClose();
      return;
    }
    const texts = rows.map((row) => row.text);
    const expanded =
      parseMode === "paragraphs"
        ? texts
        : texts.flatMap((row) => {
            const parts = String(row || "")
              .split(/\n+/)
              .map((part) => part.trim())
              .filter(Boolean);
            return parts.length > 1 ? parts : [row];
          });
    const nextScript = joinStoryboardDisplayLines(expanded, parseMode);
    onSave({ script: nextScript, parseMode });
    onClose();
  };

  return (
    <CanvasEditorModal
      className="canvas-mask-modal"
      open={open}
      onClose={onClose}
      width="min(640px, 96vw)"
      title={t(
        batchMode === "refs"
          ? "canvas.storyboard.promptListTitleRefs"
          : isVariants
            ? "canvas.storyboard.promptListTitleVariants"
            : "canvas.storyboard.promptListTitle",
      )}
      hint={
        <div className="canvas-mask-shortcut">
          {t(
            batchMode === "refs"
              ? "canvas.storyboard.promptListHintRefs"
              : isVariants
                ? "canvas.storyboard.promptListHintVariants"
                : "canvas.storyboard.promptListHint",
          )}
        </div>
      }
      meta={isVariants ? undefined : t("canvas.storyboard.configShots", { count: filledCount })}
      icon={<ListOrdered className="size-4" />}
      ariaTitle={t(
        batchMode === "refs"
          ? "canvas.storyboard.promptListTitleRefs"
          : isVariants
            ? "canvas.storyboard.promptListTitleVariants"
            : "canvas.storyboard.promptListTitle",
      )}
    >
      <div className="canvas-storyboard-prompt-list-dialog" style={{ ...storyboardVars, color: theme.node.text }}>
        {isVariants ? (
          <div className="canvas-storyboard-prompt-list-field rounded-[14px]" style={{ background: theme.toolbar.itemHover }}>
            <textarea
              ref={singleRef}
              className="canvas-storyboard-prompt-single-input thin-scrollbar"
              value={singleScript}
              placeholder={t("canvas.storyboard.configPromptPlaceholder")}
              aria-label={t("canvas.storyboard.configPromptAria")}
              onChange={(event) => setSingleScript(event.target.value)}
            />
          </div>
        ) : (
          <>
            <div className="canvas-storyboard-prompt-list-toolbar">
              <span className="canvas-storyboard-prompt-list-toolbar-label" style={{ color: theme.node.muted }}>
                {t("canvas.storyboard.parseMode")}
              </span>
              <div className="canvas-storyboard-prompt-list-mode">
                <CanvasFieldMenu
                  value={parseMode}
                  options={parseOptions}
                  onChange={setParseMode}
                  theme={theme}
                  surface={surface}
                  compact
                  menuMinWidth={148}
                  triggerClassName="canvas-storyboard-script-toolbar-chip"
                >
                  {(menuOpen) => (
                    <>
                      <span className="min-w-0 flex-1 truncate">{t(PARSE_MODE_LABELS[parseMode])}</span>
                      <ChevronDown className={`size-3 shrink-0 opacity-45 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
                    </>
                  )}
                </CanvasFieldMenu>
              </div>
              <span className="canvas-storyboard-prompt-list-toolbar-note" style={{ color: theme.node.muted }}>
                {t("canvas.storyboard.promptListSerializeHint")}
              </span>
            </div>

            <div className="canvas-storyboard-prompt-list-field rounded-[14px]" style={{ background: theme.toolbar.itemHover }}>
              <div ref={scrollRef} className="canvas-storyboard-prompt-list-scroll thin-scrollbar">
                {rows.map((row, index) => {
                  const active = focusedId === row.id;
                  return (
                    <div
                      key={row.id}
                      className={`canvas-storyboard-script-shot is-editable${active ? " is-active" : ""}`}
                      data-prompt-row={row.id}
                      onMouseDown={(event) => {
                        if ((event.target as HTMLElement).closest("button,textarea")) return;
                        focusRow(row.id);
                      }}
                    >
                      <span className="canvas-storyboard-script-shot-index">{String(index + 1).padStart(2, "0")}</span>
                      <PromptRowTextarea
                        value={row.text}
                        placeholder={t("canvas.storyboard.promptListRowPlaceholder", { index: index + 1 })}
                        ariaLabel={t("canvas.storyboard.promptListRowAria", { index: index + 1 })}
                        autoFocus={focusRequestId === row.id}
                        onFocus={() => {
                          setFocusedId(row.id);
                          if (focusRequestId === row.id) setFocusRequestId(null);
                        }}
                        onChange={(value) => updateRow(row.id, value)}
                        onKeyDown={(event) => handleRowKeyDown(row.id, event)}
                      />
                      <div className="canvas-storyboard-script-shot-actions">
                        <EditorIconButton
                          title={t("canvas.storyboard.promptListDelete")}
                          disabled={rows.length <= 1 && !row.text.trim()}
                          onClick={() => removeRow(row.id)}
                        >
                          <Trash2 className="size-3.5" style={{ color: "#ef4444" }} />
                        </EditorIconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}

        <div className="flex items-center gap-3">
          {!isVariants ? (
            <EditorGhostButton className="is-quiet" icon={<Plus className="size-3.5" />} disabled={!canAdd} onClick={() => addRow()}>
              {t("canvas.storyboard.promptListAdd")}
            </EditorGhostButton>
          ) : null}
          <div className="min-w-0 flex-1" />
          <EditorGhostButton onClick={onClose}>{t("common.cancel")}</EditorGhostButton>
          <EditorPrimaryButton onClick={save} disabled={!filledCount}>
            {t("common.save")}
          </EditorPrimaryButton>
        </div>
      </div>
    </CanvasEditorModal>
  );
}
