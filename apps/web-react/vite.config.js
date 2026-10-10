import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const CANVAS_SOURCE_DIR = fileURLToPath(new URL("./src/canvas", import.meta.url));
const CANVAS_VERSION = readFileSync(
  fileURLToPath(new URL("./CANVAS_VERSION", import.meta.url)),
  "utf8",
).trim() || "dev";

function canvasSourceAlias() {
  return {
    name: "canvas-source-alias",
    enforce: "pre",
    transform(code, id) {
      const filename = id.split("?")[0];
      if (!filename.startsWith(CANVAS_SOURCE_DIR) || !/\.[cm]?[jt]sx?$/.test(filename)) {
        return null;
      }
      return code.replace(/(["'])@\//g, "$1@canvas/");
    },
  };
}

function canvasOptimizeAlias() {
  const resolveSource = (source) => {
    const base = resolve(CANVAS_SOURCE_DIR, source);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      `${base}.js`,
      `${base}.jsx`,
      resolve(base, "index.ts"),
      resolve(base, "index.tsx"),
      resolve(base, "index.js"),
      resolve(base, "index.jsx"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) || base;
  };
  return {
    name: "canvas-optimize-alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        if (!args.importer.startsWith(CANVAS_SOURCE_DIR)) return undefined;
        return { path: resolveSource(args.path.slice(2)) };
      });
    },
  };
}

export default defineConfig({
  plugins: [
    canvasSourceAlias(),
    react(),
  ],
  publicDir: fileURLToPath(new URL("./public", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src/legacy-modules", import.meta.url)),
      "@react": fileURLToPath(new URL("./src", import.meta.url)),
      "@canvas": CANVAS_SOURCE_DIR,
    },
    dedupe: ["react", "react-dom", "react-router"],
  },
  define: {
    __APP_VERSION__: JSON.stringify(CANVAS_VERSION),
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [canvasOptimizeAlias()],
    },
  },
  server: {
    port: 3105,
    proxy: {
      // 手机站（apps/web-mobile）独立运行在 3106，开发时与线上一样挂在同源 /m 下，共用登录 Cookie。
      "^/m(?:/|$)": {
        target: process.env.VITE_MOBILE_PROXY_TARGET || "http://127.0.0.1:3106",
        ws: true,
      },
      "^/v1(?:/|$)": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
        // Synchronous image generation may wait for the existing task worker.
        timeout: 300_000,
        proxyTimeout: 300_000,
        configure(proxy) {
          proxy.on("error", (error, _request, response) => {
            if (typeof response.writeHead !== "function" || response.headersSent || response.writableEnded) return;
            const target = process.env.VITE_API_PROXY_TARGET || "http://localhost:8000";
            // Nothing reached the API, so a retry is safe once it is back up.
            const unreachable = ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH"].includes(error?.code);
            response.writeHead(502, {
              "Content-Type": "application/json",
              "X-Request-ID": randomUUID(),
              "X-Should-Retry": unreachable ? "true" : "false",
            });
            response.end(JSON.stringify({ error: {
              message: unreachable
                ? `开发代理无法连接本地 API（${target}），请确认后端 serve 已启动`
                : `开发代理与本地 API 的连接中断（${error?.code || "unknown"}），本次不扣费`,
              type: "server_error",
              param: null,
              code: unreachable ? "api_unreachable" : "bad_gateway",
            } }));
          });
        },
      },
      "/api": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
        // 局域网真机调试（npm run dev:lan）时页面来源是局域网 IP，不在后端写请求的 Origin 白名单里；
        // 仅在这个开发入口把它改写成已允许的本机地址，后端与线上的校验不变。
        ...(process.env.DEV_LAN_ORIGIN ? {
          configure(proxy) {
            proxy.on("proxyReq", (proxyReq) => {
              if (proxyReq.getHeader("origin")) proxyReq.setHeader("origin", process.env.DEV_LAN_ORIGIN);
            });
          },
        } : {}),
      },
      "/oauth": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
      "/.well-known": {
        target: process.env.VITE_API_PROXY_TARGET || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  worker: {
    format: "es",
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsDir: "assets",
    sourcemap: false,
  },
});
