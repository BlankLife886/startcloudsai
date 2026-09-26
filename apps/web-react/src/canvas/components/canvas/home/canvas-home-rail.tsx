import { FolderKanban, House, LogIn, Search, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

export type CanvasHomeRailTarget = "home" | "library" | "templates" | "search";

type RailProps = {
    active: CanvasHomeRailTarget;
    projectCount: number;
    templateCount: number;
    quota: { used: number; limit: number; planBonus: number; base: number } | null;
    isAuthenticated: boolean;
    onLogin: () => void;
    onNavigate: (target: CanvasHomeRailTarget) => void;
};

const RING = 2 * Math.PI * 15;

export function CanvasHomeRail({ active, projectCount, templateCount, quota, isAuthenticated, onLogin, onNavigate }: RailProps) {
    const { t } = useTranslation();
    const items: { key: CanvasHomeRailTarget; label: string; hint: string; icon: typeof House }[] = [
        { key: "home", label: t("canvas.homePage.rail.launchpad"), hint: "", icon: House },
        { key: "library", label: t("canvas.homePage.rail.library"), hint: String(projectCount), icon: FolderKanban },
        { key: "templates", label: t("canvas.homePage.rail.templates"), hint: templateCount ? String(templateCount) : "", icon: Sparkles },
        { key: "search", label: t("canvas.homePage.rail.search"), hint: "⌘K", icon: Search },
    ];
    const ratio = quota ? Math.min(1, quota.used / Math.max(quota.limit, 1)) : 0;
    const full = Boolean(quota && quota.used >= quota.limit);
    return (
        <nav className="ch-rail" aria-label={t("canvas.homePage.rail.nav")}>
            <div className="ch-rail__panel">
                {items.map(({ key, label, hint, icon: Icon }) => [
                    key === "search" ? <span key="divider" className="ch-rail__divider" aria-hidden="true" /> : null,
                    <button key={key} type="button" className="ch-rail__item" aria-current={active === key ? "page" : undefined} aria-label={label} title={label} onClick={() => onNavigate(key)}>
                        <Icon className="size-5 shrink-0" strokeWidth={1.8} />
                        <span className="ch-rail__label flex-1">{label}</span>
                        {hint ? (
                            <span className="ch-rail__label ch-num text-[11px]" style={{ color: "var(--ch-faint)" }}>
                                {hint}
                            </span>
                        ) : null}
                    </button>,
                ])}
                {isAuthenticated ? (
                    <div className="ch-rail__quota" title={quota && quota.planBonus > 0 ? t("canvas.homePage.rail.quotaBonus", { base: quota.base, bonus: quota.planBonus }) : undefined}>
                        <span className="relative size-9 shrink-0">
                            <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true" style={{ transform: "rotate(-90deg)" }}>
                                <defs>
                                    <linearGradient id="ch-quota-ring" x1="0" y1="0" x2="1" y2="1">
                                        <stop offset="0" stopColor="#9b7bff" />
                                        <stop offset="1" stopColor="#3dd6f5" />
                                    </linearGradient>
                                </defs>
                                <circle cx="18" cy="18" r="15" fill="none" stroke="var(--ch-line)" strokeWidth="3" />
                                <circle
                                    cx="18"
                                    cy="18"
                                    r="15"
                                    fill="none"
                                    stroke={full ? "#e5484d" : "url(#ch-quota-ring)"}
                                    strokeWidth="3"
                                    strokeLinecap="round"
                                    strokeDasharray={`${(RING * ratio).toFixed(1)} ${RING.toFixed(1)}`}
                                    style={{ transition: "stroke-dasharray .6s cubic-bezier(.2,.8,.2,1)" }}
                                />
                            </svg>
                            <span className="ch-num absolute inset-0 grid place-items-center text-[10px] font-bold">{quota ? quota.used : "—"}</span>
                        </span>
                        <span className="ch-rail__label flex flex-col gap-0.5">
                            <span className="ch-num text-xs font-semibold">{quota ? t("canvas.homePage.rail.quota", { used: quota.used, limit: quota.limit }) : t("canvas.homePage.rail.quotaTitle")}</span>
                            <span className="text-[11px]" style={{ color: full ? "#e5484d" : "var(--ch-muted)" }}>
                                {!quota ? t("canvas.homePage.rail.quotaLoading") : full ? t("canvas.homePage.rail.quotaFull") : t("canvas.homePage.rail.quotaLeft", { count: quota.limit - quota.used })}
                            </span>
                        </span>
                    </div>
                ) : (
                    <button type="button" className="ch-rail__quota ch-rail__login" onClick={onLogin} aria-label={t("canvas.homePage.rail.login")}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-full" style={{ background: "var(--ch-accent-soft)", color: "var(--ch-accent-text)" }}>
                            <LogIn className="size-4" />
                        </span>
                        <span className="ch-rail__label flex flex-col gap-0.5 text-left">
                            <span className="text-xs font-semibold">{t("canvas.homePage.rail.login")}</span>
                            <span className="text-[11px]" style={{ color: "var(--ch-muted)" }}>
                                {t("canvas.homePage.rail.loginHint")}
                            </span>
                        </span>
                    </button>
                )}
            </div>
        </nav>
    );
}
