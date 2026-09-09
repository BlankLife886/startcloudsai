export function canvasGenerationStageLabel(stage?: string, fallback = "正在生成") {
    switch (String(stage || "").trim()) {
        case "queued":
            return "正在排队";
        case "preparing":
            return "正在准备参考图";
        case "upstream_generating":
            return "上游正在生成";
        case "fetching_result":
            return "正在获取生成结果";
        case "saving_result":
            return "正在保存图片";
        default:
            return fallback;
    }
}
