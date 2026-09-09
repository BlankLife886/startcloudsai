import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const createdAt = "2026-08-16T16:00:00.000Z";
const nodes = [];
const connections = [];

function textNode(id, title, x, y, content, width = 440, height = 300, fontSize = 15) {
    nodes.push({ id, type: "text", title, position: { x, y }, width, height, metadata: { content, status: "success", fontSize } });
}

function imageNode(id, title, x, y) {
    nodes.push({ id, type: "image", title, position: { x, y }, width: 360, height: 420, metadata: { content: "", status: "idle", freeResize: false } });
}

function configNode({ id, title, x, y, mode, prompt, outputId, size = "1024x1024", count = 1, background = "" }) {
    nodes.push({
        id,
        type: "config",
        title,
        position: { x, y },
        width: 360,
        height: 414,
        metadata: {
            status: "idle",
            generationMode: mode,
            model: mode === "text" ? "gpt-5.4" : "gpt-image-2",
            ...(mode === "image" ? { quality: "low", size, resolution: "1K", background, count } : { reasoningEffort: "medium", count: 1 }),
            composerContent: prompt,
            workflowOutputNodeIds: [outputId],
        },
    });
}

function outputNode(id, title, x, y, type, producerNodeId, width = type === "text" ? 440 : 360, height = type === "text" ? 300 : 420) {
    nodes.push({
        id,
        type,
        title,
        position: { x, y },
        width,
        height,
        metadata: { content: "", status: "idle", ...(type === "text" ? { fontSize: 14 } : { freeResize: false }), workflowProducerNodeId: producerNodeId },
    });
}

function edge(fromNodeId, toNodeId) {
    const id = `edge-${fromNodeId}-${toNodeId}`;
    if (!connections.some((item) => item.id === id)) connections.push({ id, fromNodeId, toNodeId });
}

function connectInputs(inputIds, configId, outputId) {
    inputIds.forEach((inputId) => edge(inputId, configId));
    edge(configId, outputId);
}

textNode(
    "guide",
    "使用说明｜完整电商生产线",
    -960,
    -820,
    "完整电商生产工作流（38 节点）\n\n1. 替换两张商品图片；至少替换主图，细节/包装图可选\n2. 修改品牌简报和商品事实，不要填写未经证实的功效\n3. 检查各配置节点的模型、尺寸和数量\n4. 点击右上角【运行工作流】并统一确认积分\n5. 全链路完成后查看最终质检报告\n\n下次换商品时只替换输入资产和文字资料，再次运行即可。所有输出都会原位更新。",
    500,
    360,
    16,
);
textNode(
    "map",
    "交付地图｜从母资产到上架包",
    -340,
    -820,
    "阶段 A｜商品理解与母资产\n视觉分析 · 透明 PNG · 包装事实校对\n\n阶段 B｜平台基础图\n白底主图 · 细节特写 · 对比展示\n\n阶段 C｜营销视觉矩阵\n1:1 主图 · 4:5 信息流 · 9:16 故事 · 16:9 横幅 · 生活方式 · 节日促销 · 信息图\n\n阶段 D｜文案与交付\n上架文案 · SEO 标题/要点 · 最终质检报告",
    620,
    360,
    16,
);

imageNode("input-main", "输入 01｜替换商品主图（必填）", -960, -300);
imageNode("input-detail", "输入 02｜替换细节/包装图（可选）", -960, 220);
textNode(
    "input-brand",
    "输入 03｜品牌与视觉简报",
    -960,
    760,
    "请把本段替换为真实品牌资料：\n\n品牌名：YOUR BRAND\n品牌调性：克制、可信、现代\n主色：根据包装自动提取\n目标人群：请填写\n核心场景：电商平台、详情页、社交媒体\n禁用元素：夸张功效、未经授权的 Logo、竞品包装、人物肖像\n文案语气：简洁、专业、避免绝对化表达",
    440,
    340,
);
textNode(
    "input-facts",
    "输入 04｜商品事实与合规信息",
    -960,
    1160,
    "请把本段替换为包装或官方资料中可验证的信息：\n\n商品名称：\n品类：\n规格/容量：\n材质/成分：\n真实卖点：\n使用方法：\n适用范围：\n平台限制：不得虚构认证、销量、折扣、疗效或成分。没有证据的内容一律不要写。",
    440,
    360,
);

configNode({
    id: "cfg-analysis",
    title: "A1｜商品视觉与风险分析",
    x: -340,
    y: -300,
    mode: "text",
    outputId: "out-analysis",
    prompt:
        "Analyze the ecommerce product shown in @[node:input-main] and, when available, @[node:input-detail]. Cross-check it against @[node:input-brand] and @[node:input-facts]. Return a concise Chinese production brief with: product identity, shape and proportions, materials, color palette, logo/label details, must-preserve visual features, likely retouching risks, recommended crop ratios, lighting direction, and a list of claims or details that must not be invented.",
});
outputNode("out-analysis", "输出 A1｜商品视觉分析报告", 180, -300, "text", "cfg-analysis", 460, 360);
connectInputs(["input-main", "input-detail", "input-brand", "input-facts"], "cfg-analysis", "out-analysis");

configNode({
    id: "cfg-transparent",
    title: "A2｜透明 PNG 商品母资产",
    x: -340,
    y: 220,
    mode: "image",
    outputId: "out-transparent",
    background: "transparent",
    prompt:
        "Use @[node:input-main] as the only product identity reference and use @[node:input-detail] only to recover true packaging details. Extract the exact complete product into a clean transparent-background PNG master asset. Preserve geometry, proportions, logo, label text, colors, materials, reflections, glass or metal highlights, and realistic edges. Center the full product with safe margins. No cropping, no props, no added text, no watermark, no redesign.",
});
outputNode("out-transparent", "输出 A2｜透明 PNG 母资产", 180, 220, "image", "cfg-transparent");
connectInputs(["input-main", "input-detail"], "cfg-transparent", "out-transparent");

configNode({
    id: "cfg-packaging",
    title: "A3｜包装与事实校对图",
    x: -340,
    y: 760,
    mode: "image",
    outputId: "out-packaging",
    prompt:
        "Create a clean ecommerce packaging documentation image using @[node:input-main] and @[node:input-detail]. Preserve all visible packaging, label, cap, accessories, and printed information exactly; follow the verified facts in @[node:input-facts]. Arrange the available product and packaging components on a neutral light-gray studio background with even catalog lighting. Do not invent missing package sides, certifications, ingredients, accessories, badges, or text.",
});
outputNode("out-packaging", "输出 A3｜包装校对图", 180, 760, "image", "cfg-packaging");
connectInputs(["input-main", "input-detail", "input-facts"], "cfg-packaging", "out-packaging");

configNode({
    id: "cfg-listing-copy",
    title: "D1｜上架卖点与详情页文案",
    x: 720,
    y: -300,
    mode: "text",
    outputId: "out-listing-copy",
    prompt:
        "Write compliant Chinese ecommerce listing copy using the visual findings in @[node:out-analysis], the brand direction in @[node:input-brand], and only the verified facts in @[node:input-facts]. Produce: one short positioning sentence, five factual selling points, a concise detail-page structure, three callout phrases of no more than 12 Chinese characters, and a list of prohibited or unsupported claims. Do not invent efficacy, certification, sales volume, discounts, ingredients, or specifications.",
});
outputNode("out-listing-copy", "输出 D1｜上架卖点与详情页文案", 1240, -300, "text", "cfg-listing-copy", 480, 380);
connectInputs(["out-analysis", "input-brand", "input-facts"], "cfg-listing-copy", "out-listing-copy");

configNode({
    id: "cfg-white",
    title: "B1｜平台白底主图",
    x: 720,
    y: 220,
    mode: "image",
    outputId: "out-white",
    prompt:
        "Create a marketplace-ready square white-background packshot from @[node:out-transparent], following the preservation requirements in @[node:out-analysis]. Use a pure #FFFFFF background with only a subtle realistic contact shadow. Keep the complete product centered and occupying about 78-84% of the frame with balanced safe margins. Clean catalog lighting, crisp edges, no props, no people, no extra text, no watermark.",
});
outputNode("out-white", "输出 B1｜平台白底主图", 1240, 220, "image", "cfg-white");
connectInputs(["out-transparent", "out-analysis"], "cfg-white", "out-white");

configNode({
    id: "cfg-detail",
    title: "B2｜材质与工艺细节特写",
    x: 720,
    y: 760,
    mode: "image",
    outputId: "out-detail",
    prompt:
        "Create a premium ecommerce macro detail image from @[node:out-transparent] and use @[node:input-detail] only for truthful close-up details. Follow @[node:out-analysis]. Show the most important real material, texture, closure, interface, surface finish, or label craftsmanship in a clean studio macro composition. Preserve exact colors and construction. No invented mechanisms, ingredients, effects, labels, or text overlays.",
});
outputNode("out-detail", "输出 B2｜材质工艺特写", 1240, 760, "image", "cfg-detail");
connectInputs(["out-transparent", "input-detail", "out-analysis"], "cfg-detail", "out-detail");

configNode({
    id: "cfg-square",
    title: "C1｜1:1 电商/社媒主视觉",
    x: 1780,
    y: -820,
    mode: "image",
    outputId: "out-square",
    prompt:
        "Create a premium 1:1 ecommerce and social-media hero using @[node:out-transparent] as the exact product reference. Follow @[node:input-brand] and the factual positioning in @[node:out-listing-copy]. Use restrained brand-compatible colors, a simple studio pedestal, controlled directional light, realistic shadows, and clean copy space. Product remains dominant and fully recognizable. No people, no unsupported claims, no extra brand marks, no watermark.",
});
outputNode("out-square", "输出 C1｜1:1 主视觉", 2260, -820, "image", "cfg-square");
connectInputs(["out-transparent", "input-brand", "out-listing-copy"], "cfg-square", "out-square");

configNode({
    id: "cfg-portrait",
    title: "C2｜4:5 信息流视觉",
    x: 1780,
    y: -300,
    mode: "image",
    outputId: "out-portrait",
    size: "1024x1280",
    prompt:
        "Create a vertical 4:5 ecommerce feed visual using @[node:out-transparent] as the exact product reference. Follow @[node:input-brand] and @[node:out-listing-copy]. Compose the product in the lower or central visual area with ample clean headline space above, brand-compatible studio materials, soft directional light, and realistic contact shadows. Preserve all packaging and label details. No added text, no people, no watermark.",
});
outputNode("out-portrait", "输出 C2｜4:5 信息流视觉", 2260, -300, "image", "cfg-portrait", 340, 425);
connectInputs(["out-transparent", "input-brand", "out-listing-copy"], "cfg-portrait", "out-portrait");

configNode({
    id: "cfg-story",
    title: "C3｜9:16 故事/短视频封面",
    x: 1780,
    y: 220,
    mode: "image",
    outputId: "out-story",
    size: "1024x1792",
    prompt:
        "Create a vertical 9:16 story or short-video cover from @[node:out-transparent]. Use @[node:input-brand] and @[node:out-listing-copy] for art direction only. Keep the exact product in the lower-middle safe zone, leaving generous clean space at the top and bottom for later interface and copy placement. Premium studio lighting, clear depth, realistic shadows. No embedded text, no people, no watermark.",
});
outputNode("out-story", "输出 C3｜9:16 故事封面", 2260, 220, "image", "cfg-story", 280, 490);
connectInputs(["out-transparent", "input-brand", "out-listing-copy"], "cfg-story", "out-story");

configNode({
    id: "cfg-banner",
    title: "C4｜16:9 店铺横幅",
    x: 1780,
    y: 760,
    mode: "image",
    outputId: "out-banner",
    size: "1792x1024",
    prompt:
        "Create a wide 16:9 ecommerce store banner using @[node:out-transparent] as the exact product reference. Follow @[node:input-brand] and @[node:out-listing-copy]. Place the product on one side with balanced negative space on the other for later headline placement. Use minimal brand-compatible surfaces, controlled lighting, realistic shadows, and clear visual hierarchy. No embedded text, no people, no watermark.",
});
outputNode("out-banner", "输出 C4｜16:9 店铺横幅", 2260, 760, "image", "cfg-banner", 480, 275);
connectInputs(["out-transparent", "input-brand", "out-listing-copy"], "cfg-banner", "out-banner");

configNode({
    id: "cfg-lifestyle",
    title: "C5｜真实生活方式场景",
    x: 1780,
    y: 1280,
    mode: "image",
    outputId: "out-lifestyle",
    prompt:
        "Create a believable lifestyle ecommerce scene using @[node:out-transparent] as the exact product reference. Use @[node:input-brand], @[node:input-facts], and @[node:out-analysis] to choose a truthful environment that fits the real product category and use context. Keep the product clearly visible and unchanged, with natural daylight, realistic scale, and restrained props. Do not depict unsupported usage, ingredients, effects, people, claims, or extra brands.",
});
outputNode("out-lifestyle", "输出 C5｜生活方式场景", 2260, 1280, "image", "cfg-lifestyle");
connectInputs(["out-transparent", "input-brand", "input-facts", "out-analysis"], "cfg-lifestyle", "out-lifestyle");

configNode({
    id: "cfg-seasonal",
    title: "C6｜节日促销氛围图",
    x: 2840,
    y: -820,
    mode: "image",
    outputId: "out-seasonal",
    prompt:
        "Create a tasteful seasonal ecommerce promotional visual using @[node:out-transparent] as the exact product reference. Follow @[node:input-brand] and @[node:out-listing-copy]. Use subtle celebratory materials, gift-ready composition, controlled highlights, and clear empty space for later campaign copy. Keep the product dominant and unchanged. No discount numbers, no fabricated badges, no embedded text, no people, no watermark.",
});
outputNode("out-seasonal", "输出 C6｜节日促销氛围图", 3320, -820, "image", "cfg-seasonal");
connectInputs(["out-transparent", "input-brand", "out-listing-copy"], "cfg-seasonal", "out-seasonal");

configNode({
    id: "cfg-infographic",
    title: "C7｜商品卖点信息图底图",
    x: 2840,
    y: -300,
    mode: "image",
    outputId: "out-infographic",
    prompt:
        "Create a clean ecommerce feature-infographic base using @[node:out-transparent] as the exact product reference and the verified content in @[node:out-listing-copy] and @[node:input-facts]. Arrange the product with three clear empty callout zones and subtle visual leader lines or geometric anchors, but do not render any words, numbers, certification icons, or claims. Neutral brand-compatible background, crisp hierarchy, no people, no watermark.",
});
outputNode("out-infographic", "输出 C7｜卖点信息图底图", 3320, -300, "image", "cfg-infographic");
connectInputs(["out-transparent", "out-listing-copy", "input-facts"], "cfg-infographic", "out-infographic");

configNode({
    id: "cfg-comparison",
    title: "B3｜规格/视角对比展示",
    x: 2840,
    y: 220,
    mode: "image",
    outputId: "out-comparison",
    prompt:
        "Create a clean comparison-style ecommerce layout using @[node:out-white], @[node:out-packaging], and the truthful constraints in @[node:out-analysis]. Show the same product identity in a balanced multi-panel or lineup composition that helps compare real included views, package components, or scale cues. Do not fabricate variants, sizes, accessories, measurements, labels, or text. Pure light background, consistent lighting, no watermark.",
});
outputNode("out-comparison", "输出 B3｜规格/视角对比图", 3320, 220, "image", "cfg-comparison");
connectInputs(["out-white", "out-packaging", "out-analysis"], "cfg-comparison", "out-comparison");

configNode({
    id: "cfg-seo",
    title: "D2｜SEO 标题与平台要点",
    x: 2840,
    y: 760,
    mode: "text",
    outputId: "out-seo",
    prompt:
        "Using @[node:out-listing-copy], @[node:out-analysis], and @[node:input-facts], write a Chinese ecommerce SEO package without inventing facts. Provide: three platform-safe titles of different lengths, five search-friendly bullet points, ten factual keyword phrases, one concise image alt text, and a compliance warning list. Avoid medical, absolute, ranking, certification, discount, sales-volume, and performance claims unless explicitly present in the verified facts.",
});
outputNode("out-seo", "输出 D2｜SEO 标题与平台要点", 3320, 760, "text", "cfg-seo", 480, 390);
connectInputs(["out-listing-copy", "out-analysis", "input-facts"], "cfg-seo", "out-seo");

configNode({
    id: "cfg-qa",
    title: "D3｜最终交付质检报告",
    x: 3900,
    y: 220,
    mode: "text",
    outputId: "out-qa",
    prompt:
        "Audit the completed ecommerce delivery set. Use the source facts in @[node:input-facts], the preservation rules in @[node:out-analysis], the listing copy in @[node:out-listing-copy], the SEO copy in @[node:out-seo], and visually inspect @[node:out-white], @[node:out-detail], @[node:out-square], @[node:out-portrait], @[node:out-story], @[node:out-banner], @[node:out-lifestyle], @[node:out-seasonal], @[node:out-infographic], and @[node:out-comparison]. Return a Chinese QA table covering product consistency, label/logo fidelity, background and edge quality, platform ratio readiness, unsupported claims, copy-image consistency, and required manual fixes. Mark each item as pass, review, or fail. Do not assume unseen details are correct.",
});
outputNode("out-qa", "最终输出｜交付质检报告", 4420, 220, "text", "cfg-qa", 520, 520);
connectInputs(
    [
        "input-facts",
        "out-analysis",
        "out-listing-copy",
        "out-seo",
        "out-white",
        "out-detail",
        "out-square",
        "out-portrait",
        "out-story",
        "out-banner",
        "out-lifestyle",
        "out-seasonal",
        "out-infographic",
        "out-comparison",
    ],
    "cfg-qa",
    "out-qa",
);

const project = {
    id: "f8e621bd-6e45-4e32-9e8e-499943651b97",
    title: "模板｜完整电商生产工作流（38节点）",
    createdAt,
    updatedAt: createdAt,
    nodes,
    connections,
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "lines",
    showImageInfo: true,
    viewport: { x: 240, y: 320, k: 0.18 },
};

const data = { app: "infinite-canvas", version: 3, exportedAt: createdAt, projects: [{ project, files: [] }] };
const target = path.join(path.dirname(fileURLToPath(import.meta.url)), "projects.json");
fs.writeFileSync(target, `${JSON.stringify(data, null, 2)}\n`);
console.log(`Wrote ${nodes.length} nodes and ${connections.length} connections to ${target}`);
