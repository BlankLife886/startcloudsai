import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

import { applyStoryboardShotTypeOverrides, buildStoryboardVariantPlan, normalizeStoryboardPlan, parseStoryboardScript, storyboardScenePrompt } from "../src/canvas/lib/canvas/storyboard-parser.ts";
import { recoverStoryboardFromNodes, reconcileStoryboardGroupStatuses, storyboardAggregateStatus, storyboardSessionJson } from "../src/canvas/lib/canvas/canvas-storyboard-recovery.ts";
import { describeStoryboardReference } from "../src/canvas/lib/canvas/canvas-storyboard-references.ts";
import { storyboardLayoutMetrics, storyboardPackedLayout, storyboardScenePosition, storyboardSequenceLinks } from "../src/canvas/lib/canvas/canvas-storyboard-layout.ts";
import { detectStoryboardShotAspectRatio, resolveStoryboardShotAspectRatio } from "../src/canvas/lib/canvas/canvas-storyboard-aspect.ts";
import { joinStoryboardDisplayLines, splitStoryboardDisplayLines } from "../src/canvas/lib/canvas/canvas-storyboard-script-editing.ts";

const storyboardPageSource = ts.createSourceFile(
    "canvas-storyboard-page.ts",
    fs.readFileSync(new URL("../src/canvas/lib/canvas/canvas-storyboard-page.ts", import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
);

function declaration(source, name) {
    let found;
    const visit = (node) => {
        if ((ts.isFunctionDeclaration(node) && node.name?.text === name) || (ts.isVariableStatement(node) && node.declarationList.declarations.some((item) => item.name.getText(source) === name))) found = node.getText(source);
        ts.forEachChild(node, visit);
    };
    visit(source);
    assert.ok(found, `missing ${name}`);
    return found;
}

function execute(source, context) {
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
    return context;
}

const storyboardCancellation = execute(
    `${declaration(storyboardPageSource, "isActiveStoryboardNode")}\n${declaration(storyboardPageSource, "settleStoryboardCancellation")}`.replace(/\bexport\s+/g, ""),
    {
        exports: {},
        CanvasNodeType: { Image: "image", Text: "text", Group: "group" },
        NODE_STATUS_IDLE: "idle",
        NODE_STATUS_SUCCESS: "success",
        storyboardAggregateStatus,
    },
);
storyboardCancellation.isActiveStoryboardNode = storyboardCancellation.isActiveStoryboardNode || storyboardCancellation.exports?.isActiveStoryboardNode;
storyboardCancellation.settleStoryboardCancellation = storyboardCancellation.settleStoryboardCancellation || storyboardCancellation.exports?.settleStoryboardCancellation;

const sample = "清晨的雨刚停，女孩在空荡的车站捡起一把红伞。\n她沿着湿漉漉的街道奔跑，远处的霓虹映在水面。\n咖啡馆里，男孩抬头认出了她，两人隔着玻璃对望。\n女孩推门而入，把红伞放在桌边，轻轻说了一句‘好久不见’。";

test("classifies every persisted storyboard reference kind for refresh-safe retries", () => {
    assert.deepEqual(describeStoryboardReference("image:local-anchor"), {
        source: "image:local-anchor",
        storageKey: "image:local-anchor",
        fallback: "",
    });
    assert.deepEqual(describeStoryboardReference("uploads/user-1/original/anchor.png"), {
        source: "uploads/user-1/original/anchor.png",
        storageKey: "uploads/user-1/original/anchor.png",
        fallback: "",
    });
    assert.deepEqual(describeStoryboardReference("tasks/user-1/task-1/original/anchor.png"), {
        source: "tasks/user-1/task-1/original/anchor.png",
        storageKey: "tasks/user-1/task-1/original/anchor.png",
        fallback: "",
    });
    assert.deepEqual(describeStoryboardReference("/api/v1/files/uploads/user-1/original/anchor.png?download=1"), {
        source: "/api/v1/files/uploads/user-1/original/anchor.png?download=1",
        storageKey: "uploads/user-1/original/anchor.png",
        fallback: "/api/v1/files/uploads/user-1/original/anchor.png?download=1",
    });
    assert.deepEqual(describeStoryboardReference("https://cdn.example.com/storyboard/anchor.png"), {
        source: "https://cdn.example.com/storyboard/anchor.png",
        fallback: "https://cdn.example.com/storyboard/anchor.png",
    });
    assert.deepEqual(describeStoryboardReference("data:image/png;base64,AAAA"), {
        source: "data:image/png;base64,AAAA",
        fallback: "data:image/png;base64,AAAA",
    });
    assert.deepEqual(describeStoryboardReference("blob:http://127.0.0.1/anchor"), {
        source: "blob:http://127.0.0.1/anchor",
        fallback: "blob:http://127.0.0.1/anchor",
    });
    assert.deepEqual(describeStoryboardReference("/api/v1/files/legacy/anchor.png"), {
        source: "/api/v1/files/legacy/anchor.png",
        fallback: "/api/v1/files/legacy/anchor.png",
    });
    assert.equal(describeStoryboardReference("   "), null);
});

test("parses a natural-language script into ordered image-ready shots", () => {
    const scenes = parseStoryboardScript(sample, { count: 6, style: "cinematic" });
    assert.equal(scenes.length, 4);
    assert.deepEqual(scenes.map((scene) => scene.index), [1, 2, 3, 4]);
    assert.ok(scenes.every((scene) => scene.prompt === scene.summary));
    assert.ok(scenes.every((scene) => !scene.prompt.includes("连续性锁定")));
    assert.equal(scenes[0].location, "车站");
    assert.equal(scenes[1].shotType, "medium");
});

test("keeps action lines under explicit幕/场景/镜头 markers", () => {
    const scenes = parseStoryboardScript("第一幕：清晨，女孩走进车站。\n她捡起红伞。\n第二场：男孩在咖啡馆抬头。\n两人隔着玻璃对望。\n镜头三：他们并肩走进夜色。", { count: 8, mode: "markers" });
    assert.equal(scenes.length, 3);
    assert.equal(scenes[0].summary, "清晨，女孩走进车站。 她捡起红伞。");
    assert.equal(scenes[1].summary, "男孩在咖啡馆抬头。 两人隔着玻璃对望。");
    assert.equal(scenes[2].summary, "他们并肩走进夜色。");
});

test("normalizes scene markers without leaving a leading colon", () => {
    const scenes = parseStoryboardScript("第1幕：夜晚，城市灯光亮起。\n第2幕-女孩回头。", { count: 4, mode: "markers" });
    assert.equal(scenes[0].summary, "夜晚，城市灯光亮起。");
    assert.equal(scenes[1].summary, "女孩回头。");
});

test("recognizes Chinese scene headings with 场景 and common English headings", () => {
    const scenes = parseStoryboardScript("第1场景：车站里，女孩停下。\nSCENE 2 - 咖啡馆，男孩抬头。\nSHOT 3: 两人对望。", { count: 6, mode: "markers" });
    assert.equal(scenes.length, 3);
    assert.ok(scenes.every((scene) => !scene.summary.startsWith("景：")));
    assert.deepEqual(scenes.map((scene) => scene.summary), ["车站里，女孩停下。", "咖啡馆，男孩抬头。", "两人对望。"]);
});

test("keeps continuation lines inside a single screenplay scene", () => {
    const scenes = parseStoryboardScript("INT. CAFE - NIGHT: Girl enters.\nShe notices a red umbrella.\nThe barista looks up.", { count: 6, mode: "markers" });
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].summary, "Girl enters. She notices a red umbrella. The barista looks up.");
    assert.equal(scenes[0].location, "CAFE");
    assert.equal(scenes[0].time, "夜晚");
});

test("splits an English prose paragraph into multiple shot beats", () => {
    const scenes = parseStoryboardScript("A girl enters the station. She picks up a red umbrella. The boy looks up. They meet outside.", { count: 6, mode: "prose" });
    assert.equal(scenes.length, 4);
    assert.equal(scenes[0].summary, "A girl enters the station.");
    assert.equal(scenes[3].summary, "They meet outside.");
});

test("removes screenplay time tokens when action follows on the next line", () => {
    const scenes = parseStoryboardScript("EXT. STREET - DAY\nGirl runs toward the station.", { count: 6, mode: "markers" });
    assert.equal(scenes.length, 1);
    assert.equal(scenes[0].summary, "Girl runs toward the station.");
    assert.equal(scenes[0].location, "STREET");
    assert.equal(scenes[0].time, "白天");
});

test("recognizes numbered shot lines as explicit scene markers", () => {
    const scenes = parseStoryboardScript("1. Girl enters the station.\nShe picks up the umbrella.\n2. The boy looks up.", { count: 6, mode: "markers" });
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].summary, "Girl enters the station. She picks up the umbrella.");
    assert.equal(scenes[1].summary, "The boy looks up.");
});

test("preserves blank-line beats when only one explicit marker is present", () => {
    const scenes = parseStoryboardScript("第1场：车站里，女孩停下。\n她抬头看向时钟。\n\n随后她沿街奔跑。", { count: 6, mode: "paragraphs" });
    assert.equal(scenes.length, 2);
    assert.equal(scenes[0].summary, "车站里，女孩停下。 她抬头看向时钟。");
    assert.equal(scenes[1].summary, "随后她沿街奔跑。");
});

test("caps parser output at one hundred scenes and handles empty input", () => {
    const longScript = Array.from({ length: 130 }, (_, index) => `镜头${index + 1}：角色在街道上移动。`).join("\n");
    assert.equal(parseStoryboardScript(longScript, { count: 999 }).length, 100);
    assert.deepEqual(parseStoryboardScript("   \n\t", { count: 6 }), []);
});

test("builds variant plans as N independent shots with the same prompt", () => {
    const plan = buildStoryboardVariantPlan("雨夜车站，红伞女孩", 5);
    assert.equal(plan.title, "批量配置");
    assert.equal(plan.scenes.length, 5);
    assert.ok(plan.scenes.every((scene) => scene.prompt === "雨夜车站，红伞女孩"));
    assert.equal(buildStoryboardVariantPlan("蓝天", 999).scenes.length, 100);
    assert.equal(buildStoryboardVariantPlan("   ", 4).scenes.length, 0);
});

test("keeps the complete long beat in sourceText and the rule prompt", () => {
    const tail = "关键结尾：角色在最后一秒停下，没有上车。";
    const scenes = parseStoryboardScript(`${"前置动作，".repeat(180)}${tail}`, { count: 1 });
    assert.equal(scenes.length, 1);
    assert.ok(scenes[0].sourceText.includes(tail));
    assert.ok(scenes[0].prompt.includes(tail));
});

test("does not invent alternating shot scales when the script gives no framing cue", () => {
    const scenes = parseStoryboardScript("两个人在房间里交谈。\n他们继续交谈。\n房间里安静下来。", { count: 3 });
    assert.deepEqual(scenes.map((scene) => scene.shotType), ["medium", "medium", "medium"]);
});

test("only an explicit user override changes the neutral medium framing", () => {
    const scenes = parseStoryboardScript("女孩走进车站。", { count: 1 });
    const plan = applyStoryboardShotTypeOverrides({ title: "x", globalStyle: "", scenes, source: "rules" }, { "shot-1": "close" });
    assert.equal(plan.scenes[0].shotType, "close");
});

test("number-only placeholder rows do not become empty storyboard shots", () => {
    const scenes = parseStoryboardScript("1.\n2. 蓝天白云\n3.\n4. 蓝天大海。", { count: 16 });
    assert.deepEqual(scenes.map((scene) => scene.summary), ["蓝天白云", "蓝天大海。"]);
});

test("does not silently truncate a script over the single-run input limit", () => {
    const tail = "结尾约束：保留红伞，禁止出现第二把伞。";
    const scenes = parseStoryboardScript(`${"动作。".repeat(5000)}${tail}`, { count: 1 });
    assert.ok(scenes[0].sourceText.includes(tail));
    assert.ok(scenes[0].prompt.includes(tail));
});

test("keeps storyboard geometry inside a frame header and preserves sequence links", () => {
    const card = { width: 300, height: 169 };
    const metrics = storyboardLayoutMetrics(6, card);
    assert.equal(metrics.columns, 3);
    assert.equal(metrics.rows, 2);
    assert.ok(metrics.groupHeight > metrics.totalHeight);
    assert.ok(metrics.groupHeaderHeight >= 96);
    const groupOrigin = { x: 100, y: 200 };
    const origin = { x: groupOrigin.x + metrics.groupPaddingX, y: groupOrigin.y + metrics.groupHeaderHeight };
    const first = storyboardScenePosition(0, origin, card, metrics);
    assert.equal(first.y - groupOrigin.y, metrics.groupHeaderHeight);
    const links = storyboardSequenceLinks(["shot-1", "shot-2", "shot-3"]);
    assert.deepEqual(links, [
        { sceneId: "shot-1", previousSceneId: undefined, nextSceneId: "shot-2" },
        { sceneId: "shot-2", previousSceneId: "shot-1", nextSceneId: "shot-3" },
        { sceneId: "shot-3", previousSceneId: "shot-2", nextSceneId: undefined },
    ]);
});

test("packs mixed aspect ratio cards without uniform cell waste", () => {
    const packed = storyboardPackedLayout(
        [
            { width: 300, height: 169 },
            { width: 169, height: 300 },
            { width: 300, height: 300 },
            { width: 300, height: 169 },
        ],
        { gapX: 40, gapY: 20 },
    );
    assert.equal(packed.columns, 2);
    assert.equal(packed.rows, 2);
    assert.equal(packed.positions.length, 4);
    assert.equal(packed.positions[0].x, 0);
    assert.equal(packed.positions[1].x, 300 + 40);
    assert.ok(packed.totalWidth < 300 * 2 + 40 + 50, "row width uses each card width, not max height padding");
    assert.equal(packed.positions[0].width, 300);
    assert.equal(packed.positions[1].width, 169);
    assert.equal(packed.positions[1].height, 300);
    // Second row starts after the taller card in the first row.
    assert.equal(packed.positions[2].y, 300 + 20);
});

test("accepts fenced JSON after explanatory text and common container aliases", () => {
    const fallback = parseStoryboardScript(sample, { count: 3, style: "anime" });
    const response = `这里是结构化结果：\n\`\`\`json\n{"title":"雨夜重逢","globalStyle":"统一动画电影风格","shots":[{"title":"车站","description":"女孩捡起红伞","shotType":"特写"},{"title":"街道","visualPrompt":"动画电影画面，红伞在雨后街道","shotType":"远景"},{"title":"咖啡馆","summary":"两人隔窗对望"}]}\n\`\`\``;
    const plan = normalizeStoryboardPlan(response, fallback, { count: 3, style: "anime" });
    assert.equal(plan.source, "ai");
    assert.equal(plan.title, "雨夜重逢");
    assert.equal(plan.scenes.length, 3);
    assert.equal(plan.scenes[0].shotType, "medium");
    assert.equal(plan.scenes[1].prompt, "动画电影画面，红伞在雨后街道");
    assert.ok(plan.scenes[2].prompt.includes("连续性锁定"));
});

test("skips an incomplete schema object and uses the later shot payload", () => {
    const fallback = parseStoryboardScript(sample, { count: 2, style: "cinematic" });
    const response = `示例字段：{"title":"schema","format":"shot list"}\n最终结果：{"title":"实际分镜","scenes":[{"title":"车站","summary":"女孩捡起红伞"},{"title":"街道","summary":"男孩抬头"}]}`;
    const plan = normalizeStoryboardPlan(response, fallback, { count: 2 });
    assert.equal(plan.source, "ai");
    assert.equal(plan.title, "实际分镜");
    assert.deepEqual(plan.scenes.map((scene) => scene.summary), ["女孩捡起红伞", "男孩抬头"]);
});

test("marks rule-filled shots as low confidence when AI returns too few shots", () => {
    const fallback = parseStoryboardScript("第一镜：女孩进门。\n第二镜：男孩离开。", { count: 2 });
    const plan = normalizeStoryboardPlan('{"scenes":[{"summary":"女孩进门的新描述"}]}', fallback, { count: 2 });
    assert.equal(plan.scenes[0].confidence, "high");
    assert.equal(plan.scenes[1].confidence, "low");
});

test("falls back safely for malformed JSON and normalizes duplicate ids", () => {
    const fallback = parseStoryboardScript(sample, { count: 3 });
    const plan = normalizeStoryboardPlan("{broken json", fallback, { count: 3 });
    assert.equal(plan.source, "rules");
    assert.deepEqual(plan.scenes, fallback);

    const fallbackTwo = parseStoryboardScript(sample, { count: 2 });
    const normalized = normalizeStoryboardPlan('{"frames":[{"id":"same","summary":"A"},{"id":"same","summary":"B"}]}', fallbackTwo, { count: 2 });
    assert.equal(normalized.scenes.length, fallbackTwo.length);
    assert.deepEqual(normalized.scenes.map((scene) => scene.id), fallbackTwo.map((_, index) => `shot-${index + 1}`));
});

test("rebuilds edited prompts without losing shot language or continuity", () => {
    const scene = parseStoryboardScript(sample, { count: 1, style: "commercial" })[0];
    const prompt = storyboardScenePrompt({ ...scene, summary: "女孩把红伞放在桌边" }, "commercial");
    assert.ok(prompt.includes("女孩把红伞放在桌边"));
    assert.ok(prompt.includes(scene.lens));
    assert.ok(prompt.includes("连续性锁定"));
    // Silent default medium must not leak into the generation prompt.
    assert.ok(!/\bmedium\b/.test(prompt));
    assert.ok(!prompt.includes("中景"));
});

test("explicit non-default framing still appears in rebuilt prompts", () => {
    const scene = parseStoryboardScript(sample, { count: 1, style: "commercial" })[0];
    const prompt = storyboardScenePrompt({ ...scene, shotType: "close", summary: "特写红伞" }, "commercial");
    assert.ok(prompt.includes("close"));
});

test("recovers a storyboard session and shot progress from persisted canvas nodes", () => {
    const plan = {
        title: "雨夜重逢",
        globalStyle: "电影感写实",
        source: "ai",
        scenes: parseStoryboardScript("车站里，女孩捡起红伞。\n咖啡馆里，男孩抬头。", { count: 2, style: "cinematic" }),
    };
    const storyboardId = "storyboard-test";
    const source = {
        id: "source-script",
        type: "text",
        title: "原始剧本",
        position: { x: 0, y: 0 },
        width: 280,
        height: 160,
        metadata: { content: "车站里，女孩捡起红伞。\n咖啡馆里，男孩抬头。", status: "success" },
    };
    const images = plan.scenes.map((scene, index) => ({
        id: `image-${index + 1}`,
        type: "image",
        title: scene.title,
        position: { x: index * 320, y: 0 },
        width: 300,
        height: 220,
        metadata: {
            storyboardId,
            storyboardSceneId: scene.id,
            storyboardIndex: scene.index,
            storyboardTitle: index === 0 ? "已编辑标题" : scene.title,
            storyboardSummary: index === 0 ? "已编辑摘要" : scene.summary,
            storyboardPrompt: scene.prompt,
            storyboardStatus: index === 0 ? "succeeded" : "failed",
            storyboardNeedsRegeneration: index === 0,
            thumbnailUrl: index === 0 ? "https://cdn.example/shot-1.webp" : undefined,
            errorDetails: index === 1 ? "provider timeout" : undefined,
        },
    }));
    const group = {
        id: "group-test",
        type: "group",
        title: "分镜 · 雨夜重逢",
        position: { x: 0, y: 0 },
        width: 760,
        height: 520,
        metadata: {
            storyboardId,
            storyboardScript: source.metadata.content,
            storyboardSourceNodeId: source.id,
            storyboardSceneCount: 2,
            storyboardAspectRatio: "9:16",
            storyboardStyle: "anime",
            storyboardConsistency: false,
            storyboardAnchorReference: "image:storyboard-anchor",
            storyboardAnchorSceneId: plan.scenes[0].id,
            storyboardPlanJson: storyboardSessionJson({
                storyboardId,
                script: source.metadata.content,
                plan,
                options: { style: "anime", sceneCount: 2, aspectRatio: "9:16", consistency: false },
            }),
        },
    };
    const recovered = recoverStoryboardFromNodes(group, [source, group, ...images]);
    assert.ok(recovered);
    assert.equal(recovered.storyboardId, storyboardId);
    assert.equal(recovered.groupNodeId, group.id);
    assert.equal(recovered.sourceNodeId, source.id);
    assert.equal(recovered.script, source.metadata.content);
    assert.equal(recovered.options.style, "anime");
    assert.equal(recovered.options.aspectRatio, "9:16");
    assert.equal(recovered.options.consistency, false);
    assert.equal(recovered.plan.scenes[0].title, "已编辑标题");
    assert.equal(recovered.plan.scenes[0].summary, "已编辑摘要");
    assert.equal(recovered.plan.title, "雨夜重逢");
    assert.equal(recovered.plan.globalStyle, "电影感写实");
    assert.equal(recovered.plan.source, "ai");
    assert.equal(recovered.progress[plan.scenes[0].id].status, "succeeded");
    assert.equal(recovered.progress[plan.scenes[0].id].imageUrl, "https://cdn.example/shot-1.webp");
    assert.equal(recovered.progress[plan.scenes[0].id].needsRegeneration, true);
    assert.equal(recovered.progress[plan.scenes[1].id].status, "failed");
    assert.equal(recovered.progress[plan.scenes[1].id].error, "provider timeout");
    assert.equal(recovered.anchorReference, "image:storyboard-anchor");
    assert.equal(recovered.anchorSceneId, plan.scenes[0].id);
});

test("recovers a storyboard anchor mirrored only on a shot for older group metadata", () => {
    const scene = parseStoryboardScript("车站里，女孩捡起红伞。", { count: 1, style: "cinematic" })[0];
    const storyboardId = "storyboard-shot-anchor";
    const image = {
        id: "image-anchor",
        type: "image",
        title: scene.title,
        position: { x: 0, y: 0 },
        width: 300,
        height: 220,
        metadata: {
            storyboardId,
            storyboardSceneId: scene.id,
            storyboardIndex: scene.index,
            storyboardPrompt: scene.prompt,
            storyboardStatus: "succeeded",
            storyboardAnchorReference: "image:legacy-anchor",
            storyboardAnchorSceneId: scene.id,
        },
    };
    const group = {
        id: "group-shot-anchor",
        type: "group",
        title: "分镜",
        position: { x: 0, y: 0 },
        width: 500,
        height: 400,
        metadata: { storyboardId, storyboardSceneCount: 1 },
    };
    const recovered = recoverStoryboardFromNodes(group, [group, image]);
    assert.equal(recovered?.anchorReference, "image:legacy-anchor");
    assert.equal(recovered?.anchorSceneId, scene.id);
});

test("aggregates storyboard child statuses for durable group feedback", () => {
    const base = (id, status) => ({
        id,
        type: "image",
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { storyboardId: "storyboard-status", storyboardSceneId: id, storyboardStatus: status },
    });
    assert.equal(storyboardAggregateStatus([base("one", "queued"), base("two", "succeeded")], "storyboard-status"), "running");
    assert.equal(storyboardAggregateStatus([base("one", "succeeded"), base("two", "succeeded")], "storyboard-status"), "succeeded");
    assert.equal(storyboardAggregateStatus([base("one", "canceled"), base("two", "canceled")], "storyboard-status"), "canceled");
    assert.equal(storyboardAggregateStatus([base("one", "failed"), base("two", "succeeded")], "storyboard-status"), "failed");
    assert.equal(storyboardAggregateStatus([base("one", "succeeded"), base("two", "canceled")], "storyboard-status"), "failed");
    assert.equal(storyboardAggregateStatus([base("other", "succeeded")], "missing"), undefined);
});

test("settles a recovered storyboard cancellation without deleting completed image data", () => {
    const storyboardId = "storyboard-cancel-recovery";
    const image = (id, sceneId, status, extra = {}) => ({
        id,
        type: "image",
        title: sceneId,
        position: { x: 0, y: 0 },
        width: 300,
        height: 220,
        metadata: {
            storyboardId,
            storyboardSceneId: sceneId,
            storyboardStatus: status,
            executionStatus: status,
            groupId: "storyboard-group-cancel",
            content: `${id}.webp`,
            taskId: `${id}-task`,
            ...extra,
        },
    });
    const caption = (id, sceneId, status) => ({
        id,
        type: "text",
        title: sceneId,
        position: { x: 0, y: 240 },
        width: 300,
        height: 70,
        metadata: { storyboardId, storyboardSceneId: sceneId, storyboardStatus: status, executionStatus: status, status: "success", content: `${sceneId}\n说明` },
    });
    const nodes = [
        { id: "storyboard-group-cancel", type: "group", title: "分镜", position: { x: 0, y: 0 }, width: 700, height: 500, metadata: { storyboardId, storyboardStatus: "running", executionStatus: "running", storyboardSceneCount: 2 } },
        image("cancel-image-1", "shot-1", "queued"),
        caption("cancel-caption-1", "shot-1", "queued"),
        image("cancel-image-2", "shot-2", "running"),
        caption("cancel-caption-2", "shot-2", "running"),
        image("other-storyboard", "other-shot", "running", { storyboardId: "other-storyboard" }),
    ];
    const canceled = storyboardCancellation.settleStoryboardCancellation(nodes, new Set(["cancel-image-1", "cancel-image-2"]), "已取消");
    const firstImage = canceled.find((node) => node.id === "cancel-image-1");
    const firstCaption = canceled.find((node) => node.id === "cancel-caption-1");
    const group = canceled.find((node) => node.id === "storyboard-group-cancel");
    assert.equal(firstImage.metadata.storyboardStatus, "canceled");
    assert.equal(firstImage.metadata.executionStatus, "canceled");
    assert.equal(firstImage.metadata.status, "idle");
    assert.equal(firstImage.metadata.taskId, undefined);
    assert.equal(firstImage.metadata.content, "cancel-image-1.webp");
    assert.equal(firstCaption.metadata.storyboardStatus, "canceled");
    assert.equal(firstCaption.metadata.executionStatus, "canceled");
    assert.equal(firstCaption.metadata.status, "success");
    assert.equal(group.metadata.storyboardStatus, "canceled");
    assert.equal(group.metadata.executionStatus, "canceled");
    assert.equal(canceled.find((node) => node.id === "other-storyboard").metadata.storyboardStatus, "running");
});

test("reconciles a persisted group after child tasks resume", () => {
    const group = {
        id: "group-resume",
        type: "group",
        title: "分镜",
        position: { x: 0, y: 0 },
        width: 500,
        height: 400,
        metadata: { storyboardId: "storyboard-resume", storyboardStatus: "canceled", executionStatus: "canceled" },
    };
    const image = {
        id: "image-resume",
        type: "image",
        title: "镜头 1",
        position: { x: 0, y: 0 },
        width: 300,
        height: 220,
        metadata: { storyboardId: "storyboard-resume", storyboardSceneId: "shot-1", storyboardStatus: "succeeded" },
    };
    const reconciled = reconcileStoryboardGroupStatuses([group, image]);
    assert.equal(reconciled[0].metadata.storyboardStatus, "succeeded");
    assert.equal(reconciled[0].metadata.executionStatus, "succeeded");
});

test("detects aspect ratio from shot text and prefers it over selected ratio", () => {
    assert.equal(detectStoryboardShotAspectRatio("竖屏特写女孩"), "9:16");
    assert.equal(detectStoryboardShotAspectRatio("横屏远景"), "16:9");
    assert.equal(detectStoryboardShotAspectRatio("方形构图产品"), "1:1");
    assert.equal(detectStoryboardShotAspectRatio("1920x1080 城市夜景"), "16:9");
    assert.equal(detectStoryboardShotAspectRatio("显示屏显示1920x1080，画面用竖屏"), "9:16");
    assert.equal(detectStoryboardShotAspectRatio("下午16:30，女孩走进车站"), null);
    assert.equal(detectStoryboardShotAspectRatio("They meet in the town square."), null);
    assert.equal(detectStoryboardShotAspectRatio("镜头比例 9:16"), "9:16");
    assert.equal(detectStoryboardShotAspectRatio("蓝天白云"), null);

    assert.equal(resolveStoryboardShotAspectRatio("蓝天白云", "auto"), "auto");
    assert.equal(resolveStoryboardShotAspectRatio("蓝天白云", "16:9"), "16:9");
    assert.equal(resolveStoryboardShotAspectRatio("竖屏特写", "16:9"), "9:16");
    assert.equal(resolveStoryboardShotAspectRatio("竖屏特写", "auto"), "9:16");
});

test("keeps screenplay and paragraph boundaries stable while editing a displayed shot", () => {
    const screenplay = "INT. CAFE - NIGHT\nGirl enters.\nShe sits.";
    const screenplayRows = splitStoryboardDisplayLines(screenplay, { mode: "markers" });
    assert.equal(screenplayRows.length, 1);
    assert.equal(splitStoryboardDisplayLines(joinStoryboardDisplayLines(screenplayRows, "markers"), { mode: "markers" }).length, 1);

    const paragraphs = "女孩在车站等车。\n\n男孩在街上奔跑。";
    const paragraphRows = splitStoryboardDisplayLines(paragraphs, { mode: "paragraphs" });
    assert.equal(paragraphRows.length, 2);
    assert.equal(splitStoryboardDisplayLines(joinStoryboardDisplayLines(paragraphRows, "paragraphs"), { mode: "paragraphs" }).length, 2);
});
