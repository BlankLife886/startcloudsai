export function summarizeGalleryGroup(items = []) {
  const rows = Array.isArray(items) ? items : [];
  const imageCover = rows.find((item) => item?.kind === "image");
  const pendingCover = rows.find((item) => item?.kind === "pending");
  const statusCover = rows.find((item) => item?.kind === "status");
  const imageCount = rows.filter((item) => item?.kind === "image").length;
  const pendingCount = rows.filter((item) => item?.kind === "pending").length;
  const statusCount = rows.filter((item) => item?.kind === "status").length;
  const kind = imageCover
    ? pendingCount || statusCount
      ? "mixed"
      : "image"
    : pendingCount
      ? "pending"
      : "status";

  return {
    cover: imageCover || pendingCover || statusCover || rows[0],
    imageCount,
    pendingCount,
    statusCount,
    kind,
  };
}
