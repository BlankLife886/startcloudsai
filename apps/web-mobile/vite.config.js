import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 手机站与桌面站共用业务层：接口、鉴权、任务轮询等直接引用 web-react 源码，界面与交互独立。
const WEB_SRC = fileURLToPath(new URL("../web-react/src", import.meta.url));
const API_TARGET = process.env.VITE_API_PROXY_TARGET || "http://localhost:8000";

// 共享源码里只有桌面画布的新手引导会动态加载 @canvas（且包在 try 里）；手机站没有画布，给个空模块，
// 不把整套画布源码打进来。
function canvasStub() {
  const STUB = "\0canvas-stub";
  return {
    name: "canvas-stub",
    enforce: "pre",
    resolveId(id) {
      return id.startsWith("@canvas/") ? STUB : null;
    },
    load(id) {
      return id === STUB ? "export const useCanvasStore = undefined;\nexport default undefined;" : null;
    },
  };
}

export default defineConfig({
  base: "/m/",
  plugins: [canvasStub(), react()],
  resolve: {
    alias: {
      "@mobile": fileURLToPath(new URL("./src", import.meta.url)),
      "@react": WEB_SRC,
      "@": `${WEB_SRC}/legacy-modules`,
    },
    // 共享源码里的 react 等必须与本应用是同一份实例。
    dedupe: ["react", "react-dom", "react-router", "localforage"],
  },
  // 参考图压缩引擎（共享源码）用模块 worker 加载 wasm 编码器。
  worker: { format: "es" },
  server: {
    port: 3106,
    fs: { allow: [".", "../web-react"] },
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
});
