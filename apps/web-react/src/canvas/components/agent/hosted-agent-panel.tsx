import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Tooltip } from "antd";
import { Bot, MessageSquare, PanelRightClose, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";

import { canvasThemes } from "@/lib/canvas-theme";
import { summarizeCanvasAgentOps, type CanvasAgentOp } from "@/lib/canvas/canvas-agent-ops";
import { resolveCanvasReferenceImages } from "@/lib/canvas/canvas-resource-references";
import { runCanvasAgentTool } from "@/lib/canvas/canvas-hosted-agent";
import { readImageMeta } from "@/lib/image-utils";
import { randomId } from "@/lib/utils";
import { cancelCanvasAssistantRun, clearHostedAgentConversationId, requestCanvasAgentTurn } from "@/services/canvas-task-api";
import { useAgentStore, type AgentAttachment, type AgentCanvasContext, type AgentChatItem, type AgentReasoningEffort } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { attachmentPayloadBytes, promptWithAttachments, promptWithCanvasReferences } from "./agent-event-formatters";
import { AgentChatTimeline } from "./agent-chat";
import { AgentChatComposer } from "./agent-chat-composer";
import { AgentPanelTabs } from "./agent-panel-tabs";

const MAX_ATTACHMENTS = 4;
const MAX_ATTACHMENT_PAYLOAD_BYTES = 12 * 1024 * 1024;
const HOSTED_REASONING_EFFORT_KEY = "canvas-hosted-agent-reasoning-effort";
const HOSTED_REASONING_EFFORTS: AgentReasoningEffort[] = ["medium", "xhigh"];

function initialHostedReasoningEffort(): AgentReasoningEffort {
    if (typeof window === "undefined") return "xhigh";
    const saved = localStorage.getItem(HOSTED_REASONING_EFFORT_KEY) as AgentReasoningEffort | null;
    return saved && HOSTED_REASONING_EFFORTS.includes(saved) ? saved : "xhigh";
}

type Translate = ReturnType<typeof useTranslation>["t"];

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
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const addMessage = useAgentStore((state) => state.addMessage);
    const closePanel = useAgentStore((state) => state.closePanel);
    const canvasContextRef = useRef<AgentCanvasContext | null>(useAgentStore.getState().canvasContext);
    const abortRef = useRef<AbortController | null>(null);
    const runIdRef = useRef("");
    const turnAttachmentsRef = useRef<AgentAttachment[]>([]);
    const projectId = useAgentStore((state) => state.canvasContext?.snapshot.projectId || "");
    const [tab, setTab] = useState<"chat">("chat");
    const [reasoningEffort, setReasoningEffort] = useState<AgentReasoningEffort>(initialHostedReasoningEffort);

    const lastProjectIdRef = useRef(projectId);

    useEffect(() => {
        return useAgentStore.subscribe((state) => {
            canvasContextRef.current = state.canvasContext;
        });
    }, []);

    useEffect(() => {
        if (lastProjectIdRef.current && lastProjectIdRef.current !== projectId) {
            abortRef.current?.abort();
            abortRef.current = null;
            runIdRef.current = "";
            setAgentState({ messages: [], prompt: "", attachments: [], canvasReferences: [], sending: false, waiting: false, activeTab: "chat" });
        }
        lastProjectIdRef.current = projectId;
    }, [projectId, setAgentState]);

    useEffect(() => {
        const current = useAgentStore.getState();
        if (current.messages.some(isLeftoverCodexMessage) || current.pendingTool || current.pendingApprovals.length) {
            setAgentState({
                messages: current.messages.filter((item) => !isLeftoverCodexMessage(item)),
                pendingTool: null,
                pendingApprovals: [],
                activeTab: "chat",
            });
        } else {
            setAgentState({ activeTab: "chat" });
        }
        return () => {
            abortRef.current?.abort();
            abortRef.current = null;
            runIdRef.current = "";
        };
    }, [setAgentState]);

    const startNewChat = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        runIdRef.current = "";
        if (projectId) clearHostedAgentConversationId(projectId);
        setAgentState({ messages: [], prompt: "", attachments: [], canvasReferences: [], sending: false, waiting: false });
    }, [projectId, setAgentState]);

    const stopTurn = useCallback(() => {
        abortRef.current?.abort();
        abortRef.current = null;
        const runId = runIdRef.current;
        runIdRef.current = "";
        if (runId) void cancelCanvasAssistantRun(runId).catch(() => undefined);
        setAgentState({ sending: false, waiting: false });
        const current = useAgentStore.getState();
        setAgentState({
            messages: current.messages.map((item) => (item.streamId ? { ...item, streamId: undefined, text: item.text || t("agent.message.stopped") } : item)),
        });
    }, [setAgentState, t]);

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
            const detail = { kind: "reasoning", status, effort: reasoningEffort, ...(tokens > 0 ? { tokens } : {}) };
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
                snapshot: context.snapshot,
                signal: controller.signal,
                referenceImages,
                onCreated: (runId) => {
                    runIdRef.current = runId;
                },
                onDelta: (next) => patchAssistant({ text: next }),
                onReasoning: (next) => patchReasoning(next, "inProgress"),
                onToolCall: async (call) => {
                    const canvas = canvasContextRef.current;
                    if (!canvas) throw new Error(t("agent.hosted.failed"));
                    const observation = await runCanvasAgentTool(call, {
                        ...canvas,
                        readSnapshot: () => canvasContextRef.current?.snapshot || canvas.snapshot,
                        attachments: turnAttachmentsRef.current,
                        navigate,
                    });
                    addMessage({
                        id: randomId(),
                        role: "tool",
                        title: toolTitle(call.name, t),
                        text: describeToolObservation(call.name, observation, t),
                    });
                    return observation;
                },
                reasoningEffort,
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
            if (ops.length) {
                const liveContext = canvasContextRef.current || context;
                const before = liveContext.snapshot.connections.length;
                const next = liveContext.applyOps(ops);
                const linked = Math.max(0, next.connections.length - before);
                addMessage({
                    id: randomId(),
                    role: "tool",
                    title: t("agent.eventExtra.tools.canvasOps"),
                    text: [summary || summarizeCanvasAgentOps(ops) || t("agent.hosted.applied"), linked ? t("agent.hosted.linked", { count: linked }) : ""].filter(Boolean).join(" · "),
                });
            }
        } catch (error) {
            if (controller.signal.aborted) return;
            const detail = hostedAgentErrorText(error, t("agent.hosted.failed"), t("agent.hosted.authFailed"));
            patchAssistant({ role: "error", text: detail, streamId: undefined });
            message.error(detail);
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            runIdRef.current = "";
            setAgentState({ sending: false, waiting: false });
        }
    }, [addMessage, message, navigate, reasoningEffort, setAgentState, t]);

    return (
        <>
            <AgentPanelTabs
                value={tab}
                theme={theme}
                leading={
                    <div className="flex items-center gap-1">
                        <span className="grid size-8 place-items-center">
                            <Bot className="size-4" />
                        </span>
                        <div className="hidden leading-5 @min-[560px]:block">
                            <div className="text-base font-semibold">Agent</div>
                            <div className="text-[11px] font-normal" style={{ color: theme.node.muted }}>{t("agent.hosted.subtitle")}</div>
                        </div>
                    </div>
                }
                items={[{ value: "chat", label: t("agent.panel.chat"), icon: <MessageSquare className="size-3.5" /> }]}
                onChange={() => setTab("chat")}
                right={
                    <>
                        <Tooltip title={t("agent.hosted.newChat")} placement="bottom">
                            <Button size="small" type="text" className="!h-8 !w-8 !min-w-8 !px-0 @min-[560px]:!w-auto @min-[560px]:!min-w-0 @min-[560px]:!px-[7px]" aria-label={t("agent.hosted.newChat")} disabled={sending || waiting} icon={<Plus className="size-3.5" />} onClick={startNewChat}>
                                <span className="hidden @min-[560px]:inline">{t("agent.hosted.newChat")}</span>
                            </Button>
                        </Tooltip>
                        <Tooltip title={t("agent.panel.collapse")}>
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" aria-label={t("agent.panel.collapseLabel")} style={{ color: theme.node.muted }} icon={<PanelRightClose className="size-4" />} onClick={closePanel} />
                        </Tooltip>
                    </>
                }
            />
            <div className="relative flex min-h-0 flex-1 flex-col">
                {messages.length === 0 && !sending && !waiting ? (
                    <div className="pointer-events-none absolute inset-x-0 top-16 z-10 px-6 text-center text-sm" style={{ color: theme.node.muted }}>
                        {t("agent.hosted.empty")}
                    </div>
                ) : null}
                <AgentChatTimeline
                    theme={theme}
                    pendingTool={null}
                    pendingApprovals={[]}
                    sending={sending}
                    waiting={waiting}
                    onRejectTool={() => undefined}
                    onApproveTool={() => undefined}
                    onApprovalDecision={() => undefined}
                />
            </div>
            <AgentChatComposer
                prompt={prompt}
                attachments={attachments.map((item) => ({ id: item.id, name: item.name, url: item.url }))}
                disabled={!projectId}
                sending={sending || waiting}
                placeholder={t("agent.hosted.placeholder")}
                theme={theme}
                reasoningEffort={reasoningEffort}
                reasoningEfforts={HOSTED_REASONING_EFFORTS}
                reasoningEffortLabels={{ medium: t("agent.hosted.reasoningStandard"), xhigh: t("agent.hosted.reasoningExtended") }}
                onReasoningEffortChange={(effort) => {
                    localStorage.setItem(HOSTED_REASONING_EFFORT_KEY, effort);
                    setReasoningEffort(effort);
                }}
                onPromptChange={(next) => setAgentState({ prompt: next })}
                onAddFiles={(files) => void addAttachments(files)}
                onRemoveAttachment={(id) => setAgentState({ attachments: useAgentStore.getState().attachments.filter((item) => item.id !== id) })}
                onSubmit={() => void sendPrompt()}
                onStop={stopTurn}
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
