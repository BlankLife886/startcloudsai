// Keep this independent of the application bundle, including in production.
(() => {
  if (window.__starcloudHomeBannerBootstrap || location.pathname !== "/"
    || new URLSearchParams(location.search).get("previewBanners") === "1") return;

  const initial = { startedAt: Date.now(), promise: null };
  window.__starcloudHomeBannerBootstrap = initial;

  // Match the carousel's accepted image URLs before speculatively fetching anything.
  function validImageURL(value) {
    if (typeof value !== "string" || /[\\\u0000-\u0020]/.test(value)) return false;
    if (value.startsWith("/") && !value.startsWith("//")) return true;
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }

  initial.promise = fetch("/api/v1/home-banners", { credentials: "include", cache: "no-store" })
    .then(async response => {
      const payload = await response.json();
      if (!response.ok || payload?.success !== true) throw new Error("Home banners unavailable");
      const now = Date.now();
      const first = (Array.isArray(payload.data?.items) ? payload.data.items : []).find(item => item
        && validImageURL(item.imageUrl) && item.active !== false
        && (!item.startsAt || Date.parse(item.startsAt) <= now)
        && (!item.endsAt || Date.parse(item.endsAt) > now));
      if (first) {
        const preload = document.createElement("link");
        preload.rel = "preload";
        preload.as = "image";
        preload.fetchPriority = "high";
        preload.href = first.imageUrl;
        preload.onload = preload.onerror = () => preload.remove();
        document.head.append(preload);
      }
      return payload.data;
    });
  // A route can unmount before React subscribes; avoid an unhandled rejection.
  initial.promise.catch(() => {});
})();
