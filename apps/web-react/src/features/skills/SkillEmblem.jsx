const TONE_COLORS = {
  shopping: "#ac7855",
  image: "#8772b7",
  character: "#6c83a9",
  palette: "#b57d91",
  copy: "#718e7c",
  document: "#6e81a4",
};

const PAPER_STYLE = {
  position: "absolute",
  width: "68%",
  height: "74%",
  borderRadius: "23%",
  border: "1px solid rgba(255, 255, 255, 0.88)",
  boxSizing: "border-box",
};

export default function SkillEmblem({ children, tone = "image" }) {
  const accent = `var(--sd-accent, ${TONE_COLORS[tone] || TONE_COLORS.image})`;

  return (
    <span
      className="skills-demo__emblem"
      aria-hidden="true"
      style={{
        position: "relative",
        display: "inline-block",
        width: "var(--sd-emblem-size, 116px)",
        height: "var(--sd-emblem-size, 116px)",
        flex: "0 0 auto",
        isolation: "isolate",
        pointerEvents: "none",
        color: accent,
      }}
    >
      <span
        style={{
          ...PAPER_STYLE,
          left: "12%",
          top: "13%",
          transform: "rotate(-17deg)",
          background: `linear-gradient(145deg, color-mix(in srgb, ${accent} 12%, #fbfaf8), color-mix(in srgb, ${accent} 23%, #f4f2f0))`,
          boxShadow:
            "0 1px 3px rgba(45, 39, 56, 0.04), inset 0 -1px 0 rgba(45, 39, 56, 0.05)",
        }}
      />
      <span
        style={{
          ...PAPER_STYLE,
          left: "22%",
          top: "17%",
          transform: "rotate(10deg)",
          background: `linear-gradient(135deg, color-mix(in srgb, ${accent} 8%, white), color-mix(in srgb, ${accent} 17%, #f5f3f1))`,
          boxShadow:
            "0 3px 7px rgba(45, 39, 56, 0.05), inset 0 -1px 0 rgba(45, 39, 56, 0.04)",
        }}
      />
      <span
        style={{
          ...PAPER_STYLE,
          left: "16%",
          top: "12%",
          display: "grid",
          placeItems: "center",
          transform: "rotate(-3deg)",
          background: `linear-gradient(145deg, #ffffff 5%, color-mix(in srgb, ${accent} 6%, #fffefd) 52%, color-mix(in srgb, ${accent} 13%, #f8f6f4))`,
          boxShadow:
            "0 9px 15px -9px rgba(45, 39, 56, 0.22), 0 2px 4px rgba(45, 39, 56, 0.04), inset 0 1px 0 white, inset 0 -1px 0 rgba(45, 39, 56, 0.045)",
        }}
      >
        <span
          style={{
            display: "grid",
            placeItems: "center",
            transform: "rotate(3deg)",
            filter: "drop-shadow(0 1px 0 rgba(255, 255, 255, 0.9))",
          }}
        >
          {children}
        </span>
      </span>
    </span>
  );
}
