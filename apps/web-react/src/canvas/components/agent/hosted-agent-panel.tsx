import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Tooltip } from "antd";
import { ArrowUpRight, History, MessageSquare, PanelRightClose, Plus, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { canvasThemes } from "@/lib/canvas-theme";
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
    if (name === "canvas_get_state") return t("agent.eventExtra.tools.readCanvas");
    if (name === "canvas_get_selection") return t("agent.eventExtra.tools.readSelection");
    if (name === "canvas_export_snapshot") return t("agent.eventExtra.tools.exportSnapshot");
    if (name === "canvas_run_generation") return t("agent.eventExtra.tools.runGeneration");
    if (name === "canvas_generation_status") return t("agent.hosted.generationStatus");
    if (name === "canvas_create_attachment_nodes") return t("agent.eventExtra.tools.addAttachments");
    if (name === "site_navigate") return t("agent.eventExtra.tools.openPage");
    if (name === "canvas_list_projects") return t("agent.siteTools.canvasList");
    if (name === "prompts_search") return t("agent.siteTools.promptSearch");
    if (name === "assets_list") return t("agent.siteTools.assetList");
    if (name === "assets_add") return t("agent.siteTools.assetAdd");
    return t("agent.eventExtra.tools.canvasOps");
}

function hostedToolRunningText(name: string, title: string, t: Translate) {
    if (["canvas_get_state", "canvas_get_selection", "canvas_export_snapshot", "canvas_list_projects", "prompts_search", "assets_list"].includes(name)) return t("agent.hosted.toolReading");
    if (["canvas_apply_ops", "canvas_create_attachment_nodes", "assets_add"].includes(name)) return t("agent.hosted.toolModifying");
    if (["canvas_run_generation", "canvas_generation_status"].includes(name)) return t("agent.hosted.toolGenerating");
    return t("agent.hosted.toolWorking", { tool: title });
}

function describeToolObservation(name: string, observation: unknown, t: Translate) {
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
    if (name === "site_navigate") {
        return t("agent.hosted.openedPage", { path: String((observation as { path?: string })?.path || "/") });
    }
    if (name === "canvas_create_attachment_nodes") {
        return t("agent.hosted.attachmentNodes", { count: (observation as { added?: string[] })?.added?.length || 0 });
    }
    if (name === "canvas_list_projects" || name === "prompts_search" || name === "assets_list") {
        const total = Number((observation as { total?: number })?.total || 0);
        return t("agent.hosted.listedItems", { count: total });
    }
    if (name === "assets_add") return t("agent.hosted.assetAdded");
    if (name !== "canvas_apply_ops") return t("agent.hosted.readCanvas");
    const applied = observation as { applied?: number; addedNodes?: number; addedConnections?: number };
    return [
        t("agent.hosted.appliedCount", { count: applied?.applied || 0 }),
        applied?.addedNodes ? t("agent.hosted.addedNodes", { count: applied.addedNodes }) : "",
        applied?.addedConnections ? t("agent.hosted.linked", { count: applied.addedConnections }) : "",
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

function hostedAgentErrorText(error: unknown, fallback: string, authFailed: string) {
    const detail = error instanceof Error ? error.message : fallback;
    const lower = detail.toLowerCase();
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
    const abortRef = useRef<AbortController | null>(null);
    const runIdRef = useRef("");
    const turnAttachmentsRef = useRef<AgentAttachment[]>([]);
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
    const followHostedRunRef = useRef<(runId: string) => Promise<void>>(async () => undefined);

    useEffect(() => {
        return useAgentStore.subscribe((state) => {
            canvasContextRef.current = state.canvasContext;
        });
    }, []);

    useEffect(() => {
        if (!projectId) return;
        const previousProjectId = lastProjectIdRef.current;
        const switched = Boolean(previousProjectId && previousProjectId !== projectId);
        lastProjectIdRef.current = projectId;
        if (switched) {
            abortRef.current?.abort();
            abortRef.current = null;
            runIdRef.current = "";
            setHostedTab("chat");
            setConversations([]);
            setCurrentConversationId("");
            setAgentState({ messages: [], prompt: "", attachments: [], canvasReferences: [], sending: false, waiting: false, activeTab: "chat" });
        }
        const current = useAgentStore.getState();
        if (!switched && (current.messages.length > 0 || current.sending || current.waiting)) {
            setHydrating(false);
            void listCanvasAgentConversations(projectId).then((items) => {
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
            setAgentState({ messages: hostedAgentMessagesFromConversation(conversation.messages, titles) });
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
                const active = runs.find((run) => run.conversationId === selected?.id && (run.status === "queued" || run.status === "running"));
                if (active?.id) void followHostedRunRef.current(active.id);
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
    }, [projectId, setAgentState, t]);

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
            setConversations(items);
            return items;
        } catch (error) {
            if (signal?.aborted) return [];
            throw error;
        } finally {
            if (!signal?.aborted) setLoadingHistory(false);
        }
    }, [projectId]);

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

    const startNewChat = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        runIdRef.current = "";
        restoreSeqRef.current += 1;
        rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolCanceled")));
        setHydrating(false);
        setHostedTab("chat");
        setAgentState({ messages: [], prompt: "", attachments: [], canvasReferences: [], sending: false, waiting: false });
        if (!projectId) {
            setCurrentConversationId("");
            return;
        }
        void beginHostedAgentConversation(projectId)
            .then((conversation) => {
                setCurrentConversationId(conversation.id);
                setConversations((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
            })
            .catch(() => message.error(t("agent.runtime.newConversationFailed")));
    }, [message, projectId, rejectHostedPendingTool, setAgentState, t]);

    const resumeConversation = useCallback(async (conversationId: string) => {
        if (!projectId || !conversationId) return;
        if (conversationId === currentConversationId) {
            setHostedTab("chat");
            return;
        }
        abortRef.current?.abort();
        abortRef.current = null;
        runIdRef.current = "";
        restoreSeqRef.current += 1;
        rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolCanceled")));
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
                messages: hostedAgentMessagesFromConversation(conversation.messages, hostedMessageTitles(t)),
                sending: false,
                waiting: false,
            });
            setHostedTab("chat");
            const runs = await listActiveCanvasAgentRuns();
            if (seq !== restoreSeqRef.current) return;
            const active = runs.find((run) => run.conversationId === conversation.id && (run.status === "queued" || run.status === "running"));
            if (active?.id) void followHostedRunRef.current(active.id);
        } catch (error) {
            if (seq !== restoreSeqRef.current) return;
            message.error(error instanceof Error ? error.message : t("agent.runtime.resumeConversationFailed"));
        } finally {
            if (seq === restoreSeqRef.current) setHydrating(false);
        }
    }, [currentConversationId, message, projectId, rejectHostedPendingTool, setAgentState, t]);

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
            const remaining = conversations.filter((item) => !conversationIds.includes(item.id));
            setConversations(remaining);
            setPendingDeleteIds(null);
            if (deletingCurrent) {
                abortRef.current?.abort();
                abortRef.current = null;
                runIdRef.current = "";
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
    }, [conversations, currentConversationId, deletingHistory, message, pendingDeleteIds, projectId, resumeConversation, sending, setAgentState, t, waiting]);

    const runHostedTool = useCallback(async (call: CanvasAgentToolCall, verifyBeforeExecution?: () => Promise<boolean>) => {
        const messageId = `hosted-tool:${call.requestId}`;
        const title = call.title || toolTitle(call.name, t);
        const input = hostedToolInput(call);
        const upsertToolMessage = (patch: Partial<AgentChatItem>) => {
            const current = useAgentStore.getState();
            const index = current.messages.findIndex((item) => item.id === messageId);
            const base: AgentChatItem = { id: messageId, role: "tool", title, text: "" };
            setAgentState({
                messages: index >= 0
                    ? current.messages.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
                    : [...current.messages, { ...base, ...patch }],
            });
        };
        upsertToolMessage({ text: hostedToolRunningText(call.name, title, t), detail: toolCallDetail(call.name, input, "running") });
        try {
            if (isCanvasWriteTool(call.name) || call.name === "canvas_run_generation") await waitForCanvasAgentToolPaint();
            if (verifyBeforeExecution && !(await verifyBeforeExecution())) throw new Error(t("agent.runtime.canvasToolExpired"));
            const canvas = canvasContextRef.current;
            if (!canvas) throw new Error(t("agent.hosted.failed"));
            const observation = await runCanvasAgentTool(call, {
                ...canvas,
                readSnapshot: () => canvasContextRef.current?.snapshot || canvas.snapshot,
                attachments: turnAttachmentsRef.current,
                navigate,
            });
            upsertToolMessage({ text: describeToolObservation(call.name, observation, t), detail: toolCallDetail(call.name, input, "completed") });
            return observation;
        } catch (error) {
            const detail = error instanceof Error ? error.message : t("agent.runtime.toolExecutionFailed");
            upsertToolMessage({ text: detail, detail: toolCallDetail(call.name, input, "failed", detail) });
            throw error;
        }
    }, [navigate, setAgentState, t]);

    const handleHostedStage = useCallback((stage: string) => {
        if (stage === "tool") setAgentState({ activity: t("agent.hosted.applying") });
    }, [setAgentState, t]);

    const handleHostedToolCall = useCallback((call: CanvasAgentToolCall) => {
        const runId = runIdRef.current;
        const verifyBeforeExecution = () => canExecuteApprovedCanvasAgentTool(call, runId, claimCanvasAgentTool);
        if (confirmToolsRef.current && isCanvasWriteTool(call.name)) {
            if (hostedToolWaiterRef.current) return Promise.reject(new Error(t("agent.runtime.pendingCanvasTool")));
            return new Promise<void>((resolve, reject) => {
                hostedToolWaiterRef.current = { call, resolve: () => resolve(), reject };
                setAgentState({
                    pendingTool: { requestId: call.requestId, name: call.name, input: hostedToolInput(call) },
                });
            }).then(() => runHostedTool(call, verifyBeforeExecution));
        }
        return runHostedTool(call, verifyBeforeExecution);
    }, [runHostedTool, setAgentState, t]);

    const applyCompletionOps = useCallback(async (ops: CanvasAgentOp[], summary?: string) => {
        if (!ops.length) return;
        if (confirmToolsRef.current) {
            try {
                await handleHostedToolCall({
                    requestId: `completion:${randomId()}`,
                    name: "canvas_apply_ops",
                    arguments: JSON.stringify({ ops }),
                });
            } catch (error) {
                if (error instanceof Error && error.message === t("agent.runtime.canvasToolCanceled")) return;
                throw error;
            }
            return;
        }
        const liveContext = canvasContextRef.current;
        if (!liveContext) return;
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
        abortRef.current?.abort();
        abortRef.current = null;
        const runId = runIdRef.current;
        runIdRef.current = "";
        rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolCanceled")));
        if (runId) void cancelCanvasAssistantRun(runId).catch(() => undefined);
        setAgentState({ sending: false, waiting: false, activity: "" });
        const current = useAgentStore.getState();
        setAgentState({
            messages: current.messages.map((item) => (item.streamId ? { ...item, streamId: undefined, text: item.text || t("agent.message.stopped") } : item)),
        });
    }, [rejectHostedPendingTool, setAgentState, t]);

    const followHostedRun = useCallback(async (runId: string) => {
        if (!runId || runIdRef.current === runId) return;
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        runIdRef.current = runId;
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
            setAgentState({
                messages: useAgentStore.getState().messages.map((item) => (item.id === assistantId ? { ...item, ...patch } : item)),
            });
        };
        const patchReasoning = (reasoning: string, status: "inProgress" | "completed", tokens = 0) => {
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
                handleHostedToolCall,
                (next) => patchReasoning(next, "inProgress"),
                handleHostedStage,
            );
            if (controller.signal.aborted) return;
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
            await applyCompletionOps(ops, summary);
        } catch (error) {
            if (controller.signal.aborted) return;
            const detail = hostedAgentErrorText(error, t("agent.hosted.failed"), t("agent.hosted.authFailed"));
            patchAssistant({ role: "error", text: detail, streamId: undefined });
            message.error(detail);
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            if (runIdRef.current === runId) runIdRef.current = "";
            setAgentState({ sending: false, waiting: false, activity: "" });
        }
    }, [activeReasoningEffort, addMessage, applyCompletionOps, handleHostedStage, handleHostedToolCall, message, rejectHostedPendingTool, setAgentState, t]);
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
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const userId = randomId();
        const assistantId = randomId();
        const reasoningId = randomId();
        const userText = text || t(files.length ? "agent.runtime.imagesSent" : "agent.runtime.canvasReferencesSent", { count: files.length || canvasReferences.length });
        addMessage({ id: userId, role: "user", text: userText, attachments: files });
        addMessage({ id: assistantId, role: "assistant", title: t("agent.hosted.subtitle"), text: "", streamId: assistantId });
        turnAttachmentsRef.current = files;
        setAgentState({ prompt: "", attachments: [], canvasReferences: [], sending: true, waiting: true });
        const patchAssistant = (patch: Partial<AgentChatItem>) => {
            const current = useAgentStore.getState();
            setAgentState({
                messages: current.messages.map((item) => (item.id === assistantId ? { ...item, ...patch } : item)),
            });
        };
        const patchReasoning = (reasoning: string, status: "inProgress" | "completed", tokens = 0) => {
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
                    runIdRef.current = runId;
                },
                onDelta: (next) => patchAssistant({ text: next }),
                onReasoning: (next) => patchReasoning(next, "inProgress"),
                onToolCall: handleHostedToolCall,
                onStage: handleHostedStage,
                ...(activeReasoningEffort ? { reasoningEffort: activeReasoningEffort } : {}),
            });
            if (controller.signal.aborted) return;
            const ops = (result.ops || []).filter((op): op is CanvasAgentOp => Boolean(op?.type));
            const summary = result.summary;
            if (result.reasoning) {
                patchReasoning(result.reasoning, "completed", result.reasoningTokens || 0);
            } else if (result.reasoningTokens) {
                patchReasoning(t("agent.hosted.reasoningNotReturned"), "completed", result.reasoningTokens);
            }
            patchAssistant({ text: ops.length ? summary || t("agent.hosted.applied") : result.text, streamId: undefined });
            rejectHostedPendingTool(new Error(t("agent.runtime.canvasToolExpired")), true);
            await applyCompletionOps(ops, summary);
        } catch (error) {
            if (controller.signal.aborted) return;
            const detail = hostedAgentErrorText(error, t("agent.hosted.failed"), t("agent.hosted.authFailed"));
            patchAssistant({ role: "error", text: detail, streamId: undefined });
            message.error(detail);
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            runIdRef.current = "";
            setAgentState({ sending: false, waiting: false, activity: "" });
            void refreshConversations().catch(() => undefined);
        }
    }, [activeReasoningEffort, addMessage, applyCompletionOps, canvasConfig.textModel, handleHostedStage, handleHostedToolCall, hostedModel, message, refreshConversations, rejectHostedPendingTool, setAgentState, t]);

    const empty = hostedTab === "chat" && messages.length === 0 && !sending && !waiting && !hydrating && !pendingTool;
    const historyThreads = useMemo(() => conversations.map(hostedAgentConversationThread), [conversations]);
    const suggestions = [
        t("agent.hosted.suggestions.layout"),
        t("agent.hosted.suggestions.flow"),
        t("agent.hosted.suggestions.prompt"),
        t("agent.hosted.suggestions.status"),
    ];

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
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-4 text-center">
                        <span
                            className="grid size-12 place-items-center rounded-2xl"
                            style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText, boxShadow: `inset 0 0 0 1px ${theme.sidebar.border}` }}
                        >
                            <Sparkles className="size-5" />
                        </span>
                        <h3 className="mt-4 text-[17px] font-semibold tracking-tight">{t("agent.hosted.emptyTitle")}</h3>
                        <p className="mt-1.5 max-w-[280px] text-[13px] leading-5" style={{ color: theme.node.muted }}>{t("agent.hosted.empty")}</p>
                        <div className="mt-5 flex w-full max-w-[340px] flex-col gap-2">
                            {suggestions.map((item) => (
                                <button
                                    key={item}
                                    type="button"
                                    disabled={!projectId}
                                    className="canvas-agent-suggestion flex w-full items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 text-left text-[13px] leading-5 disabled:opacity-50"
                                    style={{ background: theme.sidebar.surface, borderColor: theme.sidebar.border, color: theme.node.text }}
                                    onClick={() => setAgentState({ prompt: item })}
                                >
                                    <span className="min-w-0">{item}</span>
                                    <ArrowUpRight className="size-3.5 shrink-0 opacity-40" />
                                </button>
                            ))}
                        </div>
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
