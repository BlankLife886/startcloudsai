import { lazy, Suspense } from "react";
import type { CSSProperties } from "react";
import { BadgeInfo } from "lucide-react";

import { APP_VERSION } from "@/constant/env";
import { useVersionCheck } from "@/hooks/use-version-check";

const VersionReleaseModal = lazy(() => import("@/components/layout/version-release-modal").then((module) => ({ default: module.VersionReleaseModal })));

type VersionReleaseTriggerProps = {
    className?: string;
    style?: CSSProperties;
    iconOnly?: boolean;
};

export function VersionReleaseTrigger({ className, style, iconOnly = false }: VersionReleaseTriggerProps) {
    const { open, setOpen, openReleaseModal, latestVersion, releases, checking, hasNewVersion, checkLatestRelease } = useVersionCheck();

    return (
        <>
            <button
                type="button"
                className={className || "shrink-0 cursor-pointer text-xs font-medium text-stone-500 transition hover:text-stone-950 dark:text-stone-400 dark:hover:text-white"}
                style={style}
                onClick={openReleaseModal}
                aria-label={iconOnly ? `版本更新 ${APP_VERSION}` : undefined}
                title={`查看版本更新 ${APP_VERSION}`}
            >
                <span className="relative inline-flex">
                    {iconOnly ? <BadgeInfo className="size-4" aria-hidden="true" /> : APP_VERSION}
                    {hasNewVersion ? <span className="absolute -right-1.5 -top-1 size-1.5 rounded-full bg-green-500" /> : null}
                </span>
            </button>
            {open ? (
                <Suspense fallback={null}>
                    <VersionReleaseModal open={open} onClose={() => setOpen(false)} currentVersion={APP_VERSION} latestVersion={latestVersion} releases={releases} checking={checking} checkLatestRelease={checkLatestRelease} />
                </Suspense>
            ) : null}
        </>
    );
}
