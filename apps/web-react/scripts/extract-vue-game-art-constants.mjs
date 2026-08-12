import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseJavaScript } from "@babel/parser";
import { parse } from "@vue/compiler-sfc";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const filename = resolve(appRoot, "../web/src/views/GameArtStudioView.vue");
const output = resolve(appRoot, "src/generated/gameArtConstants.js");
const expectedConstants = new Set([
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
  if (!names.some((name) => expectedConstants.has(name))) continue;
  declarations.push(`export ${script.slice(statement.start, statement.end)}`);
}

const exported = new Set(
  declarations.flatMap((value) =>
    [...value.matchAll(/\bconst\s+([A-Z][A-Z0-9_]*)/g)].map((match) => match[1]),
  ),
);
const missing = [...expectedConstants].filter((name) => !exported.has(name));
if (missing.length) throw new Error(`Missing game art constants: ${missing.join(", ")}`);

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `// Generated from apps/web/src/views/GameArtStudioView.vue.\n${declarations.join("\n\n")}\n`,
);
console.log(output);
