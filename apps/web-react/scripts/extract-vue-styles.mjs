import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { compileStyleAsync, parse } from "@vue/compiler-sfc";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const legacyRoot = resolve(appRoot, "../web/src");
const outputRoot = resolve(appRoot, "src/legacy-styles/generated");
const inputs = process.argv.slice(2);

if (!inputs.length) {
  throw new Error("Provide Vue files relative to apps/web/src");
}

for (const input of inputs) {
  const filename = resolve(legacyRoot, input);
  if (!filename.startsWith(`${legacyRoot}${sep}`) || !input.endsWith(".vue")) {
    throw new Error(`Invalid Vue style source: ${input}`);
  }

  const source = await readFile(filename, "utf8");
  const { descriptor, errors } = parse(source, { filename });
  if (errors.length) throw errors[0];

  const compiled = await Promise.all(
    descriptor.styles.map(async (style, index) => {
      const styleSource = style.src
        ? await readFile(resolve(dirname(filename), style.src), "utf8")
        : style.content;
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

  const output = resolve(outputRoot, input.replace(/\.vue$/, ".css"));
  const css = compiled.join("\n").trimEnd();
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `/* Generated from apps/web/src/${input}. */\n${css}\n`,
  );
  console.log(output);
}
