import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Code2, ExternalLink, Eye, FilePenLine, LayoutTemplate, Maximize2, Monitor, RefreshCw, RotateCw, Smartphone, Sparkles, Square, Tablet, X } from "lucide-react";

import { CanvasTextModelTools, useCanvasTextModelSelection } from "@/components/canvas/canvas-node-prompt-panel";
import { getCanvasPortalRoot } from "@/lib/canvas-portal";
import type { CanvasNodeContext, CanvasPlugin } from "@/types/canvas-plugin";

import { BUNDLED_CANVAS_NODE_TYPES, BUNDLED_CANVAS_PLUGIN_IDS } from "./contracts";
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

// Keeps links and forms inside the frame: anything aimed at the top/parent window opens in a new tab instead of
// navigating the canvas away.
const FRAME_GUARD = `<script>(()=>{const fix=(el)=>{const t=(el.getAttribute("target")||"").toLowerCase();if(t==="_top"||t==="_parent")el.setAttribute("target","_blank")};document.addEventListener("click",(e)=>{const a=e.target&&e.target.closest&&e.target.closest("a[target]");if(a)fix(a)},true);document.addEventListener("submit",(e)=>{if(e.target&&e.target.getAttribute)fix(e.target)},true)})()<\/script>`;
const DATA_URL_LIMIT = 1_500_000;

function withFrameGuard(html: string) {
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${FRAME_GUARD}`) : `${FRAME_GUARD}${html}`;
}

// The page loads from a data: URL without a sandbox attribute. It still gets an opaque origin (no access to the canvas's
// DOM, cookies or storage), but unlike a sandboxed srcdoc it stays in the canvas's renderer process: Chrome isolates
// sandboxed frames into their own process, and such a frame under a CSS scale stops repainting after its content changes,
// so clicking around inside the preview left it blank. Very large pages fall back to the sandboxed srcdoc.
function PageFrame({ html, viewport, scale, interactive, reloadKey, title }: { html: string; viewport: { width: number; height: number }; scale: number; interactive: boolean; reloadKey: number; title: string }) {
    const source = useMemo(() => {
        const guarded = withFrameGuard(html);
        const url = `data:text/html;charset=utf-8,${encodeURIComponent(guarded)}`;
        return url.length <= DATA_URL_LIMIT ? { src: url } : { srcDoc: guarded, sandbox: "allow-scripts allow-forms allow-modals allow-popups" };
    }, [html]);
    return (
        <iframe
            key={reloadKey}
            title={title}
            {...source}
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
function DeviceFrame({ device, landscape, width, height, html, address, interactive, reloadKey, dark, children }: { device: HtmlDevice; landscape: boolean; width: number; height: number; html: string; address: string; interactive: boolean; reloadKey: number; dark: boolean; children?: ReactNode }) {
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
                    {children ?? <PageFrame html={html} viewport={{ width: viewport.width, height: bodyHeight / scale }} scale={scale} interactive={interactive} reloadKey={reloadKey} title={address} />}
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
                            <PageFrame html={html} viewport={{ width: viewport.width, height: (screenHeight - statusHeight) / scale }} scale={scale} interactive={interactive} reloadKey={reloadKey} title={address} />
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
// Full-screen preview: the page at real size on a chosen device, fully interactive.
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

function HtmlPreviewOverlay({ ctx, html, address, onClose }: { ctx: CanvasNodeContext; html: string; address: string; onClose: () => void }) {
    const [device, setDevice] = useState<HtmlDevice>(readDevice(ctx));
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
    const frame = (() => {
        if (device === "desktop") return { width: Math.min(1440, availableWidth), height: availableHeight };
        const viewport = deviceViewport(device, landscape);
        // Real device size (1 CSS px = 1 screen px) when it fits, otherwise scaled down to fit.
        const natural = frameSizeForWidth(device, landscape, viewport.width / (1 - DEVICES[device].bezel * 2));
        const fit = Math.min(1, availableWidth / natural.width, availableHeight / natural.height);
        return frameSizeForWidth(device, landscape, natural.width * fit);
    })();

    const barButton = (active: boolean): CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: 6, height: 32, padding: "0 12px", borderRadius: 9, fontSize: 13, fontWeight: 600, color: active ? "#17151f" : "rgba(255,255,255,.78)", background: active ? "#fff" : "transparent", transition: "background .15s,color .15s" });

    return createPortal(
        <div data-canvas-shortcuts-ignore="true" data-canvas-no-zoom="true" className="fixed inset-0 flex flex-col items-center" style={{ zIndex: 5000, pointerEvents: "auto", background: "rgba(14,11,26,.72)", backdropFilter: "blur(14px)" }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
            <div className="flex w-full items-center gap-3 px-6" style={{ height: 64 }}>
                <div className="min-w-0 flex-1 truncate text-[14px] font-semibold text-white/90">{address}</div>
                <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: "rgba(255,255,255,.1)" }}>
                    {DEVICE_ORDER.map((item) => (
                        <button key={item} type="button" style={barButton(device === item)} onClick={() => setDevice(item)}>
                            {DEVICES[item].icon("size-4")}
                            {DEVICES[item].label}
                        </button>
                    ))}
                </div>
                <div className="flex flex-1 items-center justify-end gap-1">
                    {device !== "desktop" ? (
                        <button type="button" title="横竖屏" style={barButton(false)} onClick={() => setLandscape((value) => !value)}>
                            <RotateCw className="size-4" />
                            旋转
                        </button>
                    ) : null}
                    <button type="button" title="重新加载页面" style={barButton(false)} onClick={() => setReloadKey((value) => value + 1)}>
                        <RefreshCw className="size-4" />
                        刷新
                    </button>
                    <button type="button" title="在新标签页打开" style={barButton(false)} onClick={() => openInNewTab(html)}>
                        <ExternalLink className="size-4" />
                        新窗口
                    </button>
                    <button type="button" title="关闭 (Esc)" className="ml-1 grid size-8 place-items-center rounded-full" style={{ background: "rgba(255,255,255,.14)", color: "#fff" }} onClick={onClose}>
                        <X className="size-4" />
                    </button>
                </div>
            </div>
            <div className="flex min-h-0 w-full flex-1 items-center justify-center pb-8" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
                <DeviceFrame device={device} landscape={landscape} width={frame.width} height={frame.height} html={html} address={address} interactive reloadKey={reloadKey} dark={dark} />
            </div>
        </div>,
        getCanvasPortalRoot(),
    );
}

// ---------------------------------------------------------------------------------------------------------------
// Node content
// ---------------------------------------------------------------------------------------------------------------

const PREVIEW_EVENT = "html:preview";
const RELOAD_EVENT = "html:reload";

function HtmlGenerating({ ctx }: { ctx: CanvasNodeContext }) {
    return (
        <div className="relative flex h-full w-full flex-col gap-3 overflow-hidden p-5" style={{ background: ctx.theme.node.fill }}>
            <div className="canvas-node-shimmer absolute inset-0" />
            <div className="h-[34%] min-h-8 rounded-xl" style={{ background: "linear-gradient(120deg, #9b7bff, #3d7bff)", opacity: 0.35 }} />
            <div className="h-2.5 w-[70%] rounded-full" style={{ background: ctx.theme.node.stroke }} />
            <div className="h-2.5 w-[46%] rounded-full" style={{ background: ctx.theme.node.stroke }} />
            <div className="mt-auto flex items-center gap-2 text-[12px] font-medium" style={{ color: ctx.theme.node.activeStroke }}>
                <Sparkles className="size-3.5 animate-pulse" />
                AI 正在搭建网站…
            </div>
        </div>
    );
}

function HtmlEmpty({ ctx }: { ctx: CanvasNodeContext }) {
    const line = ctx.theme.scheme === "dark" ? "rgba(255,255,255,.08)" : "#eeecf4";
    const action = "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold transition hover:opacity-90";
    return (
        <div className="flex h-full w-full flex-col gap-3 p-5" style={{ background: ctx.theme.node.fill }}>
            <div className="h-[34%] min-h-8 rounded-xl" style={{ background: "linear-gradient(120deg, #9b7bff, #3d7bff)", opacity: 0.9 }} />
            <div className="h-2.5 w-[72%] rounded-full" style={{ background: line }} />
            <div className="h-2.5 w-[48%] rounded-full" style={{ background: line }} />
            <div className="mt-auto flex flex-wrap items-center gap-2" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                <button type="button" className={action} style={{ background: "linear-gradient(135deg,#8b6cff,#3d7bff)", color: "#fff" }} onClick={() => ctx.openPanel()}>
                    <Sparkles className="size-3.5" />
                    AI 生成网站
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
    const html = renderHtml(ctx);
    const editing = Boolean(ctx.node.metadata?.editing);
    const generating = ctx.node.metadata?.status === "loading";
    const device = readDevice(ctx);
    const landscape = Boolean(ctx.node.metadata?.htmlLandscape);
    const address = useMemo(() => htmlAddress(value, ctx.node.title), [value, ctx.node.title]);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);
    const dark = ctx.theme.scheme === "dark";
    const nodeId = ctx.node.id;
    const onRef = useRef(ctx.on);
    onRef.current = ctx.on;

    useEffect(() => {
        const offPreview = onRef.current(PREVIEW_EVENT, (payload) => payload === nodeId && setPreviewOpen(true));
        const offReload = onRef.current(RELOAD_EVENT, (payload) => payload === nodeId && setReloadKey((key) => key + 1));
        return () => {
            offPreview();
            offReload();
        };
    }, [nodeId]);

    // Content interaction is owned by the host toggle (metadata.interactive); the empty state and editor are always live.
    const interactive = Boolean(ctx.node.metadata?.interactive);
    const body = editing ? <HtmlEditor ctx={ctx} value={value} /> : generating ? <HtmlGenerating ctx={ctx} /> : !value ? <HtmlEmpty ctx={ctx} /> : null;

    return (
        <div className="relative h-full w-full" style={{ borderRadius: "inherit" }}>
            <DeviceFrame device={device} landscape={landscape} width={ctx.node.width} height={ctx.node.height} html={html} address={editing ? `${address} · 源码` : address} interactive={interactive} reloadKey={reloadKey} dark={dark}>
                {body ?? undefined}
            </DeviceFrame>
            {previewOpen && value ? <HtmlPreviewOverlay ctx={ctx} html={html} address={address} onClose={() => setPreviewOpen(false)} /> : null}
        </div>
    );
}

// ---------------------------------------------------------------------------------------------------------------
// AI panel: describe a site (or a change to the current one) and let the text model write the whole page.
// ---------------------------------------------------------------------------------------------------------------

const SITE_SYSTEM_PROMPT = `你是一名资深前端工程师兼网页设计师。根据用户需求输出一个完整、可直接运行的单文件 HTML 网站。
要求：
- 只输出 HTML 源码本身（从 <!doctype html> 开始），不要解释，不要 Markdown 代码块。
- 所有 CSS 写在 <style>、所有 JS 写在 <script>，不要引用本地文件；图片用 CSS 渐变、SVG 或 emoji 代替。
- 必须响应式：同时适配桌面（1280px）、平板（820px）和手机（390px），手机端导航折叠为菜单按钮。
- 做成真实可交互的网站：用 hash 路由实现多个页面（如 #/、#/about），并包含合适的交互，例如导航高亮、弹窗、标签页、轮播、折叠面板、表单校验与提示、深色模式切换、滚动动效等。
- 视觉精致现代：统一的配色变量、圆角、阴影、留白与层级，中文排版清晰。
- 在 <title> 中写网站的域名或名称。`;

const SITE_PRESETS = ["SaaS 产品落地页", "个人作品集", "电商商品详情页", "餐厅官网（含菜单与预订）", "App 下载页", "活动报名页"];

function extractHtml(text: string) {
    const fenced = text.match(/```(?:html)?\s*([\s\S]*?)```/i)?.[1];
    const source = (fenced || text).trim();
    const start = source.search(/<!doctype html|<html/i);
    return start > 0 ? source.slice(start) : source;
}

function HtmlAiPanel({ ctx, onClose }: { ctx: CanvasNodeContext; onClose: () => void }) {
    const hasSite = Boolean(ctx.node.metadata?.content);
    const [prompt, setPrompt] = useState("");
    const { model, reasoningEffort } = useCanvasTextModelSelection(ctx.node);
    const [error, setError] = useState("");
    const controllerRef = useRef<AbortController | null>(null);
    const running = ctx.node.metadata?.status === "loading";
    const device = readDevice(ctx);

    const run = async () => {
        const request = prompt.trim();
        if (!request || running) return;
        setError("");
        const controller = new AbortController();
        controllerRef.current = controller;
        const current = ctx.node.metadata?.content || "";
        const upstream = ctx
            .getUpstream()
            .map((node) => node.metadata?.content)
            .filter((content): content is string => typeof content === "string" && Boolean(content.trim()) && !content.startsWith("data:"))
            .join("\n\n");
        const message = [
            hasSite ? `这是当前网站的完整源码：\n${current}\n\n请在此基础上修改，并输出修改后的完整 HTML：${request}` : `请制作这个网站：${request}`,
            upstream ? `\n参考资料（来自上游节点）：\n${upstream}` : "",
            `\n用户当前主要在「${DEVICES[device].label}」尺寸上预览。`,
        ].join("");
        ctx.updateMetadata({ status: "loading", editing: false });
        try {
            const result = await ctx.ai.generateText(message, { system: SITE_SYSTEM_PROMPT, model, reasoningEffort, signal: controller.signal });
            const html = extractHtml(result.text);
            if (!/<(html|body|div|section|main)[\s>]/i.test(html)) throw new Error("模型没有返回有效的 HTML，请换个描述或模型再试");
            ctx.updateMetadata({ content: html, status: "success", interactive: true, htmlPrompt: request });
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
                <button type="button" className="grid size-7 place-items-center rounded-full" style={{ color: ctx.theme.node.placeholder }} title="关闭" onClick={onClose}>
                    <X className="size-4" />
                </button>
            </div>
            <textarea
                autoFocus
                value={prompt}
                rows={3}
                placeholder={hasSite ? "例如：把主色换成墨绿色，定价页加一个企业版，首页加客户 logo 墙" : "描述你想要的网站：用途、页面、风格、配色、需要哪些交互…"}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();
                }}
                onWheel={(event) => event.stopPropagation()}
                className="w-full resize-none rounded-xl p-3 text-[13px] leading-6 outline-none"
                style={{ background: ctx.theme.scheme === "dark" ? "rgba(255,255,255,.04)" : "#f6f5fa", color: ctx.theme.node.text, border: `1px solid ${ctx.theme.node.stroke}` }}
            />
            {!hasSite ? (
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
                    <button type="button" disabled={!prompt.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-semibold text-white transition disabled:opacity-40" style={{ background: "linear-gradient(135deg,#8b6cff,#3d7bff)" }} onClick={() => void run()}>
                        <Sparkles className="size-3.5" />
                        {hasSite ? "修改" : "生成网站"}
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
    version: "2.0.0",
    description: "在网站、平板、手机设备框中渲染可交互的 HTML，支持 AI 生成网站与全屏预览",
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
                    {
                        id: "html-device",
                        title: `切换到${DEVICES[next].label}`,
                        label: DEVICES[device].label,
                        icon: DEVICES[device].icon("size-4"),
                        onClick: () => switchDevice(ctx, next),
                    },
                    ...(device !== "desktop"
                        ? [{ id: "html-rotate", title: landscape ? "切换为竖屏" : "切换为横屏", label: "旋转", icon: <RotateCw className="size-4" />, onClick: () => switchDevice(ctx, device, !landscape) }]
                        : []),
                    ...(hasContent
                        ? [
                              { id: "html-preview", title: "全屏预览（可交互）", label: "预览", icon: <Maximize2 className="size-4" />, onClick: () => ctx.emit(PREVIEW_EVENT, ctx.node.id) },
                              { id: "html-reload", title: "重新加载页面", label: "刷新", icon: <RefreshCw className="size-4" />, onClick: () => ctx.emit(RELOAD_EVENT, ctx.node.id) },
                          ]
                        : []),
                    { id: "html-ai", title: hasContent ? "用 AI 修改网站" : "用 AI 生成网站", label: "AI", icon: <Sparkles className="size-4" />, onClick: () => ctx.openPanel() },
                    {
                        id: "html-toggle-edit",
                        title: editing ? "预览渲染结果" : "编辑 HTML 源码",
                        label: editing ? "预览" : "源码",
                        icon: editing ? <Eye className="size-4" /> : <FilePenLine className="size-4" />,
                        active: editing,
                        onClick: () => ctx.updateMetadata({ editing: !editing }),
                    },
                    ...(hasContent ? [{ id: "html-open", title: "在新标签页打开", label: "新窗口", icon: <ExternalLink className="size-4" />, onClick: () => openInNewTab(renderHtml(ctx)) }] : []),
                ];
            },
        },
    ],
};
