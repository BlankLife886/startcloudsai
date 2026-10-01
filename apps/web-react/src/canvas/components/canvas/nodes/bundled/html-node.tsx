import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Camera, Code2, Columns3, Download, ExternalLink, Eye, FilePenLine, History, LayoutTemplate, Maximize2, Monitor, MousePointerClick, RefreshCw, RotateCw, Share2, Smartphone, Sparkles, Square, Tablet, TriangleAlert, X } from "lucide-react";

import { CanvasTextModelTools, useCanvasTextModelSelection } from "@/components/canvas/canvas-node-prompt-panel";
import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";
import { applyHtmlPatches, HTML_CONTINUE_SYSTEM_PROMPT, HTML_EDIT_SYSTEM_PROMPT, htmlContinuationPrompt, isTruncatedHtml, mergeHtmlContinuation, parseHtmlPatches, stashHtmlAssets } from "./html-node-edit";
import { canvasImageToken, isHtmlFrameMessage, postToHtmlFrame, resolveHtmlImages, withHtmlBridge, type HtmlFrameError, type HtmlFramePick, type HtmlFrameMessage } from "./html-node-runtime";
import { HTML_DEMO_SITE } from "./html-node-template";

const EDITOR_FONT_SIZE = 12;
const EDITOR_LINE_HEIGHT = 20;

// ---------------------------------------------------------------------------------------------------------------
// Devices. The page is rendered at the device's real CSS viewport and scaled into the frame, so media queries,
// breakpoints and touch-sized layouts behave exactly as they would on that device.
// ---------------------------------------------------------------------------------------------------------------

type HtmlDevice = "desktop" | "tablet" | "phone";

type DeviceSpec = {
    label: string;
    icon: (className: string) => ReactNode;
    viewport: { width: number; height: number };
    /** Bezel thickness and corner radii as a fraction of the frame width, so the frame scales with the node. */
    bezel: number;
    radius: number;
    screenRadius: number;
    statusBar: number;
    /** Node size used when switching to this device on the canvas (portrait). */
    nodeWidth: number;
};

const DEVICES: Record<HtmlDevice, DeviceSpec> = {
    desktop: { label: "网站", icon: (c) => <Monitor className={c} />, viewport: { width: 1280, height: 800 }, bezel: 0, radius: 0, screenRadius: 0, statusBar: 0, nodeWidth: 560 },
    tablet: { label: "平板", icon: (c) => <Tablet className={c} />, viewport: { width: 820, height: 1180 }, bezel: 0.034, radius: 0.075, screenRadius: 0.042, statusBar: 24, nodeWidth: 380 },
    phone: { label: "手机", icon: (c) => <Smartphone className={c} />, viewport: { width: 390, height: 844 }, bezel: 0.042, radius: 0.17, screenRadius: 0.135, statusBar: 50, nodeWidth: 260 },
};
const DEVICE_ORDER: HtmlDevice[] = ["desktop", "tablet", "phone"];
const BROWSER_CHROME = 44;

function readDevice(ctx: CanvasNodeContext): HtmlDevice {
    const value = ctx.node.metadata?.htmlDevice;
    return value === "tablet" || value === "phone" ? value : "desktop";
}

function deviceViewport(device: HtmlDevice, landscape: boolean) {
    const { width, height } = DEVICES[device].viewport;
    return landscape && device !== "desktop" ? { width: height, height: width } : { width, height };
}

/** Frame size for a device at a given frame width, keeping the real screen aspect ratio. */
function frameSizeForWidth(device: HtmlDevice, landscape: boolean, width: number) {
    const spec = DEVICES[device];
    const viewport = deviceViewport(device, landscape);
    if (device === "desktop") return { width, height: Math.round(BROWSER_CHROME + (width * viewport.height) / viewport.width) };
    const bezel = width * spec.bezel;
    const screenWidth = width - bezel * 2;
    const scale = screenWidth / viewport.width;
    return { width, height: Math.round(viewport.height * scale + spec.statusBar * scale + bezel * 2) };
}

function htmlAddress(value: string, title?: string) {
    const fromTitle = value.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim();
    if (fromTitle) return fromTitle;
    const name = title?.trim();
    return name && name !== "HTML" ? (/\.html?$/i.test(name) ? name : `${name}.html`) : "index.html";
}

function renderHtml(ctx: CanvasNodeContext) {
    const value = ctx.node.metadata?.content || "";
    const upstreamText = ctx
        .getUpstream()
        .map((node) => node.metadata?.content)
        .filter((content): content is string => Boolean(content))
        .join("\n");
    return value.replace(/\{\{\s*input\s*\}\}/g, upstreamText);
}

// ---------------------------------------------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------------------------------------------

// Chrome's navigation URL cap is 2 MB; larger pages (e.g. many inlined images) fall back to a sandboxed srcdoc.
const DATA_URL_LIMIT = 1_900_000;
type FrameRef = (frame: HTMLIFrameElement | null) => void;

// The page loads from a data: URL without a sandbox attribute. It still gets an opaque origin (no access to the canvas's
// DOM, cookies or storage), but unlike a sandboxed srcdoc it stays in the canvas's renderer process: Chrome isolates
// sandboxed frames into their own process, and such a frame under a CSS scale stops repainting after its content changes,
// so clicking around inside the preview left it blank. The injected bridge (html-node-runtime) guards links and talks to
// the canvas through postMessage.
function PageFrame({ html, viewport, scale, interactive, reloadKey, title, frameRef, onLoad }: { html: string; viewport: { width: number; height: number }; scale: number; interactive: boolean; reloadKey: number; title: string; frameRef?: FrameRef; onLoad?: () => void }) {
    const source = useMemo(() => {
        const bridged = withHtmlBridge(html);
        const url = `data:text/html;charset=utf-8,${encodeURIComponent(bridged)}`;
        return url.length <= DATA_URL_LIMIT ? { src: url } : { srcDoc: bridged, sandbox: "allow-scripts allow-forms allow-modals allow-popups" };
    }, [html]);
    return (
        <iframe
            key={reloadKey}
            ref={frameRef}
            title={title}
            {...source}
            onLoad={onLoad}
            className="absolute left-0 top-0 block border-0 bg-white"
            style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: "0 0", pointerEvents: interactive ? "auto" : "none" }}
        />
    );
}

function StatusBar({ device, scale, dark }: { device: HtmlDevice; scale: number; dark?: boolean }) {
    const spec = DEVICES[device];
    const color = dark ? "#fff" : "#111";
    return (
        <div className="absolute left-0 top-0 flex items-center justify-between" style={{ width: `${100 / scale}%`, height: spec.statusBar, padding: device === "phone" ? "0 30px 0 34px" : "0 22px", transform: `scale(${scale})`, transformOrigin: "0 0", fontSize: device === "phone" ? 16 : 13, fontWeight: 600, color, background: "#fff" }}>
            <span>9:41</span>
            <span className="flex items-center gap-1.5" aria-hidden>
                <svg width="18" height="11" viewBox="0 0 18 11" fill={color}><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="6" rx="1" /><rect x="10" y="2.5" width="3" height="8.5" rx="1" /><rect x="15" y="0" width="3" height="11" rx="1" /></svg>
                <svg width="16" height="11" viewBox="0 0 16 11" fill={color}><path d="M8 2.2c2.3 0 4.4.9 5.9 2.4l1.1-1.1A9.8 9.8 0 0 0 8 .6 9.8 9.8 0 0 0 1 3.5l1.1 1.1A8.2 8.2 0 0 1 8 2.2Zm0 3.2c1.4 0 2.7.5 3.7 1.4l1.1-1.1A6.9 6.9 0 0 0 8 3.8c-1.8 0-3.5.7-4.8 1.9l1.1 1.1c1-.9 2.3-1.4 3.7-1.4Zm0 3.2c.6 0 1.1.2 1.5.6L8 10.7 6.5 9.2c.4-.4.9-.6 1.5-.6Z" /></svg>
                <svg width="26" height="12" viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3.2" fill="none" stroke={color} strokeOpacity=".4" /><rect x="2" y="2" width="17" height="8" rx="2" fill={color} /><rect x="23.5" y="4" width="1.8" height="4" rx=".9" fill={color} fillOpacity=".4" /></svg>
            </span>
        </div>
    );
}

/** Draws one device (browser window, iPad or iPhone) at an exact outer size, with the page scaled inside. */
function DeviceFrame({ device, landscape, width, height, html, address, interactive, reloadKey, dark, children, frameRef, onFrameLoad }: { device: HtmlDevice; landscape: boolean; width: number; height: number; html: string; address: string; interactive: boolean; reloadKey: number; dark: boolean; children?: ReactNode; frameRef?: FrameRef; onFrameLoad?: () => void }) {
    const spec = DEVICES[device];
    const viewport = deviceViewport(device, landscape);

    if (device === "desktop") {
        const bodyHeight = Math.max(1, height - BROWSER_CHROME);
        const scale = width / viewport.width;
        const chromeLine = dark ? "rgba(255,255,255,.08)" : "#eeecf4";
        return (
            <div className="flex flex-col overflow-hidden" style={{ width, height, borderRadius: 16, background: dark ? "#1d1b26" : "#ffffff", boxShadow: `0 0 0 1px ${dark ? "rgba(255,255,255,.08)" : "#e7e4ef"}` }}>
                <div className="flex shrink-0 items-center gap-3 px-3.5" style={{ height: BROWSER_CHROME, borderBottom: `1px solid ${chromeLine}` }}>
                    <div className="flex shrink-0 items-center gap-1.5" aria-hidden>
                        <span className="size-2.5 rounded-full" style={{ background: "#ff5f57" }} />
                        <span className="size-2.5 rounded-full" style={{ background: "#febc2e" }} />
                        <span className="size-2.5 rounded-full" style={{ background: "#28c840" }} />
                    </div>
                    <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2.5 text-[12px]" style={{ background: dark ? "rgba(255,255,255,.06)" : "#f3f1f9", color: dark ? "#a39fb5" : "#8a8599" }}>
                        <span className="truncate">{address}</span>
                    </div>
                </div>
                <div className="relative min-h-0 flex-1 overflow-hidden" style={{ background: "#fff" }}>
                    {children ?? <PageFrame html={html} viewport={{ width: viewport.width, height: bodyHeight / scale }} scale={scale} interactive={interactive} reloadKey={reloadKey} title={address} frameRef={frameRef} onLoad={onFrameLoad} />}
                </div>
            </div>
        );
    }

    const bezel = width * spec.bezel;
    const screenWidth = width - bezel * 2;
    const screenHeight = height - bezel * 2;
    const scale = screenWidth / viewport.width;
    const statusHeight = spec.statusBar * scale;
    const islandWidth = device === "phone" ? (landscape ? height : width) * 0.3 : 0;
    const shortSide = Math.min(width, height);

    return (
        <div className="relative" style={{ width, height, borderRadius: shortSide * spec.radius, background: "linear-gradient(145deg,#2c2a33,#0d0c11 60%)", boxShadow: "0 0 0 1px #3a3844, inset 0 0 0 1.5px rgba(255,255,255,.12), 0 30px 60px -20px rgba(20,12,60,.45)" }}>
            {/* Side buttons */}
            {device === "phone" && !landscape ? (
                <>
                    <span className="absolute rounded-l" style={{ left: -3, top: height * 0.2, width: 3, height: height * 0.06, background: "#2a2830" }} />
                    <span className="absolute rounded-l" style={{ left: -3, top: height * 0.29, width: 3, height: height * 0.1, background: "#2a2830" }} />
                    <span className="absolute rounded-r" style={{ right: -3, top: height * 0.26, width: 3, height: height * 0.14, background: "#2a2830" }} />
                </>
            ) : null}
            {device === "tablet" ? <span className="absolute rounded-full" style={landscape ? { left: bezel / 2 - 2.5, top: height / 2 - 2.5, width: 5, height: 5, background: "#2f3445" } : { top: bezel / 2 - 2.5, left: width / 2 - 2.5, width: 5, height: 5, background: "#2f3445" }} /> : null}
            <div className="absolute overflow-hidden bg-white" style={{ left: bezel, top: bezel, width: screenWidth, height: screenHeight, borderRadius: shortSide * spec.screenRadius }}>
                {children ?? (
                    <>
                        <StatusBar device={device} scale={scale} />
                        <div className="absolute inset-x-0 bottom-0 overflow-hidden" style={{ top: statusHeight }}>
                            <PageFrame html={html} viewport={{ width: viewport.width, height: (screenHeight - statusHeight) / scale }} scale={scale} interactive={interactive} reloadKey={reloadKey} title={address} frameRef={frameRef} onLoad={onFrameLoad} />
                        </div>
                    </>
                )}
                {device === "phone" && !landscape ? <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-black" style={{ top: statusHeight * 0.2, width: islandWidth, height: statusHeight * 0.62 }} /> : null}
                {device === "phone" ? <span className="pointer-events-none absolute bottom-[5px] left-1/2 -translate-x-1/2 rounded-full" style={{ width: (landscape ? height : width) * 0.34, height: 4, background: "rgba(0,0,0,.28)" }} /> : null}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Source editor
// ---------------------------------------------------------------------------------------------------------------

function HtmlEditor({ ctx, value }: { ctx: CanvasNodeContext; value: string }) {
    const lineCount = useMemo(() => Math.max(1, value.split("\n").length), [value]);
    const [scrollTop, setScrollTop] = useState(0);
    const codeStyle = { fontFamily: "monospace", fontSize: EDITOR_FONT_SIZE, lineHeight: `${EDITOR_LINE_HEIGHT}px`, boxSizing: "border-box" } as const;

    return (
        <div data-canvas-no-zoom className="flex h-full w-full overflow-hidden" style={{ background: ctx.theme.node.fill }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div
                aria-hidden
                style={{ ...codeStyle, flex: "0 0 auto", padding: "16px 8px 16px 12px", textAlign: "right", color: ctx.theme.node.placeholder, background: `${ctx.theme.toolbar.panel}66`, borderRight: `1px solid ${ctx.theme.node.stroke}`, overflow: "hidden", userSelect: "none", whiteSpace: "pre" }}
            >
                <div style={{ transform: `translateY(${-scrollTop}px)` }}>
                    {Array.from({ length: lineCount }, (_, index) => <div key={index}>{index + 1}</div>)}
                </div>
            </div>
            <textarea
                autoFocus
                value={value}
                placeholder="<div>Hello, {{input}}</div>"
                spellCheck={false}
                wrap="off"
                onChange={(event) => ctx.updateMetadata({ content: event.target.value })}
                onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
                onWheel={(event) => event.stopPropagation()}
                style={{ ...codeStyle, flex: "1 1 auto", minWidth: 0, height: "100%", resize: "none", background: "transparent", padding: "16px 16px 16px 12px", outline: "none", border: "none", color: ctx.theme.node.text, whiteSpace: "pre", overflow: "auto" }}
            />
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Per-node runtime state that is not saved with the canvas: errors reported by the page, elements picked for the next
// AI edit, and a prefilled request. Shared between the node and its AI panel through the canvas event bus.
// ---------------------------------------------------------------------------------------------------------------

const RUNTIME_EVENT = "html:runtime";
type NodeRuntime = { errors: HtmlFrameError[]; picks: HtmlFramePick[]; prefill: string };
const runtimes = new Map<string, NodeRuntime>();

function runtimeOf(nodeId: string) {
    let runtime = runtimes.get(nodeId);
    if (!runtime) {
        runtime = { errors: [], picks: [], prefill: "" };
        runtimes.set(nodeId, runtime);
    }
    return runtime;
}

function updateRuntime(ctx: CanvasNodeContext, nodeId: string, change: (runtime: NodeRuntime) => void) {
    change(runtimeOf(nodeId));
    ctx.emit(RUNTIME_EVENT, nodeId);
}

function useNodeRuntime(ctx: CanvasNodeContext) {
    const [, rerender] = useReducer((value: number) => value + 1, 0);
    const nodeId = ctx.node.id;
    const onRef = useRef(ctx.on);
    onRef.current = ctx.on;
    useEffect(() => onRef.current(RUNTIME_EVENT, (payload) => payload === nodeId && rerender()), [nodeId]);
    return runtimeOf(nodeId);
}

/** The page with canvas images inlined (they cannot be loaded from inside the sandboxed page). */
function useResolvedHtml(html: string, ctx: CanvasNodeContext) {
    const hasImages = /sc-(file|node):/.test(html);
    const [resolved, setResolved] = useState<{ source: string; html: string } | null>(null);
    const getNodeRef = useRef(ctx.getNode);
    getNodeRef.current = ctx.getNode;
    useEffect(() => {
        if (!hasImages) return;
        let alive = true;
        void resolveHtmlImages(html, (id) => getNodeRef.current(id)).then((value) => alive && setResolved({ source: html, html: value }));
        return () => {
            alive = false;
        };
    }, [html, hasImages]);
    if (!hasImages) return html;
    return resolved?.source === html ? resolved.html : resolved?.html || html;
}

function htmlFileName(address: string) {
    const base = address.replace(/\.html?$/i, "").replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "index";
    return `${base}.html`;
}

function downloadHtml(html: string, address: string) {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = htmlFileName(address);
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---------------------------------------------------------------------------------------------------------------
// Full-screen preview: the page at real size on a chosen device (or all three side by side), fully interactive.
// ---------------------------------------------------------------------------------------------------------------

function useWindowSize() {
    const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
    useEffect(() => {
        const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
        window.addEventListener("resize", onResize);
        return () => window.removeEventListener("resize", onResize);
    }, []);
    return size;
}

// The new tab shows a wrapper page whose only content is a sandboxed frame: a blob: URL carries the canvas's origin, so
// the user's HTML must never run in it directly.
function openInNewTab(html: string) {
    const escaped = html.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    const title = htmlAddress(html).replace(/[<&]/g, "");
    const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body><iframe sandbox="allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox" srcdoc="${escaped}"></iframe></body></html>`;
    const url = URL.createObjectURL(new Blob([page], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

type PreviewMode = HtmlDevice | "compare";

/** Largest frame of a device that fits the given box (never above real size for tablets and phones). */
function fitDevice(device: HtmlDevice, landscape: boolean, maxWidth: number, maxHeight: number) {
    if (device === "desktop") {
        const width = Math.min(1440, maxWidth);
        return { width, height: Math.min(maxHeight, frameSizeForWidth("desktop", false, width).height + 200) };
    }
    const viewport = deviceViewport(device, landscape);
    const natural = frameSizeForWidth(device, landscape, viewport.width / (1 - DEVICES[device].bezel * 2));
    const fit = Math.min(1, maxWidth / natural.width, maxHeight / natural.height);
    return frameSizeForWidth(device, landscape, natural.width * fit);
}

function HtmlPreviewOverlay({ ctx, html, address, onClose }: { ctx: CanvasNodeContext; html: string; address: string; onClose: () => void }) {
    const [mode, setMode] = useState<PreviewMode>(readDevice(ctx));
    const [landscape, setLandscape] = useState(Boolean(ctx.node.metadata?.htmlLandscape));
    const [reloadKey, setReloadKey] = useState(0);
    const windowSize = useWindowSize();
    const dark = ctx.theme.scheme === "dark";

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const availableWidth = windowSize.width - 64;
    const availableHeight = windowSize.height - 120;
    const barButton = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 9, fontSize: 13, fontWeight: 600, color: active ? "#17151f" : "rgba(255,255,255,.78)", background: active ? "#fff" : "transparent", transition: "background .15s,color .15s", whiteSpace: "nowrap" });

    // Compare: the three devices side by side at one shared scale, so their real proportions stay comparable.
    const compare = (() => {
        if (mode !== "compare") return null;
        const gap = 36;
        const naturals = DEVICE_ORDER.map((device) => (device === "desktop" ? { width: 1280, height: 800 + BROWSER_CHROME } : frameSizeForWidth(device, false, DEVICES[device].viewport.width / (1 - DEVICES[device].bezel * 2))));
        const scale = Math.min(1, (availableWidth - gap * 2) / naturals.reduce((sum, size) => sum + size.width, 0), availableHeight / Math.max(...naturals.map((size) => size.height)));
        return naturals.map((size) => ({ width: Math.round(size.width * scale), height: Math.round(size.height * scale) }));
    })();
    const single = mode !== "compare" ? fitDevice(mode, landscape, availableWidth, availableHeight) : null;

    return createPortal(
        <div data-canvas-shortcuts-ignore="true" data-canvas-no-zoom="true" className="fixed inset-0 flex flex-col items-center" style={{ zIndex: 5000, pointerEvents: "auto", background: "rgba(14,11,26,.72)", backdropFilter: "blur(14px)" }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="flex w-full items-center gap-3 px-6" style={{ height: 64 }}>
                <div className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white/90">{address}</div>
                <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "rgba(255,255,255,.1)" }}>
                    {DEVICE_ORDER.map((item) => (
                        <button key={item} type="button" style={barButton(mode === item)} onClick={() => setMode(item)}>
                            {DEVICES[item].icon("size-4")}
                            {DEVICES[item].label}
                        </button>
                    ))}
                    <button type="button" title="三种设备并排对比" style={barButton(mode === "compare")} onClick={() => setMode("compare")}>
                        <Columns3 className="size-4" />
                        对比
                    </button>
                </div>
                <div className="flex flex-1 items-center justify-end gap-1">
                    {mode === "tablet" || mode === "phone" ? (
                        <button type="button" title="横竖屏" style={barButton(false)} onClick={() => setLandscape((value) => !value)}>
                            <RotateCw className="size-4" />
                            旋转
                        </button>
                    ) : null}
                    <button type="button" title="重新加载页面" style={barButton(false)} onClick={() => setReloadKey((value) => value + 1)}>
                        <RefreshCw className="size-4" />
                    </button>
                    <button type="button" title="下载 .html 文件（图片已内嵌，可离线打开）" style={barButton(false)} onClick={() => downloadHtml(html, address)}>
                        <Download className="size-4" />
                        下载
                    </button>
                    <button type="button" title="在新标签页打开" style={barButton(false)} onClick={() => openInNewTab(html)}>
                        <ExternalLink className="size-4" />
                    </button>
                    <HtmlShareButton ctx={ctx} html={html} address={address} style={barButton(false)} />
                    <button type="button" title="关闭 (Esc)" className="ml-1 grid size-8 place-items-center rounded-full" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }} onClick={onClose}>
                        <X className="size-4" />
                    </button>
                </div>
            </div>
            <div className="flex min-h-0 w-full flex-1 items-center justify-center gap-9 pb-8" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
                {compare
                    ? DEVICE_ORDER.map((device, index) => (
                          <div key={device} className="flex flex-col items-center gap-3">
                              <DeviceFrame device={device} landscape={false} width={compare[index].width} height={compare[index].height} html={html} address={address} interactive reloadKey={reloadKey} dark={dark} />
                              <span className="text-[12px] font-medium text-white/70">
                                  {DEVICES[device].label} · {DEVICES[device].viewport.width}px
                              </span>
                          </div>
                      ))
                    : single && mode !== "compare" ? <DeviceFrame device={mode} landscape={landscape} width={single.width} height={single.height} html={html} address={address} interactive reloadKey={reloadKey} dark={dark} /> : null}
            </div>
        </div>,
        getCanvasPortalRoot(),
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Share link: publishes the page (images inlined) to a public, read-only URL that anyone can open.
// ---------------------------------------------------------------------------------------------------------------

function HtmlShareButton({ ctx, html, address, style }: { ctx: CanvasNodeContext; html: string; address: string; style: CSSProperties }) {
    const [state, setState] = useState<{ status: "idle" | "busy" | "done" | "error"; url?: string; message?: string }>({ status: "idle" });
    const shared = ctx.node.metadata?.htmlShare;
    const share = async () => {
        setState({ status: "busy" });
        try {
            const { publishHtmlShare } = await import("@/services/html-share-api");
            const result = await publishHtmlShare({ html, title: address, shareId: shared?.id });
            ctx.updateMetadata({ htmlShare: { id: result.id, url: result.url, at: new Date().toISOString() } });
            await navigator.clipboard?.writeText(result.url).catch(() => undefined);
            setState({ status: "done", url: result.url });
        } catch (error) {
            setState({ status: "error", message: error instanceof Error ? error.message : "发布失败" });
        }
    };
    const revoke = async () => {
        if (!shared) return;
        try {
            const { revokeHtmlShare } = await import("@/services/html-share-api");
            await revokeHtmlShare(shared.id);
        } catch {
            // Already gone on the server: forget it locally anyway.
        }
        ctx.updateMetadata({ htmlShare: undefined });
        setState({ status: "idle" });
    };
    return (
        <div className="relative">
            <button type="button" title={shared ? "更新分享链接的内容" : "发布为公开链接，任何人都能打开"} style={style} disabled={state.status === "busy"} onClick={() => void share()}>
                <Share2 className="size-4" />
                {state.status === "busy" ? "发布中…" : shared ? "更新分享" : "分享"}
            </button>
            {state.status === "done" || state.status === "error" ? (
                <div className="absolute right-0 top-10 w-[320px] rounded-xl p-3 text-[12px] shadow-2xl" style={{ background: "#fff", color: "#17151f" }}>
                    {state.status === "done" ? (
                        <>
                            <div className="mb-1.5 font-semibold">链接已复制，任何人都可以打开</div>
                            <a href={state.url} target="_blank" rel="noreferrer" className="block truncate text-[#6d4aff] underline">
                                {state.url}
                            </a>
                        </>
                    ) : (
                        <div className="text-[#e5484d]">{state.message}</div>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                        <button type="button" className="text-[#8a8599]" onClick={() => setState({ status: "idle" })}>
                            关闭
                        </button>
                        {state.status === "done" && ctx.node.metadata?.htmlShare ? (
                            <button type="button" className="text-[#e5484d]" onClick={() => void revoke()}>
                                撤销链接
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Node content
// ---------------------------------------------------------------------------------------------------------------

const PREVIEW_EVENT = "html:preview";
const PICK_EVENT = "html:pick";
const CAPTURE_EVENT = "html:capture";
/** Live answer text from the AI panel to the node while it is being written (kept out of node metadata/autosave). */
const PARTIAL_EVENT = "html:partial";
type HtmlPartial = { nodeId: string; text: string; phase: string };

/** A page can be previewed as soon as its body has started. */
function renderablePartial(text: string) {
    const start = text.search(/<!doctype html|<html/i);
    if (start < 0) return "";
    const html = text.slice(start);
    return /<body[\s>]/i.test(html) ? html : "";
}

function HtmlGenerating({ ctx, partial }: { ctx: CanvasNodeContext; partial: HtmlPartial | null }) {
    const scrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    }, [partial?.text]);
    if (!partial?.text) {
        return (
            <div className="relative flex h-full w-full flex-col gap-3 overflow-hidden p-5" style={{ background: ctx.theme.node.fill }}>
                <div className="canvas-node-shimmer absolute inset-0" />
                <div className="h-[34%] min-h-8 rounded-xl" style={{ background: "linear-gradient(120deg, #9b7bff, #3d7bff)", opacity: 0.35 }} />
                <div className="h-2.5 w-[70%] rounded-full" style={{ background: ctx.theme.node.stroke }} />
                <div className="h-2.5 w-[46%] rounded-full" style={{ background: ctx.theme.node.stroke }} />
            </div>
        );
    }
    // Code as it is being written, until there is enough of a page to render.
    return (
        <div ref={scrollRef} className="h-full w-full overflow-hidden px-4 pb-12 pt-3" style={{ background: "#16141f", color: "#c9c3e6", fontFamily: "monospace", fontSize: 11, lineHeight: "17px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {partial.text.slice(-6000)}
            <span className="inline-block h-3 w-1.5 animate-pulse align-middle" style={{ background: "#8b6cff" }} />
        </div>
    );
}

function StatusPill({ ctx, children, tone = "neutral", onClick, className = "" }: { ctx: CanvasNodeContext; children: ReactNode; tone?: "neutral" | "danger" | "accent"; onClick?: () => void; className?: string }) {
    const dark = ctx.theme.scheme === "dark";
    const color = tone === "danger" ? "#e5484d" : tone === "accent" ? ctx.theme.node.activeStroke : ctx.theme.node.text;
    const Tag = onClick ? "button" : "div";
    return (
        <Tag
            type={onClick ? "button" : undefined}
            className={`absolute z-10 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-medium shadow-lg ${onClick ? "pointer-events-auto transition hover:brightness-95" : "pointer-events-none"} ${className}`}
            style={{ background: dark ? "rgba(28,26,36,.94)" : "rgba(255,255,255,.96)", color, border: `1px solid ${tone === "danger" ? "rgba(229,72,77,.35)" : ctx.theme.node.stroke}` }}
            onMouseDown={onClick ? (event: React.MouseEvent) => event.stopPropagation() : undefined}
            onPointerDown={onClick ? (event: React.PointerEvent) => event.stopPropagation() : undefined}
            onClick={onClick}
        >
            {children}
        </Tag>
    );
}

function HtmlEmpty({ ctx }: { ctx: CanvasNodeContext }) {
    const line = ctx.theme.scheme === "dark" ? "rgba(255,255,255,.08)" : "#eeecf4";
    const action = "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition hover:opacity-90";
    const images = ctx.getUpstream().filter((node) => node.type === "image" && (node.metadata?.content || node.metadata?.storageKey)).length;
    return (
        <div className="flex h-full w-full flex-col gap-3 p-5" style={{ background: ctx.theme.node.fill }}>
            <div className="h-[34%] min-h-8 rounded-xl" style={{ background: "linear-gradient(120deg, #9b7bff, #3d7bff)", opacity: 0.9 }} />
            <div className="h-2.5 w-[72%] rounded-full" style={{ background: line }} />
            <div className="h-2.5 w-[48%] rounded-full" style={{ background: line }} />
            <div className="mt-auto flex flex-wrap items-center gap-2" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <button type="button" className={action} style={{ background: "linear-gradient(135deg,#8b6cff,#3d7bff)", color: "#fff" }} onClick={() => ctx.openPanel()}>
                    <Sparkles className="size-3.5" />
                    {images ? `用 ${images} 张图生成网站` : "AI 生成网站"}
                </button>
                <button type="button" className={action} style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }} onClick={() => ctx.updateMetadata({ content: HTML_DEMO_SITE, interactive: true })}>
                    <LayoutTemplate className="size-3.5" />
                    示例网站
                </button>
                <button type="button" className={action} style={{ color: ctx.theme.node.placeholder }} onClick={() => ctx.updateMetadata({ editing: true })}>
                    <Code2 className="size-3.5" />
                    写代码
                </button>
            </div>
        </div>
    );
}

function HtmlContent({ ctx }: { ctx: CanvasNodeContext }) {
    const value = ctx.node.metadata?.content || "";
    const html = useResolvedHtml(renderHtml(ctx), ctx);
    const editing = Boolean(ctx.node.metadata?.editing);
    const generating = ctx.node.metadata?.status === "loading";
    const device = readDevice(ctx);
    const landscape = Boolean(ctx.node.metadata?.htmlLandscape);
    const address = useMemo(() => htmlAddress(value, ctx.node.title), [value, ctx.node.title]);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const [picking, setPicking] = useState(false);
    const [notice, setNotice] = useState<{ text: string; tone: "neutral" | "danger" | "accent" } | null>(null);
    const dark = ctx.theme.scheme === "dark";
    const nodeId = ctx.node.id;
    const runtime = useNodeRuntime(ctx);
    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const frameRef = useRef<HTMLIFrameElement | null>(null);
    const pickingRef = useRef(picking);
    pickingRef.current = picking;
    const captures = useRef(new Map<string, (message: Extract<HtmlFrameMessage, { type: "capture" }>) => void>());

    const [partial, setPartial] = useState<HtmlPartial | null>(null);
    // The live page is re-rendered at most about once a second; every render reloads the frame.
    const [livePage, setLivePage] = useState("");
    const liveAtRef = useRef(0);

    const flash = (text: string, tone: "neutral" | "danger" | "accent" = "neutral", ms = 2600) => {
        setNotice({ text, tone });
        if (ms) window.setTimeout(() => setNotice((current) => (current?.text === text ? null : current)), ms);
    };

    // Messages from this node's page only (each node checks the sender is its own frame).
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            if (!isHtmlFrameMessage(event.data) || !frameRef.current || event.source !== frameRef.current.contentWindow) return;
            const message = event.data;
            const current = ctxRef.current;
            if (message.type === "error") {
                updateRuntime(current, nodeId, (state) => {
                    if (state.errors.some((item) => item.message === message.message) || state.errors.length >= 20) return;
                    state.errors = [...state.errors, { message: message.message, line: message.line }];
                });
            } else if (message.type === "pick") {
                setPicking(false);
                updateRuntime(current, nodeId, (state) => {
                    state.picks = [...state.picks.filter((item) => item.html !== message.pick.html), message.pick].slice(-3);
                });
                current.openPanel();
            } else if (message.type === "pick-cancel") {
                setPicking(false);
            } else if (message.type === "capture") {
                captures.current.get(message.id)?.(message);
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, [nodeId]);

    // A new page (or a reload) starts with a clean error list.
    useEffect(() => {
        if (runtimeOf(nodeId).errors.length) updateRuntime(ctxRef.current, nodeId, (state) => (state.errors = []));
    }, [html, reloadKey, nodeId]);

    useEffect(() => {
        postToHtmlFrame(frameRef.current, { type: "pick-mode", on: picking });
    }, [picking]);

    const capture = async () => {
        const frame = frameRef.current;
        if (!frame || !value) return;
        flash("正在截图…", "accent", 0);
        try {
            const id = Math.random().toString(36).slice(2);
            const shot = await new Promise<Extract<HtmlFrameMessage, { type: "capture" }>>((resolve, reject) => {
                const timer = window.setTimeout(() => reject(new Error("截图超时")), 25_000);
                captures.current.set(id, (message) => {
                    window.clearTimeout(timer);
                    resolve(message);
                });
                postToHtmlFrame(frame, { type: "capture", id });
            }).finally(() => undefined);
            if (!shot.dataUrl) throw new Error(shot.error || "截图失败");
            const { uploadImage } = await import("@/services/image-storage");
            const uploaded = await uploadImage(shot.dataUrl);
            const current = ctxRef.current;
            const width = 360;
            const height = Math.round((width * (shot.height || 1)) / (shot.width || 1));
            const imageId = `html-shot-${Math.random().toString(36).slice(2, 10)}`;
            current.applyOps([
                {
                    type: "add_node",
                    id: imageId,
                    nodeType: "image",
                    title: `${address.replace(/\.html?$/i, "")} · ${DEVICES[device].label}截图`,
                    x: current.node.position.x + current.node.width + 96,
                    y: current.node.position.y,
                    width,
                    height,
                    metadata: { content: uploaded.url, storageKey: uploaded.storageKey, thumbnailUrl: uploaded.thumbnailUrl, thumbnailKey: uploaded.thumbnailKey, naturalWidth: uploaded.width, naturalHeight: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType, status: "success" },
                },
                { type: "connect_nodes", fromNodeId: current.node.id, toNodeId: imageId },
            ]);
            flash("截图已放到右侧的图片节点", "accent");
        } catch (error) {
            flash(error instanceof Error ? error.message : "截图失败", "danger", 4000);
        } finally {
            captures.current.clear();
        }
    };
    const captureRef = useRef(capture);
    captureRef.current = capture;

    useEffect(() => {
        const offPreview = ctxRef.current.on(PREVIEW_EVENT, (payload) => payload === nodeId && setPreviewOpen(true));
        const offPick = ctxRef.current.on(PICK_EVENT, (payload) => payload === nodeId && setPicking((value) => !value));
        const offCapture = ctxRef.current.on(CAPTURE_EVENT, (payload) => payload === nodeId && void captureRef.current());
        const offPartial = ctxRef.current.on(PARTIAL_EVENT, (payload) => {
            const next = payload as HtmlPartial;
            if (next?.nodeId !== nodeId) return;
            setPartial(next);
            const page = renderablePartial(next.text);
            const now = Date.now();
            if (page && now - liveAtRef.current > 1100) {
                liveAtRef.current = now;
                setLivePage(page);
            }
        });
        return () => {
            offPreview();
            offPick();
            offCapture();
            offPartial();
        };
    }, [nodeId]);

    useEffect(() => {
        if (generating) return;
        setPartial(null);
        setLivePage("");
        liveAtRef.current = 0;
    }, [generating]);

    const fixErrors = () => {
        const list = runtime.errors.map((item, index) => `${index + 1}. ${item.message}${item.line ? `（第 ${item.line} 行附近）` : ""}`).join("\n");
        updateRuntime(ctx, nodeId, (state) => (state.prefill = `修复页面运行时的这些报错，并保持现有功能不变：\n${list}`));
        ctx.openPanel();
    };

    // Content interaction is owned by the host toggle (metadata.interactive); picking needs the page live as well.
    const interactive = (Boolean(ctx.node.metadata?.interactive) || picking) && !generating;
    const showLive = generating && Boolean(livePage);
    const body = editing ? <HtmlEditor ctx={ctx} value={value} /> : generating ? (showLive ? null : <HtmlGenerating ctx={ctx} partial={partial} />) : !value ? <HtmlEmpty ctx={ctx} /> : null;
    const errorCount = runtime.errors.length;

    return (
        <div className="relative h-full w-full" style={{ borderRadius: "inherit" }}>
            <DeviceFrame
                device={device}
                landscape={landscape}
                width={ctx.node.width}
                height={ctx.node.height}
                html={showLive ? livePage : html}
                address={editing ? `${address} · 源码` : address}
                interactive={interactive}
                reloadKey={reloadKey}
                dark={dark}
                frameRef={(frame) => (frameRef.current = frame)}
                onFrameLoad={() => pickingRef.current && postToHtmlFrame(frameRef.current, { type: "pick-mode", on: true })}
            >
                {body ?? undefined}
            </DeviceFrame>
            {generating ? (
                <StatusPill ctx={ctx} tone="accent" className="inset-x-3 bottom-3">
                    <Sparkles className="size-3.5 shrink-0 animate-pulse" />
                    <span className="min-w-0 flex-1 truncate" style={{ color: ctx.theme.node.text }}>
                        {partial?.phase || "AI 正在搭建网站…"}
                    </span>
                    {partial?.text ? <span className="shrink-0 tabular-nums" style={{ color: ctx.theme.node.placeholder }}>{partial.text.length.toLocaleString()} 字</span> : null}
                </StatusPill>
            ) : null}
            {picking ? (
                <StatusPill ctx={ctx} tone="accent" className="left-1/2 top-3 -translate-x-1/2" onClick={() => setPicking(false)}>
                    <MousePointerClick className="size-3.5" />
                    点击页面里要修改的元素 · 点这里取消
                </StatusPill>
            ) : null}
            {!generating && !editing && errorCount ? (
                <StatusPill ctx={ctx} tone="danger" className="bottom-3 left-3" onClick={fixErrors}>
                    <TriangleAlert className="size-3.5" />
                    {errorCount} 个页面错误 · 让 AI 修复
                </StatusPill>
            ) : null}
            {notice ? (
                <StatusPill ctx={ctx} tone={notice.tone} className="bottom-3 right-3">
                    {notice.text}
                </StatusPill>
            ) : null}
            {previewOpen && value ? <HtmlPreviewOverlay ctx={ctx} html={html} address={address} onClose={() => setPreviewOpen(false)} /> : null}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// AI panel: create a site (optionally from connected images) or change the current one with patches.
// ---------------------------------------------------------------------------------------------------------------

const SITE_SYSTEM_PROMPT = `你是一名资深前端工程师兼网页设计师。根据用户需求写出一个完整、可直接运行的单页 HTML 网站。
要求：
- 只回复 HTML 源码本身（从 <!doctype html> 开始，到 </html> 结束），不要解释，不要使用代码块标记。
- 所有 CSS 写在 <style>、所有 JS 写在 <script>，不引用任何本地资源；没有提供图片时，用 CSS 渐变、SVG 或 emoji 代替图片。
- 必须响应式：同时适配桌面（1280px）、平板（820px）和手机（390px），手机端导航折叠为菜单按钮。
- 做成真实可交互的网站：用 hash 路由实现多个页面（如 #/、#/about），并包含合适的交互，例如导航高亮、弹窗、标签页、轮播、折叠面板、表单校验与提示、深色模式切换、滚动动效等。
- 视觉精致现代：统一的配色变量、圆角、阴影、留白与层级，中文排版清晰。
- 在 <title> 中写网站的域名或名称。
- 代码精炼：复用 CSS 变量和类名，避免重复样式，整页源码尽量控制在 15000 字以内。`;

const SITE_PRESETS = ["SaaS 产品落地页", "个人作品集", "电商商品详情页", "餐厅官网（含菜单与预订）", "App 下载页", "活动报名页"];
const MAX_VERSIONS = 8;

function extractHtml(text: string) {
    const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i)?.[1];
    const source = (fenced || text).trim();
    const start = source.search(/<!doctype html|<html/i);
    return start > 0 ? source.slice(start) : source;
}

/** Only a whole document counts: a refusal or explanation that merely mentions tags must never replace the page. */
function isCompleteHtml(html: string) {
    return /^\s*(<!doctype html|<html)/i.test(html) && /<\/html>\s*$/i.test(html) && /<body[\s>]/i.test(html);
}

/** Drops comments and indentation so larger pages still fit in one request. */
function compactHtml(html: string) {
    return html.replace(/<!--[\s\S]*?-->/g, "").replace(/\n[ \t]+/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
}

/** Connected image nodes: shown to the model (design mock-ups are rebuilt, photos can be used in the page). */
function upstreamImages(ctx: CanvasNodeContext) {
    return ctx.getUpstream().filter((node) => node.type === "image" && (node.metadata?.content || node.metadata?.storageKey)).slice(0, 4);
}

function imageBrief(ctx: CanvasNodeContext) {
    const images = upstreamImages(ctx);
    if (!images.length) return "";
    const lines = images.map((node, index) => `图${index + 1}（${node.title || "图片"}）：${canvasImageToken(node)}`).join("\n");
    return `\n\n附带了 ${images.length} 张来自画布的图片，按顺序为图1…图${images.length}：
- 如果图片是网页 / App 的设计稿或界面截图：按它还原页面的布局、配色、字体层级和文案，不要把设计稿本身当作图片放进页面。
- 如果是照片、插画、产品图或 Logo：可以直接用在页面里，把下面对应的地址原样写进 <img src> 或 CSS url()，不要改写地址：
${lines}`;
}

async function imagesForModel(ctx: CanvasNodeContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    const shrink = async (dataUrl: string) => {
        if (!dataUrl.startsWith("data:image/")) return dataUrl;
        const image = new Image();
        image.src = dataUrl;
        await image.decode();
        const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
        if (scale === 1) return dataUrl;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.88);
    };
    const results = await Promise.all(upstreamImages(ctx).map((node) => imageToDataUrl({ url: node.metadata?.content, storageKey: node.metadata?.storageKey }).then(shrink).catch(() => "")));
    return results.filter(Boolean);
}

function formatTime(iso: string) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function HtmlAiPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const hasSite = Boolean(ctx.node.metadata?.content);
    const runtime = useNodeRuntime(ctx);
    const [prompt, setPrompt] = useState("");
    const { model, reasoningEffort } = useCanvasTextModelSelection(ctx.node);
    const [error, setError] = useState("");
    const [showVersions, setShowVersions] = useState(false);
    const controllerRef = useRef<AbortController | null>(null);
    const running = ctx.node.metadata?.status === "loading";
    const device = readDevice(ctx);
    const images = upstreamImages(ctx);
    const versions = ctx.node.metadata?.htmlVersions || [];
    const picks = hasSite ? runtime.picks : [];

    // A request prepared elsewhere (e.g. "fix these errors") lands in the input once.
    useEffect(() => {
        if (!runtime.prefill) return;
        setPrompt(runtime.prefill);
        updateRuntime(ctx, ctx.node.id, (state) => (state.prefill = ""));
    }, [runtime.prefill]);

    const canRun = Boolean(prompt.trim() || (!hasSite && images.length));

    const run = async () => {
        if (!canRun || running) return;
        const request = prompt.trim() || "按附带的图片做成网页";
        setError("");
        const original = ctx.node.metadata?.content || "";
        const upstream = ctx
            .getUpstream()
            .filter((node) => node.type !== "image")
            .map((node) => node.metadata?.content)
            .filter((content): content is string => typeof content === "string" && Boolean(content.trim()) && !content.startsWith("data:"))
            .join("\n\n");
        const targets = picks.length
            ? `\n\n用户在页面上点选了要修改的元素（渲染后的 HTML 片段，源码里对应的写法可能略有不同）：\n${picks.map((pick, index) => `目标${index + 1}（${pick.selector}）：\n${pick.html}`).join("\n\n")}`
            : "";
        const deviceHint = `\n用户当前主要在「${DEVICES[device].label}」尺寸上预览。${imageBrief(ctx)}`;
        const system = hasSite ? HTML_EDIT_SYSTEM_PROMPT : SITE_SYSTEM_PROMPT;
        const limit = await ctx.ai.textInputLimit();
        // Embedded images are swapped for placeholders; the page is sent as-is when it fits, compacted when it does not,
        // and patches are applied to exactly the text the model saw.
        const assets = stashHtmlAssets(original);
        const taskFor = (source: string) => (hasSite ? `原网页源码：\n${source}\n\n修改要求：${request}${targets}` : `请制作这个网站：${request}`);
        const overheadFor = (source: string) => system.length + taskFor(source).length + deviceHint.length + 64;
        const base = !hasSite || overheadFor(assets.text) <= limit ? assets.text : compactHtml(assets.text);
        if (overheadFor(base) > limit) {
            setError(`当前网站源码约 ${base.length.toLocaleString()} 字，超过了 AI 单次可处理的 ${limit.toLocaleString()} 字上限，无法修改。可以让管理员在后台调高「AI 助手消息」字数上限（最高 100,000）。`);
            return;
        }
        const room = limit - overheadFor(base) - 20;
        const reference = upstream && room > 200 ? `\n参考资料（来自上游节点）：\n${upstream.length > room ? `${upstream.slice(0, room)}…` : upstream}` : "";
        const message = `${taskFor(base)}${reference}${deviceHint}`;

        const controller = new AbortController();
        controllerRef.current = controller;
        const nodeId = ctx.node.id;
        const report = (text: string, phase: string) => ctx.emit(PARTIAL_EVENT, { nodeId, text, phase } satisfies HtmlPartial);
        const writing = hasSite ? "AI 正在修改网站" : "AI 正在写网站";
        ctx.updateMetadata({ status: "loading", editing: false });
        report("", images.length ? "AI 正在看图…" : hasSite ? "AI 正在理解修改要求…" : "AI 正在构思网站…");
        try {
            const attached = images.length ? await imagesForModel(ctx) : [];
            const first = await ctx.ai.generateText(message, { system, model, reasoningEffort, images: attached, signal: controller.signal, onPartial: (text) => report(text, writing) });
            const said = first.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            const quote = said ? `模型回复：「${said.slice(0, 140)}${said.length > 140 ? "…" : ""}」` : "";
            let html = extractHtml(first.text);
            // A reply cut off by the model's output cap is continued, up to four more parts.
            for (let part = 2; isTruncatedHtml(html) && part <= 5; part += 1) {
                const soFar = html;
                const phase = `网页较长，正在续写第 ${part} 段…`;
                report(soFar, phase);
                const next = await ctx.ai.generateText(htmlContinuationPrompt(soFar), {
                    system: HTML_CONTINUE_SYSTEM_PROMPT,
                    model,
                    reasoningEffort,
                    signal: controller.signal,
                    onPartial: (text) => report(mergeHtmlContinuation(soFar, text), phase),
                });
                html = mergeHtmlContinuation(soFar, next.text);
            }
            if (hasSite && !isCompleteHtml(html)) {
                const patches = parseHtmlPatches(first.text);
                if (!patches.length) throw new Error(`模型没有返回可用的修改，原网页未改动。${quote}`);
                const applied = applyHtmlPatches(base, patches);
                if (!applied.ok) throw new Error(`模型给出的 ${patches.length} 处修改里，第 ${applied.failed.join("、")} 处对不上原网页，已整体放弃，原网页未改动。可以换个说法或模型再试。`);
                html = applied.html;
            }
            html = assets.restore(html);
            if (!isCompleteHtml(html)) throw new Error(isTruncatedHtml(html) ? "网页太长，续写 5 段后仍未写完，原网页未改动。可以把需求拆小一些再试。" : `模型没有返回完整的网页，原网页未改动。${quote}`);
            const now = new Date().toISOString();
            const history = versions.length || !original ? versions : [{ id: `v-${Date.now() - 1}`, at: now, prompt: "初始版本", content: original }];
            const nextVersions = [...history, { id: `v-${Date.now()}`, at: now, prompt: request, content: html }].slice(-MAX_VERSIONS);
            ctx.updateMetadata({ content: html, status: "success", interactive: true, htmlPrompt: request, htmlVersions: nextVersions, htmlPreviousContent: undefined });
            updateRuntime(ctx, nodeId, (state) => {
                state.picks = [];
                state.errors = [];
            });
            setPrompt("");
        } catch (cause) {
            ctx.updateMetadata({ status: hasSite ? "success" : undefined });
            if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "生成失败");
        } finally {
            controllerRef.current = null;
        }
    };

    const stop = () => {
        controllerRef.current?.abort();
        ctx.updateMetadata({ status: hasSite ? "success" : undefined });
    };

    const chip = ctx.theme.scheme === "dark" ? "rgba(255,255,255,.06)" : "#f3f1f9";

    return (
        <div className="flex flex-col gap-3 p-4" style={{ background: ctx.theme.node.panel, borderRadius: 22 }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-lg" style={{ background: "linear-gradient(135deg,#8b6cff,#3d7bff)", color: "#fff" }}>
                    <Sparkles className="size-4" />
                </span>
                <span className="text-[14px] font-semibold" style={{ color: ctx.theme.node.text }}>
                    {hasSite ? "用一句话修改网站" : "AI 生成网站"}
                </span>
                <span className="flex-1" />
                {hasSite ? (
                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium" style={{ background: chip, color: ctx.theme.node.text }} title="在页面上点选要修改的元素" onClick={() => ctx.emit(PICK_EVENT, ctx.node.id)}>
                        <MousePointerClick className="size-3.5" />
                        点选元素
                    </button>
                ) : null}
                {versions.length ? (
                    <button type="button" className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[12px] font-medium" style={{ background: showVersions ? ctx.theme.toolbar.activeBg : chip, color: showVersions ? ctx.theme.toolbar.activeText : ctx.theme.node.text }} onClick={() => setShowVersions((value) => !value)}>
                        <History className="size-3.5" />
                        版本 {versions.length}
                    </button>
                ) : null}
                <button type="button" className="grid size-7 place-items-center rounded-full" style={{ color: ctx.theme.node.placeholder }} title="关闭" onClick={onClose}>
                    <X className="size-4" />
                </button>
            </div>
            {showVersions ? (
                <div className="flex max-h-[200px] flex-col gap-1 overflow-auto rounded-xl p-1.5" style={{ background: chip }} onWheel={(event) => event.stopPropagation()}>
                    {[...versions].reverse().map((version, index) => {
                        const current = version.content === ctx.node.metadata?.content;
                        return (
                            <div key={version.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12px]" style={{ background: current ? ctx.theme.node.panel : "transparent" }}>
                                <span className="w-7 shrink-0 font-semibold tabular-nums" style={{ color: ctx.theme.node.activeStroke }}>
                                    v{versions.length - index}
                                </span>
                                <span className="min-w-0 flex-1 truncate" style={{ color: ctx.theme.node.text }} title={version.prompt}>
                                    {version.prompt}
                                </span>
                                <span className="shrink-0 tabular-nums" style={{ color: ctx.theme.node.placeholder }}>
                                    {formatTime(version.at)}
                                </span>
                                {current ? (
                                    <span className="shrink-0 text-[11px]" style={{ color: ctx.theme.node.placeholder }}>
                                        当前
                                    </span>
                                ) : (
                                    <button type="button" className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }} onClick={() => ctx.updateMetadata({ content: version.content })}>
                                        恢复
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            ) : null}
            {images.length ? (
                <div className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background: chip }}>
                    <div className="flex -space-x-2">
                        {images.map((node) => (
                            <span key={node.id} className="size-8 overflow-hidden rounded-lg border-2" style={{ borderColor: ctx.theme.node.panel, background: ctx.theme.node.stroke }}>
                                {node.metadata?.thumbnailUrl || node.metadata?.content ? <img src={node.metadata?.thumbnailUrl || node.metadata?.content} alt="" className="h-full w-full object-cover" /> : null}
                            </span>
                        ))}
                    </div>
                    <span className="min-w-0 flex-1 text-[12px] leading-5" style={{ color: ctx.theme.node.placeholder }}>
                        已连接 {images.length} 张图片：设计稿会被还原成网页，照片和产品图可直接用在页面里
                    </span>
                </div>
            ) : null}
            {picks.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {picks.map((pick) => (
                        <span key={pick.html} className="inline-flex max-w-full items-center gap-1.5 rounded-full py-1 pl-2.5 pr-1 text-[12px]" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }} title={pick.selector}>
                            <MousePointerClick className="size-3 shrink-0" />
                            <span className="truncate">
                                &lt;{pick.tag}&gt; {pick.text || pick.selector}
                            </span>
                            <button type="button" className="grid size-4 shrink-0 place-items-center rounded-full hover:bg-black/10" onClick={() => updateRuntime(ctx, ctx.node.id, (state) => (state.picks = state.picks.filter((item) => item !== pick)))}>
                                <X className="size-3" />
                            </button>
                        </span>
                    ))}
                </div>
            ) : null}
            <textarea
                autoFocus
                value={prompt}
                rows={3}
                placeholder={picks.length ? "想把选中的元素改成什么样？例如：换成渐变色大按钮，文案改为「立即体验」" : hasSite ? "例如：把主色换成墨绿色，定价页加一个企业版，首页加客户 logo 墙" : images.length ? "可选：补充说明，例如「按设计稿还原，并加上登录弹窗」" : "描述你想要的网站：用途、页面、风格、配色、需要哪些交互…"}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();
                }}
                onWheel={(event) => event.stopPropagation()}
                className="w-full resize-none rounded-xl p-3 text-[13px] leading-6 outline-none"
                style={{ background: ctx.theme.scheme === "dark" ? "rgba(255,255,255,.04)" : "#f6f5fa", color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}` }}
            />
            {!hasSite && !images.length ? (
                <div className="flex flex-wrap gap-1.5">
                    {SITE_PRESETS.map((preset) => (
                        <button key={preset} type="button" className="rounded-full px-2.5 py-1 text-[12px] transition hover:opacity-80" style={{ background: ctx.theme.toolbar.activeBg, color: ctx.theme.toolbar.activeText }} onClick={() => setPrompt(preset)}>
                            {preset}
                        </button>
                    ))}
                </div>
            ) : null}
            {error ? <div className="rounded-lg px-3 py-2 text-[12px]" style={{ background: "rgba(229,72,77,.08)", color: "#e5484d" }}>{error}</div> : null}
            <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center">
                    <CanvasTextModelTools node={ctx.node} onChange={(patch) => ctx.updateMetadata(patch || {})} />
                </div>
                <span className="shrink-0 text-[11px]" style={{ color: ctx.theme.node.placeholder }}>
                    ⌘/Ctrl + Enter
                </span>
                {running ? (
                    <button type="button" className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white" style={{ background: "#26222f" }} onClick={stop}>
                        <Square className="size-3 fill-current" />
                        停止
                    </button>
                ) : (
                    <button type="button" disabled={!canRun} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition disabled:opacity-40" style={{ background: "linear-gradient(135deg,#8b6cff,#3d7bff)" }} onClick={() => void run()}>
                        <Sparkles className="size-3.5" />
                        {hasSite ? "修改" : images.length ? "按图生成" : "生成网站"}
                    </button>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------------------------------------------

function switchDevice(ctx: CanvasNodeContext, device: HtmlDevice, landscape = false) {
    const width = device === "desktop" ? DEVICES.desktop.nodeWidth : landscape ? Math.round(DEVICES[device].nodeWidth * 1.45) : DEVICES[device].nodeWidth;
    const size = frameSizeForWidth(device, landscape, width);
    ctx.updateMetadata({ htmlDevice: device, htmlLandscape: landscape });
    ctx.updateNode({ width: size.width, height: size.height });
}

export const htmlCanvasPlugin: CanvasPlugin = {
    id: BUNDLED_CANVAS_PLUGIN_IDS.html,
    name: "HTML 节点",
    version: "2.1.0",
    description: "在网站、平板、手机设备框中渲染可交互的 HTML；AI 生成与修改网站、设计稿转网页、点选修改、报错修复、截图、版本历史与分享",
    nodes: [
        {
            type: BUNDLED_CANVAS_NODE_TYPES.html,
            title: "HTML",
            icon: <Code2 className="size-5" />,
            description: "网站 / 平板 / 手机预览",
            defaultSize: { width: DEVICES.desktop.nodeWidth, height: frameSizeForWidth("desktop", false, DEVICES.desktop.nodeWidth).height },
            defaultMetadata: { content: "" },
            minimapColor: "#ec4899",
            transparentBackground: true,
            interactionToggle: true,
            forceInteractive: (node) => Boolean(node.metadata?.editing),
            keepAspectRatio: (node) => node.metadata?.htmlDevice === "tablet" || node.metadata?.htmlDevice === "phone",
            Content: HtmlContent,
            Panel: HtmlAiPanel,
            toolbar: (ctx) => {
                const editing = Boolean(ctx.node.metadata?.editing);
                const hasContent = Boolean(ctx.node.metadata?.content);
                const device = readDevice(ctx);
                const next = DEVICE_ORDER[(DEVICE_ORDER.indexOf(device) + 1) % DEVICE_ORDER.length];
                const landscape = Boolean(ctx.node.metadata?.htmlLandscape);
                return [
                    { id: "html-device", title: `切换到${DEVICES[next].label}`, label: DEVICES[device].label, icon: DEVICES[device].icon("size-4"), onClick: () => switchDevice(ctx, next) },
                    ...(device !== "desktop" ? [{ id: "html-rotate", title: landscape ? "切换为竖屏" : "切换为横屏", label: "旋转", icon: <RotateCw className="size-4" />, onClick: () => switchDevice(ctx, device, !landscape) }] : []),
                    ...(hasContent ? [{ id: "html-pick", title: "点选页面元素，让 AI 只改这里", label: "点选", icon: <MousePointerClick className="size-4" />, onClick: () => ctx.emit(PICK_EVENT, ctx.node.id) }] : []),
                    { id: "html-ai", title: hasContent ? "用 AI 修改网站" : "用 AI 生成网站", label: "AI", icon: <Sparkles className="size-4" />, onClick: () => ctx.openPanel() },
                    ...(hasContent
                        ? [
                              { id: "html-preview", title: "全屏预览：多设备对比、下载、分享", label: "预览", icon: <Maximize2 className="size-4" />, onClick: () => ctx.emit(PREVIEW_EVENT, ctx.node.id) },
                              { id: "html-capture", title: "截取当前画面，生成一个图片节点", label: "截图", icon: <Camera className="size-4" />, onClick: () => ctx.emit(CAPTURE_EVENT, ctx.node.id) },
                          ]
                        : []),
                    {
                        id: "html-toggle-edit",
                        title: editing ? "预览渲染结果" : "编辑 HTML 源码",
                        label: editing ? "预览" : "源码",
                        icon: editing ? <Eye className="size-4" /> : <FilePenLine className="size-4" />,
                        active: editing,
                        onClick: () => ctx.updateMetadata({ editing: !editing }),
                    },
                ];
            },
        },
    ],
};
