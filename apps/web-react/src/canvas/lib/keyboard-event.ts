type NativeKeyboardEventLike = {
    isComposing?: boolean;
    keyCode?: number;
    which?: number;
};

type KeyboardEventLike = NativeKeyboardEventLike & {
    key?: string;
    shiftKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    nativeEvent?: NativeKeyboardEventLike;
};

export function isImeComposing(event: KeyboardEventLike) {
    const nativeEvent = event.nativeEvent;
    return Boolean(event.isComposing || nativeEvent?.isComposing || event.keyCode === 229 || event.which === 229 || nativeEvent?.keyCode === 229 || nativeEvent?.which === 229);
}

export function isPlainEnterKey(event: KeyboardEventLike) {
    return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !isImeComposing(event);
}

type CanvasShortcutEvent = NativeKeyboardEventLike & { target?: EventTarget | null; defaultPrevented?: boolean };

/** Keep editing shortcuts local to inputs, panels and dialogs. Space also respects native controls. */
export function shouldIgnoreCanvasShortcut(event: CanvasShortcutEvent, options: { ignoreControls?: boolean; scope?: HTMLElement | null } = {}) {
    if (event.defaultPrevented || isImeComposing(event)) return true;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input,textarea,select,[contenteditable]:not([contenteditable='false']),[data-canvas-no-zoom],[data-canvas-shortcuts-ignore],[role='dialog'],[aria-modal='true'],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown")) return true;
    if (options.ignoreControls && target?.closest("button,a[href],summary,[role='button'],[role='tab'],[role='checkbox'],[role='switch'],[role='menuitem'],[role='slider'],[role='combobox'],[role='listbox']")) return true;
    if (options.scope && target && target !== document.body && target !== document.documentElement && !options.scope.contains(target)) return true;
    return Array.from(document.querySelectorAll<HTMLElement>(".ant-modal-wrap,[role='dialog'][aria-modal='true']"))
        .some((dialog) => dialog.getClientRects().length > 0 && getComputedStyle(dialog).visibility !== "hidden");
}
