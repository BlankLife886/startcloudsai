import { BookOpen, FileText, LoaderCircle, Search } from "lucide-react";
import { type ReactNode, type UIEvent, useEffect, useState } from "react";
import { App, Modal } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { CanvasIconWellStyle } from "@/lib/canvas-ui";
import { ALL_PROMPTS_OPTION, type Prompt } from "@/services/api/prompts";
import { useThemeStore } from "@/stores/use-theme-store";
import { usePromptList } from "./use-prompt-list";

export function PromptSelectDialog({ open, onOpenChange, onSelect }: { open: boolean; onOpenChange: (open: boolean) => void; onSelect: (prompt: string) => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [keyword, setKeyword] = useState("");
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [selectedCategory, setSelectedCategory] = useState(ALL_PROMPTS_OPTION);
    const { query, items, tags: promptTags, categories: promptCategories, total } = usePromptList({ keyword, tags: selectedTags, category: selectedCategory, enabled: open });

    useEffect(() => {
        if (!open) {
            setKeyword("");
            setSelectedTags([]);
            setSelectedCategory(ALL_PROMPTS_OPTION);
        }
    }, [open]);

    useEffect(() => {
        if (query.isError) message.error(query.error instanceof Error ? query.error.message : t("canvas.promptLibrary.loadFailed"));
    }, [message, query.error, query.isError, t]);

    const toggleTag = (tag: string) => {
        if (tag === ALL_PROMPTS_OPTION) return setSelectedTags([]);
        setSelectedTags((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]));
    };

    const selectPrompt = (prompt: string) => {
        onSelect(prompt);
        onOpenChange(false);
    };

    const handleListScroll = (event: UIEvent<HTMLDivElement>) => {
        const target = event.currentTarget;
        if (query.hasNextPage && !query.isFetchingNextPage && target.scrollTop + target.clientHeight >= target.scrollHeight - 160) void query.fetchNextPage();
    };

    return (
        <Modal className="canvas-prompt-library-modal" title={null} open={open} centered width={920} footer={null} destroyOnHidden onCancel={() => onOpenChange(false)}>
            <div data-canvas-no-zoom data-canvas-shortcuts-ignore onWheelCapture={(event) => event.stopPropagation()}>
                <div className="mb-4 flex items-center gap-3 pr-10">
                    <span className="grid size-10 shrink-0 place-items-center rounded-[12px]" style={CanvasIconWellStyle("#6d5cff")}>
                        <BookOpen className="size-4" />
                    </span>
                    <div className="min-w-0 text-[16px] font-semibold tracking-[-0.02em]" style={{ color: theme.node.text }}>
                        {t("canvas.promptLibrary.title")}
                    </div>
                </div>

                <label className="flex h-10 items-center gap-2 rounded-[14px] px-3" style={{ background: theme.toolbar.itemHover }}>
                    <Search className="size-3.5 shrink-0" style={{ color: theme.node.faint }} />
                    <input
                        value={keyword}
                        onChange={(event) => setKeyword(event.target.value)}
                        placeholder={t("canvas.promptLibrary.search")}
                        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
                        style={{ color: theme.node.text }}
                    />
                    {total > 0 ? (
                        <span className="shrink-0 text-[11px] font-medium" style={{ color: theme.node.faint }}>
                            {t("canvas.promptLibrary.total", { count: total })}
                        </span>
                    ) : null}
                </label>

                <div className="mt-3 space-y-2.5">
                    <FilterRow label={t("canvas.promptLibrary.category")} theme={theme}>
                        {promptCategories.map((category) => (
                            <FilterChip key={category.value} label={category.label} active={selectedCategory === category.value} onClick={() => setSelectedCategory(category.value)} />
                        ))}
                    </FilterRow>
                    <FilterRow label={t("canvas.promptLibrary.tag")} theme={theme}>
                        {promptTags.map((tag) => {
                            const active = tag === ALL_PROMPTS_OPTION ? selectedTags.length === 0 : selectedTags.includes(tag);
                            return <FilterChip key={tag} label={tag} active={active} onClick={() => toggleTag(tag)} />;
                        })}
                    </FilterRow>
                </div>

                <div className="canvas-prompt-library-modal__list thin-scrollbar mt-4" onScroll={handleListScroll} onWheelCapture={(event) => event.stopPropagation()}>
                    {query.isLoading ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {Array.from({ length: 6 }, (_, index) => (
                                <div key={index} className="canvas-prompt-pick-card canvas-prompt-pick-card--skeleton" style={{ background: theme.toolbar.itemHover }} />
                            ))}
                        </div>
                    ) : query.isError ? (
                        <button type="button" className="block w-full py-10 text-center text-[12px]" style={{ color: "#ef4444" }} onClick={() => void query.refetch()}>
                            {t("canvas.sidePanel.loadFailedRetry")}
                        </button>
                    ) : items.length ? (
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {items.map((item) => (
                                <PromptPickCard key={item.id} item={item} theme={theme} useLabel={t("canvas.promptLibrary.use")} onSelect={() => selectPrompt(item.prompt)} />
                            ))}
                        </div>
                    ) : (
                        <div className="canvas-empty py-12">
                            <span className="canvas-empty__icon" style={CanvasIconWellStyle("#6d5cff")}>
                                <FileText className="size-5" />
                            </span>
                            <div className="canvas-empty__title" style={{ color: theme.node.text }}>
                                {t("canvas.promptLibrary.empty")}
                            </div>
                            <div className="canvas-empty__hint" style={{ color: theme.node.muted }}>
                                {t("canvas.promptLibrary.emptyHint")}
                            </div>
                        </div>
                    )}
                    {query.isFetchingNextPage ? (
                        <div className="flex justify-center py-4" style={{ color: theme.node.muted }}>
                            <LoaderCircle className="size-4 animate-spin" />
                        </div>
                    ) : null}
                </div>
            </div>
        </Modal>
    );
}

function FilterRow({ label, theme, children }: { label: string; theme: CanvasTheme; children: ReactNode }) {
    return (
        <div className="flex items-start gap-2.5">
            <div className="shrink-0 pt-1.5 text-[11px] font-semibold tracking-[0.04em]" style={{ color: theme.node.faint }}>
                {label}
            </div>
            <div className="canvas-prompt-library-modal__filters flex min-w-0 flex-1 flex-wrap gap-1.5">{children}</div>
        </div>
    );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
    return (
        <button type="button" className={`canvas-prompt-filter-chip${active ? " is-active" : ""}`} onClick={onClick}>
            {label}
        </button>
    );
}

function PromptPickCard({ item, theme, useLabel, onSelect }: { item: Prompt; theme: CanvasTheme; useLabel: string; onSelect: () => void }) {
    const excerpt = item.description || item.prompt;

    return (
        <button type="button" className="canvas-prompt-pick-card" style={{ background: theme.node.panel, borderColor: theme.node.stroke }} onClick={onSelect}>
            <div className="canvas-prompt-pick-card__cover" style={{ background: theme.toolbar.itemHover }}>
                {item.coverUrl ? (
                    <img src={item.coverUrl} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                    <span className="grid size-full place-items-center" style={CanvasIconWellStyle("#6d5cff", 0.1)}>
                        <FileText className="size-6" />
                    </span>
                )}
                <span className="canvas-prompt-pick-card__use">{useLabel}</span>
            </div>
            <div className="min-w-0 px-3 pb-3 pt-2.5">
                <div className="truncate text-[13px] font-semibold tracking-[-0.01em]" style={{ color: theme.node.text }}>
                    {item.title}
                </div>
                {excerpt ? (
                    <p className="mt-1 line-clamp-2 text-[12px] leading-5" style={{ color: theme.node.muted }}>
                        {excerpt}
                    </p>
                ) : null}
                {item.tags.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                        {item.tags.slice(0, 3).map((tag) => (
                            <span key={tag} className="max-w-full truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                                {tag}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </button>
    );
}
