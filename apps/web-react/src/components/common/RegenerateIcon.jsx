import "./RegenerateIcon.css";

export function RegenerateIcon({ className = "", style } = {}) {
  return (
    <span
      className={["sc-icon-regenerate", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    />
  );
}
