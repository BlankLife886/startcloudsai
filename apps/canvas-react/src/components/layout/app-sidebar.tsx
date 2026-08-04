import { useEffect, useRef } from "react";
import { Bot, House, Settings2 } from "lucide-react";
import { Tooltip } from "antd";
import { Link, useLocation } from "react-router";

import { AppConfigModal } from "@/components/layout/app-config-modal";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

const primaryNavigationTools = navigationTools.filter((tool) => tool.slug !== "config");
const railItemClass =
    "flex size-9 shrink-0 items-center justify-center rounded-full !text-stone-500 transition hover:bg-white/70 hover:!text-stone-950 hover:shadow-[inset_0_1px_0_rgba(255,255,255,.9),0_2px_8px_rgba(28,25,23,.08)] dark:!text-stone-300 dark:hover:bg-white/10 dark:hover:!text-white dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,.12)]";
const railItemActiveClass = "!text-violet-600 dark:!text-violet-400";
const railDividerClass = "my-1 h-px w-7 shrink-0 bg-stone-200 dark:bg-white/10";

export function AppSidebar() {
    const { pathname } = useLocation();
    const autoConnectRef = useRef(false);
    const agentToken = useAgentStore((state) => state.token);
    const agentEnabled = useAgentStore((state) => state.enabled);
    const agentConnected = useAgentStore((state) => state.connected);
    const connectAgent = useAgentStore((state) => state.connectAgent);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;

    useEffect(() => {
        if (autoConnectRef.current || agentEnabled || agentConnected || !agentToken.trim()) return;
        autoConnectRef.current = true;
        connectAgent({ silent: true });
    }, [agentConnected, agentEnabled, agentToken, connectAgent]);

    return (
        <>
            <aside className="canvas-floating-sidebar z-[75] flex w-12 flex-col items-center rounded-[24px] p-1 text-stone-600 dark:text-stone-300" aria-label="画布功能导航">
                <Tooltip title="画布首页" placement="right" mouseEnterDelay={0.25}>
                    <Link to="/" className={cn(railItemClass, pathname === "/" && railItemActiveClass)} aria-current={pathname === "/" ? "page" : undefined} aria-label="画布首页">
                        <House className="size-[17px]" aria-hidden="true" />
                    </Link>
                </Tooltip>

                <div className={railDividerClass} aria-hidden="true" />

                <nav className="flex w-full flex-col items-center gap-1" aria-label="业务功能">
                    {primaryNavigationTools.map((tool) => {
                        const Icon = tool.icon;
                        const active = tool.slug === activeToolSlug;
                        return (
                            <Tooltip key={tool.slug} title={tool.label} placement="right" mouseEnterDelay={0.25}>
                                <Link to={`/${tool.slug}`} className={cn(railItemClass, active && railItemActiveClass)} aria-current={active ? "page" : undefined} aria-label={tool.label}>
                                    <Icon className="size-[17px]" aria-hidden="true" />
                                </Link>
                            </Tooltip>
                        );
                    })}
                </nav>

                <div className={railDividerClass} aria-hidden="true" />

                <Tooltip title={panelOpen ? "收起智能助手" : "打开智能助手"} placement="right" mouseEnterDelay={0.25}>
                    <button type="button" className={cn(railItemClass, "relative", panelOpen && railItemActiveClass)} onClick={togglePanel} aria-pressed={panelOpen} aria-label={panelOpen ? "收起智能助手" : "打开智能助手"}>
                        <Bot className="size-[17px]" aria-hidden="true" />
                        {agentConnected ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-emerald-500" title="已连接" /> : null}
                    </button>
                </Tooltip>

                <div className={railDividerClass} aria-hidden="true" />

                <Tooltip title="配置页面" placement="right" mouseEnterDelay={0.25}>
                    <Link to="/config" className={cn(railItemClass, activeToolSlug === "config" && railItemActiveClass)} aria-current={activeToolSlug === "config" ? "page" : undefined} aria-label="配置页面">
                        <Settings2 className="size-[17px]" aria-hidden="true" />
                    </Link>
                </Tooltip>

                <div className={railDividerClass} aria-hidden="true" />

                <UserStatusActions variant="rail" />
            </aside>
            <AppConfigModal />
        </>
    );
}
