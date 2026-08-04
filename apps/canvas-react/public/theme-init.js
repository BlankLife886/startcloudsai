try {
    const theme = new URLSearchParams(window.location.search).get("theme") === "dark" ? "dark" : "light";
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.style.colorScheme = theme;
} catch {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "light";
}
