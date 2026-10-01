import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { listPrompts } from "../../legacy-modules/services/promptsApi.js";
import { SKILL_STORAGE_LABELS, skillMentionToken } from "./skillComposition.js";
import { loadSkillLibrary, SKILL_LIBRARY_UPDATED_EVENT } from "./skillLibrary.js";

// 触发条件与 findSkillMentions 的边界一致：`@` 前面不能紧贴 ASCII 字母数字
// （a@b 这类邮箱不触发），紧贴中文可以（"请用@柔光" 要能出菜单）。
const TRIGGER_RE = /(^|[^A-Za-z0-9_@/])([@/])([^\s@/]*)$/;
const PROMPT_DEBOUNCE_MS = 300;
const BLUR_CLOSE_MS = 120;
const MENU_HEIGHT = 320;

function isImeComposing(event) {
  const nativeEvent = event?.nativeEvent;
  return Boolean(
    event?.isComposing ||
      nativeEvent?.isComposing ||
      event?.keyCode === 229 ||
      event?.which === 229 ||
      nativeEvent?.keyCode === 229 ||
      nativeEvent?.which === 229,
  );
}

function matchesSkill(skill, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  return [skill?.name, skill?.slug, skill?.description].some((field) =>
    String(field || "").toLowerCase().includes(needle),
  );
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const CARET_STYLE_PROPS = [
  "boxSizing",
  "width",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontFamily",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textIndent",
  "whiteSpace",
  "wordWrap",
  "wordBreak",
  "tabSize",
];

function textareaCaretRect(textarea, position) {
  const style = getComputedStyle(textarea);
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  for (const prop of CARET_STYLE_PROPS) mirror.style[prop] = style[prop];
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.height = "auto";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.textContent = String(textarea.value || "").slice(0, position);
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const host = textarea.getBoundingClientRect();
  const markerBox = marker.getBoundingClientRect();
  const mirrorBox = mirror.getBoundingClientRect();
  mirror.remove();
  const top = host.top - textarea.scrollTop + (markerBox.top - mirrorBox.top);
  const left = host.left - textarea.scrollLeft + (markerBox.left - mirrorBox.left);
  return new DOMRect(left, top, 0, markerBox.height || parseFloat(style.lineHeight) || 20);
}

function floatingMenuStyle(editor) {
  const host = editor.getBoundingClientRect();
  const caret = textareaCaretRect(editor, editor.selectionStart ?? editor.value.length);
  const width = Math.min(Math.max(host.width, 220), Math.min(360, window.innerWidth - 16));
  const left = clamp(host.left, 8, window.innerWidth - width - 8);
  const lineTop = clamp(caret.top, host.top + 4, Math.max(host.top + 4, host.bottom - 4));
  const lineBottom = clamp(caret.top + caret.height, host.top + 4, Math.max(host.top + 4, host.bottom - 4));
  const gap = 6;
  const spaceAbove = lineTop - 8;
  const spaceBelow = window.innerHeight - lineBottom - 8;
  const above = spaceBelow < 128 && spaceAbove > spaceBelow;
  const maxHeight = Math.min(MENU_HEIGHT, Math.max(96, (above ? spaceAbove : spaceBelow) - gap));
  return {
    placement: above ? "above" : "below",
    style: {
      left: `${Math.round(left)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${Math.round(maxHeight)}px`,
      ...(above
        ? { top: "auto", bottom: `${Math.round(window.innerHeight - lineTop + gap)}px` }
        : { top: `${Math.round(lineBottom + gap)}px`, bottom: "auto" }),
    },
  };
}

function withTrailingSpace(text) {
  const value = String(text || "");
  return value.endsWith(" ") ? value : `${value} `;
}

/**
 * 在已有 textarea 上接入 `@` 技能 / `/` 提示词菜单。
 * 页面把 handleChange / handleKeyDown 串进原事件；菜单处理过的按键不再往下传。
 */
export function useMentionMenu({ textareaRef, value, onChange, promptType = "" }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("skill");
  const [query, setQuery] = useState("");
  const [triggerLength, setTriggerLength] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState("above");
  const [menuStyle, setMenuStyle] = useState({});
  const [skills, setSkills] = useState([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [prompts, setPrompts] = useState([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const blurTimerRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const closeMenu = useCallback(() => {
    setOpen(false);
    setQuery("");
    setTriggerLength(0);
    setActiveIndex(0);
    setPrompts([]);
    setPromptsLoading(false);
  }, []);

  const syncCommand = useCallback(
    (text = String(value || ""), caret) => {
      const editor = textareaRef.current;
      const resolvedCaret = caret ?? editor?.selectionStart ?? text.length;
      const before = String(text || "").slice(0, resolvedCaret);
      const match = TRIGGER_RE.exec(before);
      if (!match) {
        closeMenu();
        return;
      }
      const nextKind = match[2] === "@" ? "skill" : "prompt";
      const nextQuery = match[3] || "";
      setKind(nextKind);
      setQuery(nextQuery);
      setTriggerLength(nextQuery.length + 1);
      // 只有查询词变了才回到第一项；光标同步（keyup / click）不打断方向键选择。
      setActiveIndex((index) => (nextKind === kind && nextQuery === query ? index : 0));
      setOpen(true);
    },
    [closeMenu, kind, query, textareaRef, value],
  );

  useEffect(() => {
    let cancelled = false;
    setSkillsLoading(true);
    const refresh = () => {
      void loadSkillLibrary()
        .then((library) => {
          if (!cancelled) setSkills(Array.isArray(library?.items) ? library.items : []);
        })
        .catch(() => {
          if (!cancelled) setSkills([]);
        })
        .finally(() => {
          if (!cancelled) setSkillsLoading(false);
        });
    };
    refresh();
    if (typeof window === "undefined") return undefined;
    const onUpdate = () => {
      setSkillsLoading(true);
      refresh();
    };
    window.addEventListener(SKILL_LIBRARY_UPDATED_EVENT, onUpdate);
    return () => {
      cancelled = true;
      window.removeEventListener(SKILL_LIBRARY_UPDATED_EVENT, onUpdate);
    };
  }, []);

  useEffect(() => {
    if (!open || kind !== "prompt") {
      setPrompts([]);
      setPromptsLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    setPromptsLoading(true);
    const timer = window.setTimeout(() => {
      void listPrompts({
        type: promptType || "",
        search: query,
        limit: 12,
        signal: controller.signal,
      })
        .then((data) => {
          if (!controller.signal.aborted) setPrompts(Array.isArray(data?.items) ? data.items : []);
        })
        .catch(() => {
          if (!controller.signal.aborted) setPrompts([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setPromptsLoading(false);
        });
    }, PROMPT_DEBOUNCE_MS);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [kind, open, promptType, query]);

  const items = useMemo(() => {
    if (!open) return [];
    if (kind === "skill") {
      return skills.filter((skill) => matchesSkill(skill, query)).map((skill) => ({
        id: skill.id || skill.slug || skill.name,
        kind: "skill",
        title: skill.name,
        description: skill.description,
        badge: SKILL_STORAGE_LABELS[skill.storage] || "",
        skill,
      }));
    }
    return prompts.map((item) => ({
      id: item.id,
      kind: "prompt",
      title: item.title || item.name || "未命名提示词",
      description: item.prompt,
      prompt: item,
    }));
  }, [kind, open, prompts, query, skills]);

  useEffect(() => {
    if (!items.length) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((index) => Math.min(index, items.length - 1));
  }, [items]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const editor = textareaRef.current;
    if (!editor) return undefined;
    const update = () => {
      const next = floatingMenuStyle(editor);
      setPlacement(next.placement);
      setMenuStyle(next.style);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, textareaRef, value, query]);

  const replaceTrigger = useCallback(
    (insert) => {
      const editor = textareaRef.current;
      const text = String(value || "");
      const caret = editor?.selectionStart ?? text.length;
      const before = text.slice(0, caret);
      const match = TRIGGER_RE.exec(before);
      if (!match) return;
      const start = match.index + match[1].length;
      const next = `${text.slice(0, start)}${insert}${text.slice(caret)}`;
      const nextCaret = start + insert.length;
      onChangeRef.current(next);
      closeMenu();
      requestAnimationFrame(() => {
        editor?.focus();
        editor?.setSelectionRange(nextCaret, nextCaret);
      });
    },
    [closeMenu, textareaRef, value],
  );

  const selectItem = useCallback(
    (item) => {
      if (!item) return;
      if (item.kind === "skill") {
        replaceTrigger(withTrailingSpace(skillMentionToken(item.skill)));
        return;
      }
      replaceTrigger(withTrailingSpace(item.prompt?.prompt || item.description || ""));
    },
    [replaceTrigger],
  );

  const handleKeyDown = useCallback(
    (event) => {
      if (!open || isImeComposing(event)) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        if (items.length) {
          setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
        }
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        if (items.length) selectItem(items[Math.min(activeIndex, items.length - 1)]);
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return true;
      }
      return false;
    },
    [activeIndex, closeMenu, items, open, selectItem],
  );

  const handleChange = useCallback(
    (event) => {
      const next = event.target.value;
      onChangeRef.current(next);
      syncCommand(next, event.target.selectionStart);
    },
    [syncCommand],
  );

  const handleCaretSync = useCallback(
    (event) => {
      // 方向键上下 / 回车 / Tab / Esc 已由 handleKeyDown 处理，keyup 不再同步，
      // 否则会把刚选中的项又重置回去。
      if (event?.type === "keyup" && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
      syncCommand(String(value || ""));
    },
    [syncCommand, value],
  );

  const handleBlur = useCallback(
    (event) => {
      const next = event.relatedTarget;
      if (next instanceof HTMLElement && next.closest("[data-mention-menu]")) return;
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = window.setTimeout(closeMenu, BLUR_CLOSE_MS);
    },
    [closeMenu],
  );

  useEffect(
    () => () => {
      window.clearTimeout(blurTimerRef.current);
    },
    [],
  );

  return {
    open,
    handleKeyDown,
    handleChange,
    handleCaretSync,
    handleBlur,
    menuProps: {
      open,
      kind,
      query,
      items,
      activeIndex,
      loading: kind === "skill" ? skillsLoading : promptsLoading,
      placement,
      style: menuStyle,
      onSelect: selectItem,
      onHover: setActiveIndex,
    },
  };
}
