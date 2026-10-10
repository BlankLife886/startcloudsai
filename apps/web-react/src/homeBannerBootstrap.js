export function safeBannerURL(value) {
  if (typeof value !== "string" || /[\\\u0000-\u0020]/.test(value)) return "";
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : "";
  } catch { return ""; }
}

export function consumeInitialHomeBanners() {
  if (typeof window === "undefined") return null;
  const initial = window.__starcloudHomeBannerBootstrap;
  if (!initial || initial.claimed || Date.now() - initial.startedAt >= 60000) {
    // If the tiny bootstrap script arrives late, React already owns the request.
    window.__starcloudHomeBannerBootstrap = { claimed: true };
    return null;
  }
  // StrictMode mounts can share a pending request. Later mounts revalidate normally.
  return initial.promise.finally(() => {
    if (window.__starcloudHomeBannerBootstrap === initial) {
      window.__starcloudHomeBannerBootstrap = { claimed: true };
    }
  });
}
