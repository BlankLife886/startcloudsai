import { existsSync, readFileSync } from "node:fs";
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
      "/api": {
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
