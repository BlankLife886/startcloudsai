import type { CanvasNodeData } from "@/types/canvas";

// ---------------------------------------------------------------------------------------------------------------
// In-page bridge. Every rendered page gets one small script at the top of <head>. It talks to the canvas only through
// postMessage (the page has an opaque origin), and does four things:
//   - keeps links/forms aimed at the top window inside the preview (they open in a new tab instead);
//   - reports runtime errors, failed resources and console.error calls;
//   - element picking: hover outline + click reports the element, when the canvas turns pick mode on;
//   - screenshots of the visible viewport (html2canvas, loaded on demand), when the canvas asks for one.
// ---------------------------------------------------------------------------------------------------------------

export type HtmlFramePick = { tag: string; text: string; html: string; selector: string };
export type HtmlFrameError = { message: string; line?: number };
export type HtmlFrameMessage =
    | { type: "error"; message: string; line?: number }
    | { type: "pick"; pick: HtmlFramePick }
    | { type: "pick-cancel" }
    | { type: "capture"; id: string; dataUrl?: string; width?: number; height?: number; error?: string };

// Screenshots render through the browser itself (modern-screenshot, SVG foreignObject), so modern CSS such as gradient
// text and color-mix comes out exactly; html2canvas-pro is the fallback when that script cannot load.
export const SCREENSHOT_URL = "https://cdn.jsdelivr.net/npm/modern-screenshot@4.7.0/dist/index.js";
export const HTML2CANVAS_URL = "https://cdn.jsdelivr.net/npm/html2canvas-pro@2.4.5/dist/html2canvas-pro.min.js";

const BRIDGE = `(()=>{
const post=(m)=>{try{parent.postMessage(Object.assign({__htmlNode:1},m),"*")}catch(_){}};
const fix=(el)=>{const t=(el.getAttribute("target")||"").toLowerCase();if(t==="_top"||t==="_parent")el.setAttribute("target","_blank")};
document.addEventListener("click",(e)=>{const a=e.target&&e.target.closest&&e.target.closest("a[target]");if(a)fix(a)},true);
document.addEventListener("submit",(e)=>{if(e.target&&e.target.getAttribute)fix(e.target)},true);
let sent=0;const report=(message,line)=>{if(sent++<30)post({type:"error",message:String(message).slice(0,400),line})};
addEventListener("error",(e)=>{const el=e.target;if(el&&el!==window&&el.tagName){report("资源加载失败："+(el.currentSrc||el.src||el.href||el.tagName));return}report(e.message||(e.error&&e.error.message)||"脚本错误",e.lineno)},true);
addEventListener("unhandledrejection",(e)=>{const r=e.reason;report("未处理的 Promise 错误："+((r&&r.message)||r))});
const ce=console.error;console.error=function(){try{report(Array.prototype.map.call(arguments,(x)=>(x&&x.message)||String(x)).join(" "))}catch(_){}return ce.apply(console,arguments)};
let picking=false,box=null;
const outline=()=>{if(!box){box=document.createElement("div");box.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #6d4aff;background:rgba(109,74,255,.10);border-radius:4px;box-shadow:0 0 0 4px rgba(109,74,255,.18);display:none";document.documentElement.appendChild(box)}return box};
const pathOf=(el)=>{const parts=[];for(let n=el;n&&n.nodeType===1&&parts.length<5;n=n.parentElement){let p=n.tagName.toLowerCase();if(n.id){parts.unshift(p+"#"+n.id);break}const c=[...n.classList].slice(0,2).join(".");if(c)p+="."+c;parts.unshift(p)}return parts.join(" > ")};
const move=(e)=>{const el=e.target;if(!el||el===box||el===document.documentElement)return;const r=el.getBoundingClientRect();Object.assign(outline().style,{display:"block",left:r.left+"px",top:r.top+"px",width:r.width+"px",height:r.height+"px"})};
const stop=(e)=>{e.preventDefault();e.stopPropagation()};
const pick=(e)=>{stop(e);const el=e.target;if(!el||el===box)return;let html=el.outerHTML||"";if(html.length>1500)html=html.slice(0,1500)+"…";post({type:"pick",pick:{tag:el.tagName.toLowerCase(),text:(el.innerText||el.textContent||"").trim().replace(/\\s+/g," ").slice(0,80),html,selector:pathOf(el)}});setPick(false)};
const key=(e)=>{if(e.key==="Escape"){setPick(false);post({type:"pick-cancel"})}};
const setPick=(on)=>{if(on===picking)return;picking=on;const m=on?"addEventListener":"removeEventListener";document[m]("mousemove",move,true);document[m]("click",pick,true);document[m]("mousedown",stop,true);document[m]("keydown",key,true);document.documentElement.style.cursor=on?"crosshair":"";if(!on&&box)box.style.display="none"};
const loadScript=(src,get)=>get()?Promise.resolve(get()):new Promise((ok,fail)=>{const s=document.createElement("script");s.src=src;s.onload=()=>get()?ok(get()):fail(new Error("截图组件加载失败"));s.onerror=()=>fail(new Error("截图组件加载失败"));document.head.appendChild(s)});
const done=(id,c)=>post({type:"capture",id,dataUrl:c.toDataURL("image/png"),width:c.width,height:c.height});
const shoot=(id)=>{if(box)box.style.display="none";const scale=Math.min(2,Math.max(1,1600/innerWidth));
loadScript("${SCREENSHOT_URL}",()=>window.modernScreenshot).then((ms)=>ms.domToCanvas(document.documentElement,{width:innerWidth,height:innerHeight,scale,backgroundColor:getComputedStyle(document.body).backgroundColor||"#fff",style:scrollY||scrollX?{transform:"translate("+(-scrollX)+"px,"+(-scrollY)+"px)"}:undefined})).then((c)=>done(id,c))
.catch(()=>loadScript("${HTML2CANVAS_URL}",()=>window.html2canvas||window.html2canvasPro).then((h2c)=>h2c(document.body,{backgroundColor:getComputedStyle(document.body).backgroundColor||"#fff",x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,windowWidth:innerWidth,windowHeight:innerHeight,scale,useCORS:true,logging:false,onclone:(doc)=>{const st=doc.createElement("style");st.textContent="*,*::before,*::after{animation:none!important;transition:none!important}";doc.head.appendChild(st)}})).then((c)=>done(id,c)))
.catch((err)=>post({type:"capture",id,error:String((err&&err.message)||err)}))};
addEventListener("message",(e)=>{const d=e.data;if(!d||!d.__htmlNodeHost)return;if(d.type==="pick-mode")setPick(!!d.on);if(d.type==="capture")shoot(d.id)});
})();`;

// One line, inserted right after <head>, so line numbers in reported errors match the page source.
const BRIDGE_TAG = `<script>${BRIDGE.replace(/\n/g, "").replace(/<\/script/gi, "<\\/script")}</script>`;

export function withHtmlBridge(html: string) {
    return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${BRIDGE_TAG}`) : `${BRIDGE_TAG}${html}`;
}

export function isHtmlFrameMessage(data: unknown): data is HtmlFrameMessage & { __htmlNode: 1 } {
    return Boolean(data && typeof data === "object" && (data as { __htmlNode?: unknown }).__htmlNode === 1);
}

export function postToHtmlFrame(frame: HTMLIFrameElement | null | undefined, message: Record<string, unknown>) {
    frame?.contentWindow?.postMessage({ __htmlNodeHost: 1, ...message }, "*");
}

// ---------------------------------------------------------------------------------------------------------------
// Canvas images inside pages. The page cannot load the canvas's (login-protected) files itself, so pages reference
// them as sc-file:<storageKey> / sc-node:<nodeId>; before rendering, each reference is fetched with the user's session,
// scaled down and inlined as a data: URL. The saved page stays small and readable.
// ---------------------------------------------------------------------------------------------------------------

const IMAGE_TOKEN = /sc-(file|node):([A-Za-z0-9_.\-/]+)/g;
const MAX_IMAGE_EDGE = 1280;
const resolvedImages = new Map<string, Promise<string>>();

export function htmlImageTokens(html: string) {
    return Array.from(new Set(Array.from(html.matchAll(IMAGE_TOKEN), (match) => match[0])));
}

async function shrinkToDataUrl(dataUrl: string) {
    if (!dataUrl.startsWith("data:image/") || dataUrl.startsWith("data:image/svg")) return dataUrl;
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && dataUrl.length < 400_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.86);
}

/** The storage reference for an image node, as pages should write it. */
export function canvasImageToken(node: CanvasNodeData) {
    const key = node.metadata?.storageKey;
    return key && /^(uploads|tasks)\//.test(key) ? `sc-file:${key}` : `sc-node:${node.id}`;
}

export async function resolveHtmlImages(html: string, getNode: (id: string) => CanvasNodeData | null) {
    const tokens = htmlImageTokens(html);
    if (!tokens.length) return html;
    const { imageToDataUrl } = await import("@/services/image-storage");
    const entries = await Promise.all(
        tokens.map(async (token) => {
            const [, kind, value] = /^sc-(file|node):(.+)$/.exec(token)!;
            // Node references depend on the node's current image, so they are not cached across renders.
            const cacheKey = kind === "file" ? token : `${token}|${getNode(value)?.metadata?.storageKey || getNode(value)?.metadata?.content?.slice(0, 64) || ""}`;
            let pending = resolvedImages.get(cacheKey);
            if (!pending) {
                pending = (async () => {
                    if (kind === "file") return shrinkToDataUrl(await imageToDataUrl({ storageKey: value }));
                    const node = getNode(value);
                    if (!node?.metadata?.content && !node?.metadata?.storageKey) return "";
                    return shrinkToDataUrl(await imageToDataUrl({ url: node.metadata.content, storageKey: node.metadata.storageKey }));
                })().catch(() => "");
                resolvedImages.set(cacheKey, pending);
            }
            return [token, await pending] as const;
        }),
    );
    const map = new Map(entries.filter(([, url]) => url));
    return html.replace(IMAGE_TOKEN, (token) => map.get(token) || token);
}
