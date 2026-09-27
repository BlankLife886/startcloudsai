// Sticky note text is plain text with three light conventions, so it stays readable anywhere it is reused
// (downstream prompts, exports): "- [ ] " / "- [x] " to-dos, "- " bullets and "# " headings.

export type StickyLine =
    | { kind: "todo"; done: boolean; text: string; index: number }
    | { kind: "bullet"; text: string; index: number }
    | { kind: "heading"; text: string; index: number }
    | { kind: "text"; text: string; index: number };

const TODO = /^(\s*)[-*]\s\[( |x|X)\]\s?(.*)$/;
const BULLET = /^(\s*)[-*•]\s(.*)$/;
const HEADING = /^#{1,3}\s(.*)$/;

export function parseStickyLines(content: string): StickyLine[] {
    return content.split("\n").map((line, index) => {
        const todo = TODO.exec(line);
        if (todo) return { kind: "todo", done: todo[2] !== " ", text: todo[3], index };
        const bullet = BULLET.exec(line);
        if (bullet) return { kind: "bullet", text: bullet[2], index };
        const heading = HEADING.exec(line);
        if (heading) return { kind: "heading", text: heading[1], index };
        return { kind: "text", text: line, index };
    });
}

export function toggleStickyTodo(content: string, lineIndex: number) {
    const lines = content.split("\n");
    const match = TODO.exec(lines[lineIndex] || "");
    if (!match) return content;
    lines[lineIndex] = `${match[1]}- [${match[2] === " " ? "x" : " "}] ${match[3]}`;
    return lines.join("\n");
}

export function stickyTodoProgress(content: string) {
    const todos = parseStickyLines(content).filter((line) => line.kind === "todo");
    return { total: todos.length, done: todos.filter((line) => line.kind === "todo" && line.done).length };
}

/** Turns every non-empty line into a to-do, or back into plain lines when all of them already are. */
export function toggleStickyChecklist(content: string) {
    const lines = content.split("\n");
    const filled = lines.filter((line) => line.trim());
    if (!filled.length) return "- [ ] ";
    const allTodos = filled.every((line) => TODO.test(line));
    return lines
        .map((line) => {
            if (!line.trim()) return line;
            if (allTodos) return line.replace(TODO, "$1$3");
            if (TODO.test(line)) return line;
            return `- [ ] ${line.replace(BULLET, "$2")}`;
        })
        .join("\n");
}

/**
 * Enter at the end of a list line continues the list; Enter on an empty item ends it. Returns null when the key should
 * behave normally.
 */
export function continueStickyList(value: string, caret: number): { value: string; caret: number } | null {
    const lineStart = value.lastIndexOf("\n", caret - 1) + 1;
    const lineEndIndex = value.indexOf("\n", caret);
    const lineEnd = lineEndIndex < 0 ? value.length : lineEndIndex;
    if (caret !== lineEnd) return null;
    const line = value.slice(lineStart, lineEnd);
    const todo = TODO.exec(line);
    const bullet = todo ? null : BULLET.exec(line);
    if (!todo && !bullet) return null;
    const body = todo ? todo[3] : bullet![2];
    if (!body.trim()) {
        const next = value.slice(0, lineStart) + value.slice(lineEnd);
        return { value: next, caret: lineStart };
    }
    const prefix = todo ? `${todo[1]}- [ ] ` : `${bullet![1]}- `;
    const next = `${value.slice(0, caret)}\n${prefix}${value.slice(caret)}`;
    return { value: next, caret: caret + 1 + prefix.length };
}

/** Dark text on light notes, light text on dark ones. */
export function stickyTextColor(background: string) {
    const hex = background.replace("#", "");
    const full = hex.length === 3 ? hex.split("").map((part) => part + part).join("") : hex;
    const value = Number.parseInt(full.slice(0, 6), 16);
    if (!Number.isFinite(value)) return "#1c1917";
    const channel = (shift: number) => {
        const c = ((value >> shift) & 255) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
    return luminance > 0.36 ? "#1c1917" : "#fafaf9";
}
