export function getHostAppOrigin() {
    const configured = String(import.meta.env.VITE_MAIN_APP_URL || "").trim();
    if (configured) return new URL(configured, window.location.origin).origin;

    if (window.parent !== window && document.referrer) {
        try {
            return new URL(document.referrer).origin;
        } catch {
            // Fall through to the standalone development default.
        }
    }

    if (import.meta.env.DEV) {
        const mainApp = new URL(window.location.origin);
        mainApp.port = "3102";
        return mainApp.origin;
    }
    return window.location.origin;
}
