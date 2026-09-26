export function taskAspectCss(task, fallback = "3 / 4") {
  const raw = String(task?.aspectRatio || task?.params?.aspectRatio || "");
  const [width, height] = raw.split(":").map(Number);
  if (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
  ) {
    return `${width} / ${height}`;
  }

  const size = String(task?.outputSize || task?.params?.size || "");
  const match = size.match(/(\d+)\s*[x×]\s*(\d+)/i);
  if (match) {
    const outputWidth = Number(match[1]);
    const outputHeight = Number(match[2]);
    if (outputWidth > 0 && outputHeight > 0) {
      return `${outputWidth} / ${outputHeight}`;
    }
  }
  return fallback;
}
