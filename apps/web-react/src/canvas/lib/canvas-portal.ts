/** Canvas CSS is prefixed to `.canvas-native-mount`. Portals must keep that class. */
export const CANVAS_OVERLAY_Z_INDEX = 12000;

const OVERLAY_CLASS = "canvas-overlay-root";

export function getCanvasPortalRoot(): HTMLElement {
    return ensureCanvasOverlayRoot();
}

export function ensureCanvasOverlayRoot(): HTMLElement {
    const existing = document.querySelector<HTMLElement>(`.${OVERLAY_CLASS}`);
    if (existing) {
        if (!existing.isConnected) document.body.appendChild(existing);
        return existing;
    }

    const root = document.createElement("div");
    root.className = `canvas-native-mount ${OVERLAY_CLASS}`;
    root.dataset.noTranslate = "";
    document.body.appendChild(root);
    root.classList.toggle("dark", document.documentElement.classList.contains("dark") || document.body.classList.contains("dark"));
    return root;
}

export function syncCanvasOverlayTheme(dark: boolean) {
    ensureCanvasOverlayRoot().classList.toggle("dark", dark);
}

export function removeCanvasOverlayRoot() {
    document.querySelector(`.${OVERLAY_CLASS}`)?.remove();
}
