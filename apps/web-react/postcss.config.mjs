import tailwindcss from "@tailwindcss/postcss";
import prefixSelector from "postcss-prefix-selector";

const canvasStyles = `${process.platform === "win32" ? "\\" : "/"}apps${process.platform === "win32" ? "\\" : "/"}canvas-react${process.platform === "win32" ? "\\" : "/"}src${process.platform === "win32" ? "\\" : "/"}styles${process.platform === "win32" ? "\\" : "/"}globals.css`;

const strengthenCanvasUtilities = {
  postcssPlugin: "strengthen-native-canvas-utilities",
  OnceExit(root, { result }) {
    if (!String(result.opts.from || "").includes(canvasStyles)) return;
    root.walkAtRules("layer", (rule) => {
      if (rule.params.trim() !== "utilities") return;
      rule.walkDecls((declaration) => {
        declaration.important = true;
      });
    });
  },
};

export default {
  plugins: [
    tailwindcss(),
    prefixSelector({
      prefix: ".canvas-native-mount",
      transform(prefix, selector, prefixedSelector, filePath) {
        if (!String(filePath || "").includes(canvasStyles)) return selector;
        if (selector === ":root" || selector === "html" || selector === "body") return prefix;
        if (selector.startsWith("html.starclouds-hosted ")) {
          return `${prefix} ${selector.slice("html.starclouds-hosted ".length)}`;
        }
        if (selector.startsWith(".dark ")) {
          return `${prefix}.dark ${selector.slice(".dark ".length)}`;
        }
        return prefixedSelector;
      },
    }),
    strengthenCanvasUtilities,
  ],
};
