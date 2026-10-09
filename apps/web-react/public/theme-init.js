(() => {
  try {
    const root = document.documentElement;
    root.classList.toggle(
      "canvas-entry",
      location.pathname === "/canvas" || location.pathname.startsWith("/canvas/"),
    );
    const value =
      localStorage.getItem("walleven-color-scheme") ||
      localStorage.getItem("starclouds-appearance") ||
      "system";
    const preference = value === "dark" || value === "light" ? value : "system";
    const appearance =
      preference === "system"
        ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : preference;
    root.classList.toggle("color-scheme-dark", appearance === "dark");
    root.dataset.colorScheme = appearance;
    root.dataset.colorSchemePreference = preference;
    root.style.colorScheme = appearance;
  } catch {
    document.documentElement.dataset.colorScheme = "light";
  }
})();
