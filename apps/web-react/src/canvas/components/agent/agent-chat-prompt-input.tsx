import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { buildCanvasResourceReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import {
    listPromptLibrary,
    loadSkillLibrary,
    skillMentionToken,
    SKILL_LIBRARY_UPDATED_EVENT,
    type ImageSkillItem,
    type PromptLibraryItem,
} from "@/lib/image-skill-mentions";
import { isImeComposing, isPlainEnterKey } from "@/lib/keyboard-event";
import type { AgentSkillSummary } from "@/services/api/canvas-agent";
import { useAgentSkillStore } from "@/stores/use-agent-skill-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { canvasReferenceIcon, canvasReferenceKindLabel } from "./agent-canvas-reference-preview";
import { agentReferenceMarker, agentSkillMarker } from "./agent-chat-inline-tokens";

type ComposerCommand = { type: "skill" | "resource"; query: string; length: number };
type ComposerCandidate =
    | { type: "skill"; skill: AgentSkillSummary }
    | { type: "resource"; reference: CanvasResourceReference }
    | { type: "imageSkill"; skill: ImageSkillItem }
    | { type: "prompt"; prompt: PromptLibraryItem };

const MIN_EDITOR_HEIGHT = 44;
const MAX_EDITOR_HEIGHT = 128;

export function AgentChatPromptInput({ value, disabled, placeholder, theme, onChange, onSubmit, onAddFiles }: {
    value: string;
    disabled?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onChange: (value: string) => void;
    onSubmit: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const skills = useAgentSkillStore((state) => state.skills);
    const skillsLoading = useAgentSkillStore((state) => state.loading);
    const canvasReferences = useAgentStore((state) => state.canvasReferences);
    const [command, setCommand] = useState<ComposerCommand | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);
    const [resourceCandidates, setResourceCandidates] = useState<CanvasResourceReference[]>([]);
    const [imageSkills, setImageSkills] = useState<ImageSkillItem[]>([]);
    const [imageSkillsLoading, setImageSkillsLoading] = useState(false);
    const [libraryPrompts, setLibraryPrompts] = useState<PromptLibraryItem[]>([]);
    const [promptsLoading, setPromptsLoading] = useState(false);

    const selectedReferenceIds = useMemo(() => new Set(canvasReferences.map((item) => item.nodeId)), [canvasReferences]);
    const candidates = useMemo<ComposerCandidate[]>(() => {
        if (!command) return [];
        const query = command.query.trim().toLowerCase();
        if (command.type === "skill") {
            const localSkills = skills
                .filter((skill) => skill.enabled && (!query || [skill.name, skill.description, skill.interface?.displayName, skill.interface?.shortDescription, skill.shortDescription].some((item) => item?.toLowerCase().includes(query))))
                .map((skill) => ({ type: "skill" as const, skill }));
            const prompts = libraryPrompts.map((prompt) => ({ type: "prompt" as const, prompt }));
            return [...localSkills, ...prompts];
        }
        const skillCandidates = imageSkills
            .filter((skill) => !query || [skill.name, skill.slug, skill.description].some((item) => item?.toLowerCase().includes(query)))
            .map((skill) => ({ type: "imageSkill" as const, skill }));
        const resources = resourceCandidates
            .filter((reference) => !selectedReferenceIds.has(reference.nodeId) && (!query || `${reference.label} ${reference.title} ${reference.kind} ${reference.text || ""}`.toLowerCase().includes(query)))
            .map((reference) => ({ type: "resource" as const, reference }));
        return [...skillCandidates, ...resources];
    }, [command, imageSkills, libraryPrompts, resourceCandidates, selectedReferenceIds, skills]);

    useEffect(() => {
        let cancelled = false;
        const refresh = () => {
            setImageSkillsLoading(true);
            void loadSkillLibrary()
                .then((library) => {
                    if (!cancelled) setImageSkills(Array.isArray(library?.items) ? library.items : []);
                })
                .catch(() => {
                    if (!cancelled) setImageSkills([]);
                })
                .finally(() => {
                    if (!cancelled) setImageSkillsLoading(false);
                });
        };
        refresh();
        window.addEventListener(SKILL_LIBRARY_UPDATED_EVENT, refresh);
        return () => {
            cancelled = true;
            window.removeEventListener(SKILL_LIBRARY_UPDATED_EVENT, refresh);
        };
    }, []);

    useEffect(() => {
        if (!command || command.type !== "skill") {
            setLibraryPrompts([]);
            setPromptsLoading(false);
            return;
        }
        const controller = new AbortController();
        setPromptsLoading(true);
        const timer = window.setTimeout(() => {
            void listPromptLibrary({ type: "", search: command.query, limit: 8, signal: controller.signal })
                .then((data) => {
                    if (!controller.signal.aborted) setLibraryPrompts(Array.isArray(data?.items) ? data.items : []);
                })
                .catch(() => {
                    if (!controller.signal.aborted) setLibraryPrompts([]);
                })
                .finally(() => {
                    if (!controller.signal.aborted) setPromptsLoading(false);
                });
        }, 300);
        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [command]);

    useLayoutEffect(() => {
        const editor = textareaRef.current;
        if (!editor) return;
        editor.style.height = "0px";
        editor.style.height = `${Math.max(MIN_EDITOR_HEIGHT, Math.min(editor.scrollHeight, MAX_EDITOR_HEIGHT))}px`;
    }, [value]);

    const closeCommand = () => {
        setCommand(null);
        setActiveIndex(0);
    };

    const replaceBeforeCaret = (length: number, insert: string) => {
        const editor = textareaRef.current;
        if (!editor) return "";
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const from = Math.max(0, start - length);
        const next = `${value.slice(0, from)}${insert}${value.slice(end)}`;
        const caret = from + insert.length;
        onChange(next);
        requestAnimationFrame(() => {
            editor.focus();
            editor.setSelectionRange(caret, caret);
        });
        return next;
    };

    const syncCommand = (text = value, caret = textareaRef.current?.selectionStart ?? value.length) => {
        const before = text.slice(0, caret);
        const match = /(^|[^A-Za-z0-9_@/])([/@])([^\s/@]*)$/.exec(before);
        if (!match) return closeCommand();
        const type = match[2] === "/" ? "skill" : "resource";
        setCommand({ type, query: match[3] || "", length: (match[3] || "").length + 1 });
        setActiveIndex(0);
        if (type === "skill") {
            const agent = useAgentStore.getState();
            const skillState = useAgentSkillStore.getState();
            if (agent.connected && !skillState.loaded && !skillState.loading) void skillState.loadSkills(agent.url.trim().replace(/\/$/, ""), agent.token);
            return;
        }
        const snapshot = useAgentStore.getState().canvasContext?.snapshot;
        const references = buildCanvasResourceReferences(snapshot?.nodes || []);
        const selectedIds = new Set(snapshot?.selectedNodeIds || []);
        setResourceCandidates([...references.filter((item) => selectedIds.has(item.nodeId)), ...references.filter((item) => !selectedIds.has(item.nodeId))]);
    };

    const syncMetadata = (text: string) => {
        const state = useAgentStore.getState();
        const references = state.canvasReferences.filter((item) => text.includes(agentReferenceMarker(item)));
        if (references.length !== state.canvasReferences.length) state.setAgentState({ canvasReferences: references });
        const selectedSkill = useAgentSkillStore.getState().selectedSkill;
        if (selectedSkill && !text.includes(agentSkillMarker(selectedSkill))) useAgentSkillStore.getState().clearSelection();
    };

    const handleChange = (next: string, caret?: number) => {
        onChange(next);
        syncMetadata(next);
        syncCommand(next, caret ?? textareaRef.current?.selectionStart ?? next.length);
    };

    const insertCandidate = (candidate: ComposerCandidate) => {
        if (!command) return;
        if (candidate.type === "skill") {
            const remaining = value.replace(agentSkillMarker({ name: candidate.skill.name }), "");
            const defaultPrompt = candidate.skill.interface?.defaultPrompt?.trim();
            if (!remaining.replace(command.query ? `/${command.query}` : "/", "").trim() && defaultPrompt) {
                replaceBeforeCaret(command.length, "");
                useAgentSkillStore.getState().selectSkill(candidate.skill);
                closeCommand();
                return;
            }
            replaceBeforeCaret(command.length, `${agentSkillMarker({ name: candidate.skill.name })} `);
            useAgentSkillStore.getState().selectSkill(candidate.skill);
        } else if (candidate.type === "imageSkill") {
            void skillMentionToken(candidate.skill).then((token) => {
                replaceBeforeCaret(command.length, `${token} `);
                closeCommand();
            });
            return;
        } else if (candidate.type === "prompt") {
            const body = candidate.prompt.prompt.trim();
            replaceBeforeCaret(command.length, body.endsWith(" ") ? body : `${body} `);
        } else {
            const current = useAgentStore.getState().canvasReferences;
            if (!current.some((item) => item.nodeId === candidate.reference.nodeId)) useAgentStore.getState().setAgentState({ canvasReferences: [...current, candidate.reference] });
            replaceBeforeCaret(command.length, `${agentReferenceMarker(candidate.reference)} `);
        }
        closeCommand();
    };

    const handleCommandKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (!command || isImeComposing(event)) return false;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (candidates.length) setActiveIndex((index) => (index + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) % candidates.length);
            return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
            event.preventDefault();
            if (candidates.length) insertCandidate(candidates[Math.min(activeIndex, candidates.length - 1)]);
            return true;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            closeCommand();
            return true;
        }
        return false;
    };

    return (
        <div className="relative">
            <textarea
                ref={textareaRef}
                value={value}
                disabled={disabled}
                rows={1}
                placeholder={placeholder}
                aria-label={placeholder}
                data-canvas-shortcuts-ignore
                className="thin-scrollbar w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-sm leading-6 outline-none placeholder:text-[color:var(--placeholder)]"
                style={{
                    minHeight: MIN_EDITOR_HEIGHT,
                    maxHeight: MAX_EDITOR_HEIGHT,
                    color: theme.node.text,
                    "--placeholder": theme.node.placeholder,
                } as CSSProperties}
                onChange={(event) => handleChange(event.target.value, event.target.selectionStart)}
                onPaste={(event) => {
                    const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                    if (!images.length || !onAddFiles) return;
                    event.preventDefault();
                    void onAddFiles(images);
                }}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (isImeComposing(event) || handleCommandKey(event)) return;
                    if (isPlainEnterKey(event)) {
                        event.preventDefault();
                        onSubmit();
                    }
                }}
                onKeyUp={(event) => {
                    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) syncCommand();
                }}
                onClick={() => syncCommand()}
                onBlur={(event) => {
                    if (event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("[data-agent-command-menu]")) return;
                    window.setTimeout(closeCommand, 120);
                }}
            />
            {command ? <AgentCommandMenu command={command} candidates={candidates} activeIndex={Math.min(activeIndex, Math.max(candidates.length - 1, 0))} loading={command.type === "skill" ? skillsLoading || promptsLoading : imageSkillsLoading && !resourceCandidates.length} theme={theme} onSelect={insertCandidate} /> : null}
        </div>
    );
}

function AgentCommandMenu({ command, candidates, activeIndex, loading, theme, onSelect }: { command: ComposerCommand; candidates: ComposerCandidate[]; activeIndex: number; loading: boolean; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onSelect: (candidate: ComposerCandidate) => void }) {
    const { t } = useTranslation();
    const activeItemRef = useRef<HTMLButtonElement | null>(null);
    useEffect(() => { activeItemRef.current?.scrollIntoView({ block: "nearest" }); }, [activeIndex]);
    const stopPropagation = (event: PointerEvent | MouseEvent) => event.stopPropagation();
    return (
        <div data-agent-command-menu className="absolute bottom-[calc(100%+8px)] left-0 z-[120] w-full min-w-64 overflow-hidden rounded-xl border shadow-xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }} onPointerDown={stopPropagation} onMouseDown={stopPropagation}>
            <div className="border-b px-3 py-2 text-xs" style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                {t(command.type === "skill" ? "agent.composer.mentions.selectSkill" : "agent.composer.mentions.selectResource")}{command.query ? ` · ${command.query}` : ""}
            </div>
            <div className="thin-scrollbar max-h-[min(21rem,52vh)] overflow-y-auto p-1">
                {candidates.length ? candidates.map((candidate, index) => {
                    const groupKey = candidate.type === "imageSkill" ? "agent.composer.mentions.imageSkills" : candidate.type === "prompt" ? "agent.composer.mentions.prompts" : "";
                    const prev = candidates[index - 1];
                    const prevGroup = prev?.type === "imageSkill" ? "agent.composer.mentions.imageSkills" : prev?.type === "prompt" ? "agent.composer.mentions.prompts" : "";
                    const skill = candidate.type === "skill" ? candidate.skill : null;
                    const imageSkill = candidate.type === "imageSkill" ? candidate.skill : null;
                    const prompt = candidate.type === "prompt" ? candidate.prompt : null;
                    const reference = candidate.type === "resource" ? candidate.reference : null;
                    const title = imageSkill?.name || prompt?.title || (skill ? skill.interface?.displayName || skill.name : reference?.title || "");
                    const description = imageSkill?.description || prompt?.prompt || (skill ? skill.interface?.shortDescription || skill.shortDescription || skill.description : reference ? `${agentReferenceMarker(reference)} · ${canvasReferenceKindLabel(reference.kind)}` : "");
                    const key = imageSkill?.id || prompt?.id || (skill ? `${skill.name}:${skill.path}` : reference?.nodeId);
                    return (
                        <Fragment key={key}>
                            {groupKey && groupKey !== prevGroup ? <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: theme.node.muted }}>{t(groupKey)}</div> : null}
                            <button ref={index === activeIndex ? activeItemRef : undefined} type="button" className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-black/5 dark:hover:bg-white/10" style={{ background: index === activeIndex ? theme.toolbar.activeBg : undefined, color: index === activeIndex ? theme.toolbar.activeText : theme.node.text }} onPointerDown={(event) => { event.preventDefault(); onSelect(candidate); }}>
                                {skill || imageSkill || prompt ? <span className="grid size-9 shrink-0 place-items-center"><Sparkles className="size-4" /></span> : reference ? <ReferencePreview reference={reference} /> : null}
                                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{title}</span><span className="mt-0.5 block truncate text-xs" style={{ color: theme.node.muted }}>{description}</span></span>
                            </button>
                        </Fragment>
                    );
                }) : <div className="px-3 py-6 text-center text-xs" style={{ color: theme.node.muted }}>{t(loading ? "agent.composer.mentions.loadingSkills" : command.type === "skill" ? "agent.composer.mentions.noSkills" : "agent.composer.mentions.noResources")}</div>}
            </div>
        </div>
    );
}

function ReferencePreview({ reference }: { reference: CanvasResourceReference }) {
    if (reference.kind === "image" && reference.previewUrl) return <img src={reference.previewUrl} alt="" className="size-9 rounded-md object-cover" />;
    const Icon = canvasReferenceIcon(reference.kind);
    return <span className="grid size-9 shrink-0 place-items-center"><Icon className="size-4" /></span>;
}
