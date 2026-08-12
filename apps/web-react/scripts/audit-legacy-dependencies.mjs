import { existsSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const reactRoot = resolve(appRoot, "src");
const legacyRoot = resolve(appRoot, "../web/src");
const sourceExtensions = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"]);

async function listSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listSourceFiles(filename)));
    else if (sourceExtensions.has(extname(entry.name))) files.push(filename);
  }
  return files;
}

function collectSpecifiers(source, filename) {
  const ast = parse(source, {
    sourceType: "module",
    sourceFilename: filename,
    plugins: ["jsx", "typescript", "optionalChaining", "nullishCoalescingOperator"],
  });
  const specifiers = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (
      (node.type === "ImportDeclaration" ||
        node.type === "ExportNamedDeclaration" ||
        node.type === "ExportAllDeclaration") &&
      typeof node.source?.value === "string"
    ) {
      specifiers.push(node.source.value);
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "Import" &&
      typeof node.arguments?.[0]?.value === "string"
    ) {
      specifiers.push(node.arguments[0].value);
    } else if (node.type === "ImportExpression" && typeof node.source?.value === "string") {
      specifiers.push(node.source.value);
    } else if (
      node.type === "NewExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "URL" &&
      typeof node.arguments?.[0]?.value === "string" &&
      node.arguments?.[1]?.type === "MemberExpression" &&
      node.arguments[1].object?.type === "MetaProperty" &&
      node.arguments[1].object.meta?.name === "import" &&
      node.arguments[1].property?.name === "url"
    ) {
      specifiers.push(node.arguments[0].value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object" && typeof value.type === "string") visit(value);
    }
  };
  visit(ast.program);
  return specifiers;
}

function resolveFile(base) {
  const candidates = [
    base,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.json`,
    resolve(base, "index.js"),
    resolve(base, "index.jsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
}

function resolveLegacySpecifier(specifier, importer) {
  const cleanSpecifier = specifier.split("?")[0];
  if (specifier.startsWith("@legacy/")) {
    return resolveFile(resolve(legacyRoot, cleanSpecifier.slice("@legacy/".length)));
  }
  if (specifier.startsWith("@/")) {
    return resolveFile(resolve(legacyRoot, cleanSpecifier.slice(2)));
  }
  if (specifier.startsWith(".")) {
    return resolveFile(resolve(dirname(importer), cleanSpecifier));
  }
  return null;
}

const roots = [];
for (const filename of await listSourceFiles(reactRoot)) {
  const source = await readFile(filename, "utf8");
  for (const specifier of collectSpecifiers(source, filename)) {
    if (!specifier.startsWith("@legacy/")) continue;
    const resolved = resolveLegacySpecifier(specifier, filename);
    if (!resolved) throw new Error(`Cannot resolve ${specifier} from ${filename}`);
    roots.push(resolved);
  }
}

const queue = [...new Set(roots)];
const files = new Set();
while (queue.length) {
  const filename = queue.shift();
  if (files.has(filename)) continue;
  files.add(filename);
  if (!sourceExtensions.has(extname(filename))) continue;
  const source = await readFile(filename, "utf8");
  for (const specifier of collectSpecifiers(source, filename)) {
    const resolved = resolveLegacySpecifier(specifier, filename);
    if (!resolved) continue;
    if (!resolved.startsWith(`${legacyRoot}/`)) {
      throw new Error(`Legacy dependency escaped source root: ${resolved}`);
    }
    queue.push(resolved);
  }
}

const relativeFiles = [...files]
  .map((filename) => filename.slice(legacyRoot.length + 1))
  .sort();
const counts = Object.groupBy(relativeFiles, (filename) => extname(filename) || "[none]");
console.error(
  JSON.stringify(
    {
      directRoots: new Set(roots).size,
      totalFiles: relativeFiles.length,
      extensions: Object.fromEntries(
        Object.entries(counts).map(([extension, values]) => [extension, values.length]),
      ),
    },
    null,
    2,
  ),
);
console.log(relativeFiles.join("\n"));
