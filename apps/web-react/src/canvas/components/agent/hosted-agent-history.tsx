import { History, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentThreadSummary } from "@/stores/use-agent-store";

export function HostedAgentHistory({
    theme,
    threads,
    activeThreadId,
    loading,
    busy,
    emptyText,
    onResumeThread,
    onDeleteThread,
}: {
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    threads: AgentThreadSummary[];
    activeThreadId: string;
    loading: boolean;
    busy: boolean;
    emptyText: string;
    onResumeThread: (threadId: string) => void;
    onDeleteThread: (threadId: string) => void;
}) {
    const { i18n, t } = useTranslation();
    const canOpen = !loading && !busy;

    if (!threads.length) {
        return (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
                <span
                    className="grid size-12 place-items-center rounded-2xl"
                    style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText, boxShadow: `inset 0 0 0 1px ${theme.sidebar.border}` }}
                >
                    <History className="size-5" />
                </span>
                <p className="mt-4 max-w-[240px] text-[13px] leading-5" style={{ color: theme.node.muted }}>
                    {emptyText}
                </p>
            </div>
        );
    }

    return (
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <div className="flex flex-col gap-1">
                {threads.map((thread) => {
                    const active = thread.id === activeThreadId;
                    const title = thread.preview || thread.name || t("agent.history.untitled");
                    return (
                        <div
                            key={thread.id}
                            role="button"
                            tabIndex={canOpen ? 0 : -1}
                            aria-current={active ? "true" : undefined}
                            aria-disabled={!canOpen}
                            className={`group flex w-full items-start gap-2 rounded-2xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current/15 ${active || !canOpen ? "" : "hover:bg-black/5 dark:hover:bg-white/10"}`}
                            style={{
                                background: active ? theme.toolbar.activeBg : undefined,
                                color: theme.node.text,
                                opacity: canOpen ? 1 : 0.6,
                                cursor: canOpen ? "pointer" : "default",
                            }}
                            onClick={() => {
                                if (canOpen) onResumeThread(thread.id);
                            }}
                            onKeyDown={(event) => {
                                if (!canOpen || (event.key !== "Enter" && event.key !== " ")) return;
                                event.preventDefault();
                                onResumeThread(thread.id);
                            }}
                        >
                            <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-1.5">
                                    <div className="min-w-0 truncate text-[13px] font-medium leading-5">{title}</div>
                                    {active ? (
                                        <span
                                            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none"
                                            style={{ background: theme.toolbar.panel, color: theme.toolbar.activeText, boxShadow: `inset 0 0 0 1px ${theme.sidebar.border}` }}
                                        >
                                            {t("agent.history.current")}
                                        </span>
                                    ) : null}
                                </div>
                                <div className="mt-0.5 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                                    {formatHistoryTime(thread.updatedAt || thread.createdAt, i18n.language, t)}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                                style={{ color: theme.node.muted }}
                                aria-label={t("agent.hosted.deleteChat")}
                                disabled={busy}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteThread(thread.id);
                                }}
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function formatHistoryTime(value: number | undefined, locale: string, t: ReturnType<typeof useTranslation>["t"]) {
    if (!value) return "";
    const date = new Date(value * 1000);
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return t("agent.hosted.justNow");
    if (diff < 3_600_000) return t("agent.hosted.minutesAgo", { count: Math.max(1, Math.floor(diff / 60_000)) });
    const today = new Date();
    const sameDay = date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
    if (sameDay) return date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate()) {
        return t("agent.hosted.yesterday");
    }
    return date.toLocaleDateString(locale, { month: "numeric", day: "numeric" });
}
