function mediaUrl(value) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  return String(value.url || value.image_url || value.outputUrl || value.src || "").trim();
}

function uniqueUrls(...groups) {
  return [
    ...new Set(
      groups
        .flatMap((group) => (Array.isArray(group) ? group : [group]))
        .map(mediaUrl)
        .filter(Boolean),
    ),
  ];
}

export function resolveTaskMedia(job = {}, result = null) {
  const originals = uniqueUrls(job.originalMediaUrls, job.originalMediaUrl);
  const completed = uniqueUrls(
    result?.outputs,
    result?.outputUrls,
    result?.originalUrls,
  );
  const previews = uniqueUrls(
    job.resultMediaUrls,
    job.resultMediaUrl,
    job.thumbnailUrls,
  );
  const displays = uniqueUrls(job.displayMediaUrls, job.displayMediaUrl);
  const urls = originals.length
    ? originals
    : completed.length
      ? completed
      : previews;

  return {
    urls,
    previewByUrl: Object.fromEntries(
      urls.map((url, index) => [url, previews[index] || url]),
    ),
    displayByUrl: Object.fromEntries(
      urls.map((url, index) => [url, displays[index] || ""]),
    ),
  };
}
