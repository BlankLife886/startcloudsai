const KNOWN_RATIOS = ["16:9", "9:16", "1:1", "3:2", "2:3", "5:4", "4:5", "4:3", "3:4", "21:9", "9:21"] as const;

function closestAspectRatio(width: number, height: number) {
    const target = width / Math.max(1, height);
    return KNOWN_RATIOS.reduce(
        (best, ratio) => {
            const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
            const diff = Math.abs(ratioWidth / Math.max(1, ratioHeight) - target);
            return diff < best.diff ? { ratio, diff } : best;
        },
        { ratio: "1:1" as (typeof KNOWN_RATIOS)[number], diff: Number.POSITIVE_INFINITY },
    ).ratio;
}

/**
 * Detect an explicit aspect ratio / pixel size from a single shot's text.
 * Returns null when the shot does not declare a size.
 */
export function detectStoryboardShotAspectRatio(text: string): string | null {
    const raw = String(text || "");
    if (!raw.trim()) return null;

    // Orientation is an explicit creative instruction and must win over a
    // pixel size mentioned inside the scene (for example, a phone screen).
    if (/竖屏|竖图|竖版|竖构图|\bportrait\s+(?:format|orientation|frame|composition)\b/i.test(raw)) return "9:16";
    if (/横屏|横图|横版|横构图|\blandscape\s+(?:format|orientation|frame|composition)\b/i.test(raw)) return "16:9";
    if (/方形|正方形|\bsquare\s+(?:format|orientation|frame|composition)\b/i.test(raw)) return "1:1";
    if (/超宽|宽屏|ultrawide\s+(?:format|frame|composition)/i.test(raw)) return "21:9";

    const pixels = raw.match(/(\d{3,5})\s*[x×*X]\s*(\d{3,5})/);
    if (pixels) return closestAspectRatio(Number(pixels[1]), Number(pixels[2]));

    const ratioMatch = raw.match(/(?<!\d)(\d{1,2})\s*[:：]\s*(\d{1,2})(?!\d)/);
    if (ratioMatch) {
        const candidate = `${Number(ratioMatch[1])}:${Number(ratioMatch[2])}`;
        if ((KNOWN_RATIOS as readonly string[]).includes(candidate)) return candidate;
        // Do not turn a time, score, or arbitrary numeric pair such as 16:30
        // into a portrait ratio. Approximation is only safe with an explicit
        // aspect/ratio/画幅/尺寸 cue.
        if (/(?:画幅|画面比例|镜头比例|宽高比|尺寸|比例|aspect(?:\s+ratio)?|ratio|size|format)/i.test(raw)) {
            return closestAspectRatio(Number(ratioMatch[1]), Number(ratioMatch[2]));
        }
        return null;
    }

    return null;
}

/**
 * Resolve the generation size for one shot.
 * Shot-declared size always wins. Otherwise: auto → auto optimize; fixed → selected ratio.
 */
export function resolveStoryboardShotAspectRatio(shotText: string, selectedRatio: string): string {
    const detected = detectStoryboardShotAspectRatio(shotText);
    if (detected) return detected;
    const selected = String(selectedRatio || "").trim();
    return selected || "auto";
}

/** Prefer source beat text, then polished prompt, for size detection. */
export function storyboardShotAspectSourceText(scene: { sourceText?: string; prompt?: string; summary?: string }): string {
    return [scene.sourceText, scene.summary, scene.prompt].filter(Boolean).join("\n");
}
