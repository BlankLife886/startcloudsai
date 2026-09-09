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
      "light";
    const appearance = value === "dark" ? "dark" : "light";
    root.classList.toggle("color-scheme-dark", appearance === "dark");
    root.dataset.colorScheme = appearance;
    root.style.colorScheme = appearance;
  } catch {
    document.documentElement.dataset.colorScheme = "light";
  }
})();
