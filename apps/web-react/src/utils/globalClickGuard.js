const DEFAULT_CLICK_GUARD_MS = 500;
const GUARDED_CONTROL_SELECTOR = [
  "button",
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="image"]',
  '[role="button"]',
].join(",");

function eventControl(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const entry of path) {
    if (entry instanceof Element && entry.matches(GUARDED_CONTROL_SELECTOR)) return entry;
  }
  return event.target instanceof Element
    ? event.target.closest(GUARDED_CONTROL_SELECTOR)
    : null;
}

function guardDelay(control, defaultDelay) {
  const owner = control.closest("[data-click-guard]");
  const mode = owner?.dataset.clickGuard?.trim().toLowerCase();
  if (mode === "off" || mode === "repeat" || mode === "false" || mode === "0") return 0;

  const configured = Number.parseInt(
    control.dataset.clickGuardMs || owner?.dataset.clickGuardMs || "",
    10,
  );
  return Number.isFinite(configured) && configured >= 0 ? configured : defaultDelay;
}

function controlSignature(control) {
  return [
    control.getAttribute("aria-label") || "",
    control.getAttribute("aria-expanded") || "",
    control.getAttribute("aria-pressed") || "",
    control.getAttribute("aria-selected") || "",
    control.textContent?.trim().replace(/\s+/g, " ") || "",
  ].join("|");
}

export function installGlobalClickGuard({
  root = document,
  delay = DEFAULT_CLICK_GUARD_MS,
} = {}) {
  let accepted = new WeakMap();
  let lastControl = null;

  const protect = (event) => {
    const control = eventControl(event);
    if (!control) {
      if (lastControl) accepted.delete(lastControl);
      lastControl = null;
      return;
    }
    if (lastControl && lastControl !== control) accepted.delete(lastControl);
    lastControl = control;

    const wait = guardDelay(control, delay);
    if (!wait) return;

    const now = performance.now();
    const signature = controlSignature(control);
    const previous = accepted.get(control);
    if (
      previous &&
      previous.signature === signature &&
      now - previous.at < wait
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      control.dispatchEvent(
        new CustomEvent("clickguard:blocked", {
          bubbles: false,
          detail: { remaining: Math.ceil(wait - (now - previous.at)) },
        }),
      );
      return;
    }
    accepted.set(control, { at: now, signature });
  };

  const resetOnCancel = (event) => {
    if (event.key === "Escape") {
      accepted = new WeakMap();
      lastControl = null;
    }
  };

  root.addEventListener("click", protect, { capture: true });
  root.addEventListener("keydown", resetOnCancel, { capture: true });
  return () => {
    root.removeEventListener("click", protect, { capture: true });
    root.removeEventListener("keydown", resetOnCancel, { capture: true });
  };
}

export { DEFAULT_CLICK_GUARD_MS };
