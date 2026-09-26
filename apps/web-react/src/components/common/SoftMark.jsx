import { Image, MessageSquare, Sparkles, WandSparkles } from "lucide-react";
import modelAiIcon from "../../legacy-static/assets/icons/model-ai.png?url";
import "./SoftMark.css";

const GLYPHS = {
  chat: MessageSquare,
  agent: WandSparkles,
  image: Image,
  sparkles: Sparkles,
};

export const MODEL_AI_ICON = modelAiIcon;

export function SoftMark({ name = "sparkles", size = "sm", className = "" } = {}) {
  if (name === "cpu") {
    return (
      <span
        className={["sc-soft-mark", "sc-soft-mark--image", `sc-soft-mark--${size}`, className].filter(Boolean).join(" ")}
        aria-hidden="true"
      >
        <img src={MODEL_AI_ICON} alt="" />
      </span>
    );
  }

  const Glyph = GLYPHS[name] || Sparkles;
  return (
    <span
      className={["sc-soft-mark", `sc-soft-mark--${size}`, className].filter(Boolean).join(" ")}
      aria-hidden="true"
    >
      <Glyph />
    </span>
  );
}
