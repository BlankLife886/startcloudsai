export type StoryboardShotType = "wide" | "full" | "medium" | "close" | "detail" | "over";

export type StoryboardStyle = "cinematic" | "anime" | "documentary" | "commercial";

export type StoryboardScene = {
    id: string;
    index: number;
    title: string;
    sourceText: string;
    summary: string;
    shotType: StoryboardShotType;
    cameraAngle: string;
    lens: string;
    movement: string;
    location: string;
    time: string;
    characters: string[];
    dialogue: string;
    continuity: string;
    durationSec: number;
    prompt: string;
    confidence: "high" | "medium" | "low";
};

export type StoryboardPlan = {
    title: string;
    globalStyle: string;
    scenes: StoryboardScene[];
    source: "rules" | "ai";
};

export type StoryboardParseOptions = {
    count?: number;
    style?: StoryboardStyle;
};

const MAX_SCENES = 16;
const MAX_TEXT_LENGTH = 9000;

const STYLE_LABELS: Record<StoryboardStyle, string> = {
    cinematic: "电影感写实，细腻光影，真实材质，专业摄影",
    anime: "高品质动画电影风格，清晰线稿，统一角色设计，电影构图",
    documentary: "纪实摄影风格，自然光，真实生活质感，克制的镜头语言",
    commercial: "高级品牌广告风格，干净构图，精致灯光，视觉焦点明确",
};

const SHOT_RULES: Array<{ type: StoryboardShotType; words: string[] }> = [
    { type: "detail", words: ["细节", "特写手", "手指", "按钮", "纹理", "钥匙", "道具"] },
    { type: "close", words: ["特写", "脸", "眼睛", "眼神", "表情", "嘴角", "泪"] },
    { type: "over", words: ["肩后", "过肩", "背影", "从背后", "肩膀"] },
    { type: "wide", words: ["远景", "全景", "城市", "街道", "广场", "山", "海", "森林", "建筑", "天台"] },
    { type: "full", words: ["全身", "奔跑", "走进", "站在", "跳起", "动作"] },
];

const TIME_WORDS = ["清晨", "早晨", "上午", "正午", "午后", "傍晚", "黄昏", "夜晚", "深夜", "雨夜", "黎明"];
const SCREENPLAY_TIME_WORDS: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /\b(?:DAWN|MORNING)\b/i, label: "清晨" },
    { pattern: /\b(?:NOON|MIDDAY)\b/i, label: "正午" },
    { pattern: /\b(?:AFTERNOON)\b/i, label: "午后" },
    { pattern: /\b(?:DUSK|DUSK\/EVENING|EVENING)\b/i, label: "傍晚" },
    { pattern: /\b(?:LATE\s+NIGHT|MIDNIGHT|NIGHT)\b/i, label: "夜晚" },
    { pattern: /\bDAY\b/i, label: "白天" },
];
const LOCATION_WORDS = ["街道", "车站", "地铁", "咖啡馆", "办公室", "教室", "医院", "家中", "客厅", "厨房", "天台", "森林", "海边", "广场", "仓库", "剧院"];
const SCENE_MARKER_RE = /^(?:第\s*[0-9零〇一二三四五六七八九十百两]+\s*(?:场景|幕|场|镜头|镜)|(?:场景|镜头)\s*[0-9零〇一二三四五六七八九十百两]+|(?:SCENE|SHOT|SEQ)\s*[#-]?\s*\d+|【[^】]{1,24}】|(?:INT|EXT)\.?\s+|\d+[.)、]\s*)/i;

function clampText(value: unknown, max = 280) {
    return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeScript(script: string) {
    return String(script || "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
        .trim()
        .slice(0, MAX_TEXT_LENGTH);
}

function stripSceneMarker(value: string) {
    const screenplayHeading = value.match(/^\s*(?:(?:INT|EXT)\.?\s+)/i);
    if (screenplayHeading) {
        const remainder = value.slice(screenplayHeading[0].length).trim();
        // Screenplay headings commonly look like `INT. CAFE - NIGHT: action`.
        // Remove the heading and time-of-day while preserving the actual beat.
        const colonIndex = remainder.search(/[：:]/);
        if (colonIndex >= 0) return remainder.slice(colonIndex + 1).trim();
        const dashMatch = remainder.match(/\s[-—]\s/);
        if (dashMatch?.index !== undefined) {
            const afterHeading = remainder.slice(dashMatch.index + dashMatch[0].length).trim();
            const action = afterHeading
                .replace(/^(?:DUSK\/EVENING|LATE\s+NIGHT|MIDNIGHT|AFTERNOON|MORNING|EVENING|DAWN|NIGHT|NOON|MIDDAY|DAY)\b\s*/i, "")
                .trim();
            return action || afterHeading;
        }
        return remainder;
    }
    return value
        .replace(/^\s*(?:(?:第\s*[0-9零〇一二三四五六七八九十百两]+\s*(?:场景|幕|场|镜头|镜)|(?:场景|镜头)\s*[0-9零〇一二三四五六七八九十百两]+|(?:SCENE|SHOT|SEQ)\s*[#-]?\s*\d+|【[^】]{1,24}】)(?:\s*[：:—-]\s*)?|\d+[.)、])\s*/i, "")
        .trim();
}

/** Split a single prose block into scene beats without breaking screenplay headings. */
function splitSentenceBeats(value: string) {
    const chunks: string[] = [];
    let start = 0;
    const push = (end: number) => {
        const chunk = value.slice(start, end + 1).trim();
        if (chunk) chunks.push(chunk);
        start = end + 1;
    };
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if ("。！？!?；;".includes(character)) {
            push(index);
            continue;
        }
        if (character !== "." || !/\s/.test(value[index + 1] || "")) continue;
        const next = value.slice(index + 1).match(/^\s*(.)/)?.[1] || "";
        const before = value.slice(Math.max(0, index - 10), index);
        // Keep common screenplay headings, initials, decimals, and numbered
        // abbreviations intact while treating ordinary English periods as
        // sentence boundaries.
        if (!next || /^\d/.test(next) || /\d$/.test(before) || /(?:^|\s)(?:INT|EXT|SCENE|SHOT|SEQ|MR|MRS|DR|ST)$/i.test(before) || /^[A-Z]$/.test(before.trim())) continue;
        push(index);
    }
    const tail = value.slice(start).trim();
    if (tail) chunks.push(tail);
    return chunks;
}

function splitSource(script: string, count: number) {
    const paragraphs = script
        .split(/\n\s*\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
    const lines = script
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    const explicitCount = lines.filter((line) => SCENE_MARKER_RE.test(line)).length;
    let chunks: string[];
    if (explicitCount >= 2 || (explicitCount === 1 && paragraphs.length === 1)) {
        // Keep dialogue/action lines attached to the preceding marked scene.
        // This also handles a single screenplay heading followed by several
        // action lines; splitting those lines into unrelated shots loses the
        // writer's intended scene boundary.
        const grouped: string[] = [];
        for (const line of lines) {
            if (SCENE_MARKER_RE.test(line) || !grouped.length) grouped.push(line);
            else grouped[grouped.length - 1] = `${grouped[grouped.length - 1]} ${line}`;
        }
        chunks = grouped;
    } else {
        // Blank-line paragraphs are usually intentional scene beats. Preserve
        // them before falling back to individual screenplay lines.
        chunks = paragraphs.length > 1 ? paragraphs : lines.length > 1 ? lines : paragraphs;
    }
    // An explicit screenplay marker defines the scene boundary; keep its
    // continuation/action lines together even when they contain periods.
    if (chunks.length <= 1 && explicitCount === 0) chunks = splitSentenceBeats(script);
    if (!chunks.length && script.trim()) chunks = [script.trim()];
    if (chunks.length <= count) return chunks.slice(0, MAX_SCENES);

    const merged: string[] = [];
    const target = Math.min(MAX_SCENES, Math.max(1, count), chunks.length);
    // Distribute source chunks across the requested number of shots. A fixed
    // ceil-sized window underfills (e.g. 30 chunks / 16 shots -> 15 shots).
    for (let index = 0; index < target; index += 1) {
        const start = Math.floor((index * chunks.length) / target);
        const end = Math.floor(((index + 1) * chunks.length) / target);
        merged.push(chunks.slice(start, Math.max(start + 1, end)).join(" "));
    }
    return merged.slice(0, MAX_SCENES);
}

function inferShotType(text: string, index: number): StoryboardShotType {
    const normalized = text.toLowerCase();
    const hit = SHOT_RULES.find((rule) => rule.words.some((word) => normalized.includes(word.toLowerCase())));
    if (hit) return hit.type;
    return ["wide", "medium", "close", "full"][index % 4] as StoryboardShotType;
}

function inferLocation(text: string) {
    const screenplayLocation = text.match(/^\s*(?:INT|EXT)\.?\s+([^：:\n—-]+)/i)?.[1];
    if (screenplayLocation) return clampText(screenplayLocation, 40);
    const hit = LOCATION_WORDS.find((word) => text.includes(word));
    if (hit) return hit;
    const match = text.match(/(?:在|于|进入|来到|回到)([^，。；！？!?\n]{1,18})/);
    return clampText(match?.[1] || "未说明场景", 40);
}

function inferTime(text: string) {
    const chinese = TIME_WORDS.find((word) => text.includes(word));
    if (chinese) return chinese;
    return SCREENPLAY_TIME_WORDS.find(({ pattern }) => pattern.test(text))?.label || "未说明时间";
}

function inferCharacters(text: string) {
    const names = text.match(/(?:[\u4e00-\u9fa5]{2,4})(?=说|问|喊|冲|走|看|笑|哭)/g) || [];
    return Array.from(new Set(names)).slice(0, 4);
}

function inferCamera(shotType: StoryboardShotType, index: number) {
    const angles = ["平视", "轻微低机位", "轻微高机位", "侧面三分之二视角"];
    const lens = shotType === "wide" ? "24mm 广角镜头" : shotType === "detail" || shotType === "close" ? "85mm 人像镜头" : "50mm 标准镜头";
    return { cameraAngle: angles[index % angles.length], lens };
}

function inferMovement(text: string, shotType: StoryboardShotType) {
    if (/奔跑|冲|追|驶|飞|穿过/.test(text)) return "跟拍，轻微运动模糊";
    if (/转身|回头|抬头|看向/.test(text)) return "缓慢横摇，跟随视线";
    if (shotType === "detail" || shotType === "close") return "稳定机位，微微推进";
    return "稳定镜头，叙事性停留";
}

function buildPrompt(scene: Omit<StoryboardScene, "prompt">, style: StoryboardStyle, continuity: string) {
    const characters = scene.characters.length ? `角色：${scene.characters.join("、")}。` : "角色保持前后镜头一致。";
    return [
        "电影级分镜画面，单帧，不要拼贴，不要文字和水印。",
        STYLE_LABELS[style],
        `第${scene.index}镜，${scene.shotType}，${scene.cameraAngle}，${scene.lens}，${scene.movement}。`,
        `地点：${scene.location}；时间：${scene.time}。`,
        characters,
        `画面动作：${scene.summary}`,
        `连续性锁定：${continuity}`,
        "画面主体清晰，构图服务叙事，光线与色彩统一，适合影视分镜预览。",
    ].join(" ");
}

/** Build a complete image prompt after a scene has been edited in the review UI. */
export function storyboardScenePrompt(scene: Omit<StoryboardScene, "prompt">, style: StoryboardStyle, globalStyle?: string) {
    const prompt = buildPrompt(scene, style, scene.continuity);
    const defaultStyle = STYLE_LABELS[style];
    return globalStyle && globalStyle !== defaultStyle ? prompt.replace(defaultStyle, () => clampText(globalStyle, 240)) : prompt;
}

export function parseStoryboardScript(script: string, options: StoryboardParseOptions = {}): StoryboardScene[] {
    const normalized = normalizeScript(script);
    if (!normalized) return [];
    const count = Math.min(MAX_SCENES, Math.max(1, Math.floor(Number(options.count) || 6)));
    const style = options.style || "cinematic";
    const chunks = splitSource(normalized, count);
    const continuity = "同一组角色、服装、道具与主色调；镜头之间保持空间方向和时间线连贯";
    return chunks.map((raw, index) => {
        const sourceText = clampText(raw, 520);
        const summary = clampText(stripSceneMarker(sourceText), 240);
        const shotType = inferShotType(summary, index);
        const { cameraAngle, lens } = inferCamera(shotType, index);
        const scene = {
            id: `shot-${index + 1}`,
            index: index + 1,
            title: clampText(summary.split(/[，。；：:]/)[0] || `镜头 ${index + 1}`, 32),
            sourceText,
            summary: summary || `镜头 ${index + 1}`,
            shotType,
            cameraAngle,
            lens,
            movement: inferMovement(summary, shotType),
            location: inferLocation(sourceText),
            time: inferTime(sourceText),
            characters: inferCharacters(summary),
            dialogue: clampText((summary.match(/[“”\"]([^“”\"]+)[“”\"]/g) || [])[0] || "", 100),
            continuity,
            durationSec: 4,
            confidence: chunks.length > 1 ? "high" : "medium",
        } satisfies Omit<StoryboardScene, "prompt">;
        return { ...scene, prompt: storyboardScenePrompt(scene, style) };
    });
}

function balancedJsonCandidates(value: string) {
    const source = String(value || "").replace(/```(?:json)?/gi, "").replace(/```/g, "");
    const candidates: string[] = [];
    for (let start = 0; start < source.length; start += 1) {
        if (source[start] !== "{" && source[start] !== "[") continue;
        const stack: string[] = [];
        let quoted = false;
        let escaped = false;
        let invalid = false;
        for (let index = start; index < source.length; index += 1) {
            const char = source[index];
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === "\\") escaped = true;
                else if (char === '"') quoted = false;
                continue;
            }
            if (char === '"') {
                quoted = true;
                continue;
            }
            if (char === "{" || char === "[") {
                stack.push(char);
                continue;
            }
            if (char !== "}" && char !== "]") continue;
            const expected = char === "}" ? "{" : "[";
            if (stack[stack.length - 1] !== expected) {
                invalid = true;
                break;
            }
            stack.pop();
            if (!stack.length) {
                if (!invalid) candidates.push(source.slice(start, index + 1));
                break;
            }
        }
    }
    return candidates;
}

function balancedJsonCandidate(value: string) {
    return balancedJsonCandidates(value)[0] || "";
}

function safeJson(value: string) {
    try {
        return JSON.parse(value);
    } catch {
        try {
            return JSON.parse(value.replace(/,\s*([}\]])/g, "$1"));
        } catch {
            return null;
        }
    }
}

function sceneArrayFromPayload(value: unknown): unknown[] | null {
    if (Array.isArray(value)) return value.length ? value : null;
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    const container = record.scenes ?? record.shots ?? record.frames ?? record.storyboard;
    if (Array.isArray(container)) return container.length ? container : null;
    if (!container || typeof container !== "object") return null;
    const nested = container as Record<string, unknown>;
    const scenes = nested.scenes ?? nested.shots ?? nested.frames;
    return Array.isArray(scenes) && scenes.length ? scenes : null;
}

function shotTypeFromValue(value: unknown, fallback: StoryboardShotType): StoryboardShotType {
    const text = String(value || "").toLowerCase();
    if (text.includes("特写") || text.includes("close")) return "close";
    if (text.includes("细节") || text.includes("detail")) return "detail";
    if (text.includes("远景") || text.includes("wide")) return "wide";
    if (text.includes("全身") || text.includes("full")) return "full";
    if (text.includes("过肩") || text.includes("over")) return "over";
    if (text.includes("中景") || text.includes("medium")) return "medium";
    return fallback;
}

/** Normalize a text-model response; invalid or incomplete plans fall back to rules. */
export function normalizeStoryboardPlan(response: string, fallback: StoryboardScene[], options: StoryboardParseOptions = {}): StoryboardPlan {
    const parsedCandidates = balancedJsonCandidates(response).map(safeJson).filter((value): value is Record<string, unknown> | unknown[] => value !== null);
    // Providers sometimes include a schema/example object before the actual
    // result. Prefer the first candidate with a real shot container, then
    // retain the old fallback behavior for malformed/incomplete responses.
    const parsed = parsedCandidates.find((value) => sceneArrayFromPayload(value)) || parsedCandidates[0] || null;
    const rawScenes = sceneArrayFromPayload(parsed);
    if (!Array.isArray(rawScenes) || !rawScenes.length) return { title: "智能分镜", globalStyle: STYLE_LABELS[options.style || "cinematic"], scenes: fallback, source: "rules" };
    const style = options.style || "cinematic";
    const continuity = "同一组角色、服装、道具与主色调；镜头之间保持空间方向和时间线连贯";
    const globalStyle = clampText(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).globalStyle : STYLE_LABELS[style], 240) || STYLE_LABELS[style];
    const targetCount = Math.min(MAX_SCENES, Math.max(1, Math.floor(Number(options.count) || MAX_SCENES)));
    const scenes = rawScenes.slice(0, targetCount).map((raw, index) => {
        const item = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
        const fallbackScene = fallback[index] || fallback[fallback.length - 1] || parseStoryboardScript(`镜头 ${index + 1}`, { count: 1, style })[0];
        const summary = clampText(item.summary || item.beat || item.action || item.description || fallbackScene.summary, 240);
        const shotType = shotTypeFromValue(item.shotType || item.shot || item.type, fallbackScene.shotType);
        const cameraAngle = clampText(item.cameraAngle || item.camera || fallbackScene.cameraAngle, 60);
        const lens = clampText(item.lens || fallbackScene.lens, 60);
        const scene = {
            ...fallbackScene,
            id: `shot-${index + 1}`,
            index: index + 1,
            title: clampText(item.title || fallbackScene.title || `镜头 ${index + 1}`, 32),
            sourceText: clampText(item.sourceText || fallbackScene.sourceText, 520),
            summary,
            shotType,
            cameraAngle,
            lens,
            movement: clampText(item.movement || item.cameraMovement || fallbackScene.movement, 80),
            location: clampText(item.location || item.environment || fallbackScene.location, 40),
            time: clampText(item.time || item.lighting || fallbackScene.time, 40),
            characters: Array.isArray(item.characters) ? item.characters.map((name) => clampText(name, 24)).filter(Boolean).slice(0, 4) : fallbackScene.characters,
            dialogue: clampText(item.dialogue || fallbackScene.dialogue, 100),
            continuity: clampText(item.continuity || continuity, 180),
            durationSec: Math.max(1, Math.min(30, Number(item.durationSec || item.duration || fallbackScene.durationSec) || 4)),
            confidence: "high" as const,
        };
        return { ...scene, prompt: clampText(item.visualPrompt || item.prompt || storyboardScenePrompt(scene, style, globalStyle), 1800) };
    });
    return {
        title: clampText(parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).title : "智能分镜", 80) || "智能分镜",
        globalStyle,
        scenes,
        source: "ai",
    };
}

export function storyboardStyleLabel(style: StoryboardStyle) {
    return STYLE_LABELS[style];
}
