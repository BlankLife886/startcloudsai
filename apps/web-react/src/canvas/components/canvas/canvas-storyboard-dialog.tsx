import { useEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from "react";
import { AlertCircle, Clapperboard, Download, Film, LoaderCircle, LocateFixed, RefreshCw, Sparkles, WandSparkles, X, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CanvasEditorModal, EditorGhostButton, EditorIconButton, EditorPrimaryButton } from "./canvas-editor-modal";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import {
    parseStoryboardScript,
    storyboardScenePrompt,
    storyboardStyleLabel,
    type StoryboardPlan,
    type StoryboardScene,
    type StoryboardStyle,
} from "@/lib/canvas/storyboard-parser";
import "./canvas-storyboard-dialog.css";

export type StoryboardGenerationOptions = {
    style: StoryboardStyle;
    /** Desired number of shots; parsers may return fewer when the script has fewer beats. */
    sceneCount: number;
    aspectRatio: string;
    consistency: boolean;
};

export type StoryboardProgressEvent = {
    sceneId: string;
    status: "queued" | "running" | "succeeded" | "failed" | "canceled";
    imageUrl?: string;
    error?: string;
    /** The persisted image is still useful, but no longer matches edited shot copy. */
    needsRegeneration?: boolean;
};

export type StoryboardSourceOption = {
    id: string;
    title: string;
    script: string;
};

type StoryboardDialogProps = {
    open: boolean;
    initialScript?: string;
    /** A persisted review plan to restore when reopening a storyboard group. */
    initialPlan?: StoryboardPlan | null;
    /** Progress already written to the canvas nodes for the persisted plan. */
    initialProgress?: Record<string, StoryboardProgressEvent>;
    /** Controls saved alongside the persisted plan. */
    initialOptions?: Partial<StoryboardGenerationOptions> | null;
    sourceTitle?: string;
    sourceId?: string | null;
    sourceOptions?: StoryboardSourceOption[];
    onSourceChange?: (sourceId: string) => void;
    onScriptChange?: (script: string) => void;
    /** Persist review edits to an already-created storyboard group. */
    onPlanChange?: (plan: StoryboardPlan, options: StoryboardGenerationOptions) => void;
    onFocusScene?: (sceneId: string) => void;
    onClose: () => void;
    onAnalyze?: (script: string, options: StoryboardGenerationOptions) => Promise<StoryboardPlan | null>;
    onGenerate: (
        plan: StoryboardPlan,
        script: string,
        options: StoryboardGenerationOptions,
        report: (event: StoryboardProgressEvent) => void,
    ) => Promise<void>;
    /** Retry one failed shot in-place without rebuilding the storyboard batch. */
    onRetryScene?: (
        scene: StoryboardScene,
        options: StoryboardGenerationOptions,
        report: (event: StoryboardProgressEvent) => void,
    ) => Promise<boolean>;
    onCancelGeneration?: () => void;
};

const SAMPLE_SCRIPT = "清晨的雨刚停，女孩在空荡的车站捡起一把红伞。\n她沿着湿漉漉的街道奔跑，远处的霓虹映在水面。\n咖啡馆里，男孩抬头认出了她，两人隔着玻璃对望。\n女孩推门而入，把红伞放在桌边，轻轻说了一句‘好久不见’。\n窗外天色渐暗，他们并肩走进夜色，城市灯光亮起。";

const STYLE_OPTIONS: Array<{ value: StoryboardStyle; key: string }> = [
    { value: "cinematic", key: "canvas.storyboard.styleCinematic" },
    { value: "anime", key: "canvas.storyboard.styleAnime" },
    { value: "documentary", key: "canvas.storyboard.styleDocumentary" },
    { value: "commercial", key: "canvas.storyboard.styleCommercial" },
];

const RATIO_OPTIONS = [
    { value: "16:9", label: "16:9", hintKey: "canvas.storyboard.ratioLandscape" },
    { value: "9:16", label: "9:16", hintKey: "canvas.storyboard.ratioPortrait" },
    { value: "1:1", label: "1:1", hintKey: "canvas.storyboard.ratioSquare" },
];

function statusLabel(status: StoryboardProgressEvent["status"], t: (key: string, options?: Record<string, unknown>) => string) {
    if (status === "queued") return t("canvas.storyboard.statusQueued");
    if (status === "running") return t("canvas.storyboard.statusRunning");
    if (status === "succeeded") return t("canvas.storyboard.statusSucceeded");
    if (status === "failed") return t("canvas.storyboard.statusFailed");
    return t("canvas.storyboard.statusCanceled");
}

function shotLabel(scene: StoryboardScene, t: (key: string, options?: Record<string, unknown>) => string) {
    const labels: Record<StoryboardScene["shotType"], string> = {
        wide: "canvas.storyboard.shotWide",
        full: "canvas.storyboard.shotFull",
        medium: "canvas.storyboard.shotMedium",
        close: "canvas.storyboard.shotClose",
        detail: "canvas.storyboard.shotDetail",
        over: "canvas.storyboard.shotOver",
    };
    return t(labels[scene.shotType] || labels.medium);
}

function sceneDuration(scene: StoryboardScene) {
    const value = Number(scene.durationSec);
    return Number.isFinite(value) ? Math.max(1, Math.min(30, Math.round(value))) : 4;
}

function storyboardInputKey(script: string, sceneCount: number, style: StoryboardStyle) {
    return `${script}\u0000${sceneCount}\u0000${style}`;
}

function promptWithEditedSummary(scene: StoryboardScene, summary: string, style: StoryboardStyle, globalStyle: string) {
    const marker = "画面动作：";
    const continuityMarker = "连续性锁定：";
    const currentPrompt = scene.prompt || "";
    const markerStart = currentPrompt.indexOf(marker);
    if (markerStart >= 0) {
        const actionStart = markerStart + marker.length;
        const continuityStart = currentPrompt.indexOf(continuityMarker, actionStart);
        const prefix = currentPrompt.slice(0, markerStart);
        const suffix = continuityStart >= 0 ? ` ${currentPrompt.slice(continuityStart)}` : "";
        return `${prefix}${marker}${summary.trim()}${suffix}`.trim().slice(0, 1800);
    }
    // AI providers may return a fully composed prompt without our structured
    // Chinese markers. Keep that provider-specific cinematography intact and
    // append the edited beat instead of replacing it with a generic template.
    if (currentPrompt.trim()) return `${currentPrompt.trim()} 画面动作：${summary.trim()}`.trim().slice(0, 1800);
    return storyboardScenePrompt({ ...scene, summary }, style, globalStyle).slice(0, 1800);
}

function storyboardResumeKey(plan: StoryboardPlan | null | undefined, options: Partial<StoryboardGenerationOptions> | null | undefined) {
    if (!plan) return "";
    // Do not include progress here. Progress is updated while a batch is
    // running and must not rehydrate over live callback events.
    const sceneKey = plan.scenes.map((scene) => `${scene.id}:${scene.index}:${scene.title}:${scene.prompt}`).join("\u0001");
    return [
        plan.title,
        plan.source,
        sceneKey,
        options?.style || "",
        options?.sceneCount || "",
        options?.aspectRatio || "",
        options?.consistency === undefined ? "" : String(options.consistency),
    ].join("\u0000");
}

function clampSceneCount(value: unknown, fallback: number) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.min(16, Math.max(1, Math.floor(parsed))) : fallback;
}

function isStoryboardStyle(value: unknown): value is StoryboardStyle {
    return STYLE_OPTIONS.some((option) => option.value === value);
}

function isStoryboardRatio(value: unknown): value is string {
    return RATIO_OPTIONS.some((option) => option.value === value);
}

function storyboardProgressForPlan(progress: Record<string, StoryboardProgressEvent> | undefined, plan: StoryboardPlan | null | undefined) {
    if (!progress || !plan?.scenes?.length) return {};
    const sceneIds = new Set(plan.scenes.map((scene) => scene.id));
    return Object.fromEntries(Object.entries(progress).filter(([sceneId]) => sceneIds.has(sceneId)));
}

function storyboardProgressStatusKey(progress: Record<string, StoryboardProgressEvent>) {
    return Object.keys(progress)
        .sort()
        .map((sceneId) => {
            const item = progress[sceneId];
            return [sceneId, item.status, item.error || "", item.needsRegeneration ? "stale" : "fresh"].join("\u0000");
        })
        .join("\u0001");
}

function markStoryboardProgressLocallyOwned(
    ref: MutableRefObject<{ resumeKey: string | null; blocked: boolean; baselineKey: string; lastParentKey: string }>,
    resumeKey: string | null,
    parentProgress: Record<string, StoryboardProgressEvent>,
) {
    const baselineKey = storyboardProgressStatusKey(parentProgress);
    ref.current = { resumeKey, blocked: true, baselineKey, lastParentKey: baselineKey };
}

export function CanvasStoryboardDialog({ open, initialScript = "", initialPlan, initialProgress = {}, initialOptions, sourceTitle, sourceId, sourceOptions = [], onSourceChange, onScriptChange, onPlanChange, onFocusScene, onClose, onAnalyze, onGenerate, onRetryScene, onCancelGeneration }: StoryboardDialogProps) {
    const { t } = useTranslation();
    const themeName = useThemeStore((state) => state.theme);
    const theme = canvasThemes[themeName];
    const [script, setScript] = useState(initialScript || "");
    const [style, setStyle] = useState<StoryboardStyle>("cinematic");
    const [aspectRatio, setAspectRatio] = useState("16:9");
    const [sceneCount, setSceneCount] = useState(6);
    const [consistency, setConsistency] = useState(true);
    const [plan, setPlan] = useState<StoryboardPlan>(() => ({ title: "智能分镜", globalStyle: storyboardStyleLabel("cinematic"), scenes: parseStoryboardScript(initialScript, { count: 6, style: "cinematic" }), source: "rules" }));
    const [analyzing, setAnalyzing] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [retryingSceneId, setRetryingSceneId] = useState<string | null>(null);
    const [progress, setProgress] = useState<Record<string, StoryboardProgressEvent>>({});
    const [error, setError] = useState("");
    const [focusedSceneId, setFocusedSceneId] = useState<string | null>(null);
    const planSourceRef = useRef<StoryboardPlan["source"]>("rules");
    const planInputKeyRef = useRef("");
    const planRevisionRef = useRef(0);
    const scriptRef = useRef(script);
    const openRef = useRef(false);
    const hydratedResumeKeyRef = useRef<string | null>(null);
    // Persisted progress can arrive after the dialog has opened. Keep a small
    // ownership ledger so an old canvas snapshot cannot overwrite live local
    // callbacks or repopulate results that the user intentionally invalidated.
    const persistedProgressSyncRef = useRef<{ resumeKey: string | null; blocked: boolean; baselineKey: string; lastParentKey: string }>({
        resumeKey: null,
        blocked: false,
        baselineKey: "",
        lastParentKey: "",
    });
    // The parent derives `initialPlan` from canvas nodes. When a local edit is
    // persisted, that prop echoes back on the next render. Mark the exact
    // payload we emitted so the hydration effect does not overwrite the
    // user's in-progress title/summary edit.
    const localPlanEchoKeyRef = useRef<string | null>(null);
    const planChangeTimerRef = useRef<number | null>(null);
    const pendingPlanChangeRef = useRef<{ plan: StoryboardPlan; options: StoryboardGenerationOptions } | null>(null);
    const onPlanChangeRef = useRef(onPlanChange);
    onPlanChangeRef.current = onPlanChange;
    // Keep this ref in sync during render so a parent echoing onScriptChange
    // can be distinguished from a genuinely external script replacement.
    scriptRef.current = script;

    const flushPlanChange = () => {
        if (planChangeTimerRef.current !== null) {
            window.clearTimeout(planChangeTimerRef.current);
            planChangeTimerRef.current = null;
        }
        const pending = pendingPlanChangeRef.current;
        if (!pending) return;
        pendingPlanChangeRef.current = null;
        localPlanEchoKeyRef.current = storyboardResumeKey(pending.plan, pending.options);
        onPlanChangeRef.current?.(pending.plan, pending.options);
    };

    useEffect(() => () => flushPlanChange(), []);

    useEffect(() => {
        if (!open) {
            openRef.current = false;
            hydratedResumeKeyRef.current = null;
            persistedProgressSyncRef.current = { resumeKey: null, blocked: false, baselineKey: "", lastParentKey: "" };
            return;
        }
        const nextScript = (initialScript || "").slice(0, 9000);
        const isOpening = !openRef.current;
        const externalScriptChanged = !isOpening && nextScript !== scriptRef.current;
        const nextResumeKey = storyboardResumeKey(initialPlan, initialOptions);
        const resumeChanged = Boolean(nextResumeKey) && nextResumeKey !== hydratedResumeKeyRef.current;
        openRef.current = true;
        if (resumeChanged && nextResumeKey === localPlanEchoKeyRef.current) {
            hydratedResumeKeyRef.current = nextResumeKey;
            // The plan echo is ours, but the parent may also have persisted a
            // newer scene status. Preserve the local ownership guard and only
            // move it to the echoed plan revision.
            persistedProgressSyncRef.current.resumeKey = nextResumeKey;
            localPlanEchoKeyRef.current = null;
            return;
        }
        // The parent mirrors edits through initialScript. Do not reset the
        // user's controls or AI plan for that local echo. External source
        // changes still invalidate the current plan and shot results.
        if (!isOpening && !externalScriptChanged && !resumeChanged) return;
        const restoredStyle = isStoryboardStyle(initialOptions?.style) ? initialOptions!.style : "cinematic";
        const restoredSceneCount = clampSceneCount(initialOptions?.sceneCount, initialPlan?.scenes.length || 6);
        const restoredAspectRatio = isStoryboardRatio(initialOptions?.aspectRatio) ? initialOptions!.aspectRatio : "16:9";
        const restoredConsistency = typeof initialOptions?.consistency === "boolean" ? initialOptions.consistency : true;
        const restoredPlan = initialPlan?.scenes?.length
            ? initialPlan
            : { title: "智能分镜", globalStyle: storyboardStyleLabel(restoredStyle), scenes: parseStoryboardScript(nextScript, { count: restoredSceneCount, style: restoredStyle }), source: "rules" as const };
        const restoredProgress = storyboardProgressForPlan(initialProgress, restoredPlan);
        setScript(nextScript);
        if (isOpening || externalScriptChanged || resumeChanged) {
            setStyle(restoredStyle);
            setAspectRatio(restoredAspectRatio);
            setSceneCount(restoredSceneCount);
            setConsistency(restoredConsistency);
        }
        setProgress({});
        setFocusedSceneId(null);
        planRevisionRef.current += 1;
        setRetryingSceneId(null);
        setError("");
        planSourceRef.current = restoredPlan.source || "rules";
        planInputKeyRef.current = storyboardInputKey(nextScript, restoredSceneCount, restoredStyle);
        hydratedResumeKeyRef.current = nextResumeKey || null;
        const restoredProgressKey = storyboardProgressStatusKey(restoredProgress);
        persistedProgressSyncRef.current = {
            resumeKey: nextResumeKey || null,
            blocked: false,
            baselineKey: restoredProgressKey,
            lastParentKey: restoredProgressKey,
        };
        setPlan(restoredPlan);
        setProgress(restoredProgress);
    }, [initialOptions, initialPlan, initialProgress, initialScript, open, sourceId]);

    const ruleScenes = useMemo(() => parseStoryboardScript(script, { count: sceneCount, style }), [sceneCount, script, style]);
    const ruleInputKey = useMemo(() => storyboardInputKey(script, sceneCount, style), [sceneCount, script, style]);

    useEffect(() => {
        if (!open || analyzing || generating) return;
        // An AI plan is authoritative until one of the source controls changes.
        // The previous implementation keyed this effect on `analyzing`, which
        // caused the transition back to false to immediately erase a fresh AI plan.
        // Only rebuild when the source controls actually changed. In
        // particular, transitioning `generating` back to false must not erase
        // the completed shot thumbnails and statuses.
        if (planInputKeyRef.current === ruleInputKey) return;
        planSourceRef.current = "rules";
        planInputKeyRef.current = ruleInputKey;
        planRevisionRef.current += 1;
        markStoryboardProgressLocallyOwned(
            persistedProgressSyncRef,
            hydratedResumeKeyRef.current,
            storyboardProgressForPlan(initialProgress, plan),
        );
        setProgress({});
        setPlan((current) => ({ ...current, globalStyle: storyboardStyleLabel(style), scenes: ruleScenes, source: "rules" }));
    }, [analyzing, generating, initialProgress, open, plan, ruleInputKey, ruleScenes, style]);

    const completedCount = Object.values(progress).filter((item) => item.status === "succeeded").length;
    const needsRegenerationCount = Object.values(progress).filter((item) => item.status === "succeeded" && item.needsRegeneration).length;
    const failedCount = Object.values(progress).filter((item) => item.status === "failed").length;
    const canceledCount = Object.values(progress).filter((item) => item.status === "canceled").length;
    const runningCount = Object.values(progress).filter((item) => item.status === "running").length;
    const queuedCount = Object.values(progress).filter((item) => item.status === "queued").length;
    const totalScenes = plan.scenes.length;
    const totalDurationSec = plan.scenes.reduce((total, scene) => total + sceneDuration(scene), 0);
    const allScenesSucceeded = totalScenes > 0 && completedCount === totalScenes && needsRegenerationCount === 0;
    const freshCompletedCount = Math.max(0, completedCount - needsRegenerationCount);
    const progressPercent = totalScenes ? Math.min(100, Math.round((freshCompletedCount / totalScenes) * 100)) : 0;
    // A reopened storyboard has no local controller, but queued/running scene
    // metadata still represents an active batch and must keep the same guard.
    const hasActiveGeneration = generating || queuedCount > 0 || runningCount > 0;
    const activeStage = hasActiveGeneration || allScenesSucceeded ? 3 : totalScenes ? 2 : 1;
    const showProgressPanel = Boolean(error || hasActiveGeneration || completedCount || needsRegenerationCount || failedCount || canceledCount);
    const inputEmpty = !script.trim();
    const interactionLocked = analyzing || hasActiveGeneration || retryingSceneId !== null;
    const invalidateAllProgress = () => {
        flushPlanChange();
        planRevisionRef.current += 1;
        markStoryboardProgressLocallyOwned(
            persistedProgressSyncRef,
            hydratedResumeKeyRef.current,
            storyboardProgressForPlan(initialProgress, plan),
        );
        setProgress({});
    };

    useEffect(() => {
        if (!open || analyzing || generating || retryingSceneId !== null) return;
        const nextResumeKey = storyboardResumeKey(initialPlan, initialOptions);
        if (!nextResumeKey || hydratedResumeKeyRef.current !== nextResumeKey) return;
        const persisted = storyboardProgressForPlan(initialProgress, plan);
        const persistedKey = storyboardProgressStatusKey(persisted);
        const sync = persistedProgressSyncRef.current;
        if (sync.resumeKey !== nextResumeKey) return;
        if (sync.blocked) {
            // While local edits/generation own the dialog, wait for a parent
            // snapshot that actually moved past the pre-operation baseline.
            // This prevents an unchanged success snapshot from undoing an
            // explicit invalidateAllProgress() call.
            if (persistedKey === sync.baselineKey) return;
            sync.blocked = false;
        }
        if (sync.lastParentKey === persistedKey) return;
        sync.lastParentKey = persistedKey;
        setProgress((current) => {
            const next = { ...current };
            Object.entries(persisted).forEach(([sceneId, item]) => {
                const previous = next[sceneId];
                next[sceneId] = {
                    ...previous,
                    ...item,
                    ...(item.imageUrl || previous?.imageUrl ? { imageUrl: item.imageUrl || previous?.imageUrl } : {}),
                };
            });
            return storyboardProgressStatusKey(current) === storyboardProgressStatusKey(next) && Object.keys(current).length === Object.keys(next).length ? current : next;
        });
    }, [analyzing, generating, initialOptions, initialPlan, initialProgress, open, plan, retryingSceneId]);

    const focusScene = (sceneId: string) => {
        setFocusedSceneId(sceneId);
        onFocusScene?.(sceneId);
    };

    const handleAnalyze = async () => {
        if (inputEmpty || analyzing || hasActiveGeneration || retryingSceneId) return;
        const analysisRevision = ++planRevisionRef.current;
        setAnalyzing(true);
        setError("");
        markStoryboardProgressLocallyOwned(
            persistedProgressSyncRef,
            hydratedResumeKeyRef.current,
            storyboardProgressForPlan(initialProgress, plan),
        );
        setProgress({});
        const inputKey = ruleInputKey;
        try {
            const analyzed = await onAnalyze?.(script, { style, sceneCount, aspectRatio, consistency });
            if (planRevisionRef.current !== analysisRevision) return;
            if (analyzed?.scenes?.length) {
                planSourceRef.current = "ai";
                planInputKeyRef.current = inputKey;
                setPlan(analyzed);
            } else {
                planSourceRef.current = "rules";
                planInputKeyRef.current = inputKey;
                setPlan((current) => current.source === "ai" ? current : { title: "智能分镜", globalStyle: storyboardStyleLabel(style), scenes: ruleScenes, source: "rules" });
            }
        } catch (reason) {
            if (planRevisionRef.current !== analysisRevision) return;
            setError(reason instanceof Error ? reason.message : t("canvas.storyboard.analysisFallback"));
            planSourceRef.current = plan.source === "ai" ? "ai" : "rules";
            planInputKeyRef.current = inputKey;
            setPlan((current) => current.source === "ai" ? current : { title: "智能分镜", globalStyle: storyboardStyleLabel(style), scenes: ruleScenes, source: "rules" });
        } finally {
            // A source change can invalidate the request while it is in flight;
            // still release the local lock so the dialog cannot remain stuck.
            setAnalyzing(false);
        }
    };

    const handleGenerate = async () => {
        if (!plan.scenes.length || hasActiveGeneration || retryingSceneId) return;
        flushPlanChange();
        // Every batch gets a unique revision, even when the plan itself did
        // not change. This prevents a late callback from a cancelled/finished
        // batch from mutating the next batch's progress map.
        const generationRevision = ++planRevisionRef.current;
        const generationSceneIds = new Set(plan.scenes.map((scene) => scene.id));
        setGenerating(true);
        setError("");
        markStoryboardProgressLocallyOwned(
            persistedProgressSyncRef,
            hydratedResumeKeyRef.current,
            storyboardProgressForPlan(initialProgress, plan),
        );
        const queued = Object.fromEntries(plan.scenes.map((scene) => [scene.id, { sceneId: scene.id, status: "queued" as const }]));
        setProgress(queued);
        try {
            const options = { style, sceneCount, aspectRatio, consistency };
            await onGenerate(plan, script, options, (event) => {
                if (planRevisionRef.current !== generationRevision || !generationSceneIds.has(event.sceneId)) return;
                setProgress((current) => ({ ...current, [event.sceneId]: event }));
            });
        } catch (reason) {
            if (planRevisionRef.current !== generationRevision) return;
            setError(reason instanceof Error ? reason.message : t("canvas.storyboard.generationFailed"));
        } finally {
            setGenerating(false);
        }
    };

    const handleRetryScene = async (scene: StoryboardScene) => {
        const current = progress[scene.id];
        const retryable = ["failed", "canceled"].includes(current?.status || "") || (current?.status === "succeeded" && current.needsRegeneration);
        if (!onRetryScene || interactionLocked || !retryable) return;
        const previous = current;
        const retryRevision = ++planRevisionRef.current;
        const retrySceneId = scene.id;
        setRetryingSceneId(scene.id);
        setError("");
        markStoryboardProgressLocallyOwned(
            persistedProgressSyncRef,
            hydratedResumeKeyRef.current,
            storyboardProgressForPlan(initialProgress, plan),
        );
        setProgress((current) => {
            const previous = current[scene.id];
            return { ...current, [scene.id]: { sceneId: scene.id, status: "queued", imageUrl: previous?.imageUrl, needsRegeneration: previous?.needsRegeneration } };
        });
        try {
            const accepted = await onRetryScene(scene, { style, sceneCount, aspectRatio, consistency }, (event) => {
                if (planRevisionRef.current !== retryRevision || event.sceneId !== retrySceneId) return;
                setProgress((current) => {
                    const previous = current[event.sceneId];
                    const imageUrl = event.imageUrl || previous?.imageUrl;
                    const needsRegeneration = event.status === "succeeded" ? false : event.status === "queued" || event.status === "running" ? previous?.needsRegeneration : false;
                    return { ...current, [event.sceneId]: { ...event, ...(imageUrl ? { imageUrl } : {}), needsRegeneration } };
                });
            });
            // A declined cost confirmation is not a completed retry. Restore the
            // previous failure so the action remains available and truthful.
            if (accepted === false && planRevisionRef.current === retryRevision) setProgress((current) => ({ ...current, [scene.id]: previous || { sceneId: scene.id, status: "failed" } }));
        } catch (reason) {
            const details = reason instanceof Error ? reason.message : t("canvas.storyboard.generationFailed");
            if (planRevisionRef.current === retryRevision) {
                setError(details);
                setProgress((current) => {
                    const previous = current[scene.id];
                    return { ...current, [scene.id]: { sceneId: scene.id, status: "failed", error: details, ...(previous?.imageUrl ? { imageUrl: previous.imageUrl } : {}) } };
                });
            }
        } finally {
            setRetryingSceneId(null);
        }
    };

    const emitPlanChange = (nextPlan: StoryboardPlan) => {
        const options = { style, sceneCount, aspectRatio, consistency };
        if (!onPlanChangeRef.current) return;
        pendingPlanChangeRef.current = { plan: nextPlan, options };
        if (planChangeTimerRef.current !== null) window.clearTimeout(planChangeTimerRef.current);
        planChangeTimerRef.current = window.setTimeout(() => {
            planChangeTimerRef.current = null;
            flushPlanChange();
        }, 180);
    };

    const updateScene = (sceneId: string, patch: Partial<StoryboardScene>) => {
        planRevisionRef.current += 1;
        markStoryboardProgressLocallyOwned(
            persistedProgressSyncRef,
            hydratedResumeKeyRef.current,
            storyboardProgressForPlan(initialProgress, plan),
        );
        setProgress((current) => {
            const previous = current[sceneId];
            if (!previous || previous.status !== "succeeded" || previous.needsRegeneration) return current;
            return { ...current, [sceneId]: { ...previous, needsRegeneration: true } };
        });
        const nextPlan = { ...plan, scenes: plan.scenes.map((scene) => (scene.id === sceneId ? { ...scene, ...patch } : scene)) };
        setPlan(nextPlan);
        emitPlanChange(nextPlan);
    };

    const updateSceneSummary = (sceneId: string, summary: string) => {
        planRevisionRef.current += 1;
        markStoryboardProgressLocallyOwned(
            persistedProgressSyncRef,
            hydratedResumeKeyRef.current,
            storyboardProgressForPlan(initialProgress, plan),
        );
        setProgress((current) => {
            const previous = current[sceneId];
            if (!previous || previous.status !== "succeeded" || previous.needsRegeneration) return current;
            return { ...current, [sceneId]: { ...previous, needsRegeneration: true } };
        });
        const nextPlan = {
            ...plan,
            scenes: plan.scenes.map((scene) =>
                scene.id === sceneId
                    ? {
                          ...scene,
                          summary,
                          prompt: promptWithEditedSummary(scene, summary, style, plan.globalStyle),
                      }
                    : scene,
            ),
        };
        setPlan(nextPlan);
        emitPlanChange(nextPlan);
    };

    const exportPlan = () => {
        const payload = JSON.stringify({ ...plan, options: { style, sceneCount, aspectRatio, consistency } }, null, 2);
        const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${plan.title || "storyboard"}.json`;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const closeDialog = () => {
        flushPlanChange();
        onClose();
    };

    return (
        <CanvasEditorModal
            open={open}
            onClose={interactionLocked ? () => undefined : closeDialog}
            width="min(1180px, calc(100vw - 24px))"
            className="canvas-storyboard-modal"
            closable={false}
            ariaTitle={t("canvas.storyboard.title")}
            title={null}
        >
            <div className="canvas-storyboard-shell" data-canvas-no-zoom aria-busy={interactionLocked}>
                <header className="canvas-storyboard-header">
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="canvas-storyboard-icon" aria-hidden>
                            <Clapperboard className="size-5" />
                        </span>
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <h2 className="truncate text-[17px] font-semibold" style={{ color: theme.node.text }}>{t("canvas.storyboard.title")}</h2>
                                <span className="canvas-storyboard-badge"><Sparkles className="size-3" /> AI</span>
                            </div>
                            {sourceOptions.length > 1 ? (
                                <label className="canvas-storyboard-source-picker">
                                    <span className="sr-only">{t("canvas.storyboard.sourceLabel")}</span>
                                    <select
                                        value={sourceId || sourceOptions[0]?.id || ""}
                                        onChange={(event) => {
                                            const next = sourceOptions.find((option) => option.id === event.target.value);
                                            if (!next) return;
                                            flushPlanChange();
                                            onSourceChange?.(next.id);
                                            const nextScript = next.script.slice(0, 9000);
                                            setScript(nextScript);
                                            onScriptChange?.(nextScript);
                                            setError("");
                                        }}
                                        disabled={interactionLocked}
                                        aria-label={t("canvas.storyboard.sourceLabel")}
                                    >
                                        {sourceOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                                    </select>
                                </label>
                            ) : (
                                <p className="mt-0.5 truncate text-[11px]" style={{ color: theme.node.muted }}>{sourceTitle || sourceOptions[0]?.title || t("canvas.storyboard.subtitle")}</p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button type="button" className="canvas-storyboard-export" onClick={exportPlan} title={t("canvas.storyboard.exportPlan")} aria-label={t("canvas.storyboard.exportPlan")}>
                            <Download className="size-3.5" />
                        </button>
                        <EditorIconButton title={t("common.cancel")} disabled={interactionLocked} onClick={interactionLocked ? undefined : closeDialog}><X className="size-4" /></EditorIconButton>
                    </div>
                </header>

                <div className="canvas-storyboard-steps" aria-label={t("canvas.storyboard.stepsLabel")}>
                    {[t("canvas.storyboard.stepUnderstand"), t("canvas.storyboard.stepReview"), t("canvas.storyboard.stepGenerate")].map((label, index) => {
                        const number = index + 1;
                        const active = activeStage === number;
                        const done = activeStage > number;
                        return <div key={label} className={`canvas-storyboard-step${active ? " is-active" : ""}${done ? " is-done" : ""}`}><span>{done ? "✓" : `0${number}`}</span>{label}</div>;
                    })}
                </div>

                {showProgressPanel ? (
                    <div className={`canvas-storyboard-progress-panel${error ? " has-error" : ""}`} role="status" aria-live="polite">
                        <div className="canvas-storyboard-progress-head">
                            <div className="canvas-storyboard-progress-label">
                                <span className="canvas-storyboard-progress-dot" aria-hidden />
                                <span>
                                    {retryingSceneId
                                        ? t("canvas.storyboard.retrying")
                                        : hasActiveGeneration
                                        ? t("canvas.storyboard.progress", { completed: completedCount, total: totalScenes })
                                          : failedCount
                                            ? t("canvas.storyboard.partialFailure", { failed: failedCount })
                                              : canceledCount
                                                ? t("canvas.storyboard.partialCanceled", { canceled: canceledCount })
                                                : needsRegenerationCount
                                                  ? t("canvas.storyboard.needsRegeneration", { count: needsRegenerationCount })
                                              : allScenesSucceeded
                                                ? t("canvas.storyboard.complete", { count: completedCount })
                                                : t("canvas.storyboard.costHint", { count: totalScenes })}
                                </span>
                            </div>
                            <strong>{progressPercent}%</strong>
                        </div>
                        <div className="canvas-storyboard-progress-track" aria-hidden="true">
                            <span style={{ width: `${progressPercent}%` }} />
                        </div>
                        {error ? (
                            <div className="canvas-storyboard-inline-alert" role="alert">
                                <AlertCircle className="size-3.5" aria-hidden />
                                <span title={error}>{error}</span>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="canvas-storyboard-body">
                    <section className="canvas-storyboard-input-pane">
                        <div className="canvas-storyboard-section-head">
                            <div><div className="canvas-storyboard-kicker">01 / {t("canvas.storyboard.scriptTitle")}</div><h3>{t("canvas.storyboard.scriptTitle")}</h3></div>
                            <button
                                type="button"
                                className="canvas-storyboard-text-button"
                                onClick={() => {
                                    setScript(SAMPLE_SCRIPT);
                                    onScriptChange?.(SAMPLE_SCRIPT);
                                }}
                                disabled={interactionLocked}
                            >
                                {t("canvas.storyboard.useExample")}
                            </button>
                        </div>
                        <textarea
                            value={script}
                            onChange={(event) => {
                                const nextScript = event.target.value;
                                setScript(nextScript);
                                onScriptChange?.(nextScript);
                            }}
                            disabled={interactionLocked}
                            maxLength={9000}
                            className="canvas-storyboard-script"
                            placeholder={t("canvas.storyboard.scriptPlaceholder")}
                            aria-label={t("canvas.storyboard.scriptTitle")}
                        />
                        <div className="canvas-storyboard-input-meta"><span>{script.trim().length.toLocaleString()} / 9,000</span><span>{inputEmpty ? t("canvas.storyboard.needScript") : t("canvas.storyboard.autoDetected", { count: ruleScenes.length })}</span></div>

                        <div className="canvas-storyboard-control-block">
                            <div className="canvas-storyboard-control-label">{t("canvas.storyboard.style")}</div>
                            <div className="canvas-storyboard-segmented">
                                {STYLE_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => { if (style === option.value) return; setStyle(option.value); invalidateAllProgress(); }} disabled={interactionLocked} className={style === option.value ? "is-active" : ""} aria-pressed={style === option.value}>{t(option.key)}</button>)}
                            </div>
                        </div>
                        <div className="canvas-storyboard-control-row">
                            <div className="canvas-storyboard-control-block flex-1">
                                <div className="canvas-storyboard-control-label">{t("canvas.storyboard.sceneCount")}</div>
                                <div className="canvas-storyboard-count-stepper"><button type="button" onClick={() => { if (sceneCount <= 1) return; setSceneCount((value) => Math.max(1, value - 1)); invalidateAllProgress(); }} disabled={interactionLocked} aria-label={`${t("canvas.storyboard.sceneCount")} −`} title={`${t("canvas.storyboard.sceneCount")} −`}>−</button><span aria-live="polite">{sceneCount}</span><button type="button" onClick={() => { if (sceneCount >= 16) return; setSceneCount((value) => Math.min(16, value + 1)); invalidateAllProgress(); }} disabled={interactionLocked} aria-label={`${t("canvas.storyboard.sceneCount")} +`} title={`${t("canvas.storyboard.sceneCount")} +`}>+</button></div>
                            </div>
                            <div className="canvas-storyboard-control-block flex-1">
                                <div className="canvas-storyboard-control-label">{t("canvas.storyboard.ratio")}</div>
                                <div className="canvas-storyboard-ratio-row">{RATIO_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => { if (aspectRatio === option.value) return; setAspectRatio(option.value); invalidateAllProgress(); }} disabled={interactionLocked} className={aspectRatio === option.value ? "is-active" : ""} aria-pressed={aspectRatio === option.value}><strong>{option.label}</strong><small>{t(option.hintKey)}</small></button>)}</div>
                            </div>
                        </div>
                        <button type="button" className="canvas-storyboard-consistency" onClick={() => { setConsistency((value) => !value); invalidateAllProgress(); }} disabled={interactionLocked} aria-pressed={consistency}>
                            <span className={`canvas-storyboard-toggle${consistency ? " is-on" : ""}`}><span /></span>
                            <span><strong>{t("canvas.storyboard.consistency")}</strong><small>{t("canvas.storyboard.consistencyHint")}</small></span>
                        </button>
                        <div className="canvas-storyboard-actions">
                            <button type="button" className="canvas-storyboard-ai-button" onClick={handleAnalyze} disabled={inputEmpty || interactionLocked}>
                                {analyzing ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}
                                {analyzing ? t("canvas.storyboard.analyzing") : t("canvas.storyboard.aiRefine")}
                            </button>
                            <span className="canvas-storyboard-source-label">{plan.source === "ai" ? t("canvas.storyboard.aiSource") : t("canvas.storyboard.rulesSource")}</span>
                        </div>
                    </section>

                    <section className="canvas-storyboard-preview-pane">
                        <div className="canvas-storyboard-section-head">
                            <div><div className="canvas-storyboard-kicker">02 / {t("canvas.storyboard.previewTitle")}</div><h3>{t("canvas.storyboard.previewTitle")}</h3></div>
                            <div className="canvas-storyboard-sequence-stats">
                                <span className="canvas-storyboard-count-label">{plan.scenes.length} {t("canvas.storyboard.shots")}</span>
                                {totalScenes ? <span className="canvas-storyboard-total-duration">{t("canvas.storyboard.totalDuration", { duration: totalDurationSec })}</span> : null}
                            </div>
                        </div>
                        {plan.scenes.length ? (
                            <div className="canvas-storyboard-filmstrip" aria-label={t("canvas.storyboard.sequenceOverview")}>
                                <div className="canvas-storyboard-filmstrip-head">
                                    <span>{t("canvas.storyboard.sequenceOverview")}</span>
                                    <span>{t("canvas.storyboard.filmstripHint")}</span>
                                </div>
                                <div className="canvas-storyboard-filmstrip-track" role="list">
                                    {plan.scenes.map((scene) => {
                                        const item = progress[scene.id];
                                        const sceneStatus = item?.status;
                                        const sceneIsFocused = focusedSceneId === scene.id;
                                        const duration = sceneDuration(scene);
                                        return (
                                            <button
                                                key={`filmstrip-${scene.id}`}
                                                type="button"
                                                className={`canvas-storyboard-filmstrip-frame${sceneIsFocused ? " is-focused" : ""}${sceneStatus ? ` is-${sceneStatus}` : ""}`}
                                                style={{ "--storyboard-frame-weight": duration } as CSSProperties}
                                                onClick={() => focusScene(scene.id)}
                                                disabled={!onFocusScene}
                                                aria-pressed={sceneIsFocused}
                                                aria-current={sceneIsFocused ? "true" : undefined}
                                                aria-label={`${scene.index}. ${scene.title}`}
                                                title={scene.title}
                                            >
                                                {item?.imageUrl ? <img className="canvas-storyboard-filmstrip-image" src={item.imageUrl} alt="" aria-hidden /> : <span className="canvas-storyboard-filmstrip-placeholder" aria-hidden />}
                                                <span className="canvas-storyboard-filmstrip-index">{String(scene.index).padStart(2, "0")}</span>
                                                <span className="canvas-storyboard-filmstrip-fill" aria-hidden />
                                                <span className="canvas-storyboard-filmstrip-duration">{duration}s</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}
                        <div className="canvas-storyboard-shot-list">
                            {plan.scenes.map((scene) => {
                                const item = progress[scene.id];
                                const status = item?.status;
                                const isStale = status === "succeeded" && Boolean(item?.needsRegeneration);
                                const canRetry = Boolean(onRetryScene && (isStale || status === "failed" || status === "canceled"));
                                return (
                                    <article
                                        key={scene.id}
                                        className={`canvas-storyboard-shot-card is-ratio-${aspectRatio.replace(":", "-")}${status ? ` is-${status}` : ""}${status === "succeeded" ? " is-complete" : ""}${status === "failed" ? " is-failed" : ""}${isStale ? " is-stale" : ""}${focusedSceneId === scene.id ? " is-focused" : ""}`}
                                        role={onFocusScene ? "group" : undefined}
                                        tabIndex={onFocusScene ? 0 : undefined}
                                        onClick={() => focusScene(scene.id)}
                                        onKeyDown={(event) => {
                                            if (!onFocusScene || event.target !== event.currentTarget) return;
                                            if (event.key !== "Enter" && event.key !== " ") return;
                                            event.preventDefault();
                                            focusScene(scene.id);
                                        }}
                                        aria-label={onFocusScene ? `${scene.index}. ${scene.title} · ${t("canvas.storyboard.focusScene")}` : undefined}
                                    >
                                        <div className="canvas-storyboard-shot-index">{String(scene.index).padStart(2, "0")}</div>
                                        <div className="canvas-storyboard-shot-thumb" style={{ aspectRatio: aspectRatio.replace(":", "/") }}>
                                            {item?.imageUrl ? <img src={item.imageUrl} alt={scene.title} /> : status === "running" ? <LoaderCircle className="size-5 animate-spin" /> : <Film className="size-5" />}
                                            {onFocusScene ? <button type="button" className="canvas-storyboard-focus-button" onClick={(event) => { event.stopPropagation(); focusScene(scene.id); }} aria-label={t("canvas.storyboard.focusScene")} title={t("canvas.storyboard.focusScene")}><LocateFixed className="size-3.5" /></button> : null}
                                        </div>
                                        <div className="canvas-storyboard-shot-copy">
                                            <div className="flex items-center gap-2"><input value={scene.title} onClick={(event) => event.stopPropagation()} onChange={(event) => updateScene(scene.id, { title: event.target.value })} disabled={interactionLocked} aria-label={`${t("canvas.storyboard.shotTitle")} ${scene.index}`} /><span className="canvas-storyboard-shot-type">{shotLabel(scene, t)}</span></div>
                                            <textarea value={scene.summary} onClick={(event) => event.stopPropagation()} onChange={(event) => updateSceneSummary(scene.id, event.target.value)} disabled={interactionLocked} aria-label={`${t("canvas.storyboard.shotSummary")} ${scene.index}`} />
                                            <div className="canvas-storyboard-shot-meta"><span title={scene.location}>{scene.location}</span><span title={scene.time}>{scene.time}</span><span title={scene.lens}>{scene.lens}</span></div>
                                            <div className="canvas-storyboard-shot-specs">
                                                <span title={scene.cameraAngle}>{scene.cameraAngle}</span>
                                                <span title={scene.movement}>{scene.movement}</span>
                                                <span className="canvas-storyboard-shot-duration">{sceneDuration(scene)}s</span>
                                            </div>
                                            {scene.dialogue ? <div className="canvas-storyboard-shot-dialogue" title={scene.dialogue}>“{scene.dialogue}”</div> : null}
                                            {status ? <div className={`canvas-storyboard-status is-${status}${isStale ? " is-stale" : ""}`} role="status" aria-live="polite">{status === "running" ? <LoaderCircle className="size-3 animate-spin" /> : isStale ? <RefreshCw className="size-3" /> : status === "succeeded" ? <Zap className="size-3" /> : canRetry ? null : status === "failed" ? <RefreshCw className="size-3" /> : <Film className="size-3" />}{isStale ? t("canvas.storyboard.needsRegeneration", { count: 1 }) : statusLabel(status, t)}{item?.error ? <span className="canvas-storyboard-status-error"> · {item.error}</span> : null}{canRetry ? <button type="button" className="canvas-storyboard-retry-button" onClick={(event) => { event.stopPropagation(); void handleRetryScene(scene); }} disabled={interactionLocked} aria-label={t("canvas.storyboard.retryScene")} title={t("canvas.storyboard.retryScene")}><RefreshCw className={`size-3${retryingSceneId === scene.id ? " animate-spin" : ""}`} />{retryingSceneId === scene.id ? t("canvas.storyboard.retrying") : t("canvas.storyboard.retryScene")}</button> : null}</div> : null}
                                        </div>
                                    </article>
                                );
                            })}
                            {!plan.scenes.length ? (
                                <div className="canvas-storyboard-empty">
                                    <div className="canvas-storyboard-empty-frames" aria-hidden>
                                        <span>01</span><span>02</span><span>03</span>
                                    </div>
                                    <span>{t("canvas.storyboard.empty")}</span>
                                    <small>{t("canvas.storyboard.emptyHint")}</small>
                                </div>
                            ) : null}
                        </div>
                    </section>
                </div>

                <footer className="canvas-storyboard-footer">
                    <div className="flex min-w-0 items-center gap-2">
                        <span className="canvas-storyboard-footer-icon"><Film className="size-3.5" /></span>
                        <span className="truncate text-[11px]" role="status" aria-live="polite" style={{ color: theme.node.muted }}>
                            {retryingSceneId
                                ? t("canvas.storyboard.retrying")
                                : hasActiveGeneration
                                  ? t("canvas.storyboard.progress", { completed: completedCount, total: plan.scenes.length })
                                    : needsRegenerationCount
                                      ? t("canvas.storyboard.needsRegeneration", { count: needsRegenerationCount })
                                      : failedCount
                                        ? t("canvas.storyboard.partialFailure", { failed: failedCount })
                                    : canceledCount
                                      ? t("canvas.storyboard.partialCanceled", { canceled: canceledCount })
                                      : completedCount === plan.scenes.length && plan.scenes.length
                                        ? t("canvas.storyboard.complete", { count: completedCount })
                                          : t("canvas.storyboard.costHint", { count: plan.scenes.length })}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {analyzing || hasActiveGeneration || retryingSceneId ? <EditorGhostButton onClick={onCancelGeneration} disabled={!onCancelGeneration} icon={<X className="size-3.5" />}>{t("canvas.storyboard.cancel")}</EditorGhostButton> : <EditorGhostButton onClick={interactionLocked ? undefined : closeDialog} disabled={interactionLocked}>{t("common.cancel")}</EditorGhostButton>}
                        <EditorPrimaryButton onClick={handleGenerate} disabled={!totalScenes || interactionLocked || inputEmpty} icon={hasActiveGeneration ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}>
                            {hasActiveGeneration ? t("canvas.storyboard.generating") : t("canvas.storyboard.generate", { count: plan.scenes.length })}
                        </EditorPrimaryButton>
                    </div>
                </footer>
            </div>
        </CanvasEditorModal>
    );
}
