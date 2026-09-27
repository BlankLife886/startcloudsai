import { PANORAMA_FRAGMENT, type PanoramaSource } from "./panorama-viewer";

// A shared panorama is one self-contained page: the images are embedded (the share link has no access to the user's
// files) and a few dozen lines of plain WebGL draw them with the canvas viewer's own shader. No CDN: script CDNs are
// slow or unreachable for many visitors, and a page that cannot load its viewer is just a black screen.

export type SharedScene = { id: string; title: string; image: string; hotspots: Array<{ lon: number; lat: number; label: string; target?: string }> };

const SHARE_LIMIT = 2_900_000;

/** Encodes a panorama for embedding, shrinking it until the whole tour fits in one shared page. */
export function encodeSceneImage(source: PanoramaSource, width: number, quality: number) {
    const scale = Math.min(1, width / source.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(source.width * scale);
    canvas.height = Math.round(source.height * scale);
    canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", quality);
}

export function fitsShareLimit(scenes: SharedScene[]) {
    return scenes.reduce((sum, scene) => sum + scene.image.length, 0) + 12_000 < SHARE_LIMIT;
}

function escapeHtml(value: string) {
    return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

export function buildPanoramaSharePage(title: string, scenes: SharedScene[]) {
    // JSON inside <script> must not be able to close the tag.
    const data = JSON.stringify(scenes).replace(/</g, "\\u003c");
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${escapeHtml(title)}</title>
<style>
html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#fff;touch-action:none}
#view{position:fixed;inset:0}
.bar{position:fixed;left:0;right:0;top:0;display:flex;align-items:center;gap:10px;padding:14px 16px;background:linear-gradient(rgba(0,0,0,.55),transparent);pointer-events:none}
.bar b{font-size:15px}.bar span{font-size:12px;opacity:.7}
.btns{position:fixed;right:14px;bottom:18px;display:flex;gap:8px}
.btn{border:0;border-radius:99px;padding:9px 14px;background:rgba(0,0,0,.5);color:#fff;font-size:13px;backdrop-filter:blur(8px)}
.btn.on{background:#fff;color:#111}
.hot{position:fixed;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:6px;pointer-events:auto;cursor:pointer}
.hot i{width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 0 0 6px rgba(255,255,255,.35);animation:p 1.8s infinite}
.hot span{font-size:12px;padding:3px 9px;border-radius:8px;background:rgba(0,0,0,.6);white-space:nowrap}
.back{position:fixed;left:14px;bottom:18px}
@keyframes p{50%{box-shadow:0 0 0 10px rgba(255,255,255,.12)}}
</style></head><body>
<div id="view"></div><div class="bar"><b id="t"></b><span>拖动查看 · 双指或滚轮缩放</span></div>
<div id="hots"></div>
<div class="btns"><button class="btn" id="gyro">陀螺仪</button><button class="btn on" id="rot">自动旋转</button></div>
<button class="btn back" id="back" hidden>← 返回</button>
<script>
(() => {
const scenes = ${data};
const byId = Object.fromEntries(scenes.map((s) => [s.id, s]));
const R = Math.PI / 180;
const canvas = document.createElement("canvas"); canvas.style.cssText = "width:100%;height:100%;display:block;touch-action:none";
document.getElementById("view").appendChild(canvas);
const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
if (!gl) { document.getElementById("t").textContent = "当前浏览器不支持 WebGL"; return; }
const compile = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return sh; };
const vertex = "attribute vec2 position; varying vec2 vUv; void main(){ vUv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }";
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, vertex)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, ${JSON.stringify(PANORAMA_FRAGMENT)})); gl.linkProgram(program); gl.useProgram(program);
const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
const U = (name) => gl.getUniformLocation(program, name);
const u = { lon: U("lon"), lat: U("lat"), fov: U("fov"), planetFov: U("planetFov"), aspect: U("aspect"), mode: U("mode"), map: U("map") };
gl.uniform1i(u.mode, 0); gl.uniform1f(u.planetFov, 270); gl.uniform1i(u.map, 0);
const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
let view = { lon: 0, lat: 0, fov: 75 }, auto = true, gyro = null, current = null, loaded = false; const history = [];
function show(id) {
  const s = byId[id]; if (!s) return; current = s; document.getElementById("t").textContent = s.title; document.title = s.title;
  const image = new Image(); image.onload = () => { gl.bindTexture(gl.TEXTURE_2D, texture); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image); loaded = true; }; image.src = s.image;
  view = { lon: 0, lat: 0, fov: view.fov }; document.getElementById("back").hidden = !history.length; drawHots();
}
function project(lon, lat) {
  const l = lon * R, b = lat * R, d = { x: Math.cos(b) * Math.sin(l), y: Math.sin(b), z: -Math.cos(b) * Math.cos(l) };
  const L = view.lon * R, x1 = d.x * Math.cos(L) + d.z * Math.sin(L), z1 = -d.x * Math.sin(L) + d.z * Math.cos(L);
  const A = view.lat * R, y2 = d.y * Math.cos(A) + z1 * Math.sin(A), z2 = -d.y * Math.sin(A) + z1 * Math.cos(A);
  if (z2 >= -0.02) return null; const f = 1 / Math.tan(view.fov * R / 2), W = innerWidth, H = innerHeight;
  return { x: ((x1 * f / -z2) / (W / H) + 1) / 2 * W, y: (1 - (y2 * f / -z2)) / 2 * H };
}
const hots = document.getElementById("hots");
function drawHots() { hots.innerHTML = ""; (current?.hotspots || []).forEach((h) => { const el = document.createElement("div"); el.className = "hot"; el.innerHTML = "<i></i><span></span>"; el.querySelector("span").textContent = h.label; el.onclick = () => { if (h.target && byId[h.target]) { history.push(current.id); show(h.target); } }; el._h = h; hots.appendChild(el); }); }
function placeHots() { for (const el of hots.children) { const p = project(el._h.lon, el._h.lat); el.style.display = p ? "flex" : "none"; if (p) { el.style.left = p.x + "px"; el.style.top = p.y + "px"; } } }
document.getElementById("back").onclick = () => { const id = history.pop(); if (id) show(id); };
const rot = document.getElementById("rot"); rot.onclick = () => { auto = !auto; rot.classList.toggle("on", auto); };
const gyroBtn = document.getElementById("gyro");
if (typeof DeviceOrientationEvent === "undefined") gyroBtn.hidden = true;
gyroBtn.onclick = async () => {
  if (gyro) { removeEventListener("deviceorientation", gyro); gyro = null; gyroBtn.classList.remove("on"); return; }
  try { if (DeviceOrientationEvent.requestPermission && (await DeviceOrientationEvent.requestPermission()) !== "granted") return; } catch { return; }
  gyro = (e) => { if (e.alpha == null) return; auto = false; rot.classList.remove("on"); view.lon = -e.alpha; view.lat = Math.max(-85, Math.min(85, (e.beta || 0) - 90)); };
  addEventListener("deviceorientation", gyro); gyroBtn.classList.add("on");
};
let drag = null, pinch = null; const pts = new Map();
canvas.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, e); try { canvas.setPointerCapture(e.pointerId); } catch {} auto = false; rot.classList.remove("on"); if (pts.size === 1) drag = { x: e.clientX, y: e.clientY, lon: view.lon, lat: view.lat }; else { const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), fov: view.fov }; drag = null; } });
canvas.addEventListener("pointermove", (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, e); if (pinch && pts.size === 2) { const [a, b] = [...pts.values()]; view.fov = Math.max(30, Math.min(100, pinch.fov * pinch.d / Math.max(1, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)))); } else if (drag) { const k = view.fov / innerHeight; view.lon = drag.lon - (e.clientX - drag.x) * k; view.lat = Math.max(-89, Math.min(89, drag.lat + (e.clientY - drag.y) * k)); } });
const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
addEventListener("wheel", (e) => { e.preventDefault(); view.fov = Math.max(30, Math.min(100, view.fov + e.deltaY * 0.04)); }, { passive: false });
function frame() {
  const ratio = Math.min(devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  if (canvas.width !== Math.round(W * ratio) || canvas.height !== Math.round(H * ratio)) { canvas.width = Math.round(W * ratio); canvas.height = Math.round(H * ratio); }
  gl.viewport(0, 0, canvas.width, canvas.height);
  if (auto && !drag) view.lon += 0.03;
  gl.uniform1f(u.lon, view.lon); gl.uniform1f(u.lat, view.lat); gl.uniform1f(u.fov, view.fov); gl.uniform1f(u.aspect, W / H);
  if (loaded) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  placeHots(); requestAnimationFrame(frame);
}
show(scenes[0].id); frame();
})();
</script></body></html>`;
}
