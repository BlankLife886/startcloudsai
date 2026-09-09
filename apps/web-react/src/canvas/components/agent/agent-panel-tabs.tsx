import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";

export function AgentPanelTabs<T extends string>({ value, items, theme, leading, right, onChange }: { value: T; items: { value: T; label: string; icon?: ReactNode; count?: number }[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; leading?: ReactNode; right?: ReactNode; onChange: (value: T) => void }) {
    const { t } = useTranslation();
    return (
        <div className="@container px-2" style={{ boxShadow: `inset 0 -1px 0 ${theme.node.stroke}` }}>
            <div className="flex h-12 items-center gap-1">
                {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
                <nav className="@container flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden text-sm" role="tablist" aria-label={t("agent.panel.content")}>
                    {items.map((item) => {
                        const active = value === item.value;
                        return (
                            <Tooltip key={item.value} title={`${item.label}${item.count ? ` ${item.count}` : ""}`} placement="bottom">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-label={`${item.label}${item.count ? ` ${item.count}` : ""}`}
                                    aria-selected={active}
                                    className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-full px-2.5 text-[13px] transition"
                                    style={{
                                        background: active ? theme.toolbar.activeBg : "transparent",
                                        color: active ? theme.toolbar.activeText : theme.node.muted,
                                        fontWeight: active ? 600 : 500,
                                    }}
                                    onClick={() => onChange(item.value)}
                                >
                                    {item.icon ? <span className="agent-panel-tab-icon">{item.icon}</span> : null}
                                    <span className={item.icon ? "hidden @min-[400px]:inline" : undefined}>{item.label}</span>
                                    {item.count ? <span className="text-[10px] font-normal leading-none tabular-nums opacity-60">{item.count > 99 ? "99+" : item.count}</span> : null}
                                </button>
                            </Tooltip>
                        );
                    })}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
            </div>
        </div>
    );
}
