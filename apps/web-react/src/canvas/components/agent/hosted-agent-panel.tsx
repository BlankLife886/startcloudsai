import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Tooltip } from "antd";
import { History, MessageSquare, PanelRightClose, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { canvasThemes } from "@/lib/canvas-theme";
import { bindHostedAgentRunId, createHostedAgentRunScope, isHostedAgentRunIdRetired, isHostedAgentRunScopeActive, isHostedAgentStateForProject, registerHostedAgentRunStopper, retireHostedAgentRunId, settleHostedAgentMessagesOnStop, type HostedAgentRunScope } from "@/lib/agent/hosted-agent-run-scope";
import { summarizeCanvasAgentOps, type CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { canExecuteApprovedCanvasAgentTool, waitForCanvasAgentToolPaint } from "@/lib/canvas/canvas-agent-tool-delivery";
import { resolveCanvasReferenceImages } from "@/lib/canvas/canvas-resource-references";
import { runCanvasAgentTool } from "@/lib/canvas/canvas-hosted-agent";
import { readImageMeta } from "@/lib/image-utils";
import { randomId } from "@/lib/utils";
import { StarcloudsApiError } from "@/services/starclouds-api";
import {
    cancelCanvasAssistantRun,
    beginHostedAgentConversation,
    clearHostedAgentConversationId,
    deleteCanvasAgentConversation,
    fetchCanvasAgentConversation,
    hostedAgentConversationThread,
    hostedAgentMessagesFromConversation,
    claimCanvasAgentTool,
    listActiveCanvasAgentRuns,
    listCanvasAgentConversations,
    readHostedAgentConversationId,
    requestCanvasAgentTurn,
    waitForCanvasAgentRun,
    writeHostedAgentConversationId,
    type CanvasAgentConversation,
    type CanvasAgentToolCall,
} from "@/services/canvas-task-api";
import { useAgentStore, type AgentAttachment, type AgentCanvasContext, type AgentChatItem, type AgentPendingToolCall, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { MODEL_REASONING_EFFORTS, modelOptionLabel, modelOptionMeta, resolveModelForCapability, selectableModelsByCapability, useConfigStore, type ChannelModel, type ModelReasoningEffort } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { attachmentPayloadBytes, isCanvasWriteTool, promptWithAttachments, promptWithCanvasReferences, toolCallDetail } from "./agent-event-formatters";
import { CanvasHomeDialog } from "@/components/canvas/canvas-home-dialog";
import { AgentChatTimeline } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { HostedAgentHistory } from "./hosted-agent-history";

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 12 * 1024 * 1024;
const HOSTED_REASONING_EFFORT_KEY = "canvas-hosted-agent-reasoning-effort";
const HOSTED_MODEL_KEY = "canvas-hosted-agent-model";
const HOSTED_CONFIRM_TOOLS_KEY = "canvas-hosted-agent-confirm-tools";
const VALID_HOSTED_REASONING_EFFORTS = new Set<ModelReasoningEffort>(MODEL_REASONING_EFFORTS);
type HostedAgentRunBinding = HostedAgentRunScope & {
    attachments: AgentAttachment[];
    waitForRunId: Promise<string>;
    resolveRunId: (runId: string) => void;
};

function createHostedAgentRunBinding(projectId: string, attachments: AgentAttachment[], controller = new AbortController()): HostedAgentRunBinding {
    let resolveRunId: (runId: string) => void = () => undefined;
    const waitForRunId = new Promise<string>((resolve) => {
        resolveRunId = resolve;
    });
    return { ...createHostedAgentRunScope(projectId, controller), attachments, waitForRunId, resolveRunId };
}

function cancelHostedAgentRun(runId: string, options?: { keepalive?: boolean }) {
    if (!runId) return Promise.resolve();
    retireHostedAgentRunId(runId);
    return cancelCanvasAssistantRun(runId, options);
}

function initialHostedConfirmTools() {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(HOSTED_CONFIRM_TOOLS_KEY) === "1";
}

function hostedToolInput(call: CanvasAgentToolCall): AgentPendingToolCall["input"] {
    try {
        const parsed = JSON.parse(call.arguments || "{}");
        return parsed && typeof parsed === "object" ? parsed as AgentPendingToolCall["input"] : {};
    } catch {
        return {};
    }
}

function initialHostedReasoningEffort(): ModelReasoningEffort | "" {
    if (typeof window === "undefined") return "";
    const saved = localStorage.getItem(HOSTED_REASONING_EFFORT_KEY) as ModelReasoningEffort | null;
    return saved && VALID_HOSTED_REASONING_EFFORTS.has(saved) ? saved : "";
}

function supportedHostedReasoningEfforts(model: ChannelModel | undefined): ModelReasoningEffort[] {
    return (model?.supportedReasoningEfforts || []).filter((effort) => VALID_HOSTED_REASONING_EFFORTS.has(effort));
}

function resolveHostedReasoningEffort(model: ChannelModel | undefined, requested: AgentReasoningEffort | ""): ModelReasoningEffort | "" {
    const supported = supportedHostedReasoningEfforts(model);
    if (requested && VALID_HOSTED_REASONING_EFFORTS.has(requested as ModelReasoningEffort) && supported.includes(requested as ModelReasoningEffort)) return requested as ModelReasoningEffort;
    const fallback = model?.defaultReasoningEffort;
    if (fallback && VALID_HOSTED_REASONING_EFFORTS.has(fallback) && supported.includes(fallback)) return fallback;
    return supported[0] || "";
}

type Translate = ReturnType<typeof useTranslation>["t"];

function isDeepHostedReasoningEffort(effort: AgentReasoningEffort | "") {
    return effort === "high" || effort === "xhigh" || effort === "max";
}

function canvasAgentTurnCost(model: ChannelModel | undefined, effort: AgentReasoningEffort | "", agentPricing: { standardMultiplier: number; deepMultiplier: number }) {
    if (!model) return { effective: undefined as number | undefined, standard: undefined as number | undefined };
    const configured = effort ? model.reasoningPrices?.[effort as ModelReasoningEffort] : undefined;
    const multiplier = isDeepHostedReasoningEffort(effort) ? agentPricing.deepMultiplier : agentPricing.standardMultiplier;
    const effective = configured?.canvasAgentPricePoints ?? (model.pricePoints === undefined ? undefined : model.pricePoints * multiplier);
    const standard = configured?.canvasAgentStandardPricePoints
        ?? (model.standardPricePoints === undefined ? undefined : model.standardPricePoints * multiplier)
        ?? effective;
    return { effective, standard };
}

function formatCanvasAgentTurnPrice(t: Translate, cost: { effective?: number; standard?: number }) {
    if (cost.effective === undefined) return { price: undefined as string | undefined, comparePrice: undefined as string | undefined };
    const hasDiscount = cost.standard !== undefined && cost.standard > cost.effective;
    return {
        price: t("agent.hosted.turnPrice", { price: cost.effective }),
        comparePrice: hasDiscount ? String(cost.standard) : undefined,
    };
}

function toolTitle(name: string, t: Translate) {
    if (name === "web_search") return t("agent.siteTools.webSearch");
    if (name === "canvas_get_state") return t("agent.eventExtra.tools.readCanvas");
    if (name === "canvas_get_selection") return t("agent.eventExtra.tools.readSelection");
    if (name === "canvas_find_nodes") return t("agent.eventExtra.tools.findNodes");
    if (name === "canvas_inspect_nodes") return t("agent.eventExtra.tools.inspectNodes");
    if (name === "canvas_focus_nodes") return t("agent.eventExtra.tools.focusNodes");
    if (name === "canvas_duplicate_selection") return t("agent.eventExtra.tools.duplicateSelection");
    if (name === "canvas_create_image_operation") return t("agent.eventExtra.tools.imageOperation");
    if (name === "canvas_replace_workflow_input") return t("agent.eventExtra.tools.replaceWorkflowInput");
    if (name === "canvas_run_downstream") return t("agent.eventExtra.tools.runDownstream");
    if (name === "canvas_list_agent_history") return t("agent.eventExtra.tools.listAgentHistory");
    if (name === "canvas_create_checkpoint") return t("agent.eventExtra.tools.createCheckpoint");
    if (name === "canvas_restore_checkpoint") return t("agent.eventExtra.tools.restoreCheckpoint");
    if (name === "canvas_restore_agent_transaction") return t("agent.eventExtra.tools.restoreTransaction");
    if (name === "canvas_update_generation_settings") return t("agent.generationSettingsTool.title");
    if (name === "canvas_undo_last_action") return t("agent.canvasHistoryTool.undoTitle");
    if (name === "canvas_redo_last_action") return t("agent.canvasHistoryTool.redoTitle");
    if (name === "canvas_export_snapshot") return t("agent.eventExtra.tools.exportSnapshot");
    if (name === "canvas_regenerate_selection") return t("agent.eventExtra.tools.runGeneration");
    if (name === "canvas_run_generation") return t("agent.eventExtra.tools.runGeneration");
    if (name === "canvas_generation_status") return t("agent.hosted.generationStatus");
    if (name === "canvas_validate_workflow") return t("agent.eventExtra.tools.validateWorkflow");
    if (name === "canvas_plan_workflow_run") return t("agent.siteTools.workflowPreflight");
    if (name === "canvas_stop_workflow") return t("agent.eventExtra.tools.stopWorkflow");
    if (name === "canvas_resume_workflow") return t("agent.eventExtra.tools.resumeWorkflow");
    if (name === "canvas_retry_failed_nodes") return t("agent.eventExtra.tools.retryFailedNodes");
    if (name === "canvas_create_attachment_nodes") return t("agent.eventExtra.tools.addAttachments");
    if (name === "site_navigate") return t("agent.eventExtra.tools.openPage");
    if (name === "canvas_list_projects") return t("agent.siteTools.canvasList");
    if (name === "canvas_list_workflow_templates") return t("agent.siteTools.workflowTemplateList");
    if (name === "canvas_inspect_workflow_template") return t("agent.siteTools.workflowTemplateInspect");
    if (name === "canvas_create_from_workflow_template") return t("agent.siteTools.workflowTemplateCreate");
    if (name === "prompts_search") return t("agent.siteTools.promptSearch");
    if (name === "assets_list") return t("agent.siteTools.assetList");
    if (name === "assets_add") return t("agent.siteTools.assetAdd");
    return t("agent.eventExtra.tools.canvasOps");
}

function hostedToolRunningText(name: string, title: string, t: Translate) {
    if (name === "web_search") return t("agent.hosted.webSearching");
    if (["canvas_get_state", "canvas_get_selection", "canvas_find_nodes", "canvas_inspect_nodes", "canvas_validate_workflow", "canvas_plan_workflow_run", "canvas_list_agent_history", "canvas_export_snapshot", "canvas_list_projects", "canvas_list_workflow_templates", "canvas_inspect_workflow_template", "prompts_search", "assets_list"].includes(name)) return t("agent.hosted.toolReading");
    if (["canvas_apply_ops", "canvas_focus_nodes", "canvas_duplicate_selection", "canvas_create_image_operation", "canvas_replace_workflow_input", "canvas_update_generation_settings", "canvas_undo_last_action", "canvas_redo_last_action", "canvas_create_checkpoint", "canvas_restore_checkpoint", "canvas_restore_agent_transaction", "canvas_create_attachment_nodes", "canvas_create_from_workflow_template", "assets_add"].includes(name)) return t("agent.hosted.toolModifying");
    if (["canvas_regenerate_selection", "canvas_run_generation", "canvas_generation_status", "canvas_run_downstream", "canvas_stop_workflow", "canvas_resume_workflow", "canvas_retry_failed_nodes"].includes(name)) return t("agent.hosted.toolGenerating");
    return t("agent.hosted.toolWorking", { tool: title });
}

function describeToolObservation(name: string, observation: unknown, t: Translate) {
    if (name === "web_search") {
        const result = (observation && typeof observation === "object" ? observation : {}) as { query?: string; sources?: Array<{ title?: string; url?: string }> };
        const sources = Array.isArray(result.sources) ? result.sources.filter((source) => /^https?:\/\//i.test(String(source.url || ""))).slice(0, 8) : [];
        const summary = t("agent.hosted.webSearchCompleted", { count: sources.length });
        if (!sources.length) return summary;
        return `${summary}\n${sources.map((source, index) => `${index + 1}. [${String(source.title || source.url)}](${String(source.url)})`).join("\n")}`;
    }
    if (name === "canvas_get_selection") {
        const result = observation as { total?: number; selectedNodeIds?: unknown[]; nodes?: Array<{ id?: string; type?: string; title?: string }>; truncated?: boolean };
        const nodes = Array.isArray(result.nodes) ? result.nodes : [];
        const total = Number(result.total ?? result.selectedNodeIds?.length ?? nodes.length) || 0;
        const summary = `${t("agent.eventMore.selectionRead")} · ${t("agent.hosted.listedItems", { count: total })}`;
        if (!nodes.length) return summary;
        const lines = nodes.map((node, index) => {
            const id = String(node.id || "-");
            const title = String(node.title || "");
            const label = title && title !== id ? `${title} (${id})` : id;
            return `${index + 1}. ${label} · ${String(node.type || "node")}`;
        });
        if (result.truncated) lines.push("…");
        return `${summary}\n${lines.join("\n")}`;
    }
    if (name === "canvas_regenerate_selection") {
        const result = observation as { status?: string; sourceImageCount?: number; skippedNodeIds?: unknown[]; items?: unknown[] };
        if (result.status === "canceled") return t("agent.runtime.canvasToolCanceled");
        const summary = t("agent.hosted.generationTriggered", { count: result.sourceImageCount ?? result.items?.length ?? 0 });
        const skipped = result.skippedNodeIds?.length || 0;
        return skipped ? `${summary} · ${t("agent.hosted.generationSelectionSkipped", { count: skipped })}` : summary;
    }
    if (name === "canvas_update_generation_settings") {
        const result = observation as { updated?: number; unchanged?: number };
        return result.updated
            ? t("agent.generationSettingsTool.updated", { count: result.updated })
            : t("agent.generationSettingsTool.unchanged", { count: result.unchanged || 0 });
    }
    if (name === "canvas_undo_last_action" || name === "canvas_redo_last_action") {
        return t(name === "canvas_undo_last_action" ? "agent.canvasHistoryTool.undone" : "agent.canvasHistoryTool.redone");
    }
    if (name === "canvas_run_generation") {
        const triggered = (observation as { triggered?: string[] })?.triggered?.length || 0;
        return t("agent.hosted.generationTriggered", { count: triggered });
    }
    if (name === "canvas_generation_status") {
        const summary = (observation as { summary?: Record<string, number> })?.summary || {};
        return [
            summary.succeeded ? t("agent.hosted.generationSucceeded", { count: summary.succeeded }) : "",
            summary.running || summary.queued ? t("agent.hosted.generationRunning", { count: (summary.running || 0) + (summary.queued || 0) }) : "",
            summary.failed ? t("agent.hosted.generationFailed", { count: summary.failed }) : "",
        ]
            .filter(Boolean)
            .join(" · ") || t("agent.hosted.generationIdle");
    }
    if (name === "canvas_plan_workflow_run") {
        const result = observation as { nodeIds?: unknown[]; totals?: { total?: number; paidNodeCount?: number; freeNodeCount?: number } };
        return t("agent.hosted.workflowPreflight", { nodes: result.nodeIds?.length || 0, price: result.totals?.total || 0, paid: result.totals?.paidNodeCount || 0, free: result.totals?.freeNodeCount || 0 });
    }
    if (name === "site_navigate") {
        return t("agent.hosted.openedPage", { path: String((observation as { path?: string })?.path || "/") });
    }
    if (name === "canvas_create_attachment_nodes") {
        return t("agent.hosted.attachmentNodes", { count: (observation as { added?: string[] })?.added?.length || 0 });
    }
    if (name === "canvas_list_projects" || name === "canvas_list_workflow_templates" || name === "prompts_search" || name === "assets_list") {
        const total = Number((observation as { total?: number })?.total || 0);
        return t("agent.hosted.listedItems", { count: total });
    }
    if (name === "canvas_inspect_workflow_template") {
        const result = observation as { title?: string; nodeCount?: number; nodes?: unknown[]; workflows?: unknown[] };
        return t("agent.hosted.workflowTemplateInspected", { title: result.title || "-", nodes: result.nodeCount || result.nodes?.length || 0, workflows: result.workflows?.length || 0 });
    }
    if (name === "canvas_create_from_workflow_template") {
        return t("agent.hosted.workflowTemplateCreated", { title: String((observation as { title?: string })?.title || "-") });
    }
    if (name === "assets_add") return t("agent.hosted.assetAdded");
    if (name !== "canvas_apply_ops") return t("agent.hosted.readCanvas");
    const applied = observation as { applied?: number; ignored?: number; rejected?: number; addedNodes?: number; addedConnections?: number };
    if (!applied.applied && applied.rejected) return t("agent.hosted.noValidOps");
    return [
        t("agent.hosted.appliedCount", { count: applied?.applied || 0 }),
        applied?.addedNodes ? t("agent.hosted.addedNodes", { count: applied.addedNodes }) : "",
        applied?.addedConnections ? t("agent.hosted.linked", { count: applied.addedConnections }) : "",
        applied?.ignored ? t("agent.hosted.ignoredOps", { count: applied.ignored }) : "",
    ]
        .filter(Boolean)
        .join(" · ");
}

function isLeftoverCodexMessage(item: AgentChatItem) {
    if (item.title === "Codex") return true;
    const text = item.text || "";
    return text.includes("chat_requirements_prepare") || text.includes("token_invalidated") || text.includes("Your authentication token has been invalidated");
}

function hostedMessageTitles(t: Translate) {
    return {
        assistant: t("agent.hosted.subtitle"),
        reasoning: t("agent.events.reasoning"),
        canvasOps: t("agent.eventExtra.tools.canvasOps"),
    };
}

function hostedAgentErrorText(error: unknown, fallback: string, authFailed: string, interrupted: string) {
    const detail = error instanceof Error ? error.message : fallback;
    const lower = detail.toLowerCase();
    if (lower === "aborted" || lower.includes("aborterror") || lower.includes("signal is aborted") || lower.includes("operation was aborted")) {
        return interrupted;
    }
    if (
        lower.includes("token_invalidated") ||
        lower.includes("chat_requirements_prepare") ||
        lower.includes("authentication token has been invalidated") ||
        (lower.includes("401") && (lower.includes("authentication") || lower.includes("unauthorized")))
    ) {
        return authFailed;
    }
    return detail;
}

export function HostedAgentPanel() {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const prompt = useAgentStore((state) => state.prompt);
    const attachments = useAgentStore((state) => state.attachments);
    const sending = useAgentStore((state) => state.sending);
    const waiting = useAgentStore((state) => state.waiting);
    const messages = useAgentStore((state) => state.messages);
    const pendingTool = useAgentStore((state) => state.pendingTool);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const addMessage = useAgentStore((state) => state.addMessage);
    const closePanel = useAgentStore((state) => state.closePanel);
    const canvasConfig = useConfigStore((state) => state.config);
    const agentPricing = useConfigStore((state) => state.agentPricing);
    const canvasContextRef = useRef<AgentCanvasContext | null>(useAgentStore.getState().canvasContext);
    const activeRunRef = useRef<HostedAgentRunBinding | null>(null);
    const confirmToolsRef = useRef(false);
    const hostedToolWaiterRef = useRef<{ call: CanvasAgentToolCall; resolve: () => void; reject: (error: Error) => void } | null>(null);
    const projectId = useAgentStore((state) => state.canvasContext?.snapshot.projectId || "");
    const [reasoningEffort, setReasoningEffort] = useState<ModelReasoningEffort | "">(initialHostedReasoningEffort);
    const [confirmTools, setConfirmTools] = useState(initialHostedConfirmTools);
    const [hostedModel, setHostedModel] = useState("");
    const [hydrating, setHydrating] = useState(false);
    const [hostedTab, setHostedTab] = useState<"chat" | "history">("chat");
    const [conversations, setConversations] = useState<CanvasAgentConversation[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [currentConversationId, setCurrentConversationId] = useState("");
    const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(null);
    const [deletingHistory, setDeletingHistory] = useState(false);
    const textModelValues = useMemo(() => selectableModelsByCapability(canvasConfig, "text"), [canvasConfig]);
    useEffect(() => {
        if (!textModelValues.length) return;
        setHostedModel((current) => {
            if (current && textModelValues.includes(current)) return current;
            const saved = typeof window === "undefined" ? "" : localStorage.getItem(HOSTED_MODEL_KEY) || "";
            if (saved && textModelValues.includes(saved)) return saved;
            return resolveModelForCapability(canvasConfig, canvasConfig.textModel, "text");
        });
    }, [canvasConfig, textModelValues]);
    const hostedTextModel = modelOptionMeta(canvasConfig, hostedModel || resolveModelForCapability(canvasConfig, canvasConfig.textModel, "text"));
    const hostedReasoningEfforts = useMemo(() => supportedHostedReasoningEfforts(hostedTextModel), [hostedTextModel]);
    const activeReasoningEffort = useMemo(() => resolveHostedReasoningEffort(hostedTextModel, reasoningEffort), [hostedTextModel, reasoningEffort]);
    useEffect(() => {
        if (reasoningEffort === activeReasoningEffort) return;
        setReasoningEffort(activeReasoningEffort);
        if (typeof window === "undefined") return;
        if (activeReasoningEffort) localStorage.setItem(HOSTED_REASONING_EFFORT_KEY, activeReasoningEffort);
        else localStorage.removeItem(HOSTED_REASONING_EFFORT_KEY);
    }, [activeReasoningEffort, reasoningEffort]);
    const chatModels = useMemo(() => {
        return textModelValues.map((value) => {
            const model = modelOptionMeta(canvasConfig, value);
            const effort = resolveHostedReasoningEffort(model, activeReasoningEffort);
            const formatted = formatCanvasAgentTurnPrice(t, canvasAgentTurnCost(model, effort, agentPricing));
            return {
                value,
                label: modelOptionLabel(canvasConfig, value),
                price: formatted.price,
                comparePrice: formatted.comparePrice,
            };
        });
    }, [activeReasoningEffort, agentPricing, canvasConfig, t, textModelValues]);
    const currentTurnCost = canvasAgentTurnCost(hostedTextModel, activeReasoningEffort, agentPricing);
    const currentTurnPrice = currentTurnCost.effective;
    const currentTurnComparePrice = currentTurnCost.standard !== undefined && currentTurnPrice !== undefined && currentTurnCost.standard > currentTurnPrice
        ? String(currentTurnCost.standard)
        : undefined;
    const reasoningEffortPrices = useMemo(() => Object.fromEntries(
        hostedReasoningEfforts.map((effort) => {
            const formatted = formatCanvasAgentTurnPrice(t, canvasAgentTurnCost(hostedTextModel, effort, agentPricing));
            return [effort, formatted.price || ""];
        }),
    ) as Partial<Record<AgentReasoningEffort, string>>, [agentPricing, hostedReasoningEfforts, hostedTextModel, t]);
    const reasoningEffortComparePrices = useMemo(() => Object.fromEntries(
        hostedReasoningEfforts.map((effort) => {
            const formatted = formatCanvasAgentTurnPrice(t, canvasAgentTurnCost(hostedTextModel, effort, agentPricing));
            return [effort, formatted.comparePrice || ""];
        }),
    ) as Partial<Record<AgentReasoningEffort, string>>, [agentPricing, hostedReasoningEfforts, hostedTextModel, t]);
    confirmToolsRef.current = confirmTools;

    const lastProjectIdRef = useRef(projectId);
    const restoreSeqRef = useRef(0);
    const followHostedRunRef = useRef<(runId: string, originProjectId: string) => Promise<void>>(async () => undefined);

    useEffect(() => {
        return useAgentStore.subscribe((state) => {
            canvasContextRef.current = state.canvasContext;
        });
    }, []);

    const rejectHostedPendingTool = useCallback((error: Error, recordFailure = false) => {
        const waiter = hostedToolWaiterRef.current;
        hostedToolWaiterRef.current = null;
        if (useAgentStore.getState().pendingTool) setAgentState({ pendingTool: null });
        if (waiter && recordFailure) {
            const detail = error.message;
            addMessage({
                id: `hosted-tool:${waiter.call.requestId}`,
                role: "tool",
                title: waiter.call.title || toolTitle(waiter.call.name, t),
                text: detail,
                detail: toolCallDetail(waiter.call.name, hostedToolInput(waiter.call), "failed", detail),
            });
        }
        waiter?.reject(error);
    }, [addMessage, setAgentState, t]);

    const cancelHostedRun = useCallback((markStopped = false, options?: { keepalive?: boolean }) => {
        const scope = activeRunRef.current;
        let cancellation = Promise.resolve();
        if (scope) {
            activeRunRef.current = null;
            scope.controller.abort();
            cancellation = scope.runId
                ? cancelHostedAgentRun(scope.runId, options)
                : scope.waitForRunId.then((runId) => cancelHostedAgentRun(runId, options));
            void cancellation.catch(() => undefined);
        }
        rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolCanceled")));
        if (!scope) return cancellation;
        const current = useAgentStore.getState();
        setAgentState({
            sending: false,
            waiting: false,
            activity: "",
            ...(markStopped ? {
                messages: settleHostedAgentMessagesOnStop(current.messages, t("agent.message.stopped")),
            } : {}),
        });
        return cancellation;
    }, [rejectHostedPendingTool, setAgentState, t]);
    const cancelHostedRunRef = useRef(cancelHostedRun);
    cancelHostedRunRef.current = cancelHostedRun;

    useEffect(() => {
        return () => {
            void cancelHostedRunRef.current(true);
        };
    }, []);

    useEffect(() => registerHostedAgentRunStopper((targetProjectId, options) => {
        const scope = activeRunRef.current;
        if (!scope || scope.projectId !== targetProjectId) return Promise.resolve();
        return cancelHostedRunRef.current(true, options);
    }), []);

    useEffect(() => {
        const previousProjectId = lastProjectIdRef.current;
        const switched = Boolean(previousProjectId && previousProjectId !== projectId);
        lastProjectIdRef.current = projectId;
        const current = useAgentStore.getState();
        const stateMatchesProject = isHostedAgentStateForProject(current.hostedProjectId, projectId);
        const projectStateChanged = switched || !stateMatchesProject;
        if (projectStateChanged) {
            cancelHostedRun(true);
            setHostedTab("chat");
            setConversations([]);
            setCurrentConversationId("");
            setAgentState({ hostedProjectId: projectId, messages: [], prompt: "", attachments: [], canvasReferences: [], sending: false, waiting: false, activeTab: "chat" });
        }
        if (!projectId) return;
        if (!projectStateChanged && (current.messages.length > 0 || current.sending || current.waiting)) {
            setHydrating(false);
            void listCanvasAgentConversations(projectId).then((items) => {
                if (useAgentStore.getState().canvasContext?.snapshot.projectId !== projectId) return;
                setConversations(items);
                setCurrentConversationId(readHostedAgentConversationId(projectId) || items[0]?.id || "");
            }).catch(() => undefined);
            return;
        }
        const seq = ++restoreSeqRef.current;
        const controller = new AbortController();
        const titles = hostedMessageTitles(t);
        const applyConversation = (conversation: CanvasAgentConversation | null) => {
            if (seq !== restoreSeqRef.current || !conversation?.id) return false;
            writeHostedAgentConversationId(projectId, conversation.id);
            setCurrentConversationId(conversation.id);
            setAgentState({ hostedProjectId: projectId, messages: hostedAgentMessagesFromConversation(conversation.messages, titles) });
            return true;
        };
        setHydrating(true);
        void listCanvasAgentConversations(projectId, controller.signal)
            .then(async (items) => {
                if (seq !== restoreSeqRef.current) return;
                setConversations(items);
                const cachedId = readHostedAgentConversationId(projectId);
                const selected = (cachedId && items.find((item) => item.id === cachedId)) || items[0] || null;
                if (!applyConversation(selected)) return;
                const runs = await listActiveCanvasAgentRuns(controller.signal);
                if (seq !== restoreSeqRef.current) return;
                const active = runs.find((run) => run.conversationId === selected?.id && !isHostedAgentRunIdRetired(run.id) && (run.status === "queued" || run.status === "running"));
                if (active?.id) void followHostedRunRef.current(active.id, projectId);
            })
            .catch((error) => {
                if (seq !== restoreSeqRef.current || controller.signal.aborted) return;
                if (error instanceof StarcloudsApiError && error.status === 404) clearHostedAgentConversationId(projectId);
            })
            .finally(() => {
                if (seq === restoreSeqRef.current) setHydrating(false);
            });
        return () => {
            restoreSeqRef.current += 1;
            controller.abort();
        };
    }, [cancelHostedRun, projectId, setAgentState, t]);

    useEffect(() => {
        const current = useAgentStore.getState();
        if (current.messages.some(isLeftoverCodexMessage) || current.pendingApprovals.length) {
            setAgentState({
                messages: current.messages.filter((item) => !isLeftoverCodexMessage(item)),
                pendingApprovals: [],
                activeTab: "chat",
                ...(current.sending || current.waiting ? {} : { pendingTool: null }),
            });
        } else if (!current.sending && !current.waiting && current.pendingTool) {
            setAgentState({ pendingTool: null, activeTab: "chat" });
        } else {
            setAgentState({ activeTab: "chat" });
        }
    }, [setAgentState]);

    const refreshConversations = useCallback(async (signal?: AbortSignal) => {
        if (!projectId) {
            setConversations([]);
            return [];
        }
        setLoadingHistory(true);
        try {
            const items = await listCanvasAgentConversations(projectId, signal);
            if (useAgentStore.getState().canvasContext?.snapshot.projectId !== projectId) return [];
            setConversations(items);
            return items;
        } catch (error) {
            if (signal?.aborted) return [];
            throw error;
        } finally {
            if (!signal?.aborted) setLoadingHistory(false);
        }
    }, [projectId]);

    const startNewChat = useCallback(() => {
        cancelHostedRun();
        restoreSeqRef.current += 1;
        setHydrating(false);
        setHostedTab("chat");
        setAgentState({ hostedProjectId: projectId, messages: [], prompt: "", attachments: [], canvasReferences: [], sending: false, waiting: false });
        if (!projectId) {
            setCurrentConversationId("");
            return;
        }
        void beginHostedAgentConversation(projectId)
            .then((conversation) => {
                if (useAgentStore.getState().canvasContext?.snapshot.projectId !== projectId) return;
                setCurrentConversationId(conversation.id);
                setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
            })
            .catch(() => message.error(t("agent.runtime.newConversationFailed")));
    }, [cancelHostedRun, message, projectId, setAgentState, t]);

    const resumeConversation = useCallback(async (conversationId: string) => {
        if (!projectId || !conversationId) return;
        if (conversationId === currentConversationId) {
            setHostedTab("chat");
            return;
        }
        cancelHostedRun();
        restoreSeqRef.current += 1;
        const seq = restoreSeqRef.current;
        setHydrating(true);
        try {
            const conversation = await fetchCanvasAgentConversation(conversationId, undefined, projectId);
            if (seq !== restoreSeqRef.current) return;
            writeHostedAgentConversationId(projectId, conversation.id);
            setCurrentConversationId(conversation.id);
            setConversations((current) => {
                const next = current.filter((item) => item.id !== conversation.id);
                return [conversation, ...next];
            });
            setAgentState({
                hostedProjectId: projectId,
                messages: hostedAgentMessagesFromConversation(conversation.messages, hostedMessageTitles(t)),
                sending: false,
                waiting: false,
            });
            setHostedTab("chat");
            const runs = await listActiveCanvasAgentRuns();
            if (seq !== restoreSeqRef.current) return;
            const active = runs.find((run) => run.conversationId === conversation.id && !isHostedAgentRunIdRetired(run.id) && (run.status === "queued" || run.status === "running"));
            if (active?.id) void followHostedRunRef.current(active.id, projectId);
        } catch (error) {
            if (seq !== restoreSeqRef.current) return;
            message.error(error instanceof Error ? error.message : t("agent.runtime.resumeConversationFailed"));
        } finally {
            if (seq === restoreSeqRef.current) setHydrating(false);
        }
    }, [cancelHostedRun, currentConversationId, message, projectId, setAgentState, t]);

    const confirmDeleteConversations = useCallback((conversationIds: string[]) => {
        if (!conversationIds.length) return;
        setPendingDeleteIds(conversationIds);
    }, []);

    const deletePendingConversations = useCallback(async () => {
        if (!pendingDeleteIds?.length || deletingHistory) return;
        const conversationIds = pendingDeleteIds;
        const deletingCurrent = conversationIds.includes(currentConversationId);
        setDeletingHistory(true);
        try {
            for (const id of conversationIds) {
                await deleteCanvasAgentConversation(id, deletingCurrent && id === currentConversationId && (sending || waiting));
            }
            if (useAgentStore.getState().canvasContext?.snapshot.projectId !== projectId) return;
            const remaining = conversations.filter((item) => !conversationIds.includes(item.id));
            setConversations(remaining);
            setPendingDeleteIds(null);
            if (deletingCurrent) {
                cancelHostedRun();
                if (remaining[0]) {
                    await resumeConversation(remaining[0].id);
                } else {
                    clearHostedAgentConversationId(projectId);
                    setCurrentConversationId("");
                    setAgentState({ messages: [], sending: false, waiting: false });
                    setHostedTab("chat");
                }
            }
            message.success(t("agent.runtime.recordsDeleted", { count: conversationIds.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.runtime.deleteConversationFailed"));
        } finally {
            setDeletingHistory(false);
        }
    }, [cancelHostedRun, conversations, currentConversationId, deletingHistory, message, pendingDeleteIds, projectId, resumeConversation, sending, setAgentState, t, waiting]);

    const runHostedTool = useCallback(async (call: CanvasAgentToolCall, scope: HostedAgentRunBinding, verifyBeforeExecution?: () => Promise<boolean>) => {
        const messageId = `hosted-tool:${call.requestId}`;
        const title = call.title || toolTitle(call.name, t);
        const input = hostedToolInput(call);
        const requireOriginCanvas = () => {
            const canvas = canvasContextRef.current;
            if (!canvas || !isHostedAgentRunScopeActive(scope, activeRunRef.current, canvas.snapshot.projectId)) {
                throw new Error(t("agent.runtime.canvasToolCanceled"));
            }
            return canvas;
        };
        const upsertToolMessage = (patch: Partial<AgentChatItem>) => {
            requireOriginCanvas();
            const current = useAgentStore.getState();
            const index = current.messages.findIndex((item) => item.id === messageId);
            const base: AgentChatItem = { id: messageId, role: "tool", title, text: "" };
            setAgentState({
                messages: index >= 0
                    ? current.messages.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
                    : [...current.messages, { ...base, ...patch }],
            });
        };
        try {
            upsertToolMessage({ text: hostedToolRunningText(call.name, title, t), detail: toolCallDetail(call.name, input, "running") });
            if (isCanvasWriteTool(call.name) || call.name === "canvas_run_generation") await waitForCanvasAgentToolPaint();
            requireOriginCanvas();
            if (verifyBeforeExecution && !(await verifyBeforeExecution())) throw new Error(t("agent.runtime.canvasToolExpired"));
            const canvas = requireOriginCanvas();
            const observation = await runCanvasAgentTool(call, {
                ...canvas,
                readSnapshot: () => requireOriginCanvas().snapshot,
                attachments: scope.attachments,
                navigate,
            });
            requireOriginCanvas();
            upsertToolMessage({ text: describeToolObservation(call.name, observation, t), detail: toolCallDetail(call.name, input, "completed") });
            return observation;
        } catch (error) {
            const detail = error instanceof Error ? error.message : t("agent.runtime.toolExecutionFailed");
            if (isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "")) {
                upsertToolMessage({ text: detail, detail: toolCallDetail(call.name, input, "failed", detail) });
            }
            throw error;
        }
    }, [navigate, setAgentState, t]);

    const handleServerHostedToolEvent = useCallback(async (call: CanvasAgentToolCall, scope: HostedAgentRunBinding) => {
        if (!isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "")) return;
        const messageId = `hosted-tool:${call.requestId}`;
        const title = call.title || toolTitle(call.name, t);
        const input = hostedToolInput(call);
        const status = call.status || "running";
        const current = useAgentStore.getState();
        const index = current.messages.findIndex((item) => item.id === messageId);
        const existingStatus = index >= 0 ? String((current.messages[index].detail as { status?: string } | undefined)?.status || "") : "";
        if (status === "running" && (existingStatus === "completed" || existingStatus === "failed")) return call.result;
        const detail = call.error || (status === "failed" ? t("agent.hosted.webSearchFailed") : "");
        const text = status === "completed"
            ? describeToolObservation(call.name, call.result, t)
            : status === "failed"
                ? detail
                : hostedToolRunningText(call.name, title, t);
        const item: AgentChatItem = {
            id: messageId,
            role: "tool",
            title,
            text,
            detail: toolCallDetail(call.name, input, status, detail),
        };
        setAgentState({
            messages: index >= 0
                ? current.messages.map((messageItem, itemIndex) => (itemIndex === index ? { ...messageItem, ...item } : messageItem))
                : [...current.messages, item],
        });
        return call.result;
    }, [setAgentState, t]);

    const handleHostedStage = useCallback((stage: string, scope: HostedAgentRunScope) => {
        if (stage === "tool" && isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "")) {
            setAgentState({ activity: t("agent.hosted.applying") });
        }
        if (stage === "web_search" && isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "")) {
            setAgentState({ activity: t("agent.hosted.webSearching") });
        }
    }, [setAgentState, t]);

    const handleHostedToolCall = useCallback((call: CanvasAgentToolCall, scope: HostedAgentRunBinding) => {
        if (call.execution === "server") return handleServerHostedToolEvent(call, scope);
        const verifyBeforeExecution = async () => {
            if (!isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "")) return false;
            const allowed = await canExecuteApprovedCanvasAgentTool(call, scope.runId, claimCanvasAgentTool);
            return allowed && isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "");
        };
        if (confirmToolsRef.current && isCanvasWriteTool(call.name)) {
            if (hostedToolWaiterRef.current) return Promise.reject(new Error(t("agent.runtime.pendingCanvasTool")));
            return new Promise<void>((resolve, reject) => {
                hostedToolWaiterRef.current = { call, resolve: () => resolve(), reject };
                setAgentState({
                    pendingTool: { requestId: call.requestId, name: call.name, input: hostedToolInput(call) },
                });
            }).then(() => runHostedTool(call, scope, verifyBeforeExecution));
        }
        return runHostedTool(call, scope, verifyBeforeExecution);
    }, [handleServerHostedToolEvent, runHostedTool, setAgentState, t]);

    const applyCompletionOps = useCallback(async (ops: CanvasAgentOp[], scope: HostedAgentRunBinding, summary?: string) => {
        if (!ops.length) return;
        const currentProjectId = canvasContextRef.current?.snapshot.projectId || "";
        if (!isHostedAgentRunScopeActive(scope, activeRunRef.current, currentProjectId)) return;
        if (confirmToolsRef.current) {
            try {
                await handleHostedToolCall({
                    requestId: `completion:${randomId()}`,
                    name: "canvas_apply_ops",
                    arguments: JSON.stringify({ ops }),
                }, scope);
            } catch (error) {
                if (error instanceof Error && error.message === t("agent.runtime.canvasToolCanceled")) return;
                throw error;
            }
            return;
        }
        const liveContext = canvasContextRef.current;
        if (!liveContext || !isHostedAgentRunScopeActive(scope, activeRunRef.current, liveContext.snapshot.projectId)) return;
        const before = liveContext.snapshot.connections.length;
        const next = liveContext.applyOps(ops);
        const linked = Math.max(0, next.connections.length - before);
        addMessage({
            id: randomId(),
            role: "tool",
            title: t("agent.eventExtra.tools.canvasOps"),
            text: [summary || summarizeCanvasAgentOps(ops) || t("agent.hosted.applied"), linked ? t("agent.hosted.linked", { count: linked }) : ""].filter(Boolean).join(" · "),
        });
    }, [addMessage, handleHostedToolCall, t]);

    const approvePendingTool = useCallback(() => {
        const waiter = hostedToolWaiterRef.current;
        if (!waiter) return;
        hostedToolWaiterRef.current = null;
        setAgentState({ pendingTool: null });
        waiter.resolve();
    }, [setAgentState]);

    const rejectPendingTool = useCallback(() => {
        rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolCanceled")));
    }, [rejectHostedPendingTool, t]);

    const stopTurn = useCallback(() => {
        cancelHostedRun(true);
    }, [cancelHostedRun]);

    const followHostedRun = useCallback(async (runId: string, originProjectId: string) => {
        if (!runId || !originProjectId || isHostedAgentRunIdRetired(runId)) return;
        const currentContext = canvasContextRef.current;
        if (!currentContext || currentContext.snapshot.projectId !== originProjectId) return;
        if (activeRunRef.current?.runId === runId && activeRunRef.current.projectId === originProjectId) return;
        cancelHostedRun();
        const controller = new AbortController();
        const scope = createHostedAgentRunBinding(originProjectId, [], controller);
        scope.runId = runId;
        scope.resolveRunId(runId);
        activeRunRef.current = scope;
        const scopeIsActive = () => isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "");
        setAgentState({ sending: true, waiting: true });
        const currentMessages = useAgentStore.getState().messages;
        let assistantId = [...currentMessages].reverse().find((item) => item.role === "assistant")?.id;
        if (!assistantId) {
            assistantId = randomId();
            addMessage({ id: assistantId, role: "assistant", title: t("agent.hosted.subtitle"), text: "", streamId: assistantId });
        } else {
            setAgentState({
                messages: useAgentStore.getState().messages.map((item) => (item.id === assistantId ? { ...item, streamId: item.streamId || assistantId } : item)),
            });
        }
        const reasoningId = `${assistantId}:reasoning`;
        const patchAssistant = (patch: Partial<AgentChatItem>) => {
            if (!scopeIsActive()) return;
            setAgentState({
                messages: useAgentStore.getState().messages.map((item) => (item.id === assistantId ? { ...item, ...patch } : item)),
            });
        };
        const patchReasoning = (reasoning: string, status: "inProgress" | "completed", tokens = 0) => {
            if (!scopeIsActive()) return;
            const text = reasoning.trim();
            if (!text) return;
            const detail = { kind: "reasoning", status, ...(activeReasoningEffort ? { effort: activeReasoningEffort } : {}), ...(tokens > 0 ? { tokens } : {}) };
            const current = useAgentStore.getState();
            const existingIndex = current.messages.findIndex((item) => item.id === reasoningId);
            if (existingIndex >= 0) {
                setAgentState({ messages: current.messages.map((item) => (item.id === reasoningId ? { ...item, text, detail } : item)) });
                return;
            }
            const nextMessages = [...current.messages];
            const assistantIndex = nextMessages.findIndex((item) => item.id === assistantId);
            nextMessages.splice(assistantIndex >= 0 ? assistantIndex : nextMessages.length, 0, {
                id: reasoningId,
                role: "tool",
                title: t("agent.events.reasoning"),
                text,
                detail,
            });
            setAgentState({ messages: nextMessages });
        };
        try {
            const result = await waitForCanvasAgentRun(
                runId,
                (next) => patchAssistant({ text: next }),
                controller.signal,
                (call) => handleHostedToolCall(call, scope),
                (next) => patchReasoning(next, "inProgress"),
                (stage) => handleHostedStage(stage, scope),
            );
            if (!scopeIsActive()) return;
            const ops = (result.ops || []).filter((op): op is CanvasAgentOp => Boolean(op?.type));
            const summary = result.summary;
            if (result.reasoning) {
                patchReasoning(result.reasoning, "completed", result.reasoningTokens || 0);
            } else if (result.reasoningTokens) {
                patchReasoning(t("agent.hosted.reasoningNotReturned"), "completed", result.reasoningTokens);
            }
            patchAssistant({ text: ops.length ? summary || t("agent.hosted.applied") : result.text, streamId: undefined });
            // A timed-out server tool can still own the manual confirmation slot.
            // Retire it before offering the local completion fallback for approval.
            rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolExpired")), true);
            await applyCompletionOps(ops, scope, summary);
        } catch (error) {
            if (!scopeIsActive()) return;
            const detail = hostedAgentErrorText(error, t("agent.hosted.failed"), t("agent.hosted.authFailed"), t("agent.hosted.interrupted"));
            setAgentState({ messages: settleHostedAgentMessagesOnStop(useAgentStore.getState().messages, detail) });
            patchAssistant({ role: "error", text: detail, streamId: undefined });
            message.error(detail);
        } finally {
            if (activeRunRef.current === scope) {
                activeRunRef.current = null;
                setAgentState({ sending: false, waiting: false, activity: "" });
            }
        }
    }, [activeReasoningEffort, addMessage, applyCompletionOps, cancelHostedRun, handleHostedStage, handleHostedToolCall, message, rejectHostedPendingTool, setAgentState, t]);
    followHostedRunRef.current = followHostedRun;

    const addAttachments = useCallback(async (files: FileList | File[] | null) => {
        if (!files) return;
        const images = Array.from(files).filter((file) => file.type.startsWith("image/"));
        const prev = useAgentStore.getState().attachments;
        try {
            const next = await Promise.all(
                images.slice(0, Math.max(0, MAX_ATTACHMENTS - prev.length)).map(async (file) => {
                    const dataUrl = await readFileDataUrl(file);
                    const meta = await readImageMeta(dataUrl);
                    return { id: randomId(), name: file.name, type: file.type, size: file.size, width: meta.width, height: meta.height, url: dataUrl, dataUrl };
                }),
            );
            const merged = [...prev, ...next];
            if (attachmentPayloadBytes(merged) > MAX_ATTACHMENT_PAYLOAD_BYTES) {
                message.warning(t("agent.runtime.imageLimit"));
                return;
            }
            if (next.length) setAgentState({ attachments: merged });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("agent.runtime.imageReadFailed"));
        }
    }, [message, setAgentState, t]);

    const sendPrompt = useCallback(async () => {
        const state = useAgentStore.getState();
        const text = state.prompt.trim();
        const context = canvasContextRef.current;
        const files = state.attachments;
        const canvasReferences = state.canvasReferences;
        if ((!text && !files.length && !canvasReferences.length) || !context || state.sending || state.waiting) return;
        const controller = new AbortController();
        const scope = createHostedAgentRunBinding(context.snapshot.projectId, [...files], controller);
        activeRunRef.current = scope;
        const scopeIsActive = () => isHostedAgentRunScopeActive(scope, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "");
        const userId = randomId();
        const assistantId = randomId();
        const reasoningId = randomId();
        const userText = text || t(files.length ? "agent.runtime.imagesSent" : "agent.runtime.canvasReferencesSent", { count: files.length || canvasReferences.length });
        setAgentState({ hostedProjectId: context.snapshot.projectId });
        addMessage({ id: userId, role: "user", text: userText, attachments: files });
        addMessage({ id: assistantId, role: "assistant", title: t("agent.hosted.subtitle"), text: "", streamId: assistantId });
        setAgentState({ prompt: "", attachments: [], canvasReferences: [], sending: true, waiting: true });
        const patchAssistant = (patch: Partial<AgentChatItem>) => {
            if (!scopeIsActive()) return;
            const current = useAgentStore.getState();
            setAgentState({
                messages: current.messages.map((item) => (item.id === assistantId ? { ...item, ...patch } : item)),
            });
        };
        const patchReasoning = (reasoning: string, status: "inProgress" | "completed", tokens = 0) => {
            if (!scopeIsActive()) return;
            const text = reasoning.trim();
            if (!text) return;
            const current = useAgentStore.getState();
            const detail = { kind: "reasoning", status, ...(activeReasoningEffort ? { effort: activeReasoningEffort } : {}), ...(tokens > 0 ? { tokens } : {}) };
            const existingIndex = current.messages.findIndex((item) => item.id === reasoningId);
            if (existingIndex >= 0) {
                setAgentState({ messages: current.messages.map((item) => (item.id === reasoningId ? { ...item, text, detail } : item)) });
                return;
            }
            const nextMessages = [...current.messages];
            const assistantIndex = nextMessages.findIndex((item) => item.id === assistantId);
            nextMessages.splice(assistantIndex >= 0 ? assistantIndex : nextMessages.length, 0, {
                id: reasoningId,
                role: "tool",
                title: t("agent.events.reasoning"),
                text,
                detail,
            });
            setAgentState({ messages: nextMessages });
        };
        try {
            let referenceImages = files.map((item) => ({ id: item.id, name: item.name, dataUrl: item.dataUrl }));
            if (canvasReferences.some((item) => item.kind === "image") && referenceImages.length < MAX_ATTACHMENTS) {
                const extra = await resolveCanvasReferenceImages(canvasReferences, context.snapshot.nodes || []);
                referenceImages = [...referenceImages, ...extra.map((item) => ({ id: item.id, name: item.name, dataUrl: item.dataUrl }))].slice(0, MAX_ATTACHMENTS);
            }
            const requestPrompt = appendAttachmentCatalog(promptWithCanvasReferences(promptWithAttachments(text, files), canvasReferences), files);
            const result = await requestCanvasAgentTurn(requestPrompt, {
                projectId: context.snapshot.projectId,
                model: hostedModel || canvasConfig.textModel,
                snapshot: context.snapshot,
                signal: controller.signal,
                referenceImages,
                onCreated: (runId) => {
                    scope.resolveRunId(runId);
                    const stillActive = bindHostedAgentRunId(scope, runId, activeRunRef.current, canvasContextRef.current?.snapshot.projectId || "");
                    if (!stillActive) void cancelHostedAgentRun(runId).catch(() => undefined);
                },
                onDelta: (next) => patchAssistant({ text: next }),
                onReasoning: (next) => patchReasoning(next, "inProgress"),
                onToolCall: (call) => handleHostedToolCall(call, scope),
                onStage: (stage) => handleHostedStage(stage, scope),
                ...(activeReasoningEffort ? { reasoningEffort: activeReasoningEffort } : {}),
            });
            if (!scopeIsActive()) return;
            const ops = (result.ops || []).filter((op): op is CanvasAgentOp => Boolean(op?.type));
            const summary = result.summary;
            if (result.reasoning) {
                patchReasoning(result.reasoning, "completed", result.reasoningTokens || 0);
            } else if (result.reasoningTokens) {
                patchReasoning(t("agent.hosted.reasoningNotReturned"), "completed", result.reasoningTokens);
            }
            patchAssistant({ text: ops.length ? summary || t("agent.hosted.applied") : result.text, streamId: undefined });
            rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolExpired")), true);
            await applyCompletionOps(ops, scope, summary);
        } catch (error) {
            if (!scopeIsActive()) return;
            const detail = hostedAgentErrorText(error, t("agent.hosted.failed"), t("agent.hosted.authFailed"), t("agent.hosted.interrupted"));
            setAgentState({ messages: settleHostedAgentMessagesOnStop(useAgentStore.getState().messages, detail) });
            patchAssistant({ role: "error", text: detail, streamId: undefined });
            message.error(detail);
        } finally {
            scope.resolveRunId(scope.runId);
            if (activeRunRef.current === scope) {
                activeRunRef.current = null;
                setAgentState({ sending: false, waiting: false, activity: "" });
                void refreshConversations().catch(() => undefined);
            }
        }
    }, [activeReasoningEffort, addMessage, applyCompletionOps, canvasConfig.textModel, handleHostedStage, handleHostedToolCall, hostedModel, message, refreshConversations, rejectHostedPendingTool, setAgentState, t]);

    const empty = hostedTab === "chat" && messages.length === 0 && !sending && !waiting && !hydrating && !pendingTool;
    const historyThreads = useMemo(() => conversations.map(hostedAgentConversationThread), [conversations]);

    return (
        <>
            <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-3" style={{ boxShadow: `inset 0 -1px 0 ${theme.sidebar.border}` }}>
                <div className="flex min-w-0 items-center gap-2">
                    <img src="/sucai/starcloud-fcdd57fe8811-1.webp" alt="" className="size-7 shrink-0 rounded-md object-contain" />
                    <div className="min-w-0 truncate text-[15px] font-semibold tracking-tight">{t("agent.hosted.heading")}</div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                    <div
                        className="flex items-center rounded-full p-0.5"
                        style={{ background: theme.toolbar.itemHover }}
                        role="tablist"
                        aria-label={t("agent.panel.content")}
                    >
                        {([
                            { value: "chat" as const, label: t("agent.panel.chat"), icon: <MessageSquare className="size-3.5" /> },
                            { value: "history" as const, label: t("agent.panel.history"), icon: <History className="size-3.5" />, count: conversations.length },
                        ]).map((item) => {
                            const active = hostedTab === item.value;
                            return (
                                <button
                                    key={item.value}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    aria-label={item.count ? `${item.label} ${item.count}` : item.label}
                                    className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium transition"
                                    style={{
                                        background: active ? theme.toolbar.panel : "transparent",
                                        color: active ? theme.node.text : theme.node.muted,
                                        boxShadow: active ? theme.toolbar.shadow : undefined,
                                    }}
                                    onClick={() => {
                                        setHostedTab(item.value);
                                        if (item.value === "history") void refreshConversations().catch(() => undefined);
                                    }}
                                >
                                    {item.icon}
                                    <span>{item.label}</span>
                                    {item.count ? <span className="text-[10px] tabular-nums opacity-55">{item.count > 99 ? "99+" : item.count}</span> : null}
                                </button>
                            );
                        })}
                    </div>
                    <Tooltip title={t("agent.hosted.newChat")} placement="bottom">
                        <Button
                            type="text"
                            shape="circle"
                            className="!h-8 !w-8 !min-w-8"
                            aria-label={t("agent.hosted.newChat")}
                            disabled={sending || waiting}
                            icon={<Plus className="size-4" />}
                            onClick={startNewChat}
                        />
                    </Tooltip>
                    <Tooltip title={t("agent.panel.collapse")}>
                        <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" aria-label={t("agent.panel.collapseLabel")} style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-4" />} onClick={closePanel} />
                    </Tooltip>
                </div>
            </header>
            <div className="relative flex min-h-0 flex-1 flex-col">
                {hostedTab === "history" ? (
                    <HostedAgentHistory
                        theme={theme}
                        threads={historyThreads}
                        activeThreadId={currentConversationId}
                        loading={loadingHistory}
                        busy={sending || waiting || hydrating}
                        emptyText={t("agent.hosted.noHistory")}
                        onResumeThread={(conversationId) => void resumeConversation(conversationId)}
                        onDeleteThread={(conversationId) => confirmDeleteConversations([conversationId])}
                    />
                ) : empty ? (
                    <div className="flex min-h-0 flex-1 items-center justify-center px-8 pb-4 text-center">
                        <p className="max-w-[260px] text-[13px] leading-5" style={{ color: theme.node.muted }}>{t("agent.hosted.empty")}</p>
                    </div>
                ) : (
                    <AgentChatTimeline
                        theme={theme}
                        pendingTool={pendingTool}
                        pendingApprovals={[]}
                        sending={sending}
                        waiting={waiting}
                        onRejectTool={() => void rejectPendingTool()}
                        onApproveTool={() => void approvePendingTool()}
                        onApprovalDecision={() => undefined}
                    />
                )}
            </div>
            {hostedTab === "chat" ? (
            <AgentChatComposer
                prompt={prompt}
                attachments={attachments.map((item) => ({ id: item.id, name: item.name, url: item.url }))}
                disabled={!projectId}
                sending={sending || waiting}
                placeholder={t("agent.hosted.placeholder")}
                hint={t("agent.hosted.composerHint")}
                theme={theme}
                reasoningEffort={activeReasoningEffort}
                reasoningEfforts={hostedReasoningEfforts}
                reasoningEffortPrices={reasoningEffortPrices}
                reasoningEffortComparePrices={reasoningEffortComparePrices}
                chatModels={chatModels}
                chatModel={hostedModel}
                onChatModelChange={(model) => {
                    localStorage.setItem(HOSTED_MODEL_KEY, model);
                    setHostedModel(model);
                }}
                confirmTools={confirmTools}
                onConfirmToolsChange={(next) => {
                    localStorage.setItem(HOSTED_CONFIRM_TOOLS_KEY, next ? "1" : "0");
                    setConfirmTools(next);
                }}
                onReasoningEffortChange={(effort) => {
                    if (!VALID_HOSTED_REASONING_EFFORTS.has(effort as ModelReasoningEffort)) return;
                    const hostedEffort = effort as ModelReasoningEffort;
                    localStorage.setItem(HOSTED_REASONING_EFFORT_KEY, hostedEffort);
                    setReasoningEffort(hostedEffort);
                }}
                onPromptChange={(next) => setAgentState({ prompt: next })}
                onAddFiles={(files) => void addAttachments(files)}
                onRemoveAttachment={(id) => setAgentState({ attachments: useAgentStore.getState().attachments.filter((item) => item.id !== id) })}
                sendCost={currentTurnPrice === undefined ? undefined : String(currentTurnPrice)}
                sendCompareCost={currentTurnComparePrice}
                onSubmit={() => void sendPrompt()}
                onStop={stopTurn}
            />
            ) : null}
            <CanvasHomeDialog
                open={Boolean(pendingDeleteIds?.length)}
                tone="danger"
                eyebrow={t("agent.hosted.deleteChat")}
                title={t("agent.runtime.deleteConversations", { count: pendingDeleteIds?.length || 0 })}
                description={t("agent.runtime.deleteConversationsDescription")}
                closeLabel={t("common.cancel")}
                onClose={() => {
                    if (!deletingHistory) setPendingDeleteIds(null);
                }}
                footer={
                    <>
                        <button type="button" className="sc-cd-btn" disabled={deletingHistory} onClick={() => setPendingDeleteIds(null)}>
                            {t("common.cancel")}
                        </button>
                        <button type="button" className="sc-cd-btn is-danger" disabled={deletingHistory} onClick={() => void deletePendingConversations()}>
                            {t("common.delete")}
                        </button>
                    </>
                }
            />
        </>
    );
}

function appendAttachmentCatalog(prompt: string, attachments: AgentAttachment[]) {
    if (!attachments.length) return prompt;
    const list = attachments.map((item) => `- id=${item.id} name=${JSON.stringify(item.name)}`).join("\n");
    return `${prompt}\n\n本轮聊天附件，可用 canvas_create_attachment_nodes 放到画布：\n${list}`;
}

function readFileDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(file);
    });
}
