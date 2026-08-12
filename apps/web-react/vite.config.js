import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { parseChangelog } from "../canvas-react/src/lib/release.ts";

const CANVAS_DIR = fileURLToPath(new URL("../canvas-react", import.meta.url));
const CANVAS_SOURCE_DIR = resolve(CANVAS_DIR, "src");
const CANVAS_PUBLIC_DIR = resolve(CANVAS_DIR, "public");
const CANVAS_VERSION = readFileSync(resolve(CANVAS_DIR, "VERSION"), "utf8").trim() || "dev";
const CANVAS_RELEASES = parseChangelog(
  readFileSync(resolve(CANVAS_DIR, "CHANGELOG.md"), "utf8"),
);

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

function canvasPublicAssets() {
  const mimeTypes = {
    ".js": "text/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  };
  const extension = (value) => value.slice(value.lastIndexOf("."));
  const listFiles = async (directory = CANVAS_PUBLIC_DIR, prefix = "") => {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...(await listFiles(resolve(directory, entry.name), name)));
      } else if (entry.isFile()) {
        files.push(name);
      }
    }
    return files;
  };
  return {
    name: "canvas-public-assets",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = decodeURIComponent(
          new URL(request.url || "/", "http://canvas.local").pathname,
        ).replace(/^\/+/, "");
        const allowed =
          pathname === "logo.svg" ||
          pathname === "config.js" ||
          pathname === "theme-init.js" ||
          pathname.startsWith("icons/") ||
          pathname.startsWith("quick-start/");
        if (!allowed || pathname.includes("..")) return next();
        try {
          const body = await readFile(resolve(CANVAS_PUBLIC_DIR, pathname));
          response.statusCode = 200;
          response.setHeader(
            "Content-Type",
            mimeTypes[extension(pathname)] || "application/octet-stream",
          );
          response.end(body);
        } catch {
          next();
        }
      });
    },
    async generateBundle() {
      for (const filename of await listFiles()) {
        this.emitFile({
          type: "asset",
          fileName: filename,
          source: await readFile(resolve(CANVAS_PUBLIC_DIR, filename)),
        });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    canvasSourceAlias(),
    canvasPublicAssets(),
    react(),
  ],
  publicDir: fileURLToPath(new URL("../web/public", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../web/src", import.meta.url)),
      "@react": fileURLToPath(new URL("./src", import.meta.url)),
      "@legacy": fileURLToPath(new URL("../web/src", import.meta.url)),
      "@canvas": CANVAS_SOURCE_DIR,
    },
    dedupe: ["react", "react-dom", "react-router"],
  },
  define: {
    __APP_VERSION__: JSON.stringify(CANVAS_VERSION),
    __APP_RELEASES__: JSON.stringify(CANVAS_RELEASES),
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [canvasOptimizeAlias()],
    },
  },
  server: {
    port: 3105,
    fs: {
      allow: [fileURLToPath(new URL("..", import.meta.url))],
    },
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
