import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { parse as parseJavaScript } from "@babel/parser";
import react from "@vitejs/plugin-react";
import { compileStyleAsync, parse } from "@vue/compiler-sfc";
import { defineConfig } from "vite";
import { parseChangelog } from "../canvas-react/src/lib/release.ts";

const REACT_STYLE_SUFFIX = "?react-style";
const REACT_STYLE_PREFIX = "\0legacy-vue-style:";
const REACT_CONSTANTS_SUFFIX = "?react-game-art-constants";
const REACT_CONSTANTS_PREFIX = "\0legacy-game-art-constants:";
const GAME_ART_CONSTANTS = new Set([
  "STUDIO_BACKGROUND_OPTIONS",
  "CHARACTER_POSE_OPTIONS",
  "ASSET_TYPES",
  "STYLE_OPTIONS",
  "DEFAULT_POSITIVE",
  "DEFAULT_NEGATIVE",
  "POSITIVE_CONSTRAINT_PRESETS",
  "NEGATIVE_CONSTRAINT_PRESETS",
  "CLARITY_OPTIONS",
  "REFERENCE_CONSTRAINT_OPTIONS",
]);
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

function legacyGameArtConstants() {
  return {
    name: "legacy-game-art-constants",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(REACT_CONSTANTS_SUFFIX)) return null;
      const request = source.slice(0, -REACT_CONSTANTS_SUFFIX.length);
      const resolved = await this.resolve(request, importer, { skipSelf: true });
      return resolved ? `${REACT_CONSTANTS_PREFIX}${resolved.id}` : null;
    },
    async load(id) {
      if (!id.startsWith(REACT_CONSTANTS_PREFIX)) return null;
      const filename = id.slice(REACT_CONSTANTS_PREFIX.length);
      this.addWatchFile(filename);
      const source = await readFile(filename, "utf8");
      const { descriptor, errors } = parse(source, { filename });
      if (errors.length) throw errors[0];
      const script = descriptor.scriptSetup?.content || descriptor.script?.content || "";
      const ast = parseJavaScript(script, {
        sourceType: "module",
        plugins: ["optionalChaining", "nullishCoalescingOperator"],
      });
      const declarations = [];
      for (const statement of ast.program.body) {
        if (statement.type !== "VariableDeclaration") continue;
        const names = statement.declarations
          .map((item) => item.id?.type === "Identifier" ? item.id.name : "")
          .filter(Boolean);
        if (!names.some((name) => GAME_ART_CONSTANTS.has(name))) continue;
        declarations.push(`export ${script.slice(statement.start, statement.end)}`);
      }
      const exported = new Set(
        declarations.flatMap((value) =>
          [...value.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]),
        ),
      );
      const missing = [...GAME_ART_CONSTANTS].filter((name) => !exported.has(name));
      if (missing.length) throw new Error(`Missing game art constants: ${missing.join(", ")}`);
      return declarations.join("\n\n");
    },
  };
}

function legacyVueStyles() {
  return {
    name: "legacy-vue-styles",
    enforce: "pre",
    async resolveId(source, importer) {
      if (!source.endsWith(REACT_STYLE_SUFFIX)) return null;
      const request = source.slice(0, -REACT_STYLE_SUFFIX.length);
      const resolved = await this.resolve(request, importer, {
        skipSelf: true,
      });
      return resolved ? `${REACT_STYLE_PREFIX}${resolved.id}` : null;
    },
    async load(id) {
      if (!id.startsWith(REACT_STYLE_PREFIX)) return null;
      const filename = id.slice(REACT_STYLE_PREFIX.length);
      this.addWatchFile(filename);
      const source = await readFile(filename, "utf8");
      const { descriptor, errors } = parse(source, { filename });
      if (errors.length) throw errors[0];

      const compiled = await Promise.all(
        descriptor.styles.map(async (style, index) => {
          const styleSource = style.src
            ? await readFile(resolve(dirname(filename), style.src), "utf8")
            : style.content;
          if (style.src)
            this.addWatchFile(resolve(dirname(filename), style.src));
          const result = await compileStyleAsync({
            filename,
            id: `react-legacy-${index}`,
            source: styleSource,
            scoped: false,
          });
          if (result.errors.length) throw result.errors[0];
          return result.code;
        }),
      );
      const css = compiled.join("\n");
      const styleId = `legacy-vue-style-${Buffer.from(filename).toString("base64url")}`;
      return `
        const css = ${JSON.stringify(css)};
        function ensureLegacyStyle() {
          if (typeof document === "undefined") return null;
          let style = document.getElementById(${JSON.stringify(styleId)});
          if (!style) {
            style = document.createElement("style");
            style.id = ${JSON.stringify(styleId)};
          }
          style.textContent = css;
          document.head.appendChild(style);
          return style;
        }
        export function activateLegacyStyle() { ensureLegacyStyle(); }
        export function deactivateLegacyStyle() {
          if (typeof document !== "undefined") {
            document.getElementById(${JSON.stringify(styleId)})?.remove();
          }
        }
        ensureLegacyStyle();
        export default css;
      `;
    },
  };
}

export default defineConfig({
  plugins: [
    canvasSourceAlias(),
    canvasPublicAssets(),
    legacyGameArtConstants(),
    legacyVueStyles(),
    react(),
  ],
  publicDir: fileURLToPath(new URL("../web/public", import.meta.url)),
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../web/src", import.meta.url)),
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
