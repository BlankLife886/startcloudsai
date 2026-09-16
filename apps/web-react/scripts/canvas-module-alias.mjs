/**
 * Resolves the Vite path aliases for `node --test`, so domain tests can import
 * canvas source that uses `@/` without rewriting it to relative paths.
 *
 * The mapping mirrors vite.config.js: `@` is `src/legacy-modules`, except in
 * canvas source where the `canvas-source-alias` plugin rewrites `@/` to
 * `@canvas/` (`src/canvas`) before resolution.
 */
import { existsSync, statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

const SRC_DIR = fileURLToPath(new URL("../src/", import.meta.url));
const CANVAS_DIR = `${SRC_DIR}canvas/`;
const LEGACY_DIR = `${SRC_DIR}legacy-modules/`;
const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".json"];

function resolveFile(base) {
    if (existsSync(base) && statSync(base).isFile()) return base;
    for (const extension of EXTENSIONS) {
        const candidate = `${base}${extension}`;
        if (existsSync(candidate)) return candidate;
    }
    for (const extension of EXTENSIONS) {
        const candidate = `${base}/index${extension}`;
        if (existsSync(candidate)) return candidate;
    }
    return null;
}

function aliasTarget(specifier, parentURL) {
    if (specifier.startsWith("@canvas/")) return CANVAS_DIR + specifier.slice("@canvas/".length);
    if (specifier.startsWith("@react/")) return SRC_DIR + specifier.slice("@react/".length);
    // Vite also resolves extensionless relative imports; Node ESM does not.
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
        if (!parentURL?.startsWith("file:")) return null;
        return fileURLToPath(new URL(specifier, parentURL));
    }
    if (!specifier.startsWith("@/")) return null;
    const parent = parentURL?.startsWith("file:") ? fileURLToPath(parentURL) : "";
    const root = parent.startsWith(CANVAS_DIR) ? CANVAS_DIR : LEGACY_DIR;
    return root + specifier.slice("@/".length);
}

registerHooks({
    resolve(specifier, context, nextResolve) {
        const target = aliasTarget(specifier, context.parentURL);
        if (!target) return nextResolve(specifier, context);
        const file = resolveFile(target);
        if (!file) return nextResolve(specifier, context);
        return { url: pathToFileURL(file).href, shortCircuit: true };
    },
});
