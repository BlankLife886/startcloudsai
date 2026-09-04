const WEB_TERMS = ["联网", "搜索", "查证", "最新", "今天", "新闻", "价格", "政策", "版本"]
const IMAGE_TERMS = ["图片", "生图", "海报", "主图", "插画", "构图", "参考图", "修图"]
const FILE_TERMS = ["ppt", "pptx", "psd", "文档", "文件", "表格", "导出", "报告"]

function containsAny(value, terms) {
  const text = String(value || "").toLowerCase()
  return terms.some((term) => text.includes(term))
}

const GUIDANCE = {
  web: [
    { id: "verify-sources", icon: "bi-shield-check", label: "核对来源", prompt: "完成后继续核对关键结论，并补充对应的可靠来源链接。" },
    { id: "summarize-table", icon: "bi-table", label: "整理成表格", prompt: "完成后把结果整理成简洁的对比表格，保留日期和来源。" },
    { id: "deeper-search", icon: "bi-search", label: "继续深挖", prompt: "完成后继续搜索这个主题，补充容易遗漏的重要信息。" },
  ],
  image: [
    { id: "image-variant", icon: "bi-images", label: "再做一版", prompt: "完成后基于上一张再做一版，保留核心要求但换一种构图。" },
    { id: "image-refine", icon: "bi-sliders", label: "优化细节", prompt: "完成后检查上一张的主体、背景和细节，给出可以继续优化的具体方案。" },
    { id: "image-prompt", icon: "bi-card-text", label: "整理提示词", prompt: "完成后把这次需求整理成一份可复用的完整生图提示词。" },
  ],
  file: [
    { id: "file-summary", icon: "bi-list-check", label: "提炼要点", prompt: "完成后提炼最重要的结论和待办事项。" },
    { id: "file-table", icon: "bi-table", label: "整理表格", prompt: "完成后把关键信息整理成结构清晰的表格。" },
    { id: "file-export", icon: "bi-file-earmark-arrow-down", label: "导出文件", prompt: "完成后把最终内容整理成可下载的 Markdown 文件。" },
  ],
  chat: [
    { id: "chat-detail", icon: "bi-zoom-in", label: "深入说明", prompt: "完成后继续深入说明关键部分，避免重复已经回答的内容。" },
    { id: "chat-example", icon: "bi-lightbulb", label: "给出例子", prompt: "完成后补充几个具体例子，帮助我直接理解和使用。" },
    { id: "chat-actions", icon: "bi-list-check", label: "行动清单", prompt: "完成后把结论整理成一份简短、可执行的行动清单。" },
  ],
}

export function assistantRunGuidance(run = {}) {
  const prompt = String(run.prompt || "")
  const stage = String(run.stage || "").toLowerCase()
  const mode = String(run.resolvedMode || run.mode || "").toLowerCase()
  let kind = "chat"
  if (stage === "web_search" || containsAny(prompt, WEB_TERMS)) kind = "web"
  else if (mode === "image" || stage.includes("image") || containsAny(prompt, IMAGE_TERMS)) kind = "image"
  else if (stage.includes("ppt") || stage.includes("psd") || containsAny(prompt, FILE_TERMS)) kind = "file"
  return GUIDANCE[kind].map((item) => ({ ...item }))
}
