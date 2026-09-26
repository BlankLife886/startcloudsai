import "./DownloadIcon.css";

export function DownloadIcon({ className = "", style } = {}) {
  return (
    <span
      className={["sc-icon-download", className].filter(Boolean).join(" ")}
      style={style}
      aria-hidden="true"
    />
  );
}
